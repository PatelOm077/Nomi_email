import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { MeteredAiError } from "../brand-studio/ai.server";
import { assertStageBudget } from "../brand-studio/budget.server";
import { checkAllowance, recordUsage } from "../billing/usage.server";
import { getApprovedBrandStudioFamily } from "../brand-studio/approved-family";
import {
  generateLifecycleEmailsWithCampaignEngine,
  lifecycleLanguageAndTone,
} from "../brand-studio/campaign-engine.server";
import { auditCompiledEmail } from "../brand-studio/email-quality";
import { BRAND_STUDIO_LIFECYCLE_IDS } from "../brand-studio/types";
import {
  loadCampaignCollectionProducts,
  loadCampaignProductsByIds,
  type CampaignCatalogProduct,
  type GraphqlAdmin,
} from "../dashboard/campaign-catalog.server";

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
// A finished regenerate the merchant hasn't saved yet, keyed like
// regenerateJobs. Only intent=save writes it into the approved family, so
// Discard (or just closing) leaves the Flow Editor email untouched.
// Process-lifetime only: a restart drops unsaved drafts, and Save then asks
// the merchant to regenerate again.
const regenerateDrafts = new Map<string, { html: string; createdAt: number }>();
const REGENERATE_DRAFT_TTL_MS = 60 * 60 * 1000;
const REGENERATE_JOB_STALE_MS = 10 * 60 * 1000;
// Lets tests await the fire-and-forget background job instead of racing it.
// Not used by any production code path.
const inFlightRegenerateJobs = new Map<string, Promise<void>>();
export async function __waitForRegenerateJobsForTests() {
  await Promise.all(inFlightRegenerateJobs.values());
}

type RegenerateActionResult =
  | { ok: true; recipeId: string; status: "pending" }
  | { ok: true; recipeId: string; status: "done"; html: string }
  | { ok: true; recipeId: string; status: "saved"; html: string }
  | { ok: true; recipeId: string; status: "discarded" }
  | { ok: false; recipeId: string | null; status: "error"; error: string };

// What the merchant asked for in the Flow Editor regenerate modal. All
// optional: an empty modal regenerates exactly as before.
type RegenerateBrief = {
  products: CampaignCatalogProduct[];
  direction: string | null;
};

