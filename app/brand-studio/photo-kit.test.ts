import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  plan: vi.fn(),
  render: vi.fn(),
}));

vi.mock("../email-engine/lifecycle-photo-kit-plan", () => ({ planLifecyclePhotoKit: mocks.plan }));
vi.mock("../dashboard/generated-photo.server", () => ({
  IMAGE_RENDER_MICROS: 90_000,
  renderReviewedPhoto: mocks.render,
}));
vi.mock("../email-engine/image-generation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../email-engine/image-generation")>()),
  isImageGenerationConfigured: () => true,
}));

import { buildBrandPhotoKit, parsePhotoKit } from "./photo-kit.server";

const brief = (key: string) => ({
  key,
  role: "scene" as const,
  aspect: "landscape" as const,
  productIds: [],
  prompt: "A quiet shelf.",
  alt: "A quiet shelf",
  emailIds: ["welcome-2"],
});

const input = (budgetMicros: number) => ({
  admin: {} as never,
  evidence: { shopName: "Lumen", storefrontUrl: "https://lumen.test", storefrontText: "", products: [] },
  brandSystem: { name: "Weathered Almanac" } as never,
  recipes: [{ id: "welcome-2", creativeBrief: "A brand story.", productIds: [] }] as never,
  budgetMicros,
});

describe("buildBrandPhotoKit", () => {
  beforeEach(() => {
    mocks.plan.mockReset();
    mocks.render.mockReset();
    mocks.plan.mockResolvedValue({
      photos: [brief("a"), brief("b"), brief("c")],
      emailPlans: {
        "welcome-2": {
          concept: "Story",
          sections: [
            { type: "hero-photo", purpose: "Open.", productIds: [], imageKey: "b" },
            { type: "scene-break", purpose: "Pause.", productIds: [], imageKey: "a" },
            { type: "scene-break", purpose: "Pause.", productIds: [], imageKey: "c" },
          ],
        },
      },
      reasoning: "Three moods.",
      usage: { inputTokens: 1_000, outputTokens: 500 },
    });
    mocks.render.mockImplementation(async (_admin, { brief }) => ({
      url: brief.key === "b" ? null : `https://cdn.shopify.com/${brief.key}.jpg`,
      renders: brief.key === "b" ? 2 : 1,
      reviewUsage: { inputTokens: 100, outputTokens: 10 },
    }));
  });

  it("keeps only photos that survived and counts every render and token toward the cost", async () => {
    const kit = await buildBrandPhotoKit(input(3_000_000));
    expect(kit.photos.map(({ key }) => key)).toEqual(["a", "c"]);
    expect(kit.photos[0]).toMatchObject({ url: "https://cdn.shopify.com/a.jpg", emailIds: ["welcome-2"], width: 1536 });
    // 4 renders × 90_000 + anthropic tokens (1_300 in × $2/M + 530 out × $10/M).
    expect(kit.costMicros).toBe(4 * 90_000 + 1_300 * 2 + 530 * 10);
    expect(kit.anthropicUsage).toEqual({ inputTokens: 1_300, outputTokens: 530 });
  });

  it("rebuilds plans around photos that failed", async () => {
    const kit = await buildBrandPhotoKit(input(3_000_000));
    expect(kit.emailPlans["welcome-2"].sections.map(({ type, imageKey }) => [type, imageKey])).toEqual([
      ["hero-typographic", null],
      ["scene-break", "a"],
      ["scene-break", "c"],
    ]);
  });

  it("renders only what fits the remaining budget", async () => {
    // Worst case per photo is 2 × 90_000 + 30_000 = 210_000.
    await buildBrandPhotoKit(input(450_000));
    expect(mocks.render).toHaveBeenCalledTimes(2);
  });

  it("skips planning entirely when not even the plan fits", async () => {
    const kit = await buildBrandPhotoKit(input(100_000));
    expect(mocks.plan).not.toHaveBeenCalled();
    expect(kit).toEqual({ photos: [], emailPlans: {}, costMicros: 0, anthropicUsage: { inputTokens: 0, outputTokens: 0 } });
  });
});

describe("parsePhotoKit", () => {
  it("returns an empty kit for missing or malformed JSON", () => {
    expect(parsePhotoKit(undefined)).toEqual([]);
    expect(parsePhotoKit("not json")).toEqual([]);
    expect(parsePhotoKit('[{"key":"a"}]')).toEqual([]);
  });
});
