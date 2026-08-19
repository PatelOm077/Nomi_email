import { generateEmailHtml } from "./generate-email";
import { ABANDONED_CART_SKELETON_PROMPT } from "./abandoned-cart-prompt";
import type { AbandonedCartRecovery } from "./types";

function buildCartMessage(cart: AbandonedCartRecovery): string {
  const lineItems = cart.lineItems
    .map((item) => {
      const image = item.imageUrl ? ` (image: ${item.imageUrl})` : "";
      return `- ${item.title} × ${item.quantity} — ${item.price}${image}`;
    })
    .join("\n");

  const customerFirstName = cart.customerFirstName
    ? cart.customerFirstName
    : "not given — this cart has no customer name attached, write a name-free hook per the rules above";

  return `Generate the abandoned-cart-recovery email for this cart.

Shop: ${cart.shopName}
Customer first name: ${customerFirstName}
Line items:
${lineItems}
Cart total: ${cart.total}
Recovery URL: ${cart.recoveryUrl}

Invent a tasteful, editorial brand skin for "${cart.shopName}" as described above, since no real brand assets are connected for this shop yet. Return only the finished HTML document.`;
}

export async function generateAbandonedCartEmail(
  cart: AbandonedCartRecovery,
): Promise<string> {
  return generateEmailHtml(
    ABANDONED_CART_SKELETON_PROMPT,
    buildCartMessage(cart),
    cart.language,
    cart.tone,
  );
}
