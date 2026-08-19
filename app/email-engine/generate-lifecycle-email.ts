import { generateEmailHtml } from "./generate-email";
import { LIFECYCLE_EMAIL_SKELETON_PROMPT } from "./lifecycle-email-prompt";
import type { LifecycleEmail } from "./types";

function buildLifecycleEmailMessage(email: LifecycleEmail): string {
  const products = email.products.length
    ? email.products
        .slice(0, 3)
        .map((product) => {
          const image = product.imageUrl ? `; image: ${product.imageUrl}` : "";
          const url = product.productUrl ? `; URL: ${product.productUrl}` : "";
          return `- ${product.title} — ${product.price}${image}${url}`;
        })
        .join("\n")
    : "No products supplied — do not invent any.";

  return `Generate this exact lifecycle email as a complete HTML document.

Shop: ${email.shopName}
Journey: ${email.sequenceName}
Email: ${email.emailName}
Position: ${email.position} of ${email.sequenceLength}
Timing: ${email.timing}
Objective: ${email.objective}
Customer first name: ${email.customerFirstName ?? "not captured"}
Order number: ${email.orderNumber ?? "not supplied"}
Order total: ${email.orderTotal ?? "not supplied"}
Real recovery URL: ${email.recoveryUrl ?? "not supplied"}
Real review URL: ${email.reviewUrl ?? "not supplied"}
Real products available:
${products}

Invent a tasteful brand skin for ${email.shopName}, but use only the facts and URLs above. Return only the finished HTML document.`;
}

export async function generateLifecycleEmail(email: LifecycleEmail): Promise<string> {
  return generateEmailHtml(
    LIFECYCLE_EMAIL_SKELETON_PROMPT,
    buildLifecycleEmailMessage(email),
    email.language,
    email.tone,
  );
}
