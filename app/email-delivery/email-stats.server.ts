import db from "../db.server";
import { emailIdForJob, flowOfEmail } from "./lifecycle-schedule";

// An order counts as a conversion for the most recent flow email the same
// customer was sent within this window before ordering.
export const ATTRIBUTION_WINDOW_MS = 5 * 24 * 60 * 60_000;

export type FlowStats = {
  sent: number;
  opened: number;
  clicked: number;
  conversions: number;
  conversionValue: number;
};

export type DashboardEmailStats = {
  flows: Record<string, FlowStats>;
  uniqueRecipients: number;
  currency: string | null;
};

// Resend email.opened / email.clicked. Only the first event of each kind is
// kept; a click also implies an open (image-blocking clients never fire one).
export async function recordEmailEngagement(
  providerMessageId: string,
  type: "opened" | "clicked",
  at: Date,
) {
  await db.emailJob.updateMany({
    where: { providerMessageId, openedAt: null },
    data: { openedAt: at },
  });
  if (type === "clicked") {
    await db.emailJob.updateMany({
      where: { providerMessageId, clickedAt: null },
      data: { clickedAt: at },
    });
  }
}

function orderEmail(payload: Record<string, unknown>): string | null {
  const customer = payload.customer as { email?: unknown } | null | undefined;
  for (const value of [payload.email, payload.contact_email, customer?.email]) {
    if (typeof value === "string" && value.includes("@")) return value.trim().toLowerCase();
  }
  return null;
}

// orders/create: credit the order to the latest flow email that customer was
// sent in the attribution window. One small indexed update, so it's safe in
// the webhook request. Each order is credited at most once.
export async function attributeOrderConversion(
  shop: string,
  payload: Record<string, unknown>,
  now = new Date(),
) {
  const email = orderEmail(payload);
  const orderId = payload.id == null ? null : String(payload.id);
  const value = Number(payload.total_price);
  if (!email || !orderId || !Number.isFinite(value)) return;

  const already = await db.emailJob.findFirst({
    where: { shop, conversionOrderId: orderId },
    select: { id: true },
  });
  if (already) return;

  const job = await db.emailJob.findFirst({
    where: {
      shop,
      recipient: email,
      status: "sent",
      convertedAt: null,
      sentAt: { gte: new Date(now.getTime() - ATTRIBUTION_WINDOW_MS), lte: now },
    },
    orderBy: { sentAt: "desc" },
    select: { id: true },
  });
  if (!job) return;

  await db.emailJob.update({
    where: { id: job.id },
    data: {
      convertedAt: now,
      conversionOrderId: orderId,
      conversionValue: value,
      conversionCurrency: typeof payload.currency === "string" ? payload.currency : null,
    },
  });
}

export async function loadDashboardEmailStats(
  shop: string,
  since: Date,
): Promise<DashboardEmailStats> {
  const jobs = await db.emailJob.findMany({
    where: { shop, status: "sent", sentAt: { gte: since } },
    select: {
      topic: true,
      emailId: true,
      recipient: true,
      openedAt: true,
      clickedAt: true,
      convertedAt: true,
      conversionValue: true,
      conversionCurrency: true,
    },
  });
  const flows: Record<string, FlowStats> = {};
  const recipients = new Set<string>();
  let currency: string | null = null;
  for (const job of jobs) {
    // Each email belongs to its own flow; flows that don't send report zeros.
    const flowId = flowOfEmail(emailIdForJob(job));
    if (!flowId) continue;
    const stats = (flows[flowId] ??= { sent: 0, opened: 0, clicked: 0, conversions: 0, conversionValue: 0 });
    stats.sent += 1;
    if (job.openedAt) stats.opened += 1;
    if (job.clickedAt) stats.clicked += 1;
    if (job.convertedAt) {
      stats.conversions += 1;
      stats.conversionValue += job.conversionValue ?? 0;
      currency ??= job.conversionCurrency;
    }
    if (job.recipient) recipients.add(job.recipient);
  }
  return { flows, uniqueRecipients: recipients.size, currency };
}
