import { generateEmailHtml } from "./generate-email";
import { REVIEW_REQUEST_SKELETON_PROMPT } from "./review-request-prompt";
import type { ReviewRequest } from "./types";

function buildReviewMessage(request: ReviewRequest): string {
  const lineItems = request.lineItems
    .map((item) => {
      const image = item.imageUrl ? ` (image: ${item.imageUrl})` : "";
      return `- ${item.title} × ${item.quantity}${image}`;
    })
    .join("\n");

  const customerFirstName = request.customerFirstName
    ? request.customerFirstName
    : "not given — this order has no customer name attached, write a name-free headline per the rules above";

  const reviewUrl =
    request.reviewUrl ?? "not given — omit the call-to-action button entirely";

  return `Generate the review-request email for this order.

Shop: ${request.shopName}
Customer first name: ${customerFirstName}
Order: ${request.orderNumber}
Line items delivered:
${lineItems}
Review URL: ${reviewUrl}

Invent a tasteful, editorial brand skin for "${request.shopName}" as described above, since no real brand assets are connected for this shop yet. Return only the finished HTML document.`;
}

export async function generateReviewRequestEmail(
  request: ReviewRequest,
): Promise<string> {
  return generateEmailHtml(
    REVIEW_REQUEST_SKELETON_PROMPT,
    buildReviewMessage(request),
    request.language,
  );
}
