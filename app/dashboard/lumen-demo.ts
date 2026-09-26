import type { DashboardProduct } from "./dashboard-data.server";
import type { BrandEvidence, BrandSystem, CreativeDirection, LifecycleRecipe } from "../brand-studio/types";
import type { LifecycleEmailId } from "../email-engine/types";

// Keep preview photography as normal public assets. Inlining these files turns
// them into data: URLs, which the email compiler intentionally rejects because
// major inboxes do not reliably support embedded base64 product images.
const canopyImage = "/template-looks/lumen-canopy-01.png";
const loamImage = "/template-looks/lumen-loam-01.png";
const peatImage = "/template-looks/lumen-peat-01.png";
const rimeImage = "/template-looks/lumen-rime-01.png";
const rindImage = "/template-looks/lumen-rind-01.png";

// The Flow Editor is a controlled demo surface. It uses Lumen's real local
// catalog and approved brand direction so a merchant never evaluates Nomi
// against an unrelated connected development store. This data never enters delivery jobs.
export const LUMEN_DEMO_SHOP_NAME = "Lumen";

export const LUMEN_DEMO_PRODUCTS: DashboardProduct[] = [
  { id: "lumen-canopy", title: "Canopy", productUrl: null, imageUrl: canopyImage, imageAlt: "Canopy daily protective fluid", price: "$52" },
  { id: "lumen-loam", title: "Loam", productUrl: null, imageUrl: loamImage, imageAlt: "Loam comfort cream", price: "$44" },
  { id: "lumen-peat", title: "Peat", productUrl: null, imageUrl: peatImage, imageAlt: "Peat weather balm", price: "$42" },
  { id: "lumen-rime", title: "Rime", productUrl: null, imageUrl: rimeImage, imageAlt: "Rime multi-use oil", price: "$48" },
  { id: "lumen-rind", title: "Rind", productUrl: null, imageUrl: rindImage, imageAlt: "Rind milk cleanser", price: "$36" },
];

// This is the presentation fixture used by every merchant-facing Nomi route.
// It deliberately contains no customer, order, checkout, or delivery data.
// The authenticated Shopify shop stays available to server-side job handling,
// but its catalog is never rendered into the Lumen demo experience.
export const LUMEN_DEMO_EVIDENCE: BrandEvidence = {
  shopName: LUMEN_DEMO_SHOP_NAME,
  storefrontUrl: null,
  storefrontText: "Lumen makes focused skincare formulas for a shorter, calmer shelf. Choose by the job your skin needs today: cleanse, replenish, comfort, recover, or protect.",
  products: LUMEN_DEMO_PRODUCTS.map((product) => ({
    id: product.id,
    title: product.title,
    description: `A focused Lumen formula for everyday skin comfort.`,
    productType: "Skincare",
    vendor: LUMEN_DEMO_SHOP_NAME,
    tags: ["skincare", "lumen", "focused formula"],
    imageUrl: product.imageUrl,
    productUrl: null,
  })),
};

// The approved creative direction the demo brand system was built from —
// keep `id` in sync with LUMEN_DEMO_BRAND_SYSTEM.directionId, since
// getApprovedBrandStudioFamily matches a stored family to its direction by
// that id.
export const LUMEN_DEMO_DIRECTION: CreativeDirection = {
  id: "lumen-ecosystem",
  name: "Lumen Ecosystem",
  rationale: "Treats skincare as an interconnected system of formulas rather than a routine of steps, giving each email room to focus on one function at a time.",
  palette: ["#fffaf3", "#1d1a18", "#b96f52", "#d8cfc3"],
  typography: {
    display: "Newsreader",
    body: "Manrope",
    character: "Editorial serif headlines over a warm, quietly confident sans body.",
  },
  imageTreatment: "Full product, calm studio light, and generous breathing room.",
  voice: "Quietly intelligent, warm, tactile, and observant — specific about function, never clinical.",
  layoutStyle: "editorial",
  motif: "Skin is an ecosystem",
  sampleHeadline: "Start with the job your skin is asking for.",
  sampleCta: "Meet the formulas",
};

