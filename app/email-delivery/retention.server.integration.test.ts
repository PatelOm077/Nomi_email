import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createPrismaTestDatabase,
  type PrismaTestDatabase,
} from "./test-support/prisma-test-database";
import { purgeExpiredEmailJobs } from "./retention.server";

let database: PrismaTestDatabase;

describe("email job retention", () => {
  beforeAll(async () => {
    database = await createPrismaTestDatabase("nomi-retention");
  });
  afterAll(async () => {
    await database.dispose();
  });

  it("deletes settled jobs older than 180 days and keeps recent or unfinished ones", async () => {
    const now = new Date("2026-09-28T12:00:00Z");
    const old = new Date("2026-03-01T12:00:00Z");
    const recent = new Date("2026-09-01T12:00:00Z");
    const job = (webhookId: string, status: string, createdAt: Date) =>
      database.client.emailJob.create({
        data: { webhookId, shop: "a.myshopify.com", topic: "checkouts/update", payload: "{}", status, createdAt },
      });
    await job("old-sent", "sent", old);
    await job("old-skipped", "skipped", old);
    await job("old-pending", "pending", old);
    await job("recent-sent", "sent", recent);

    expect(await purgeExpiredEmailJobs(database.client, now)).toEqual({ purged: 2, accessLogsPurged: 0 });
    const left = await database.client.emailJob.findMany({ select: { webhookId: true }, orderBy: { webhookId: "asc" } });
    expect(left.map(({ webhookId }) => webhookId)).toEqual(["old-pending", "recent-sent"]);
  });
});
