import db from "../db.server";
import { planIdFromHandles, type PlanId } from "./plans";

// Shopify App Pricing: the four plans live in the Partner Dashboard, Shopify
// hosts the plan page and charges the merchant, and Nomi reads the result
// from the Partner API's activeSubscription. No Billing API charges here.
//
// Needs SHOPIFY_PARTNER_API_ACCESS_TOKEN (a Partner API client with "Manage
// apps"), SHOPIFY_PARTNER_ORG_ID and SHOPIFY_APP_GID. Until they're set the
// app keeps its stored plan (and dev stores can switch in /app/pricing).

const PARTNER_API_VERSION = "2026-07";
// Shopify's app handle for "Nomi Email Marketing" (admin URL /apps/<handle>).
export const APP_HANDLE = "nomi-email-marketing";

export function shopifyPricingConfigured() {
  return Boolean(
    process.env.SHOPIFY_PARTNER_API_ACCESS_TOKEN &&
      process.env.SHOPIFY_PARTNER_ORG_ID &&
      process.env.SHOPIFY_APP_GID,
  );
}

/** Shopify's hosted plan page for this store. Open it with target _top. */
export function planSelectionUrl(shop: string) {
  const storeHandle = shop.replace(/\.myshopify\.com$/, "");
  return `https://admin.shopify.com/store/${storeHandle}/charges/${APP_HANDLE}/pricing_plans`;
}

/** Item handles of the shop's active subscription, or null when it has none. Throws on API failure. */
export async function fetchActiveSubscriptionHandles(shopGid: string): Promise<string[] | null> {
  const response = await fetch(
    `https://partners.shopify.com/${process.env.SHOPIFY_PARTNER_ORG_ID}/api/${PARTNER_API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": process.env.SHOPIFY_PARTNER_API_ACCESS_TOKEN ?? "",
      },
      body: JSON.stringify({
        query: `query NomiActiveSubscription($appId: ID!, $shopId: ID!) {
          activeSubscription(appId: $appId, shopId: $shopId) { items { handle } }
        }`,
        variables: { appId: process.env.SHOPIFY_APP_GID, shopId: shopGid },
      }),
      signal: AbortSignal.timeout(10_000),
    },
  );
  const body = (await response.json().catch(() => null)) as {
    data?: { activeSubscription: { items: { handle: string | null }[] } | null };
    errors?: unknown;
  } | null;
  // Throttling or failure must never downgrade a paying merchant.
  if (!response.ok || !body?.data || body.errors) {
    throw new Error(`Partner API request failed: ${response.status} ${JSON.stringify(body?.errors ?? "")}`);
  }
  const subscription = body.data.activeSubscription;
  return subscription ? subscription.items.map(({ handle }) => handle ?? "").filter(Boolean) : null;
}

// Shopify's docs suggest a short cache so the Partner API's 4 req/s limit
// holds; a merchant who just picked a plan is re-read via `force`.
const CACHE_MS = 5 * 60_000;
const lastSync = new Map<string, number>();

type AdminGraphql = { graphql: (query: string) => Promise<Response> };

/**
 * Copies the store's Shopify subscription into ShopSettings.plan (what the
 * usage limits read). No subscription means Free. Returns the plan, or null
 * when billing isn't configured or Shopify couldn't be reached.
 */
export async function syncPlanFromShopify(
  shop: string,
  admin: AdminGraphql,
  { force = false }: { force?: boolean } = {},
): Promise<PlanId | null> {
  if (!shopifyPricingConfigured()) return null;
  if (!force && Date.now() - (lastSync.get(shop) ?? 0) < CACHE_MS) return null;
  try {
    const response = await admin.graphql(`#graphql
      query NomiShopId { shop { id } }
    `);
    const { data } = (await response.json()) as { data?: { shop?: { id?: string } } };
    if (!data?.shop?.id) return null;
    const handles = await fetchActiveSubscriptionHandles(data.shop.id);
    const plan = handles ? planIdFromHandles(handles) ?? "free" : "free";
    await db.shopSettings.upsert({
      where: { shop },
      create: { shop, plan, shopGid: data.shop.id },
      update: { plan, shopGid: data.shop.id },
    });
    lastSync.set(shop, Date.now());
    return plan;
  } catch (error) {
    console.error(`[nomi] plan sync failed for ${shop}`, error);
    return null;
  }
}
