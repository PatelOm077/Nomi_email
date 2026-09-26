import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  generateCreativeEmailFamilyWithSonnet,
  MeteredAiError,
  REGENERATE_COMPOSITION_DIRECTIVES,
} from "../brand-studio/ai.server";
import { assertStageBudget } from "../brand-studio/budget.server";
import {
  applyEvidencePalette,
  getApprovedBrandStudioFamily,
} from "../brand-studio/approved-family";
import { auditCompiledEmail } from "../brand-studio/email-quality";
import { BRAND_STUDIO_LIFECYCLE_IDS } from "../brand-studio/types";

// Regenerates exactly one lifecycle email inside an already-approved Brand
// Studio family, without touching the other 12. Deliberately a separate,
// fetcher-shaped, non-redirecting route rather than a new intent on
// app.brand-studio.tsx's action — every branch there ends in a full-page
// redirect, which fits the multi-step wizard but not a single dashboard-row
// "Rebuild" click that should never navigate away.

// A single Claude call for one fully art-directed email routinely runs
// longer than Cloudflare's ~100s tunnel timeout, which used to surface as a
// dead 524 with no result and no way to recover short of clicking again.
// The dev/production Node process is long-lived, so the real work now runs
// fire-and-forget here and the client polls this same action (same
// recipeId) until it reports "done" or "error" — every individual HTTP
// round trip returns in well under a second and can never itself hit the
// tunnel timeout.
type RegenerateJobState =
  | { status: "pending"; startedAt: number }
  | { status: "done"; html: string }
  | { status: "error"; error: string };

const regenerateJobs = new Map<string, RegenerateJobState>();
const REGENERATE_JOB_STALE_MS = 5 * 60 * 1000;
// Which composition directive (see REGENERATE_COMPOSITION_DIRECTIVES) most
// recently regenerated this shop+recipe, keyed the same as regenerateJobs.
// Consecutive clicks on the same email must land on a different structural
// axis each time rather than re-rolling the same instruction (and getting
// back a near-duplicate) or drifting randomly and occasionally repeating.
// In-memory and process-lifetime only, same durability tradeoff as
// regenerateJobs above — worst case after a restart is one repeated axis.
const lastCompositionDirectiveByJobKey = new Map<string, string>();
function pickCompositionDirective(jobKey: string): string {
  const previous = lastCompositionDirectiveByJobKey.get(jobKey);
  const choices = REGENERATE_COMPOSITION_DIRECTIVES.filter(
    (directive) => directive !== previous,
  );
  const pick = choices[Math.floor(Math.random() * choices.length)];
  lastCompositionDirectiveByJobKey.set(jobKey, pick);
  return pick;
}
// Lets tests await the fire-and-forget background job instead of racing it.
// Not used by any production code path.
const inFlightRegenerateJobs = new Map<string, Promise<void>>();
export async function __waitForRegenerateJobsForTests() {
  await Promise.all(inFlightRegenerateJobs.values());
}

type RegenerateActionResult =
  | { ok: true; recipeId: string; status: "pending" }
  | { ok: true; recipeId: string; status: "done"; html: string }
  | { ok: false; recipeId: string | null; status: "error"; error: string };

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();

  const recipeIdValue = formData.get("recipeId");
  if (
    typeof recipeIdValue !== "string" ||
    !(BRAND_STUDIO_LIFECYCLE_IDS as readonly string[]).includes(recipeIdValue)
  )
    return data<RegenerateActionResult>(
      {
        ok: false,
        recipeId: null,
        status: "error",
        error: "Choose a valid lifecycle email.",
      },
      { status: 400 },
    );
  const recipeId = recipeIdValue as (typeof BRAND_STUDIO_LIFECYCLE_IDS)[number];
  const jobKey = `${session.shop}:${recipeId}`;

  const existingJob = regenerateJobs.get(jobKey);
  if (existingJob) {
    if (
      existingJob.status === "pending" &&
      Date.now() - existingJob.startedAt < REGENERATE_JOB_STALE_MS
    ) {
      return data<RegenerateActionResult>({
        ok: true,
        recipeId,
        status: "pending",
      });
    }
    regenerateJobs.delete(jobKey);
    if (existingJob.status === "done") {
      return data<RegenerateActionResult>({
        ok: true,
        recipeId,
        status: "done",
        html: existingJob.html,
      });
    }
    if (existingJob.status === "error") {
      return data<RegenerateActionResult>(
        { ok: false, recipeId, status: "error", error: existingJob.error },
        { status: 400 },
      );
    }
    // Fell through: a pending job that has been running past the stale
    // threshold. Treat it as failed rather than leaving the button spinning
    // forever, and let the next click start a fresh one.
    return data<RegenerateActionResult>(
      {
        ok: false,
        recipeId,
        status: "error",
        error: "Regeneration took too long. Try again.",
      },
      { status: 400 },
    );
  }

  const refinementValue = formData.get("refinement");
  const refinement =
    typeof refinementValue === "string" && refinementValue.trim()
      ? refinementValue.trim().slice(0, 400)
      : null;

  const profile = await db.brandStudioProfile.findUnique({
    where: { shop: session.shop },
  });
  const approved = getApprovedBrandStudioFamily(profile);
  if (!approved)
    return data<RegenerateActionResult>(
      {
        ok: false,
        recipeId,
        status: "error",
        error:
          "Build the full email family in Brand Studio before regenerating a single email.",
      },
      { status: 400 },
    );

  try {
    assertStageBudget(profile!.currentBuildCostMicros, 800_000);
  } catch (error) {
    return data<RegenerateActionResult>(
      {
        ok: false,
        recipeId,
        status: "error",
        error:
          error instanceof Error
            ? error.message
            : "Nomi could not regenerate this email.",
      },
      { status: 400 },
    );
  }

  regenerateJobs.set(jobKey, { status: "pending", startedAt: Date.now() });
  const jobPromise = runRegenerateJob({
    shop: session.shop,
    recipeId,
    refinement,
    profile: profile!,
    approved,
    jobKey,
  }).finally(() => inFlightRegenerateJobs.delete(jobKey));
  inFlightRegenerateJobs.set(jobKey, jobPromise);
  void jobPromise;

  return data<RegenerateActionResult>({ ok: true, recipeId, status: "pending" });
};

