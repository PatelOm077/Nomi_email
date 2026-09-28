import { CAMPAIGN_SECTION_TYPES, type CampaignSectionType } from "./types";

// The section library, shared by every AI email that is planned as a
// sequence of sections: one-prompt campaigns (campaign-creative-plan.ts +
// newsletter-prompt.ts) and the Brand Studio lifecycle family
// (lifecycle-photo-kit-plan.ts + brand-studio/ai.server.ts). The plan guide
// is what a director reads when choosing sections; the build guide is what
// the HTML writer follows to construct each one.

export const SECTION_PLAN_GUIDE: Record<CampaignSectionType, string> = {
  "hero-typographic": "Opening with a large editorial headline and no photo. Needs nothing.",
  "hero-photo": "Opening headline block with a generated photo directly beneath it. Needs imageKey.",
  "editorial-split": "Photo on one side, a short paragraph on the other (stacks on mobile). Needs imageKey.",
  "scene-break": "A full-width generated mood photo used as a breathing pause between sections. Needs imageKey.",
  "product-feature": "One product as a tinted card: real product photo on one side; name, what it is, price, one line, and an outlined button on the other. Needs exactly one productId.",
  "product-grid": "Two or three products as an even grid with real photos, names, and prices. Needs 2–3 productIds.",
  "get-the-look": "Annotated photo: numbered callouts (1., 2., 3.) beside a generated photo that shows those same products styled together, each callout naming one product with one line, joined to the photo edge by a thin leader line and dot. Needs imageKey for a 'look' image and 2–3 productIds that appear in that image.",
  "ritual-steps": "A numbered 1-2-3 routine or how-to-use sequence, each step a short title and one line, optionally with a small real product photo. Needs 2–3 productIds.",
  "benefit-row": "Three or four short benefits in columns divided by thin rules, each a title and one line, marked with a numeral or a simple glyph (✦, ◦). Only benefits stated in the brief or a product description. Needs nothing else.",
  "pull-statement": "One large serif statement line with generous space around it — a typographic pause. Needs nothing.",
  "discount-voucher": "A designed voucher/ticket-stub moment for the real discount code. Only when a discount code is supplied.",
  "closing-band": "A full-width band in the brand's ink or accent colour with a large serif line, one supporting sentence, and an inverted pill button. Needs a real destination to include the button.",
  "category-chips": "A row of outlined pill links to the store's real collections. Only when collections are supplied.",
};

export const SECTION_BUILD_GUIDE: Record<CampaignSectionType, string> = {
  "hero-typographic": "the shop wordmark or logo, an optional small tracked eyebrow, then a very large serif headline (40–56px, tight line-height, an italic word for emphasis if it suits) and one short supporting line, centred with generous space.",
  "hero-photo": "the same headline block, followed directly by the assigned photo at full 600px width.",
  "editorial-split": "a two-column table — the photo in one column, a short serif heading and 2–3 lines of copy in the other, vertically centred.",
  "scene-break": "the assigned photo at full width with generous space above and below, optionally a single short italic caption under it.",
  "product-feature": "a softly tinted rounded card (a near-neutral from the palette) with the real product photo in one column and, in the other, the product name in serif (italic name then a line break works well), a short plain line saying what it is, the price, and an outlined pill button to its product page.",
  "product-grid": "two or three equal columns, each the real product photo on a light tile, the name, the price, and a small outlined button when a product URL exists.",
  "get-the-look": "a centred heading (\"Get the look\" or a phrase that suits the brief) with a short rule under it; then a three-column table — callouts in the outer columns and the assigned photo in the middle column (about 280–320px wide, rounded corners). Each callout is a large serif italic numeral (\"1.\"), the product name in bold sans, and one short line; beside each callout run a thin 1px horizontal leader line (a bordered or background-coloured cell) ending in a small round dot at the photo's edge, vertically aligned with that callout. Alternate callouts left and right. Keep callout text short enough to fit its column at 600px. Finish with an outlined pill button below.",
  "ritual-steps": "a heading, then 2–3 numbered steps in a row (or stacked), each a large serif numeral, a short bold title, one line, and optionally the real product photo small above it.",
  "benefit-row": "a small tracked heading, then 3–4 equal columns separated by thin vertical rules; each column a simple glyph or numeral, a short bold title, and one line. Use only benefits the brief or a product description actually states.",
  "pull-statement": "one large serif sentence, centred, with wide margins and a thin rule or small glyph above it.",
  "discount-voucher": "rule 6's ticket-stub treatment.",
  "closing-band": "a full-width block in the brand's ink or accent colour, a large serif line in the paper colour, one short supporting sentence, and an inverted pill button (paper background, ink text) when a destination exists.",
  "category-chips": "a centred row of outlined pill links (thin border, small sans label, equal padding) to the supplied collection URLs, wrapping to two rows if needed.",
};

// Lifecycle emails have no discount codes or collection links to offer.
export const LIFECYCLE_SECTION_TYPES = CAMPAIGN_SECTION_TYPES.filter(
  (type) => type !== "discount-voucher" && type !== "category-chips",
) as Exclude<CampaignSectionType, "discount-voucher" | "category-chips">[];

export function sectionPlanLibrary(types: readonly CampaignSectionType[]): string {
  return types.map((type) => `- ${type}: ${SECTION_PLAN_GUIDE[type]}`).join("\n");
}

export function sectionBuildLibrary(types: readonly CampaignSectionType[]): string {
  return types.map((type) => `- ${type}: ${SECTION_BUILD_GUIDE[type]}`).join("\n");
}
