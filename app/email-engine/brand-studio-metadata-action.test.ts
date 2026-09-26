import { beforeEach, describe, expect, it, vi } from "vitest";
import { action } from "../routes/app.brand-studio.metadata";
import {
  BRAND_STUDIO_LIFECYCLE_IDS,
  type LifecycleRecipe,
} from "../brand-studio/types";
import {
  LUMEN_DEMO_BRAND_SYSTEM,
  LUMEN_DEMO_DIRECTION,
  LUMEN_DEMO_EVIDENCE,
  LUMEN_DEMO_RECIPES,
} from "../dashboard/lumen-demo";

const mocks = vi.hoisted(() => ({
  authenticateAdmin: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
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
const renderedEmails = Object.fromEntries(
  BRAND_STUDIO_LIFECYCLE_IDS.map((id) => [
    id,
    `<!doctype html><html><body>${id} ${"approved email copy ".repeat(30)}</body></html>`,
  ]),
);

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
  };
}

function metadataRequest(
  recipeId: string,
  subject: string,
  previewText: string,
) {
  const formData = new FormData();
  formData.set("recipeId", recipeId);
  formData.set("subject", subject);
  formData.set("previewText", previewText);
  return new Request("https://nomi.example.com/app/brand-studio/metadata", {
    method: "POST",
    body: formData,
  });
}

describe("app.brand-studio.metadata action", () => {
  beforeEach(() => {
    mocks.authenticateAdmin.mockReset();
    mocks.findUnique.mockReset();
    mocks.update.mockReset();
    mocks.authenticateAdmin.mockResolvedValue({
      session: { shop: "lumen.myshopify.com" },
    });
    mocks.findUnique.mockResolvedValue(approvedProfileRow());
    mocks.update.mockResolvedValue({});
  });

  it("rejects an invalid recipe id before reading the profile", async () => {
    const response = await action({
      request: metadataRequest("not-an-email", "A valid subject", "Useful preview text"),
    } as never);

    expect(response.init?.status).toBe(400);
    expect(response.data).toMatchObject({ ok: false });
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it.each([
    ["Hi", "A useful preview", /at least 3 characters/i],
    ["A".repeat(65), "A useful preview", /64 characters/i],
    ["A valid subject", "No", /at least 3 characters/i],
    ["A valid subject", "P".repeat(141), /140 characters/i],
    ["The same thought", "  the same   thought ", /different thought/i],
  ])("validates inbox copy before persisting", async (subject, previewText, error) => {
    const response = await action({
      request: metadataRequest("welcome-1", subject, previewText),
    } as never);

    expect(response.init?.status).toBe(400);
    expect(response.data).toMatchObject({ ok: false, error: expect.stringMatching(error) });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("rejects edits when the family is no longer approved", async () => {
    mocks.findUnique.mockResolvedValue({ ...approvedProfileRow(), status: "building" });

    const response = await action({
      request: metadataRequest("welcome-1", "A fresh subject", "A useful second thought"),
    } as never);

    expect(response.init?.status).toBe(400);
    expect(response.data).toMatchObject({ ok: false, error: expect.stringMatching(/build the full email family/i) });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("keeps subject lines distinct across the approved family", async () => {
    const sibling = LUMEN_DEMO_RECIPES.find(({ id }) => id === "welcome-2")!;
    const response = await action({
      request: metadataRequest("welcome-1", sibling.subject, "A new, useful second thought"),
    } as never);

    expect(response.init?.status).toBe(400);
    expect(response.data).toMatchObject({ ok: false, error: expect.stringMatching(/different subject line/i) });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("updates only the selected recipe metadata and preserves approved HTML", async () => {
    const response = await action({
      request: metadataRequest(
        "welcome-1",
        "  A calmer welcome  ",
        "  One useful place to begin, whenever you are ready.  ",
      ),
    } as never);

    expect(response.data).toEqual({
      ok: true,
      recipeId: "welcome-1",
      subject: "A calmer welcome",
      previewText: "One useful place to begin, whenever you are ready.",
    });
    expect(mocks.update).toHaveBeenCalledOnce();
    const update = mocks.update.mock.calls[0][0];
    expect(update.data).not.toHaveProperty("renderedEmails");
    const persisted = JSON.parse(update.data.lifecycleRecipes) as LifecycleRecipe[];
    expect(persisted.find(({ id }) => id === "welcome-1")).toMatchObject({
      subject: "A calmer welcome",
      preheader: "One useful place to begin, whenever you are ready.",
    });
    for (const original of LUMEN_DEMO_RECIPES) {
      if (original.id !== "welcome-1")
        expect(persisted.find(({ id }) => id === original.id)).toEqual(original);
    }
  });
});