export const LUMEN_DEMO_BRAND_SYSTEM: BrandSystem = {
  directionId: "lumen-ecosystem",
  name: "Lumen Ecosystem",
  audience: "People who want a shorter, calmer skincare shelf.",
  feeling: "Quietly intelligent, warm, tactile, and observant.",
  palette: { paper: "#fffaf3", ink: "#1d1a18", primary: "#b96f52", accent: "#d8cfc3" },
  typography: { display: "Newsreader", body: "Manrope", fallback: "Georgia, serif" },
  voice: {
    principles: ["Name the formula's job.", "Make routines feel lighter.", "Stay specific without clinical overstatement."],
    preferredWords: ["barrier", "comfort", "formula", "shelf", "ecosystem"],
    avoidWords: ["miracle", "flawless", "perfect", "10-step routine"],
  },
  layoutRules: ["Use generous bone space around one clear idea.", "Let product photography stay fully visible.", "Keep CTAs calm and useful."],
  imageTreatment: "Full product, calm studio light, and generous breathing room.",
  buttonTreatment: "Warm terracotta field with precise warm-ink uppercase action text.",
  signatureMotif: "Skin is an ecosystem",
};

type RecipeCopy = Pick<LifecycleRecipe, "subject" | "preheader" | "eyebrow" | "headline" | "body" | "ctaLabel">;

const LUMEN_RECIPE_COPY: Record<LifecycleEmailId, RecipeCopy> = {
  "welcome-1": { subject: "Welcome to Lumen", preheader: "A shorter shelf starts with one useful thing.", eyebrow: "Welcome", headline: "Start with the job your skin is asking for.", body: "Lumen makes focused formulas for the moments your skin needs comfort, moisture, or a little more protection.", ctaLabel: "Meet the formulas" },
  "welcome-2": { subject: "A quieter way to build a routine", preheader: "One formula can do more than a crowded shelf.", eyebrow: "A shorter shelf", headline: "Less routine. More useful care.", body: "Each Lumen formula has one clear role, so it is easier to choose what belongs on your shelf today.", ctaLabel: "See every formula" },
  "welcome-3": { subject: "Choose by function", preheader: "A small edit for the skin you are in.", eyebrow: "Your next step", headline: "Pick the job, not the step.", body: "Cleanse, replenish, comfort, recover, or protect. Start with the function that feels most useful right now.", ctaLabel: "Browse by job" },
  "interest-1": { subject: "A closer look at the formula", preheader: "One useful thing for the skin you are in.", eyebrow: "Still considering", headline: "Make room for the right job.", body: "A quieter shelf begins when each formula earns its place. Take another look when the timing feels right.", ctaLabel: "Return to the formula" },
  "interest-2": { subject: "Your shelf can stay simple", preheader: "A calm reminder to choose only what your skin can use.", eyebrow: "A small reminder", headline: "Keep the good things close.", body: "There is no need to build a bigger routine. Start with one formula designed to support the skin you have today.", ctaLabel: "See the collection" },
  "cart-1": { subject: "Your formula is still here", preheader: "Return when your routine has room for it.", eyebrow: "Your shelf", headline: "One useful thing, saved for later.", body: "Your selected formula is still waiting. Come back when it feels like the right fit for your shelf.", ctaLabel: "Return to your bag" },
  "cart-2": { subject: "A quiet reminder from Lumen", preheader: "Your bag is ready whenever your routine has room.", eyebrow: "Still here", headline: "Care can wait for the right moment.", body: "We saved your selection so you can return to it without rushing a decision or crowding your shelf.", ctaLabel: "View your bag" },
  "cart-3": { subject: "Keep the shelf you mean to keep", preheader: "Your saved formula is ready when the timing feels right.", eyebrow: "Last note", headline: "A shorter shelf starts with a choice.", body: "If this formula still feels useful, it is ready to join the rest of your routine whenever you choose.", ctaLabel: "Return to your bag" },
  "thank-you": { subject: "Thank you for choosing Lumen", preheader: "A note from the formula team for the shelf ahead.", eyebrow: "With thanks", headline: "Thank you for making room for useful care.", body: "We are glad a Lumen formula has a place on your shelf. Use it slowly, notice what changes, and keep what helps.", ctaLabel: "Meet the rest of Lumen" },
  "review-request": { subject: "How is your formula fitting in?", preheader: "Your notes help us keep care useful.", eyebrow: "A small check-in", headline: "How is your skin meeting it?", body: "A few honest words about how the formula feels in your routine help other people choose with more confidence.", ctaLabel: "Share your notes" },
  "winback-1": { subject: "A small edit for your shelf", preheader: "See which kind of care might feel useful to your skin now.", eyebrow: "A return note", headline: "Your skin does not stand still.", body: "As seasons and routines change, a different kind of care can become useful. Here is a calm place to begin again.", ctaLabel: "Revisit the formulas" },
  "winback-2": { subject: "What your shelf might need now", preheader: "A quieter way back to the care your skin can use.", eyebrow: "A fresh look", headline: "Start where comfort matters most.", body: "Choose one formula by function, give it time to work, and let the rest of the shelf stay quiet.", ctaLabel: "Browse by job" },
  "winback-3": { subject: "Lumen is here when it is useful", preheader: "No rush, only a useful place to begin again when you are ready.", eyebrow: "Until next time", headline: "Keep what supports your skin.", body: "Whenever you are ready for a smaller, more considered routine, the Lumen formulas are here to support your next season.", ctaLabel: "Meet Lumen" },
};

