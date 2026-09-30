// Charges paid plans for going past their monthly emails or subscribed
// contacts: $5 per started block of 500 (plans.ts), through Shopify App
// Pricing usage meters.
//
// Each paid plan in the Partner Dashboard carries two meters, both
// "Fixed", $5.00 per unit, 0 included units:
//   extra_emails_500    one unit per started 500 emails past the plan's
//   extra_contacts_500  one unit per started 500 subscribed contacts past it
// The worker queues every started block as a UsageReport row whose id is the
// App Events idempotency key, then reports each one once. Blocks are counted
// per calendar month, the same months the usage limits use.
//
// Off until NOMI_USAGE_BILLING=on, so nothing is reported before the meters
// exist (Shopify would log such events but never bill them, and the permanent
// idempotency keys would stop them being billed later).
import db from "../db.server";
import { unauthenticated } from "../shopify.server";
import { refreshSubscribedContacts } from "./contacts.server";
import {
  EXTRA_CONTACTS_BLOCK,
  EXTRA_EMAILS_BLOCK,
  planFor,
  usagePeriod,
  type Plan,
} from "./plans";

export const USAGE_METERS = {
  emails: "extra_emails_500",
  contacts: "extra_contacts_500",
} as const;

const APP_EVENTS_VERSION = "2026-10";
const MAX_ATTEMPTS = 10;

export function usageBillingEnabled(): boolean {
  return (
    process.env.NOMI_USAGE_BILLING === "on" &&
    Boolean(process.env.SHOPIFY_API_KEY && process.env.SHOPIFY_API_SECRET)
  );
}

/** Started 500-blocks past the plan's allowance. Free never has overage. */
export function overageBlocks(plan: Plan, emailsSent: number, contacts: number) {
  if (!plan.emailOverage) return { emails: 0, contacts: 0 };
  const includedEmails = plan.limits.email_sent ?? Infinity;
  return {
    emails: emailsSent > includedEmails ? Math.ceil((emailsSent - includedEmails) / EXTRA_EMAILS_BLOCK) : 0,
    contacts: contacts > plan.contacts ? Math.ceil((contacts - plan.contacts) / EXTRA_CONTACTS_BLOCK) : 0,
  };
}

// App Events idempotency keys max out at 64 characters.
export function usageReportId(shop: string, meter: string, period: string, block: number): string {
  const store = shop.replace(/\.myshopify\.com$/, "").slice(0, 30);
  return `${meter === USAGE_METERS.emails ? "em" : "ct"}:${store}:${period}:${block}`;
}

/** Queues any newly started overage blocks for this shop and month. */
export async function queueOverageBlocks(shop: string, now = new Date()): Promise<number> {
  const settings = await db.shopSettings.findUnique({
    where: { shop },
    select: { plan: true, subscribedContacts: true },
  });
  const plan = planFor(settings?.plan);
  if (!plan.emailOverage) return 0;
  const period = usagePeriod(plan, "email_sent", now);
  const counter = await db.usageCounter.findUnique({
    where: { shop_period_metric: { shop, period, metric: "email_sent" } },
  });
  const blocks = overageBlocks(plan, counter?.count ?? 0, settings?.subscribedContacts ?? 0);
  let queued = 0;
  for (const [meter, count] of [
    [USAGE_METERS.emails, blocks.emails],
    [USAGE_METERS.contacts, blocks.contacts],
  ] as const) {
    for (let block = 1; block <= count; block += 1) {
      const id = usageReportId(shop, meter, period, block);
      const existing = await db.usageReport.findUnique({ where: { id }, select: { id: true } });
      if (existing) continue;
      await db.usageReport.create({ data: { id, shop, meter, period, block } });
      queued += 1;
    }
  }
  return queued;
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function appEventsToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const response = await fetch("https://api.shopify.com/auth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.SHOPIFY_API_KEY,
      client_secret: process.env.SHOPIFY_API_SECRET,
      grant_type: "client_credentials",
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await response.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null;
  if (!response.ok || !body?.access_token) throw new Error(`App Events token request failed: ${response.status}`);
  cachedToken = { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return cachedToken.value;
}

/** Sends queued blocks to Shopify. A failure is retried on the next run. */
export async function flushUsageReports(limit = 50) {
  const result = { reported: 0, failed: 0 };
  const pending = await db.usageReport.findMany({
    where: { reportedAt: null, attempts: { lt: MAX_ATTEMPTS } },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  if (!pending.length) return result;
  const gids = new Map(
    (
      await db.shopSettings.findMany({
        where: { shop: { in: [...new Set(pending.map((row) => row.shop))] } },
        select: { shop: true, shopGid: true },
      })
    ).map((row) => [row.shop, row.shopGid]),
  );
  for (const row of pending) {
    const shopGid = gids.get(row.shop);
    if (!shopGid) continue;
    try {
      const response = await fetch(`https://api.shopify.com/app/${APP_EVENTS_VERSION}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await appEventsToken()}` },
        body: JSON.stringify({
          shop_id: shopGid,
          event_handle: row.meter,
          timestamp: row.createdAt.toISOString(),
          idempotency_key: row.id,
          attributes: { value: 1 },
        }),
        signal: AbortSignal.timeout(10_000),
      });
      // 409: Shopify is still processing this key; check again next run.
      if (response.status === 409) continue;
      if (response.status === 401) cachedToken = null;
      if (!response.ok) throw new Error(`App Events ${response.status}: ${(await response.text()).slice(0, 300)}`);
      await db.usageReport.update({ where: { id: row.id }, data: { reportedAt: new Date(), lastError: null } });
      result.reported += 1;
    } catch (error) {
      await db.usageReport.update({
        where: { id: row.id },
        data: { attempts: { increment: 1 }, lastError: (error instanceof Error ? error.message : String(error)).slice(0, 1000) },
      });
      result.failed += 1;
    }
  }
  return result;
}

/**
 * Scheduled from the email-jobs worker: for each shop on a paid plan, keeps
 * its subscribed-contact count fresh (it's otherwise only counted when the
 * merchant opens Nomi), queues new overage blocks, then reports them.
 */
export async function runUsageBilling(now = new Date()) {
  if (!usageBillingEnabled()) return { enabled: false };
  const shops = await db.shopSettings.findMany({
    where: { plan: { in: ["starter", "growth", "pro"] } },
    select: { shop: true, shopGid: true },
  });
  let queued = 0;
  for (const { shop, shopGid } of shops) {
    try {
      const { admin } = await unauthenticated.admin(shop);
      await refreshSubscribedContacts(shop, admin);
      if (!shopGid) {
        const response = await admin.graphql(`#graphql
          query NomiShopGid { shop { id } }
        `);
        const { data } = (await response.json()) as { data?: { shop?: { id?: string } } };
        if (data?.shop?.id) await db.shopSettings.update({ where: { shop }, data: { shopGid: data.shop.id } });
      }
      queued += await queueOverageBlocks(shop, now);
    } catch (error) {
      // An uninstalled shop has no session; skip it.
      console.error(`[nomi] usage billing skipped ${shop}`, error);
    }
  }
  return { enabled: true, queued, ...(await flushUsageReports()) };
}
