import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  plan: vi.fn(),
  write: vi.fn(),
  render: vi.fn(),
}));

vi.mock("../email-engine/campaign-creative-plan", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../email-engine/campaign-creative-plan")>()),
  planCampaignCreative: mocks.plan,
}));
vi.mock("../email-engine/generate-newsletter-email", () => ({ generateNewsletterEmail: mocks.write }));
vi.mock("../dashboard/generated-photo.server", () => ({
  IMAGE_RENDER_MICROS: 90_000,
  renderReviewedPhoto: mocks.render,
}));
vi.mock("../email-engine/image-generation", () => ({
  isImageGenerationConfigured: () => true,
  imageDimensions: () => ({ width: 1200, height: 800 }),
}));

import { generateLifecycleEmailsWithCampaignEngine } from "./campaign-engine.server";
import { LUMEN_DEMO_BRAND_SYSTEM, LUMEN_DEMO_EVIDENCE, LUMEN_DEMO_RECIPES } from "../dashboard/lumen-demo";

const product = {
  ...LUMEN_DEMO_EVIDENCE.products[0],
  imageUrl: "https://cdn.shopify.com/canopy.png?v=1",
  productUrl: "https://lumen.example.com/products/canopy",
};
const evidence = { ...LUMEN_DEMO_EVIDENCE, storefrontUrl: "https://lumen.example.com", products: [product] };
const recipes = LUMEN_DEMO_RECIPES.map((recipe) => ({ ...recipe, productIds: [] }));

// Passes the Brand Studio quality gate: document, viewport, 600px, one h1,
// brand paper/ink plus a brand color, the product photo and a real link.
const goodHtml = (label: string, extra = "") =>
  `<!doctype html><html><head><meta name="viewport" content="width=device-width"></head><body style="background:#fffaf3;color:#1d1a18"><table style="max-width:600px;border-color:#b96f52"><tr><td><h1>${label}</h1><a href="${product.productUrl}"><img src="${product.imageUrl}" alt="Canopy" width="600"></a>${extra}<img src="https://pending-photo.nomi.invalid/scene.jpg" alt="Shelf" width="600"></td></tr></table></body></html>`;

const slotRow = `<table data-nomi-slot="items"><tr data-nomi-item><td><a data-nomi-field="item-url" href="${product.productUrl}"><img data-nomi-field="image" src="${product.imageUrl}" alt="Canopy" width="96"></a><p data-nomi-field="title">Canopy</p><p data-nomi-field="quantity"></p><p data-nomi-field="price"></p></td></tr></table><a data-nomi-field="action-url" href="https://lumen.example.com">Return</a>`;

const base = {
  admin: { graphql: vi.fn() },
  evidence,
  brandSystem: LUMEN_DEMO_BRAND_SYSTEM,
  recipes,
  language: "en" as const,
  tone: "warm-plain" as const,
};

