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
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

let database: PrismaTestDatabase;
let enqueueEmailJob: typeof import("./queue.server").enqueueEmailJob;

async function enableSending() {
  await database.client.shopSettings.create({
    data: { shop, sendingEnabled: true },
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
      topic: "FULFILLMENTS_UPDATE",
      payload: { id: 501, order_id: 1042, shipment_status: "delivered" },
    };

    const outcomes = await Promise.all([
      enqueueEmailJob(input),
      enqueueEmailJob(input),
    ]);

    expect(outcomes.sort()).toEqual(["duplicate", "queued"]);
    const jobs = await database.client.emailJob.findMany();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ webhookId: `review:${shop}:1042`, emailId: "review-request" });
    // The review request waits a week after delivery.
    expect(jobs[0].availableAt).toEqual(new Date(initialNow + 7 * DAY));
  });

  it("ignores fulfillment updates until the order is delivered", async () => {
    await enableSending();
    await expect(
      enqueueEmailJob({ webhookId: "w", shop, topic: "FULFILLMENTS_UPDATE", payload: { order_id: 7, shipment_status: "in_transit" } }),
    ).resolves.toBe("ignored");
    expect(await database.client.emailJob.count()).toBe(0);
  });

  it("queues all three cart emails and resets them when the checkout changes", async () => {
    await enableSending();
    await expect(
      enqueueEmailJob({ webhookId: "ignored", shop, topic: "CHECKOUTS_UPDATE", payload: eligibleCheckoutPayload() }),
    ).resolves.toBe("queued");
    const steps = await database.client.emailJob.findMany({ orderBy: { availableAt: "asc" } });
    expect(steps.map(({ webhookId, emailId }) => [webhookId, emailId])).toEqual([
      [`checkout:${shop}:checkout-token`, "cart-1"],
      [`checkout:${shop}:checkout-token:2`, "cart-2"],
      [`checkout:${shop}:checkout-token:3`, "cart-3"],
    ]);
    expect(steps.map(({ availableAt }) => availableAt.getTime() - initialNow)).toEqual([HOUR, 25 * HOUR, 73 * HOUR]);

    await database.client.emailJob.update({ where: { id: steps[0].id }, data: { attempts: 3, lastError: "temporary failure" } });
    vi.mocked(Date.now).mockReturnValue(initialNow + 15 * 60_000);
    const secondPayload = eligibleCheckoutPayload("updated@example.com");
    await expect(
      enqueueEmailJob({ webhookId: "also-ignored", shop, topic: "CHECKOUTS_UPDATE", payload: secondPayload }),
    ).resolves.toBe("queued");

    const jobs = await database.client.emailJob.findMany({ orderBy: { availableAt: "asc" } });
    expect(jobs).toHaveLength(3);
    expect(jobs[0]).toMatchObject({
      id: steps[0].id,
      status: "pending",
      attempts: 0,
      lastError: null,
      payload: JSON.stringify(secondPayload),
    });
    expect(jobs[0].availableAt).toEqual(new Date(initialNow + 75 * 60_000));
  });

  it("starts Still interested? once when a customer subscribes, and stops it when they unsubscribe", async () => {
    await enableSending();
    const subscribed = {
      id: 77,
      email: "ria@example.com",
      created_at: "2026-08-01T00:00:00Z",
      email_marketing_consent: { state: "subscribed" },
    };
    await expect(enqueueEmailJob({ webhookId: "c1", shop, topic: "CUSTOMERS_CREATE", payload: subscribed })).resolves.toBe("queued");
    await expect(enqueueEmailJob({ webhookId: "c2", shop, topic: "CUSTOMERS_UPDATE", payload: subscribed })).resolves.toBe("duplicate");

    const jobs = await database.client.emailJob.findMany({ orderBy: { availableAt: "asc" } });
    expect(jobs.map(({ emailId, customerId }) => [emailId, customerId])).toEqual([
      ["interest-1", "gid://shopify/Customer/77"],
      ["interest-2", "gid://shopify/Customer/77"],
    ]);
    expect(jobs.map(({ availableAt }) => availableAt.getTime() - initialNow)).toEqual([7 * DAY, 10 * DAY]);

    await enqueueEmailJob({
      webhookId: "c3",
      shop,
      topic: "CUSTOMERS_UPDATE",
      payload: { ...subscribed, email_marketing_consent: { state: "unsubscribed" } },
    });
    expect(await database.client.emailJob.count({ where: { status: "skipped", lastError: "Customer unsubscribed." } })).toBe(2);
  });

  it("an order stops Still interested? and cart emails, and restarts Welcome back from that order", async () => {
    await enableSending();
    const customer = { id: 77, created_at: "2026-08-01T00:00:00Z", email_marketing_consent: { state: "subscribed" } };
    await enqueueEmailJob({ webhookId: "c1", shop, topic: "CUSTOMERS_CREATE", payload: { ...customer, email: "ria@example.com" } });
    await enqueueEmailJob({ webhookId: "k", shop, topic: "CHECKOUTS_UPDATE", payload: { ...eligibleCheckoutPayload(), customer } });

    const order = (id: number) => ({
      id,
      admin_graphql_api_id: `gid://shopify/Order/${id}`,
      buyer_accepts_marketing: true,
      customer,
    });
    await expect(enqueueEmailJob({ webhookId: "o1", shop, topic: "ORDERS_CREATE", payload: order(1001) })).resolves.toBe("queued");
    expect(await database.client.emailJob.count({ where: { status: "skipped", lastError: "Customer placed an order." } })).toBe(5);
    const winback = await database.client.emailJob.findMany({
      where: { emailId: { startsWith: "winback-" } },
      orderBy: { availableAt: "asc" },
    });
    expect(winback.map(({ availableAt }) => availableAt.getTime() - initialNow)).toEqual([30 * DAY, 44 * DAY, 74 * DAY]);
    expect(JSON.parse(winback[0].payload)).toEqual({ customer_id: "gid://shopify/Customer/77", order_id: "gid://shopify/Order/1001" });

    // A second order ten days later replaces the countdown.
    vi.mocked(Date.now).mockReturnValue(initialNow + 10 * DAY);
    await enqueueEmailJob({ webhookId: "o2", shop, topic: "ORDERS_CREATE", payload: order(1002) });
    const pending = await database.client.emailJob.findMany({ where: { status: "pending" }, orderBy: { availableAt: "asc" } });
    expect(pending).toHaveLength(3);
    expect(pending[0].availableAt).toEqual(new Date(initialNow + 40 * DAY));
  });

  it("does not start Welcome back for a customer who didn't accept marketing", async () => {
    await enableSending();
    await expect(
      enqueueEmailJob({
        webhookId: "o",
        shop,
        topic: "ORDERS_CREATE",
        payload: { id: 9, buyer_accepts_marketing: false, customer: { id: 5, email_marketing_consent: { state: "not_subscribed" } } },
      }),
    ).resolves.toBe("ignored");
    expect(await database.client.emailJob.count()).toBe(0);
  });

  it("Only send to new contacts skips customers created before it was switched on", async () => {
    await database.client.shopSettings.create({
      data: { shop, sendingEnabled: true, flowSettings: JSON.stringify({ cart: { onlyNewSince: "2026-08-15T00:00:00Z" } }) },
    });
    await expect(
      enqueueEmailJob({
        webhookId: "k1",
        shop,
        topic: "CHECKOUTS_UPDATE",
        payload: { ...eligibleCheckoutPayload(), customer: { id: 1, created_at: "2026-08-01T00:00:00Z" } },
      }),
    ).resolves.toBe("ignored");
    await expect(
      enqueueEmailJob({
        webhookId: "k2",
        shop,
        topic: "CHECKOUTS_UPDATE",
        payload: { ...eligibleCheckoutPayload(), token: "t2", customer: { id: 2, created_at: "2026-08-18T00:00:00Z" } },
      }),
    ).resolves.toBe("queued");
  });

  it("persists cart cancellation without creating an order email", async () => {
    await enableSending();
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
    ).resolves.toBe("ignored");

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
