// Brand Studio's lifecycle emails, built by the exact pipeline campaigns use:
// the campaign creative director plans each email (sections, order, photos),
// the image model renders its photos in parallel, and the campaign designer
// (generate-newsletter-email.ts) writes it — one email per call, never a
// batch. Merchants judged campaign output far stronger than the old
// batch-per-flow writer, so every Brand Studio surface (first build,
// Regenerate all, single regenerate) now goes through here.
//
// What makes it a lifecycle email rather than a campaign is the brief: the
// flow, the email's job in it, the approved creative brief and copy, and the
// Brand Studio requirements (quality gate, personal slots for cart/review).
// Each finished email is checked against the same gate the routes enforce
// (auditCompiledEmail) and rewritten once with the exact problems if it fails.
import { LIFECYCLE_FLOWS } from "../dashboard/lifecycle-flow-catalog";
import type { GraphqlAdmin } from "../dashboard/campaign-catalog.server";
import { IMAGE_RENDER_MICROS, renderReviewedPhoto } from "../dashboard/generated-photo.server";
import {
  finalizeSections,
  planCampaignCreative,
  type CampaignImageBrief,
  type CampaignPlanInput,
} from "../email-engine/campaign-creative-plan";
import { generateNewsletterEmail } from "../email-engine/generate-newsletter-email";
import {
  generatedPhotoPlaceholder,
  resolveGeneratedPhotoPlaceholders,
} from "../email-engine/generated-photo-slots";
import { imageDimensions, isImageGenerationConfigured } from "../email-engine/image-generation";
import { lifecycleEmailRole } from "../email-engine/lifecycle-email-roles";
import { hardenMobileBoxSizing } from "../email-engine/mobile-box-sizing";
import { needsPersonalSlots, personalSlotProblems } from "../email-engine/personal-slots";
import {
  EMAIL_LANGUAGES,
  EMAIL_TONES,
  type EmailBrandIdentity,
  type EmailLanguage,
  type EmailTone,
  type NewsletterGeneratedImage,
  type NewsletterProduct,
} from "../email-engine/types";
import { estimateUsageMicros, type AiUsage } from "./budget.server";
import { auditCompiledEmail } from "./email-quality";
import type { BrandEvidence, BrandSystem, LifecycleRecipe } from "./types";

// Emails built at once. Each one is a planner call, a writer call, and up to
// a few photo renders, so this bounds concurrent API load while keeping a
// 13-email family to a few minutes.
const CONCURRENCY = 5;

// The campaign writer doesn't report token usage, so its spend is estimated
// (a long art-directed email at medium effort) for the build's cost record.
const WRITER_USAGE_ESTIMATE = { inputTokens: 14_000, outputTokens: 14_000 };

export type LifecycleEngineInput = {
  admin: GraphqlAdmin;
  evidence: BrandEvidence;
  brandSystem: BrandSystem;
  recipes: LifecycleRecipe[];
  language: EmailLanguage;
  tone: EmailTone;
  /** Emails already done; kept as-is and not rebuilt. */
  existingRendered?: Record<string, string>;
  /** Build only this email (single regenerate). */
  onlyId?: LifecycleRecipe["id"];
  /** The merchant's own brief for onlyId (Flow Editor regenerate modal). */
  merchantDirection?: string;
  onCheckpoint?: (checkpoint: {
    rendered: Record<string, string>;
    flowId: string;
    flowComplete: boolean;
    usage: AiUsage;
    costMicros: number;
  }) => Promise<void>;
};

export type LifecycleEngineResult = {
  value: Record<string, string>;
  usage: AiUsage;
  costMicros: number;
};

/** The shop's email language and tone. Emails are English only for now (2026-10-01). */
export function lifecycleLanguageAndTone(
  settings: { language?: string | null; tone?: string | null } | null,
): { language: EmailLanguage; tone: EmailTone } {
  return {
    language: "en",
    tone: EMAIL_TONES.find(({ code }) => code === settings?.tone)?.code ?? "warm-plain",
  };
}

type Spend = { inputTokens: number; outputTokens: number; photoMicros: number };

function spendMicros(spend: Spend) {
  return (
    estimateUsageMicros({ provider: "anthropic", inputTokens: spend.inputTokens, outputTokens: spend.outputTokens }) +
    spend.photoMicros
  );
}

