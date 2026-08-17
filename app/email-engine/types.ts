// Platform-neutral shapes. Nothing here should ever import from a Shopify
// module — adapters (Shopify today, WooCommerce/Wix/BigCommerce later) map
// their own data into these before calling the engine.

export interface EmailLineItem {
  title: string;
  quantity: number;
  // Optional: not every skeleton shows a per-item price (a shipping
  // update just lists what's in the box).
  price?: string;
  imageUrl?: string | null;
}

export const EMAIL_LANGUAGES = [
  { code: "en", label: "English" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "it", label: "Italian" },
  { code: "pt", label: "Portuguese" },
  { code: "hi", label: "Hindi" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "zh-CN", label: "Simplified Chinese" },
] as const;

export type EmailLanguage = (typeof EMAIL_LANGUAGES)[number]["code"];

interface LocalizedEmailInput {
  language: EmailLanguage;
}

// null customerFirstName means the name genuinely wasn't captured (guest
// checkout, no name on file) — never a placeholder string. Every prompt
// that consumes this writes real fallback copy for that case instead of
// treating a fallback word as if it were the customer's name.

export interface OrderConfirmationOrder extends LocalizedEmailInput {
  shopName: string;
  customerFirstName: string | null;
  orderNumber: string;
  lineItems: EmailLineItem[];
  total: string;
}

export interface AbandonedCartRecovery extends LocalizedEmailInput {
  shopName: string;
  customerFirstName: string | null;
  lineItems: EmailLineItem[];
  total: string;
  // Shopify's real recovery link — unlike the order-confirmation flow,
  // this email always has somewhere genuine to send the click.
  recoveryUrl: string;
}

export interface ShippingUpdate extends LocalizedEmailInput {
  shopName: string;
  customerFirstName: string | null;
  orderNumber: string;
  lineItems: EmailLineItem[];
  // A plain-language status Shopify already computed (e.g. "in transit",
  // "delivered", "out for delivery") — not a raw enum key.
  fulfillmentStatus: string;
  trackingNumber: string | null;
  carrierName: string | null;
  // null unless Shopify actually resolved a tracking URL for this
  // shipment. The prompt never fabricates one when this is null.
  trackingUrl: string | null;
  // Pre-formatted for display (e.g. "August 20"), or null if Shopify
  // hasn't estimated a delivery date for this shipment.
  estimatedDelivery: string | null;
}

export interface ReviewRequest extends LocalizedEmailInput {
  shopName: string;
  customerFirstName: string | null;
  orderNumber: string;
  lineItems: EmailLineItem[];
  // The real storefront page for the item being reviewed. null when the
  // product isn't published to the Online Store channel — the prompt
  // omits the call-to-action in that case rather than link to a 404.
  reviewUrl: string | null;
}

export interface RefundConfirmation extends LocalizedEmailInput {
  shopName: string;
  customerFirstName: string | null;
  orderNumber: string;
  lineItems: EmailLineItem[];
  refundedTotal: string;
  reason: string | null;
}

export interface NewsletterProduct {
  title: string;
  price: string;
  imageUrl: string | null;
  productUrl: string | null;
}

// Unlike every transactional input above, a campaign starts with the
// merchant's own free-text brief. Product data is supporting context only.
export interface NewsletterCampaign extends LocalizedEmailInput {
  shopName: string;
  prompt: string;
  products: NewsletterProduct[];
}
