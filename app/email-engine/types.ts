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

// Chosen once during onboarding (and adjustable afterward from the same
// language control in the flow header) and threaded through to every
// generation call — see design-system-prompt.ts for what each tone
// actually changes about the shared Voice rules.
export const EMAIL_TONES = [
  { code: "warm-plain", label: "Warm & plain" },
  { code: "bright-bubbly", label: "Bright & bubbly" },
  { code: "calm-minimal", label: "Calm & minimal" },
] as const;

export type EmailTone = (typeof EMAIL_TONES)[number]["code"];

interface LocalizedEmailInput {
  language: EmailLanguage;
  tone: EmailTone;
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

export type LifecycleEmailId =
  | "welcome-1"
  | "welcome-2"
  | "welcome-3"
  | "interest-1"
  | "interest-2"
  | "cart-1"
  | "cart-2"
  | "cart-3"
  | "thank-you"
  | "review-request"
  | "winback-1"
  | "winback-2"
  | "winback-3";

export interface LifecycleEmail extends LocalizedEmailInput {
  id: LifecycleEmailId;
  shopName: string;
  sequenceName: string;
  emailName: string;
  position: number;
  sequenceLength: number;
  timing: string;
  objective: string;
  customerFirstName: string | null;
  products: NewsletterProduct[];
  orderNumber: string | null;
  orderTotal: string | null;
  recoveryUrl: string | null;
  reviewUrl: string | null;
}
