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

const shop = "queue-integration.myshopify.com";
const initialNow = new Date("2026-08-20T08:00:00.000Z").getTime();

let database: PrismaTestDatabase;
let enqueueEmailJob: typeof import("./queue.server").enqueueEmailJob;

async function enableSending(sendReceiptEmails = false) {
  await database.client.shopSettings.create({
    data: { shop, sendingEnabled: true, sendReceiptEmails },
  });
}

function eligibleCheckoutPayload(email = "mina@example.com") {
  return {
    token: "checkout-token",
    email,
    buyer_accepts_marketing: true,
    completed_at: null,
    closed_at: null,
  };
}

describe("enqueueEmailJob with SQLite", () => {
  beforeAll(async () => {
    database = await createPrismaTestDatabase("nomi-queue-integration");
    vi.doMock("../db.server", () => ({ default: database.client }));
    ({ enqueueEmailJob } = await import("./queue.server"));
  });

  beforeEach(async () => {
    await database.client.emailJob.deleteMany();
    await database.client.shopSettings.deleteMany();
    vi.spyOn(Date, "now").mockReturnValue(initialNow);
  });

  afterAll(async () => {
    await database.dispose();
  });

  it("persists one job when identical webhook deliveries race", async () => {
    await enableSending();
    const input = {
      webhookId: "webhook-concurrent",
      shop,
      topic: "FULFILLMENTS_CREATE",
      payload: { id: 501, order_id: 1042 },
    };

    const outcomes = await Promise.all([
      enqueueEmailJob(input),
      enqueueEmailJob(input),
    ]);

    expect(outcomes.sort()).toEqual(["duplicate", "queued"]);
    await expect(
      database.client.emailJob.findMany({
        where: { webhookId: "webhook-concurrent" },
      }),
    ).resolves.toHaveLength(1);
  });

  it("resets the same delayed checkout job instead of inserting another", async () => {
    await enableSending();
    const firstPayload = eligibleCheckoutPayload();

    await expect(
      enqueueEmailJob({
        webhookId: "ignored-by-checkout-path",
        shop,
        topic: "CHECKOUTS_UPDATE",
        payload: firstPayload,
      }),
    ).resolves.toBe("queued");

    const first = await database.client.emailJob.findUniqueOrThrow({
      where: { webhookId: `checkout:${shop}:checkout-token` },
    });
    await database.client.emailJob.update({
      where: { id: first.id },
      data: { attempts: 3, lastError: "temporary failure" },
    });

    vi.mocked(Date.now).mockReturnValue(initialNow + 15 * 60_000);
    const secondPayload = eligibleCheckoutPayload("updated@example.com");
    await expect(
      enqueueEmailJob({
        webhookId: "also-ignored",
        shop,
        topic: "CHECKOUTS_UPDATE",
        payload: secondPayload,
      }),
    ).resolves.toBe("queued");

    const jobs = await database.client.emailJob.findMany();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      id: first.id,
      status: "pending",
      attempts: 0,
      lastError: null,
      payload: JSON.stringify(secondPayload),
    });
    expect(jobs[0].availableAt).toEqual(new Date(initialNow + 75 * 60_000));
  });

  it("persists cart cancellation before applying the receipt-email gate", async () => {
    await enableSending(false);
    await enqueueEmailJob({
      webhookId: "checkout-update",
      shop,
      topic: "CHECKOUTS_UPDATE",
      payload: eligibleCheckoutPayload(),
    });

    await expect(
      enqueueEmailJob({
        webhookId: "order-webhook",
        shop,
        topic: "ORDERS_CREATE",
        payload: { id: 1042, checkout_token: "checkout-token" },
      }),
    ).resolves.toBe("disabled");

    await expect(
      database.client.emailJob.findUniqueOrThrow({
        where: { webhookId: `checkout:${shop}:checkout-token` },
      }),
    ).resolves.toMatchObject({
      status: "skipped",
      lastError: "Checkout completed.",
    });
  });

  it("does not reset a delayed checkout job after it has been sent", async () => {
    await enableSending();
    await enqueueEmailJob({
      webhookId: "checkout-update",
      shop,
      topic: "CHECKOUTS_UPDATE",
      payload: eligibleCheckoutPayload(),
    });
    const webhookId = `checkout:${shop}:checkout-token`;
    const sentPayload = JSON.stringify(eligibleCheckoutPayload());
    await database.client.emailJob.update({
      where: { webhookId },
      data: { status: "sent" },
    });

    await expect(
      enqueueEmailJob({
        webhookId: "later-checkout-update",
        shop,
        topic: "CHECKOUTS_UPDATE",
        payload: eligibleCheckoutPayload("later@example.com"),
      }),
    ).resolves.toBe("duplicate");

    await expect(
      database.client.emailJob.findUniqueOrThrow({ where: { webhookId } }),
    ).resolves.toMatchObject({ status: "sent", payload: sentPayload });
  });
});
