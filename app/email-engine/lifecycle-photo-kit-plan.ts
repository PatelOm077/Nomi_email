import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { getAnthropicClient } from "./anthropic-client";
import type { GeneratedImageAspect } from "./image-generation";
import { PHOTO_DIRECTION_RULES } from "./photo-direction-rules";
import { LIFECYCLE_SECTION_TYPES, sectionPlanLibrary } from "./section-library";
import type { NewsletterSection } from "./types";

// The Brand Studio family creative director — the lifecycle counterpart of
// the campaign creative director (campaign-creative-plan.ts). After the
// family's creative briefs exist, Claude plans every email as a sequence of
// sections from the shared library (section-library.ts), fitted to that
// email's flow job and the approved brand, and briefs the small reusable
// photo kit those sections need. Photos are rendered once per build and
// reused by every email and regenerate. Platform-neutral: no Shopify imports
// — rendering, review, and hosting live in app/brand-studio/photo-kit.server.ts.

const planSchema = z.object({
  reasoning: z.string(),
  artDirection: z.string(),
  photos: z.array(
    z.object({
      key: z.string(),
      role: z.enum(["hero", "editorial", "look", "scene"]),
      aspect: z.enum(["portrait", "landscape", "square"]),
      productIds: z.array(z.string()),
      prompt: z.string(),
      alt: z.string(),
    }),
  ),
  emails: z.array(
    z.object({
      id: z.string(),
      concept: z.string(),
      sections: z.array(
        z.object({
          type: z.enum(LIFECYCLE_SECTION_TYPES as [string, ...string[]]),
          purpose: z.string(),
          productIds: z.array(z.string()),
          imageKey: z.string().nullable(),
        }),
      ),
    }),
  ),
});

export type LifecyclePhotoBrief = {
  key: string;
  role: "hero" | "editorial" | "look" | "scene";
  aspect: GeneratedImageAspect;
  productIds: string[];
  // Full image prompt, with the shared art direction already prepended.
  prompt: string;
  alt: string;
  // Emails whose section plan places this photo.
  emailIds: string[];
};

export type LifecycleEmailPlan = { concept: string; sections: NewsletterSection[] };

export type LifecyclePhotoKitPlanInput = {
  shopName: string;
  // The approved brand system, serialized by the caller (audience, feeling,
  // palette, typography, voice, image treatment, motif). Authoritative.
  brandSummary: string;
  products: Array<{
    id: string;
    title: string;
    productType: string | null;
    description: string | null;
    imageUrl: string | null;
  }>;
  emails: Array<{
    id: string;
    flow: string;
    flowPurpose: string;
    // The email's fixed job within its flow (lifecycle-email-roles.ts).
    role: string;
    creativeBrief: string;
    productIds: string[];
  }>;
};

const SYSTEM_PROMPT = `You are the creative director for Nomi's automated lifecycle email family — the emails a store sends on its own: Welcome, Still Interested?, Abandoned Cart, How Was It?, and Welcome Back. A designer builds every email in email-safe HTML exactly from your plan, and an image model renders the photographs you brief (each is reviewed before use). You plan all emails in one pass so the family reads as one brand with a distinct shape for every email.

## Every email serves its flow and the brand
Each email is supplied with its flow, that flow's purpose, its own fixed role within the flow, and a creative brief written earlier. The role is what this particular email is for — plan every section to do that job, so sibling emails in a flow never repeat one another's intent. The flow's job frames it:
- Welcome: the brand's first impression — who the brand is, what it makes, why it's different, and an introduction to real products. Every welcome email opens with a genuine visual moment: a photograph (hero-photo, editorial-split, or scene-break) or a real product at hero scale (product-feature). Plan the welcome emails' photos first.
- Still Interested?: help a browsing customer decide — the product they looked at, what it is, how it's used, and why it's worth it.
- Abandoned Cart: bring the customer back to their cart — the cart product(s) front and centre and one clear return-to-cart action; calm, useful, never a lookbook or a brand essay.
- How Was It?: post-purchase care — thanks, how to get the most from the product, and a gentle review ask; the calmest emails in the family.
- Welcome Back: re-engagement — what the customer may have missed and a warm reason to return.
Carry the approved brand throughout — its audience, feeling, palette, typography character, image treatment, voice, and signature motif — so every email is unmistakably this brand's. Use the creative brief's intent and voice, but where a brief would make an email plain or off its flow's job (for example an image-free welcome), your plan wins.

## Sections
You are the architect of each email: choose its sections, how many, and their order from this library. There is no fixed template or count. A focused email of strong moments beats one that uses every idea; vary the shape across the family so siblings don't share a skeleton; and every email needs a clear call to action — at least one prominent button to a real destination (a product page or the storefront homepage, which is always available), placed where it reads most naturally, and named in that section's purpose.
${sectionPlanLibrary(LIFECYCLE_SECTION_TYPES)}
concept is one line naming the email's creative idea. purpose is one sentence telling the designer what the section says or does in this email. productIds lists the exact supplied product ids a section shows (empty when none); when an email's brief lists products, show each of them somewhere in its plan. imageKey names one of your photos, or null.

## Photographs
You decide how many photographs the family needs. They are paid renders made once and reused, so brief only what the plans place; a photo may appear in more than one email when it reads naturally in each, but not twice within one flow. List photos in priority order, most important first — welcome photos first — because if the budget runs short only the top of the list is rendered, and sections whose photo isn't rendered are rebuilt without it.

Roles: hero (an opening editorial still life or setting, leaving calm negative space), editorial (a styled still-life scene deeper in an email), look (2–3 supplied products styled together, for get-the-look), scene (a wide mood photo with no product).

## Grounding
Everything must fit what this store actually sells. You are shown each product's real photo, its product type, and the merchant's description; use them to understand what each product physically is and what category the shop is in. Never set a scene that belongs to a different category, and props and settings must naturally belong with these products.

${PHOTO_DIRECTION_RULES}

reasoning is one or two sentences on your overall decision (logged, never shown).`;

