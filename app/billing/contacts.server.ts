import db from "../db.server";

// Plans include a number of contacts: customers subscribed to email
// marketing, the only ones Nomi can email. The count comes from Shopify's
// customer index and is cached on ShopSettings so the send worker (which has
// no admin session) can enforce it.
const REFRESH_MS = 60 * 60_000;

type AdminGraphql = { graphql: (query: string) => Promise<Response> };

export async function refreshSubscribedContacts(
  shop: string,
  admin: AdminGraphql,
  { force = false }: { force?: boolean } = {},
): Promise<number | null> {
  const settings = await db.shopSettings.findUnique({
    where: { shop },
    select: { subscribedContacts: true, contactsCountedAt: true },
  });
  const fresh = settings?.contactsCountedAt && Date.now() - settings.contactsCountedAt.getTime() < REFRESH_MS;
  if (fresh && !force) return settings?.subscribedContacts ?? null;
  try {
    const response = await admin.graphql(`#graphql
      query NomiSubscribedContacts {
        customersCount(query: "email_marketing_state:SUBSCRIBED") { count }
      }
    `);
    const { data } = (await response.json()) as { data?: { customersCount?: { count?: number } } };
    const count = data?.customersCount?.count;
    if (typeof count !== "number") return settings?.subscribedContacts ?? null;
    await db.shopSettings.upsert({
      where: { shop },
      create: { shop, subscribedContacts: count, contactsCountedAt: new Date() },
      update: { subscribedContacts: count, contactsCountedAt: new Date() },
    });
    return count;
  } catch (error) {
    console.error(`[nomi] contact count failed for ${shop}`, error);
    return settings?.subscribedContacts ?? null;
  }
}
