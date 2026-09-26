// Shared Shopify-shape data-fetching for every route that needs the shop's
// live store record (products, most recent order, abandoned cart, delivered
// order) — currently app._index.tsx (the Flow Editor) and
// app.additional.tsx (the Templates page). One round trip, mapped once, so
// a second page's data need doesn't mean a second near-identical query —
// see CLAUDE.md: "Check whether an existing fetch already answers the new
// card's question before adding one."

// One round trip: shop identity, the active theme's name (the closest thing
// to a "brand asset" the Admin API exposes — there's no logo/colors field),
// the most recent order/cart and a delivered order. Products are loaded separately
// through the paginated catalogue query below so no active product is omitted.
const DASHBOARD_QUERY = `#graphql
  query DashboardData {
    shop {
      name
    }
    themes(first: 1, roles: [MAIN]) {
      nodes {
        name
      }
    }
    orders(first: 1, sortKey: CREATED_AT, reverse: true) {
      edges {
        node {
          name
          customer {
            firstName
          }
          currentTotalPriceSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          lineItems(first: 5) {
            edges {
              node {
                title
                quantity
                image {
                  url
                  altText
                }
                originalTotalSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }
              }
            }
          }
        }
      }
    }
    deliveredOrders: orders(
      first: 1
      sortKey: CREATED_AT
      reverse: true
      query: "fulfillment_status:fulfilled"
    ) {
      edges {
        node {
          name
          customer {
            firstName
          }
          lineItems(first: 5) {
            edges {
              node {
                title
                quantity
                image {
                  url
                  altText
                }
                product {
                  onlineStoreUrl
                }
              }
            }
          }
          fulfillments(first: 1) {
            displayStatus
          }
        }
      }
    }
    abandonedCheckouts(first: 1, sortKey: CREATED_AT, reverse: true) {
      edges {
        node {
          abandonedCheckoutUrl
          customer {
            firstName
          }
          totalPriceSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          lineItems(first: 5) {
            edges {
              node {
                title
                quantity
                image {
                  url
                  altText
                }
                originalTotalPriceSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

const DASHBOARD_CATALOG_QUERY = `#graphql
  query DashboardCatalog($after: String) {
    shop {
      name
    }
    products(
      first: 100
      after: $after
      sortKey: UPDATED_AT
      reverse: true
      query: "status:active"
    ) {
      nodes {
        id
        title
        onlineStoreUrl
        featuredMedia {
          preview {
            image {
              url
              altText
            }
          }
        }
        priceRangeV2 {
          minVariantPrice {
            amount
            currencyCode
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const DASHBOARD_SHOP_IDENTITY_QUERY = `#graphql
  query DashboardShopIdentity {
    shop {
      name
    }
  }
`;

type DashboardQueryResponse = {
  data: {
    shop: { name: string };
    themes: { nodes: { name: string }[] };
    orders: {
      edges: {
        node: {
          name: string;
          customer: { firstName: string | null } | null;
          currentTotalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
          lineItems: {
            edges: {
              node: {
                title: string;
                quantity: number;
                image: { url: string; altText: string | null } | null;
                originalTotalSet: { shopMoney: { amount: string; currencyCode: string } };
              };
            }[];
          };
        };
      }[];
    };
    deliveredOrders: {
      edges: {
        node: {
          name: string;
          customer: { firstName: string | null } | null;
          lineItems: {
            edges: {
              node: {
                title: string;
                quantity: number;
                image: { url: string; altText: string | null } | null;
                product: { onlineStoreUrl: string | null } | null;
              };
            }[];
          };
          fulfillments: {
            displayStatus: string;
          }[];
        };
      }[];
    };
    abandonedCheckouts: {
      edges: {
        node: {
          abandonedCheckoutUrl: string;
          customer: { firstName: string | null } | null;
          totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
          lineItems: {
            edges: {
              node: {
                title: string | null;
                quantity: number;
                image: { url: string; altText: string | null } | null;
                originalTotalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
              };
            }[];
          };
        };
      }[];
    };
  };
};

function formatMoney(amount: string, currencyCode: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currencyCode,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number(amount));
}

export interface DashboardProduct {
  id: string;
  title: string;
  productUrl: string | null;
  imageUrl: string | null;
  imageAlt: string;
  price: string;
}

export interface DashboardOrder {
  name: string;
  customerFirstName: string | null;
  total: string;
  lineItems: { title: string; quantity: number; imageUrl: string | null; imageAlt: string; total: string }[];
}

export interface DashboardCart {
  recoveryUrl: string;
  customerFirstName: string | null;
  total: string;
  lineItems: { title: string; quantity: number; imageUrl: string | null; imageAlt: string; total: string }[];
}

export interface DashboardReviewRequest {
  orderNumber: string;
  customerFirstName: string | null;
  reviewUrl: string | null;
  lineItems: { title: string; quantity: number; imageUrl: string | null; imageAlt: string }[];
}

export interface DashboardData {
  shopName: string;
  themeName: string | null;
  products: DashboardProduct[];
  order: DashboardOrder | null;
  cart: DashboardCart | null;
  reviewRequest: DashboardReviewRequest | null;
}

// Structural typing on purpose — matches Shopify's admin.graphql(...) shape
// without importing a Shopify SDK type here, so this module stays a plain
// data-shaping helper any route's loader can call with its own `admin`.
interface GraphqlAdmin {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
}

export async function loadDashboardShopName(admin: GraphqlAdmin): Promise<string> {
  const response = await admin.graphql(DASHBOARD_SHOP_IDENTITY_QUERY);
  const { data } = (await response.json()) as { data: { shop: { name: string } } };
  return data.shop.name;
}

// Dashboard data only drives previews and display. A short cache keeps
// in-app navigation responsive without making the UI meaningfully stale.
const DASHBOARD_CACHE_TTL_MS = 60_000;
const dashboardDataCache = new Map<
  string,
  { expiresAt: number; value: DashboardData }
>();

const dashboardCatalogCache = new Map<
  string,
  { expiresAt: number; value: { shopName: string; products: DashboardProduct[] } }
>();

type DashboardCatalogResponse = {
  data?: {
    shop?: { name?: string };
    products?: {
      nodes?: Array<{
        id: string;
        title: string;
        onlineStoreUrl: string | null;
        featuredMedia: {
          preview: {
            image: { url: string; altText: string | null } | null;
          } | null;
        } | null;
        priceRangeV2: {
          minVariantPrice: { amount: string; currencyCode: string };
        };
      }>;
      pageInfo?: { hasNextPage: boolean; endCursor: string | null };
    };
  };
  errors?: Array<{ message?: string }>;
};

/**
 * Loads every active Shopify product with its authoritative featured image.
 * The catalogue is paginated instead of silently stopping at Shopify's
 * per-request connection limit, then cached briefly for in-app navigation.
 */
export async function loadDashboardCatalog(
  admin: GraphqlAdmin,
  cacheKey?: string,
): Promise<{ shopName: string; products: DashboardProduct[] }> {
  const cached = cacheKey ? dashboardCatalogCache.get(cacheKey) : undefined;
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const products: DashboardProduct[] = [];
  let shopName = "";
  let after: string | null = null;

  do {
    const response = await admin.graphql(DASHBOARD_CATALOG_QUERY, {
      variables: { after },
    });
    const payload = (await response.json()) as DashboardCatalogResponse;
    if (!response.ok || !payload.data?.shop?.name || !payload.data.products) {
      const detail = payload.errors
        ?.map(({ message }) => message)
        .filter(Boolean)
        .join("; ");
      throw new Error(
        detail
          ? `Shopify could not provide the product catalogue: ${detail}`
          : "Shopify could not provide the product catalogue.",
      );
    }

    shopName = payload.data.shop.name;
    products.push(
      ...(payload.data.products.nodes ?? []).map((node) => ({
        id: node.id,
        title: node.title,
        productUrl: node.onlineStoreUrl,
        imageUrl: node.featuredMedia?.preview?.image?.url ?? null,
        imageAlt: node.featuredMedia?.preview?.image?.altText ?? node.title,
        price: formatMoney(
          node.priceRangeV2.minVariantPrice.amount,
          node.priceRangeV2.minVariantPrice.currencyCode,
        ),
      })),
    );

    const pageInfo = payload.data.products.pageInfo;
    after = pageInfo?.hasNextPage ? pageInfo.endCursor : null;
    if (pageInfo?.hasNextPage && !after) {
      throw new Error("Shopify returned an incomplete product catalogue cursor.");
    }
  } while (after);

  const value = { shopName, products };
  if (cacheKey) {
    dashboardCatalogCache.set(cacheKey, {
      expiresAt: Date.now() + DASHBOARD_CACHE_TTL_MS,
      value,
    });
  }
  return value;
}

export async function loadDashboardData(
  admin: GraphqlAdmin,
  cacheKey?: string,
): Promise<DashboardData> {
  const cached = cacheKey ? dashboardDataCache.get(cacheKey) : undefined;
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const [response, catalog] = await Promise.all([
    admin.graphql(DASHBOARD_QUERY),
    loadDashboardCatalog(admin, cacheKey),
  ]);
  const { data } = (await response.json()) as DashboardQueryResponse;

  const products = catalog.products;

  const orderNode = data.orders.edges[0]?.node ?? null;
  const order = orderNode
    ? {
        name: orderNode.name,
        customerFirstName: orderNode.customer?.firstName ?? null,
        total: formatMoney(
          orderNode.currentTotalPriceSet.shopMoney.amount,
          orderNode.currentTotalPriceSet.shopMoney.currencyCode,
        ),
        lineItems: orderNode.lineItems.edges.map(({ node }) => ({
          title: node.title,
          quantity: node.quantity,
          imageUrl: node.image?.url ?? null,
          imageAlt: node.image?.altText ?? node.title,
          total: formatMoney(
            node.originalTotalSet.shopMoney.amount,
            node.originalTotalSet.shopMoney.currencyCode,
          ),
        })),
      }
    : null;

  const cartNode = data.abandonedCheckouts.edges[0]?.node ?? null;
  const cart = cartNode
    ? {
        recoveryUrl: cartNode.abandonedCheckoutUrl,
        customerFirstName: cartNode.customer?.firstName ?? null,
        total: formatMoney(
          cartNode.totalPriceSet.shopMoney.amount,
          cartNode.totalPriceSet.shopMoney.currencyCode,
        ),
        lineItems: cartNode.lineItems.edges.map(({ node }) => ({
          title: node.title ?? "Item",
          quantity: node.quantity,
          imageUrl: node.image?.url ?? null,
          imageAlt: node.image?.altText ?? node.title ?? "Item",
          total: formatMoney(
            node.originalTotalPriceSet.shopMoney.amount,
            node.originalTotalPriceSet.shopMoney.currencyCode,
          ),
        })),
      }
    : null;

  const deliveredOrderNode = data.deliveredOrders.edges[0]?.node ?? null;
  const deliveredFulfillment = deliveredOrderNode?.fulfillments[0] ?? null;

  // A review request only uses an order whose fulfillment is confirmed
  // delivered; other fulfillment states never become customer email.
  const reviewRequest =
    deliveredOrderNode && deliveredFulfillment?.displayStatus === "DELIVERED"
      ? {
          orderNumber: deliveredOrderNode.name,
          customerFirstName: deliveredOrderNode.customer?.firstName ?? null,
          reviewUrl:
            deliveredOrderNode.lineItems.edges[0]?.node.product?.onlineStoreUrl ??
            null,
          lineItems: deliveredOrderNode.lineItems.edges.map(({ node }) => ({
            title: node.title,
            quantity: node.quantity,
            imageUrl: node.image?.url ?? null,
            imageAlt: node.image?.altText ?? node.title,
          })),
        }
      : null;

  const dashboardData = {
    shopName: data.shop.name,
    themeName: data.themes.nodes[0]?.name ?? null,
    products,
    order,
    cart,
    reviewRequest,
  };

  if (cacheKey) {
    dashboardDataCache.set(cacheKey, {
      expiresAt: Date.now() + DASHBOARD_CACHE_TTL_MS,
      value: dashboardData,
    });
  }

  return dashboardData;
}
