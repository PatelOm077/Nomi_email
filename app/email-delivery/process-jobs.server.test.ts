import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { processPendingEmailJobs } from "./process-jobs.server";

const mocks = vi.hoisted(() => ({
  db: {
    emailJob: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
    shopSettings: { findUnique: vi.fn() },
  },
  admin: vi.fn(),
  graphql: vi.fn(),
  generateOrderConfirmationEmail: vi.fn(),
  generateShippingUpdateEmail: vi.fn(),
  generateRefundConfirmationEmail: vi.fn(),
  generateReviewRequestEmail: vi.fn(),
  generateAbandonedCartEmail: vi.fn(),
  sendEmail: vi.fn(),
}));

vi.mock("../db.server", () => ({ default: mocks.db }));
vi.mock("../shopify.server", () => ({
  unauthenticated: { admin: mocks.admin },
}));
vi.mock("../email-engine/generate-order-confirmation-email", () => ({
  generateOrderConfirmationEmail: mocks.generateOrderConfirmationEmail,
}));
vi.mock("../email-engine/generate-shipping-update-email", () => ({
  generateShippingUpdateEmail: mocks.generateShippingUpdateEmail,
}));
vi.mock("../email-engine/generate-refund-confirmation-email", () => ({
  generateRefundConfirmationEmail: mocks.generateRefundConfirmationEmail,
}));
vi.mock("../email-engine/generate-review-request-email", () => ({
  generateReviewRequestEmail: mocks.generateReviewRequestEmail,
}));
vi.mock("../email-engine/generate-abandoned-cart-email", () => ({
  generateAbandonedCartEmail: mocks.generateAbandonedCartEmail,
}));
vi.mock("./provider.server", () => ({ sendEmail: mocks.sendEmail }));

const shop = "paper-boat.myshopify.com";
const fixedNow = new Date("2026-08-19T12:00:00.000Z");

const baseJob = {
  id: "job-1",
  webhookId: "webhook-1",
  shop,
  topic: "ORDERS_CREATE",
  payload: JSON.stringify({
    admin_graphql_api_id: "gid://shopify/Order/1042",
    customer_locale: "es-MX",
  }),
  status: "pending",
  attempts: 0,
  availableAt: fixedNow,
  lastError: null,
  providerMessageId: null,
  createdAt: new Date("2026-08-19T11:00:00.000Z"),
  updatedAt: new Date("2026-08-19T11:00:00.000Z"),
  sentAt: null,
};

const orderResponse = {
  data: {
    shop: { name: "Paper Boat Goods" },
    order: {
      id: "gid://shopify/Order/1042",
      name: "#1042",
      email: "mina@example.com",
      customer: { firstName: "Mina" },
      currentTotalPriceSet: {
        shopMoney: { amount: "7500", currencyCode: "INR" },
      },
      lineItems: {
        edges: [
          {
            node: {
              title: "Linen Throw",
              quantity: 2,
              image: { url: "https://cdn.example.com/linen.jpg" },
              product: {
                onlineStoreUrl: "https://shop.example.com/products/linen-throw",
              },
              originalTotalSet: {
                shopMoney: { amount: "6400", currencyCode: "INR" },
              },
            },
          },
        ],
      },
      fulfillments: [
        {
          id: "gid://shopify/Fulfillment/501",
          displayStatus: "OUT_FOR_DELIVERY",
          estimatedDeliveryAt: "August 20",
          trackingInfo: [
            {
              number: "TRACK-501",
              url: "https://carrier.example.com/TRACK-501",
              company: "Blue Dart",
            },
          ],
        },
      ],
      refunds: [
        {
          id: "gid://shopify/Refund/701",
          note: "Item arrived damaged",
          totalRefundedSet: {
            shopMoney: { amount: "3200", currencyCode: "INR" },
          },
          refundLineItems: {
            edges: [
              {
                node: {
                  quantity: 1,
                  subtotalSet: {
                    shopMoney: { amount: "3200", currencyCode: "INR" },
                  },
                  lineItem: {
                    title: "Linen Throw",
                    image: { url: "https://cdn.example.com/linen.jpg" },
                  },
                },
              },
            ],
          },
        },
      ],
    },
  },
};

function setGraphqlResponse(value: unknown) {
  mocks.graphql.mockResolvedValue({
    json: vi.fn().mockResolvedValue(value),
  });
}

