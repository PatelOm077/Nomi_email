import { z } from "zod";
import { LIFECYCLE_FLOWS } from "../dashboard/lifecycle-flow-catalog";
import type { GraphqlAdmin } from "../dashboard/campaign-catalog.server";
import { IMAGE_RENDER_MICROS, renderReviewedPhoto } from "../dashboard/generated-photo.server";
import { imageDimensions, isImageGenerationConfigured } from "../email-engine/image-generation";
import { finalizeSections } from "../email-engine/campaign-creative-plan";
import { lifecycleEmailRole } from "../email-engine/lifecycle-email-roles";
import {
  planLifecyclePhotoKit,
  type LifecycleEmailPlan,
} from "../email-engine/lifecycle-photo-kit-plan";
import type { NewsletterProduct } from "../email-engine/types";
import { estimateUsageMicros } from "./budget.server";
import type { BrandEvidence, BrandSystem, LifecycleRecipe } from "./types";

// The brand photo kit: a few AI photographs made once per Brand Studio build
// and reused by every lifecycle email and every regenerate. The photo
// director (email-engine/lifecycle-photo-kit-plan.ts) decides how many and
// which emails use each; every photo is reviewed before it's kept. Stored as
// JSON on BrandStudioProfile.photoKit. Best-effort end to end: no
// OPENAI_API_KEY, a planning error, or a failed render just means fewer (or
// no) photos — the family builds exactly as it did before photos existed.

const kitPhotoSchema = z.object({
  key: z.string(),
  role: z.string(),
  url: z.string().url(),
  alt: z.string(),
  width: z.number(),
  height: z.number(),
  productIds: z.array(z.string()),
  emailIds: z.array(z.string()),
});

export type BrandKitPhoto = z.infer<typeof kitPhotoSchema>;
export type BrandEmailPlans = Record<string, LifecycleEmailPlan>;

const emailPlansSchema = z.record(
  z.string(),
  z.object({
    concept: z.string(),
    sections: z.array(
      z.object({
        type: z.string(),
        purpose: z.string(),
        productIds: z.array(z.string()),
        imageKey: z.string().nullable(),
      }),
    ),
  }),
);

export function parseEmailPlans(json: string | null | undefined): BrandEmailPlans {
  try {
    const parsed = emailPlansSchema.safeParse(JSON.parse(json ?? "{}"));
    return parsed.success ? (parsed.data as BrandEmailPlans) : {};
  } catch {
    return {};
  }
}

