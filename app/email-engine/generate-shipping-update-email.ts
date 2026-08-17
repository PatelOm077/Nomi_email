import { generateEmailHtml } from "./generate-email";
import { SHIPPING_UPDATE_SKELETON_PROMPT } from "./shipping-update-prompt";
import type { ShippingUpdate } from "./types";

function buildShippingMessage(update: ShippingUpdate): string {
  const lineItems = update.lineItems
    .map((item) => {
      const image = item.imageUrl ? ` (image: ${item.imageUrl})` : "";
      return `- ${item.title} × ${item.quantity}${image}`;
    })
    .join("\n");

  const customerFirstName = update.customerFirstName
    ? update.customerFirstName
    : "not given — this order has no customer name attached, write a name-free headline per the rules above";

  const trackingNumber = update.trackingNumber ?? "not given";
  const carrierName = update.carrierName ?? "not given";
  const trackingUrl = update.trackingUrl ?? "not given — omit the call-to-action button entirely";
  const estimatedDelivery = update.estimatedDelivery ?? "not given";

  return `Generate the shipping-update email for this order.

Shop: ${update.shopName}
Customer first name: ${customerFirstName}
Order: ${update.orderNumber}
Fulfillment status: ${update.fulfillmentStatus}
Line items being shipped:
${lineItems}
Tracking number: ${trackingNumber}
Carrier: ${carrierName}
Tracking URL: ${trackingUrl}
Estimated delivery: ${estimatedDelivery}

Invent a tasteful, editorial brand skin for "${update.shopName}" as described above, since no real brand assets are connected for this shop yet. Return only the finished HTML document.`;
}

export async function generateShippingUpdateEmail(
  update: ShippingUpdate,
): Promise<string> {
  return generateEmailHtml(
    SHIPPING_UPDATE_SKELETON_PROMPT,
    buildShippingMessage(update),
    update.language,
  );
}