describe("processPendingEmailJobs", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);
    for (const mock of [
      mocks.db.emailJob.findMany,
      mocks.db.emailJob.updateMany,
      mocks.db.emailJob.update,
      mocks.db.shopSettings.findUnique,
      mocks.admin,
      mocks.graphql,
      mocks.generateOrderConfirmationEmail,
      mocks.generateShippingUpdateEmail,
      mocks.generateRefundConfirmationEmail,
      mocks.generateReviewRequestEmail,
      mocks.generateAbandonedCartEmail,
      mocks.sendEmail,
    ]) {
      mock.mockReset();
    }
    mocks.db.emailJob.findMany.mockResolvedValue([]);
    mocks.db.emailJob.updateMany.mockResolvedValue({ count: 1 });
    mocks.db.emailJob.update.mockResolvedValue({});
    mocks.db.shopSettings.findUnique.mockResolvedValue({
      sendingEnabled: true,
      sendReceiptEmails: true,
      language: "en",
      tone: "warm-plain",
    });
    mocks.admin.mockResolvedValue({ admin: { graphql: mocks.graphql } });
    mocks.generateOrderConfirmationEmail.mockResolvedValue(
      "<html>order</html>",
    );
    mocks.generateShippingUpdateEmail.mockResolvedValue(
      "<html>shipping</html>",
    );
    mocks.generateRefundConfirmationEmail.mockResolvedValue(
      "<html>refund</html>",
    );
    mocks.generateReviewRequestEmail.mockResolvedValue("<html>review</html>");
    mocks.generateAbandonedCartEmail.mockResolvedValue("<html>cart</html>");
    mocks.sendEmail.mockResolvedValue("provider-message-1");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    [0, 1],
    [-20, 1],
    [10, 10],
    [100, 25],
  ])("clamps a limit of %i to %i", async (requested, expected) => {
    await expect(processPendingEmailJobs(requested)).resolves.toEqual({
      sent: 0,
      skipped: 0,
      retried: 0,
      failed: 0,
    });

    expect(mocks.db.emailJob.findMany).toHaveBeenCalledWith({
      where: { status: "pending", availableAt: { lte: fixedNow } },
      orderBy: { createdAt: "asc" },
      take: expected,
    });
  });

  it("ignores a job another worker claimed first", async () => {
    mocks.db.emailJob.findMany.mockResolvedValue([baseJob]);
    mocks.db.emailJob.updateMany.mockResolvedValue({ count: 0 });

    await expect(processPendingEmailJobs()).resolves.toEqual({
      sent: 0,
      skipped: 0,
      retried: 0,
      failed: 0,
    });

    expect(mocks.db.shopSettings.findUnique).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("re-checks sending settings after claiming and skips disabled work", async () => {
    mocks.db.emailJob.findMany.mockResolvedValue([baseJob]);
    mocks.db.shopSettings.findUnique.mockResolvedValue({
      sendingEnabled: false,
      sendReceiptEmails: true,
    });

    await expect(processPendingEmailJobs()).resolves.toEqual({
      sent: 0,
      skipped: 1,
      retried: 0,
      failed: 0,
    });

    expect(mocks.db.emailJob.updateMany).toHaveBeenCalledWith({
      where: { id: "job-1", status: "pending" },
      data: { status: "processing", attempts: { increment: 1 } },
    });
    expect(mocks.db.emailJob.update).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: {
        status: "skipped",
        lastError: "Sending disabled for shop.",
      },
    });
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it("re-checks the narrower receipt-email opt-in after claiming", async () => {
    mocks.db.emailJob.findMany.mockResolvedValue([baseJob]);
    mocks.db.shopSettings.findUnique.mockResolvedValue({
      sendingEnabled: true,
      sendReceiptEmails: false,
    });

    await expect(processPendingEmailJobs()).resolves.toEqual({
      sent: 0,
      skipped: 1,
      retried: 0,
      failed: 0,
    });

    expect(mocks.db.emailJob.update).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: {
        status: "skipped",
        lastError: "Receipt-email sending not enabled for shop.",
      },
    });
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it("generates and sends an order with a stable provider idempotency key", async () => {
    mocks.db.emailJob.findMany.mockResolvedValue([baseJob]);
    setGraphqlResponse(orderResponse);

    await expect(processPendingEmailJobs()).resolves.toEqual({
      sent: 1,
      skipped: 0,
      retried: 0,
      failed: 0,
    });

    expect(mocks.graphql).toHaveBeenCalledWith(expect.any(String), {
      variables: { id: "gid://shopify/Order/1042" },
    });
    expect(mocks.generateOrderConfirmationEmail).toHaveBeenCalledWith({
      shopName: "Paper Boat Goods",
      language: "es",
      tone: "warm-plain",
      customerFirstName: "Mina",
      orderNumber: "#1042",
      total: expect.stringContaining("7"),
      lineItems: [
        {
          title: "Linen Throw",
          quantity: 2,
          price: expect.stringContaining("6"),
          imageUrl: "https://cdn.example.com/linen.jpg",
        },
      ],
    });
    expect(mocks.sendEmail).toHaveBeenCalledWith({
      to: "mina@example.com",
      subject: "Pedido confirmado — #1042",
      html: "<html>order</html>",
      idempotencyKey: "order:paper-boat.myshopify.com:gid://shopify/Order/1042",
    });
    expect(mocks.db.emailJob.update).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: {
        status: "sent",
        providerMessageId: "provider-message-1",
        sentAt: fixedNow,
        lastError: null,
      },
    });
  });

  it("maps the matching fulfillment and tracking facts", async () => {
    mocks.db.emailJob.findMany.mockResolvedValue([
      {
        ...baseJob,
        topic: "FULFILLMENTS_CREATE",
        payload: JSON.stringify({ order_id: 1042, id: 501 }),
      },
    ]);
    setGraphqlResponse(orderResponse);

    await expect(processPendingEmailJobs()).resolves.toMatchObject({ sent: 1 });

    expect(mocks.generateShippingUpdateEmail).toHaveBeenCalledWith({
      shopName: "Paper Boat Goods",
      language: "en",
      tone: "warm-plain",
      customerFirstName: "Mina",
      orderNumber: "#1042",
      fulfillmentStatus: "out for delivery",
      trackingNumber: "TRACK-501",
      carrierName: "Blue Dart",
      trackingUrl: "https://carrier.example.com/TRACK-501",
      estimatedDelivery: "August 20",
      lineItems: [
        {
          title: "Linen Throw",
          quantity: 2,
          imageUrl: "https://cdn.example.com/linen.jpg",
        },
      ],
    });
    expect(mocks.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey:
          "shipping:paper-boat.myshopify.com:gid://shopify/Fulfillment/501",
      }),
    );
  });

  it("skips an undelivered fulfillment update without generating", async () => {
    mocks.db.emailJob.findMany.mockResolvedValue([
      {
        ...baseJob,
        topic: "FULFILLMENTS_UPDATE",
        payload: JSON.stringify({
          order_id: 1042,
          shipment_status: "in_transit",
        }),
      },
    ]);
    setGraphqlResponse(orderResponse);

    await expect(processPendingEmailJobs()).resolves.toEqual({
      sent: 0,
      skipped: 1,
      retried: 0,
      failed: 0,
    });

    expect(mocks.generateReviewRequestEmail).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.db.emailJob.update).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: { status: "skipped", lastError: null },
    });
  });

  it("maps a delivered update into a review request with a real URL", async () => {
    mocks.db.emailJob.findMany.mockResolvedValue([
      {
        ...baseJob,
        topic: "FULFILLMENTS_UPDATE",
        payload: JSON.stringify({
          order_id: 1042,
          shipment_status: "delivered",
        }),
      },
    ]);
    setGraphqlResponse(orderResponse);

    await expect(processPendingEmailJobs()).resolves.toMatchObject({ sent: 1 });

    expect(mocks.generateReviewRequestEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewUrl: "https://shop.example.com/products/linen-throw",
      }),
    );
    expect(mocks.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey:
          "review:paper-boat.myshopify.com:gid://shopify/Order/1042",
      }),
    );
  });

  it("maps the matching refund into a refund confirmation", async () => {
    mocks.db.emailJob.findMany.mockResolvedValue([
      {
        ...baseJob,
        topic: "REFUNDS_CREATE",
        payload: JSON.stringify({ order_id: 1042, id: 701 }),
      },
    ]);
    setGraphqlResponse(orderResponse);

    await expect(processPendingEmailJobs()).resolves.toMatchObject({ sent: 1 });

    expect(mocks.generateRefundConfirmationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "Item arrived damaged",
        refundedTotal: expect.stringContaining("3"),
        lineItems: [
          expect.objectContaining({
            title: "Linen Throw",
            quantity: 1,
            imageUrl: "https://cdn.example.com/linen.jpg",
          }),
        ],
      }),
    );
    expect(mocks.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey:
          "refund:paper-boat.myshopify.com:gid://shopify/Refund/701",
      }),
    );
  });

  it("rechecks and maps an eligible abandoned checkout before sending", async () => {
    mocks.db.emailJob.findMany.mockResolvedValue([
      {
        ...baseJob,
        topic: "CHECKOUTS_UPDATE",
        payload: JSON.stringify({
          token: "checkout-token",
          email: "mina@example.com",
          customer_locale: "pt-BR",
          buyer_accepts_marketing: true,
        }),
      },
    ]);
    setGraphqlResponse({
      data: {
        shop: { name: "Paper Boat Goods" },
        abandonedCheckouts: {
          edges: [
            {
              node: {
                abandonedCheckoutUrl:
                  "https://shop.example.com/checkouts/recover/checkout-token",
                customer: null,
                totalPriceSet: {
                  shopMoney: { amount: "7500", currencyCode: "INR" },
                },
                lineItems: {
                  edges: [
                    {
                      node: {
                        title: null,
                        quantity: 2,
                        image: null,
                        originalTotalPriceSet: {
                          shopMoney: {
                            amount: "6400",
                            currencyCode: "INR",
                          },
                        },
                      },
                    },
                  ],
                },
              },
            },
          ],
        },
      },
    });

    await expect(processPendingEmailJobs()).resolves.toMatchObject({ sent: 1 });

    expect(mocks.generateAbandonedCartEmail).toHaveBeenCalledWith({
      shopName: "Paper Boat Goods",
      language: "pt",
      tone: "warm-plain",
      customerFirstName: null,
      recoveryUrl: "https://shop.example.com/checkouts/recover/checkout-token",
      total: expect.stringContaining("7"),
      lineItems: [
        {
          title: "Item",
          quantity: 2,
          price: expect.stringContaining("6"),
          imageUrl: null,
        },
      ],
    });
    expect(mocks.sendEmail).toHaveBeenCalledWith({
      to: "mina@example.com",
      subject: "Você deixou algo no carrinho",
      html: "<html>cart</html>",
      idempotencyKey: "cart:paper-boat.myshopify.com:checkout-token",
    });
  });

  it("retries a transient failure with exponential backoff", async () => {
    mocks.db.emailJob.findMany.mockResolvedValue([baseJob]);
    setGraphqlResponse(orderResponse);
    mocks.sendEmail.mockRejectedValue(new Error("provider unavailable"));

    await expect(processPendingEmailJobs()).resolves.toEqual({
      sent: 0,
      skipped: 0,
      retried: 1,
      failed: 0,
    });

    expect(mocks.db.emailJob.update).toHaveBeenLastCalledWith({
      where: { id: "job-1" },
      data: {
        status: "pending",
        availableAt: new Date("2026-08-19T12:02:00.000Z"),
        lastError: "provider unavailable",
      },
    });
  });

  it("marks the fifth failed attempt as exhausted", async () => {
    mocks.db.emailJob.findMany.mockResolvedValue([{ ...baseJob, attempts: 4 }]);
    setGraphqlResponse(orderResponse);
    mocks.sendEmail.mockRejectedValue(new Error("provider unavailable"));

    await expect(processPendingEmailJobs()).resolves.toEqual({
      sent: 0,
      skipped: 0,
      retried: 0,
      failed: 1,
    });

    expect(mocks.db.emailJob.update).toHaveBeenLastCalledWith({
      where: { id: "job-1" },
      data: {
        status: "failed",
        availableAt: new Date("2026-08-19T12:32:00.000Z"),
        lastError: "provider unavailable",
      },
    });
  });

  it("truncates stored errors to the database safety limit", async () => {
    mocks.db.emailJob.findMany.mockResolvedValue([baseJob]);
    setGraphqlResponse(orderResponse);
    mocks.sendEmail.mockRejectedValue(new Error("x".repeat(2_500)));

    await processPendingEmailJobs();

    expect(mocks.db.emailJob.update).toHaveBeenLastCalledWith({
      where: { id: "job-1" },
      data: expect.objectContaining({ lastError: "x".repeat(2_000) }),
    });
  });
});