function toNewsletterProduct(product: BrandEvidence["products"][number]): NewsletterProduct {
  return {
    id: product.id,
    title: product.title,
    price: product.price ?? "",
    // The store's exact image URL: the quality gate matches product photos
    // against it, so it is never resized or rewritten here.
    imageUrl: product.imageUrl,
    productUrl: product.productUrl,
    cutoutImageUrl: null,
    productType: product.productType || null,
    description: product.description || null,
  };
}

// The products an email is built around. Welcome-1 and the cart/review
// emails always get a real photographed product (a hero for the first
// impression, the preview item row for the others).
function emailProducts(recipe: LifecycleRecipe, evidence: BrandEvidence): BrandEvidence["products"] {
  const chosen = recipe.productIds
    .map((id) => evidence.products.find((product) => product.id === id))
    .filter((product): product is BrandEvidence["products"][number] => Boolean(product));
  // Cart and review emails show one preview item row; the sender replaces
  // it with the customer's own items, so a second product has nowhere to go.
  if (needsPersonalSlots(recipe.id)) {
    const preview = chosen.find(({ imageUrl }) => imageUrl) ?? evidence.products.find(({ imageUrl }) => imageUrl);
    return preview ? [preview] : [];
  }
  if (chosen.length) return chosen;
  if (recipe.id === "welcome-1") {
    const hero = evidence.products.find(({ imageUrl }) => imageUrl);
    return hero ? [hero] : [];
  }
  return [];
}

const PERSONAL_SLOT_BRIEF = `This email is sent to each customer with their own items filled in by code, so it must carry this exact markup: show the items in one container with data-nomi-slot="items" holding exactly one item row with data-nomi-item (a single preview row, never a second copy; the sender repeats it per item), filled with the supplied product. Inside that row: exactly one <img data-nomi-field="image"> of the product, exactly one element with data-nomi-field="title" holding only its name, an element with data-nomi-field="price" holding only its price, an empty element with data-nomi-field="quantity", and the photo wrapped in <a data-nomi-field="item-url"> linking to the product URL. The row must look right with one item and with several stacked. Give the primary call-to-action <a> data-nomi-field="action-url" and link it to the storefront URL; the sender replaces it with the customer's own link.`;

export function lifecycleBrief(input: {
  recipe: LifecycleRecipe;
  shopName: string;
  brandSystem: BrandSystem;
  products: BrandEvidence["products"];
  storefrontUrl: string | null;
  merchantDirection?: string;
}): string {
  const { recipe, brandSystem } = input;
  const flow = LIFECYCLE_FLOWS.find(({ templateIds }) => templateIds.includes(recipe.id));
  const position = flow ? flow.templateIds.indexOf(recipe.id) + 1 : 1;
  const destination = input.products.find(({ productUrl }) => productUrl)?.productUrl ?? input.storefrontUrl;
  const lines = [
    `This is not a one-off campaign. It is email ${position} of ${flow?.templateIds.length ?? 1} in ${input.shopName}'s "${flow?.name ?? recipe.id}" lifecycle flow (${flow?.purpose ?? "lifecycle"}), sent automatically to each customer when that moment happens, for as long as the flow runs.`,
    `Its job in the flow: ${lifecycleEmailRole(recipe.id)}`,
    `Art direction from the brand's creative director: ${recipe.creativeBrief}`,
    `Approved copy to build from (keep its meaning and voice; refine line breaks and supporting lines freely): eyebrow "${recipe.eyebrow}"; headline "${recipe.headline}"; body "${recipe.body}"; call to action "${recipe.ctaLabel}".`,
  ];
  if (input.merchantDirection) {
    lines.push(`The merchant's own direction for this email, which takes precedence over the art direction above for what it says and features:\n${input.merchantDirection}`);
  }
  if (recipe.id.startsWith("welcome-")) {
    lines.push("It is part of the brand's first impression: open with a genuine visual moment near the top — a photograph at hero scale, never a thumbnail.");
  }
  if (needsPersonalSlots(recipe.id)) lines.push(PERSONAL_SLOT_BRIEF);
  lines.push(
    `Requirements: a complete document starting with <!doctype html>, with <meta name="viewport" content="width=device-width, initial-scale=1"> in the head and the layout inside a max-width:600px table. Exactly one <h1> (the headline). Use the brand's exact hex colors, including paper ${brandSystem.palette.paper} and ink ${brandSystem.palette.ink} plus primary ${brandSystem.palette.primary} or accent ${brandSystem.palette.accent}. Use every supplied product photo at its exact supplied URL.${destination ? ` The primary call to action links to ${destination}.` : ""} Never mention a discount, offer, or deadline unless this brief gives one.`,
  );
  return lines.join("\n\n");
}

