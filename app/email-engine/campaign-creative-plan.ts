import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { getAnthropicClient } from "./anthropic-client";
import type { GeneratedImageAspect } from "./image-generation";
import type {
  CampaignSectionType,
  EmailBrandIdentity,
  NewsletterCollectionLink,
  NewsletterProduct,
} from "./types";
import { CAMPAIGN_SECTION_TYPES } from "./types";
import { PHOTO_DIRECTION_RULES } from "./photo-direction-rules";
import { sectionPlanLibrary } from "./section-library";

const planSchema = z.object({
  reasoning: z.string(),
  concept: z.string(),
  artDirection: z.string(),
  images: z.array(
    z.object({
      key: z.string(),
      role: z.enum(["hero", "editorial", "look", "scene"]),
      aspect: z.enum(["portrait", "landscape", "square"]),
      productIds: z.array(z.string()),
      prompt: z.string(),
      alt: z.string(),
    }),
  ),
  sections: z.array(
    z.object({
      type: z.enum(CAMPAIGN_SECTION_TYPES),
      purpose: z.string(),
      productIds: z.array(z.string()),
      imageKey: z.string().nullable(),
    }),
  ),
});

export type CampaignImageBrief = {
  key: string;
  role: "hero" | "editorial" | "look" | "scene";
  aspect: GeneratedImageAspect;
  // Supplied products the photo must show faithfully, each generated from
  // its real photo as a reference. Empty for product-free imagery.
  productIds: string[];
  // Full image prompt, with the shared art direction already prepended.
  prompt: string;
  alt: string;
};

export type CampaignSectionPlan = {
  type: CampaignSectionType;
  purpose: string;
  productIds: string[];
  imageKey: string | null;
};

export type CampaignCreativePlan = {
  concept: string;
  reasoning: string;
  images: CampaignImageBrief[];
  sections: CampaignSectionPlan[];
  usage: { inputTokens: number; outputTokens: number };
};


const SYSTEM_PROMPT = `You are the creative director for Nomi, which writes one-prompt marketing campaign emails for Shopify merchants. You plan the email; a separate designer builds it in email-safe HTML exactly from your plan, and an image model renders any photos you brief. Your plan decides the whole shape of the email: which sections it has, in what order, and whether any section earns a newly generated photograph.

## Grounding — read this first
Everything you plan must fit what this store actually sells. You are shown each product's real photo, its product type, and the merchant's own description; use them to understand what each product physically is (a serum bottle, a cream jar, a candle, a mug, a sweater) and what category the shop is in. Never describe a product as a different kind of object than its photo and description show, and never set a scene that belongs to a different category (no clothing lookbooks for a skincare brand, no kitchen scenes for jewellery). Props and settings must be ones that naturally belong with these products — for skincare: a bathroom shelf, a vanity, water, stone, botanicals, morning light. When an approved brand identity is supplied, its audience, feeling, palette, and image treatment are authoritative.

## Sections
You are the architect: choose which sections this email has, how many, and in what order, from this library. There is no fixed template, count, or order — decide from the brief, the products, and the brand what this particular campaign needs, and leave out anything that doesn't earn its place. Things worth weighing: every section makes the email longer to read on a phone and longer to build, so a focused email of strong moments usually beats one that uses every idea; rhythm matters (typographic, photographic, and product moments play off each other); and the composition should feel specific to this brief rather than a default layout.
${sectionPlanLibrary(CAMPAIGN_SECTION_TYPES)}
purpose is one sentence telling the designer what this section says or does in this campaign. productIds lists the exact supplied product ids a section shows (empty when none). imageKey names one of your images, or null.

## Call to action
Every email must give the reader a clear next step: at least one prominent button to a real destination (a product page, a collection, or the storefront homepage, which is always available). Decide where it lands so it feels part of the composition — in a product moment, a closing section, or wherever it reads most naturally — and say so in that section's purpose.

## Photographs
Generated photography is your call too, including how many. Plan none when the real product photos and typography carry the brief (a plain announcement, a policy or shipping note); plan photos when they genuinely lift it (a seasonal or editorial moment, a launch that needs atmosphere, a routine set out as a styled still life). Each photo is used by exactly one section, and each one is a paid render, so plan only the photos this email genuinely needs.

Roles: hero (opening editorial still-life or setting photo, leave calm negative space at the top), editorial (a styled still-life scene deeper in the email), look (a scene where 2–3 supplied products appear together, for get-the-look), scene (a wide mood photo with no product).

${PHOTO_DIRECTION_RULES}

reasoning is one or two sentences on the overall decision (logged, never shown). concept is the campaign's creative idea in one line.`;

function productLine(product: NewsletterProduct, photoNumber: number | null): string {
  const type = product.productType ? `; product type: ${product.productType}` : "";
  const description = product.description ? `; merchant's description: ${product.description}` : "";
  const photo = photoNumber
    ? `; real photo shown as image ${photoNumber} (can appear in generated photos)`
    : "; no photo (cannot appear in generated photos)";
  const url = product.productUrl ? "; has a product page" : "; no product page";
  return `- id: ${product.id}; ${product.title} — ${product.price}${type}${photo}${url}${description}`;
}

