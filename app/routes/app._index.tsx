import { useEffect, useRef, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { isEmailDeliveryConfigured } from "../email-delivery/config.server";
import { generateOrderConfirmationEmail } from "../email-engine/generate-order-confirmation-email";
import { generateAbandonedCartEmail } from "../email-engine/generate-abandoned-cart-email";
import { generateShippingUpdateEmail } from "../email-engine/generate-shipping-update-email";
import { generateReviewRequestEmail } from "../email-engine/generate-review-request-email";
import { generateRefundConfirmationEmail } from "../email-engine/generate-refund-confirmation-email";
import { generateNewsletterEmail } from "../email-engine/generate-newsletter-email";
import type {
  AbandonedCartRecovery,
  EmailLanguage,
  NewsletterCampaign,
  OrderConfirmationOrder,
  RefundConfirmation,
  ReviewRequest,
  ShippingUpdate,
} from "../email-engine/types";
import { EMAIL_LANGUAGES } from "../email-engine/types";

// One round trip: shop identity, the active theme's name (the closest thing
// to a "brand asset" the Admin API exposes — there's no logo/colors field,
// see explanation below), a handful of products, and the most recent order.
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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  const providerConfigured = isEmailDeliveryConfigured();
  const settings = await db.shopSettings.upsert({
    where: { shop: session.shop },
    create: {
      shop: session.shop,
      sendingEnabled: providerConfigured,
    },
    update: {},
  });

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
    delivery: {
      providerConfigured,
      sendingEnabled: settings.sendingEnabled,
      language: settings.language,
      pendingJobs: await db.emailJob.count({
        where: { shop: session.shop, status: "pending" },
      }),
    },
  };
};

type DashboardOrder = Awaited<ReturnType<typeof loader>>["order"];
type DashboardCart = Awaited<ReturnType<typeof loader>>["cart"];
type DashboardShippingUpdate = Awaited<ReturnType<typeof loader>>["shippingUpdate"];
type DashboardReviewRequest = Awaited<ReturnType<typeof loader>>["reviewRequest"];
type DashboardRefund = Awaited<ReturnType<typeof loader>>["refund"];

// Maps the Shopify-shaped order the loader already fetched onto the
// engine's platform-neutral input. This mapping — not the engine itself —
// is where Shopify-specific knowledge is allowed to live.
function toEngineOrder(
  shopName: string,
  order: NonNullable<DashboardOrder>,
  language: EmailLanguage,
): OrderConfirmationOrder {
  return {
    shopName,
    language,
    customerFirstName: order.customerFirstName,
    orderNumber: order.name,
    total: order.total,
    lineItems: order.lineItems.map((item) => ({
      title: item.title,
      quantity: item.quantity,
      price: item.total,
      imageUrl: item.imageUrl,
    })),
  };
}

// Same mapping boundary as toEngineOrder, for the other Shopify-shaped
// record the loader fetches.
function toEngineCart(
  shopName: string,
  cart: NonNullable<DashboardCart>,
  language: EmailLanguage,
): AbandonedCartRecovery {
  return {
    shopName,
    language,
    customerFirstName: cart.customerFirstName,
    recoveryUrl: cart.recoveryUrl,
    total: cart.total,
    lineItems: cart.lineItems.map((item) => ({
      title: item.title,
      quantity: item.quantity,
      price: item.total,
      imageUrl: item.imageUrl,
    })),
  };
}

// Same mapping boundary again, for the shipped order the loader fetches.
function toEngineShippingUpdate(
  shopName: string,
  update: NonNullable<DashboardShippingUpdate>,
  language: EmailLanguage,
): ShippingUpdate {
  return {
    shopName,
    language,
    customerFirstName: update.customerFirstName,
    orderNumber: update.orderNumber,
    fulfillmentStatus: update.fulfillmentStatus,
    trackingNumber: update.trackingNumber,
    carrierName: update.carrierName,
    trackingUrl: update.trackingUrl,
    estimatedDelivery: update.estimatedDelivery,
    lineItems: update.lineItems.map((item) => ({
      title: item.title,
      quantity: item.quantity,
      imageUrl: item.imageUrl,
    })),
  };
}

// Same mapping boundary again, for the delivered order the loader derives.
function toEngineReviewRequest(
  shopName: string,
  request: NonNullable<DashboardReviewRequest>,
  language: EmailLanguage,
): ReviewRequest {
  return {
    shopName,
    language,
    customerFirstName: request.customerFirstName,
    orderNumber: request.orderNumber,
    reviewUrl: request.reviewUrl,
    lineItems: request.lineItems.map((item) => ({
      title: item.title,
      quantity: item.quantity,
      imageUrl: item.imageUrl,
    })),
  };
}

function toEngineRefund(
  shopName: string,
  refund: NonNullable<DashboardRefund>,
  language: EmailLanguage,
): RefundConfirmation {
  return {
    shopName,
    language,
    customerFirstName: refund.customerFirstName,
    orderNumber: refund.orderNumber,
    refundedTotal: refund.total,
    reason: refund.reason,
    lineItems: refund.lineItems.map((item) => ({
      title: item.title,
      quantity: item.quantity,
      price: item.total,
      imageUrl: item.imageUrl,
    })),
  };
}

