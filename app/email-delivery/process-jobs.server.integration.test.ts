import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  createPrismaTestDatabase,
  type PrismaTestDatabase,
} from "./test-support/prisma-test-database";

const shop = "worker-integration.myshopify.com";
const fixedNow = new Date("2026-08-20T09:00:00.000Z").getTime();

const external = {
  admin: vi.fn(),
  graphql: vi.fn(),
  generateOrderConfirmationEmail: vi.fn(),
  generateShippingUpdateEmail: vi.fn(),
  generateRefundConfirmationEmail: vi.fn(),
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
      currentTotalPriceSet: {
        shopMoney: { amount: "75", currencyCode: "USD" },
      },
      lineItems: {
        edges: [
          {
            node: {
              title: "Linen Throw",
              quantity: 1,
              image: null,
              product: { onlineStoreUrl: null },
              originalTotalSet: {
                shopMoney: { amount: "75", currencyCode: "USD" },
              },
            },
          },
        ],
      },
      fulfillments: [],
      refunds: [],
    },
  },
};

let database: PrismaTestDatabase;
let processPendingEmailJobs: typeof import("./process-jobs.server").processPendingEmailJobs;

async function createPendingOrderJob(attempts = 0) {
  return database.client.emailJob.create({
    data: {
      webhookId: `order-webhook-${attempts}`,
      shop,
      topic: "ORDERS_CREATE",
      payload: JSON.stringify({
        admin_graphql_api_id: "gid://shopify/Order/1042",
      }),
      attempts,
      availableAt: new Date(0),
    },
  });
}

describe("processPendingEmailJobs with SQLite", () => {
  beforeAll(async () => {
    database = await createPrismaTestDatabase("nomi-worker-integration");
    vi.doMock("../db.server", () => ({ default: database.client }));
    vi.doMock("../shopify.server", () => ({
      unauthenticated: { admin: external.admin },
    }));
    vi.doMock("../email-engine/generate-order-confirmation-email", () => ({
      generateOrderConfirmationEmail: external.generateOrderConfirmationEmail,
    }));
    vi.doMock("../email-engine/generate-shipping-update-email", () => ({
      generateShippingUpdateEmail: external.generateShippingUpdateEmail,
    }));
    vi.doMock("../email-engine/generate-refund-confirmation-email", () => ({
      generateRefundConfirmationEmail: external.generateRefundConfirmationEmail,
    }));
    vi.doMock("../email-engine/generate-review-request-email", () => ({
      generateReviewRequestEmail: external.generateReviewRequestEmail,
    }));
    vi.doMock("../email-engine/generate-abandoned-cart-email", () => ({
      generateAbandonedCartEmail: external.generateAbandonedCartEmail,
    }));
    vi.doMock("./provider.server", () => ({
      sendEmail: external.sendEmail,
    }));
    ({ processPendingEmailJobs } = await import("./process-jobs.server"));
  });

  beforeEach(async () => {
    await database.client.emailJob.deleteMany();
    await database.client.shopSettings.deleteMany();
    await database.client.shopSettings.create({
      data: {
        shop,
        sendingEnabled: true,
        sendReceiptEmails: true,
        language: "en",
        tone: "warm-plain",
      },
    });
    for (const mock of Object.values(external)) mock.mockReset();
    external.admin.mockResolvedValue({
      admin: { graphql: external.graphql },
    });
    external.graphql.mockResolvedValue({
      json: vi.fn().mockResolvedValue(orderResponse),
    });
    external.generateOrderConfirmationEmail.mockResolvedValue(
      "<html>order</html>",
    );
    external.sendEmail.mockResolvedValue("provider-message-1");
    vi.spyOn(Date, "now").mockReturnValue(fixedNow);
  });

  afterAll(async () => {
    await database.dispose();
  });

  it("allows two workers to race without sending the same job twice", async () => {
    const job = await createPendingOrderJob();

    const results = await Promise.all([
      processPendingEmailJobs(),
      processPendingEmailJobs(),
    ]);

    expect(results.reduce((total, result) => total + result.sent, 0)).toBe(1);
    expect(external.generateOrderConfirmationEmail).toHaveBeenCalledOnce();
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
    const job = await createPendingOrderJob();
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
    const job = await createPendingOrderJob(4);
    external.sendEmail.mockRejectedValue(new Error("provider unavailable"));

    await expect(processPendingEmailJobs()).resolves.toEqual({
      sent: 0,
      skipped: 0,
      retried: 0,
      failed: 1,
    });

    await expect(
      database.client.emailJob.findUniqueOrThrow({ where: { id: job.id } }),
    ).resolves.toMatchObject({
      status: "failed",
      attempts: 5,
      lastError: "provider unavailable",
    });
  });
});