async function runRegenerateJob(input: {
  shop: string;
  recipeId: (typeof BRAND_STUDIO_LIFECYCLE_IDS)[number];
  refinement: string | null;
  profile: NonNullable<
    Awaited<ReturnType<typeof db.brandStudioProfile.findUnique>>
  >;
  approved: NonNullable<ReturnType<typeof getApprovedBrandStudioFamily>>;
  jobKey: string;
}) {
  const { shop, recipeId, refinement, profile, approved, jobKey } = input;
  try {
    const buildDirection = applyEvidencePalette(
      approved.direction,
      approved.evidence,
    );
    // Pass the full rendered map (including the target's current HTML, kept
    // as "previousHtml" context for the variation instruction) and let
    // regenerateOnlyId scope generation to exactly this recipe. Every
    // sibling — regardless of whether it would still pass today's safety
    // checks — is trusted verbatim and never sent back to Claude.
    const creative = await generateCreativeEmailFamilyWithSonnet({
      evidence: approved.evidence,
      brandSystem: approved.brandSystem,
      direction: buildDirection,
      recipes: approved.recipes,
      refinement,
      existingRendered: approved.renderedEmails,
      skipCritique: true,
      regenerateOnlyId: recipeId,
      regenerateCompositionDirective: pickCompositionDirective(jobKey),
    });

    const changedKeys = Object.keys(creative.value).filter(
      (id) => creative.value[id] !== approved.renderedEmails[id],
    );
    if (!changedKeys.includes(recipeId)) {
      regenerateJobs.set(jobKey, {
        status: "error",
        error: "Claude did not return the regenerated email.",
      });
      return;
    }
    // Belt-and-suspenders: regenerateOnlyId should make this impossible,
    // since every sibling is seeded pre-trusted and never pending.
    if (changedKeys.some((id) => id !== recipeId)) {
      regenerateJobs.set(jobKey, {
        status: "error",
        error:
          "A sibling email changed during regeneration. Rebuild the full family from Brand Studio instead.",
      });
      return;
    }

    // Only the regenerated email's own safety/quality audit gates the
    // persist. The family-wide audit (auditEmailFamily) compares all 13
    // emails against each other for variety and repetition — appropriate
    // for a full-family build, but wrong here: it would fail this targeted
    // regenerate over an untouched sibling's pre-existing issues, which is
    // exactly the "rebuild everything" behavior a single-email regenerate
    // exists to avoid.
    const targetRecipe = approved.recipes.find(({ id }) => id === recipeId)!;
    const targetQuality = auditCompiledEmail({
      html: creative.value[recipeId],
      recipe: targetRecipe,
      brandSystem: approved.brandSystem,
      products: approved.evidence.products,
      storefrontUrl: approved.evidence.storefrontUrl,
    });
    const targetIssues = targetQuality.issues.filter(
      ({ severity }) => severity === "error",
    );
    if (targetIssues.length) {
      const reasons = targetIssues.map(({ message }) => message).join(" ");
      regenerateJobs.set(jobKey, {
        status: "error",
        error: `This email did not clear the quality gate. ${reasons}`,
      });
      return;
    }

    await db.brandStudioProfile.update({
      where: { shop },
      data: {
        renderedEmails: JSON.stringify({
          ...approved.renderedEmails,
          [recipeId]: creative.value[recipeId],
        }),
        anthropicInputTokens: { increment: creative.usage.inputTokens },
        anthropicOutputTokens: { increment: creative.usage.outputTokens },
        estimatedCostMicros: { increment: creative.costMicros },
        currentBuildCostMicros: { increment: creative.costMicros },
      },
    });

    regenerateJobs.set(jobKey, {
      status: "done",
      html: creative.value[recipeId],
    });
  } catch (error) {
    if (error instanceof MeteredAiError) {
      await db.brandStudioProfile.update({
        where: { shop },
        data: {
          anthropicInputTokens: { increment: error.usage.inputTokens },
          anthropicOutputTokens: { increment: error.usage.outputTokens },
          estimatedCostMicros: { increment: error.costMicros },
          currentBuildCostMicros: { increment: error.costMicros },
        },
      });
    }
    regenerateJobs.set(jobKey, {
      status: "error",
      error:
        error instanceof Error
          ? error.message
          : "Nomi could not regenerate this email.",
    });
  }
}