// One action for all four generators, distinguished by `kind`, so the
// client only needs one fetcher endpoint per card and each branch stays a
// thin call into the platform-neutral engine.
type GenerationRequest =
  | { kind: "order-confirmation"; shopName: string; language: EmailLanguage; order: NonNullable<DashboardOrder> }
  | { kind: "abandoned-cart"; shopName: string; language: EmailLanguage; cart: NonNullable<DashboardCart> }
  | { kind: "shipping-update"; shopName: string; language: EmailLanguage; update: NonNullable<DashboardShippingUpdate> }
  | { kind: "review-request"; shopName: string; language: EmailLanguage; request: NonNullable<DashboardReviewRequest> }
  | { kind: "refund-confirmation"; shopName: string; language: EmailLanguage; refund: NonNullable<DashboardRefund> }
  | { kind: "newsletter"; shopName: string; language: EmailLanguage; prompt: string; products: NewsletterCampaign["products"] };

type DashboardActionRequest =
  | GenerationRequest
  | { kind: "set-sending"; enabled: boolean }
  | { kind: "set-language"; language: EmailLanguage };

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const formData = await request.formData();
  const payload = formData.get("payload");
  if (typeof payload !== "string") {
    return { error: "Missing request data." };
  }

  try {
    const parsed = JSON.parse(payload) as DashboardActionRequest;
    if (parsed.kind === "set-sending") {
      if (parsed.enabled && !isEmailDeliveryConfigured()) {
        return { error: "Configure the email provider before enabling sends." };
      }
      await db.shopSettings.upsert({
        where: { shop: session.shop },
        create: { shop: session.shop, sendingEnabled: parsed.enabled },
        update: { sendingEnabled: parsed.enabled },
      });
      return { deliveryUpdated: true };
    }
    if (parsed.kind === "set-language") {
      if (!EMAIL_LANGUAGES.some(({ code }) => code === parsed.language)) {
        return { error: "Unsupported email language." };
      }
      await db.shopSettings.upsert({
        where: { shop: session.shop },
        create: { shop: session.shop, language: parsed.language },
        update: { language: parsed.language },
      });
      return { deliveryUpdated: true };
    }

    let html: string;
    switch (parsed.kind) {
      case "order-confirmation":
        html = await generateOrderConfirmationEmail(
          toEngineOrder(parsed.shopName, parsed.order, parsed.language),
        );
        break;
      case "abandoned-cart":
        html = await generateAbandonedCartEmail(
          toEngineCart(parsed.shopName, parsed.cart, parsed.language),
        );
        break;
      case "shipping-update":
        html = await generateShippingUpdateEmail(
          toEngineShippingUpdate(parsed.shopName, parsed.update, parsed.language),
        );
        break;
      case "review-request":
        html = await generateReviewRequestEmail(
          toEngineReviewRequest(parsed.shopName, parsed.request, parsed.language),
        );
        break;
      case "refund-confirmation":
        html = await generateRefundConfirmationEmail(
          toEngineRefund(parsed.shopName, parsed.refund, parsed.language),
        );
        break;
      case "newsletter": {
        const prompt = parsed.prompt.trim();
        if (!prompt || prompt.length > 1000) {
          return { error: "Describe the campaign in 1–1000 characters." };
        }
        html = await generateNewsletterEmail({
          shopName: parsed.shopName,
          language: parsed.language,
          prompt,
          products: parsed.products,
        });
        break;
      }
    }
    return { html };
  } catch (error) {
    console.error("Email generation failed:", error);
    return { error: "Couldn't generate that email — try again." };
  }
};

// Revenue headline stays dummy until we're actually attributing sales to
// sent emails — that's a later milestone, not a data-fetching one.
const REVENUE = "$1,284";

type TemplateStatus = "Live" | "Draft";

function resolveDashboardLanguage(value: string): EmailLanguage {
  return EMAIL_LANGUAGES.some(({ code }) => code === value)
    ? (value as EmailLanguage)
    : "en";
}

