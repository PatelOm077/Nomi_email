import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { getAnthropicClient } from "../email-engine/anthropic-client";
import {
  buildLifecycleSlots,
  LIFECYCLE_FLOWS,
} from "../dashboard/lifecycle-flow-catalog";
import {
  brandSnapshotSchema,
  brandSystemSchema,
  BRAND_STUDIO_LIFECYCLE_IDS,
  creativeDirectionsSchema,
  lifecycleRecipesSchema,
  type BrandEvidence,
  type BrandSnapshot,
  type BrandSystem,
  type CreativeDirection,
  type LifecycleRecipe,
} from "./types";
import { estimateUsageMicros, type AiUsage } from "./budget.server";
import { auditCompiledEmail } from "./email-quality";
import type { BrandEmailPlans, BrandKitPhoto } from "./photo-kit.server";
import { LIFECYCLE_SECTION_TYPES, sectionBuildLibrary } from "../email-engine/section-library";
import { LIFECYCLE_EMAIL_ROLES } from "../email-engine/lifecycle-email-roles";
import { hardenMobileBoxSizing } from "../email-engine/mobile-box-sizing";
import { needsPersonalSlots, personalSlotProblems } from "../email-engine/personal-slots";

type ModelResult<T> = { value: T; usage: AiUsage; costMicros: number };

const requestedLongOutputTokens = Number(
  process.env.ANTHROPIC_BRAND_MAX_TOKENS ?? 128_000,
);
const LONG_OUTPUT_MAX_TOKENS = Number.isFinite(requestedLongOutputTokens)
  ? Math.min(128_000, Math.max(24_000, requestedLongOutputTokens))
  : 128_000;
const EMAIL_RENDER_EFFORT =
  process.env.ANTHROPIC_EMAIL_RENDER_EFFORT === "high" ? "high" : "medium";

export class MeteredAiError extends Error {
  usage: AiUsage;
  costMicros: number;

  constructor(message: string, usage: AiUsage) {
    super(message);
    this.name = "MeteredAiError";
    this.usage = usage;
    this.costMicros = estimateUsageMicros(usage);
  }
}

type OpenAIResponse = {
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  usage?: { input_tokens?: number; output_tokens?: number };
};

function outputText(response: OpenAIResponse) {
  return response.output
    ?.flatMap(({ content }) => content ?? [])
    .find(({ type }) => type === "output_text")?.text;
}

function jsonFromText(text: string | undefined, emptyMessage: string): unknown {
  if (!text) throw new Error(emptyMessage);
  const clean = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  return JSON.parse(clean);
}

const snapshotJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    positioning: { type: "string" },
    audienceSuggestion: { type: "string" },
    feelingSuggestion: { type: "string" },
    evidence: {
      type: "array",
      minItems: 3,
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          label: { type: "string" },
          value: { type: "string" },
          source: {
            type: "string",
            enum: ["storefront", "product", "merchant", "shopify"],
          },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: ["label", "value", "source", "confidence"],
      },
    },
  },
  required: [
    "summary",
    "positioning",
    "audienceSuggestion",
    "feelingSuggestion",
    "evidence",
  ],
} as const;

export async function analyzeBrandWithSol(
  evidence: BrandEvidence,
): Promise<ModelResult<BrandSnapshot>> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OpenAI is not configured for Brand Studio.");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_BRAND_MODEL ?? "gpt-5.6-sol",
      store: false,
      reasoning: { effort: "medium" },
      instructions:
        "You are Nomi's evidence analyst. Describe only what the supplied public storefront and Shopify product evidence supports. Infer one concise main-customer suggestion and one concise brand-feeling suggestion. Never invent sales performance, customer demographics, certifications, materials, discounts, or claims. Write plain merchant-facing English and attach a source and confidence to every evidence item.",
      input: JSON.stringify(evidence),
      max_output_tokens: 2_800,
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "nomi_brand_snapshot",
          strict: true,
          schema: snapshotJsonSchema,
        },
      },
    }),
  });
  if (!response.ok) {
    const requestId = response.headers.get("x-request-id");
    throw new Error(
      `Sol could not analyze this store (${response.status}${requestId ? `, request ${requestId}` : ""}).`,
    );
  }
  const body = (await response.json()) as OpenAIResponse;
  const usage: AiUsage = {
    provider: "openai",
    inputTokens: body.usage?.input_tokens ?? 0,
    outputTokens: body.usage?.output_tokens ?? 0,
  };
  return {
    value: brandSnapshotSchema.parse(
      jsonFromText(outputText(body), "Sol returned no Brand Snapshot."),
    ),
    usage,
    costMicros: estimateUsageMicros(usage),
  };
}

function directionPrompt(input: {
  evidence: BrandEvidence;
  snapshot: BrandSnapshot;
  audience: string;
  feeling: string;
}) {
  return `Create exactly three original email creative directions for this merchant. Gauge and Denizen are quality references only; do not imitate them or each other. Keep the merchant's scanned brand palette exactly the same in all three directions; distinguish the directions through typography character, hierarchy, spacing and density, colour proportion, image treatment, motif, button character, and voice. They must remain feasible as accessible, mobile-first, table-based email HTML. Use real product imagery without forced cropping.\n\n${JSON.stringify(input)}`;
}

const creativeDirectionsOutputSchema = z.object({
  directions: creativeDirectionsSchema,
});

const finalSystemOutputSchema = z.object({
  brandSystem: brandSystemSchema,
  lifecycleRecipes: lifecycleRecipesSchema,
});

