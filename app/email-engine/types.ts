// Platform-neutral shapes. Nothing here should ever import from a Shopify
// module — adapters (Shopify today, WooCommerce/Wix/BigCommerce later) map
// their own data into these before calling the engine.

export interface EmailLineItem {
  title: string;
  quantity: number;
  // Optional: not every lifecycle message shows a per-item price.
  price?: string;
  imageUrl?: string | null;
}

export const EMAIL_LANGUAGES = [
  { code: "en", label: "English" },
  { code: "es", label: "Spanish" },
  { code: "de", label: "German" },
  { code: "fr", label: "French" },
  { code: "pt", label: "Portuguese (Brazil)" },
  { code: "it", label: "Italian" },
  { code: "ja", label: "Japanese" },
  { code: "nl", label: "Dutch" },
  { code: "zh-CN", label: "Simplified Chinese" },
  { code: "ko", label: "Korean" },
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

export interface EmailBrandIdentity {
  system: {
    name: string;
    audience: string;
    feeling: string;
    palette: { paper: string; ink: string; primary: string; accent: string };
    typography: { display: string; body: string; fallback: string };
    voice: {
      principles: string[];
      preferredWords: string[];
      avoidWords: string[];
    };
    layoutRules: string[];
    imageTreatment: string;
    buttonTreatment: string;
    signatureMotif: string;
  };
  logoUrl: string | null;
  referenceRecipe: {
    subject: string;
    preheader: string;
    eyebrow: string;
    headline: string;
    body: string;
    ctaLabel: string;
    creativeBrief: string;
  } | null;
}

interface LocalizedEmailInput {
  language: EmailLanguage;
  tone: EmailTone;
  brandIdentity?: EmailBrandIdentity;
}

// null customerFirstName means the name genuinely wasn't captured (guest
// checkout, no name on file) — never a placeholder string. Every prompt
// that consumes this writes real fallback copy for that case instead of
// treating a fallback word as if it were the customer's name.

export interface AbandonedCartRecovery extends LocalizedEmailInput {
  shopName: string;
  customerFirstName: string | null;
  lineItems: EmailLineItem[];
  total: string;
  // Shopify's real recovery link. This message always has somewhere genuine
  // to send the click.
  recoveryUrl: string;
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

export interface NewsletterProduct {
  // The real Shopify product id, threaded through to the prompt so a
  // generated product <img>/<a> can be tagged data-nomi-product-id for the
  // Campaigns seam editor (see newsletter-prompt.ts rule 9 and
  // app/routes/app.campaigns_.edit.tsx).
  id: string;
  title: string;
  price: string;
  imageUrl: string | null;
  productUrl: string | null;
  // A background-removed cutout of the same photo, when one was available
  // (see app/email-engine/background-removal.ts) — null whenever background
  // removal isn't configured or the call failed. The prompt is told to use
  // this only when the composition calls for an isolated product shot,
  // never both versions of the same product at once.
  cutoutImageUrl: string | null;
  // What the product actually is, from the merchant's own catalogue. Absent
  // or null when not loaded or not filled in — never guessed.
  productType?: string | null;
  description?: string | null;
}

// An AI-generated photograph planned for this specific campaign (see
// campaign-creative-plan.ts and image-generation.ts), already hosted at a
// real public URL and passed the image review. Never carries text beyond a
// real product's own label; productIds are the real products it shows, each
// generated from that product's real photo as a reference.
export interface NewsletterGeneratedImage {
  key: string;
  url: string;
  alt: string;
  role: "hero" | "editorial" | "look" | "scene";
  width: number;
  height: number;
  productIds: string[];
}

// The section library the campaign creative director plans from and the
// newsletter skeleton knows how to build (see newsletter-prompt.ts).
export const CAMPAIGN_SECTION_TYPES = [
  "hero-typographic",
  "hero-photo",
  "editorial-split",
  "scene-break",
  "product-feature",
  "product-grid",
  "get-the-look",
  "ritual-steps",
  "benefit-row",
  "pull-statement",
  "discount-voucher",
  "closing-band",
  "category-chips",
] as const;

export type CampaignSectionType = (typeof CAMPAIGN_SECTION_TYPES)[number];

export interface NewsletterSection {
  type: CampaignSectionType;
  purpose: string;
  productIds: string[];
  imageKey: string | null;
}

// A real storefront collection page, for category chips and general CTAs.
export interface NewsletterCollectionLink {
  title: string;
  url: string;
}

// Unlike event-driven lifecycle inputs, a campaign starts with the
// merchant's own free-text brief. Product data is supporting context only.
export interface NewsletterCampaign extends LocalizedEmailInput {
  shopName: string;
  prompt: string;
  products: NewsletterProduct[];
  // Empty or absent whenever image generation is off, failed, or the
  // planner decided the campaign didn't need photography.
  generatedImages?: NewsletterGeneratedImage[];
  // The creative director's section plan and one-line concept. Absent
  // means the designer composes freely, exactly as before.
  concept?: string | null;
  sections?: NewsletterSection[];
  // Real destinations beyond product pages: collection pages and the
  // storefront homepage. Never guessed.
  collections?: NewsletterCollectionLink[];
  storefrontUrl?: string | null;
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
