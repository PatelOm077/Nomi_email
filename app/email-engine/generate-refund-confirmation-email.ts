import { generateEmailHtml } from "./generate-email";
import { REFUND_CONFIRMATION_SKELETON_PROMPT } from "./refund-confirmation-prompt";
import type { RefundConfirmation } from "./types";

function buildRefundMessage(refund: RefundConfirmation): string {
  const lineItems = refund.lineItems
    .map((item) => {
      const price = item.price ? ` — ${item.price}` : "";
      const image = item.imageUrl ? ` (image: ${item.imageUrl})` : "";
      return `- ${item.title} × ${item.quantity}${price}${image}`;
    })
    .join("\n");
  const customerFirstName = refund.customerFirstName
    ? refund.customerFirstName
    : "not given — write a name-free headline";
  const reason = refund.reason ?? "not given — omit the reason entirely";

  return `Generate the refund-confirmation email for this refund.

Shop: ${refund.shopName}
Customer first name: ${customerFirstName}
Order: ${refund.orderNumber}
Refunded line items:
${lineItems}
Refunded total: ${refund.refundedTotal}
Refund reason: ${reason}

Invent a tasteful, editorial brand skin for "${refund.shopName}" as described above, since no real brand assets are connected for this shop yet. Return only the finished HTML document.`;
}

export async function generateRefundConfirmationEmail(
  refund: RefundConfirmation,
): Promise<string> {
  return generateEmailHtml(
    REFUND_CONFIRMATION_SKELETON_PROMPT,
    buildRefundMessage(refund),
    refund.language,
  );
}
