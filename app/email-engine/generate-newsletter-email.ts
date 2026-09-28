import { EmailCutOffError, generateEmailHtml } from "./generate-email";
import { NEWSLETTER_SKELETON_PROMPT } from "./newsletter-prompt";
import type { NewsletterCampaign } from "./types";

// With an approved Brand Studio identity, the campaign wears that brand
// instead of inventing a fresh skin for every send.
function brandDirection(campaign: NewsletterCampaign): string {
  const identity = campaign.brandIdentity;
  if (!identity) {
    return `Invent a tasteful, editorial brand skin for "${campaign.shopName}" as described above, since no real brand assets are connected for this shop yet.`;
  }
  const logo = identity.logoUrl
    ? `Use this real logo image at the top of the email: ${identity.logoUrl} (width attribute only, height:auto, alt "${campaign.shopName}"), tagged data-nomi-seam="logo".`
    : `No logo image is available; set the brand name "${campaign.shopName}" as a deliberate typographic wordmark.`;
  return `This merchant has an approved Brand Studio identity. It overrides the "Brand skin" section: do not invent a different palette, typography character, or voice. Carry its palette, typography character, voice principles, preferred and avoided words, image treatment, button treatment, and signature motif into this campaign while still building the campaign-specific composition the skeleton asks for.
The brand's name is exactly "${campaign.shopName}" — use it for the wordmark, alt text, and footer. The identity's own "name" field is an internal label for the creative direction and must never appear in the email, so it is omitted below.
Approved identity JSON:
${JSON.stringify({ ...identity.system, name: undefined })}
${logo}`;
}

function buildNewsletterMessage(campaign: NewsletterCampaign): string {
  const products = campaign.products.length
    ? campaign.products
        .map((product) => {
          const image = product.imageUrl ? `; image: ${product.imageUrl}` : "";
          const cutout = product.cutoutImageUrl
            ? `; cutoutImageUrl (same product, background removed): ${product.cutoutImageUrl}`
            : "";
          const url = product.productUrl ? `; URL: ${product.productUrl}` : "";
          const type = product.productType ? `; product type: ${product.productType}` : "";
          const description = product.description
            ? `; merchant's description: ${product.description}`
            : "";
          return `- ${product.title} — ${product.price}${type}${image}${cutout}${url}; id: ${product.id}${description}`;
        })
        .join("\n")
    : "No products supplied — do not invent any.";

  const generatedImages = campaign.generatedImages?.length
    ? campaign.generatedImages
        .map((image) => {
          const shows = image.productIds.length
            ? `; shows real products ${image.productIds.join(", ")}`
            : "; shows no product";
          return `- key ${image.key}: ${image.role} photo (${image.width}x${image.height}): ${image.url}; alt: ${image.alt}${shows}`;
        })
        .join("\n")
    : null;

  const sections = campaign.sections?.length
    ? campaign.sections
        .map((section, index) => {
          const shows = section.productIds.length ? `; products: ${section.productIds.join(", ")}` : "";
          const photo = section.imageKey ? `; photo: ${section.imageKey}` : "";
          return `${index + 1}. ${section.type} — ${section.purpose}${shows}${photo}`;
        })
        .join("\n")
    : null;

  const destinations = [
    campaign.storefrontUrl ? `Storefront homepage: ${campaign.storefrontUrl}` : null,
    ...(campaign.collections ?? []).map(({ title, url }) => `Collection "${title}": ${url}`),
  ].filter(Boolean);

  return `Generate a one-prompt newsletter for this shop.

Shop: ${campaign.shopName}
Merchant's campaign brief: ${campaign.prompt}
Real products available as optional supporting material:
${products}
${destinations.length ? `Other real destinations (per rule 5):\n${destinations.join("\n")}\n` : ""}${generatedImages ? `Photographs generated for this campaign (use each one exactly once, per rule 4b):\n${generatedImages}\n` : ""}${sections ? `Art director's section plan${campaign.concept ? ` — concept: ${campaign.concept}` : ""} (build exactly these, in order, per the section library):\n${sections}\n` : ""}
${brandDirection(campaign)}

Ground every word in what this store actually sells: describe each product only as what its product type, description, and name say it is, never as a different category of thing. Return only the finished HTML document.`;
}

// Medium effort: the composition is already planned upstream by the creative
// director, and medium brings a campaign to ~1.5 min (high took ~3.5).
// 24k covers an art-directed email written compactly.
const NEWSLETTER_OPTIONS = { maxTokens: 24_000, effort: "medium" } as const;

const COMPACT_RETRY_NOTE =
  "\n\nA previous attempt at this email ran out of room before the document finished. Build the same plan again, more economically: tighter copy, simpler constructed graphics, and the most compact table markup that still looks designed. Finishing the document matters more than any single flourish.";

export async function generateNewsletterEmail(
  campaign: NewsletterCampaign,
): Promise<string> {
  const message = buildNewsletterMessage(campaign);
  try {
    return await generateEmailHtml(
      NEWSLETTER_SKELETON_PROMPT,
      message,
      campaign.language,
      campaign.tone,
      NEWSLETTER_OPTIONS,
    );
  } catch (error) {
    if (!(error instanceof EmailCutOffError)) throw error;
    // One compact retry keeps the same plan and photos rather than failing
    // the whole campaign over length.
    console.warn("Campaign email ran out of room; retrying compactly.");
    return generateEmailHtml(
      NEWSLETTER_SKELETON_PROMPT,
      message + COMPACT_RETRY_NOTE,
      campaign.language,
      campaign.tone,
      NEWSLETTER_OPTIONS,
    );
  }
}
