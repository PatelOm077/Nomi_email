import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __waitForRegenerateAllJobsForTests,
  action,
} from "../routes/app.brand-studio.regenerate-all";
import { BRAND_STUDIO_LIFECYCLE_IDS } from "../brand-studio/types";
import {
  LUMEN_DEMO_BRAND_SYSTEM,
  LUMEN_DEMO_DIRECTION,
  LUMEN_DEMO_EVIDENCE,
  LUMEN_DEMO_RECIPES,
} from "../dashboard/lumen-demo";

// Every email is built by the campaign engine (tested on its own); here it
// is stubbed to return a new version of each of the 13.
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

const safeHtml = (id: string, paragraphCount: number) => {
  const paragraphs = Array.from(
    { length: paragraphCount },
    (_, index) =>
      `<p${index === 0 ? ' data-nomi-seam="body"' : ""}>${id} approved email copy ${index}. ${"Useful lifecycle detail. ".repeat(4)}</p>`,
  ).join("");
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width"></head><body style="background:#fffaf3;color:#1d1a18"><table role="presentation" style="max-width:600px;color:#b96f52;border-color:#d8cfc3"><tr><td><h1 data-nomi-seam="headline">${id}</h1>${paragraphs}<p data-nomi-seam="footer">Lumen email preferences and unsubscribe options.</p></td></tr></table></body></html>`;
};

const renderedEmails = Object.fromEntries(
  BRAND_STUDIO_LIFECYCLE_IDS.map((id, index) => [
    id,
    safeHtml(`${id}-old`, index + 1),
  ]),
);

const validEvidence = {
  ...LUMEN_DEMO_EVIDENCE,
  products: LUMEN_DEMO_EVIDENCE.products.map((product) => ({
    ...product,
    imageUrl: null,
  })),
};

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
    currentBuildCostMicros: 24_900_000,
    refinement: null,
  };
}

function regenerateAllRequest(method = "POST") {
  return new Request(
    "https://nomi.example.com/app/brand-studio/regenerate-all",
    { method },
  );
}

async function regenerateAllAndSettle() {
  const started = await action({ request: regenerateAllRequest() } as never);
  expect(started.data).toMatchObject({
    ok: true,
    status: "pending",
    completedFlows: 0,
    totalFlows: 5,
  });
  await __waitForRegenerateAllJobsForTests();
  return action({ request: regenerateAllRequest() } as never);
}

describe("app.brand-studio.regenerate-all action", () => {
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

  it("rejects a family that is not currently approved", async () => {
    mocks.findUnique.mockResolvedValue({
      ...approvedProfileRow(),
      status: "building",
    });

    const response = await action({
      request: regenerateAllRequest(),
    } as never);

    expect(response.init?.status).toBe(400);
    expect(response.data).toMatchObject({ ok: false, status: "error" });
    expect(engine).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("regenerates and atomically replaces all 13 emails without requiring an evidence change", async () => {
    mocks.findUnique.mockResolvedValue(approvedProfileRow());
    engine.mockImplementation(async (input: { onCheckpoint: (checkpoint: unknown) => Promise<void> }) => {
      const value = Object.fromEntries(
        BRAND_STUDIO_LIFECYCLE_IDS.map((id, index) => [id, safeHtml(`${id}-new`, index + 1)]),
      );
      await input.onCheckpoint({
        rendered: value,
        flowId: "welcome",
        flowComplete: true,
        usage: { provider: "anthropic", inputTokens: 10, outputTokens: 5 },
        costMicros: 1_000,
      });
      return { value, usage: { provider: "anthropic", inputTokens: 0, outputTokens: 0 }, costMicros: 0 };
    });

    const response = await regenerateAllAndSettle();

    expect(response.data).toMatchObject({
      ok: true,
      status: "done",
      count: 13,
    });
    expect(engine).toHaveBeenCalledOnce();
    // A full rebuild: nothing is carried over from the current family.
    expect(engine.mock.calls[0][0].existingRendered).toBeUndefined();

    const persistedUpdate = mocks.update.mock.calls.find(
      ([args]) => args.data.renderedEmails,
    );
    expect(persistedUpdate).toBeDefined();
    const persisted = JSON.parse(persistedUpdate![0].data.renderedEmails);
    expect(Object.keys(persisted)).toHaveLength(13);
    for (const id of BRAND_STUDIO_LIFECYCLE_IDS) {
      expect(persisted[id]).toContain(`${id}-new`);
      expect(persisted[id]).not.toBe(renderedEmails[id]);
    }

  });
});
