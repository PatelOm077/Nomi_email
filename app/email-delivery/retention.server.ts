import type { PrismaClient } from "@prisma/client";
import db from "../db.server";

// Email jobs hold the customer's address and cart. The dashboard reads the
// last 30 days and sales attribution 5, so 180 days keeps every stat and
// nothing older. Unfinished jobs are left for the worker to settle.
export const EMAIL_JOB_RETENTION_DAYS = 180;

export async function purgeExpiredEmailJobs(client: PrismaClient = db, now = new Date()) {
  const cutoff = new Date(now.getTime() - EMAIL_JOB_RETENTION_DAYS * 86_400_000);
  const { count } = await client.emailJob.deleteMany({
    where: { createdAt: { lt: cutoff }, status: { notIn: ["pending", "processing"] } },
  });
  const logs = await client.accessLog.deleteMany({
    where: { at: { lt: new Date(now.getTime() - 365 * 86_400_000) } },
  });
  return { purged: count, accessLogsPurged: logs.count };
}
