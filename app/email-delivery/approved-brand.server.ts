import db from "../db.server";
import { getApprovedBrandStudioFamily } from "../brand-studio/approved-family";
import type { EmailBrandIdentity, LifecycleEmailId } from "../email-engine/types";
import { personalSlotProblems } from "../email-engine/personal-slots";

const REFERENCE_BY_TOPIC: Record<string, LifecycleEmailId | null> = {
  CHECKOUTS_UPDATE: "cart-1",
  FULFILLMENTS_UPDATE: "review-request",
};

export type ApprovedPersonalEmail = {
  html: string;
  subject: string;
  storefrontUrl: string | null;
};

// The approved cart-1 / review-request email, sent as-is with the customer's
// items filled in by code (email-engine/personal-slots.ts). Null when the
// family isn't approved or this email predates the slot markup, in which case
// the worker generates the email instead.
export async function loadApprovedPersonalEmail(
  shop: string,
  topic: string,
): Promise<ApprovedPersonalEmail | null> {
  const referenceId = REFERENCE_BY_TOPIC[topic] ?? null;
  if (!referenceId) return null;
  const profile = await db.brandStudioProfile.findUnique({ where: { shop } });
  const approvedFamily = getApprovedBrandStudioFamily(profile);
  if (!approvedFamily) return null;
  const html = approvedFamily.renderedEmails[referenceId];
  const recipe = approvedFamily.recipes.find(({ id }) => id === referenceId);
  if (!html || !recipe || personalSlotProblems(html).length) return null;
  return { html, subject: recipe.subject, storefrontUrl: approvedFamily.evidence.storefrontUrl };
}

export async function loadApprovedBrandIdentity(
  shop: string,
  topic: string,
): Promise<EmailBrandIdentity | null | undefined> {
  const profile = await db.brandStudioProfile.findUnique({ where: { shop } });
  if (!profile) return undefined;
  const approvedFamily = getApprovedBrandStudioFamily(profile);
  if (!approvedFamily) return null;
  const referenceId = REFERENCE_BY_TOPIC[topic] ?? null;
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
