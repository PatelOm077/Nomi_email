import { hardenMobileBoxSizing } from "../email-engine/mobile-box-sizing";
import {
  BRAND_STUDIO_LIFECYCLE_IDS,
  brandEvidenceSchema,
  brandSystemSchema,
  creativeDirectionsSchema,
  lifecycleRecipesSchema,
  renderedEmailsSchema,
  safeJson,
  type BrandEvidence,
  type BrandSystem,
  type CreativeDirection,
  type LifecycleRecipe,
  type RenderedEmails,
} from "./types";

export type BrandStudioFamilyRecord = {
  status: string;
  evidence: string;
  brandSystem: string;
  lifecycleRecipes: string;
  renderedEmails: string;
  evidenceFingerprint: string;
  snapshotEvidenceFingerprint: string;
  generatedEvidenceFingerprint: string;
  directions: string;
  selectedDirectionId: string | null;
};

export type ApprovedBrandStudioFamily = {
  evidence: BrandEvidence;
  brandSystem: BrandSystem;
  direction: CreativeDirection;
  recipes: LifecycleRecipe[];
  renderedEmails: RenderedEmails;
  evidenceFingerprint: string;
};

/**
 * The direction actually baked into the approved brand system, with the
 * merchant's approved storefront palette substituted in — mirrors the
 * buildDirection logic in app.brand-studio.tsx's finalize action so both
 * call sites stay in sync instead of duplicating the palette-override rule.
 */
export function applyEvidencePalette(
  direction: CreativeDirection,
  evidence: BrandEvidence,
): CreativeDirection {
  const approvedPalette = evidence.assets?.palette;
  if (!approvedPalette) return direction;
  return {
    ...direction,
    palette: [
      approvedPalette.paper,
      approvedPalette.ink,
      approvedPalette.primary,
      approvedPalette.accent,
    ],
  };
}

/** The acceptance boundary between Brand Studio and every downstream consumer. */
export function getApprovedBrandStudioFamily(
  profile: BrandStudioFamilyRecord | null | undefined,
): ApprovedBrandStudioFamily | null {
  if (
    !profile ||
    profile.status !== "complete" ||
    !profile.evidenceFingerprint ||
    profile.evidenceFingerprint === "legacy-unverified" ||
    profile.evidenceFingerprint !== profile.snapshotEvidenceFingerprint ||
    profile.evidenceFingerprint !== profile.generatedEvidenceFingerprint
  )
    return null;

  const evidence = safeJson(profile.evidence, brandEvidenceSchema, null);
  const brandSystem = safeJson(profile.brandSystem, brandSystemSchema, null);
  const recipes = safeJson(profile.lifecycleRecipes, lifecycleRecipesSchema, []);
  const renderedEmails = safeJson(
    profile.renderedEmails,
    renderedEmailsSchema,
    {},
  );
  if (!evidence || !brandSystem || recipes.length !== 13) return null;
  if (
    BRAND_STUDIO_LIFECYCLE_IDS.some((id) => !renderedEmails[id]?.trim())
  )
    return null;

  const directions = safeJson(profile.directions, creativeDirectionsSchema, null);
  const direction = directions?.find(({ id }) => id === brandSystem.directionId);
  if (!direction) return null;

  return {
    evidence,
    brandSystem,
    direction,
    recipes,
    // Emails stored before the phone-width fix get it on every read, so
    // previews, the editor, and sends never overflow on small screens.
    renderedEmails: Object.fromEntries(
      Object.entries(renderedEmails).map(([id, html]) => [id, hardenMobileBoxSizing(html)]),
    ) as typeof renderedEmails,
    evidenceFingerprint: profile.evidenceFingerprint,
  };
}