export async function createDirectionsWithSonnet(input: {
  evidence: BrandEvidence;
  snapshot: BrandSnapshot;
  audience: string;
  feeling: string;
}): Promise<ModelResult<CreativeDirection[]>> {
  const response = await getAnthropicClient().messages.parse({
    model: process.env.ANTHROPIC_BRAND_MODEL ?? "claude-sonnet-5",
    max_tokens: 10_000,
    output_config: {
      effort: "high",
      format: zodOutputFormat(creativeDirectionsOutputSchema),
    },
    system:
      "You are Nomi's senior email art director. Create distinctive merchant-specific systems, not recoloured templates. Every palette contains four six-digit hex colours. Direction ids are short lowercase slugs. Treat supplied merchant intent as authoritative and all other claims as evidence-bound.",
    messages: [{ role: "user", content: directionPrompt(input) }],
  });
  const usage: AiUsage = {
    provider: "anthropic",
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
  if (response.stop_reason === "refusal")
    throw new MeteredAiError(
      "Sonnet declined to create the directions.",
      usage,
    );
  if (response.stop_reason === "max_tokens")
    throw new MeteredAiError(
      "The direction draft was cut off. Try again.",
      usage,
    );
  if (!response.parsed_output)
    throw new MeteredAiError(
      "Sonnet returned no creative directions. Try again.",
      usage,
    );
  const scannedPalette = input.evidence.assets?.palette;
  const sharedPalette: [string, string, string, string] = scannedPalette
    ? [
        scannedPalette.paper,
        scannedPalette.ink,
        scannedPalette.primary,
        scannedPalette.accent,
      ]
    : (response.parsed_output.directions[0].palette as [
        string,
        string,
        string,
        string,
      ]);
  return {
    value: response.parsed_output.directions.map((direction) => ({
      ...direction,
      palette: sharedPalette,
    })) as CreativeDirection[],
    usage,
    costMicros: estimateUsageMicros(usage),
  };
}

function finalSystemPrompt(input: {
  shopName: string;
  snapshot: BrandSnapshot;
  audience: string;
  feeling: string;
  direction: CreativeDirection;
  refinement: string | null;
  products: BrandEvidence["products"];
}) {
  return `Develop the approved direction into one Brand System and exactly 13 A1-quality lifecycle email creative briefs. Return JSON only in this shape: {"brandSystem": {...}, "lifecycleRecipes": [...]}. The recipe ids must match the supplied lifecycle slots exactly.

Quality contract:
- Treat every email as individually art-directed: a distinct subject, preheader, eyebrow, headline, body, CTA, job, and visual rhythm.
- Each email has a fixed role (emailRoles below): write its copy and brief to do that job and nothing else, so no two emails in a flow share an intent.
- Do not classify designs into a fixed menu of layouts. Write a free-form creativeBrief for every email that states its visual thesis, hierarchy, image role, pacing, CTA relationship, and the specific ways its silhouette must differ from sibling emails.
- Subjects must be 3–64 characters. Preheaders add a different useful thought. Headlines are complete, specific ideas. Bodies contain at least 16 useful words and earn the send.
- Select exact productIds only when real supplied products strengthen the idea. Marketing and recovery messages with products need a real destination; relationship messages may be image-light when that is the stronger composition. Exception: welcome-1 is the merchant's very first message, and when the store has at least one real product, it must select one as a hero introduction — write the creativeBrief around actually showing that product, not a product-free brand statement. Every welcome email (welcome-1, welcome-2, welcome-3) is the brand's first impression and its brief must call for a genuine visual moment near the top — a brand photograph or a real product at hero scale; never brief an image-free or thumbnail-only welcome email.
- Use the store evidence to invent the art direction, never a generic ecommerce design system. Limited product count is not a reason to repeat a layout: vary scale, sequence, whitespace, crop, grouping, typography, information density, and narrative role.
- Give every lifecycle flow its own visual grammar based on its job. Shared brand colour and type character should create recognition, while welcome, consideration, cart recovery, post-purchase care, and win-back differ clearly in pacing, density, image role, hierarchy, and CTA relationship. Do not encode those differences as a fixed menu of layouts.
- Carry the approved palette, typography character, image treatment, button treatment, motif, preferred vocabulary, and layout rules through the whole family without repeating one gimmick.
- Reach for original email-native visual material often, not only when photography runs short: invented decorative objects and motifs — a stamp, a ribbon, a ticket stub, a wax seal, a compass, a leaf, a folded corner, a simple line-built icon, whatever suits this brand — built from typography, spacing, borders, rules, colour fields, labels, and numbering. These make a composition feel considered instead of a plain photo-and-paragraph block. Do not fall back to a generic product card or pretend an unavailable external asset exists.
- review-request's creativeBrief should call for a decorative star-rating motif (five stars, e.g. a filled/typographic star row) as a visual accent near the headline or product — purely decorative, never framed or positioned as something the recipient can click or fill in, since email HTML cannot make it functional.
- Ban placeholder and generic ecommerce copy, including numbered headlines, “shop now”, “must-have”, “don't miss out”, “hurry”, “considered note”, and repeated body copy.
- Use only supported facts; never invent discounts, scarcity, reviews, URLs, customer attributes, materials, certifications, performance, or product claims. CTA labels name the action but contain no URL.
- Keep post-purchase lifecycle messages calmer than promotional messages.

The result is rejected before persistence if it misses this contract.\n\n${JSON.stringify({ ...input, lifecycleSlots: buildLifecycleSlots(input.shopName), emailRoles: LIFECYCLE_EMAIL_ROLES })}`;
}

export async function finalizeWithSonnet(input: {
  shopName: string;
  snapshot: BrandSnapshot;
  audience: string;
  feeling: string;
  direction: CreativeDirection;
  refinement: string | null;
  products: BrandEvidence["products"];
}): Promise<
  ModelResult<{ brandSystem: BrandSystem; lifecycleRecipes: LifecycleRecipe[] }>
> {
  const requestFinalSystem = () =>
    getAnthropicClient()
      .messages.stream({
        model: process.env.ANTHROPIC_BRAND_MODEL ?? "claude-sonnet-5",
        max_tokens: LONG_OUTPUT_MAX_TOKENS,
        output_config: {
          effort: "high",
          format: zodOutputFormat(finalSystemOutputSchema),
        },
        system:
          "You are Nomi's senior email design director and lifecycle copywriter. Build a portfolio-grade, merchant-specific family whose thirteen emails are each worth opening. Write open art-direction briefs, not template selections, and do not output HTML in this planning pass. Preserve merchant intent, stay evidence-bound, and reject generic ecommerce language. A separate Claude pass authors the finished HTML; you own concept, hierarchy, specificity, pacing, and cross-family variety.",
        messages: [{ role: "user", content: finalSystemPrompt(input) }],
      })
      .finalMessage();
  const response = await requestFinalSystem().catch(() => requestFinalSystem());
  const usage: AiUsage = {
    provider: "anthropic",
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
  if (response.stop_reason === "refusal")
    throw new MeteredAiError(
      "Sonnet declined to build the email system.",
      usage,
    );
  if (response.stop_reason === "max_tokens")
    throw new MeteredAiError("The email system was cut off. Try again.", usage);
  if (!response.parsed_output)
    throw new MeteredAiError(
      "Sonnet returned no email system. Try again.",
      usage,
    );
  const [paper, ink, primary, accent] = input.direction.palette;
  return {
    value: {
      ...response.parsed_output,
      brandSystem: {
        ...response.parsed_output.brandSystem,
        palette: { paper, ink, primary, accent },
      },
    },
    usage,
    costMicros: estimateUsageMicros(usage),
  };
}

const creativeEmailOutputSchema = z.object({
  emails: z
    .array(
      z.object({
        id: z.enum([
          "welcome-1",
          "welcome-2",
          "welcome-3",
          "interest-1",
          "interest-2",
          "cart-1",
          "cart-2",
          "cart-3",
          "thank-you",
          "review-request",
          "winback-1",
          "winback-2",
          "winback-3",
        ]),
        html: z.string().min(500),
      }),
    )
    .min(1)
    .max(3),
});

const familyCritiqueSchema = z.object({
  revisions: z
    .array(
      z.object({
        id: z.enum(BRAND_STUDIO_LIFECYCLE_IDS),
        reason: z.string().trim().min(20).max(1_000),
        instruction: z.string().trim().min(30).max(1_500),
      }),
    )
    .max(3),
});

// Shared verbatim across every prompt that can produce or touch final HTML
// (initial generation, repair, and family-revision) so a merchant's seam
// editor can always find the same handful of hand-editable elements,
// regardless of which pass last wrote a given email. Skipping this in any
// one of those three call sites means emails that pass through it lose
// their seams silently.
const SEAM_TAGGING_INSTRUCTION = `Editable seams: every finished email must mark the handful of elements a merchant can safely hand-edit later, without changing any other rule above. When the composition uses a short eyebrow, kicker, or label line above the headline, wrap its exact text in an element with data-nomi-seam="eyebrow"; omit this seam entirely when there is no such line. Wrap the exact headline text in an element with data-nomi-seam="headline". Wrap the exact body copy text in an element with data-nomi-seam="body". Wrap only the CTA link's visible label text (not the whole button) in an element with data-nomi-seam="cta-label"; omit this seam entirely when there is no CTA. Wrap the exact footer/compliance copy text (the plain-text sign-off, address, and unsubscribe mention) in a single element with data-nomi-seam="footer". On every <img>: add data-nomi-seam="logo" to the brand logo image; add data-nomi-seam="product" plus data-nomi-product-id="<the exact product id>" to a requiredProductImages photo, and add that same data-nomi-seam="product" data-nomi-product-id="<id>" to its enclosing <a> when the image links to that product, so the photo and its link stay paired; add data-nomi-seam="image" to any other photograph, including every assigned brand photograph. Every other piece of customer-facing copy is editable too: wrap each additional heading, pull line, caption, card line, step or benefit line, and closing line in its own element with data-nomi-seam="text", and give every button other than the primary CTA data-nomi-seam="button" on an element wrapping only its visible label text inside its <a>. Style that copy however the design calls for; a seam simply wraps the line as designed. Never put a text or button seam on the eyebrow, headline, body, CTA label, or footer (they keep their own seams), and never on a price or a product name. Every seam-tagged <img> must also carry explicit width and height attributes matching its rendered size, and a real, specific alt attribute. These attributes are inert metadata: never style them, never let them affect layout, and never omit them from a seam-eligible element.`;

// The welcome flow is the brand's first impression. Merchants judged
// image-free welcomes (typography only, or a lone thumbnail) as the weakest
// emails in the family, so this rule overrides a creative brief that asks
// for one — including briefs saved before this rule existed. Shared by every
// pass that writes or rewrites HTML.
const WELCOME_VISUAL_RULE = `Welcome flow (welcome-1, welcome-2, welcome-3): these are the brand's first impression and must look like it. Each welcome email opens with a genuine visual moment near the top — its assigned brand photograph when it has one, otherwise a real supplied product photo shown at hero scale (at least 280px wide, ideally the full content width). Never shrink a product photo to a thumbnail as an email's main image. Typographic restraint is welcome, an image-free welcome is not: this overrides any creative brief that asks for a welcome email without photography.`;

// The abandoned-cart and review-request emails are sent pre-generated: the
// worker fills the customer's real items and checkout/review link by code
// (email-engine/personal-slots.ts) instead of calling Claude per send. This
// is the markup contract that filler reads; validateCandidateEmails enforces
// it so a miss goes to repair.
const PERSONAL_SLOT_INSTRUCTION = `Personal slots (cart-1, cart-2, cart-3, review-request only): these emails are sent to each customer with their own items filled in by code, so they must carry this exact markup. Show the order or cart items in one container with data-nomi-slot="items" that holds exactly one item row with data-nomi-item — a single preview row, never a second copy; the sender repeats it per item. Fill that preview row with a real supplied product. Inside the row: exactly one <img data-nomi-field="image"> of that product (with its data-nomi-seam="product" and data-nomi-product-id as usual), exactly one element with data-nomi-field="title" holding only its name, an element with data-nomi-field="price" holding only its price (or empty when none is given), an element with data-nomi-field="quantity" left empty, and wrap the photo in <a data-nomi-field="item-url"> pointing at the product URL. The row must look right with one item and with several stacked. Give the email's primary call-to-action <a> data-nomi-field="action-url" and point it at the storefront URL; the sender replaces it with the customer's own checkout or product link. Other emails never use these attributes. The item row is the email's product moment, not the whole composition: design the rest freely.`;

// When the family creative director planned an email
// (email-engine/lifecycle-photo-kit-plan.ts), the writer builds exactly that
// plan with the same section build guide campaigns use.
const SECTION_PLAN_INSTRUCTION = `Section plans: a recipe may carry a sectionPlan (with a concept) from the family creative director. When it does, build exactly those sections, in that order, each fulfilling its stated purpose with the products and photo it names — the plan is the composition, and it takes precedence over any conflicting layout idea in the creative brief (use the brief for voice, mood, and copy). A section's imageKey names one of that recipe's assignedPhotos by key. Build each section as described here, in this brand's palette, typography, and motif, from nested tables, inline styles, borders, background colours, and typography:
${sectionBuildLibrary(LIFECYCLE_SECTION_TYPES)}
Without a sectionPlan, compose freely from the creative brief.`;

export { hardenMobileBoxSizing };

function normalizedUrl(value: string) {
  try {
    return new URL(value.replace(/&amp;/g, "&")).href;
  } catch {
    return null;
  }
}

// welcome-1 is the merchant's very first message and reads as more concrete
// with a real product anchoring it. The planning prompt is told to select
// one whenever the store has any, but a recipe from an older Brand Studio
// build (or one the model still judged product-light) can reach this point
// with an empty productIds — patch it in here at render time so every
// welcome-1 always shows a hero product, not just newly-planned families.
function withWelcomeHeroProduct(
  recipe: LifecycleRecipe,
  evidence: BrandEvidence,
): LifecycleRecipe {
  if (recipe.id !== "welcome-1" || recipe.productIds.length > 0) return recipe;
  // Only a product with a real photo qualifies: the family-audit quality
  // gate requires an <img> for any referenced productId (see
  // email-quality.ts), so forcing in a product with no image would create a
  // requirement the finished HTML can never satisfy.
  const heroProduct = evidence.products.find(({ imageUrl }) => imageUrl);
  if (!heroProduct) return recipe;
  return { ...recipe, productIds: [heroProduct.id] };
}

function requiredProductContract(
  recipe: LifecycleRecipe,
  evidence: BrandEvidence,
) {
  const requestedIds = new Set(recipe.productIds);
  const selectedProducts = evidence.products.filter(({ id }) =>
    requestedIds.has(id),
  );
  return {
    requiredProductImages: selectedProducts.flatMap(
      ({ id, title, imageUrl }) =>
        imageUrl ? [{ id, title, url: imageUrl }] : [],
    ),
    requiredDestinations: [
      ...selectedProducts.flatMap(({ id, title, productUrl }) =>
        productUrl ? [{ id, title, url: productUrl }] : [],
      ),
      ...(evidence.storefrontUrl
        ? [
            {
              id: "storefront",
              title: evidence.shopName,
              url: evidence.storefrontUrl,
            },
          ]
        : []),
    ],
  };
}

function validateCandidateEmails(input: {
  candidates: Array<{ id: LifecycleRecipe["id"]; html: string }>;
  recipes: LifecycleRecipe[];
  evidence: BrandEvidence;
  brandSystem: BrandSystem;
  extraAllowedImageUrls?: string[];
  requirePersonalSlots?: boolean;
}) {
  const valid: Array<{ id: LifecycleRecipe["id"]; html: string }> = [];
  const failed: Array<{
    id: LifecycleRecipe["id"];
    html: string;
    error: string;
  }> = [];
  for (const candidate of input.candidates) {
    const recipe = input.recipes.find(({ id }) => id === candidate.id);
    if (!recipe) continue;
    try {
      // Generation-time only: the seam editor also runs validateCreativeEmail,
      // and an older approved family without slots must stay editable.
      if (input.requirePersonalSlots !== false && needsPersonalSlots(candidate.id)) {
        const slotProblems = personalSlotProblems(candidate.html);
        if (slotProblems.length)
          throw new Error(`${candidate.id} is missing its personal slots: ${slotProblems.join("; ")}.`);
      }
      valid.push({
        id: candidate.id,
        html: validateCreativeEmail({
          html: candidate.html,
          recipe,
          evidence: input.evidence,
          brandSystem: input.brandSystem,
          extraAllowedImageUrls: input.extraAllowedImageUrls,
        }),
      });
    } catch (error) {
      failed.push({
        ...candidate,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { valid, failed };
}

export function validateCreativeEmail(input: {
  html: string;
  recipe: LifecycleRecipe;
  evidence: BrandEvidence;
  brandSystem: BrandSystem;
  /**
   * Extra image/link URLs to treat as store-supplied, beyond what's in
   * `evidence`. Used by the seam editor: a merchant's image/product swap
   * comes from a live Shopify query or upload made in that same request, so
   * it's provably real even though it isn't in the (possibly stale)
   * evidence snapshot recorded when this shop's Brand Studio family was
   * originally built.
   */
  extraAllowedImageUrls?: string[];
  extraAllowedLinkUrls?: string[];
}) {
  const html = input.html
    .trim()
    .replace(/^```(?:html)?\s*/i, "")
    .replace(/\s*```$/i, "");
  const report = auditCompiledEmail({
    html,
    recipe: input.recipe,
    brandSystem: input.brandSystem,
    products: input.evidence.products,
    storefrontUrl: input.evidence.storefrontUrl,
  });
  const errors = report.issues.filter(({ severity }) => severity === "error");
  if (errors.length)
    throw new Error(
      `${input.recipe.id} failed email safety: ${errors.map(({ message }) => message).join(" ")}`,
    );

  const allowedImages = new Set(
    [
      input.evidence.assets?.logoUrl,
      ...input.evidence.products.map(({ imageUrl }) => imageUrl),
      ...(input.extraAllowedImageUrls ?? []),
    ]
      .filter(Boolean)
      .map((url) => normalizedUrl(url as string)),
  );
  const allowedLinks = new Set(
    [
      input.evidence.storefrontUrl,
      ...input.evidence.products.map(({ productUrl }) => productUrl),
      ...(input.extraAllowedLinkUrls ?? []),
    ]
      .filter(Boolean)
      .map((url) => normalizedUrl(url as string)),
  );
  const imageUrls = [
    ...html.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi),
  ].map(([, url]) => normalizedUrl(url));
  const linkUrls = [...html.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["']/gi)].map(
    ([, url]) => normalizedUrl(url),
  );
  if (imageUrls.some((url) => !url || !allowedImages.has(url)))
    throw new Error(
      `${input.recipe.id} used imagery that was not supplied by the store.`,
    );
  if (linkUrls.some((url) => !url || !allowedLinks.has(url)))
    throw new Error(
      `${input.recipe.id} used a destination that was not supplied by the store.`,
    );
  const visibleText = html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:nbsp|amp|lt|gt|quot|#39);/gi, " ");
  if (
    input.evidence.shopName.toLowerCase() !== "nomi" &&
    /\bnomi\b/i.test(visibleText)
  )
    throw new Error(
      `${input.recipe.id} leaked the retired platform name into merchant-facing copy.`,
    );
  return hardenMobileBoxSizing(html);
}

// Concrete, mutually-exclusive structural axes a regenerate can be forced
// onto. Deliberately specific and literal (not "make it feel fresh") because
// the model is otherwise reasoning from the same brand system, direction, and
// creative brief it used last time, and a vague ask for variety reliably
// collapses back to the same default composition. The caller (the regenerate
// route) picks one of these at random, excluding whichever produced
// previousHtml, so the difference is guaranteed by our own code rather than
// left to the model's discretion.
export const REGENERATE_COMPOSITION_DIRECTIVES = [
  "Lead with a large typographic headline before any imagery — no photograph above the fold. Keep product photography small and secondary, introduced only after the headline has made its point.",
  "Lead immediately with a full-bleed product photograph at the top of the email. Keep the headline short and let the image carry the opening impression.",
  "Arrange the main content as a two-column grid (image beside text) instead of one stacked column, for every section that has both a photo and copy.",
  "Break the body copy into short numbered or labeled segments (e.g. a sequence of brief statements) instead of one continuous flowing paragraph.",
  "Place the primary CTA near the top of the email, immediately after the headline, instead of at the bottom after the supporting copy.",
  "Build the email around one dominant, oversized visual element (a single large image or a single large typographic statement) with everything else compressed into a quiet footer band, rather than an even sequence of same-sized sections.",
  "Use a dense, information-forward layout with multiple small sections in quick succession, rather than a small number of spacious, generously-padded sections.",
  "Anchor the composition on a strong horizontal divider or rule system (visible borders/rules separating sections) instead of relying on whitespace alone to separate sections.",
] as const;

export async function generateCreativeEmailFamilyWithSonnet(input: {
  evidence: BrandEvidence;
  brandSystem: BrandSystem;
  direction: CreativeDirection;
  recipes: LifecycleRecipe[];
  refinement: string | null;
  expectedShopName?: string;
  existingRendered?: Record<string, string>;
  /**
   * Skips the family-wide critique + revision pass below. That pass sends
   * every rendered email (not just newly generated ones) to Claude and can
   * silently rewrite up to 3 emails it judges too similar — appropriate for
   * a full-family build, but wrong for a scoped single-email regenerate,
   * which must guarantee every other already-approved email stays untouched.
   */
  skipCritique?: boolean;
  /**
   * Scopes generation to exactly one recipe id. Every other recipe present
   * in existingRendered is trusted verbatim — no re-validation, no repair,
   * no regeneration — even if it would fail today's safety checks. A
   * targeted single-email regenerate must never reason about or touch a
   * sibling's validity; that's the full-family build's job. The target's
   * previous HTML (if any) is shown back to Claude with an explicit
   * instruction to produce a materially different composition, so clicking
   * regenerate again doesn't just re-roll the same layout.
   */
  regenerateOnlyId?: LifecycleRecipe["id"];
  /**
   * Forces every recipe to be authored again while keeping the approved
   * Brand System, lifecycle plan, evidence, and factual asset contract. Each
   * recipe receives its currently-approved HTML only as a negative reference
   * so Sonnet can deliberately change the composition instead of producing a
   * near-duplicate. The normal family critique still runs afterward.
   */
  regenerateAll?: boolean;
  /**
   * A single concrete, mutually-exclusive structural instruction (see
   * REGENERATE_COMPOSITION_DIRECTIVES) that the caller has already picked at
   * random, distinct from whichever directive produced `previousHtml`. Asking
   * Sonnet to "make it different" while handing it the exact same brand
   * system, direction, and creative brief it used last time reliably regresses
   * to the same default interpretation — the caller must pick the axis of
   * variation itself rather than leave it to the model.
   */
  regenerateCompositionDirective?: string;
  /**
   * The merchant's own brief for the regenerateOnlyId email, from the Flow
   * Editor regenerate modal: what it should say, which real products it
   * features, and any real discount code. Overrides the creative brief and
   * section plan for content; the Brand System still governs the look.
   */
  merchantDirection?: string;
  /**
   * The shop's brand photo kit (brand-studio/photo-kit.server.ts). Each
   * photo lists the emails it was planned for; those emails receive it as
   * assignedPhotos and every kit URL is allowed by validation.
   */
  photoKit?: BrandKitPhoto[];
  /** Per-email section plans from the family creative director. */
  emailPlans?: BrandEmailPlans;
  onCheckpoint?: (checkpoint: {
    rendered: Record<string, string>;
    flowId: string;
    flowComplete: boolean;
    usage: AiUsage;
    costMicros: number;
  }) => Promise<void>;
}): Promise<ModelResult<Record<string, string>>> {
  if (input.regenerateOnlyId && input.regenerateAll)
    throw new Error(
      "Choose either a single-email regenerate or a full-family regenerate, not both.",
    );
  if (
    input.expectedShopName &&
    input.evidence.shopName.trim().toLowerCase() !==
      input.expectedShopName.trim().toLowerCase()
  )
    throw new Error(
      `Brand identity mismatch: expected ${input.expectedShopName}, received ${input.evidence.shopName}. No AI request was made.`,
    );
  const rendered: Record<string, string> = {};
  const kitImageUrls = (input.photoKit ?? []).map(({ url }) => url);
  const assignedPhotos = (id: string) =>
    (input.photoKit ?? [])
      .filter(({ emailIds }) => emailIds.includes(id))
      .map(({ key, url, alt, width, height, role, productIds }) => ({
        key,
        url,
        alt,
        width,
        height,
        role,
        showsProducts: productIds,
      }));
  const planFor = (id: string) => {
    const plan = input.emailPlans?.[id];
    return plan?.sections.length ? { concept: plan.concept, sectionPlan: plan.sections } : {};
  };
  const previousHtmlForRegenerateTarget = input.regenerateOnlyId
    ? input.existingRendered?.[input.regenerateOnlyId]
    : undefined;
  for (const recipe of input.recipes) {
    const html = input.existingRendered?.[recipe.id];
    if (!html) continue;
    if (input.regenerateAll) continue; // force every email to be newly authored
    if (recipe.id === input.regenerateOnlyId) continue; // force regeneration
    if (input.regenerateOnlyId) {
      // A targeted single-email regenerate trusts every sibling exactly as
      // stored, whether or not it would still pass today's safety checks.
      rendered[recipe.id] = html;
      continue;
    }
    try {
      rendered[recipe.id] = validateCreativeEmail({
        html,
        recipe,
        evidence: input.evidence,
        brandSystem: input.brandSystem,
        extraAllowedImageUrls: kitImageUrls,
      });
    } catch {
      // A stale or invalid checkpoint is regenerated instead of trusted.
    }
  }
  let inputTokens = 0;
  let outputTokens = 0;
  for (const flow of LIFECYCLE_FLOWS) {
    const recipes = flow.templateIds
      .map((id) => input.recipes.find((recipe) => recipe.id === id))
      .filter((recipe): recipe is LifecycleRecipe => Boolean(recipe))
      .map((recipe) => withWelcomeHeroProduct(recipe, input.evidence));
    const pendingRecipes = recipes.filter(({ id }) => !rendered[id]);
    if (pendingRecipes.length === 0) continue;
    const result = await (async () => {
      const requestFlowEmails = () =>
        getAnthropicClient()
          .messages.stream({
            model: process.env.ANTHROPIC_BRAND_MODEL ?? "claude-sonnet-5",
            max_tokens: LONG_OUTPUT_MAX_TOKENS,
            output_config: {
              effort: EMAIL_RENDER_EFFORT,
              format: zodOutputFormat(creativeEmailOutputSchema),
            },
            system: `You are an elite ecommerce email art director and senior email HTML engineer. Create the finished emails, not design notes. You have full creative control over composition, type scale, color proportion, product placement, visual rhythm, and responsive behavior. There is no template library and no permitted list of layouts. The approved Brand System, free-form creative brief, and real storefront assets are authoritative.

Quality bar: each result should feel as specifically art-directed as a luxury fashion campaign or a bold independent label—not a recolored lifecycle template. Let either typography or real photography dominate. Use contrast deliberately. Stage products differently according to the message. Give the CTA an intentional size, position, shape, and contrast relationship. Finish with a beautiful brand-specific footer: a confident wordmark or logo, one restrained brand motif or closing line, generous spacing, and quiet compliance copy. Emails in the same flow must feel related but must not reuse the same skeleton.

Family awareness: you are receiving the creative briefs for all thirteen emails. Respect the assigned brief and avoid the image order, alignment, section rhythm, headline placement, CTA position, and footer silhouette reserved for any sibling email, including emails outside this flow. Shared brand colours are not sufficient differentiation: each lifecycle flow must have a recognisably different visual grammar suited to its customer moment, while the emails inside that flow remain related but individually composed.

Product contract: productIds are exact requirements, not suggestions. For every requested product, include its requiredProductImages URL in an <img src> exactly as supplied. When productIds are present, link at least one action to one of the listed requiredDestinations. Do not omit a requested image in order to simplify the composition.

Brand photographs: a recipe may carry assignedPhotos — AI photographs made for this brand and planned for this email. Use each assigned photo exactly once as its own <img> at its exact URL, as a deliberate visual moment (full width or a large block) where it serves the creative brief, with its supplied alt text and its width attribute with height:auto; never crop it to a fixed height and never lay text over it. A photo that shows products does not replace those products' real photos wherever a product itself is presented. Emails without assignedPhotos use no brand photographs.

Call to action: every email must include at least one clear primary CTA button linking to a supplied destination — the storefront URL is always supplied for exactly this — placed where it serves the composition.

Technical boundaries: return complete standalone HTML documents beginning with <!doctype html>. Use a centered 600px table foundation, nested presentation tables, inline styles, and a small <style> block only for responsive media queries. Preserve aspect ratios. No scripts, forms, SVG, base64, gradients, CSS background-image URLs, webfont requests, invented images, invented links, placeholders, or href="#". Body copy is at least 15px and primary CTAs are at least 44px tall. Only use supplied logo, product, and assignedPhotos image URLs and supplied storefront/product URLs. When no logo URL is supplied, render the merchant brand name as a deliberate typographic wordmark; never substitute a platform mark. If no destination exists, omit the CTA. Compliance links are injected later, so mention them as plain footer text without inventing a URL. Never mention the email platform; only the supplied merchant brand may appear.

${SEAM_TAGGING_INSTRUCTION}

${WELCOME_VISUAL_RULE}

${PERSONAL_SLOT_INSTRUCTION}

${SECTION_PLAN_INSTRUCTION}

Creative material: you are encouraged, not merely permitted, to invent original decorative objects and motifs whenever they would make the composition feel considered rather than a plain photo-and-paragraph block — a stamp, a ribbon, a ticket stub, a wax seal, a compass, a leaf, a folded corner, a simple line-built icon, whatever suits this brand. Build them entirely from table cells, borders, colour fields, spacing, numbering, and typography — no <img>, no SVG, no CSS backgrounds or gradients. For review-request specifically, render a decorative five-star row this same table/typography way as a visual accent near the headline or product; keep it purely decorative — never styled or labelled as something to click, tap, or fill in, since email HTML cannot make a rating input functional. You are not limited to arranging the supplied assets, but you must not fabricate an external image or product fact.

Copy boundaries: use the approved recipe as the semantic source, but improve line breaks and microcopy presentation when needed. Never invent offers, discounts, scarcity, product properties, customer behavior, reviews, addresses, or claims.

Merchant direction: a recipe may carry merchantDirection, the merchant's own brief for this email. It is authoritative for what the email says and features — follow it over the creative brief and any sectionPlan, while keeping this email's lifecycle job, the Brand System, and every technical rule above. Build the composition around the products it names (they are in this recipe's productIds). A discount code it gives is real: show that exact code, value, and dates prominently, and never alter it or add another offer.`,
            messages: [
              {
                role: "user",
                content: JSON.stringify({
                  flow: { id: flow.id, name: flow.name, purpose: flow.purpose },
                  brandSystem: input.brandSystem,
                  chosenDirection: input.direction,
                  refinement: input.refinement,
                  storefrontUrl: input.evidence.storefrontUrl,
                  logoUrl: input.evidence.assets?.logoUrl,
                  products: input.evidence.products,
                  familyCreativeBriefs: input.recipes.map(
                    ({ id, creativeBrief, productIds }) => ({
                      id,
                      creativeBrief,
                      productIds,
                    }),
                  ),
                  recipes: pendingRecipes.map((recipe) => ({
                    ...recipe,
                    ...requiredProductContract(recipe, input.evidence),
                    assignedPhotos: assignedPhotos(recipe.id),
                    ...planFor(recipe.id),
                    ...((recipe.id === input.regenerateOnlyId &&
                      previousHtmlForRegenerateTarget) ||
                    (input.regenerateAll &&
                      input.existingRendered?.[recipe.id])
                      ? {
                          previousHtml:
                            previousHtmlForRegenerateTarget ??
                            input.existingRendered?.[recipe.id],
                          regenerateInstruction: input.regenerateAll
                            ? "The merchant asked to regenerate the complete email family. previousHtml is the version of this email being replaced and is a negative reference, not a template. Do not preserve the old layout with cosmetic color, spacing, or copy changes. mandatoryCompositionChange below is not optional and not a suggestion to weigh against your own taste — it names the one structural axis this rebuild must change from previousHtml; apply it literally, then let every other choice (section order and rhythm, image role and placement, headline treatment, hierarchy, CTA relationship, footer treatment) follow from it. Stay inside the approved Brand System, factual asset contract, and this email's creative brief."
                            : "The merchant asked to regenerate this exact email. previousHtml is the version they are replacing and is a negative reference, not a template. Do not preserve the old layout with cosmetic color, spacing, or copy changes. mandatoryCompositionChange below is not optional and not a suggestion to weigh against your own taste — it names the one structural axis this regenerate must change from previousHtml; apply it literally, then let every other choice (section order and rhythm, image role and placement, headline treatment, hierarchy, CTA relationship, footer treatment) follow from it. Stay inside the approved Brand System, factual asset contract, and this creative brief.",
                          mandatoryCompositionChange:
                            input.regenerateCompositionDirective ??
                            REGENERATE_COMPOSITION_DIRECTIVES[0],
                        }
                      : {}),
                    ...(recipe.id === input.regenerateOnlyId && input.merchantDirection
                      ? { merchantDirection: input.merchantDirection }
                      : {}),
                  })),
                }),
              },
            ],
          })
          .finalMessage();
      const response = await requestFlowEmails().catch(() =>
        requestFlowEmails(),
      );
      const usage: AiUsage = {
        provider: "anthropic",
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      };
      if (
        response.stop_reason === "refusal" ||
        response.stop_reason === "max_tokens" ||
        !response.parsed_output
      )
        throw new MeteredAiError(
          `Sonnet could not finish the ${flow.name} email designs.`,
          usage,
        );
      const expected = new Set(pendingRecipes.map(({ id }) => id));
      if (
        response.parsed_output.emails.length !== pendingRecipes.length ||
        response.parsed_output.emails.some(({ id }) => !expected.has(id))
      )
        throw new MeteredAiError(
          `Sonnet returned the wrong emails for ${flow.name}.`,
          usage,
        );
      let candidateEmails = response.parsed_output.emails;
      let validation = validateCandidateEmails({
        candidates: candidateEmails,
        recipes: pendingRecipes,
        evidence: input.evidence,
        brandSystem: input.brandSystem,
        extraAllowedImageUrls: kitImageUrls,
      });
      Object.assign(
        rendered,
        Object.fromEntries(validation.valid.map(({ id, html }) => [id, html])),
      );
      if (validation.failed.length) {
        const failedIds = new Set(validation.failed.map(({ id }) => id));
        const requestRepairs = () =>
          getAnthropicClient()
            .messages.stream({
              model: process.env.ANTHROPIC_BRAND_MODEL ?? "claude-sonnet-5",
              max_tokens: LONG_OUTPUT_MAX_TOKENS,
              output_config: {
                effort: EMAIL_RENDER_EFFORT,
                format: zodOutputFormat(creativeEmailOutputSchema),
              },
              system: `You are a senior email HTML engineer repairing a small set of otherwise art-directed emails that failed deterministic safety checks. Return complete standalone HTML only for the requested IDs. Preserve each email's creative idea and visual distinctiveness while fixing every listed validation error.

Technical boundaries: begin each document with <!doctype html>. Use exactly one <h1>. Include a mobile viewport declaration and a centered max-width 600px table foundation. Use nested presentation tables, inline styles, and only a small responsive <style> block. Preserve image aspect ratios. No scripts, forms, SVG, base64, gradients, CSS background-image URLs, webfonts, invented images, invented links, placeholders, or href="#". Body copy is at least 15px and primary CTAs are at least 44px tall. Use only supplied images and destinations; assignedPhotos URLs are supplied images and must stay in the email exactly once each.

Product contract: every requiredProductImages URL must appear in an <img src> exactly as supplied. If requiredProductImages is non-empty, at least one <a href> must use a listed requiredDestinations URL. These requirements are deterministic and the repair fails if even one is omitted.

${WELCOME_VISUAL_RULE}

${PERSONAL_SLOT_INSTRUCTION}

${SECTION_PLAN_INSTRUCTION}

${SEAM_TAGGING_INSTRUCTION} The HTML you are repairing may already carry these attributes — preserve them, and add any that are missing.`,
              messages: [
                {
                  role: "user",
                  content: JSON.stringify({
                    brandSystem: input.brandSystem,
                    direction: input.direction,
                    products: input.evidence.products,
                    storefrontUrl: input.evidence.storefrontUrl,
                    logoUrl: input.evidence.assets?.logoUrl,
                    repairs: validation.failed.map(({ id, html, error }) => {
                      const recipe = pendingRecipes.find(
                        (recipe) => recipe.id === id,
                      )!;
                      return {
                        id,
                        recipe,
                        ...requiredProductContract(recipe, input.evidence),
                        assignedPhotos: assignedPhotos(id),
                        ...planFor(id),
                        error,
                        html,
                      };
                    }),
                  }),
                },
              ],
            })
            .finalMessage();
        const repairResponse = await requestRepairs().catch(() =>
          requestRepairs(),
        );
        usage.inputTokens += repairResponse.usage.input_tokens;
        usage.outputTokens += repairResponse.usage.output_tokens;
        const abortAfterPartialCheckpoint = async (
          message: string,
        ): Promise<never> => {
          if (input.onCheckpoint) {
            await input.onCheckpoint({
              rendered: { ...rendered },
              flowId: flow.id,
              flowComplete: false,
              usage,
              costMicros: estimateUsageMicros(usage),
            });
            throw new Error(message);
          }
          throw new MeteredAiError(message, usage);
        };
        const repairedEmails = repairResponse.parsed_output?.emails;
        if (
          repairResponse.stop_reason === "refusal" ||
          repairResponse.stop_reason === "max_tokens" ||
          !repairedEmails ||
          repairedEmails.length !== validation.failed.length ||
          repairedEmails.some(({ id }) => !failedIds.has(id))
        ) {
          return abortAfterPartialCheckpoint(
            `Sonnet could not repair the ${flow.name} email designs.`,
          );
        }
        const repairedById = new Map(
          repairedEmails.map((email) => [email.id, email]),
        );
        candidateEmails = candidateEmails.map(
          (email) => repairedById.get(email.id) ?? email,
        );
        validation = validateCandidateEmails({
          candidates: candidateEmails.filter(({ id }) => failedIds.has(id)),
          recipes: pendingRecipes,
          evidence: input.evidence,
          brandSystem: input.brandSystem,
          extraAllowedImageUrls: kitImageUrls,
          // A cart/review email still missing its slots after repair is kept:
          // the worker falls back to generating that send instead.
          requirePersonalSlots: false,
        });
        Object.assign(
          rendered,
          Object.fromEntries(
            validation.valid.map(({ id, html }) => [id, html]),
          ),
        );
        if (validation.failed.length) {
          await abortAfterPartialCheckpoint(
            validation.failed.map(({ error }) => error).join(" "),
          );
        }
      }
      const emails = pendingRecipes.map(
        ({ id }) => [id, rendered[id]] as const,
      );
      return { usage, emails };
    })();
    Object.assign(rendered, Object.fromEntries(result.emails));
    if (input.onCheckpoint) {
      await input.onCheckpoint({
        rendered: { ...rendered },
        flowId: flow.id,
        flowComplete: true,
        usage: result.usage,
        costMicros: estimateUsageMicros(result.usage),
      });
    } else {
      inputTokens += result.usage.inputTokens;
      outputTokens += result.usage.outputTokens;
    }
  }

  if (!input.skipCritique) {
    const requestCritique = () =>
      getAnthropicClient()
        .messages.stream({
          model: process.env.ANTHROPIC_BRAND_MODEL ?? "claude-sonnet-5",
          max_tokens: 16_000,
          output_config: {
            effort: "high",
            format: zodOutputFormat(familyCritiqueSchema),
          },
          system:
            "You are the final creative director for an ecommerce email family. Review all thirteen finished HTML documents together. Identify clear cases where emails reuse the same visual skeleton, image role, hierarchy, section rhythm, CTA relationship, or footer silhouette. Also compare lifecycle flows as groups: shared brand colours and typography should create recognition, but welcome, consideration, cart recovery, post-purchase care, and win-back must each have a recognisably different visual grammar suited to its customer moment. Brand consistency is not repetition. Return at most three highest-impact targeted revisions and return none only when both cross-flow and within-flow variety are genuinely strong. Superficial color or copy changes do not count as structural variety.",
          messages: [
            {
              role: "user",
              content: JSON.stringify({
                brandSystem: input.brandSystem,
                direction: input.direction,
                recipes: input.recipes,
                emails: rendered,
              }),
            },
          ],
        })
        .finalMessage();
    let critiqueResponse = await requestCritique().catch(() => requestCritique());
    if (
      critiqueResponse.stop_reason === "max_tokens" ||
      !critiqueResponse.parsed_output
    ) {
      inputTokens += critiqueResponse.usage.input_tokens;
      outputTokens += critiqueResponse.usage.output_tokens;
      critiqueResponse = await requestCritique();
    }
    inputTokens += critiqueResponse.usage.input_tokens;
    outputTokens += critiqueResponse.usage.output_tokens;
    if (
      critiqueResponse.stop_reason === "refusal" ||
      !critiqueResponse.parsed_output
    )
      throw new MeteredAiError(
        "Sonnet could not complete the family-wide creative review.",
        { provider: "anthropic", inputTokens, outputTokens },
      );

    const revisions = critiqueResponse.parsed_output.revisions;
    if (revisions.length) {
      const ids = new Set(revisions.map(({ id }) => id));
      const revisionRecipes = input.recipes
        .filter(({ id }) => ids.has(id))
        .map((recipe) => withWelcomeHeroProduct(recipe, input.evidence));
      const requestRevisions = () =>
        getAnthropicClient()
          .messages.stream({
            model: process.env.ANTHROPIC_BRAND_MODEL ?? "claude-sonnet-5",
            max_tokens: LONG_OUTPUT_MAX_TOKENS,
            output_config: {
              effort: EMAIL_RENDER_EFFORT,
              format: zodOutputFormat(creativeEmailOutputSchema),
            },
            system: `You are the senior email art director revising a small set of emails after a family-wide critique. Return complete standalone email-safe HTML for only the requested IDs. Make structural changes, not cosmetic swaps. Keep the approved brand identity and factual boundaries, but change the silhouette, hierarchy, image role, section rhythm, CTA relationship, and footer treatment as directed.

Technical boundaries: begin each document with <!doctype html>. Use a centered max-width 600px table foundation, nested presentation tables, inline styles, and a small responsive <style> block. Preserve image aspect ratios. No scripts, forms, SVG, base64, gradients, CSS background-image URLs, webfonts, invented images, invented links, placeholders, or href="#". Body copy is at least 15px and primary CTAs are at least 44px tall. Use only supplied images and destinations; keep each recipe's assignedPhotos in the email exactly once.

Creative material: invent original decorative objects and motifs (a stamp, a ribbon, a ticket stub, a compass, a leaf, a folded corner, a line-built icon) built from table cells, borders, colour fields, spacing, and typography whenever that would sharpen the requested change. For review-request, a decorative five-star row built the same way is encouraged as a visual accent — purely decorative, never styled as something to click or fill in.

${SEAM_TAGGING_INSTRUCTION}

${WELCOME_VISUAL_RULE}

${PERSONAL_SLOT_INSTRUCTION}

${SECTION_PLAN_INSTRUCTION}`,
            messages: [
              {
                role: "user",
                content: JSON.stringify({
                  brandSystem: input.brandSystem,
                  direction: input.direction,
                  products: input.evidence.products,
                  storefrontUrl: input.evidence.storefrontUrl,
                  logoUrl: input.evidence.assets?.logoUrl,
                  recipes: revisionRecipes.map((recipe) => ({
                    ...recipe,
                    assignedPhotos: assignedPhotos(recipe.id),
                    ...planFor(recipe.id),
                  })),
                  revisions,
                  existingFamily: rendered,
                }),
              },
            ],
          })
          .finalMessage();
      const revisionResponse = await requestRevisions().catch(() =>
        requestRevisions(),
      );
      inputTokens += revisionResponse.usage.input_tokens;
      outputTokens += revisionResponse.usage.output_tokens;
      if (
        revisionResponse.stop_reason === "refusal" ||
        revisionResponse.stop_reason === "max_tokens" ||
        !revisionResponse.parsed_output ||
        revisionResponse.parsed_output.emails.length !== revisionRecipes.length ||
        revisionResponse.parsed_output.emails.some(({ id }) => !ids.has(id))
      )
        throw new MeteredAiError(
          "Sonnet could not finish the family revisions.",
          {
            provider: "anthropic",
            inputTokens,
            outputTokens,
          },
        );
      for (const email of revisionResponse.parsed_output.emails) {
        const recipe = revisionRecipes.find(({ id }) => id === email.id)!;
        rendered[email.id] = validateCreativeEmail({
          html: email.html,
          recipe,
          evidence: input.evidence,
          brandSystem: input.brandSystem,
          extraAllowedImageUrls: kitImageUrls,
        });
      }
    }
  }
  const usage: AiUsage = { provider: "anthropic", inputTokens, outputTokens };
  return { value: rendered, usage, costMicros: estimateUsageMicros(usage) };
}
