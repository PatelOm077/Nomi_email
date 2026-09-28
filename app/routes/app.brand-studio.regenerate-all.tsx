import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { MeteredAiError } from "../brand-studio/ai.server";
import { getApprovedBrandStudioFamily } from "../brand-studio/approved-family";
import {
  generateLifecycleEmailsWithCampaignEngine,
  lifecycleLanguageAndTone,
} from "../brand-studio/campaign-engine.server";
import {
  auditCompiledEmail,
  auditEmailFamily,
} from "../brand-studio/email-quality";
import { LIFECYCLE_FLOWS } from "../dashboard/lifecycle-flow-catalog";
import type { GraphqlAdmin } from "../dashboard/campaign-catalog.server";
import { checkAllowance, recordUsage } from "../billing/usage.server";

type RegenerateAllJobState =
  | {
      status: "pending";
      startedAt: number;
      completedFlows: number;
      currentFlow: string | null;
    }
  | { status: "done"; count: number; costMicros: number }
  | { status: "error"; error: string };

export type RegenerateAllActionResult =
  | {
      ok: true;
      status: "pending";
      completedFlows: number;
      totalFlows: number;
      currentFlow: string | null;
    }
  | { ok: true; status: "done"; count: number; costMicros: number }
  | { ok: false; status: "error"; error: string };

const regenerateAllJobs = new Map<string, RegenerateAllJobState>();
const REGENERATE_ALL_JOB_STALE_MS = 30 * 60 * 1000;
const inFlightRegenerateAllJobs = new Map<string, Promise<void>>();

export async function __waitForRegenerateAllJobsForTests() {
  await Promise.all(inFlightRegenerateAllJobs.values());
}

function pendingResult(
  job: Extract<RegenerateAllJobState, { status: "pending" }>,
): RegenerateAllActionResult {
  return {
    ok: true,
    status: "pending",
    completedFlows: job.completedFlows,
    totalFlows: LIFECYCLE_FLOWS.length,
    currentFlow: job.currentFlow,
  };
}

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method.toUpperCase() !== "POST")
    return data<RegenerateAllActionResult>(
      {
        ok: false,
        status: "error",
        error: "Regenerate all emails with the button in Brand Studio.",
      },
      { status: 405 },
    );

  const { session, admin } = await authenticate.admin(request);
  const jobKey = session.shop;
  const existingJob = regenerateAllJobs.get(jobKey);
  if (existingJob) {
    if (
      existingJob.status === "pending" &&
      Date.now() - existingJob.startedAt < REGENERATE_ALL_JOB_STALE_MS
    )
      return data<RegenerateAllActionResult>(pendingResult(existingJob));

    regenerateAllJobs.delete(jobKey);
    if (existingJob.status === "done")
      return data<RegenerateAllActionResult>({
        ok: true,
        status: "done",
        count: existingJob.count,
        costMicros: existingJob.costMicros,
      });
    if (existingJob.status === "error")
      return data<RegenerateAllActionResult>(
        { ok: false, status: "error", error: existingJob.error },
        { status: 400 },
      );
    return data<RegenerateAllActionResult>(
      {
        ok: false,
        status: "error",
        error: "Regeneration took too long. Your current emails were kept.",
      },
      { status: 400 },
    );
  }

  const profile = await db.brandStudioProfile.findUnique({
    where: { shop: session.shop },
  });
  const approved = getApprovedBrandStudioFamily(profile);
  if (!approved)
    return data<RegenerateAllActionResult>(
      {
        ok: false,
        status: "error",
        error:
          "Finish and approve the current Brand Studio family before regenerating all emails.",
      },
      { status: 400 },
    );

  const allowance = await checkAllowance(session.shop, "regenerate_all");
  if (!allowance.allowed)
    return data<RegenerateAllActionResult>(
      { ok: false, status: "error", error: allowance.message ?? "Your plan's Regenerate alls are used up." },
      { status: 400 },
    );

  const pending: Extract<RegenerateAllJobState, { status: "pending" }> = {
    status: "pending",
    startedAt: Date.now(),
    completedFlows: 0,
    currentFlow: null,
  };
  regenerateAllJobs.set(jobKey, pending);
  const jobPromise = runRegenerateAllJob({
    shop: session.shop,
    admin,
    profile: profile!,
    approved,
    jobKey,
  }).finally(() => inFlightRegenerateAllJobs.delete(jobKey));
  inFlightRegenerateAllJobs.set(jobKey, jobPromise);
  void jobPromise;

  return data<RegenerateAllActionResult>(pendingResult(pending));
};

