import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateCreativeEmailFamilyWithSonnet } from "../brand-studio/ai.server";
import {
  LUMEN_DEMO_BRAND_SYSTEM,
  LUMEN_DEMO_EVIDENCE,
  LUMEN_DEMO_RECIPES,
} from "../dashboard/lumen-demo";

const streamMessage = vi.hoisted(() => vi.fn());

vi.mock("./anthropic-client", () => ({
  getAnthropicClient: () => ({
    messages: { stream: streamMessage },
  }),
}));

const direction = {
  id: "lumen-ecosystem",
  name: "Lumen Ecosystem",
  rationale: "Matches the approved Lumen identity.",
  palette: ["#fffaf3", "#1d1a18", "#b96f52", "#d8cfc3"] as [
    string,
    string,
    string,
    string,
  ],
  typography: {
    display: "Newsreader",
    body: "Manrope",
    character: "Editorial warmth with a quiet utility layer.",
  },
  imageTreatment: LUMEN_DEMO_BRAND_SYSTEM.imageTreatment,
  motif: LUMEN_DEMO_BRAND_SYSTEM.signatureMotif,
  voice: "Warm, specific, and restrained.",
  layoutStyle: "editorial" as const,
  sampleHeadline: "Skin is an ecosystem",
  sampleCta: "Meet the formulas",
};

const safeHtml = (id: string, extra = "") =>
  `<!doctype html><html><head><meta name="viewport" content="width=device-width"></head><body style="background:#fffaf3;color:#1d1a18"><table role="presentation" style="max-width:600px;color:#b96f52;border-color:#d8cfc3"><tr><td><h1>${id}</h1>${extra}</td></tr></table></body></html>`;

// Cart and review emails must carry the personal-slot markup the send
// worker fills (email-engine/personal-slots.ts).
const slotted = (id: string, product: { imageUrl: string; productUrl: string }, storefrontUrl: string) =>
  safeHtml(
    id,
    `<table data-nomi-slot="items"><tr data-nomi-item><td><a data-nomi-field="item-url" href="${product.productUrl}"><img data-nomi-field="image" src="${product.imageUrl.replace(/&/g, "&amp;")}" alt="Canopy" width="96"></a><p data-nomi-field="title">Canopy</p><p data-nomi-field="quantity"></p><p data-nomi-field="price"></p></td></tr></table><a data-nomi-field="action-url" href="${storefrontUrl}">Return</a>`,
  );

const modelResponse = (parsed_output: unknown, inputTokens = 10) => ({
  stop_reason: "end_turn",
  parsed_output,
  usage: { input_tokens: inputTokens, output_tokens: 5 },
});