// Deterministic guard against copy-paste structures: the director is told to
// vary the family, but nothing else guarantees it. Two plans are too similar
// when their section sequences match, when two emails in the same flow open
// with the same section, or when most of one sequence appears in order in the
// other. The later email of each pair is re-planned once.
function longestCommonSubsequence(a: string[], b: string[]): number {
  const row = new Array(b.length + 1).fill(0);
  for (const x of a) {
    let previous = 0;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j];
      row[j] = x === b[j - 1] ? previous + 1 : Math.max(row[j], row[j - 1]);
      previous = current;
    }
  }
  return row[b.length];
}

export function findSimilarPlans(
  plans: Record<string, LifecycleEmailPlan>,
  emails: Array<{ id: string; flow: string }>,
): Array<{ id: string; similarTo: string; reason: string }> {
  const ordered = emails.filter(({ id }) => plans[id]?.sections.length);
  const flagged = new Map<string, { id: string; similarTo: string; reason: string }>();
  for (let j = 1; j < ordered.length; j += 1) {
    const later = ordered[j];
    const b = plans[later.id].sections.map(({ type }) => type);
    for (let i = 0; i < j && !flagged.has(later.id); i += 1) {
      const earlier = ordered[i];
      if (flagged.has(earlier.id)) continue;
      const a = plans[earlier.id].sections.map(({ type }) => type);
      let reason: string | null = null;
      if (a.join(">") === b.join(">")) reason = "the same section sequence";
      else if (earlier.flow === later.flow && a[0] === b[0]) reason = `the same opening section (${a[0]}) in the same flow`;
      else if (Math.min(a.length, b.length) >= 3 && longestCommonSubsequence(a, b) / Math.max(a.length, b.length) >= 0.75)
        reason = "nearly the same section sequence";
      if (reason) flagged.set(later.id, { id: later.id, similarTo: earlier.id, reason });
    }
  }
  return [...flagged.values()];
}

const replanSchema = z.object({ emails: planSchema.shape.emails });

