// The business name + postal address printed in every marketing email
// footer (CAN-SPAM / GDPR). The store's own address in Shopify (Settings →
// General → Store details) is the default, so most merchants never have to
// type it; Nomi's Sender info is only an override, and is only asked for
// when neither source has a complete address.

type AdminGraphql = { graphql: (query: string) => Promise<Response> };

const SHOP_ADDRESS_QUERY = `#graphql
  query SenderFooterShop {
    shop { name billingAddress { address1 address2 city province zip country } }
  }
`;

export type FooterAddress = {
  name: string | null;
  address: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  country: string | null;
};

export type SenderFooter = FooterAddress & {
  source: "sender-info" | "shopify" | null;
  complete: boolean;
  // One-line postal form for previews, e.g. "Lumen · 12 Main St, Surat, Gujarat 394101, India".
  line: string | null;
};

type SavedSender = {
  senderName?: string | null;
  senderAddress?: string | null;
  senderCity?: string | null;
  senderProvince?: string | null;
  senderPostalCode?: string | null;
  senderCountry?: string | null;
};

const text = (value: string | null | undefined) => value?.trim() || null;

export async function loadShopFooterAddress(admin: AdminGraphql): Promise<FooterAddress | null> {
  try {
    const response = await admin.graphql(SHOP_ADDRESS_QUERY);
    const json = (await response.json()) as {
      data?: { shop?: { name?: string | null; billingAddress?: Record<string, string | null> | null } };
    };
    const shop = json.data?.shop;
    if (!shop) return null;
    const a = shop.billingAddress ?? {};
    return {
      name: text(shop.name),
      address: [text(a.address1), text(a.address2)].filter(Boolean).join(", ") || null,
      city: text(a.city),
      province: text(a.province),
      postalCode: text(a.zip),
      country: text(a.country),
    };
  } catch {
    return null;
  }
}

export function isCompleteAddress(address: FooterAddress | null): boolean {
  return Boolean(address?.name && address.address && address.city && address.country);
}

function toLine(address: FooterAddress): string | null {
  const place = [address.city, [address.province, address.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const postal = [address.address, place, address.country].filter(Boolean).join(", ");
  return [address.name, postal].filter(Boolean).join(" · ") || null;
}

// Sender info wins when the merchant filled it in completely; otherwise the
// Shopify store address; otherwise whatever partial data exists (incomplete).
export function resolveSenderFooter(saved: SavedSender | null, shop: FooterAddress | null): SenderFooter {
  const override: FooterAddress = {
    name: text(saved?.senderName),
    address: text(saved?.senderAddress),
    city: text(saved?.senderCity),
    province: text(saved?.senderProvince),
    postalCode: text(saved?.senderPostalCode),
    country: text(saved?.senderCountry),
  };
  if (isCompleteAddress(override)) return { ...override, source: "sender-info", complete: true, line: toLine(override) };
  if (shop && isCompleteAddress(shop)) return { ...shop, source: "shopify", complete: true, line: toLine(shop) };
  const partial: FooterAddress = {
    name: override.name ?? shop?.name ?? null,
    address: override.address ?? shop?.address ?? null,
    city: override.city ?? shop?.city ?? null,
    province: override.province ?? shop?.province ?? null,
    postalCode: override.postalCode ?? shop?.postalCode ?? null,
    country: override.country ?? shop?.country ?? null,
  };
  return { ...partial, source: null, complete: false, line: null };
}

// Only in-app paths may be a post-save destination (no open redirects).
export function safeReturnTo(value: FormDataEntryValue | string | null | undefined): string | null {
  const path = typeof value === "string" ? value.trim() : "";
  return /^\/app(\/[\w\-/]*)?(\?[\w\-=&%]*)?$/.test(path) ? path : null;
}
