import { generateEmailHtml } from "./generate-email";
import { NEWSLETTER_SKELETON_PROMPT } from "./newsletter-prompt";
import type { NewsletterCampaign } from "./types";

function buildNewsletterMessage(campaign: NewsletterCampaign): string {
  const products = campaign.products.length
    ? campaign.products
        .map((product) => {
          const image = product.imageUrl ? `; image: ${product.imageUrl}` : "";
          const url = product.productUrl ? `; URL: ${product.productUrl}` : "";
          return `- ${product.title} — ${product.price}${image}${url}`;
        })
        .join("\n")
    : "No products supplied — do not invent any.";

  return `Generate a one-prompt newsletter for this shop.

Shop: ${campaign.shopName}
Merchant's campaign brief: ${campaign.prompt}
Real products available as optional supporting material:
${products}

Invent a tasteful, editorial brand skin for "${campaign.shopName}" as described above, since no real brand assets are connected for this shop yet. Return only the finished HTML document.`;
}

export async function generateNewsletterEmail(
  campaign: NewsletterCampaign,
): Promise<string> {
  return generateEmailHtml(
    NEWSLETTER_SKELETON_PROMPT,
    buildNewsletterMessage(campaign),
    campaign.language,
    campaign.tone,
  );
}