export async function planLifecyclePhotoKit(input: LifecyclePhotoKitPlanInput): Promise<{
  photos: LifecyclePhotoBrief[];
  emailPlans: Record<string, LifecycleEmailPlan>;
  reasoning: string;
  usage: { inputTokens: number; outputTokens: number };
}> {
  const photographed = input.products.filter((product) => product.imageUrl);
  const photoBlocks = photographed.map((product) => ({
    type: "image" as const,
    source: { type: "url" as const, url: product.imageUrl as string },
  }));
  const productLines = input.products.length
    ? input.products
        .map((product) => {
          const index = photographed.indexOf(product);
          const photo =
            index >= 0
              ? `real photo shown as image ${index + 1} (can appear in generated photos)`
              : "no photo (cannot appear in generated photos)";
          const type = product.productType ? `; product type: ${product.productType}` : "";
          const description = product.description ? `; merchant's description: ${product.description}` : "";
          return `- id: ${product.id}; ${product.title}${type}; ${photo}${description}`;
        })
        .join("\n")
    : "No products supplied.";
  const emailLines = input.emails
    .map(
      (email) =>
        `- ${email.id} — flow: ${email.flow} (${email.flowPurpose}); role: ${email.role}` +
        `${email.productIds.length ? `; must show products ${email.productIds.join(", ")}` : ""}` +
        `; brief: ${email.creativeBrief}`,
    )
    .join("\n");

  const response = await getAnthropicClient()
    .messages.stream({
      model: "claude-sonnet-5",
      max_tokens: 24_000,
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
                `Approved brand: ${input.brandSummary}`,
                `Real products (photos above, in order):\n${productLines}`,
                `The email family:\n${emailLines}`,
                "Plan every email and the family's photographs.",
              ].join("\n\n"),
            },
          ],
        },
      ],
    })
    .finalMessage();

  const usage = {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
  const parsed = response.parsed_output;
  if (!parsed || response.stop_reason === "max_tokens") {
    return { photos: [], emailPlans: {}, reasoning: "No plan returned.", usage };
  }

  const referenceable = new Set(photographed.map((product) => product.id));
  const known = new Set(input.products.map((product) => product.id));
  const emailIds = new Set(input.emails.map((email) => email.id));

  const emailPlans: Record<string, LifecycleEmailPlan> = {};
  for (const email of parsed.emails) {
    if (!emailIds.has(email.id) || emailPlans[email.id]) continue;
    emailPlans[email.id] = {
      concept: email.concept,
      sections: email.sections.map((section) => ({
        type: section.type as NewsletterSection["type"],
        purpose: section.purpose,
        productIds: section.productIds.filter((id) => known.has(id)),
        imageKey: section.imageKey,
      })),
    };
  }

  // Re-plan (once) any emails whose structure repeats a sibling's, before a
  // single photo is rendered or line of HTML written.
  const similar = findSimilarPlans(emailPlans, input.emails);
  if (similar.length) {
    const photoKeys = parsed.photos.map(({ key }) => key);
    console.info(
      `Lifecycle plan: re-planning ${similar.map(({ id, similarTo }) => `${id} (like ${similarTo})`).join(", ")}`,
    );
    try {
      const replan = await getAnthropicClient()
        .messages.stream({
          model: "claude-sonnet-5",
          max_tokens: 12_000,
          output_config: { effort: "medium", format: zodOutputFormat(replanSchema) },
          system: SYSTEM_PROMPT,
          messages: [
            {
              role: "user",
              content: [
                `Email family (roles and briefs):\n${emailLines}`,
                `Current plans for every email:\n${JSON.stringify(emailPlans)}`,
                `These emails repeat a sibling's structure and must be re-planned with a clearly different opening section and section sequence, still doing their own role:\n${similar
                  .map(({ id, similarTo, reason }) => `- ${id}: ${reason} as ${similarTo}`)
                  .join("\n")}`,
                `Use only these existing photo keys, or none: ${photoKeys.join(", ") || "(no photos)"}. Do not brief new photos.`,
                "Return plans for only the emails listed above.",
              ].join("\n\n"),
            },
          ],
        })
        .finalMessage();
      usage.inputTokens += replan.usage.input_tokens;
      usage.outputTokens += replan.usage.output_tokens;
      const redoIds = new Set(similar.map(({ id }) => id));
      for (const email of replan.parsed_output?.emails ?? []) {
        if (!redoIds.has(email.id)) continue;
        emailPlans[email.id] = {
          concept: email.concept,
          sections: email.sections.map((section) => ({
            type: section.type as NewsletterSection["type"],
            purpose: section.purpose,
            productIds: section.productIds.filter((id) => known.has(id)),
            imageKey: section.imageKey && photoKeys.includes(section.imageKey) ? section.imageKey : null,
          })),
        };
      }
    } catch (error) {
      // Keep the original plans: a repeated structure is better than none.
      console.error("Lifecycle re-plan failed:", error);
    }
  }

  const seenKeys = new Set<string>();
  const photos = parsed.photos
    // A photo naming a hallucinated or photo-less product can't be rendered
    // faithfully — drop it rather than let the model invent one.
    .filter((photo) => photo.productIds.every((id) => referenceable.has(id)))
    .filter((photo) => {
      if (!photo.key || seenKeys.has(photo.key)) return false;
      seenKeys.add(photo.key);
      return true;
    })
    .map((photo) => ({
      ...photo,
      prompt: [parsed.artDirection.trim(), photo.prompt.trim()].filter(Boolean).join("\n\n"),
      emailIds: Object.entries(emailPlans)
        .filter(([, plan]) => plan.sections.some((section) => section.imageKey === photo.key))
        .map(([id]) => id),
    }))
    // Only photos a plan actually places are worth rendering.
    .filter((photo) => photo.emailIds.length > 0);
  return { photos, emailPlans, reasoning: parsed.reasoning, usage };
}
