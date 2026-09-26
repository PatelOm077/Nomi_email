import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { getAnthropicClient } from "./anthropic-client";
import type { NewsletterProduct } from "./types";

// Quality gate between the image model and the email. A generated photo is
// never shown to a merchant (let alone a customer) until Claude has looked
// at it next to the real product photos and the store's facts. A rejected
// photo gets one regeneration with the reviewer's issues fed back into the
// prompt; if that fails too, the photo is dropped and the email is built
// without it.

const reviewSchema = z.object({
  pass: z.boolean(),
  issues: z.array(z.string()),
});

export type ImageReview = {
  pass: boolean;
  issues: string[];
  usage: { inputTokens: number; outputTokens: number };
};

const SYSTEM_PROMPT = `You are the final photo editor for a merchant's marketing email. You are shown a newly generated photograph (the last image), the brief it was made from, the store's real facts, and — when the photo is meant to show real products — those products' real reference photos (the first images). Reject anything a careful brand's photo editor would not send to customers.

Reject when any of these is true:
1. Wrong store: the scene, props, or implied use belong to a different category than what this store sells.
2. Product fidelity: a product that should appear is missing, or its shape, colour, material, cap, proportions, or label differ noticeably from its reference photo; or an extra product, variant, or packaging appears that the store does not sell. When the brief says no products, any identifiable product or packaging is a failure.
3. Text: any legible or pseudo-text, letters, logos, watermarks, or signage — except a product's own label exactly as in its reference photo.
4. Anatomy and artefacts: malformed hands or fingers, extra limbs, warped faces, melted or duplicated objects, obvious AI smearing.
5. Taste: extreme macro of skin or body parts, product smeared on skin, anything clinical, bodily, or unsettling; anything off-brand for the described identity.
6. It does not match the brief's subject or composition in a way that matters.

Pass only when none apply. issues lists each concrete problem in one short sentence, written so it can be fed back to the image model as a correction. Empty when passing.`;

export async function reviewGeneratedImage(input: {
  imageBytes: Buffer;
  contentType: "image/jpeg";
  brief: string;
  shopName: string;
  products: NewsletterProduct[];
  // Real products the photo is meant to show; empty for product-free photos.
  productIds: string[];
}): Promise<ImageReview> {
  const shown = input.products.filter((product) => input.productIds.includes(product.id));
  const references = shown
    .filter((product) => product.imageUrl)
    .map((product) => ({
      type: "image" as const,
      source: { type: "url" as const, url: product.imageUrl as string },
    }));
  const facts = input.products
    .map(
      (product) =>
        `- ${product.title}${product.productType ? ` (${product.productType})` : ""}${product.description ? `: ${product.description}` : ""}`,
    )
    .join("\n");
  const expected = shown.length
    ? `The photo must show: ${shown.map((product) => product.title).join(", ")} (reference photos first, in that order).`
    : "The photo must show no product or packaging.";

  const response = await getAnthropicClient().messages.parse({
    model: "claude-sonnet-5",
    max_tokens: 2_000,
    output_config: { effort: "low", format: zodOutputFormat(reviewSchema) },
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          ...references,
          {
            type: "image",
            source: {
              type: "base64",
              media_type: input.contentType,
              data: input.imageBytes.toString("base64"),
            },
          },
          {
            type: "text",
            text: `Store: ${input.shopName}\nWhat the store sells:\n${facts || "(no product facts supplied)"}\n${expected}\nBrief the photo was generated from:\n${input.brief}\n\nReview the last image.`,
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
  // No verdict means no evidence the photo is safe — fail closed.
  if (!parsed) return { pass: false, issues: ["The reviewer returned no verdict."], usage };
  return { pass: parsed.pass && parsed.issues.length === 0, issues: parsed.issues, usage };
}