function formText(formData: FormData, name: string, max: number): string | null {
  const value = formData.get(name);
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

function isoDay(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

async function readRegenerateBrief(
  formData: FormData,
  admin: GraphqlAdmin,
): Promise<RegenerateBrief> {
  const prompt = formText(formData, "prompt", 600);
  const feature = formText(formData, "feature", 20);
  const productIds = (formText(formData, "productIds", 400) ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.startsWith("gid://shopify/Product/"))
    .slice(0, 3);
  const collectionId = formText(formData, "collectionId", 120);

  let products: CampaignCatalogProduct[] = [];
  let collectionTitle: string | null = null;
  if (feature === "collection" && collectionId) {
    const collection = await loadCampaignCollectionProducts(admin, collectionId);
    collectionTitle = collection?.title ?? null;
    products = collection?.products ?? [];
  } else if (productIds.length) {
    products = await loadCampaignProductsByIds(admin, productIds);
  }

  const code = formText(formData, "discountCode", 40);
  const value = formText(formData, "discountValue", 20);
  const percentage = formText(formData, "discountType", 20) !== "fixed";
  const startDay = isoDay(formText(formData, "startAt", 40));
  const endDay = isoDay(formText(formData, "endAt", 40));

  const lines: string[] = [];
  if (prompt) lines.push(`What the merchant wants this email to do: ${prompt}`);
  if (products.length) {
    const titles = products.map(({ title }) => `"${title}"`).join(", ");
    lines.push(
      collectionTitle
        ? `Feature the "${collectionTitle}" collection through its real products: ${titles}.`
        : `Feature these real products: ${titles}.`,
    );
  }
  if (formText(formData, "discountMethod", 10) === "code" && code && value) {
    const amount = percentage ? `${value}%` : `${value} (store currency)`;
    const window = startDay && endDay ? ` Valid ${startDay} through ${endDay}.` : "";
    lines.push(`Real discount to show: code "${code}" for ${amount} off.${window}`);
  }
  return { products, direction: lines.length ? lines.join("\n") : null };
}

function toEvidenceProduct(product: CampaignCatalogProduct) {
  return {
    id: product.id,
    title: product.title,
    description: product.description ?? "",
    productType: product.productType ?? "",
    vendor: "",
    tags: [],
    imageUrl: product.imageUrl,
    productUrl: product.productUrl,
    price: product.price || null,
  };
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
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

  const intent = formData.get("intent");
  if (intent === "discard") {
    regenerateDrafts.delete(jobKey);
    return data<RegenerateActionResult>({ ok: true, recipeId, status: "discarded" });
  }
  if (intent === "save") return saveDraft(session.shop, recipeId, jobKey);

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

  let brief: RegenerateBrief;
  try {
    brief = await readRegenerateBrief(formData, admin);
  } catch {
    return data<RegenerateActionResult>(
      {
        ok: false,
        recipeId,
        status: "error",
        error: "Nomi could not load the products you picked. Try again.",
      },
      { status: 400 },
    );
  }

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

  const allowance = await checkAllowance(session.shop, "email_regenerate");
  if (!allowance.allowed)
    return data<RegenerateActionResult>(
      { ok: false, recipeId, status: "error", error: allowance.message ?? "Your plan's regenerates are used up." },
      { status: 400 },
    );

  regenerateJobs.set(jobKey, { status: "pending", startedAt: Date.now() });
  const jobPromise = runRegenerateJob({
    shop: session.shop,
    recipeId,
    admin,
    brief,
    approved,
    jobKey,
  }).finally(() => inFlightRegenerateJobs.delete(jobKey));
  inFlightRegenerateJobs.set(jobKey, jobPromise);
  void jobPromise;

  return data<RegenerateActionResult>({ ok: true, recipeId, status: "pending" });
};

async function saveDraft(
  shop: string,
  recipeId: (typeof BRAND_STUDIO_LIFECYCLE_IDS)[number],
  jobKey: string,
) {
  const draft = regenerateDrafts.get(jobKey);
  if (!draft || Date.now() - draft.createdAt > REGENERATE_DRAFT_TTL_MS) {
    regenerateDrafts.delete(jobKey);
    return data<RegenerateActionResult>(
      {
        ok: false,
        recipeId,
        status: "error",
        error: "This new version expired before it was saved. Regenerate it again.",
      },
      { status: 400 },
    );
  }
  // Re-read the family so a save never overwrites edits made to the other
  // 12 emails while this one was generating.
  const profile = await db.brandStudioProfile.findUnique({ where: { shop } });
  const approved = getApprovedBrandStudioFamily(profile);
  if (!approved)
    return data<RegenerateActionResult>(
      {
        ok: false,
        recipeId,
        status: "error",
        error: "Your email family changed in Brand Studio. Regenerate this email again.",
      },
      { status: 400 },
    );
  await db.brandStudioProfile.update({
    where: { shop },
    data: {
      renderedEmails: JSON.stringify({
        ...approved.renderedEmails,
        [recipeId]: draft.html,
      }),
    },
  });
  regenerateDrafts.delete(jobKey);
  return data<RegenerateActionResult>({ ok: true, recipeId, status: "saved", html: draft.html });
}

async function runRegenerateJob(input: {
  shop: string;
  recipeId: (typeof BRAND_STUDIO_LIFECYCLE_IDS)[number];
  admin: GraphqlAdmin;
  brief: RegenerateBrief;
  approved: NonNullable<ReturnType<typeof getApprovedBrandStudioFamily>>;
  jobKey: string;
}) {
  const { shop, recipeId, admin, brief, approved, jobKey } = input;
  try {
    // The merchant's picked products join the evidence for this one call, so
    // their real photos and product pages pass validation, and become the
    // target recipe's required products. Stored evidence is untouched.
    const featuredIds = brief.products.map(({ id }) => id);
    const evidence = featuredIds.length
      ? {
          ...approved.evidence,
          products: [
            ...brief.products.map(toEvidenceProduct),
            ...approved.evidence.products.filter(({ id }) => !featuredIds.includes(id)),
          ],
        }
      : approved.evidence;
    const recipes = featuredIds.length
      ? approved.recipes.map((recipe) =>
          recipe.id === recipeId ? { ...recipe, productIds: featuredIds } : recipe,
        )
      : approved.recipes;
    // Built by the campaign engine like every Brand Studio email; siblings
    // come back exactly as stored.
    const settings = await db.shopSettings.findUnique({ where: { shop } });
    const creative = await generateLifecycleEmailsWithCampaignEngine({
      admin,
      evidence,
      brandSystem: approved.brandSystem,
      recipes,
      ...lifecycleLanguageAndTone(settings),
      existingRendered: approved.renderedEmails,
      onlyId: recipeId,
      ...(brief.direction ? { merchantDirection: brief.direction } : {}),
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
    const targetRecipe = recipes.find(({ id }) => id === recipeId)!;
    const targetQuality = auditCompiledEmail({
      html: creative.value[recipeId],
      recipe: targetRecipe,
      brandSystem: approved.brandSystem,
      products: evidence.products,
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

    // The spend is recorded now; the email itself waits as a draft until the
    // merchant presses Save in the Flow Editor (intent=save below).
    await db.brandStudioProfile.update({
      where: { shop },
      data: {
        anthropicInputTokens: { increment: creative.usage.inputTokens },
        anthropicOutputTokens: { increment: creative.usage.outputTokens },
        estimatedCostMicros: { increment: creative.costMicros },
        currentBuildCostMicros: { increment: creative.costMicros },
      },
    });

    // A finished version uses up one regenerate whether or not it's saved.
    await recordUsage(shop, "email_regenerate");
    regenerateDrafts.set(jobKey, {
      html: creative.value[recipeId],
      createdAt: Date.now(),
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