describe("generateLifecycleEmailsWithCampaignEngine", () => {
  beforeEach(() => {
    mocks.plan.mockReset();
    mocks.write.mockReset();
    mocks.render.mockReset();
    mocks.plan.mockResolvedValue({
      concept: "A quiet shelf",
      reasoning: "",
      images: [{ key: "scene", role: "scene", aspect: "landscape", productIds: [], prompt: "A shelf.", alt: "Shelf" }],
      sections: [
        { type: "hero-typographic", purpose: "Open", productIds: [], imageKey: null },
        { type: "scene-break", purpose: "Pause", productIds: [], imageKey: "scene" },
        { type: "closing-band", purpose: "Close", productIds: [], imageKey: null },
      ],
      usage: { inputTokens: 100, outputTokens: 50 },
    });
    mocks.render.mockResolvedValue({ url: "https://cdn.shopify.com/scene.jpg", renders: 1, reviewUsage: { inputTokens: 10, outputTokens: 5 } });
    mocks.write.mockImplementation(async ({ prompt }: { prompt: string }) =>
      goodHtml("Email", /data-nomi-slot/.test(prompt) ? slotRow : ""),
    );
  });

  it("builds each missing email through the campaign pipeline with a lifecycle brief, and checkpoints per flow", async () => {
    const existingRendered = Object.fromEntries(
      recipes.filter(({ id }) => !id.startsWith("welcome-")).map(({ id }) => [id, `<p>${id} kept</p>`]),
    );
    const onCheckpoint = vi.fn();
    const result = await generateLifecycleEmailsWithCampaignEngine({ ...base, existingRendered, onCheckpoint });

    expect(mocks.write).toHaveBeenCalledTimes(3);
    expect(result.value["cart-1"]).toBe("<p>cart-1 kept</p>");
    expect(result.value["welcome-1"]).toContain('src="https://cdn.shopify.com/scene.jpg"');
    expect(result.value["welcome-1"]).not.toContain("pending-photo.nomi.invalid");

    const welcome1 = mocks.write.mock.calls.map(([call]) => call).find((call) => call.brandIdentity.referenceRecipe.headline === recipes[0].headline);
    expect(welcome1.prompt).toContain('email 1 of 3 in Lumen\'s "Welcome" lifecycle flow');
    expect(welcome1.prompt).toContain(recipes[0].creativeBrief);
    expect(welcome1.prompt).toContain("paper #fffaf3 and ink #1d1a18");
    expect(welcome1.prompt).toContain("genuine visual moment");
    // Welcome-1 always gets a real photographed hero product, at its exact URL.
    expect(welcome1.products).toEqual([expect.objectContaining({ id: product.id, imageUrl: product.imageUrl })]);
    expect(welcome1.sections.map(({ type }: { type: string }) => type)).toEqual(["hero-typographic", "scene-break", "closing-band"]);
    expect(welcome1.generatedImages[0].url).toContain("pending-photo.nomi.invalid");

    expect(onCheckpoint).toHaveBeenCalledTimes(3);
    expect(onCheckpoint.mock.calls.at(-1)?.[0]).toMatchObject({ flowId: "welcome", flowComplete: true });
    // Spend went out through the checkpoints, so it isn't returned twice.
    expect(result.costMicros).toBe(0);
    expect(onCheckpoint.mock.calls.reduce((sum, [checkpoint]) => sum + checkpoint.costMicros, 0)).toBeGreaterThan(0);
  });

  it("rewrites an email once, with the exact problems, when it fails the quality gate", async () => {
    mocks.write
      .mockResolvedValueOnce(goodHtml("Email").replace("<h1>Email</h1>", "<h2>Email</h2>"))
      .mockResolvedValueOnce(goodHtml("Fixed"));
    const existingRendered = Object.fromEntries(recipes.filter(({ id }) => id !== "winback-2").map(({ id }) => [id, "<p>kept</p>"]));
    const result = await generateLifecycleEmailsWithCampaignEngine({ ...base, existingRendered });

    expect(mocks.write).toHaveBeenCalledTimes(2);
    expect(mocks.write.mock.calls[1][0].prompt).toContain("exactly one primary heading");
    // The retry reuses the photos already rendered, at their hosted URLs.
    expect(mocks.write.mock.calls[1][0].generatedImages[0].url).toBe("https://cdn.shopify.com/scene.jpg");
    expect(mocks.render).toHaveBeenCalledTimes(1);
    expect(result.value["winback-2"]).toContain("<h1>Fixed</h1>");
    expect(result.costMicros).toBeGreaterThan(0);
  });

  it("gives cart and review emails the personal-slot markup and a real product row", async () => {
    const existingRendered = Object.fromEntries(recipes.filter(({ id }) => id !== "cart-1").map(({ id }) => [id, "<p>kept</p>"]));
    const result = await generateLifecycleEmailsWithCampaignEngine({ ...base, existingRendered });

    const call = mocks.write.mock.calls[0][0];
    expect(call.prompt).toContain('data-nomi-slot="items"');
    expect(call.products).toEqual([expect.objectContaining({ id: product.id })]);
    expect(result.value["cart-1"]).toContain("data-nomi-slot");
    expect(mocks.write).toHaveBeenCalledTimes(1);
  });

  it("builds a cart email around one preview product even when its brief names several", async () => {
    const second = { ...product, id: "lumen-second", imageUrl: "https://cdn.shopify.com/second.png" };
    const existingRendered = Object.fromEntries(recipes.filter(({ id }) => id !== "cart-2").map(({ id }) => [id, "<p>kept</p>"]));
    const result = await generateLifecycleEmailsWithCampaignEngine({
      ...base,
      evidence: { ...evidence, products: [product, second] },
      recipes: recipes.map((recipe) => (recipe.id === "cart-2" ? { ...recipe, productIds: [product.id, second.id] } : recipe)),
      existingRendered,
    });

    expect(mocks.write.mock.calls[0][0].products.map(({ id }: { id: string }) => id)).toEqual([product.id]);
    // One slot row is enough for the gate: no rewrite was needed.
    expect(mocks.write).toHaveBeenCalledTimes(1);
    expect(result.value["cart-2"]).toContain("data-nomi-item");
  });

  it("rebuilds only the requested email with the merchant's direction, keeping every sibling", async () => {
    const existingRendered = Object.fromEntries(recipes.map(({ id }) => [id, `<p>${id} kept</p>`]));
    const result = await generateLifecycleEmailsWithCampaignEngine({
      ...base,
      existingRendered,
      onlyId: "winback-3",
      merchantDirection: "Real discount to show: code \"BACK10\" for 10% off.",
    });

    expect(mocks.write).toHaveBeenCalledTimes(1);
    expect(mocks.write.mock.calls[0][0].prompt).toContain('code "BACK10"');
    expect(mocks.plan.mock.calls[0][0].hasDiscountCode).toBe(true);
    expect(result.value["winback-3"]).toContain("<h1>Email</h1>");
    for (const recipe of recipes) {
      if (recipe.id !== "winback-3") expect(result.value[recipe.id]).toBe(`<p>${recipe.id} kept</p>`);
    }
  });

  it("names the emails it could not build", async () => {
    mocks.write.mockRejectedValue(new Error("Claude did not return any HTML for this email."));
    const existingRendered = Object.fromEntries(recipes.filter(({ id }) => id !== "thank-you").map(({ id }) => [id, "<p>kept</p>"]));
    await expect(generateLifecycleEmailsWithCampaignEngine({ ...base, existingRendered })).rejects.toThrow(
      "Nomi could not build one email (thank-you). Claude did not return any HTML for this email.",
    );
  });
});
