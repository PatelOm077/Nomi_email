import { createHmac, timingSafeEqual } from "node:crypto";
import db from "../db.server";

// Per-recipient unsubscribe links for every marketing email Nomi sends.
// The link carries a signed {shop, email} token — no database lookup to
// forge, nothing guessable — and works without the merchant being logged
// in. Unsubscribing writes a local EmailSuppression row (checked before
// every send) and marks the customer UNSUBSCRIBED in Shopify, so the
// merchant's customer list stays the source of truth for consent.

type Recipient = { shop: string; email: string };

const normalizeEmail = (email: string) => email.trim().toLowerCase();

function secret(): string {
  const value = process.env.UNSUBSCRIBE_SECRET || process.env.SHOPIFY_API_SECRET;
  if (!value) throw new Error("Unsubscribe links need UNSUBSCRIBE_SECRET or SHOPIFY_API_SECRET.");
  return value;
}

const sign = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url");

export function createUnsubscribeToken({ shop, email }: Recipient): string {
  const payload = Buffer.from(JSON.stringify({ s: shop, e: normalizeEmail(email) })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function readUnsubscribeToken(token: string | null | undefined): Recipient | null {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const { s, e } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { s?: unknown; e?: unknown };
    return typeof s === "string" && typeof e === "string" ? { shop: s, email: e } : null;
  } catch {
    return null;
  }
}

export function unsubscribeUrl(recipient: Recipient, appUrl = process.env.SHOPIFY_APP_URL ?? ""): string {
  if (!appUrl) throw new Error("SHOPIFY_APP_URL is required to build unsubscribe links.");
  return `${appUrl.replace(/\/$/, "")}/unsubscribe?t=${createUnsubscribeToken(recipient)}`;
}

// RFC 8058 one-click headers. Gmail and Yahoo require these for bulk senders
// and show their own "Unsubscribe" button next to the sender name.
export function listUnsubscribeHeaders(url: string): Record<string, string> {
  return { "List-Unsubscribe": `<${url}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
}

export async function isSuppressed({ shop, email }: Recipient): Promise<boolean> {
  const row = await db.emailSuppression.findUnique({
    where: { shop_email: { shop, email: normalizeEmail(email) } },
    select: { id: true },
  });
  return Boolean(row);
}

type AdminGraphql = { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> };

const FIND_CUSTOMER = `#graphql
  query UnsubscribeCustomer($query: String!) {
    customers(first: 1, query: $query) { nodes { id } }
  }
`;

const SET_UNSUBSCRIBED = `#graphql
  mutation UnsubscribeConsent($input: CustomerEmailMarketingConsentUpdateInput!) {
    customerEmailMarketingConsentUpdate(input: $input) {
      userErrors { field message }
    }
  }
`;

// Returns whether Shopify was updated. The local suppression row is written
// first and is what actually stops sends, so a Shopify failure never
// leaves the customer still receiving email.
export async function unsubscribe(
  recipient: Recipient,
  { source, admin }: { source: string; admin?: AdminGraphql | null },
): Promise<{ shopifyUpdated: boolean }> {
  const email = normalizeEmail(recipient.email);
  await db.emailSuppression.upsert({
    where: { shop_email: { shop: recipient.shop, email } },
    create: { shop: recipient.shop, email, reason: "unsubscribed", source },
    update: {},
  });
  if (!admin) return { shopifyUpdated: false };
  try {
    const found = await admin.graphql(FIND_CUSTOMER, { variables: { query: `email:"${email.replace(/"/g, "")}"` } });
    const customerId = ((await found.json()) as { data?: { customers?: { nodes?: { id: string }[] } } })
      .data?.customers?.nodes?.[0]?.id;
    if (!customerId) return { shopifyUpdated: false };
    const updated = await admin.graphql(SET_UNSUBSCRIBED, {
      variables: { input: { customerId, emailMarketingConsent: { marketingState: "UNSUBSCRIBED" } } },
    });
    const errors = ((await updated.json()) as {
      data?: { customerEmailMarketingConsentUpdate?: { userErrors?: { message: string }[] } };
    }).data?.customerEmailMarketingConsentUpdate?.userErrors ?? [];
    if (errors.length) console.error("Shopify unsubscribe rejected:", errors.map((e) => e.message).join("; "));
    return { shopifyUpdated: errors.length === 0 };
  } catch (error) {
    console.error("Shopify unsubscribe failed:", error);
    return { shopifyUpdated: false };
  }
}