const LUMEN_CREATIVE_BRIEFS: Record<LifecycleEmailId, string> = {
  "welcome-1": "Introduce Lumen with a commanding product-world thesis. Let one real formula or a deliberate group establish the brand before the copy; avoid a conventional logo-image-headline stack.",
  "welcome-2": "Create an intimate, letter-like ritual with restrained product imagery and unexpected editorial pacing. It must not reuse the opening email's silhouette or image scale.",
  "welcome-3": "Turn product choice into a highly visual guide organised by customer need. Use the real catalogue as information, not as a repeated row of interchangeable cards.",
  "interest-1": "Make one formula the entire argument through scale, detail, annotation, or negative space. The message should feel like a closer look, not a smaller welcome email.",
  "interest-2": "Build a calm consideration story around a deliberately edited shelf. Change alignment, section rhythm, and product relationship from the first consideration email.",
  "cart-1": "Design a direct recovery composition where the saved product and return action are immediately legible. Keep it concise but unmistakably Lumen rather than a generic cart card.",
  "cart-2": "Use restraint and whitespace as the idea: a quiet saved-for-later note with a different silhouette, CTA position, and image role from the first recovery message.",
  "cart-3": "Create a decisive final reminder led by graphic typography or an unexpected single-product composition. Do not repeat either earlier cart structure and do not invent urgency.",
  "thank-you": "Make this feel personal and post-purchase: a generous thank-you note, a useful ritual, and optional supporting product context. It should not look promotional.",
  "review-request": "Create a focused feedback moment with the purchased formula as context. Make the response action obvious without turning the email into another product campaign.",
  "winback-1": "Reintroduce Lumen through a seasonal editorial idea that feels visually new. Photography or typography may dominate, but the composition must signal a fresh chapter.",
  "winback-2": "Present a newly curated shelf with catalogue intelligence and strong hierarchy. Avoid the same grid, crop, or headline placement used anywhere earlier in the family.",
  "winback-3": "Close the sequence with a minimal, confident open-door message. Use reduction as art direction while retaining one memorable Lumen-specific visual decision.",
};

export const LUMEN_DEMO_RECIPES: LifecycleRecipe[] = Object.entries(LUMEN_RECIPE_COPY).map(([id, copy]) => ({
  id: id as LifecycleEmailId,
  ...copy,
  creativeBrief: LUMEN_CREATIVE_BRIEFS[id as LifecycleEmailId],
  productIds: [],
}));
