import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPrismaTestDatabase,
  type PrismaTestDatabase,
} from "../email-delivery/test-support/prisma-test-database";
import { PLANS } from "./plans";

const shop = "plans-integration.myshopify.com";

let database: PrismaTestDatabase;
let usage: typeof import("./usage.server");

async function onPlan(plan: string) {
  await database.client.shopSettings.upsert({
    where: { shop },
    create: { shop, plan },
    update: { plan },
  });
}

describe("plan limits with SQLite", () => {
  beforeAll(async () => {
    database = await createPrismaTestDatabase("nomi-plans-integration");
    vi.doMock("../db.server", () => ({ default: database.client }));
    usage = await import("./usage.server");
  });

  beforeEach(async () => {
    vi.useRealTimers();
    await database.client.usageCounter.deleteMany();
    await database.client.shopSettings.deleteMany();
  });

  afterAll(async () => {
    await database.dispose();
  });

  it("treats a shop with no settings as Free", async () => {
    const allowance = await usage.checkAllowance("unknown.myshopify.com", "campaign");
    expect(allowance.plan.id).toBe("free");
    expect(allowance.allowed).toBe(true);
  });

  it("gives Free one-time allowances that never reset", async () => {
    await onPlan("free");
    await usage.recordUsage(shop, "campaign", 3);
    const allowance = await usage.checkAllowance(shop, "campaign");
    expect(allowance).toMatchObject({ allowed: false, used: 3, limit: 3 });
    expect(allowance.message).toBe("You've used the 3 campaigns included in the Free plan. Upgrade in Plan & billing to keep going.");

    // Next month changes nothing on Free.
    vi.useFakeTimers({ now: new Date(Date.now() + 40 * 86_400_000), toFake: ["Date"] });
    expect((await usage.checkAllowance(shop, "campaign")).allowed).toBe(false);
  });

  it("blocks what a plan doesn't include and allows one Brand Studio build on Free", async () => {
    await onPlan("free");
    const regenerateAll = await usage.checkAllowance(shop, "regenerate_all");
    expect(regenerateAll.allowed).toBe(false);
    expect(regenerateAll.message).toContain("aren't included in the Free plan");

    expect((await usage.checkAllowance(shop, "brand_build")).allowed).toBe(true);
    await usage.recordUsage(shop, "brand_build");
    expect((await usage.checkAllowance(shop, "brand_build")).allowed).toBe(false);
  });

  it("resets paid allowances each month", async () => {
    await onPlan("starter");
    await usage.recordUsage(shop, "email_regenerate", 15);
    const used = await usage.checkAllowance(shop, "email_regenerate");
    expect(used.allowed).toBe(false);
    expect(used.message).toContain("this month");

    vi.useFakeTimers({ now: new Date(Date.now() + 40 * 86_400_000), toFake: ["Date"] });
    expect(await usage.checkAllowance(shop, "email_regenerate")).toMatchObject({ allowed: true, used: 0 });
  });

  it("stops Free at 500 emails a month but lets paid plans keep sending", async () => {
    await onPlan("free");
    await usage.recordUsage(shop, "email_sent", 500);
    expect((await usage.checkAllowance(shop, "email_sent")).allowed).toBe(false);

    await onPlan("growth");
    await usage.recordUsage(shop, "email_sent", 15_600);
    expect((await usage.checkAllowance(shop, "email_sent")).allowed).toBe(true);
  });

  it("pauses Free sending over 250 subscribed contacts but lets paid plans keep sending", async () => {
    await database.client.shopSettings.upsert({
      where: { shop },
      create: { shop, plan: "free", subscribedContacts: 251 },
      update: { plan: "free", subscribedContacts: 251 },
    });
    const free = await usage.checkAllowance(shop, "email_sent");
    expect(free.allowed).toBe(false);
    expect(free.message).toContain("251 subscribed contacts");

    await database.client.shopSettings.update({ where: { shop }, data: { subscribedContacts: 250 } });
    expect((await usage.checkAllowance(shop, "email_sent")).allowed).toBe(true);

    await database.client.shopSettings.update({ where: { shop }, data: { plan: "starter", subscribedContacts: 4_000 } });
    expect((await usage.checkAllowance(shop, "email_sent")).allowed).toBe(true);
  });

  it("summarises usage against the current plan", async () => {
    await onPlan("growth");
    await usage.recordUsage(shop, "campaign", 4);
    const summary = await usage.usageSummary(shop);
    expect(summary.plan.id).toBe("growth");
    expect(summary.rows.find(({ metric }) => metric === "campaign")).toMatchObject({ used: 4, limit: 20, lifetime: false });
    expect(summary.rows.find(({ metric }) => metric === "brand_build")).toMatchObject({ limit: null });
  });
});

describe("plan pricing", () => {
  it("bills $5 per started block of 500 extra contacts on paid plans only", async () => {
    const { contactOverageUsd } = await import("./plans");
    expect(contactOverageUsd(PLANS.starter, 1_000)).toBe(0);
    expect(contactOverageUsd(PLANS.starter, 1_001)).toBe(5);
    expect(contactOverageUsd(PLANS.growth, 6_000)).toBe(10);
    expect(contactOverageUsd(PLANS.free, 900)).toBe(0);
    expect([PLANS.free, PLANS.starter, PLANS.growth, PLANS.pro].map(({ contacts }) => contacts)).toEqual([250, 1_000, 5_000, 15_000]);
  });
  it("matches the agreed plans", () => {
    expect([PLANS.free, PLANS.starter, PLANS.growth, PLANS.pro].map(({ priceUsd }) => priceUsd)).toEqual([0, 29, 79, 199]);
    expect([PLANS.free, PLANS.starter, PLANS.growth, PLANS.pro].map(({ limits }) => limits.campaign)).toEqual([3, 10, 20, 40]);
    expect(PLANS.free.limits).toMatchObject({ brand_build: 1, email_regenerate: 3, email_sent: 500 });
  });
});

describe("Shopify App Pricing plan handles", () => {
  it("maps plan handles from the Partner Dashboard to Nomi plans", async () => {
    const { planIdFromHandles } = await import("./plans");
    expect(planIdFromHandles(["growth"])).toBe("growth");
    expect(planIdFromHandles(["nomi_pro_monthly"])).toBe("pro");
    expect(planIdFromHandles(["Starter-Plan", "extra-emails"])).toBe("starter");
    expect(planIdFromHandles(["progress"])).toBeNull();
    expect(planIdFromHandles([])).toBeNull();
  });
});
