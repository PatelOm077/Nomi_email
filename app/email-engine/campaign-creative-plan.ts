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

// Hard ceiling on generated photos per campaign — each is a paid, slow
// Image API call, and more than two starts to read as a photo dump rather
// than an art-directed email. The director is told the same number.
export const MAX_CAMPAIGN_IMAGES = 2;

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

const SECTION_GUIDE: Record<CampaignSectionType, string> = {
  "hero-typographic": "Opening with a large editorial headline and no photo. Needs nothing.",
  "hero-photo": "Opening headline block with a generated photo directly beneath it. Needs imageKey.",
  "editorial-split": "Photo on one side, a short paragraph on the other (stacks on mobile). Needs imageKey.",
  "scene-break": "A full-width generated mood photo used as a breathing pause between sections. Needs imageKey.",
  "product-feature": "One product as a tinted card: real product photo on one side; name, what it is, price, one line, and an outlined button on the other. Needs exactly one productId.",
  "product-grid": "Two or three products as an even grid with real photos, names, and prices. Needs 2–3 productIds.",
  "get-the-look": "Annotated photo: numbered callouts (1., 2., 3.) beside a generated photo that shows those same products in use, each callout naming one product with one line, joined to the photo edge by a thin leader line and dot. Needs imageKey for a 'look' image and 2–3 productIds that appear in that image.",
  "ritual-steps": "A numbered 1-2-3 routine or how-to-use sequence, each step a short title and one line, optionally with a small real product photo. Needs 2–3 productIds.",
  "benefit-row": "Three or four short benefits in columns divided by thin rules, each a title and one line, marked with a numeral or a simple glyph (✦, ◦). Only benefits stated in the brief or a product description. Needs nothing else.",
  "pull-statement": "One large serif statement line with generous space around it — a typographic pause. Needs nothing.",
  "discount-voucher": "A designed voucher/ticket-stub moment for the real discount code. Only when a discount code is supplied.",
  "closing-band": "A full-width band in the brand's ink or accent colour with a large serif line, one supporting sentence, and an inverted pill button. Needs a real destination to include the button.",
  "category-chips": "A row of outlined pill links to the store's real collections. Only when collections are supplied.",
};

const SYSTEM_PROMPT = `You are the creative director for Nomi, which writes one-prompt marketing campaign emails for Shopify merchants. You plan the email; a separate designer builds it in email-safe HTML exactly from your plan, and an image model renders any photos you brief. Your plan decides the whole shape of the email: which sections it has, in what order, and whether any section earns a newly generated photograph.

## Grounding — read this first
Everything you plan must fit what this store actually sells. You are shown each product's real photo, its product type, and the merchant's own description; use them to understand what each product physically is (a serum bottle, a cream jar, a candle, a mug, a sweater) and what category the shop is in. Never describe a product as a different kind of object than its photo and description show, and never set a scene that belongs to a different category (no clothing lookbooks for a skincare brand, no kitchen scenes for jewellery). Props, settings, and gestures must be ones that naturally belong with these products — for skincare: a bathroom shelf, a vanity, a hand holding the product, water, stone, botanicals. When an approved brand identity is supplied, its audience, feeling, palette, and image treatment are authoritative.

## Sections
Pick 4 to 7 sections from this library, in the order they should appear. Vary the rhythm — mix typographic, photographic, and product moments; never stack two photo sections back to back; make the composition specific to this brief rather than a default template. Start with a hero-typographic or hero-photo section and usually end with a closing-band.
${Object.entries(SECTION_GUIDE)
  .map(([type, guide]) => `- ${type}: ${guide}`)
  .join("\n")}
purpose is one sentence telling the designer what this section says or does in this campaign. productIds lists the exact supplied product ids a section shows (empty when none). imageKey names one of your images, or null.

## Photographs
Generated photography is optional and limited to ${MAX_CAMPAIGN_IMAGES} per email. Plan none for a plain announcement, a policy or shipping note, or a brief where the real product photos and typography carry it. When photos help — a seasonal or editorial moment, a launch that needs atmosphere, a routine shown in use — plan at most ${MAX_CAMPAIGN_IMAGES}, each used by exactly one section. Fewer, stronger photos beat more.

Roles: hero (opening lifestyle photo, leave calm negative space at the top), editorial (a styled in-use scene deeper in the email), look (a scene where 2–3 supplied products appear together, for get-the-look), scene (a wide mood photo with no product).

Honesty:
- A photo that shows real products lists them in productIds, and only products listed with a real photo may appear. Its prompt must say those products must be reproduced faithfully from the reference photos — same shape, colour, material, proportions, and label — and must not add variants, colours, or products the store doesn't sell.
- A photo with empty productIds must not show any identifiable product or packaging.
- Never depict a discount, price, badge, sale sign, or claim.

Writing image prompts:
- artDirection is one shared paragraph applied to every photo so they read as one shoot: lighting, palette that fits this brand, surfaces, lens, mood. Use an empty string when you plan no photos.
- Each prompt describes one photograph concretely: subject, composition, camera distance, framing, light, background. Photorealistic editorial ecommerce photography.
- Each prompt must say: no text, letters, logos, watermarks, or signage anywhere in the image, except the product's own label exactly as it appears in its reference photo.
- People are fine as hands, or figures seen from behind or cropped at the shoulders; no close-up faces.
- Never plan extreme macro shots of skin or body parts, product smeared or swirled on skin, or anything that reads as clinical or bodily. Texture belongs on a clean surface (a swatch on stone, glass, or linen), not on a body.
- key is a short unique slug. alt is short, specific, customer-facing alt text.

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
    .slice(0, MAX_CAMPAIGN_IMAGES)
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

// Applied after photos are generated and reviewed: drops or downgrades any
// section whose required data didn't survive (a rejected photo, a missing
// product page, no collections), so the designer is never asked to build a
// section it would have to fake.
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
