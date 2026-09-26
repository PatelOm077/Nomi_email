import { BRAND_STUDIO_LIFECYCLE_IDS } from "./types";
import type {
  BrandEvidence,
  BrandSnapshot,
  BrandSystem,
  CreativeDirection,
  LifecycleRecipe,
} from "./types";

const snapshot: BrandSnapshot = {
  summary:
    "A considered essentials store with quiet confidence, natural materials, and products designed to earn a place in everyday routines.",
  positioning:
    "Useful, design-conscious goods for people who value restraint over novelty.",
  audienceSuggestion:
    "Thoughtful shoppers who buy fewer, better things and notice material, utility, and lasting design.",
  feelingSuggestion:
    "Calm, tactile, quietly assured, and human — never precious or over-polished.",
  evidence: [
    { label: "Material language", value: "Natural texture and construction lead the product story.", source: "product", confidence: "high" },
    { label: "Visual rhythm", value: "Generous space and restrained colour create an editorial pace.", source: "storefront", confidence: "high" },
    { label: "Offer shape", value: "A focused catalogue suggests considered purchasing rather than impulse.", source: "shopify", confidence: "medium" },
  ],
};

const directions: CreativeDirection[] = [
  {
    id: "field-notes",
    name: "Field Notes",
    rationale: "Warm editorial pacing makes each message feel observed, useful, and collected over time.",
    palette: ["#f4f0e7", "#22201d", "#536454", "#c56f4e"],
    typography: { display: "Literary serif", body: "Quiet grotesk", character: "Measured, warm, and materially aware" },
    imageTreatment: "Natural light, full product proportions, and visible material detail.",
    voice: "Specific and grounded, with the ease of a well-kept notebook.",
    layoutStyle: "editorial",
    motif: "Fine annotation rules",
    sampleHeadline: "Made for the days you keep.",
    sampleCta: "Explore the edit",
  },
  {
    id: "useful-form",
    name: "Useful Form",
    rationale: "A product-led system foregrounds function while a crisp grid keeps the identity recognisable.",
    palette: ["#f0f1ed", "#17211e", "#315c52", "#efb64d"],
    typography: { display: "Condensed sans", body: "Humanist sans", character: "Direct, intelligent, and energetic" },
    imageTreatment: "Clean product studies paired with one purposeful technical detail.",
    voice: "Clear, concise, and confident about what each object does.",
    layoutStyle: "product-led",
    motif: "Measured grid marks",
    sampleHeadline: "Good design gets used.",
    sampleCta: "See how it works",
  },
  {
    id: "soft-signal",
    name: "Soft Signal",
    rationale: "An expressive narrative direction brings emotion forward without losing the store's restraint.",
    palette: ["#f7eff0", "#291e24", "#8a395e", "#91b8b1"],
    typography: { display: "Expressive serif", body: "Neutral sans", character: "Intimate, spacious, and quietly memorable" },
    imageTreatment: "Cropped gestures, human context, and gentle tonal colour.",
    voice: "Inviting and personal, with short lines and a restrained sense of wonder.",
    layoutStyle: "narrative",
    motif: "Offset colour signal",
    sampleHeadline: "A small shift in the everyday.",
    sampleCta: "Come closer",
  },
];

const brandSystem: BrandSystem = {
  directionId: "field-notes",
  name: "Field Notes",
  audience: snapshot.audienceSuggestion,
  feeling: snapshot.feelingSuggestion,
  palette: { paper: "#f4f0e7", ink: "#22201d", primary: "#536454", accent: "#c56f4e" },
  typography: { display: "Literary serif", body: "Quiet grotesk", fallback: "Georgia, Arial, sans-serif" },
  voice: { principles: ["Be specific", "Stay useful", "Leave room to breathe"], preferredWords: ["made", "kept", "considered"], avoidWords: ["must-have", "obsessed", "hurry"] },
  layoutRules: ["Use one clear idea per email", "Keep product images at their natural ratio", "Use fine rules as quiet annotations"],
  imageTreatment: "Natural light, full product proportions, and visible material detail.",
  buttonTreatment: "Compact moss buttons with direct, sentence-case labels.",
  signatureMotif: "Fine annotation rules",
};

const lifecycleRecipes: LifecycleRecipe[] = BRAND_STUDIO_LIFECYCLE_IDS.map((id, index) => ({
  id,
  subject: `A considered note ${index + 1}`,
  preheader: "Useful details, chosen with care.",
  eyebrow: "Field Notes",
  headline: `Made for the days you keep — ${index + 1}`,
  body: "A quiet, useful message shaped around the product and the moment it belongs to.",
  ctaLabel: "Explore the edit",
  creativeBrief: `Create an original editorial composition for lifecycle moment ${index + 1}; change the silhouette, image role, pacing, and CTA relationship from every sibling email while preserving the Field Notes identity.`,
  productIds: [index % 2 ? "review-product-2" : "review-product-1"],
}));

const evidence: BrandEvidence = {
  shopName: "Lumen",
  storefrontUrl: null,
  storefrontText: "",
  products: [
    { id: "review-product-1", title: "Everyday form", description: "", productType: "", vendor: "", tags: [], imageUrl: "/template-looks/denizen-vector-01.png", productUrl: null },
    { id: "review-product-2", title: "Material study", description: "", productType: "", vendor: "", tags: [], imageUrl: "/template-looks/denizen-material-macro.png", productUrl: null },
  ],
  assets: {
    logoUrl: null,
    observedColors: ["#f4f0e7", "#22201d", "#536454", "#c56f4e"],
    fontHints: ["Lora", "IBM Plex Sans"],
    palette: { paper: "#f4f0e7", ink: "#22201d", primary: "#536454", accent: "#c56f4e" },
    theme: { id: "review-theme", name: "Published theme", updatedAt: null, checksum: "review" },
    buttonRadiusPx: 0,
  },
};

export function getBrandStudioReviewPage(
  step: string,
  replayMode = false,
  reviewBuilding = false,
  evidenceStatus: "current" | "refresh-needed" = "current",
) {
  const safeStep = ["welcome", "snapshot", "creating", "directions", "confirm", "complete"].includes(step) ? step : "snapshot";
  return {
    shopName: evidence.shopName,
    evidence,
    step: safeStep as "welcome" | "snapshot" | "creating" | "directions" | "confirm" | "complete",
    reviewMode: true,
    reviewBuilding,
    replayMode,
    profile: {
      status: safeStep === "complete" ? "complete" : safeStep === "confirm" ? "selected" : "directions",
      snapshot,
      audience: snapshot.audienceSuggestion,
      feeling: snapshot.feelingSuggestion,
      directions,
      selectedDirectionId: "field-notes",
      refinement: null,
      brandSystem,
      lifecycleRecipes,
      estimatedCostMicros: safeStep === "complete" ? 1_840_000 : 680_000,
      currentBuildCostMicros: safeStep === "complete" ? 1_840_000 : 680_000,
      evidenceStatus,
    },
  };
}
