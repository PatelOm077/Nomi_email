import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPrismaTestDatabase,
  type PrismaTestDatabase,
} from "../email-delivery/test-support/prisma-test-database";
import { PLANS } from "./plans";

vi.mock("../shopify.server", () => ({ unauthenticated: { admin: vi.fn() } }));

const shop = "moon-mango.myshopify.com";
const now = new Date("2026-10-12T10:00:00Z");

let database: PrismaTestDatabase;
let billing: typeof import("./usage-billing.server");

describe("contactOverageBlocks", () => {
  beforeAll(async () => {
    billing = await import("./usage-billing.server");
  });

  it("counts every started block of 500 subscribed contacts past the plan", () => {
    expect(billing.contactOverageBlocks(PLANS.starter, 1_000)).toBe(0);
    expect(billing.contactOverageBlocks(PLANS.starter, 1_200)).toBe(1);
    expect(billing.contactOverageBlocks(PLANS.growth, 6_100)).toBe(3);
  });

  it("never bills Free, which pauses instead", () => {
    expect(billing.contactOverageBlocks(PLANS.free, 9_000)).toBe(0);
  });

  it("keeps idempotency keys within Shopify's 64 characters", () => {
    const id = billing.usageReportId(`${"a".repeat(60)}.myshopify.com`, "2026-10", 120);
    expect(id.length).toBeLessThanOrEqual(64);
  });
});

describe("usage billing with SQLite", () => {
  const fetchMock = vi.fn();

  beforeAll(async () => {
    database = await createPrismaTestDatabase("nomi-usage-billing");
    vi.resetModules();
    vi.doMock("../db.server", () => ({ default: database.client }));
    billing = await import("./usage-billing.server");
  });

  beforeEach(async () => {
    await database.client.usageReport.deleteMany();
    await database.client.usageCounter.deleteMany();
    await database.client.shopSettings.deleteMany();
    await database.client.shopSettings.create({
      data: { shop, plan: "starter", subscribedContacts: 1_600, shopGid: "gid://shopify/Shop/42" },
    });
    await database.client.usageCounter.create({ data: { shop, period: "2026-10", metric: "email_sent", count: 3_700 } });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("SHOPIFY_API_KEY", "key");
    vi.stubEnv("SHOPIFY_API_SECRET", "secret");
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    await database.dispose();
  });

  it("queues each started contact block once per month, and never bills extra emails", async () => {
    // 1,600 contacts on Starter = 2 blocks; 3,700 emails (700 over) aren't charged.
    await expect(billing.queueOverageBlocks(shop, now)).resolves.toBe(2);
    await expect(billing.queueOverageBlocks(shop, now)).resolves.toBe(0);
    const reports = await database.client.usageReport.findMany();
    expect(new Set(reports.map(({ meter }) => meter))).toEqual(new Set(["extra_contacts_500"]));

    await database.client.shopSettings.update({ where: { shop }, data: { subscribedContacts: 2_100 } });
    await expect(billing.queueOverageBlocks(shop, now)).resolves.toBe(1);
  });

  it("reports each block to App Events with its idempotency key, and retries failures", async () => {
    await billing.queueOverageBlocks(shop, now);
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      if (url.endsWith("/auth/access_token")) return Response.json({ access_token: "tok", expires_in: 3600 });
      const body = JSON.parse(String(init.body));
      if (body.idempotency_key.endsWith(":2") && body.event_handle === "extra_contacts_500") {
        return new Response("down", { status: 503 });
      }
      return Response.json({ success: true }, { status: 202 });
    });

    await expect(billing.flushUsageReports()).resolves.toEqual({ reported: 1, failed: 1 });
    const eventCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/app/"));
    expect(eventCall?.[0]).toBe("https://api.shopify.com/app/2026-10/events");
    expect(JSON.parse(String(eventCall?.[1].body))).toMatchObject({
      shop_id: "gid://shopify/Shop/42",
      attributes: { value: 1 },
    });

    fetchMock.mockImplementation(async () => Response.json({ success: true }, { status: 202 }));
    await expect(billing.flushUsageReports()).resolves.toEqual({ reported: 1, failed: 0 });
    await expect(billing.flushUsageReports()).resolves.toEqual({ reported: 0, failed: 0 });
  });

  it("stays off until NOMI_USAGE_BILLING=on", async () => {
    await expect(billing.runUsageBilling(now)).resolves.toEqual({ enabled: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
