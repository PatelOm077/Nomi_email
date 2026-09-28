import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __waitForRegenerateJobsForTests,
  action,
} from "../routes/app.brand-studio.regenerate";
import { BRAND_STUDIO_LIFECYCLE_IDS } from "../brand-studio/types";
import {
  LUMEN_DEMO_BRAND_SYSTEM,
  LUMEN_DEMO_DIRECTION,
  LUMEN_DEMO_EVIDENCE,
  LUMEN_DEMO_RECIPES,
} from "../dashboard/lumen-demo";

function assertOk<T extends { ok: boolean }>(
  data: T,
): asserts data is Extract<T, { ok: true }> {
  if (!data.ok) throw new Error(`Expected an ok response, got ${JSON.stringify(data)}`);
}
function assertError<T extends { ok: boolean }>(
  data: T,
): asserts data is Extract<T, { ok: false }> {
  if (data.ok) throw new Error(`Expected an error response, got ${JSON.stringify(data)}`);
}

// The route builds the email with the campaign engine (its own tests cover
// planning, photos, and writing); here it is stubbed to return fixed HTML.
const engine = vi.hoisted(() => vi.fn());
const mocks = vi.hoisted(() => ({
  authenticateAdmin: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
}));

// Plan limits are covered by usage.server.test.ts; always allowed here.
vi.mock("../billing/usage.server", () => ({
  checkAllowance: async () => ({ allowed: true, message: null }),
  recordUsage: async () => {},
}));
vi.mock("../brand-studio/campaign-engine.server", () => ({
  generateLifecycleEmailsWithCampaignEngine: engine,
  lifecycleLanguageAndTone: () => ({ language: "en", tone: "warm-plain" }),
}));
vi.mock("../shopify.server", () => ({
  authenticate: { admin: mocks.authenticateAdmin },
}));
vi.mock("../db.server", () => ({
  default: {
    brandStudioProfile: {
      findUnique: mocks.findUnique,
      update: mocks.update,
    },
    shopSettings: { findUnique: async () => ({ language: "en", tone: "warm-plain" }) },
  },
}));

function engineReturns(html: string) {
  engine.mockImplementationOnce(async (input: { existingRendered: Record<string, string>; onlyId: string }) => ({
    value: { ...input.existingRendered, [input.onlyId]: html },
    usage: { provider: "anthropic", inputTokens: 10, outputTokens: 5 },
    costMicros: 1_000,
  }));
}

// auditEmailFamily's structure-repeat check requires at least 10 distinct
// rendered "shapes" across all 13 emails, so each fixture needs a distinct
// paragraph count (not just distinct h1 text) to pass a real family audit.
const safeHtml = (id: string, paragraphCount = 1) => {
  const paragraphs = Array.from(
    { length: paragraphCount },
    () => `<p>${"Approved Brand Studio email. ".repeat(5)}</p>`,
  ).join("");
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width"></head><body style="background:#fffaf3;color:#1d1a18"><table role="presentation" style="max-width:600px;color:#b96f52;border-color:#d8cfc3"><tr><td><h1>${id}</h1>${paragraphs}</td></tr></table></body></html>`;
};


const renderedEmails = Object.fromEntries(
  BRAND_STUDIO_LIFECYCLE_IDS.map((id, index) => [id, safeHtml(id, index + 1)]),
);

// brandEvidenceSchema requires absolute URLs; the Lumen demo fixture's
// product images are local template-look paths, so null them out here
// exactly like approved-brand-studio-family.test.ts does.
const validEvidence = {
  ...LUMEN_DEMO_EVIDENCE,
  products: LUMEN_DEMO_EVIDENCE.products.map((product) => ({
    ...product,
    imageUrl: null,
  })),
};

// creativeDirectionsSchema requires exactly 3 stored directions.
const directions = [
  LUMEN_DEMO_DIRECTION,
  { ...LUMEN_DEMO_DIRECTION, id: "lumen-alt-a" },
  { ...LUMEN_DEMO_DIRECTION, id: "lumen-alt-b" },
];

function approvedProfileRow() {
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
    currentBuildCostMicros: 0,
  };
}

function regenerateRequest(recipeId: string) {
  const formData = new FormData();
  formData.set("recipeId", recipeId);
  return new Request("https://nomi.example.com/app/brand-studio/regenerate", {
    method: "POST",
    body: formData,
  });
}

