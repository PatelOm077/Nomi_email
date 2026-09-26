import db from "../db.server";
import { getApprovedBrandStudioFamily } from "../brand-studio/approved-family";
import type { EmailBrandIdentity, LifecycleEmailId } from "../email-engine/types";

const REFERENCE_BY_TOPIC: Record<string, LifecycleEmailId | null> = {
  CHECKOUTS_UPDATE: "cart-1",
  FULFILLMENTS_UPDATE: "review-request",
};

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