export default function Index() {
  const { shopName, themeName, products, order, cart, shippingUpdate, reviewRequest, refund, delivery } =
    useLoaderData<typeof loader>();
  const [campaign, setCampaign] = useState("");
  const [language, setLanguage] = useState<EmailLanguage>(
    resolveDashboardLanguage(delivery.language),
  );
  const deliveryFetcher = useFetcher<typeof action>();

  // Kick off the real generation the moment the dashboard has a real order
  // to work with. useRef (not fetcher state) guards against the double
  // effect invocation React can trigger in dev, so we never submit twice.
  const orderFetcher = useFetcher<typeof action>();
  const requestedOrderLanguage = useRef<EmailLanguage | null>(null);
  useEffect(() => {
    if (!order || requestedOrderLanguage.current === language) return;
    requestedOrderLanguage.current = language;
    orderFetcher.submit(
      { payload: JSON.stringify({ kind: "order-confirmation", shopName, language, order }) },
      { method: "POST" },
    );
    // orderFetcher is stable across renders; including it would re-run this
    // effect on every fetcher state change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, order, shopName]);

  const generatedOrderHtml: string | null =
    orderFetcher.data && "html" in orderFetcher.data
      ? orderFetcher.data.html ?? null
      : null;
  const orderGenerationFailed = Boolean(
    orderFetcher.data && "error" in orderFetcher.data,
  );

  // Same pattern as the order fetcher above, for the abandoned-cart card.
  // A separate fetcher because the two cards generate independently — one
  // finishing (or failing) shouldn't block or clear the other.
  const cartFetcher = useFetcher<typeof action>();
  const requestedCartLanguage = useRef<EmailLanguage | null>(null);
  useEffect(() => {
    if (!cart || requestedCartLanguage.current === language) return;
    requestedCartLanguage.current = language;
    cartFetcher.submit(
      { payload: JSON.stringify({ kind: "abandoned-cart", shopName, language, cart }) },
      { method: "POST" },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, language, shopName]);

  const generatedCartHtml: string | null =
    cartFetcher.data && "html" in cartFetcher.data
      ? cartFetcher.data.html ?? null
      : null;
  const cartGenerationFailed = Boolean(
    cartFetcher.data && "error" in cartFetcher.data,
  );

  // Same pattern again, for the shipping-update card.
  const shippingFetcher = useFetcher<typeof action>();
  const requestedShippingLanguage = useRef<EmailLanguage | null>(null);
  useEffect(() => {
    if (!shippingUpdate || requestedShippingLanguage.current === language) return;
    requestedShippingLanguage.current = language;
    shippingFetcher.submit(
      { payload: JSON.stringify({ kind: "shipping-update", shopName, language, update: shippingUpdate }) },
      { method: "POST" },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, shippingUpdate, shopName]);

  const generatedShippingHtml: string | null =
    shippingFetcher.data && "html" in shippingFetcher.data
      ? shippingFetcher.data.html ?? null
      : null;
  const shippingGenerationFailed = Boolean(
    shippingFetcher.data && "error" in shippingFetcher.data,
  );

  // Same pattern again, for the review-request card.
  const reviewFetcher = useFetcher<typeof action>();
  const requestedReviewLanguage = useRef<EmailLanguage | null>(null);
  useEffect(() => {
    if (!reviewRequest || requestedReviewLanguage.current === language) return;
    requestedReviewLanguage.current = language;
    reviewFetcher.submit(
      { payload: JSON.stringify({ kind: "review-request", shopName, language, request: reviewRequest }) },
      { method: "POST" },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, reviewRequest, shopName]);

  const generatedReviewHtml: string | null =
    reviewFetcher.data && "html" in reviewFetcher.data
      ? reviewFetcher.data.html ?? null
      : null;
  const reviewGenerationFailed = Boolean(
    reviewFetcher.data && "error" in reviewFetcher.data,
  );

  const refundFetcher = useFetcher<typeof action>();
  const requestedRefundLanguage = useRef<EmailLanguage | null>(null);
  useEffect(() => {
    if (!refund || requestedRefundLanguage.current === language) return;
    requestedRefundLanguage.current = language;
    refundFetcher.submit(
      { payload: JSON.stringify({ kind: "refund-confirmation", shopName, language, refund }) },
      { method: "POST" },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, refund, shopName]);

  const generatedRefundHtml: string | null =
    refundFetcher.data && "html" in refundFetcher.data
      ? refundFetcher.data.html ?? null
      : null;
  const refundGenerationFailed = Boolean(
    refundFetcher.data && "error" in refundFetcher.data,
  );

  const campaignFetcher = useFetcher<typeof action>();
  const generatedCampaignHtml: string | null =
    campaignFetcher.data && "html" in campaignFetcher.data
      ? campaignFetcher.data.html ?? null
      : null;
  const campaignError =
    campaignFetcher.data && "error" in campaignFetcher.data
      ? campaignFetcher.data.error
      : null;

  const generateCampaign = () => {
    const prompt = campaign.trim();
    if (!prompt) return;
    campaignFetcher.submit(
      {
        payload: JSON.stringify({
          kind: "newsletter",
          shopName,
          language,
          prompt,
          products: products.map((product) => ({
            title: product.title,
            price: product.price,
            imageUrl: product.imageUrl,
            productUrl: product.productUrl,
          })),
        }),
      },
      { method: "POST" },
    );
  };

  const templates: {
    id: string;
    name: string;
    status: TemplateStatus;
    preview: React.ReactNode;
  }[] = [
    {
      id: "order-confirmation",
      name: "Order confirmation",
      status: "Live",
      preview: (
        <OrderConfirmationPreview
          shopName={shopName}
          order={order}
          generatedHtml={generatedOrderHtml}
          isGenerating={
            Boolean(order) && !generatedOrderHtml && !orderGenerationFailed
          }
        />
      ),
    },
    {
      id: "shipping-update",
      name: "Shipping update",
      status: "Live",
      preview: (
        <ShippingUpdatePreview
          update={shippingUpdate}
          generatedHtml={generatedShippingHtml}
          isGenerating={
            Boolean(shippingUpdate) &&
            !generatedShippingHtml &&
            !shippingGenerationFailed
          }
        />
      ),
    },
    {
      id: "abandoned-cart",
      name: "Abandoned cart",
      status: "Live",
      preview: (
        <AbandonedCartPreview
          cart={cart}
          generatedHtml={generatedCartHtml}
          isGenerating={
            Boolean(cart) && !generatedCartHtml && !cartGenerationFailed
          }
        />
      ),
    },
    {
      id: "review-request",
      name: "Review request",
      status: "Live",
      preview: (
        <ReviewRequestPreview
          request={reviewRequest}
          generatedHtml={generatedReviewHtml}
          isGenerating={
            Boolean(reviewRequest) &&
            !generatedReviewHtml &&
            !reviewGenerationFailed
          }
        />
      ),
    },
    {
      id: "refund-confirmation",
      name: "Refund confirmation",
      status: "Live",
      preview: (
        <RefundConfirmationPreview
          refund={refund}
          generatedHtml={generatedRefundHtml}
          isGenerating={
            Boolean(refund) && !generatedRefundHtml && !refundGenerationFailed
          }
        />
      ),
    },
  ];

  return (
    <div className="nomi-page">
      <div className="nomi-shell">
        <header className="nomi-header">
          <div className="nomi-brand">
            <div className="nomi-mark">
              <svg
                width="22"
                height="22"
                viewBox="0 0 64 64"
                fill="none"
                stroke="var(--nomi-paper)"
                strokeWidth="3.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M50 16 L14 30 L29 36 L50 16 Z" />
                <path d="M29 36 L33 50 L50 16" />
              </svg>
            </div>
            <span className="nomi-wordmark">Nomi</span>
            <span className="nomi-brand-divider" />
            <span className="nomi-shop">
              {shopName}
              {themeName ? ` · ${themeName}` : ""}
            </span>
          </div>
          <h1 className="nomi-headline">
            Your emails made {REVENUE} this month.
          </h1>
        </header>

        <section className="nomi-delivery-strip" aria-label="Email delivery status">
          <div>
            <strong>{delivery.sendingEnabled ? "Sending enabled" : "Sending needs provider setup"}</strong>
            <span>
              {delivery.sendingEnabled
                ? ` Shopify events are queued and sent automatically${delivery.pendingJobs ? ` · ${delivery.pendingJobs} waiting` : ""}.`
                : " Add the Resend sender and worker secrets to activate webhook delivery on install."}
            </span>
          </div>
          <span className={`nomi-badge ${delivery.sendingEnabled ? "nomi-badge-live" : "nomi-badge-draft"}`}>
            {delivery.sendingEnabled ? "Enabled" : delivery.providerConfigured ? "Paused" : "Setup"}
          </span>
          {delivery.providerConfigured ? (
            <button
              className="nomi-text-button"
              type="button"
              disabled={deliveryFetcher.state !== "idle"}
              onClick={() =>
                deliveryFetcher.submit(
                  {
                    payload: JSON.stringify({
                      kind: "set-sending",
                      enabled: !delivery.sendingEnabled,
                    }),
                  },
                  { method: "POST" },
                )
              }
            >
              {delivery.sendingEnabled ? "Pause" : "Enable sending"}
            </button>
          ) : null}
        </section>

        <section className="nomi-section">
          <div className="nomi-section-title-row">
            <h2 className="nomi-section-heading">Templates</h2>
            <label className="nomi-language-field">
              <span>Email language</span>
              <select
                className="nomi-select"
                value={language}
                onChange={(event) => {
                  const nextLanguage = event.target.value as EmailLanguage;
                  setLanguage(nextLanguage);
                  deliveryFetcher.submit(
                    {
                      payload: JSON.stringify({
                        kind: "set-language",
                        language: nextLanguage,
                      }),
                    },
                    { method: "POST" },
                  );
                }}
              >
                {EMAIL_LANGUAGES.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="nomi-grid">
            {templates.map(({ id, name, status, preview }) => (
              <article className="nomi-card" key={id}>
                {preview}
                <div className="nomi-card-footer">
                  <span className="nomi-card-name">{name}</span>
                  <span
                    className={`nomi-badge ${
                      status === "Live" ? "nomi-badge-live" : "nomi-badge-draft"
                    }`}
                  >
                    {status}
                  </span>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="nomi-section">
          <h2 className="nomi-section-heading">Products</h2>
          {products.length > 0 ? (
            <div className="nomi-products-row">
              {products.map((product) => (
                <div className="nomi-product-tile" key={product.id}>
                  {product.imageUrl ? (
                    <img
                      className="nomi-product-thumb"
                      src={product.imageUrl}
                      alt={product.imageAlt}
                    />
                  ) : (
                    <div className="nomi-product-thumb nomi-thumb" />
                  )}
                  <span className="nomi-product-title">{product.title}</span>
                  <span className="nomi-product-price">{product.price}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="nomi-hint">
              No products yet — add one in this dev store to see it here.
            </p>
          )}
        </section>

        <section className="nomi-section nomi-campaign-section">
          <h2 className="nomi-section-heading">Campaigns</h2>
          <form
            className="nomi-form"
            onSubmit={(event) => {
              event.preventDefault();
              generateCampaign();
            }}
          >
            <label className="nomi-visually-hidden" htmlFor="campaign-prompt">
              Describe a campaign
            </label>
            <input
              id="campaign-prompt"
              className="nomi-input"
              type="text"
              maxLength={1000}
              value={campaign}
              onChange={(event) => setCampaign(event.target.value)}
              placeholder="Describe a campaign — 'Diwali sale, 15% off'"
            />
            <button
              className="nomi-button"
              type="submit"
              disabled={
                campaign.trim() === "" || campaignFetcher.state !== "idle"
              }
            >
              {campaignFetcher.state === "idle" ? "Generate" : "Generating…"}
            </button>
          </form>
          {campaignError ? (
            <p className="nomi-form-error" role="alert">{campaignError}</p>
          ) : null}
          {generatedCampaignHtml ? (
            <div className="nomi-campaign-preview">
              <GeneratedEmailPreview
                html={generatedCampaignHtml}
                title="Newsletter email preview"
              />
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function RefundConfirmationPreview({
  refund,
  generatedHtml,
  isGenerating,
}: {
  refund: DashboardRefund;
  generatedHtml: string | null;
  isGenerating: boolean;
}) {
  if (generatedHtml) {
    return (
      <GeneratedEmailPreview
        html={generatedHtml}
        title="Refund confirmation email preview"
      />
    );
  }
  if (isGenerating) {
    return <GeneratingEmailPreview label="Writing from your latest refund…" />;
  }

  return (
    <div
      className="nomi-preview nomi-preview-editorial"
      style={{ gap: "10px" }}
      aria-hidden="true"
    >
      <div className="nomi-preview-title">
        {refund ? `Refund processed for ${refund.orderNumber}` : "Your refund is on its way"}
      </div>
      <div className="nomi-line" style={{ width: "82%" }} />
      <div className="nomi-line" style={{ width: "64%" }} />
      {refund?.lineItems.slice(0, 2).map((item) => (
        <div
          key={`${item.title}-${item.total}`}
          style={{ display: "flex", justifyContent: "space-between", fontSize: "8px" }}
        >
          <span>{item.title} × {item.quantity}</span>
          <span>{item.total}</span>
        </div>
      ))}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          borderTop: "1px solid #e6ddd2",
          paddingTop: "7px",
          fontSize: "8px",
        }}
      >
        <span>Refunded total</span>
        <strong>{refund?.total ?? "$84"}</strong>
      </div>
    </div>
  );
}

/* ── Email previews ───────────────────────────────────────────────────────
   Static thumbnails of what each template sends. The order confirmation is
   the Moon & Mango archetype from the design folder — it wears the
   merchant's palette, not Nomi's, which is the whole point of the app. */

// Four states, in order of preference: a real Claude-generated email for
// the real order; a "writing…" placeholder while that call is in flight;
// a hand-built preview using the same real order data if generation
// failed; and the static Moon & Mango archetype when the store has no
// orders at all yet. The dashboard never shows an empty card.
function OrderConfirmationPreview({
  shopName,
  order,
  generatedHtml,
  isGenerating,
}: {
  shopName: string;
  order: DashboardOrder;
  generatedHtml: string | null;
  isGenerating: boolean;
}) {
  if (!order) {
    return <StaticOrderConfirmationPreview />;
  }
  if (generatedHtml) {
    return (
      <GeneratedEmailPreview html={generatedHtml} title="Order confirmation email preview" />
    );
  }
  if (isGenerating) {
    return <GeneratingEmailPreview label="Writing your order confirmation email" />;
  }
  return <RealDataOrderConfirmationPreview shopName={shopName} order={order} />;
}

// The sandboxed frame for a real, Claude-generated email. `sandbox=""` (no
// value) is deliberate: it blocks scripts and same-origin access entirely,
// so arbitrary model output can never touch the parent page. The email is
// built at a fixed 640px design width like any other email; we render it
// at that size and scale the whole frame down to fit the card. Shared by
// every card that shows a generated email, not just order confirmation.
function GeneratedEmailPreview({ html, title }: { html: string; title: string }) {
  const SOURCE_WIDTH = 640;
  const SOURCE_HEIGHT = 900;
  const SCALE = 0.37;
  return (
    <div className="nomi-preview" style={{ padding: 0 }} aria-hidden="true">
      <div
        style={{
          width: SOURCE_WIDTH,
          height: SOURCE_HEIGHT,
          transform: `scale(${SCALE})`,
          transformOrigin: "top left",
          flex: "none",
        }}
      >
        <iframe
          srcDoc={html}
          title={title}
          sandbox=""
          scrolling="no"
          style={{ width: SOURCE_WIDTH, height: SOURCE_HEIGHT, border: "none" }}
        />
      </div>
    </div>
  );
}

function GeneratingEmailPreview({ label }: { label: string }) {
  return (
    <div
      className="nomi-preview"
      style={{ alignItems: "center", justifyContent: "center", textAlign: "center" }}
      aria-hidden="true"
    >
      <div
        style={{
          font: "italic 400 12px var(--nomi-font-heading)",
          color: "var(--nomi-neutral-600)",
        }}
      >
        {label}
      </div>
    </div>
  );
}

// The hand-built, real-data-but-not-AI preview from before Claude was wired
// in. Kept as the fallback when generation fails, so a bad API call still
// shows real order data instead of reverting all the way to the mockup.
function RealDataOrderConfirmationPreview({
  shopName,
  order,
}: {
  shopName: string;
  order: NonNullable<DashboardOrder>;
}) {
  const greeting = order.customerFirstName
    ? `Thank you, ${order.customerFirstName}.`
    : "Thank you for your order.";
  const items = order.lineItems.slice(0, 2);

  return (
    <div
      className="nomi-preview nomi-preview-editorial"
      style={{ gap: "8px" }}
      aria-hidden="true"
    >
      <div
        style={{
          textAlign: "center",
          font: "600 9px var(--nomi-font-heading)",
          letterSpacing: "0.24em",
          color: "#7a5a3c",
        }}
      >
        {shopName.toUpperCase()}
      </div>
      <div
        style={{
          font: "600 11px var(--nomi-font-heading)",
          color: "#3a2f26",
          paddingTop: "2px",
        }}
      >
        {greeting}
      </div>
      {items.map((item) => (
        <div
          key={item.title}
          style={{ display: "flex", gap: "8px", alignItems: "center" }}
        >
          {item.imageUrl ? (
            <img
              src={item.imageUrl}
              alt={item.imageAlt}
              style={{
                width: "26px",
                height: "32px",
                objectFit: "cover",
                borderRadius: "1px",
                flex: "none",
              }}
            />
          ) : (
            <div
              style={{
                width: "26px",
                height: "32px",
                background: "#e6d3bd",
                borderRadius: "1px",
                flex: "none",
              }}
            />
          )}
          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              gap: "3px",
            }}
          >
            <div
              style={{
                fontSize: "8px",
                color: "#3a2f26",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {item.title}
            </div>
            {item.quantity > 1 && (
              <div style={{ fontSize: "7px", color: "#7a6a5a" }}>
                Qty {item.quantity}
              </div>
            )}
          </div>
          <div style={{ fontSize: "8px", color: "#7a6a5a" }}>{item.total}</div>
        </div>
      ))}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderTop: "1px solid #e6ddd2",
          paddingTop: "6px",
          marginTop: "2px",
        }}
      >
        <span style={{ fontSize: "8px", color: "#7a6a5a" }}>Total</span>
        <span
          style={{ font: "600 9px var(--nomi-font-heading)", color: "#3a2f26" }}
        >
          {order.total}
        </span>
      </div>
      <div
        style={{
          alignSelf: "center",
          background: "#3a2f26",
          color: "#f7f1e8",
          fontSize: "7px",
          letterSpacing: "0.1em",
          padding: "5px 12px",
          borderRadius: "1px",
          marginTop: "2px",
        }}
      >
        TRACK ORDER
      </div>
    </div>
  );
}

function StaticOrderConfirmationPreview() {
  return (
    <div
      className="nomi-preview nomi-preview-editorial"
      style={{ gap: "8px" }}
      aria-hidden="true"
    >
      <div
        style={{
          textAlign: "center",
          font: "600 9px var(--nomi-font-heading)",
          letterSpacing: "0.24em",
          color: "#7a5a3c",
        }}
      >
        MOON &amp; MANGO
      </div>
      <div
        style={{
          font: "600 11px var(--nomi-font-heading)",
          color: "#3a2f26",
          paddingTop: "2px",
        }}
      >
        Thank you, Ananya.
      </div>
      {[
        { swatch: "#e6d3bd", widths: ["80%", "45%"], price: "$180" },
        { swatch: "#dfd6c4", widths: ["70%", "40%"], price: "$96" },
      ].map(({ swatch, widths, price }) => (
        <div
          key={price}
          style={{ display: "flex", gap: "8px", alignItems: "center" }}
        >
          <div
            style={{
              width: "26px",
              height: "32px",
              background: swatch,
              borderRadius: "1px",
              flex: "none",
            }}
          />
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              gap: "3px",
            }}
          >
            <div
              style={{ height: "4px", width: widths[0], background: "#d9cdbe" }}
            />
            <div
              style={{ height: "4px", width: widths[1], background: "#e6ddd2" }}
            />
          </div>
          <div style={{ fontSize: "8px", color: "#7a6a5a" }}>{price}</div>
        </div>
      ))}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderTop: "1px solid #e6ddd2",
          paddingTop: "6px",
          marginTop: "2px",
        }}
      >
        <span style={{ fontSize: "8px", color: "#7a6a5a" }}>Total</span>
        <span
          style={{ font: "600 9px var(--nomi-font-heading)", color: "#3a2f26" }}
        >
          $276
        </span>
      </div>
      <div
        style={{
          alignSelf: "center",
          background: "#3a2f26",
          color: "#f7f1e8",
          fontSize: "7px",
          letterSpacing: "0.1em",
          padding: "5px 12px",
          borderRadius: "1px",
          marginTop: "2px",
        }}
      >
        TRACK ORDER
      </div>
    </div>
  );
}

// Same four-state pattern as the other cards: a real generated email for
// a real shipped order, a "writing…" placeholder while that's in flight,
// a hand-built real-data preview if generation failed, and the static
// mockup when the store has no fulfilled orders yet.
function ShippingUpdatePreview({
  update,
  generatedHtml,
  isGenerating,
}: {
  update: DashboardShippingUpdate;
  generatedHtml: string | null;
  isGenerating: boolean;
}) {
  if (!update) {
    return <StaticShippingUpdatePreview />;
  }
  if (generatedHtml) {
    return (
      <GeneratedEmailPreview html={generatedHtml} title="Shipping update email preview" />
    );
  }
  if (isGenerating) {
    return <GeneratingEmailPreview label="Writing your shipping update email" />;
  }
  return <RealDataShippingUpdatePreview update={update} />;
}

// The hand-built, real-data-but-not-AI fallback, shown only when
// generation fails — mirrors the other cards' RealData* components.
function RealDataShippingUpdatePreview({
  update,
}: {
  update: NonNullable<DashboardShippingUpdate>;
}) {
  const delivered = update.fulfillmentStatus.includes("delivered");
  const headline = delivered
    ? "Your order has been delivered"
    : update.customerFirstName
      ? `${update.customerFirstName}, your order is on its way`
      : "Your order is on its way";

  return (
    <div className="nomi-preview" style={{ gap: "10px" }} aria-hidden="true">
      <div className="nomi-preview-title">{headline}</div>
      <div style={{ display: "flex", alignItems: "center", padding: "6px 0" }}>
        <Dot filled />
        <Rail filled />
        <Dot filled />
        <Rail filled={delivered} />
        <Dot filled={delivered} />
      </div>
      <div
        className="nomi-micro"
        style={{ display: "flex", justifyContent: "space-between" }}
      >
        <span>Packed</span>
        <span>Shipped</span>
        <span>Delivered</span>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "4px",
          paddingTop: "6px",
        }}
      >
        {update.lineItems.slice(0, 2).map((item) => (
          <div
            key={item.title}
            style={{
              fontSize: "9px",
              color: "var(--nomi-neutral-900)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {item.title}
          </div>
        ))}
      </div>
      {update.trackingNumber && (
        <div
          style={{
            background: "var(--nomi-neutral-100)",
            borderRadius: "1px",
            padding: "8px 10px",
            display: "flex",
            flexDirection: "column",
            gap: "4px",
            marginTop: "auto",
          }}
        >
          <div className="nomi-micro" style={{ letterSpacing: "0.12em" }}>
            TRACKING
          </div>
          <div
            style={{
              fontSize: "9px",
              fontWeight: 600,
              color: "var(--nomi-neutral-900)",
            }}
          >
            {update.trackingNumber}
          </div>
        </div>
      )}
    </div>
  );
}

function StaticShippingUpdatePreview() {
  return (
    <div className="nomi-preview" style={{ gap: "10px" }} aria-hidden="true">
      <div className="nomi-preview-title">Your order is on its way</div>
      <div style={{ display: "flex", alignItems: "center", padding: "6px 0" }}>
        <Dot filled />
        <Rail filled />
        <Dot filled />
        <Rail />
        <Dot />
      </div>
      <div
        className="nomi-micro"
        style={{ display: "flex", justifyContent: "space-between" }}
      >
        <span>Packed</span>
        <span>Shipped</span>
        <span>Delivered</span>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "4px",
          paddingTop: "6px",
        }}
      >
        {["90%", "76%", "52%"].map((width) => (
          <div className="nomi-line" key={width} style={{ width }} />
        ))}
      </div>
      <div
        style={{
          background: "var(--nomi-neutral-100)",
          borderRadius: "1px",
          padding: "8px 10px",
          display: "flex",
          flexDirection: "column",
          gap: "4px",
          marginTop: "auto",
        }}
      >
        <div className="nomi-micro" style={{ letterSpacing: "0.12em" }}>
          TRACKING
        </div>
        <div
          style={{
            fontSize: "9px",
            fontWeight: 600,
            color: "var(--nomi-neutral-900)",
          }}
        >
          1Z 998 AA1 012
        </div>
      </div>
    </div>
  );
}

// Same four-state pattern as OrderConfirmationPreview: a real generated
// email for a real cart, a "writing…" placeholder while that's in flight,
// a hand-built real-data preview if generation failed, and the static
// mockup when the store has no abandoned checkouts yet.
function AbandonedCartPreview({
  cart,
  generatedHtml,
  isGenerating,
}: {
  cart: DashboardCart;
  generatedHtml: string | null;
  isGenerating: boolean;
}) {
  if (!cart) {
    return <StaticAbandonedCartPreview />;
  }
  if (generatedHtml) {
    return (
      <GeneratedEmailPreview html={generatedHtml} title="Abandoned cart recovery email preview" />
    );
  }
  if (isGenerating) {
    return <GeneratingEmailPreview label="Writing your cart recovery email" />;
  }
  return <RealDataAbandonedCartPreview cart={cart} />;
}

// The hand-built, real-data-but-not-AI fallback, shown only when
// generation fails — mirrors RealDataOrderConfirmationPreview. No
// shop-name header here, matching StaticAbandonedCartPreview's simpler
// layout (unlike the order-confirmation card, which is editorial-styled).
function RealDataAbandonedCartPreview({
  cart,
}: {
  cart: NonNullable<DashboardCart>;
}) {
  const hook = cart.customerFirstName
    ? `${cart.customerFirstName}, still thinking it over?`
    : "Still thinking it over?";
  const items = cart.lineItems.slice(0, 2);

  return (
    <div className="nomi-preview" style={{ gap: "10px" }} aria-hidden="true">
      <div className="nomi-preview-title">{hook}</div>
      {items.map((item) => (
        <div
          key={item.title}
          style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}
        >
          {item.imageUrl ? (
            <img
              src={item.imageUrl}
              alt={item.imageAlt}
              style={{
                width: "38px",
                height: "46px",
                objectFit: "cover",
                borderRadius: "1px",
                flex: "none",
              }}
            />
          ) : (
            <div className="nomi-thumb" style={{ width: "38px", height: "46px" }} />
          )}
          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              gap: "4px",
              paddingTop: "2px",
            }}
          >
            <div
              style={{
                fontSize: "9px",
                color: "var(--nomi-neutral-900)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {item.title}
            </div>
            <div
              style={{
                fontSize: "9px",
                fontWeight: 600,
                color: "var(--nomi-neutral-900)",
              }}
            >
              {item.total}
            </div>
          </div>
        </div>
      ))}
      <div className="nomi-micro">Total {cart.total}</div>
      <div className="nomi-preview-cta">RETURN TO CART</div>
    </div>
  );
}

function StaticAbandonedCartPreview() {
  return (
    <div className="nomi-preview" style={{ gap: "10px" }} aria-hidden="true">
      <div className="nomi-preview-title">Still thinking it over?</div>
      {[
        { tone: "var(--nomi-neutral-200)", widths: ["85%", "60%"], price: "$142" },
        { tone: "var(--nomi-neutral-100)", widths: ["72%", "52%"], price: "$88" },
      ].map(({ tone, widths, price }) => (
        <div
          key={price}
          style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}
        >
          <div
            className="nomi-thumb"
            style={{ width: "38px", height: "46px", background: tone }}
          />
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              gap: "4px",
              paddingTop: "2px",
            }}
          >
            <div className="nomi-line" style={{ width: widths[0] }} />
            <div className="nomi-line" style={{ width: widths[1] }} />
            <div
              style={{
                fontSize: "9px",
                fontWeight: 600,
                color: "var(--nomi-neutral-900)",
                paddingTop: "2px",
              }}
            >
              {price}
            </div>
          </div>
        </div>
      ))}
      <div className="nomi-micro">Held in your cart for 24 hours</div>
      <div className="nomi-preview-cta">RETURN TO CART</div>
    </div>
  );
}

// Same four-state pattern as the other cards: a real generated email for
// a real delivered order, a "writing…" placeholder while that's in
// flight, a hand-built real-data preview if generation failed, and the
// static mockup when no order has been marked delivered yet.
function ReviewRequestPreview({
  request,
  generatedHtml,
  isGenerating,
}: {
  request: DashboardReviewRequest;
  generatedHtml: string | null;
  isGenerating: boolean;
}) {
  if (!request) {
    return <StaticReviewRequestPreview />;
  }
  if (generatedHtml) {
    return (
      <GeneratedEmailPreview html={generatedHtml} title="Review request email preview" />
    );
  }
  if (isGenerating) {
    return <GeneratingEmailPreview label="Writing your review request email" />;
  }
  return <RealDataReviewRequestPreview request={request} />;
}

// The hand-built, real-data-but-not-AI fallback, shown only when
// generation fails — mirrors the other cards' RealData* components. The
// star-dot row is decorative here too, same as the static mockup — the
// real generated email never draws a rating widget (see the skeleton
// prompt: it can't be made functional in HTML email).
function RealDataReviewRequestPreview({
  request,
}: {
  request: NonNullable<DashboardReviewRequest>;
}) {
  const item = request.lineItems[0];
  const headline = item ? `What did you think of ${item.title}?` : "How was your order?";

  return (
    <div className="nomi-preview" style={{ gap: "10px" }} aria-hidden="true">
      <div className="nomi-preview-title">{headline}</div>
      <div style={{ display: "flex", gap: "5px", padding: "2px 0" }}>
        {[true, true, true, false, false].map((filled, index) => (
          <div
            key={index}
            style={{
              width: "11px",
              height: "11px",
              borderRadius: "50%",
              border: `1.4px solid ${
                filled ? "var(--nomi-cyan-600)" : "var(--nomi-neutral-300)"
              }`,
            }}
          />
        ))}
      </div>
      {item && (
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          {item.imageUrl ? (
            <img
              src={item.imageUrl}
              alt={item.imageAlt}
              style={{
                width: "36px",
                height: "44px",
                objectFit: "cover",
                borderRadius: "1px",
                flex: "none",
              }}
            />
          ) : (
            <div className="nomi-thumb" style={{ width: "36px", height: "44px" }} />
          )}
          <div
            style={{
              fontSize: "9px",
              color: "var(--nomi-neutral-900)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {item.title}
          </div>
        </div>
      )}
      <div className="nomi-preview-cta">LEAVE A REVIEW</div>
    </div>
  );
}

function StaticReviewRequestPreview() {
  return (
    <div className="nomi-preview" style={{ gap: "10px" }} aria-hidden="true">
      <div className="nomi-preview-title">How did it wear?</div>
      <div style={{ display: "flex", gap: "5px", padding: "2px 0" }}>
        {[true, true, true, false, false].map((filled, index) => (
          <div
            key={index}
            style={{
              width: "11px",
              height: "11px",
              borderRadius: "50%",
              border: `1.4px solid ${
                filled ? "var(--nomi-cyan-600)" : "var(--nomi-neutral-300)"
              }`,
            }}
          />
        ))}
      </div>
      <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
        <div className="nomi-thumb" style={{ width: "36px", height: "44px" }} />
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            gap: "4px",
          }}
        >
          <div className="nomi-line" style={{ width: "78%" }} />
          <div className="nomi-line" style={{ width: "50%" }} />
        </div>
      </div>
      <div
        style={{
          border: "1px solid var(--nomi-neutral-200)",
          borderRadius: "1px",
          flex: 1,
          minHeight: "26px",
        }}
      />
      <div className="nomi-preview-cta">LEAVE A REVIEW</div>
    </div>
  );
}

function Dot({ filled = false }: { filled?: boolean }) {
  return (
    <div
      style={{
        width: "8px",
        height: "8px",
        borderRadius: "50%",
        flex: "none",
        background: filled ? "var(--nomi-cyan)" : "var(--nomi-neutral-300)",
      }}
    />
  );
}

function Rail({ filled = false }: { filled?: boolean }) {
  return (
    <div
      style={{
        flex: 1,
        height: "2px",
        background: filled
          ? "var(--nomi-cyan-300)"
          : "var(--nomi-neutral-300)",
      }}
    />
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
