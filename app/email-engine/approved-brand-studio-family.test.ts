import { describe, expect, it } from "vitest";
import { getApprovedBrandStudioFamily } from "../brand-studio/approved-family";
import { BRAND_STUDIO_LIFECYCLE_IDS } from "../brand-studio/types";
import {
  LUMEN_DEMO_BRAND_SYSTEM,
  LUMEN_DEMO_DIRECTION,
  LUMEN_DEMO_EVIDENCE,
  LUMEN_DEMO_RECIPES,
} from "../dashboard/lumen-demo";

const renderedEmails = Object.fromEntries(
  BRAND_STUDIO_LIFECYCLE_IDS.map((id) => [
    id,
    `<!doctype html><html><body><h1>${id}</h1><p>${"Approved Brand Studio email. ".repeat(5)}</p></body></html>`,
  ]),
);
const validEvidence = {
  ...LUMEN_DEMO_EVIDENCE,
  products: LUMEN_DEMO_EVIDENCE.products.map((product) => ({
    ...product,
    imageUrl: null,
  })),
};

// creativeDirectionsSchema requires exactly 3 directions (Brand Studio always
// presents 3 options and stores all of them, even after one is selected).
const directions = [
  LUMEN_DEMO_DIRECTION,
  { ...LUMEN_DEMO_DIRECTION, id: "lumen-alt-a" },
  { ...LUMEN_DEMO_DIRECTION, id: "lumen-alt-b" },
];

function completeProfile() {
  return {
    status: "complete",
    evidence: JSON.stringify(validEvidence),
    brandSystem: JSON.stringify(LUMEN_DEMO_BRAND_SYSTEM),
    lifecycleRecipes: JSON.stringify(LUMEN_DEMO_RECIPES),
    renderedEmails: JSON.stringify(renderedEmails),
    evidenceFingerprint: "evidence-v1",
    snapshotEvidenceFingerprint: "evidence-v1",
    generatedEvidenceFingerprint: "evidence-v1",
    directions: JSON.stringify(directions),
    selectedDirectionId: LUMEN_DEMO_DIRECTION.id,
  };
}

describe("approved Brand Studio family boundary", () => {
  it("accepts a complete fingerprint-matched 13-email family", () => {
    const family = getApprovedBrandStudioFamily(completeProfile());

    expect(family?.recipes).toHaveLength(13);
    expect(Object.keys(family?.renderedEmails ?? {})).toHaveLength(13);
    expect(family?.brandSystem.name).toBe(LUMEN_DEMO_BRAND_SYSTEM.name);
    expect(family?.direction.id).toBe(LUMEN_DEMO_DIRECTION.id);
  });

  it("rejects when the stored direction no longer matches the brand system's directionId", () => {
    expect(
      getApprovedBrandStudioFamily({
        ...completeProfile(),
        brandSystem: JSON.stringify({
          ...LUMEN_DEMO_BRAND_SYSTEM,
          directionId: "no-such-direction",
        }),
      }),
    ).toBeNull();
  });

  it("rejects a profile before Brand Studio completes", () => {
    expect(
      getApprovedBrandStudioFamily({ ...completeProfile(), status: "building" }),
    ).toBeNull();
  });

  it("rejects mismatched evidence fingerprints", () => {
    expect(
      getApprovedBrandStudioFamily({
        ...completeProfile(),
        generatedEvidenceFingerprint: "different-evidence",
      }),
    ).toBeNull();
  });

  it("rejects a completed record with any missing rendered email", () => {
    const incomplete = { ...renderedEmails };
    delete incomplete["cart-3"];

    expect(
      getApprovedBrandStudioFamily({
        ...completeProfile(),
        renderedEmails: JSON.stringify(incomplete),
      }),
    ).toBeNull();
  });
});