function brandLine(identity: EmailBrandIdentity | undefined): string {
  if (!identity) return "No approved brand identity — infer the aesthetic from the products themselves.";
  const { audience, feeling, palette, imageTreatment } = identity.system;
  return `Approved brand identity: audience: ${audience}; feeling: ${feeling}; palette ${JSON.stringify(palette)}; image treatment: ${imageTreatment}`;
}

export type CampaignPlanInput = {
  shopName: string;
  prompt: string;
  products: NewsletterProduct[];
  collections: NewsletterCollectionLink[];
  storefrontUrl: string | null;
  hasDiscountCode: boolean;
  brandIdentity?: EmailBrandIdentity;
};

export async function planCampaignCreative(input: CampaignPlanInput): Promise<CampaignCreativePlan> {
  // Show the director the real product photos so it knows what each
  // product physically is — a bare title like "Loam" says nothing.
  const photographed = input.products.filter((product) => product.imageUrl);
  const photoBlocks = photographed.map((product) => ({
    type: "image" as const,
    source: { type: "url" as const, url: product.imageUrl as string },
  }));
  const lines = input.products.length
    ? input.products
        .map((product) => {
          const index = photographed.indexOf(product);
          return productLine(product, index >= 0 ? index + 1 : null);
        })
        .join("\n")
    : "No products supplied.";
  const collections = input.collections.length
    ? input.collections.map(({ title }) => title).join(", ")
    : "none";

  const response = await getAnthropicClient().messages.parse({
    model: "claude-sonnet-5",
    max_tokens: 8_000,
    output_config: { effort: "medium", format: zodOutputFormat(planSchema) },
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          ...photoBlocks,
          {
            type: "text",
            text: [
              `Shop: ${input.shopName}`,
              brandLine(input.brandIdentity),
              `Merchant's campaign brief: ${input.prompt}`,
              `Real products in this campaign (photos above, in order):\n${lines}`,
              `Store collections available as links: ${collections}`,
              `Storefront homepage link available: ${input.storefrontUrl ? "yes" : "no"}`,
              `Real discount code supplied: ${input.hasDiscountCode ? "yes" : "no"}`,
              "Plan this campaign email.",
            ].join("\n"),
          },
        ],
      },
    ],
  });

  const usage = {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
  const parsed = response.parsed_output;
  if (!parsed) {
    return { concept: "", reasoning: "No plan returned.", images: [], sections: [], usage };
  }

  const referenceable = new Set(photographed.map((product) => product.id));
  const known = new Set(input.products.map((product) => product.id));
  const seenKeys = new Set<string>();
  const images = parsed.images
    // A photo naming a hallucinated or photo-less product can't be
    // faithfully rendered — drop it rather than let the model invent one.
    .filter((image) => image.productIds.every((id) => referenceable.has(id)))
    .filter((image) => {
      if (!image.key || seenKeys.has(image.key)) return false;
      seenKeys.add(image.key);
      return true;
    })
    .map((image) => ({
      ...image,
      prompt: [parsed.artDirection.trim(), image.prompt.trim()].filter(Boolean).join("\n\n"),
    }));

  const sections = parsed.sections.map((section) => ({
    ...section,
    productIds: section.productIds.filter((id) => known.has(id)),
  }));

  return { concept: parsed.concept, reasoning: parsed.reasoning, images, sections, usage };
}

// Applied before the designer sees the plan: drops or downgrades any section
// whose required data doesn't exist (a photo that won't be rendered, too few
// real products, no collections, no discount code), so the designer is
// never asked to build a section it would have to fake. Photos that fail
// later, during rendering or review, lose only their <img>
// (generated-photo-slots.ts).
export function finalizeSections(
  sections: CampaignSectionPlan[],
  context: {
    availableImages: Map<string, { role: CampaignImageBrief["role"]; productIds: string[] }>;
    hasCollections: boolean;
    hasDiscountCode: boolean;
  },
): CampaignSectionPlan[] {
  const usedImages = new Set<string>();
  const result: CampaignSectionPlan[] = [];
  for (const section of sections) {
    const image = section.imageKey ? context.availableImages.get(section.imageKey) : undefined;
    const imageOk = Boolean(image) && !usedImages.has(section.imageKey as string);
    const withImage = (): CampaignSectionPlan => {
      usedImages.add(section.imageKey as string);
      return section;
    };
    switch (section.type) {
      case "hero-photo":
        result.push(imageOk ? withImage() : { ...section, type: "hero-typographic", imageKey: null });
        break;
      case "editorial-split":
      case "scene-break":
        if (imageOk) result.push(withImage());
        break;
      case "get-the-look": {
        const shown = image ? section.productIds.filter((id) => image.productIds.includes(id)) : [];
        if (imageOk && shown.length >= 2) result.push({ ...withImage(), productIds: shown });
        break;
      }
      case "product-feature":
        if (section.productIds.length >= 1)
          result.push({ ...section, productIds: section.productIds.slice(0, 1), imageKey: null });
        break;
      case "product-grid":
      case "ritual-steps":
        if (section.productIds.length >= 2)
          result.push({ ...section, productIds: section.productIds.slice(0, 3), imageKey: null });
        break;
      case "category-chips":
        if (context.hasCollections) result.push({ ...section, imageKey: null });
        break;
      case "discount-voucher":
        if (context.hasDiscountCode) result.push({ ...section, imageKey: null });
        break;
      default:
        result.push({ ...section, imageKey: null });
    }
  }
  return result;
}
