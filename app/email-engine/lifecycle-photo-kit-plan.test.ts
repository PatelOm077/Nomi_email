import { describe, expect, it, vi } from "vitest";

const finalMessage = vi.hoisted(() => vi.fn());
vi.mock("./anthropic-client", () => ({
  getAnthropicClient: () => ({ messages: { stream: () => ({ finalMessage }) } }),
}));

import { findSimilarPlans, planLifecyclePhotoKit } from "./lifecycle-photo-kit-plan";

const photo = (overrides: Record<string, unknown>) => ({
  key: "shelf",
  role: "editorial",
  aspect: "portrait",
  productIds: [],
  prompt: "A shelf by a window.",
  alt: "A shelf",
  ...overrides,
});

const section = (type: string, imageKey: string | null = null, productIds: string[] = []) => ({
  type,
  purpose: "Say something.",
  productIds,
  imageKey,
});

describe("planLifecyclePhotoKit", () => {
  it("keeps real plans and only the photos a plan places, dropping invented products and emails", async () => {
    finalMessage.mockResolvedValue({
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5 },
      parsed_output: {
        reasoning: "Welcome first.",
        artDirection: "Soft window light.",
        photos: [
          photo({ key: "shelf" }),
          photo({ key: "shelf" }),
          photo({ key: "fake-product", productIds: ["gid://made-up"] }),
          photo({ key: "no-photo", productIds: ["p2"] }),
          photo({ key: "unplaced" }),
          photo({ key: "cream", productIds: ["p1"] }),
        ],
        emails: [
          { id: "welcome-1", concept: "Hello", sections: [section("hero-photo", "shelf"), section("closing-band")] },
          { id: "thank-you", concept: "Thanks", sections: [section("scene-break", "cream"), section("product-feature", null, ["p1", "gid://made-up"])] },
          { id: "welcome-9", concept: "Not real", sections: [section("scene-break", "unplaced")] },
        ],
      },
    });
    const plan = await planLifecyclePhotoKit({
      shopName: "Lumen",
      brandSummary: "{}",
      products: [
        { id: "p1", title: "Loam", productType: "Cream", description: null, imageUrl: "https://cdn.test/loam.png" },
        { id: "p2", title: "Peat", productType: null, description: null, imageUrl: null },
      ],
      emails: [
        { id: "welcome-1", flow: "Welcome", flowPurpose: "First impression", role: "Hello", creativeBrief: "Brand story.", productIds: [] },
        { id: "thank-you", flow: "How Was It?", flowPurpose: "Care", role: "Thanks", creativeBrief: "Calm thanks.", productIds: ["p1"] },
      ],
    });
    expect(plan.photos.map(({ key }) => key)).toEqual(["shelf", "cream"]);
    expect(plan.photos[0]).toMatchObject({ emailIds: ["welcome-1"], prompt: "Soft window light.\n\nA shelf by a window." });
    expect(Object.keys(plan.emailPlans)).toEqual(["welcome-1", "thank-you"]);
    expect(plan.emailPlans["thank-you"].sections[1].productIds).toEqual(["p1"]);
  });

  it("returns no plan when the output was cut off", async () => {
    finalMessage.mockResolvedValue({ stop_reason: "max_tokens", usage: { input_tokens: 1, output_tokens: 1 }, parsed_output: null });
    const plan = await planLifecyclePhotoKit({ shopName: "Lumen", brandSummary: "{}", products: [], emails: [] });
    expect(plan).toMatchObject({ photos: [], emailPlans: {} });
  });
});

describe("findSimilarPlans", () => {
  const plan = (...types: string[]) => ({
    concept: "",
    sections: types.map((type) => ({ type, purpose: "", productIds: [], imageKey: null })),
  }) as never;
  const emails = [
    { id: "welcome-1", flow: "Welcome" },
    { id: "welcome-2", flow: "Welcome" },
    { id: "cart-1", flow: "Cart" },
    { id: "winback-1", flow: "Winback" },
  ];

  it("flags the later email of an identical, same-opening, or near-identical pair", () => {
    const similar = findSimilarPlans(
      {
        "welcome-1": plan("hero-photo", "pull-statement", "product-feature", "closing-band"),
        "welcome-2": plan("hero-photo", "ritual-steps", "closing-band"),
        "cart-1": plan("product-feature", "benefit-row", "closing-band"),
        "winback-1": plan("hero-typographic", "pull-statement", "product-feature", "closing-band"),
      },
      emails,
    );
    expect(similar.map(({ id, similarTo }) => [id, similarTo])).toEqual([
      ["welcome-2", "welcome-1"],
      ["winback-1", "welcome-1"],
    ]);
    expect(similar[0].reason).toContain("same opening section");
  });

  it("passes a family whose structures differ", () => {
    expect(
      findSimilarPlans(
        {
          "welcome-1": plan("hero-photo", "pull-statement", "closing-band"),
          "welcome-2": plan("editorial-split", "benefit-row", "product-grid"),
          "cart-1": plan("product-feature", "closing-band"),
        },
        emails,
      ),
    ).toEqual([]);
  });
});
