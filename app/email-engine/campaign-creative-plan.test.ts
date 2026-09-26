import { describe, expect, it } from "vitest";
import { finalizeSections, type CampaignSectionPlan } from "./campaign-creative-plan";

const section = (overrides: Partial<CampaignSectionPlan>): CampaignSectionPlan => ({
  type: "pull-statement",
  purpose: "Say something.",
  productIds: [],
  imageKey: null,
  ...overrides,
});

const context = (
  images: Record<string, string[]> = {},
  { hasCollections = false, hasDiscountCode = false } = {},
) => ({
  availableImages: new Map(
    Object.entries(images).map(([key, productIds]) => [key, { role: "editorial" as const, productIds }]),
  ),
  hasCollections,
  hasDiscountCode,
});

describe("finalizeSections", () => {
  it("downgrades a hero photo whose image was rejected to a typographic hero", () => {
    const result = finalizeSections([section({ type: "hero-photo", imageKey: "hero" })], context());
    expect(result).toEqual([section({ type: "hero-typographic", imageKey: null })]);
  });

  it("drops photo sections whose image is missing and never places one photo twice", () => {
    const result = finalizeSections(
      [
        section({ type: "editorial-split", imageKey: "scene" }),
        section({ type: "scene-break", imageKey: "scene" }),
        section({ type: "scene-break", imageKey: "gone" }),
      ],
      context({ scene: [] }),
    );
    expect(result.map((s) => s.type)).toEqual(["editorial-split"]);
  });

  it("keeps get-the-look only when its photo really shows two or more of its products", () => {
    const plan = [section({ type: "get-the-look", imageKey: "look", productIds: ["a", "b", "c"] })];
    expect(finalizeSections(plan, context({ look: ["a"] }))).toEqual([]);
    expect(finalizeSections(plan, context({ look: ["a", "c"] }))[0].productIds).toEqual(["a", "c"]);
  });

  it("drops chips without collections and vouchers without a real code", () => {
    const plan = [section({ type: "category-chips" }), section({ type: "discount-voucher" })];
    expect(finalizeSections(plan, context())).toEqual([]);
    expect(
      finalizeSections(plan, context({}, { hasCollections: true, hasDiscountCode: true })).map((s) => s.type),
    ).toEqual(["category-chips", "discount-voucher"]);
  });

  it("requires products for product sections", () => {
    const plan = [
      section({ type: "product-feature", productIds: [] }),
      section({ type: "product-grid", productIds: ["a"] }),
      section({ type: "ritual-steps", productIds: ["a", "b"] }),
    ];
    expect(finalizeSections(plan, context()).map((s) => s.type)).toEqual(["ritual-steps"]);
  });
});
