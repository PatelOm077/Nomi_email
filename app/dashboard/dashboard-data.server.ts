// Shared Shopify-shape data-fetching for every route that needs the shop's
// live store record (products, most recent order, abandoned cart, shipped
// order, refund) — currently app._index.tsx (the Flow Editor) and
// app.additional.tsx (the Templates page). One round trip, mapped once, so
// a second page's data need doesn't mean a second near-identical query —
// see CLAUDE.md: "Check whether an existing fetch already answers the new
// card's question before adding one."

// One round trip: shop identity, the active theme's name (the closest thing
// to a "brand asset" the Admin API exposes — there's no logo/colors field),
// a handful of products, and the most recent order/shipment/cart/refund.
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
    products(first: 4, sortKey: UPDATED_AT, reverse: true) {
      edges {
        node {
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
    shippedOrders: orders(
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
            estimatedDeliveryAt
            trackingInfo {
              number
              url
              company
            }
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
    refundedOrders: orders(
      first: 10
      sortKey: UPDATED_AT
      reverse: true
      query: "financial_status:refunded OR financial_status:partially_refunded"
    ) {
      edges {
        node {
          name
          customer {
            firstName
          }
          refunds {
            note
            totalRefundedSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            refundLineItems(first: 5) {
              edges {
                node {
                  quantity
                  subtotalSet {
                    shopMoney {
                      amount
                      currencyCode
                    }
                  }
                  lineItem {
                    title
                    image {
                      url
                      altText
                    }
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

type DashboardQueryResponse = {
  data: {
    shop: { name: string };
    themes: { nodes: { name: string }[] };
    products: {
      edges: {
        node: {
          id: string;
          title: string;
          onlineStoreUrl: string | null;
          featuredMedia: { preview: { image: { url: string; altText: string | null } | null } | null } | null;
          priceRangeV2: { minVariantPrice: { amount: string; currencyCode: string } };
        };
      }[];
    };
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
    shippedOrders: {
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
            estimatedDeliveryAt: string | null;
            trackingInfo: { number: string | null; url: string | null; company: string | null }[];
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
    refundedOrders: {
      edges: {
        node: {
          name: string;
          customer: { firstName: string | null } | null;
          refunds: {
            note: string | null;
            totalRefundedSet: {
              shopMoney: { amount: string; currencyCode: string };
            };
            refundLineItems: {
              edges: {
                node: {
                  quantity: number;
                  subtotalSet: {
                    shopMoney: { amount: string; currencyCode: string };
                  };
                  lineItem: {
                    title: string;
                    image: { url: string; altText: string | null } | null;
                  };
                };
              }[];
            };
          }[];
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

// "IN_TRANSIT" -> "in transit". Covers every FulfillmentDisplayStatus
// value without a lookup table — they're all SCREAMING_SNAKE_CASE words.
function formatFulfillmentStatus(status: string): string {
  return status.toLowerCase().replace(/_/g, " ");
}

function formatDeliveryDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
  }).format(new Date(iso));
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

export interface DashboardShippingUpdate {
  orderNumber: string;
  customerFirstName: string | null;
  fulfillmentStatus: string;
  trackingNumber: string | null;
  carrierName: string | null;
  trackingUrl: string | null;
  estimatedDelivery: string | null;
  lineItems: { title: string; quantity: number; imageUrl: string | null; imageAlt: string }[];
}

export interface DashboardReviewRequest {
  orderNumber: string;
  customerFirstName: string | null;
  reviewUrl: string | null;
  lineItems: { title: string; quantity: number; imageUrl: string | null; imageAlt: string }[];
}

export interface DashboardRefund {
  orderNumber: string;
  customerFirstName: string | null;
  reason: string | null;
  total: string;
  lineItems: { title: string; quantity: number; imageUrl: string | null; imageAlt: string; total: string }[];
}

export interface DashboardData {
  shopName: string;
  themeName: string | null;
  products: DashboardProduct[];
  order: DashboardOrder | null;
  cart: DashboardCart | null;
  shippingUpdate: DashboardShippingUpdate | null;
  reviewRequest: DashboardReviewRequest | null;
  refund: DashboardRefund | null;
}

// Structural typing on purpose — matches Shopify's admin.graphql(...) shape
// without importing a Shopify SDK type here, so this module stays a plain
// data-shaping helper any route's loader can call with its own `admin`.
interface GraphqlAdmin {
  graphql: (query: string) => Promise<Response>;
}

export async function loadDashboardData(admin: GraphqlAdmin): Promise<DashboardData> {
  const response = await admin.graphql(DASHBOARD_QUERY);
  const { data } = (await response.json()) as DashboardQueryResponse;

  const products = data.products.edges.map(({ node }) => ({
    id: node.id,
    title: node.title,
    productUrl: node.onlineStoreUrl,
    imageUrl: node.featuredMedia?.preview?.image?.url ?? null,
    imageAlt: node.featuredMedia?.preview?.image?.altText ?? node.title,
    price: formatMoney(
      node.priceRangeV2.minVariantPrice.amount,
      node.priceRangeV2.minVariantPrice.currencyCode,
    ),
  }));

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

  const shippedOrderNode = data.shippedOrders.edges[0]?.node ?? null;
  const fulfillment = shippedOrderNode?.fulfillments[0] ?? null;
  const tracking = fulfillment?.trackingInfo[0] ?? null;
  const shippingUpdate =
    shippedOrderNode && fulfillment
      ? {
          orderNumber: shippedOrderNode.name,
          customerFirstName: shippedOrderNode.customer?.firstName ?? null,
          fulfillmentStatus: formatFulfillmentStatus(fulfillment.displayStatus),
          trackingNumber: tracking?.number ?? null,
          carrierName: tracking?.company ?? null,
          trackingUrl: tracking?.url ?? null,
          estimatedDelivery: fulfillment.estimatedDeliveryAt
            ? formatDeliveryDate(fulfillment.estimatedDeliveryAt)
            : null,
          lineItems: shippedOrderNode.lineItems.edges.map(({ node }) => ({
            title: node.title,
            quantity: node.quantity,
            imageUrl: node.image?.url ?? null,
            imageAlt: node.image?.altText ?? node.title,
          })),
        }
      : null;

  // Reuses the same shippedOrders fetch above rather than a separate
  // query — a review request is just that order once its fulfillment is
  // confirmed delivered, not shipped-but-in-transit.
  const reviewRequest =
    shippingUpdate && shippingUpdate.fulfillmentStatus === "delivered"
      ? {
          orderNumber: shippingUpdate.orderNumber,
          customerFirstName: shippingUpdate.customerFirstName,
          reviewUrl:
            shippedOrderNode!.lineItems.edges[0]?.node.product?.onlineStoreUrl ??
            null,
          lineItems: shippingUpdate.lineItems,
        }
      : null;

  const refundedOrderNode = data.refundedOrders.edges.find(
    ({ node }) => node.refunds.length > 0,
  )?.node;
  const refundNode = refundedOrderNode?.refunds.at(-1) ?? null;
  const refund =
    refundedOrderNode && refundNode
      ? {
          orderNumber: refundedOrderNode.name,
          customerFirstName: refundedOrderNode.customer?.firstName ?? null,
          reason: refundNode.note,
          total: formatMoney(
            refundNode.totalRefundedSet.shopMoney.amount,
            refundNode.totalRefundedSet.shopMoney.currencyCode,
          ),
          lineItems: refundNode.refundLineItems.edges.map(({ node }) => ({
            title: node.lineItem.title,
            quantity: node.quantity,
            imageUrl: node.lineItem.image?.url ?? null,
            imageAlt: node.lineItem.image?.altText ?? node.lineItem.title,
            total: formatMoney(
              node.subtotalSet.shopMoney.amount,
              node.subtotalSet.shopMoney.currencyCode,
            ),
          })),
        }
      : null;

  return {
    shopName: data.shop.name,
    themeName: data.themes.nodes[0]?.name ?? null,
    products,
    order,
    cart,
    shippingUpdate,
    reviewRequest,
    refund,
  };
}