function brandIdentityFor(input: LifecycleEngineInput, recipe: LifecycleRecipe): EmailBrandIdentity {
  return {
    system: input.brandSystem,
    logoUrl: input.evidence.assets?.logoUrl ?? null,
    referenceRecipe: {
      subject: recipe.subject,
      preheader: recipe.preheader,
      eyebrow: recipe.eyebrow,
      headline: recipe.headline,
      body: recipe.body,
      ctaLabel: recipe.ctaLabel,
      creativeBrief: recipe.creativeBrief,
    },
  };
}

// Everything that would fail the route's quality gate, plus the slot markup
// the send worker needs, as plain sentences for a rewrite.
function emailProblems(html: string, recipe: LifecycleRecipe, input: LifecycleEngineInput, products: BrandEvidence["products"]) {
  const audit = auditCompiledEmail({
    html,
    recipe: { ...recipe, productIds: products.map(({ id }) => id) },
    brandSystem: input.brandSystem,
    products: input.evidence.products,
    storefrontUrl: input.evidence.storefrontUrl,
  });
  return [
    ...audit.issues.filter(({ severity }) => severity === "error").map(({ message }) => message),
    ...(needsPersonalSlots(recipe.id) ? personalSlotProblems(html).map((problem) => `Personal slots: ${problem}.`) : []),
  ];
}

async function buildLifecycleEmail(
  input: LifecycleEngineInput,
  recipe: LifecycleRecipe,
  spend: Spend,
): Promise<string> {
  const shopName = input.evidence.shopName;
  const products = emailProducts(recipe, input.evidence);
  const newsletterProducts = products.map(toNewsletterProduct);
  const storefrontUrl = input.evidence.storefrontUrl;
  const prompt = lifecycleBrief({
    recipe,
    shopName,
    brandSystem: input.brandSystem,
    products,
    storefrontUrl,
    merchantDirection: recipe.id === input.onlyId ? input.merchantDirection : undefined,
  });
  const brandIdentity = brandIdentityFor(input, recipe);
  const planInput: CampaignPlanInput = {
    shopName,
    prompt,
    products: newsletterProducts,
    collections: [],
    storefrontUrl,
    hasDiscountCode: /discount/i.test(input.merchantDirection ?? "") && recipe.id === input.onlyId,
    brandIdentity,
  };

  let concept: string | null = null;
  let sections: ReturnType<typeof finalizeSections> = [];
  let briefs: CampaignImageBrief[] = [];
  try {
    const plan = await planCampaignCreative(planInput);
    spend.inputTokens += plan.usage.inputTokens;
    spend.outputTokens += plan.usage.outputTokens;
    briefs = isImageGenerationConfigured() ? plan.images : [];
    sections = finalizeSections(plan.sections, {
      availableImages: new Map(briefs.map((image) => [image.key, image])),
      hasCollections: false,
      hasDiscountCode: planInput.hasDiscountCode,
    });
    concept = plan.concept || null;
  } catch (error) {
    console.error(`Brand Studio ${recipe.id} planning failed:`, error);
  }
  const placed = new Set(sections.map((section) => section.imageKey).filter(Boolean));
  const toRender = briefs.filter((image) => placed.has(image.key));
  const stamp = Date.now();
  const photos = Promise.all(
    toRender.map(async (image, index) => {
      const result = await renderReviewedPhoto(input.admin, {
        brief: image,
        shopName,
        products: newsletterProducts,
        filename: `nomi-${recipe.id}-${stamp}-${index + 1}-${image.role}.jpg`,
      });
      spend.photoMicros += result.renders * IMAGE_RENDER_MICROS;
      spend.inputTokens += result.reviewUsage.inputTokens;
      spend.outputTokens += result.reviewUsage.outputTokens;
      return [image.key, result.url] as const;
    }),
  ).then((entries) => new Map(entries));
  const generatedImages: NewsletterGeneratedImage[] = toRender.map((image) => ({
    key: image.key,
    url: generatedPhotoPlaceholder(image.key),
    alt: image.alt,
    role: image.role,
    ...imageDimensions(image.aspect),
    productIds: image.productIds,
  }));

  const write = async (brief: string, images: NewsletterGeneratedImage[]) => {
    const html = await generateNewsletterEmail({
      shopName,
      language: input.language,
      tone: input.tone,
      prompt: brief,
      products: newsletterProducts,
      generatedImages: images,
      concept,
      sections,
      collections: [],
      storefrontUrl,
      brandIdentity,
    });
    spend.inputTokens += WRITER_USAGE_ESTIMATE.inputTokens;
    spend.outputTokens += WRITER_USAGE_ESTIMATE.outputTokens;
    return html;
  };

  const draft = await write(prompt, generatedImages);
  const rendered = await photos;
  let html = resolveGeneratedPhotoPlaceholders(draft, rendered).html;

  const problems = emailProblems(html, recipe, input, products);
  if (problems.length) {
    console.info(`Brand Studio ${recipe.id} failed checks, rewriting once: ${problems.join(" ")}`);
    const hostedImages = generatedImages
      .map((image) => ({ ...image, url: rendered.get(image.key) ?? "" }))
      .filter(({ url }) => url);
    const retry = await write(
      `${prompt}\n\nA previous version of this email failed these checks. Build it again and make sure every one is fixed:\n- ${problems.join("\n- ")}`,
      hostedImages,
    );
    const retryProblems = emailProblems(retry, recipe, input, products);
    if (retryProblems.length <= problems.length) html = retry;
  }
  return hardenMobileBoxSizing(html);
}

