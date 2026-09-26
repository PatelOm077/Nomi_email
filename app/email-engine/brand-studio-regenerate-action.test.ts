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

const streamMessage = vi.hoisted(() => vi.fn());
const mocks = vi.hoisted(() => ({
  authenticateAdmin: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
}));

vi.mock("./anthropic-client", () => ({
  getAnthropicClient: () => ({ messages: { stream: streamMessage } }),
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
  },
}));

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

const modelResponse = (parsed_output: unknown, inputTokens = 10) => ({
  stop_reason: "end_turn",
  parsed_output,
  usage: { input_tokens: inputTokens, output_tokens: 5 },
});

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

describe("app.brand-studio.regenerate action", () => {
  beforeEach(() => {
    streamMessage.mockReset();
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
    expect(streamMessage).not.toHaveBeenCalled();
  });

  it("rejects when the stored family isn't approved", async () => {
    mocks.findUnique.mockResolvedValue({
      ...approvedProfileRow(),
      status: "building",
    });

    const response = await action({
      request: regenerateRequest("cart-3"),
    } as never);

    expect(response.init?.status).toBe(400);
    assertError(response.data);
    expect(response.data.error).toMatch(/build the full email family/i);
    expect(streamMessage).not.toHaveBeenCalled();
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
    streamMessage.mockReturnValueOnce({
      finalMessage: async () =>
        modelResponse({
          emails: [{ id: "cart-3", html: safeHtml("cart-3-rebuilt", 8) }],
        }),
    });

    const response = await regenerateAndSettle("cart-3");

    assertOk(response.data);
    if (response.data.status !== "done")
      throw new Error(`Expected a done response, got ${JSON.stringify(response.data)}`);
    expect(response.data.html).toContain("cart-3-rebuilt");
    expect(streamMessage).toHaveBeenCalledTimes(1);

    const persisted = JSON.parse(
      mocks.update.mock.calls[0][0].data.renderedEmails,
    );
    expect(persisted["cart-3"]).toContain("cart-3-rebuilt");
    expect(persisted["winback-1"]).toBe(staleWinback1);
  });

  it("regenerates only the requested email and persists a single merged key", async () => {
    mocks.findUnique.mockResolvedValue(approvedProfileRow());
    streamMessage
      .mockReturnValueOnce({
        finalMessage: async () =>
          modelResponse({
            emails: [{ id: "cart-3", html: safeHtml("cart-3-rebuilt", 8) }],
          }),
      });

    const response = await regenerateAndSettle("cart-3");

    assertOk(response.data);
    expect(response.data.recipeId).toBe("cart-3");
    if (response.data.status !== "done")
      throw new Error(`Expected a done response, got ${JSON.stringify(response.data)}`);
    expect(response.data.html).toContain("cart-3-rebuilt");

    // No critique call — exactly one Sonnet call for the one pending flow.
    expect(streamMessage).toHaveBeenCalledTimes(1);

    expect(mocks.update).toHaveBeenCalledOnce();
    const persisted = JSON.parse(
      mocks.update.mock.calls[0][0].data.renderedEmails,
    );
    expect(Object.keys(persisted)).toHaveLength(13);
    expect(persisted["cart-3"]).toContain("cart-3-rebuilt");
    for (const id of BRAND_STUDIO_LIFECYCLE_IDS) {
      if (id !== "cart-3") expect(persisted[id]).toBe(renderedEmails[id]);
    }
  });

  it("surfaces a quality-gate failure without persisting renderedEmails", async () => {
    mocks.findUnique.mockResolvedValue(approvedProfileRow());
    // Missing doctype/viewport/etc — auditCompiledEmail reports an error,
    // and the repair pass below also fails to fix it.
    const brokenHtml = "<p>too short</p>";
    streamMessage
      .mockReturnValueOnce({
        finalMessage: async () =>
          modelResponse({ emails: [{ id: "cart-3", html: brokenHtml }] }),
      })
      .mockReturnValueOnce({
        finalMessage: async () =>
          modelResponse({ emails: [{ id: "cart-3", html: brokenHtml }] }),
      });

    const response = await regenerateAndSettle("cart-3");

    expect(response.init?.status).toBe(400);
    expect(response.data.ok).toBe(false);

    const renderedEmailsUpdate = mocks.update.mock.calls.find(
      ([args]) => args.data.renderedEmails,
    );
    expect(renderedEmailsUpdate).toBeUndefined();
  });
});