// The route kicks the real work off in the background and returns
// "pending" almost instantly so a single Claude call can never trip
// Cloudflare's tunnel timeout. Mirror the client's poll loop here: fire the
// first request, let the background job settle, then poll the same route
// again for the terminal result.
async function regenerateAndSettle(recipeId: string) {
  const started = await action({ request: regenerateRequest(recipeId) } as never);
  expect(started.data).toMatchObject({ ok: true, recipeId, status: "pending" });
  await __waitForRegenerateJobsForTests();
  return action({ request: regenerateRequest(recipeId) } as never);
}

// A finished regenerate is only a draft until the merchant presses Save.
function saveDraft(recipeId: string) {
  const formData = new FormData();
  formData.set("recipeId", recipeId);
  formData.set("intent", "save");
  return action({
    request: new Request("https://nomi.example.com/app/brand-studio/regenerate", { method: "POST", body: formData }),
  } as never);
}

function persistedRenderedEmails(): Record<string, string> | null {
  const call = mocks.update.mock.calls.find(([args]) => args.data.renderedEmails);
  return call ? JSON.parse(call[0].data.renderedEmails) : null;
}

describe("app.brand-studio.regenerate action", () => {
  beforeEach(() => {
    engine.mockReset();
    mocks.authenticateAdmin.mockReset();
    mocks.findUnique.mockReset();
    mocks.update.mockReset();
    mocks.authenticateAdmin.mockResolvedValue({
      session: { shop: "lumen.myshopify.com" },
    });
    mocks.update.mockResolvedValue({});
  });

  it("rejects an invalid recipeId without touching the database", async () => {
    const response = await action({
      request: regenerateRequest("not-a-real-recipe"),
    } as never);

    expect(response.init?.status).toBe(400);
    expect(response.data.ok).toBe(false);
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(engine).not.toHaveBeenCalled();
  });

  it("rejects when the stored family isn't approved", async () => {
    mocks.findUnique.mockResolvedValue({
      ...approvedProfileRow(),
      status: "building",
    });

    const response = await action({
      request: regenerateRequest("winback-3"),
    } as never);

    expect(response.init?.status).toBe(400);
    assertError(response.data);
    expect(response.data.error).toMatch(/build the full email family/i);
    expect(engine).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("regenerates the requested email even when an unrelated stored sibling no longer passes safety checks, and leaves that sibling untouched", async () => {
    // A completely unrelated flow's stored email (winback-1) has gone
    // stale — e.g. it referenced a product image that's since changed.
    // A targeted single-email regenerate must not care: it trusts every
    // sibling verbatim and only ever asks Claude for the requested id.
    const staleWinback1 = `<!doctype html><html><body>${"Stale approved copy. ".repeat(10)}</body></html>`;
    mocks.findUnique.mockResolvedValue({
      ...approvedProfileRow(),
      renderedEmails: JSON.stringify({
        ...renderedEmails,
        "winback-1": staleWinback1,
      }),
    });
    engineReturns(safeHtml("winback-3-rebuilt", 8));

    const response = await regenerateAndSettle("winback-3");

    assertOk(response.data);
    if (response.data.status !== "done")
      throw new Error(`Expected a done response, got ${JSON.stringify(response.data)}`);
    expect(response.data.html).toContain("winback-3-rebuilt");
    expect(engine).toHaveBeenCalledTimes(1);
    expect(engine.mock.calls[0][0]).toMatchObject({ onlyId: "winback-3" });

    expect(persistedRenderedEmails()).toBeNull();
    await saveDraft("winback-3");
    const persisted = persistedRenderedEmails()!;
    expect(persisted["winback-3"]).toContain("winback-3-rebuilt");
    expect(persisted["winback-1"]).toBe(staleWinback1);
  });

  it("builds the email from the merchant's brief, picked product, and discount, and saves it to the flow", async () => {
    const product = {
      id: "gid://shopify/Product/901",
      title: "Moss Serum",
      onlineStoreUrl: "https://lumen.example.com/products/moss-serum",
      featuredMedia: { preview: { image: { url: "https://cdn.shopify.com/moss.png", altText: null } } },
      priceRangeV2: { minVariantPrice: { amount: "58.00", currencyCode: "USD" } },
      productType: "Serum",
      description: "A light daily serum.",
    };
    const graphql = vi.fn().mockResolvedValue({
      json: async () => ({ data: { nodes: [product] } }),
    });
    mocks.authenticateAdmin.mockResolvedValue({
      session: { shop: "lumen.myshopify.com" },
      admin: { graphql },
    });
    mocks.findUnique.mockResolvedValue(approvedProfileRow());
    const html = safeHtml(
      "winback-3-moss",
      8,
    ).replace(
      "</h1>",
      `</h1><a href="${product.onlineStoreUrl}"><img src="${product.featuredMedia.preview.image.url}" alt="Moss Serum" width="600"></a><p>Code WELCOME10</p>`,
    );
    engineReturns(html);

    const formData = new FormData();
    formData.set("recipeId", "winback-3");
    formData.set("prompt", "Lead with our new serum");
    formData.set("feature", "product");
    formData.set("productIds", product.id);
    formData.set("discountMethod", "code");
    formData.set("discountCode", "WELCOME10");
    formData.set("discountType", "percentage");
    formData.set("discountValue", "10");
    formData.set("startAt", "2026-10-01T09:00:00.000Z");
    formData.set("endAt", "2026-10-15T23:59:00.000Z");
    const started = await action({
      request: new Request("https://nomi.example.com/app/brand-studio/regenerate", { method: "POST", body: formData }),
    } as never);
    expect(started.data).toMatchObject({ ok: true, status: "pending" });
    await __waitForRegenerateJobsForTests();
    const response = await action({ request: regenerateRequest("winback-3") } as never);

    assertOk(response.data);
    expect(response.data).toMatchObject({ status: "done" });
    expect(graphql).toHaveBeenCalledWith(expect.any(String), { variables: { ids: [product.id] } });
    const call = engine.mock.calls[0][0];
    expect(call.recipes.find(({ id }: { id: string }) => id === "winback-3").productIds).toEqual([product.id]);
    expect(call.evidence.products[0]).toMatchObject({
      id: product.id,
      imageUrl: product.featuredMedia.preview.image.url,
      productUrl: product.onlineStoreUrl,
    });
    expect(call.merchantDirection).toContain("Lead with our new serum");
    expect(call.merchantDirection).toContain('"Moss Serum"');
    expect(call.merchantDirection).toContain('code "WELCOME10" for 10% off. Valid 2026-10-01 through 2026-10-15.');
    const saved = await saveDraft("winback-3");
    expect(saved.data).toMatchObject({ ok: true, status: "saved" });
    expect(persistedRenderedEmails()!["winback-3"]).toContain("WELCOME10");
  });

  it("regenerates only the requested email and persists a single merged key", async () => {
    mocks.findUnique.mockResolvedValue(approvedProfileRow());
    engineReturns(safeHtml("winback-3-rebuilt", 8));

    const response = await regenerateAndSettle("winback-3");

    assertOk(response.data);
    expect(response.data.recipeId).toBe("winback-3");
    if (response.data.status !== "done")
      throw new Error(`Expected a done response, got ${JSON.stringify(response.data)}`);
    expect(response.data.html).toContain("winback-3-rebuilt");

    expect(engine).toHaveBeenCalledTimes(1);

    // Generating only records its cost; the email waits for Save.
    expect(mocks.update).toHaveBeenCalledOnce();
    expect(persistedRenderedEmails()).toBeNull();

    const saved = await saveDraft("winback-3");
    expect(saved.data).toMatchObject({ ok: true, status: "saved" });
    const persisted = persistedRenderedEmails()!;
    expect(Object.keys(persisted)).toHaveLength(13);
    expect(persisted["winback-3"]).toContain("winback-3-rebuilt");
    for (const id of BRAND_STUDIO_LIFECYCLE_IDS) {
      if (id !== "winback-3") expect(persisted[id]).toBe(renderedEmails[id]);
    }

    // The draft is used up by the save.
    const again = await saveDraft("winback-3");
    expect(again.data).toMatchObject({ ok: false, status: "error" });
  });

  it("surfaces a quality-gate failure without persisting renderedEmails", async () => {
    mocks.findUnique.mockResolvedValue(approvedProfileRow());
    // Missing doctype/viewport/etc — auditCompiledEmail reports an error.
    engineReturns("<p>too short</p>");

    const response = await regenerateAndSettle("winback-3");

    expect(response.init?.status).toBe(400);
    expect(response.data.ok).toBe(false);

    const renderedEmailsUpdate = mocks.update.mock.calls.find(
      ([args]) => args.data.renderedEmails,
    );
    expect(renderedEmailsUpdate).toBeUndefined();
  });
});
