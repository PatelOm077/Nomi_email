import db from "../db.server";
import { getApprovedBrandStudioFamily } from "../brand-studio/approved-family";
import type { EmailBrandIdentity, LifecycleEmailId } from "../email-engine/types";
import { needsPersonalSlots, personalSlotProblems } from "../email-engine/personal-slots";

export type ApprovedPersonalEmail = {
  html: string;
  subject: string;
  storefrontUrl: string | null;
};

// The approved Brand Studio email for one lifecycle step. Cart and review
// emails are sent with the customer's items filled in by code
// (email-engine/personal-slots.ts), so those must carry the slot markup;
// the others are sent as designed. Null when the family isn't approved or a
// slot email predates the markup (the worker then generates cart/review).
export async function loadApprovedPersonalEmail(
  shop: string,
  referenceId: LifecycleEmailId | null,
): Promise<ApprovedPersonalEmail | null> {
  if (!referenceId) return null;
  const profile = await db.brandStudioProfile.findUnique({ where: { shop } });
  const approvedFamily = getApprovedBrandStudioFamily(profile);
  if (!approvedFamily) return null;
  const html = approvedFamily.renderedEmails[referenceId];
  const recipe = approvedFamily.recipes.find(({ id }) => id === referenceId);
  if (!html || !recipe) return null;
  if (needsPersonalSlots(referenceId) && personalSlotProblems(html).length) return null;
  return { html, subject: recipe.subject, storefrontUrl: approvedFamily.evidence.storefrontUrl };
}

export async function loadApprovedBrandIdentity(
  shop: string,
  referenceId: LifecycleEmailId | null,
): Promise<EmailBrandIdentity | null | undefined> {
  const profile = await db.brandStudioProfile.findUnique({ where: { shop } });
  if (!profile) return undefined;
  const approvedFamily = getApprovedBrandStudioFamily(profile);
  if (!approvedFamily) return null;
  const reference = referenceId
    ? approvedFamily.recipes.find(({ id }) => id === referenceId) ?? null
    : null;
  return {
    system: approvedFamily.brandSystem,
    logoUrl: approvedFamily.evidence.assets?.logoUrl ?? null,
    referenceRecipe: reference
      ? {
          subject: reference.subject,
          preheader: reference.preheader,
          eyebrow: reference.eyebrow,
          headline: reference.headline,
          body: reference.body,
          ctaLabel: reference.ctaLabel,
          creativeBrief: reference.creativeBrief,
        }
      : null,
  };
}