async function runRegenerateAllJob(input: {
  shop: string;
  admin: GraphqlAdmin;
  profile: NonNullable<
    Awaited<ReturnType<typeof db.brandStudioProfile.findUnique>>
  >;
  approved: NonNullable<ReturnType<typeof getApprovedBrandStudioFamily>>;
  jobKey: string;
}) {
  const { shop, admin, profile, approved, jobKey } = input;
  let checkpointedCostMicros = 0;
  try {
    // Every email is rebuilt from scratch by the campaign engine (its own
    // plan, photos, and designer call). The current family stays live until
    // all 13 new ones pass the quality gate below.
    const settings = await db.shopSettings.findUnique({ where: { shop } });
    const creative = await generateLifecycleEmailsWithCampaignEngine({
      admin,
      evidence: approved.evidence,
      brandSystem: approved.brandSystem,
      recipes: approved.recipes,
      ...lifecycleLanguageAndTone(settings),
      onCheckpoint: async (checkpoint) => {
        checkpointedCostMicros += checkpoint.costMicros;
        const current = regenerateAllJobs.get(jobKey);
        const completedFlows =
          current?.status === "pending"
            ? current.completedFlows + (checkpoint.flowComplete ? 1 : 0)
            : checkpoint.flowComplete
              ? 1
              : 0;
        regenerateAllJobs.set(jobKey, {
          status: "pending",
          startedAt:
            current?.status === "pending" ? current.startedAt : Date.now(),
          completedFlows,
          currentFlow: checkpoint.flowId,
        });
        await db.brandStudioProfile.update({
          where: { shop },
          data: {
            anthropicInputTokens: {
              increment: checkpoint.usage.inputTokens,
            },
            anthropicOutputTokens: {
              increment: checkpoint.usage.outputTokens,
            },
            estimatedCostMicros: { increment: checkpoint.costMicros },
          },
        });
      },
    });

    const unchangedIds = approved.recipes
      .map(({ id }) => id)
      .filter(
        (id) =>
          !creative.value[id] ||
          creative.value[id] === approved.renderedEmails[id],
      );
    if (unchangedIds.length) {
      regenerateAllJobs.set(jobKey, {
        status: "error",
        error:
          "Nomi did not produce a new version of every email. Your current family was kept.",
      });
      return;
    }

    const proofEmails = approved.recipes.map((recipe) => ({
      recipe,
      html: creative.value[recipe.id],
      quality: auditCompiledEmail({
        html: creative.value[recipe.id],
        recipe,
        brandSystem: approved.brandSystem,
        products: approved.evidence.products,
        storefrontUrl: approved.evidence.storefrontUrl,
      }),
    }));
    const proof = auditEmailFamily({
      brandSystem: approved.brandSystem,
      emails: proofEmails,
    });
    const qualityErrors = [
      ...proof.issues,
      ...proofEmails.flatMap(({ quality }) =>
        quality.issues.filter(({ severity }) => severity === "error"),
      ),
    ];
    if (proof.status !== "ready" || qualityErrors.length) {
      const reasons = qualityErrors
        .map(({ message }) => message)
        .filter((message, index, all) => all.indexOf(message) === index)
        .slice(0, 3)
        .join(" ");
      regenerateAllJobs.set(jobKey, {
        status: "error",
        error: `The new family did not clear the quality gate. ${reasons} Your current emails were kept.`,
      });
      return;
    }

    await db.brandStudioProfile.update({
      where: { shop },
      data: {
        renderedEmails: JSON.stringify(creative.value),
        anthropicInputTokens: { increment: creative.usage.inputTokens },
        anthropicOutputTokens: { increment: creative.usage.outputTokens },
        estimatedCostMicros: { increment: creative.costMicros },
        completedAt: new Date(),
      },
    });
    await recordUsage(shop, "regenerate_all");

    regenerateAllJobs.set(jobKey, {
      status: "done",
      count: approved.recipes.length,
      costMicros: checkpointedCostMicros + creative.costMicros,
    });
  } catch (error) {
    if (error instanceof MeteredAiError) {
      await db.brandStudioProfile.update({
        where: { shop },
        data: {
          anthropicInputTokens: { increment: error.usage.inputTokens },
          anthropicOutputTokens: { increment: error.usage.outputTokens },
          estimatedCostMicros: { increment: error.costMicros },
        },
      });
    }
    regenerateAllJobs.set(jobKey, {
      status: "error",
      error:
        error instanceof Error
          ? `${error.message} Your current emails were kept.`
          : "Nomi could not regenerate the email family. Your current emails were kept.",
    });
  }
}