async function runPool<T>(items: T[], limit: number, work: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(limit, queue.length) }, async () => {
      while (queue.length) await work(queue.shift() as T);
    }),
  );
}

export async function generateLifecycleEmailsWithCampaignEngine(
  input: LifecycleEngineInput,
): Promise<LifecycleEngineResult> {
  const rendered: Record<string, string> = { ...(input.existingRendered ?? {}) };
  const targets = input.onlyId
    ? input.recipes.filter(({ id }) => id === input.onlyId)
    : input.recipes.filter(({ id }) => !rendered[id]);
  if (input.onlyId) delete rendered[input.onlyId];

  const total: Spend = { inputTokens: 0, outputTokens: 0, photoMicros: 0 };
  const pendingByFlow = new Map(
    LIFECYCLE_FLOWS.map((flow) => [flow.id, flow.templateIds.filter((id) => targets.some((recipe) => recipe.id === id))]),
  );
  const failures: string[] = [];

  await runPool(targets, CONCURRENCY, async (recipe) => {
    const spend: Spend = { inputTokens: 0, outputTokens: 0, photoMicros: 0 };
    try {
      rendered[recipe.id] = await buildLifecycleEmail(input, recipe, spend);
    } catch (error) {
      failures.push(`${recipe.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
    total.inputTokens += spend.inputTokens;
    total.outputTokens += spend.outputTokens;
    total.photoMicros += spend.photoMicros;
    const flow = LIFECYCLE_FLOWS.find(({ templateIds }) => templateIds.includes(recipe.id));
    if (!flow || !input.onCheckpoint) return;
    const remaining = (pendingByFlow.get(flow.id) ?? []).filter((id) => id !== recipe.id);
    pendingByFlow.set(flow.id, remaining);
    await input.onCheckpoint({
      rendered: { ...rendered },
      flowId: flow.id,
      flowComplete: remaining.length === 0,
      usage: { provider: "anthropic", inputTokens: spend.inputTokens, outputTokens: spend.outputTokens },
      costMicros: spendMicros(spend),
    });
  });

  if (failures.length) {
    throw new Error(`Nomi could not build ${failures.length === 1 ? "one email" : `${failures.length} emails`} (${failures.map((failure) => failure.split(":")[0]).join(", ")}). ${failures[0].split(": ").slice(1).join(": ")}`);
  }
  // Spend already reported through checkpoints isn't returned again, so a
  // route that records both never counts it twice.
  if (input.onCheckpoint) {
    return { value: rendered, usage: { provider: "anthropic", inputTokens: 0, outputTokens: 0 }, costMicros: 0 };
  }
  return {
    value: rendered,
    usage: { provider: "anthropic", inputTokens: total.inputTokens, outputTokens: total.outputTokens },
    costMicros: spendMicros(total),
  };
}
