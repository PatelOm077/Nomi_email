import { generateEmailHtml } from "./generate-email";
import { ORDER_CONFIRMATION_SKELETON_PROMPT } from "./order-confirmation-prompt";
import type { OrderConfirmationOrder } from "./types";

function buildOrderMessage(order: OrderConfirmationOrder): string {
  const lineItems = order.lineItems
    .map((item) => {
      const image = item.imageUrl ? ` (image: ${item.imageUrl})` : "";
      return `- ${item.title} × ${item.quantity} — ${item.price}${image}`;
    })
    .join("\n");

  const customerFirstName = order.customerFirstName
    ? order.customerFirstName
    : "not given — this order has no customer name attached, write a name-free greeting per the rules above";

  return `Generate the order confirmation email for this order.

Shop: ${order.shopName}
Customer first name: ${customerFirstName}
Order: ${order.orderNumber}
Line items:
${lineItems}
Order total: ${order.total}

Invent a tasteful, editorial brand skin for "${order.shopName}" as described above, since no real brand assets are connected for this shop yet. Return only the finished HTML document.`;
}

export async function generateOrderConfirmationEmail(
  order: OrderConfirmationOrder,
): Promise<string> {
  return generateEmailHtml(
    ORDER_CONFIRMATION_SKELETON_PROMPT,
    buildOrderMessage(order),
    order.language,
  );
}
