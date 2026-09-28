import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPrismaTestDatabase,
  type PrismaTestDatabase,
} from "./test-support/prisma-test-database";

const shop = "stats-integration.myshopify.com";
const now = new Date("2026-09-20T12:00:00.000Z");

let database: PrismaTestDatabase;
let stats: typeof import("./email-stats.server");

async function sentJob(id: string, topic: string, recipient: string, sentAt: Date) {
  await database.client.emailJob.create({
    data: {
      id,
      webhookId: id,
      shop,
      topic,
      payload: "{}",
      status: "sent",
      providerMessageId: `msg-${id}`,
      recipient,
      sentAt,
    },
  });
}

describe("email stats with SQLite", () => {
  beforeAll(async () => {
    database = await createPrismaTestDatabase("nomi-stats-integration");
    vi.doMock("../db.server", () => ({ default: database.client }));
    stats = await import("./email-stats.server");
  });

  beforeEach(async () => {
    await database.client.emailJob.deleteMany();
  });

  afterAll(async () => {
    await database.dispose();
  });

  it("records the first open, and a click also counts as an open", async () => {
    await sentJob("a", "CHECKOUTS_UPDATE", "mina@example.com", now);
    await stats.recordEmailEngagement("msg-a", "clicked", now);
    await stats.recordEmailEngagement("msg-a", "opened", new Date(now.getTime() + 1000));
    const job = await database.client.emailJob.findUniqueOrThrow({ where: { id: "a" } });
    expect(job.openedAt?.toISOString()).toBe(now.toISOString());
    expect(job.clickedAt?.toISOString()).toBe(now.toISOString());
  });

  it("credits an order to the latest email in the window, once", async () => {
    await sentJob("old", "FULFILLMENTS_UPDATE", "mina@example.com", new Date(now.getTime() - 3 * 86_400_000));
    await sentJob("new", "CHECKOUTS_UPDATE", "mina@example.com", new Date(now.getTime() - 3_600_000));
    const order = { id: 9001, email: "Mina@Example.com", total_price: "84.50", currency: "USD" };
    await stats.attributeOrderConversion(shop, order, now);
    await stats.attributeOrderConversion(shop, order, now);
    const jobs = await database.client.emailJob.findMany({ where: { convertedAt: { not: null } } });
    expect(jobs.map(({ id }) => id)).toEqual(["new"]);
    expect(jobs[0].conversionValue).toBe(84.5);
  });

  it("ignores orders outside the attribution window", async () => {
    await sentJob("stale", "CHECKOUTS_UPDATE", "mina@example.com", new Date(now.getTime() - 6 * 86_400_000));
    await stats.attributeOrderConversion(shop, { id: 1, email: "mina@example.com", total_price: "10" }, now);
    const job = await database.client.emailJob.findUniqueOrThrow({ where: { id: "stale" } });
    expect(job.convertedAt).toBeNull();
  });

  it("aggregates per flow", async () => {
    await sentJob("c1", "CHECKOUTS_UPDATE", "a@example.com", now);
    await sentJob("c2", "CHECKOUTS_UPDATE", "b@example.com", now);
    await sentJob("r1", "FULFILLMENTS_UPDATE", "a@example.com", now);
    await stats.recordEmailEngagement("msg-c1", "opened", now);
    await stats.attributeOrderConversion(shop, { id: 7, email: "b@example.com", total_price: "20", currency: "CAD" }, now);
    const result = await stats.loadDashboardEmailStats(shop, new Date(now.getTime() - 86_400_000));
    expect(result.flows.cart).toEqual({ sent: 2, opened: 1, clicked: 0, conversions: 1, conversionValue: 20 });
    expect(result.flows.care.sent).toBe(1);
    expect(result.uniqueRecipients).toBe(2);
    expect(result.currency).toBe("CAD");
  });
});