export function parsePhotoKit(json: string | null | undefined): BrandKitPhoto[] {
  try {
    const parsed = z.array(kitPhotoSchema).safeParse(JSON.parse(json ?? "[]"));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

// Worst case per photo: two renders (one retry) plus two reviews.
const WORST_CASE_PHOTO_MICROS = IMAGE_RENDER_MICROS * 2 + 30_000;
// High-side estimate of the family plan itself (13 section plans + briefs).
const PLAN_RESERVE_MICROS = 250_000;

export async function buildBrandPhotoKit(input: {
  admin: GraphqlAdmin;
  evidence: BrandEvidence;
  brandSystem: BrandSystem;
  recipes: LifecycleRecipe[];
  // What the kit may spend at most, already net of the caller's other
  // reservations under the $3 cap.
  budgetMicros: number;
}): Promise<{
  photos: BrandKitPhoto[];
  // Empty when planning failed or photos are off: the writer then composes
  // from each creative brief exactly as before.
  emailPlans: BrandEmailPlans;
  costMicros: number;
  anthropicUsage: { inputTokens: number; outputTokens: number };
}> {
  const anthropicUsage = { inputTokens: 0, outputTokens: 0 };
  // Section plans are worth having even with photos off or no room for a
  // render; only a budget too thin for the plan itself skips planning.
  if (input.budgetMicros < PLAN_RESERVE_MICROS) {
    return { photos: [], emailPlans: {}, costMicros: 0, anthropicUsage };
  }

  const flowById = new Map(
    LIFECYCLE_FLOWS.flatMap((flow) => flow.templateIds.map((id) => [id, flow] as const)),
  );
  let plan: Awaited<ReturnType<typeof planLifecyclePhotoKit>>;
  try {
    plan = await planLifecyclePhotoKit({
      shopName: input.evidence.shopName,
      brandSummary: JSON.stringify({ ...input.brandSystem, name: undefined, directionId: undefined }),
      products: input.evidence.products.map((product) => ({
        id: product.id,
        title: product.title,
        productType: product.productType || null,
        description: product.description || null,
        imageUrl: product.imageUrl,
      })),
      emails: input.recipes.map((recipe) => ({
        id: recipe.id,
        flow: flowById.get(recipe.id)?.name ?? recipe.id,
        flowPurpose: flowById.get(recipe.id)?.purpose ?? "",
        role: lifecycleEmailRole(recipe.id),
        creativeBrief: recipe.creativeBrief,
        productIds: recipe.productIds,
      })),
    });
  } catch (error) {
    console.error("Brand photo kit planning failed:", error);
    return { photos: [], emailPlans: {}, costMicros: 0, anthropicUsage };
  }
  anthropicUsage.inputTokens += plan.usage.inputTokens;
  anthropicUsage.outputTokens += plan.usage.outputTokens;
  const plannerMicros = estimateUsageMicros({ provider: "anthropic", ...plan.usage });

  // The director decides the count; this only keeps a render from pushing the
  // build past the $3 cap.
  const affordable = isImageGenerationConfigured()
    ? Math.max(0, Math.floor((input.budgetMicros - plannerMicros) / WORST_CASE_PHOTO_MICROS))
    : 0;
  const briefs = plan.photos.slice(0, affordable);
  console.info(
    `Brand photo kit plan: ${plan.photos.length} photo(s)` +
      `${briefs.length < plan.photos.length ? `, ${briefs.length} within budget` : ""}. ${plan.reasoning}`,
  );

  const products: NewsletterProduct[] = input.evidence.products.map((product) => ({
    id: product.id,
    title: product.title,
    price: product.price ?? "",
    imageUrl: product.imageUrl,
    productUrl: product.productUrl,
    cutoutImageUrl: null,
    productType: product.productType || null,
    description: product.description || null,
  }));
  const stamp = Date.now();
  const results = await Promise.all(
    briefs.map(async (brief, index) => ({
      brief,
      result: await renderReviewedPhoto(input.admin, {
        brief,
        shopName: input.evidence.shopName,
        products,
        filename: `nomi-brand-${stamp}-${index + 1}-${brief.role}.jpg`,
      }),
    })),
  );

  let renders = 0;
  const photos: BrandKitPhoto[] = [];
  for (const { brief, result } of results) {
    renders += result.renders;
    anthropicUsage.inputTokens += result.reviewUsage.inputTokens;
    anthropicUsage.outputTokens += result.reviewUsage.outputTokens;
    if (!result.url) continue;
    photos.push({
      key: brief.key,
      role: brief.role,
      url: result.url,
      alt: brief.alt,
      ...imageDimensions(brief.aspect),
      productIds: brief.productIds,
      emailIds: brief.emailIds,
    });
  }
  // Rebuild every plan against the photos that actually survived: a hero
  // whose photo failed becomes a typographic hero, photo-only sections drop.
  const available = new Map(photos.map((photo) => [photo.key, photo]));
  const emailPlans: BrandEmailPlans = Object.fromEntries(
    Object.entries(plan.emailPlans).map(([id, emailPlan]) => [
      id,
      {
        concept: emailPlan.concept,
        sections: finalizeSections(emailPlan.sections, {
          availableImages: available as never,
          hasCollections: false,
          hasDiscountCode: false,
        }),
      },
    ]),
  );
  for (const photo of photos) {
    photo.emailIds = Object.entries(emailPlans)
      .filter(([, emailPlan]) => emailPlan.sections.some(({ imageKey }) => imageKey === photo.key))
      .map(([id]) => id);
  }
  const costMicros =
    estimateUsageMicros({ provider: "anthropic", ...anthropicUsage }) + renders * IMAGE_RENDER_MICROS;
  console.info(
    `Brand photo kit: ${photos.length} of ${briefs.length} photo(s) kept, ${renders} render(s), ` +
      `about $${(costMicros / 1_000_000).toFixed(2)}.`,
  );
  return { photos, emailPlans, costMicros, anthropicUsage };
}