describe("Brand Studio AI generation guards", () => {
  beforeEach(() => {
    streamMessage.mockReset();
  });

  it("rejects a merchant identity mismatch before making an AI request", async () => {
    await expect(
      generateCreativeEmailFamilyWithSonnet({
        evidence: LUMEN_DEMO_EVIDENCE,
        brandSystem: LUMEN_DEMO_BRAND_SYSTEM,
        direction,
        recipes: LUMEN_DEMO_RECIPES,
        refinement: null,
        expectedShopName: "Not Lumen",
      }),
    ).rejects.toThrow(
      "Brand identity mismatch: expected Not Lumen, received Lumen. No AI request was made.",
    );
  });

  it("requests only a missing email and sends its exact product contract", async () => {
    const product = {
      ...LUMEN_DEMO_EVIDENCE.products[0],
      imageUrl: "https://cdn.shopify.com/canopy.png?v=1&width=1200",
      productUrl: "https://example.com/products/canopy",
    };
    const evidence = {
      ...LUMEN_DEMO_EVIDENCE,
      storefrontUrl: "https://example.com",
      products: [product],
    };
    const recipes = LUMEN_DEMO_RECIPES.map((recipe) =>
      recipe.id === "cart-3" ? { ...recipe, productIds: [product.id] } : recipe,
    );
    const existingRendered = Object.fromEntries(
      recipes
        .filter(({ id }) => id !== "cart-3")
        .map(({ id }) => [id, safeHtml(id)]),
    );
    streamMessage
      .mockReturnValueOnce({
        finalMessage: async () =>
          modelResponse({
            emails: [
              {
                id: "cart-3",
                html: slotted("cart-3", product, evidence.storefrontUrl),
              },
            ],
          }),
      })
      .mockReturnValueOnce({
        finalMessage: async () => modelResponse({ revisions: [] }),
      });

    const result = await generateCreativeEmailFamilyWithSonnet({
      evidence,
      brandSystem: LUMEN_DEMO_BRAND_SYSTEM,
      direction,
      recipes,
      refinement: null,
      existingRendered,
    });

    expect(result.value["cart-3"]).toContain(
      product.imageUrl.replace("&", "&amp;"),
    );
    const firstRequest = streamMessage.mock.calls[0][0];
    const payload = JSON.parse(firstRequest.messages[0].content);
    expect(payload.recipes).toHaveLength(1);
    expect(payload.recipes[0]).toMatchObject({
      id: "cart-3",
      requiredProductImages: [{ id: product.id, url: product.imageUrl }],
      requiredDestinations: [
        { id: product.id, url: product.productUrl },
        { id: "storefront", url: evidence.storefrontUrl },
      ],
    });
  });

  it("forces welcome-1 to include a hero product when it has none and a real product photo exists", async () => {
    const product = {
      ...LUMEN_DEMO_EVIDENCE.products[0],
      imageUrl: "https://cdn.shopify.com/canopy.png",
      productUrl: "https://example.com/products/canopy",
    };
    const evidence = { ...LUMEN_DEMO_EVIDENCE, products: [product] };
    const recipes = LUMEN_DEMO_RECIPES; // welcome-1 starts with productIds: []
    const existingRendered = Object.fromEntries(
      recipes
        .filter(({ id }) => id !== "welcome-1")
        .map(({ id }) => [id, safeHtml(id)]),
    );
    streamMessage
      .mockReturnValueOnce({
        finalMessage: async () =>
          modelResponse({
            emails: [
              {
                id: "welcome-1",
                html: safeHtml(
                  "welcome-1",
                  `<a href="${product.productUrl}"><img src="${product.imageUrl}" alt="Canopy" width="600" height="600"></a>`,
                ),
              },
            ],
          }),
      })
      .mockReturnValueOnce({
        finalMessage: async () => modelResponse({ revisions: [] }),
      });

    await generateCreativeEmailFamilyWithSonnet({
      evidence,
      brandSystem: LUMEN_DEMO_BRAND_SYSTEM,
      direction,
      recipes,
      refinement: null,
      existingRendered,
    });

    const payload = JSON.parse(streamMessage.mock.calls[0][0].messages[0].content);
    const welcomeRecipe = payload.recipes.find(
      (recipe: { id: string }) => recipe.id === "welcome-1",
    );
    expect(welcomeRecipe.productIds).toEqual([product.id]);
    expect(welcomeRecipe.requiredProductImages).toEqual([
      { id: product.id, title: product.title, url: product.imageUrl },
    ]);
  });

  it("leaves welcome-1 product-free when no supplied product has a real photo", async () => {
    const evidence = {
      ...LUMEN_DEMO_EVIDENCE,
      products: LUMEN_DEMO_EVIDENCE.products.map((product) => ({
        ...product,
        imageUrl: null,
      })),
    };
    const recipes = LUMEN_DEMO_RECIPES;
    const existingRendered = Object.fromEntries(
      recipes
        .filter(({ id }) => id !== "welcome-1")
        .map(({ id }) => [id, safeHtml(id)]),
    );
    streamMessage
      .mockReturnValueOnce({
        finalMessage: async () =>
          modelResponse({
            emails: [{ id: "welcome-1", html: safeHtml("welcome-1") }],
          }),
      })
      .mockReturnValueOnce({
        finalMessage: async () => modelResponse({ revisions: [] }),
      });

    await generateCreativeEmailFamilyWithSonnet({
      evidence,
      brandSystem: LUMEN_DEMO_BRAND_SYSTEM,
      direction,
      recipes,
      refinement: null,
      existingRendered,
    });

    const payload = JSON.parse(streamMessage.mock.calls[0][0].messages[0].content);
    const welcomeRecipe = payload.recipes.find(
      (recipe: { id: string }) => recipe.id === "welcome-1",
    );
    expect(welcomeRecipe.productIds).toEqual([]);
  });

  it("skips the family-wide critique pass and leaves untouched emails byte-identical when skipCritique is set", async () => {
    const recipes = LUMEN_DEMO_RECIPES;
    const existingRendered = Object.fromEntries(
      recipes
        .filter(({ id }) => id !== "winback-3")
        .map(({ id }) => [id, safeHtml(id)]),
    );

    streamMessage.mockReturnValueOnce({
      finalMessage: async () =>
        modelResponse({
          emails: [{ id: "winback-3", html: safeHtml("winback-3") }],
        }),
    });

    const result = await generateCreativeEmailFamilyWithSonnet({
      evidence: LUMEN_DEMO_EVIDENCE,
      brandSystem: LUMEN_DEMO_BRAND_SYSTEM,
      direction,
      recipes,
      refinement: null,
      existingRendered,
      skipCritique: true,
    });

    // Only the one pending flow's generation call — no critique call at all.
    expect(streamMessage).toHaveBeenCalledTimes(1);
    expect(result.value["winback-3"]).toContain("winback-3");
    for (const [id, html] of Object.entries(existingRendered)) {
      expect(result.value[id]).toBe(html);
    }
  });

  it("regenerateOnlyId trusts every sibling verbatim, even an invalid one, and asks Claude to vary from the previous HTML", async () => {
    const recipes = LUMEN_DEMO_RECIPES;
    const staleSibling = "<!doctype html><html><body>too short to pass audit</body></html>";
    const previousHtml = safeHtml("winback-3", "<p>old composition</p>");
    const existingRendered = {
      ...Object.fromEntries(
        recipes
          .filter(({ id }) => id !== "winback-3" && id !== "winback-1")
          .map(({ id }) => [id, safeHtml(id)]),
      ),
      "winback-1": staleSibling,
      "winback-3": previousHtml,
    };

    streamMessage.mockReturnValueOnce({
      finalMessage: async () =>
        modelResponse({
          emails: [{ id: "winback-3", html: safeHtml("winback-3-new", "<p>new composition</p>") }],
        }),
    });

    const result = await generateCreativeEmailFamilyWithSonnet({
      evidence: LUMEN_DEMO_EVIDENCE,
      brandSystem: LUMEN_DEMO_BRAND_SYSTEM,
      direction,
      recipes,
      refinement: null,
      existingRendered,
      skipCritique: true,
      regenerateOnlyId: "winback-3",
    });

    // Only one Sonnet call, for the single targeted recipe.
    expect(streamMessage).toHaveBeenCalledTimes(1);
    expect(result.value["winback-3"]).toContain("winback-3-new");
    // The stale sibling is trusted as-is, never re-validated or sent to Claude.
    expect(result.value["winback-1"]).toBe(staleSibling);

    const payload = JSON.parse(streamMessage.mock.calls[0][0].messages[0].content);
    expect(payload.recipes).toHaveLength(1);
    expect(payload.recipes[0]).toMatchObject({
      id: "winback-3",
      previousHtml,
      regenerateInstruction: expect.stringContaining("Do not preserve the old layout"),
    });
  });

  it("regenerateAll forces every email to be authored again and treats previous HTML as a negative reference", async () => {
    const recipes = LUMEN_DEMO_RECIPES.filter(({ id }) =>
      id.startsWith("welcome-"),
    );
    const existingRendered = Object.fromEntries(
      recipes.map(({ id }) => [id, safeHtml(id, "<p>old composition</p>")]),
    );
    streamMessage
      .mockReturnValueOnce({
        finalMessage: async () =>
          modelResponse({
            emails: recipes.map(({ id }) => ({
              id,
              html: safeHtml(`${id}-new`, "<p>new composition</p>"),
            })),
          }),
      })
      .mockReturnValueOnce({
        finalMessage: async () => modelResponse({ revisions: [] }),
      });

    const result = await generateCreativeEmailFamilyWithSonnet({
      // No products: this test is about the regenerateAll instruction
      // wording, not the welcome-1 hero-product requirement, and the
      // fixture's mocked HTML below never includes a product image.
      evidence: { ...LUMEN_DEMO_EVIDENCE, products: [] },
      brandSystem: LUMEN_DEMO_BRAND_SYSTEM,
      direction,
      recipes,
      refinement: null,
      existingRendered,
      regenerateAll: true,
    });

    expect(streamMessage).toHaveBeenCalledTimes(2);
    for (const recipe of recipes)
      expect(result.value[recipe.id]).toContain(`${recipe.id}-new`);

    const payload = JSON.parse(streamMessage.mock.calls[0][0].messages[0].content);
    expect(payload.recipes).toHaveLength(recipes.length);
    for (const recipe of payload.recipes) {
      expect(recipe.previousHtml).toBe(existingRendered[recipe.id]);
      expect(recipe.regenerateInstruction).toContain("negative reference");
      expect(recipe.regenerateInstruction).toContain("section order and rhythm");
      expect(recipe.regenerateInstruction).toContain("Do not preserve the old layout");
    }
  });

  it("checkpoints valid siblings when one repaired email still fails", async () => {
    const product = {
      ...LUMEN_DEMO_EVIDENCE.products[0],
      imageUrl: "https://cdn.shopify.com/canopy.png",
      productUrl: "https://example.com/products/canopy",
    };
    const evidence = {
      ...LUMEN_DEMO_EVIDENCE,
      storefrontUrl: "https://example.com",
      products: [product],
    };
    const recipes = LUMEN_DEMO_RECIPES.map((recipe) =>
      recipe.id === "cart-3" ? { ...recipe, productIds: [product.id] } : recipe,
    );
    const existingRendered = Object.fromEntries(
      recipes
        .filter(({ id }) => !id.startsWith("cart-"))
        .map(({ id }) => [id, safeHtml(id)]),
    );
    streamMessage
      .mockReturnValueOnce({
        finalMessage: async () =>
          modelResponse({
            emails: [
              { id: "cart-1", html: slotted("cart-1", product, evidence.storefrontUrl) },
              { id: "cart-2", html: slotted("cart-2", product, evidence.storefrontUrl) },
              { id: "cart-3", html: safeHtml("cart-3") },
            ],
          }),
      })
      .mockReturnValueOnce({
        finalMessage: async () =>
          modelResponse({
            emails: [{ id: "cart-3", html: safeHtml("cart-3-repair") }],
          }),
      });
    const onCheckpoint = vi.fn();

    await expect(
      generateCreativeEmailFamilyWithSonnet({
        evidence,
        brandSystem: LUMEN_DEMO_BRAND_SYSTEM,
        direction,
        recipes,
        refinement: null,
        existingRendered,
        onCheckpoint,
      }),
    ).rejects.toThrow("cart-3 failed email safety");

    expect(onCheckpoint).toHaveBeenCalledOnce();
    expect(onCheckpoint.mock.calls[0][0]).toMatchObject({
      flowId: "cart",
      flowComplete: false,
    });
    expect(onCheckpoint.mock.calls[0][0].rendered).toMatchObject({
      "cart-1": expect.stringContaining("cart-1"),
      "cart-2": expect.stringContaining("cart-2"),
    });
    expect(onCheckpoint.mock.calls[0][0].rendered).not.toHaveProperty("cart-3");
  });
});
