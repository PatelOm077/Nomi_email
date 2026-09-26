import { beforeEach, describe, expect, it, vi } from "vitest";
import { action } from "../routes/app.campaigns_.edit";

const mocks = vi.hoisted(() => ({
  authenticateAdmin: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  uploadImageBufferToShopify: vi.fn(),
}));

vi.mock("../shopify.server", () => ({
  authenticate: { admin: mocks.authenticateAdmin },
}));
vi.mock("../db.server", () => ({
  default: {
    campaign: {
      findUnique: mocks.findUnique,
      update: mocks.update,
    },
  },
}));
vi.mock("../dashboard/campaign-catalog.server", () => ({
  searchCampaignProducts: vi.fn(),
  searchCampaignShopifyFiles: vi.fn(),
  uploadImageBufferToShopify: mocks.uploadImageBufferToShopify,
}));

const seamedHtml = `<!doctype html><html><body>
  <h1 data-nomi-seam="headline">Holiday sale</h1>
  <p data-nomi-seam="body">Everything is 20% off this week.</p>
  <a href="https://shop.example.com/sale"><span data-nomi-seam="cta-label">Shop the sale</span></a>
  <img data-nomi-seam="product" data-nomi-product-id="gid://shopify/Product/1" src="https://cdn.example.com/old.jpg" alt="Old photo" width="300" height="300">
  <p data-nomi-seam="footer">Paper Boat Goods</p>
</body></html>`;

function approvedCampaignRow(overrides: Partial<{ id: string; shop: string; html: string | null }> = {}) {
  return {
    id: "campaign_1",
    shop: "paperboat.myshopify.com",
    name: "Holiday Sale",
    subject: "20% off everything",
    html: seamedHtml,
    ...overrides,
  };
}

function editRequest(body: Record<string, string>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(body)) formData.set(key, value);
  return new Request("https://nomi.example.com/app/campaigns/edit", {
    method: "POST",
    body: formData,
  });
}

describe("app.campaigns_.edit action", () => {
  beforeEach(() => {
    mocks.authenticateAdmin.mockReset();
    mocks.findUnique.mockReset();
    mocks.update.mockReset();
    mocks.uploadImageBufferToShopify.mockReset();
    mocks.authenticateAdmin.mockResolvedValue({
      session: { shop: "paperboat.myshopify.com" },
      admin: { graphql: vi.fn() },
    });
    mocks.update.mockResolvedValue({});
  });

  it("rejects a request with no campaignId", async () => {
    mocks.findUnique.mockResolvedValue(approvedCampaignRow());

    const response = await action({
      request: editRequest({ intent: "save-text", seamId: "headline", text: "New headline" }),
    } as never);

    expect(response.ok).toBe(false);
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it("rejects a campaign that doesn't exist", async () => {
    mocks.findUnique.mockResolvedValue(null);

    const response = await action({
      request: editRequest({
        intent: "save-text",
        campaignId: "campaign_missing",
        seamId: "headline",
        text: "New headline",
      }),
    } as never);

    expect(response.ok).toBe(false);
    if (response.ok) throw new Error("expected an error response");
    expect(response.error).toMatch(/could not be found/i);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  // The most important case: a Campaign row is keyed by its own id, not by
  // shop, so nothing but this explicit check stops one shop from reading or
  // editing another shop's campaign by guessing/reusing an id.
  it("refuses to edit a campaign belonging to a different shop", async () => {
    mocks.findUnique.mockResolvedValue(
      approvedCampaignRow({ shop: "someone-elses-shop.myshopify.com" }),
    );

    const response = await action({
      request: editRequest({
        intent: "save-text",
        campaignId: "campaign_1",
        seamId: "headline",
        text: "Hijacked headline",
      }),
    } as never);

    expect(response.ok).toBe(false);
    if (response.ok) throw new Error("expected an error response");
    expect(response.error).toMatch(/could not be found/i);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("saves a text seam and persists the updated html", async () => {
    mocks.findUnique.mockResolvedValue(approvedCampaignRow());

    const response = await action({
      request: editRequest({
        intent: "save-text",
        campaignId: "campaign_1",
        seamId: "headline",
        text: "Winter Sale",
      }),
    } as never);

    expect(response.ok).toBe(true);
    if (!response.ok) throw new Error("expected an ok response");
    expect(response.html).toContain("Winter Sale");
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "campaign_1" },
      data: { html: expect.stringContaining("Winter Sale") },
    });
  });

  it("rejects an empty text seam without saving", async () => {
    mocks.findUnique.mockResolvedValue(approvedCampaignRow());

    const response = await action({
      request: editRequest({
        intent: "save-text",
        campaignId: "campaign_1",
        seamId: "headline",
        text: "   ",
      }),
    } as never);

    expect(response.ok).toBe(false);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("saves a product image seam and persists the updated html", async () => {
    mocks.findUnique.mockResolvedValue(approvedCampaignRow());

    const response = await action({
      request: editRequest({
        intent: "save-image",
        campaignId: "campaign_1",
        seamId: "product:gid://shopify/Product/1",
        src: "https://cdn.example.com/new.jpg",
        alt: "New photo",
        width: "600",
        height: "600",
      }),
    } as never);

    expect(response.ok).toBe(true);
    if (!response.ok) throw new Error("expected an ok response");
    expect(response.html).toContain("https://cdn.example.com/new.jpg");
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "campaign_1" },
      data: { html: expect.stringContaining("https://cdn.example.com/new.jpg") },
    });
  });

  it("uploads a file to Shopify via uploadImageBufferToShopify", async () => {
    mocks.uploadImageBufferToShopify.mockResolvedValue("https://cdn.shopify.com/uploaded.png");
    const file = new File([new Uint8Array([1, 2, 3])], "photo.png", { type: "image/png" });
    const formData = new FormData();
    formData.set("intent", "upload-media");
    formData.set("file", file);

    const response = await action({
      request: new Request("https://nomi.example.com/app/campaigns/edit", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(response.ok).toBe(true);
    if (!response.ok) throw new Error("expected an ok response");
    expect(response.asset?.url).toBe("https://cdn.shopify.com/uploaded.png");
    expect(mocks.uploadImageBufferToShopify).toHaveBeenCalledOnce();
  });

  it("rejects an unsupported file type without calling Shopify", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "photo.webp", { type: "image/webp" });
    const formData = new FormData();
    formData.set("intent", "upload-media");
    formData.set("file", file);

    const response = await action({
      request: new Request("https://nomi.example.com/app/campaigns/edit", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(response.ok).toBe(false);
    expect(mocks.uploadImageBufferToShopify).not.toHaveBeenCalled();
  });
});
