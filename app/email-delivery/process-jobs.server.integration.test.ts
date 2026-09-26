import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPrismaTestDatabase,
  type PrismaTestDatabase,
} from "./test-support/prisma-test-database";

const shop = "worker-integration.myshopify.com";
const fixedNow = new Date("2026-08-20T09:00:00.000Z").getTime();
const external = {
  admin: vi.fn(),
  graphql: vi.fn(),
  generateReviewRequestEmail: vi.fn(),
  generateAbandonedCartEmail: vi.fn(),
  sendEmail: vi.fn(),
};
const orderResponse = {
  data: {
    shop: { name: "Worker Integration Shop" },
    order: {
      id: "gid://shopify/Order/1042",
      name: "#1042",
      email: "mina@example.com",
      customer: { firstName: "Mina" },
      lineItems: {
        edges: [
          {
            node: {
              title: "Linen Throw",
              quantity: 1,
              image: null,
              product: { onlineStoreUrl: null },
            },
          },
        ],
      },
    },
  },
};

let database: PrismaTestDatabase;
let processPendingEmailJobs: typeof import("./process-jobs.server").processPendingEmailJobs;

async function createPendingReviewJob(attempts = 0) {
  return database.client.emailJob.create({
    data: {
      webhookId: `review-webhook-${attempts}`,
      shop,
      topic: "FULFILLMENTS_UPDATE",
      payload: JSON.stringify({ order_id: 1042, shipment_status: "delivered" }),
      attempts,
      availableAt: new Date(0),
    },
  });
}

describe("processPendingEmailJobs with SQLite", () => {
  beforeAll(async () => {
    database = await createPrismaTestDatabase("nomi-worker-integration");
    vi.doMock("../db.server", () => ({ default: database.client }));
    vi.doMock("./unsubscribe.server", () => ({
      isSuppressed: async () => false,
      unsubscribeUrl: () => "https://app.test/unsubscribe?t=x",
      listUnsubscribeHeaders: () => ({}),
    }));
    vi.doMock("../dashboard/sender-footer.server", () => ({
      loadShopFooterAddress: async () => null,
      resolveSenderFooter: () => ({ complete: true, line: "Worker Shop · 1 Main St" }),
    }));
    vi.doMock("../shopify.server", () => ({
      unauthenticated: { admin: external.admin },
    }));
    vi.doMock("../email-engine/generate-review-request-email", () => ({
      generateReviewRequestEmail: external.generateReviewRequestEmail,
    }));
    vi.doMock("../email-engine/generate-abandoned-cart-email", () => ({
      generateAbandonedCartEmail: external.generateAbandonedCartEmail,
    }));
    vi.doMock("./provider.server", () => ({ sendEmail: external.sendEmail }));
    ({ processPendingEmailJobs } = await import("./process-jobs.server"));
  });

  beforeEach(async () => {
    await database.client.emailJob.deleteMany();
    await database.client.shopSettings.deleteMany();
    await database.client.shopSettings.create({
      data: { shop, sendingEnabled: true, language: "en", tone: "warm-plain" },
    });
    for (const mock of Object.values(external)) mock.mockReset();
    external.admin.mockResolvedValue({ admin: { graphql: external.graphql } });
    external.graphql.mockResolvedValue({
      json: vi.fn().mockResolvedValue(orderResponse),
    });
    external.generateReviewRequestEmail.mockResolvedValue("<html>review</html>");
    external.sendEmail.mockResolvedValue("provider-message-1");
    vi.spyOn(Date, "now").mockReturnValue(fixedNow);
  });

  afterAll(async () => database.dispose());

  it("allows two workers to race without sending the same job twice", async () => {
    const job = await createPendingReviewJob();
    const results = await Promise.all([
      processPendingEmailJobs(),
      processPendingEmailJobs(),
    ]);

    expect(results.reduce((total, result) => total + result.sent, 0)).toBe(1);
    expect(external.generateReviewRequestEmail).toHaveBeenCalledOnce();
    expect(external.sendEmail).toHaveBeenCalledOnce();
    await expect(
      database.client.emailJob.findUniqueOrThrow({ where: { id: job.id } }),
    ).resolves.toMatchObject({
      status: "sent",
      attempts: 1,
      providerMessageId: "provider-message-1",
      lastError: null,
    });
  });

  it("persists retry state and the incremented attempt count", async () => {
    const job = await createPendingReviewJob();
    external.sendEmail.mockRejectedValue(new Error("provider unavailable"));

    await expect(processPendingEmailJobs()).resolves.toEqual({
      sent: 0,
      skipped: 0,
      retried: 1,
      failed: 0,
    });
    await expect(
      database.client.emailJob.findUniqueOrThrow({ where: { id: job.id } }),
    ).resolves.toMatchObject({
      status: "pending",
      attempts: 1,
      lastError: "provider unavailable",
      availableAt: new Date(fixedNow + 2 * 60_000),
    });
  });

  it("persists terminal failure on the fifth attempt", async () => {
    const job = await createPendingReviewJob(4);
    external.sendEmail.mockRejectedValue(new Error("provider unavailable"));

    await expect(processPendingEmailJobs()).resolves.toMatchObject({ failed: 1 });
    await expect(
      database.client.emailJob.findUniqueOrThrow({ where: { id: job.id } }),
    ).resolves.toMatchObject({
      status: "failed",
      attempts: 5,
      lastError: "provider unavailable",
    });
  });
});
