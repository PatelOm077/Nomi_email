import { createHash } from "node:crypto";
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
import { getEmailDeliveryConfig, isEmailDeliveryConfigured } from "../email-delivery/config.server";
import { generateOrderConfirmationEmail } from "../email-engine/generate-order-confirmation-email";
import { generateAbandonedCartEmail } from "../email-engine/generate-abandoned-cart-email";
import { generateShippingUpdateEmail } from "../email-engine/generate-shipping-update-email";
import { generateReviewRequestEmail } from "../email-engine/generate-review-request-email";
import { generateRefundConfirmationEmail } from "../email-engine/generate-refund-confirmation-email";
import { generateNewsletterEmail } from "../email-engine/generate-newsletter-email";
import { generateLifecycleEmail } from "../email-engine/generate-lifecycle-email";
import { EMAIL_GENERATION_PAUSED } from "../email-engine/generation-status";
import { renderLifecycleTemplateHtml } from "../email-engine/templates/lifecycle-template";
import { LIFECYCLE_TEMPLATE_COPY } from "../email-engine/templates/lifecycle-template-copy";
import type { LifecycleTemplateCustomization } from "../email-engine/templates/types";
import type {
  AbandonedCartRecovery,
  EmailLanguage,
  EmailTone,
  LifecycleEmail,
  LifecycleEmailId,
  NewsletterCampaign,
  OrderConfirmationOrder,
  RefundConfirmation,
  ReviewRequest,
  ShippingUpdate,
} from "../email-engine/types";
import { EMAIL_LANGUAGES, EMAIL_TONES } from "../email-engine/types";

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
    shopDomain: session.shop,
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
      sendReceiptEmails: settings.sendReceiptEmails,
      language: settings.language,
      tone: settings.tone,
      // The real configured sender identity, shown in the flow preview's
      // "From" line once a provider is set up. There's no per-shop sending
      // subdomain — one verified address serves every merchant — so this
      // is intentionally the same for all shops, not a fabricated one.
      fromAddress: providerConfigured
        ? (() => {
            const { fromName, fromEmail } = getEmailDeliveryConfig();
            return `${fromName} <${fromEmail}>`;
          })()
        : null,
      pendingJobs: await db.emailJob.count({
        where: { shop: session.shop, status: "pending" },
      }),
    },
    lifecycleTemplateChoices: Object.fromEntries(
      (await db.lifecycleTemplateChoice.findMany({ where: { shop: session.shop } })).map(
        (row) => [
          row.slotId,
          {
            mode: row.mode as "ai" | "template",
            logoUrl: row.logoUrl,
            primaryColor: row.primaryColor,
            buttonText: row.buttonText,
          },
        ],
      ),
    ) as Partial<Record<LifecycleEmailId, LifecycleTemplateCustomization & { mode: "ai" | "template" }>>,
  };
};

type DashboardOrder = Awaited<ReturnType<typeof loader>>["order"];
type DashboardCart = Awaited<ReturnType<typeof loader>>["cart"];
type DashboardShippingUpdate = Awaited<ReturnType<typeof loader>>["shippingUpdate"];
type DashboardReviewRequest = Awaited<ReturnType<typeof loader>>["reviewRequest"];
type DashboardRefund = Awaited<ReturnType<typeof loader>>["refund"];
type DashboardProduct = Awaited<ReturnType<typeof loader>>["products"][number];

// Maps the Shopify-shaped order the loader already fetched onto the
// engine's platform-neutral input. This mapping — not the engine itself —
// is where Shopify-specific knowledge is allowed to live.
function toEngineOrder(
  shopName: string,
  order: NonNullable<DashboardOrder>,
  language: EmailLanguage,
  tone: EmailTone,
): OrderConfirmationOrder {
  return {
    shopName,
    language,
    tone,
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
  tone: EmailTone,
): AbandonedCartRecovery {
  return {
    shopName,
    language,
    tone,
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
  tone: EmailTone,
): ShippingUpdate {
  return {
    shopName,
    language,
    tone,
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
  tone: EmailTone,
): ReviewRequest {
  return {
    shopName,
    language,
    tone,
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
  tone: EmailTone,
): RefundConfirmation {
  return {
    shopName,
    language,
    tone,
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
  | { kind: "order-confirmation"; shopName: string; language: EmailLanguage; tone: EmailTone; order: NonNullable<DashboardOrder> }
  | { kind: "abandoned-cart"; shopName: string; language: EmailLanguage; tone: EmailTone; cart: NonNullable<DashboardCart> }
  | { kind: "shipping-update"; shopName: string; language: EmailLanguage; tone: EmailTone; update: NonNullable<DashboardShippingUpdate> }
  | { kind: "review-request"; shopName: string; language: EmailLanguage; tone: EmailTone; request: NonNullable<DashboardReviewRequest> }
  | { kind: "refund-confirmation"; shopName: string; language: EmailLanguage; tone: EmailTone; refund: NonNullable<DashboardRefund> }
  | { kind: "newsletter"; shopName: string; language: EmailLanguage; tone: EmailTone; prompt: string; products: NewsletterCampaign["products"] }
  | { kind: "lifecycle-emails"; emails: LifecycleEmail[] };

type DashboardActionRequest =
  | GenerationRequest
  | { kind: "set-sending"; enabled: boolean }
  | { kind: "set-receipt-sending"; enabled: boolean }
  | { kind: "set-language"; language: EmailLanguage }
  | { kind: "set-tone"; tone: EmailTone }
  | {
      kind: "set-lifecycle-template";
      slotId: LifecycleEmailId;
      mode: "ai" | "template";
      logoUrl: string | null;
      primaryColor: string | null;
      buttonText: string | null;
    };

// The dashboard reloads its loader data (and re-fires generation) on every
// page load, so identical order/cart/etc. data would otherwise re-call
// Claude every single reload. Keyed on shop + the exact generation request,
// so any real change in the underlying record (new total, new refund, a
// different language) still misses and regenerates. Process-lifetime only
// on purpose — this is the dashboard preview cache, not the transactional
// send path, which already has its own DB-backed idempotency.
const previewCache = new Map<string, string>();

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
    if (parsed.kind === "set-receipt-sending") {
      if (parsed.enabled && !isEmailDeliveryConfigured()) {
        return { error: "Configure the email provider before enabling sends." };
      }
      await db.shopSettings.upsert({
        where: { shop: session.shop },
        create: { shop: session.shop, sendReceiptEmails: parsed.enabled },
        update: { sendReceiptEmails: parsed.enabled },
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
    if (parsed.kind === "set-tone") {
      if (!EMAIL_TONES.some(({ code }) => code === parsed.tone)) {
        return { error: "Unsupported email tone." };
      }
      await db.shopSettings.upsert({
        where: { shop: session.shop },
        create: { shop: session.shop, tone: parsed.tone },
        update: { tone: parsed.tone },
      });
      return { deliveryUpdated: true };
    }
    if (parsed.kind === "set-lifecycle-template") {
      if (!(parsed.slotId in LIFECYCLE_TEMPLATE_COPY)) {
        return { error: "Unknown lifecycle email." };
      }
      if (parsed.mode !== "ai" && parsed.mode !== "template") {
        return { error: "Unknown template mode." };
      }
      await db.lifecycleTemplateChoice.upsert({
        where: { shop_slotId: { shop: session.shop, slotId: parsed.slotId } },
        create: {
          shop: session.shop,
          slotId: parsed.slotId,
          mode: parsed.mode,
          logoUrl: parsed.logoUrl,
          primaryColor: parsed.primaryColor,
          buttonText: parsed.buttonText,
        },
        update: {
          mode: parsed.mode,
          logoUrl: parsed.logoUrl,
          primaryColor: parsed.primaryColor,
          buttonText: parsed.buttonText,
        },
      });
      return { deliveryUpdated: true };
    }

    if (EMAIL_GENERATION_PAUSED) {
      return { error: "Email generation is paused until you choose to start it." };
    }

    if (parsed.kind === "lifecycle-emails") {
      if (!Array.isArray(parsed.emails) || parsed.emails.length < 1 || parsed.emails.length > 13) {
        return { error: "Choose between 1 and 13 lifecycle emails." };
      }

      const generatedEntries = await Promise.all(
        parsed.emails.map(async (email) => {
          if (!EMAIL_LANGUAGES.some(({ code }) => code === email.language)) {
            throw new Error(`Unsupported email language: ${email.language}`);
          }
          const emailCacheKey = createHash("sha256")
            .update(`${session.shop}:lifecycle:${JSON.stringify(email)}`)
            .digest("hex");
          const cachedEmail = previewCache.get(emailCacheKey);
          const html = cachedEmail ?? (await generateLifecycleEmail(email));
          if (!cachedEmail) previewCache.set(emailCacheKey, html);
          return [email.id, html] as const;
        }),
      );

      return { generatedEmails: Object.fromEntries(generatedEntries) };
    }

    const cacheKey = createHash("sha256")
      .update(`${session.shop}:${JSON.stringify(parsed)}`)
      .digest("hex");
    const cachedHtml = previewCache.get(cacheKey);
    if (cachedHtml) return { html: cachedHtml };

    let html: string;
    switch (parsed.kind) {
      case "order-confirmation":
        html = await generateOrderConfirmationEmail(
          toEngineOrder(parsed.shopName, parsed.order, parsed.language, parsed.tone),
        );
        break;
      case "abandoned-cart":
        html = await generateAbandonedCartEmail(
          toEngineCart(parsed.shopName, parsed.cart, parsed.language, parsed.tone),
        );
        break;
      case "shipping-update":
        html = await generateShippingUpdateEmail(
          toEngineShippingUpdate(parsed.shopName, parsed.update, parsed.language, parsed.tone),
        );
        break;
      case "review-request":
        html = await generateReviewRequestEmail(
          toEngineReviewRequest(parsed.shopName, parsed.request, parsed.language, parsed.tone),
        );
        break;
      case "refund-confirmation":
        html = await generateRefundConfirmationEmail(
          toEngineRefund(parsed.shopName, parsed.refund, parsed.language, parsed.tone),
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
          tone: parsed.tone,
          prompt,
          products: parsed.products,
        });
        break;
      }
    }
    previewCache.set(cacheKey, html);
    return { html };
  } catch (error) {
    console.error("Email generation failed:", error);
    return { error: "Couldn't generate that email — try again." };
  }
};

// v4, not v3: the whole flow was rebuilt to match the approved mockup
// pixel-for-pixel (new step content, new pacing, the URL-entry step is
// gone entirely), so a shop that saw any earlier version sees this one
// once rather than staying silently on record as "onboarded" for a flow
// it never saw.
const ONBOARDING_VERSION = "v4";

const ONBOARDING_RAIL = ["Welcome", "Look around", "Good timing", "Your tone", "All set"] as const;

function resolveDashboardLanguage(value: string): EmailLanguage {
  return EMAIL_LANGUAGES.some(({ code }) => code === value)
    ? (value as EmailLanguage)
    : "en";
}

function resolveDashboardTone(value: string): EmailTone {
  return EMAIL_TONES.some(({ code }) => code === value)
    ? (value as EmailTone)
    : "warm-plain";
}

type FlowTemplate = {
  id: string;
  flowId: "orders" | "delivery" | "recovery" | "campaigns";
  name: string;
  subject: string;
  previewText: string;
  timing: string;
  available: boolean;
  unavailableLabel: string;
  generatedHtml: string | null;
  isGenerating: boolean;
  error: string | null;
  onGenerate: () => void;
  preview: React.ReactNode;
};

type ReferenceFlowId = "welcome" | "interest" | "cart" | "care" | "winback";

type ReferenceFlowTemplate = {
  id: LifecycleEmailId;
  flowId: ReferenceFlowId;
  name: string;
  subject: string;
  previewText: string;
  timing: string;
  generatedHtml: string | null;
  isGenerating: boolean;
  error: string | null;
  onGenerate: () => void;
};

function FlowChevronIcon() {
  return (
    <svg className="nomi-flow-chevron" width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 8 L10 12 L14 8" />
    </svg>
  );
}

function RuleAddedIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="10" cy="10" r="7.25" />
      <path d="M10 6.5 L10 13.5 M6.5 10 L13.5 10" />
    </svg>
  );
}

function RuleRemovedIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="10" cy="10" r="7.25" />
      <path d="M6.5 10 L13.5 10" />
    </svg>
  );
}

export default function Index() {
  const {
    shopName,
    products,
    order,
    cart,
    shippingUpdate,
    reviewRequest,
    refund,
    delivery,
    lifecycleTemplateChoices,
  } = useLoaderData<typeof loader>();
  const [campaign] = useState("");
  const [language, setLanguage] = useState<EmailLanguage>(
    resolveDashboardLanguage(delivery.language),
  );
  const [tone, setTone] = useState<EmailTone>(resolveDashboardTone(delivery.tone));
  // Resolve the browser-only completion flag before mounting the animated
  // onboarding. Rendering it during SSR can start its CSS animations before
  // React hydrates the page, which makes the welcome sequence appear to run
  // twice in development.
  const [showOnboarding, setShowOnboarding] = useState<boolean | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<LifecycleEmailId>("welcome-1");
  const [expandedFlowId, setExpandedFlowId] = useState<ReferenceFlowId | "">("welcome");
  const [trialStarted, setTrialStarted] = useState(false);
  const [generatedLifecycleEmails, setGeneratedLifecycleEmails] = useState<
    Partial<Record<LifecycleEmailId, string>>
  >({});
  const [requestedLifecycleIds, setRequestedLifecycleIds] = useState<LifecycleEmailId[]>([]);
  // A merchant's choice of real template vs. AI for each lifecycle slot,
  // plus its small set of editable values. Seeded from the persisted rows;
  // edits update local state immediately (the settings form and preview
  // don't wait on the round trip) and are saved via templateFetcher.
  const [templateChoices, setTemplateChoices] = useState<
    Partial<Record<LifecycleEmailId, { mode: "ai" | "template" } & LifecycleTemplateCustomization>>
  >(lifecycleTemplateChoices);
  const deliveryFetcher = useFetcher<typeof action>();
  const lifecycleFetcher = useFetcher<typeof action>();
  const templateFetcher = useFetcher<typeof action>();

  const getTemplateChoice = (id: LifecycleEmailId) =>
    templateChoices[id] ?? { mode: "ai" as const, logoUrl: null, primaryColor: null, buttonText: null };

  const updateTemplateChoice = (
    id: LifecycleEmailId,
    patch: Partial<{ mode: "ai" | "template" } & LifecycleTemplateCustomization>,
  ) => {
    const next = { ...getTemplateChoice(id), ...patch };
    setTemplateChoices((current) => ({ ...current, [id]: next }));
    templateFetcher.submit(
      { payload: JSON.stringify({ kind: "set-lifecycle-template", slotId: id, ...next }) },
      { method: "POST" },
    );
  };

  const onboardingStorageKey = `nomi:onboarding:${shopName}:${ONBOARDING_VERSION}`;

  useEffect(() => {
    let isComplete = false;
    try {
      isComplete = window.localStorage.getItem(onboardingStorageKey) === "complete";
    } catch {
      // Some embedded-browser privacy modes block storage. The setup still
      // works for the current visit; it simply cannot remember completion.
    }
    setShowOnboarding(!isComplete);
  }, [onboardingStorageKey]);

  const storefrontProducts: NewsletterCampaign["products"] = products.map((product) => ({
    title: product.title,
    price: product.price,
    imageUrl: product.imageUrl,
    productUrl: product.productUrl,
  }));
  const orderProducts: NewsletterCampaign["products"] = order
    ? order.lineItems.map((item) => ({
        title: item.title,
        price: item.total,
        imageUrl: item.imageUrl,
        productUrl: null,
      }))
    : storefrontProducts;
  const cartProducts: NewsletterCampaign["products"] = cart
    ? cart.lineItems.map((item) => ({
        title: item.title,
        price: item.total,
        imageUrl: item.imageUrl,
        productUrl: null,
      }))
    : storefrontProducts;
  const reviewProducts: NewsletterCampaign["products"] = reviewRequest
    ? reviewRequest.lineItems.map((item, index) => ({
        title: item.title,
        price: "",
        imageUrl: item.imageUrl,
        productUrl: index === 0 ? reviewRequest.reviewUrl : null,
      }))
    : storefrontProducts;

  const lifecycleInputs: Record<LifecycleEmailId, LifecycleEmail> = {
    "welcome-1": {
      id: "welcome-1", shopName, language, tone, sequenceName: "Welcome Journey", emailName: "1st Welcome Email",
      position: 1, sequenceLength: 3, timing: "On trigger", objective: "Welcome a new subscriber and introduce the store in a warm, plain voice.",
      customerFirstName: null, products: storefrontProducts, orderNumber: null, orderTotal: null, recoveryUrl: null, reviewUrl: null,
    },
    "welcome-2": {
      id: "welcome-2", shopName, language, tone, sequenceName: "Welcome Journey", emailName: "2nd Welcome Email",
      position: 2, sequenceLength: 3, timing: "48 hour(s) from previous", objective: "Explain what makes the store and its products worth remembering without repeating the first welcome.",
      customerFirstName: null, products: storefrontProducts, orderNumber: null, orderTotal: null, recoveryUrl: null, reviewUrl: null,
    },
    "welcome-3": {
      id: "welcome-3", shopName, language, tone, sequenceName: "Welcome Journey", emailName: "3rd Welcome Email",
      position: 3, sequenceLength: 3, timing: "2 day(s) from previous", objective: "Close the welcome journey with a useful selection of real products and an understated invitation to shop.",
      customerFirstName: null, products: storefrontProducts, orderNumber: null, orderTotal: null, recoveryUrl: null, reviewUrl: null,
    },
    "interest-1": {
      id: "interest-1", shopName, language, tone, sequenceName: "Product Interest Follow-Up", emailName: "1st Follow-Up Email",
      position: 1, sequenceLength: 2, timing: "4 hour(s) after product interest", objective: "Offer a helpful closer look at relevant products without sounding like surveillance.",
      customerFirstName: null, products: storefrontProducts, orderNumber: null, orderTotal: null, recoveryUrl: null, reviewUrl: null,
    },
    "interest-2": {
      id: "interest-2", shopName, language, tone, sequenceName: "Product Interest Follow-Up", emailName: "2nd Follow-Up Email",
      position: 2, sequenceLength: 2, timing: "2 day(s) from previous", objective: "Give a final useful product follow-up with practical context and no invented promotion.",
      customerFirstName: null, products: storefrontProducts, orderNumber: null, orderTotal: null, recoveryUrl: null, reviewUrl: null,
    },
    "cart-1": {
      id: "cart-1", shopName, language, tone, sequenceName: "Abandoned Cart", emailName: "1st Cart Email",
      position: 1, sequenceLength: 3, timing: "1 hour after checkout activity", objective: "Send a gentle reminder that the checkout is saved.",
      customerFirstName: cart?.customerFirstName ?? null, products: cartProducts, orderNumber: null, orderTotal: cart?.total ?? null, recoveryUrl: cart?.recoveryUrl ?? null, reviewUrl: null,
    },
    "cart-2": {
      id: "cart-2", shopName, language, tone, sequenceName: "Abandoned Cart", emailName: "2nd Cart Email",
      position: 2, sequenceLength: 3, timing: "24 hour(s) from previous", objective: "Follow up with practical reassurance and the real saved products, without inventing an offer.",
      customerFirstName: cart?.customerFirstName ?? null, products: cartProducts, orderNumber: null, orderTotal: cart?.total ?? null, recoveryUrl: cart?.recoveryUrl ?? null, reviewUrl: null,
    },
    "cart-3": {
      id: "cart-3", shopName, language, tone, sequenceName: "Abandoned Cart", emailName: "3rd Cart Email",
      position: 3, sequenceLength: 3, timing: "48 hour(s) from previous", objective: "Send one final quiet reminder, with no false urgency, discount, or expiry.",
      customerFirstName: cart?.customerFirstName ?? null, products: cartProducts, orderNumber: null, orderTotal: cart?.total ?? null, recoveryUrl: cart?.recoveryUrl ?? null, reviewUrl: null,
    },
    "thank-you": {
      id: "thank-you", shopName, language, tone, sequenceName: "Customer Care & Reviews", emailName: "Thank You Email",
      position: 1, sequenceLength: 2, timing: "After purchase", objective: "Thank the customer warmly without duplicating the legal order receipt or inventing delivery details.",
      customerFirstName: order?.customerFirstName ?? null, products: orderProducts, orderNumber: order?.name ?? null, orderTotal: order?.total ?? null, recoveryUrl: null, reviewUrl: null,
    },
    "review-request": {
      id: "review-request", shopName, language, tone, sequenceName: "Customer Care & Reviews", emailName: "Review Request",
      position: 2, sequenceLength: 2, timing: "7 day(s) after delivery", objective: "Ask for a product review in a brief, considerate way, only linking when a real review URL exists.",
      customerFirstName: reviewRequest?.customerFirstName ?? order?.customerFirstName ?? null, products: reviewProducts, orderNumber: reviewRequest?.orderNumber ?? order?.name ?? null, orderTotal: null, recoveryUrl: null, reviewUrl: reviewRequest?.reviewUrl ?? null,
    },
    "winback-1": {
      id: "winback-1", shopName, language, tone, sequenceName: "Winback Journey", emailName: "1st Winback Email",
      position: 1, sequenceLength: 3, timing: "30 day(s) after last order", objective: "Reconnect with a past customer by showing what is current, without guilt or an invented offer.",
      customerFirstName: order?.customerFirstName ?? null, products: storefrontProducts, orderNumber: order?.name ?? null, orderTotal: null, recoveryUrl: null, reviewUrl: null,
    },
    "winback-2": {
      id: "winback-2", shopName, language, tone, sequenceName: "Winback Journey", emailName: "2nd Winback Email",
      position: 2, sequenceLength: 3, timing: "14 day(s) from previous", objective: "Share a fresh, product-led reason to return without repeating the first winback email.",
      customerFirstName: order?.customerFirstName ?? null, products: storefrontProducts, orderNumber: order?.name ?? null, orderTotal: null, recoveryUrl: null, reviewUrl: null,
    },
    "winback-3": {
      id: "winback-3", shopName, language, tone, sequenceName: "Winback Journey", emailName: "3rd Winback Email",
      position: 3, sequenceLength: 3, timing: "30 day(s) from previous", objective: "Close the winback journey with a quiet final invitation and no false urgency.",
      customerFirstName: order?.customerFirstName ?? null, products: storefrontProducts, orderNumber: order?.name ?? null, orderTotal: null, recoveryUrl: null, reviewUrl: null,
    },
  };
  const allLifecycleIds = Object.keys(lifecycleInputs) as LifecycleEmailId[];
  const lifecycleError =
    lifecycleFetcher.data && "error" in lifecycleFetcher.data
      ? lifecycleFetcher.data.error ?? null
      : null;

  const lifecycleResponseEmails =
    lifecycleFetcher.data &&
    "generatedEmails" in lifecycleFetcher.data &&
    lifecycleFetcher.data.generatedEmails
      ? (lifecycleFetcher.data.generatedEmails as Partial<Record<LifecycleEmailId, string>>)
      : null;

  useEffect(() => {
    if (lifecycleResponseEmails) {
      setGeneratedLifecycleEmails((current) => ({
        ...current,
        ...lifecycleResponseEmails,
      }));
    }
  }, [lifecycleResponseEmails]);

  const generateLifecycleEmails = (ids: LifecycleEmailId[]) => {
    if (EMAIL_GENERATION_PAUSED || lifecycleFetcher.state !== "idle" || ids.length === 0) return;
    setRequestedLifecycleIds(ids);
    lifecycleFetcher.submit(
      {
        payload: JSON.stringify({
          kind: "lifecycle-emails",
          emails: ids.map((id) => lifecycleInputs[id]),
        }),
      },
      { method: "POST" },
    );
  };

  const generateAllLifecycleEmails = () => generateLifecycleEmails(allLifecycleIds);

  // Manual only: nothing here fires on mount or on reload. Each card's
  // fetcher only submits when its onGenerate is clicked (see the templates
  // array below and the card footer button), so viewing the dashboard
  // never spends a generation call by itself.
  const orderFetcher = useFetcher<typeof action>();
  const generateOrder = () => {
    if (!order) return;
    orderFetcher.submit(
      { payload: JSON.stringify({ kind: "order-confirmation", shopName, language, tone, order }) },
      { method: "POST" },
    );
  };
  const generatedOrderHtml: string | null =
    orderFetcher.data && "html" in orderFetcher.data
      ? orderFetcher.data.html ?? null
      : null;

  // Separate fetcher per card (same pattern repeated below) so one card
  // generating or failing never blocks another.
  const cartFetcher = useFetcher<typeof action>();
  const generateCart = () => {
    if (!cart) return;
    cartFetcher.submit(
      { payload: JSON.stringify({ kind: "abandoned-cart", shopName, language, tone, cart }) },
      { method: "POST" },
    );
  };
  const generatedCartHtml: string | null =
    cartFetcher.data && "html" in cartFetcher.data
      ? cartFetcher.data.html ?? null
      : null;

  const shippingFetcher = useFetcher<typeof action>();
  const generateShipping = () => {
    if (!shippingUpdate) return;
    shippingFetcher.submit(
      { payload: JSON.stringify({ kind: "shipping-update", shopName, language, tone, update: shippingUpdate }) },
      { method: "POST" },
    );
  };
  const generatedShippingHtml: string | null =
    shippingFetcher.data && "html" in shippingFetcher.data
      ? shippingFetcher.data.html ?? null
      : null;

  const reviewFetcher = useFetcher<typeof action>();
  const generateReview = () => {
    if (!reviewRequest) return;
    reviewFetcher.submit(
      { payload: JSON.stringify({ kind: "review-request", shopName, language, tone, request: reviewRequest }) },
      { method: "POST" },
    );
  };
  const generatedReviewHtml: string | null =
    reviewFetcher.data && "html" in reviewFetcher.data
      ? reviewFetcher.data.html ?? null
      : null;

  const refundFetcher = useFetcher<typeof action>();
  const generateRefund = () => {
    if (!refund) return;
    refundFetcher.submit(
      { payload: JSON.stringify({ kind: "refund-confirmation", shopName, language, tone, refund }) },
      { method: "POST" },
    );
  };
  const generatedRefundHtml: string | null =
    refundFetcher.data && "html" in refundFetcher.data
      ? refundFetcher.data.html ?? null
      : null;

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
          tone,
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

  const generateAllEmails = () => {
    if (order && !generatedOrderHtml && orderFetcher.state === "idle") generateOrder();
    if (shippingUpdate && !generatedShippingHtml && shippingFetcher.state === "idle") generateShipping();
    if (cart && !generatedCartHtml && cartFetcher.state === "idle") generateCart();
    if (reviewRequest && !generatedReviewHtml && reviewFetcher.state === "idle") generateReview();
    if (refund && !generatedRefundHtml && refundFetcher.state === "idle") generateRefund();
  };

  const finishOnboarding = () => {
    try {
      window.localStorage.setItem(onboardingStorageKey, "complete");
    } catch {
      // See the storage note above. Closing the setup must always work.
    }
    setShowOnboarding(false);
    generateAllLifecycleEmails();
  };

  // Embedded apps run inside an iframe on the app's own origin, not
  // admin.shopify.com — devtools opened on the parent page can't see or
  // clear this storage key. Do it from inside the app itself instead.
  const replayOnboarding = () => {
    try {
      window.localStorage.removeItem(onboardingStorageKey);
    } catch {
      // Same privacy-mode note as above.
    }
    setShowOnboarding(true);
  };

  const templates: FlowTemplate[] = [
    {
      id: "order-confirmation",
      flowId: "orders",
      name: "Order confirmation",
      subject: "Your order is confirmed",
      previewText: "Everything is in one place.",
      timing: "When an order is placed",
      available: Boolean(order),
      unavailableLabel: "Needs a recent order",
      generatedHtml: generatedOrderHtml,
      isGenerating: orderFetcher.state !== "idle",
      error: orderFetcher.data && "error" in orderFetcher.data ? orderFetcher.data.error ?? null : null,
      onGenerate: generateOrder,
      preview: (
        <OrderConfirmationPreview
          shopName={shopName}
          order={order}
          generatedHtml={generatedOrderHtml}
          isGenerating={orderFetcher.state !== "idle"}
        />
      ),
    },
    {
      id: "shipping-update",
      flowId: "delivery",
      name: "Shipping update",
      subject: "Your order is on the way",
      previewText: "Tracking details are inside.",
      timing: "When fulfillment changes",
      available: Boolean(shippingUpdate),
      unavailableLabel: "Needs a fulfilled order",
      generatedHtml: generatedShippingHtml,
      isGenerating: shippingFetcher.state !== "idle",
      error: shippingFetcher.data && "error" in shippingFetcher.data ? shippingFetcher.data.error ?? null : null,
      onGenerate: generateShipping,
      preview: (
        <ShippingUpdatePreview
          update={shippingUpdate}
          generatedHtml={generatedShippingHtml}
          isGenerating={shippingFetcher.state !== "idle"}
        />
      ),
    },
    {
      id: "abandoned-cart",
      flowId: "recovery",
      name: "Abandoned cart",
      subject: "You left something behind",
      previewText: "Your checkout is still saved.",
      timing: "One hour after checkout activity",
      available: Boolean(cart),
      unavailableLabel: "Needs an abandoned checkout",
      generatedHtml: generatedCartHtml,
      isGenerating: cartFetcher.state !== "idle",
      error: cartFetcher.data && "error" in cartFetcher.data ? cartFetcher.data.error ?? null : null,
      onGenerate: generateCart,
      preview: (
        <AbandonedCartPreview
          cart={cart}
          generatedHtml={generatedCartHtml}
          isGenerating={cartFetcher.state !== "idle"}
        />
      ),
    },
    {
      id: "review-request",
      flowId: "delivery",
      name: "Review request",
      subject: "How did it wear?",
      previewText: "Tell us what you think.",
      timing: "After a delivered order",
      available: Boolean(reviewRequest),
      unavailableLabel: "Needs a delivered order",
      generatedHtml: generatedReviewHtml,
      isGenerating: reviewFetcher.state !== "idle",
      error: reviewFetcher.data && "error" in reviewFetcher.data ? reviewFetcher.data.error ?? null : null,
      onGenerate: generateReview,
      preview: (
        <ReviewRequestPreview
          request={reviewRequest}
          generatedHtml={generatedReviewHtml}
          isGenerating={reviewFetcher.state !== "idle"}
        />
      ),
    },
    {
      id: "refund-confirmation",
      flowId: "orders",
      name: "Refund confirmation",
      subject: "Your refund has been processed",
      previewText: "A clear record of what was returned.",
      timing: "When a refund is created",
      available: Boolean(refund),
      unavailableLabel: "Needs a refunded order",
      generatedHtml: generatedRefundHtml,
      isGenerating: refundFetcher.state !== "idle",
      error: refundFetcher.data && "error" in refundFetcher.data ? refundFetcher.data.error ?? null : null,
      onGenerate: generateRefund,
      preview: (
        <RefundConfirmationPreview
          refund={refund}
          generatedHtml={generatedRefundHtml}
          isGenerating={refundFetcher.state !== "idle"}
        />
      ),
    },
    {
      id: "newsletter",
      flowId: "campaigns",
      name: "One-prompt campaign",
      subject: "A campaign written from your brief",
      previewText: "Nomi uses your products, language, and store context.",
      timing: "Whenever you create a campaign",
      available: campaign.trim().length > 0,
      unavailableLabel: "Describe the campaign first",
      generatedHtml: generatedCampaignHtml,
      isGenerating: campaignFetcher.state !== "idle",
      error: campaignError ?? null,
      onGenerate: generateCampaign,
      preview: <CampaignDraftPreview shopName={shopName} products={products} />,
    },
  ];

  const flowGroups = [
    {
      id: "orders" as const,
      name: "Orders & receipts",
      detail: "Transactional records tied to a real order",
      trigger: "An order is placed or a refund is created in Shopify.",
      stop: "Each receipt is generated once for that event.",
      templateIds: ["order-confirmation", "refund-confirmation"],
    },
    {
      id: "delivery" as const,
      name: "Delivery & care",
      detail: "Updates that follow fulfillment and delivery",
      trigger: "A fulfillment changes status or an order is delivered.",
      stop: "The relevant update has been sent for that order.",
      templateIds: ["shipping-update", "review-request"],
    },
    {
      id: "recovery" as const,
      name: "Cart recovery",
      detail: "One useful reminder for a saved checkout",
      trigger: "A consented checkout is left with products in it.",
      stop: "The customer orders or the checkout is no longer abandoned.",
      templateIds: ["abandoned-cart"],
    },
    {
      id: "campaigns" as const,
      name: "Campaigns",
      detail: "A send-ready email from one plain-language brief",
      trigger: "You describe the campaign you want to create.",
      stop: "The proof is ready for your review; audience delivery is separate.",
      templateIds: ["newsletter"],
    },
  ];

  void templates;
  void flowGroups;
  void generateAllEmails;

  const referenceTemplateDefinitions: Array<
    Omit<ReferenceFlowTemplate, "generatedHtml" | "isGenerating" | "error" | "onGenerate">
  > = [
    { id: "welcome-1", flowId: "welcome", name: "1st Welcome Email", subject: `Welcome to ${shopName}`, previewText: "Your welcome gift awaits", timing: "On trigger" },
    { id: "welcome-2", flowId: "welcome", name: "2nd Welcome Email", subject: `A little more about ${shopName}`, previewText: "What makes this store different", timing: "48 hour(s) from previous" },
    { id: "welcome-3", flowId: "welcome", name: "3rd Welcome Email", subject: "A few customer favorites", previewText: "Real products, chosen for you", timing: "2 day(s) from previous" },
    { id: "interest-1", flowId: "interest", name: "1st Follow-Up Email", subject: "A closer look", previewText: "A useful follow-up from the store", timing: "4 hour(s) after product interest" },
    { id: "interest-2", flowId: "interest", name: "2nd Follow-Up Email", subject: "Still considering it?", previewText: "The details that might help", timing: "2 day(s) from previous" },
    { id: "cart-1", flowId: "cart", name: "1st Cart Email", subject: "You left something behind", previewText: "Your checkout is still saved", timing: "1 hour after checkout activity" },
    { id: "cart-2", flowId: "cart", name: "2nd Cart Email", subject: "Still thinking it over?", previewText: "A simple way back to your cart", timing: "24 hour(s) from previous" },
    { id: "cart-3", flowId: "cart", name: "3rd Cart Email", subject: "One last quiet reminder", previewText: "Your saved items are here", timing: "48 hour(s) from previous" },
    { id: "thank-you", flowId: "care", name: "Thank You Email", subject: `Thank you from ${shopName}`, previewText: "A note of appreciation", timing: "After purchase" },
    { id: "review-request", flowId: "care", name: "Review Request", subject: "How did it wear?", previewText: "Tell us what you think", timing: "7 day(s) after delivery" },
    { id: "winback-1", flowId: "winback", name: "1st Winback Email", subject: "A few things worth seeing", previewText: `What is new at ${shopName}`, timing: "30 day(s) after last order" },
    { id: "winback-2", flowId: "winback", name: "2nd Winback Email", subject: "Something new for your next visit", previewText: "A fresh product edit", timing: "14 day(s) from previous" },
    { id: "winback-3", flowId: "winback", name: "3rd Winback Email", subject: "The door is open", previewText: "A final note from the store", timing: "30 day(s) from previous" },
  ];
  const referenceTemplates: ReferenceFlowTemplate[] = referenceTemplateDefinitions.map((template) => {
    const choice = getTemplateChoice(template.id);
    if (choice.mode === "template") {
      // Real templates render instantly, client-side, with no AI call —
      // renderLifecycleTemplateHtml is a pure function of the same
      // LifecycleEmail data the AI path already assembles.
      return {
        ...template,
        generatedHtml: renderLifecycleTemplateHtml(lifecycleInputs[template.id], choice),
        isGenerating: false,
        error: null,
        onGenerate: () => {},
      };
    }
    return {
      ...template,
      generatedHtml: generatedLifecycleEmails[template.id] ?? null,
      isGenerating:
        lifecycleFetcher.state !== "idle" && requestedLifecycleIds.includes(template.id),
      error: lifecycleError,
      onGenerate: () => generateLifecycleEmails([template.id]),
    };
  });

  const referenceFlows = [
    {
      id: "welcome" as const,
      name: "Welcome Journey",
      trigger: "Valid email is entered in a pop-up or email field.",
      stop: "User places an order · User was in flow in the last 7 days.",
      templateIds: ["welcome-1", "welcome-2", "welcome-3"] as LifecycleEmailId[],
    },
    {
      id: "interest" as const,
      name: "Product Interest Follow-Up",
      trigger: "A consented customer shows product interest without purchasing.",
      stop: "User places an order · User enters Abandoned Cart.",
      templateIds: ["interest-1", "interest-2"] as LifecycleEmailId[],
    },
    {
      id: "cart" as const,
      name: "Abandoned Cart",
      trigger: "A consented checkout is left with products in it.",
      stop: "User places an order · Checkout is no longer abandoned.",
      templateIds: ["cart-1", "cart-2", "cart-3"] as LifecycleEmailId[],
    },
    {
      id: "care" as const,
      name: "Customer Care & Reviews",
      trigger: "A customer places an order or a fulfilled order is delivered.",
      stop: "The thank-you and review steps have completed.",
      templateIds: ["thank-you", "review-request"] as LifecycleEmailId[],
    },
    {
      id: "winback" as const,
      name: "Winback Journey",
      trigger: "A past customer has not ordered again within the winback window.",
      stop: "User places an order · User was in flow in the last 90 days.",
      templateIds: ["winback-1", "winback-2", "winback-3"] as LifecycleEmailId[],
    },
  ];

  const selectedTemplate =
    referenceTemplates.find(({ id }) => id === selectedTemplateId) ?? referenceTemplates[0];
  const selectedFlow =
    referenceFlows.find(({ id }) => id === selectedTemplate.flowId) ?? referenceFlows[0];
  const generatedCount = referenceTemplates.filter(({ generatedHtml }) => Boolean(generatedHtml)).length;
  const isGeneratingAny = lifecycleFetcher.state !== "idle";
  const selectedTemplateChoice = getTemplateChoice(selectedTemplateId);

  const startTrial = () => {
    setTrialStarted(true);
    generateAllLifecycleEmails();
  };

  if (showOnboarding === null) {
    return <main className="nomi-onboarding" aria-label="Loading setup" />;
  }

  if (showOnboarding) {
    return (
      <NomiOnboarding
        shopName={shopName}
        tone={tone}
        onPickTone={(nextTone) => {
          setTone(nextTone);
          deliveryFetcher.submit(
            { payload: JSON.stringify({ kind: "set-tone", tone: nextTone }) },
            { method: "POST" },
          );
        }}
        onFinish={finishOnboarding}
      />
    );
  }

  return (
    <main className="nomi-flow-page nomi-flow-page-reference">
      <div className="nomi-flow-shell">
        <header className="nomi-flow-header">
          <div className="nomi-flow-title">
            <span className="nomi-flow-reference-arrow" aria-hidden="true">←</span>
            <div>
              <div className="nomi-flow-heading-line">
                <h1>Flow Editor</h1>
                <span>{shopName}</span>
              </div>
            </div>
          </div>

          <div className="nomi-flow-header-actions">
            <button
              className="nomi-replay-setup"
              type="button"
              onClick={replayOnboarding}
            >
              Replay setup
            </button>
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
                      payload: JSON.stringify({ kind: "set-language", language: nextLanguage }),
                    },
                    { method: "POST" },
                  );
                }}
              >
                {EMAIL_LANGUAGES.map((option) => (
                  <option key={option.code} value={option.code}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="nomi-language-field">
              <span>Email tone</span>
              <select
                className="nomi-select"
                value={tone}
                onChange={(event) => {
                  const nextTone = event.target.value as EmailTone;
                  setTone(nextTone);
                  deliveryFetcher.submit(
                    {
                      payload: JSON.stringify({ kind: "set-tone", tone: nextTone }),
                    },
                    { method: "POST" },
                  );
                }}
              >
                {EMAIL_TONES.map((option) => (
                  <option key={option.code} value={option.code}>{option.label}</option>
                ))}
              </select>
            </label>
            <div className="nomi-flow-progress" aria-label={`${generatedCount} of ${referenceTemplates.length} emails generated`}>
              <strong>{generatedCount} / {referenceTemplates.length} LIVE</strong>
              <i><b style={{ width: `${(generatedCount / referenceTemplates.length) * 100}%` }} /></i>
            </div>
          </div>
        </header>

        <section className="nomi-reference-activation" aria-label="Account and flow activation">
          <article className="nomi-reference-activation-card is-trial">
            <div className="nomi-reference-activation-title">
              <span aria-hidden="true">!</span>
              <strong>Activate your account to start sending emails</strong>
            </div>
            <p>Start your 7-day free trial to enable email sending to your customers.</p>
            <button type="button" disabled={isGeneratingAny} onClick={startTrial}>
              {trialStarted ? "Trial Started" : "Start Free Trial"}
            </button>
          </article>

          <article className="nomi-reference-activation-card is-flows">
            <div className="nomi-reference-activation-title">
              <span aria-hidden="true">!</span>
              <strong>Activate your email flows</strong>
            </div>
            <p>Activate your email flows to start recovering checkout abandoners &amp; grow your revenue.</p>
            <div className="nomi-reference-activation-actions">
              <button
                type="button"
                disabled={deliveryFetcher.state !== "idle" || !delivery.providerConfigured}
                title={delivery.providerConfigured ? undefined : "Add the Resend sender and worker secrets first"}
                onClick={() =>
                  deliveryFetcher.submit(
                    { payload: JSON.stringify({ kind: "set-sending", enabled: !delivery.sendingEnabled }) },
                    { method: "POST" },
                  )
                }
              >
                {delivery.sendingEnabled ? "Activated" : "Activate"}
              </button>
              <a href="mailto:support@nomi.email">▢&nbsp; Talk to support</a>
            </div>
          </article>
        </section>

        <div className="nomi-flow-workspace">
          <section className="nomi-flow-selector" aria-labelledby="nomi-flow-selector-title">
            <div className="nomi-flow-panel-label" id="nomi-flow-selector-title">Flow selector</div>
            <div className="nomi-flow-groups">
              {referenceFlows.map((flow) => {
                const flowTemplates = referenceTemplates.filter(({ id }) => flow.templateIds.includes(id));
                const readyInFlow = flowTemplates.filter(({ generatedHtml }) => Boolean(generatedHtml)).length;
                const isExpanded = expandedFlowId === flow.id;
                return (
                  <article className={`nomi-flow-group tone-${flow.id}${selectedFlow.id === flow.id ? " is-current" : ""}`} key={flow.id}>
                    <button
                      className="nomi-flow-group-head"
                      type="button"
                      aria-expanded={isExpanded}
                      onClick={() => setExpandedFlowId(isExpanded ? "" : flow.id)}
                    >
                      <span className="nomi-flow-count">{readyInFlow}/{flowTemplates.length}</span>
                      <span className="nomi-flow-group-copy"><strong>{flow.name}</strong><i aria-hidden="true" /></span>
                      <span className="nomi-flow-group-toggle">
                        {readyInFlow} of {flowTemplates.length}
                        <FlowChevronIcon />
                      </span>
                    </button>

                    {isExpanded ? (
                      <div className="nomi-flow-email-list">
                        {flowTemplates.map((template) => (
                          <div className={`nomi-flow-email-row${selectedTemplate.id === template.id ? " is-selected" : ""}`} key={template.id}>
                            <button
                              className="nomi-flow-email-select"
                              type="button"
                              onClick={() => setSelectedTemplateId(template.id)}
                            >
                              <span className="nomi-flow-mail-icon" aria-hidden="true">✉</span>
                              <span><strong>{template.name}</strong><small>{template.timing}</small></span>
                            </button>
                            <span className={`nomi-flow-state${template.error ? " is-error" : template.generatedHtml ? " is-ready" : ""}`}>
                              {EMAIL_GENERATION_PAUSED ? "GENERATION PAUSED" : template.error ? "TRY AGAIN" : template.isGenerating ? "GENERATING" : template.generatedHtml ? "GENERATED" : "PENDING ACTIVATION"}
                            </span>
                            <button
                              className="nomi-flow-generate"
                              type="button"
                              disabled={EMAIL_GENERATION_PAUSED || template.isGenerating || isGeneratingAny}
                              onClick={() => {
                                setSelectedTemplateId(template.id);
                                template.onGenerate();
                              }}
                            >
                              {EMAIL_GENERATION_PAUSED ? "Paused" : template.isGenerating ? "Writing…" : template.generatedHtml ? "Rewrite" : "Generate"}
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>

            <section className="nomi-flow-rules" aria-labelledby="nomi-flow-rules-title">
              <div className="nomi-flow-panel-label" id="nomi-flow-rules-title">{selectedFlow.name} — triggers &amp; funnel</div>
              <p className="nomi-reference-best-practice">All Nomi triggers are based on the industry&apos;s best practices</p>
              <div className="nomi-flow-rule-grid">
                <div>
                  <strong><RuleAddedIcon /> Added when</strong>
                  <p>{selectedFlow.trigger}</p>
                </div>
                <div>
                  <strong><RuleRemovedIcon /> Removed when</strong>
                  <p>{selectedFlow.stop}</p>
                </div>
              </div>
              <label className="nomi-reference-new-contacts">
                <input type="checkbox" />
                Only send to new contacts
              </label>
              <div className="nomi-reference-timing-list">
                {referenceTemplates
                  .filter(({ flowId }) => flowId === selectedFlow.id)
                  .map((template) => (
                    <div key={template.id}>
                      <i aria-hidden="true" />
                      <span><strong>{template.name}</strong><small>{template.timing}</small></span>
                      <button type="button" onClick={() => setSelectedTemplateId(template.id)} aria-label={`Edit ${template.name}`}>⌕</button>
                    </div>
                  ))}
              </div>
              <p className="nomi-flow-ai-note"><span aria-hidden="true">ⓘ</span> AI can make mistakes, so double-check that the results are accurate before using them.</p>
            </section>
          </section>

          <aside className="nomi-flow-proof" aria-labelledby="nomi-flow-proof-title">
            <div className="nomi-flow-proof-topline">
              <div>
                <span>{selectedTemplate.name} — preview</span>
                <h2 className="nomi-visually-hidden" id="nomi-flow-proof-title">{selectedTemplate.subject}</h2>
              </div>
              <div className="nomi-flow-proof-topline-actions">
                <div className="nomi-flow-mode-toggle" role="group" aria-label="Email source">
                  <button
                    type="button"
                    className={selectedTemplateChoice.mode === "ai" ? "is-active" : undefined}
                    onClick={() => updateTemplateChoice(selectedTemplateId, { mode: "ai" })}
                  >
                    AI
                  </button>
                  <button
                    type="button"
                    className={selectedTemplateChoice.mode === "template" ? "is-active" : undefined}
                    onClick={() => updateTemplateChoice(selectedTemplateId, { mode: "template" })}
                  >
                    Template
                  </button>
                </div>
                {selectedTemplateChoice.mode === "ai" ? (
                  <button
                    className="nomi-flow-proof-action"
                    type="button"
                    disabled={EMAIL_GENERATION_PAUSED || selectedTemplate.isGenerating || isGeneratingAny}
                    onClick={selectedTemplate.onGenerate}
                  >
                    {EMAIL_GENERATION_PAUSED ? "Paused" : selectedTemplate.isGenerating ? "Writing…" : selectedTemplate.generatedHtml ? "Edit⌄" : "Generate"}
                  </button>
                ) : null}
              </div>
            </div>

            {selectedTemplateChoice.mode === "template" ? (
              <div className="nomi-flow-template-settings">
                <label>
                  <span>Logo URL</span>
                  <input
                    type="text"
                    placeholder="https://…"
                    value={selectedTemplateChoice.logoUrl ?? ""}
                    onChange={(event) =>
                      updateTemplateChoice(selectedTemplateId, { logoUrl: event.target.value || null })
                    }
                  />
                </label>
                <label>
                  <span>Primary color</span>
                  <input
                    type="color"
                    value={selectedTemplateChoice.primaryColor ?? "#57534b"}
                    onChange={(event) =>
                      updateTemplateChoice(selectedTemplateId, { primaryColor: event.target.value })
                    }
                  />
                </label>
                <label>
                  <span>Button text</span>
                  <input
                    type="text"
                    placeholder={LIFECYCLE_TEMPLATE_COPY[selectedTemplateId].ctaLabel}
                    value={selectedTemplateChoice.buttonText ?? ""}
                    onChange={(event) =>
                      updateTemplateChoice(selectedTemplateId, { buttonText: event.target.value || null })
                    }
                  />
                </label>
              </div>
            ) : null}

            <div className="nomi-flow-inbox-meta">
              <div><strong>From</strong><span>{delivery.fromAddress ?? `${shopName} via Nomi`}</span></div>
              <div><strong>Subject</strong><span>{selectedTemplate.subject}</span></div>
              <div><strong>Preview</strong><span>{selectedTemplate.previewText}</span></div>
            </div>

            {selectedTemplate.error ? <p className="nomi-flow-proof-error" role="alert">{selectedTemplate.error}</p> : null}
            <div className="nomi-flow-proof-canvas" aria-live="polite">
              {selectedTemplate.generatedHtml ? (
                <FlowGeneratedEmailPreview html={selectedTemplate.generatedHtml} title={`${selectedTemplate.name} generated email preview`} />
              ) : selectedTemplate.isGenerating ? (
                <FlowGenerationPending name={selectedTemplate.name} />
              ) : (
                <div className="nomi-flow-fallback-proof">
                  <LifecycleStaticPreview
                    shopName={shopName}
                    template={selectedTemplate}
                    products={products}
                  />
                  <div className="nomi-flow-fallback-caption">
                    <strong>{EMAIL_GENERATION_PAUSED ? "Generation paused" : "Pending activation"}</strong>
                    <span>{EMAIL_GENERATION_PAUSED ? "Nomi will keep this structured preview and will not call Claude until generation is resumed." : "Generate this email to replace the structured preview with Claude&apos;s finished HTML."}</span>
                  </div>
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}

function FlowGeneratedEmailPreview({ html, title }: { html: string; title: string }) {
  return (
    <iframe
      className="nomi-flow-generated-frame"
      srcDoc={html}
      title={title}
      sandbox=""
    />
  );
}

function FlowGenerationPending({ name }: { name: string }) {
  return (
    <div className="nomi-flow-writing" role="status">
      <span className="nomi-flow-writing-mark" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <strong>Writing {name.toLowerCase()}</strong>
      <p>Claude is using the store record, selected language, and Nomi&apos;s email-safe design rules.</p>
    </div>
  );
}

function LifecycleStaticPreview({
  shopName,
  template,
  products,
}: {
  shopName: string;
  template: ReferenceFlowTemplate;
  products: DashboardProduct[];
}) {
  return (
    <div className="nomi-reference-email-preview" aria-hidden="true">
      <div className="nomi-reference-email-mark">➤</div>
      <header>
        <span>{template.flowId === "welcome" ? "WELCOME TO" : template.name.toUpperCase()}</span>
        <strong>{shopName}</strong>
      </header>
      <section>
        <p>{template.previewText}</p>
        <b>{template.flowId === "cart" ? "RETURN TO CART" : template.flowId === "care" ? "THANK YOU" : "SHOP NOW"}</b>
      </section>
      <h3>Recommended for you</h3>
      <div className="nomi-reference-email-products">
        {products.slice(0, 3).map((product) => (
          <article key={product.id}>
            {product.imageUrl ? <img src={product.imageUrl} alt="" /> : <i />}
            <div><strong>{product.title}</strong><span>{product.price}</span><b>BUY NOW</b></div>
          </article>
        ))}
      </div>
    </div>
  );
}

function CampaignDraftPreview({
  shopName,
  products,
}: {
  shopName: string;
  products: DashboardProduct[];
}) {
  return (
    <div className="nomi-preview nomi-flow-campaign-placeholder" aria-hidden="true">
      <div className="nomi-flow-campaign-brand">{shopName}</div>
      <span className="nomi-flow-campaign-kicker">One prompt. One finished campaign.</span>
      <strong>Tell Nomi what the moment is.</strong>
      <p>Your products and store context become the copy, structure, and visual direction.</p>
      <div>
        {products.slice(0, 3).map((product) =>
          product.imageUrl ? <img key={product.id} src={product.imageUrl} alt="" /> : <i key={product.id} />,
        )}
      </div>
      <b>DESCRIBE A CAMPAIGN TO BEGIN</b>
    </div>
  );
}

const ONBOARDING_TONE_OPTIONS: {
  code: EmailTone;
  name: string;
  example: string;
  hue: "cyan" | "magenta" | "neutral";
}[] = [
  { code: "warm-plain", name: "Warm & plain", example: "Thank you, Ananya — it's on the way", hue: "cyan" },
  { code: "bright-bubbly", name: "Bright & bubbly", example: "Your order's on the way — yay!", hue: "magenta" },
  { code: "calm-minimal", name: "Calm & minimal", example: "Order confirmed.", hue: "neutral" },
];

const ONBOARDING_FOUND_CARDS: {
  tag: string;
  hue: "cyan" | "magenta" | "gold" | "neutral";
  rotate: string;
  offset: string;
}[] = [
  { tag: "24 items", hue: "cyan", rotate: "-8deg", offset: "-150px" },
  { tag: "your colors", hue: "magenta", rotate: "-2deg", offset: "-40px" },
  { tag: "your fonts", hue: "gold", rotate: "4deg", offset: "70px" },
  { tag: "your tone", hue: "neutral", rotate: "9deg", offset: "180px" },
];

const ONBOARDING_ORBIT_CHIPS: {
  hue: "cyan" | "magenta" | "gold" | "neutral" | "cyan-deep";
  size: number;
  x: number;
  y: number;
  duration: number;
  reverse: boolean;
  delay: number;
}[] = [
  { hue: "cyan", size: 46, x: -70, y: -70, duration: 10, reverse: false, delay: 280 },
  { hue: "magenta", size: 38, x: 80, y: -30, duration: 13, reverse: true, delay: 560 },
  { hue: "gold", size: 34, x: -90, y: 60, duration: 15, reverse: false, delay: 840 },
  { hue: "neutral", size: 30, x: 75, y: 65, duration: 11, reverse: true, delay: 1120 },
  { hue: "cyan-deep", size: 26, x: -16, y: -104, duration: 17, reverse: false, delay: 1400 },
];

const ONBOARDING_DAYS: { label: string; items: ("cyan" | "magenta" | "neutral")[] }[] = [
  { label: "Day 0", items: ["cyan", "magenta"] },
  { label: "Day 1", items: ["cyan"] },
  { label: "Day 3", items: [] },
  { label: "Day 7", items: ["neutral"] },
  { label: "Day 10", items: ["cyan"] },
  { label: "Day 14", items: [] },
];

const ONBOARDING_CHECKLIST: { name: string; hue: "cyan" | "magenta" }[] = [
  { name: "Order confirmation", hue: "cyan" },
  { name: "Shipping update", hue: "magenta" },
  { name: "Abandoned cart", hue: "cyan" },
  { name: "Refund confirmation", hue: "magenta" },
  { name: "Review request", hue: "cyan" },
];

// All the reveal-chain delays in one place, in ms, so the rail's progress
// fill (below) can be computed from the same numbers that actually drive
// the timers instead of a second, hand-copied set that could drift out of
// sync.
const ONBOARDING_TIMING = {
  welcomePause: 3900,
  foundCardStep: 700,
  foundCardSettle: 1800,
  dayStep: 430,
  daySettle: 1400,
  tonePick: 1100,
  generating: 2200,
  checklistStep: 750,
  finishPause: 1200,
} as const;

function OnboardingMarkIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M50 16 L14 30 L29 36 L50 16 Z" />
      <path d="M29 36 L33 50 L50 16" />
    </svg>
  );
}

function OnboardingEnvelopeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round">
      <rect x="2.5" y="5" width="19" height="14" rx="2" />
      <path d="M3 6 L12 13.5 L21 6" />
    </svg>
  );
}

function OnboardingCheckIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="9" fill="currentColor" />
      <path d="M5.8 10.3 L8.6 13.1 L14.2 7.3" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function OnboardingCloseIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M5 5 L15 15 M15 5 L5 15" />
    </svg>
  );
}

function NomiOnboarding({
  shopName,
  tone,
  onPickTone,
  onFinish,
}: {
  shopName: string;
  tone: EmailTone;
  onPickTone: (tone: EmailTone) => void;
  onFinish: () => void;
}) {
  const [step, setStep] = useState(0);
  const [foundN, setFoundN] = useState(0);
  const [dayN, setDayN] = useState(0);
  const [pickedTone, setPickedTone] = useState<EmailTone | null>(null);
  const [generating, setGenerating] = useState(false);
  const [checkN, setCheckN] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);

  // Bumped at the start of every top-level action (a click, or unmount) so
  // any timers still in flight from a previous chain become no-ops instead
  // of firing into stale state — the same guard the approved mockup's own
  // state machine uses.
  const tokenRef = useRef(0);

  const activeTone = pickedTone ?? tone;

  useEffect(() => {
    setReducedMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onFinish();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onFinish]);

  useEffect(() => {
    return () => {
      tokenRef.current += 1;
    };
  }, []);

  const after = (ms: number, fn: () => void) => {
    const myToken = tokenRef.current;
    window.setTimeout(() => {
      if (myToken === tokenRef.current) fn();
    }, reducedMotion ? 0 : ms);
  };

  const goStep4 = () => {
    setStep(4);
    setGenerating(true);
    setCheckN(0);
    after(ONBOARDING_TIMING.generating, () => {
      setGenerating(false);
      const revealCheck = (n: number) => {
        setCheckN(n);
        if (n < ONBOARDING_CHECKLIST.length) after(ONBOARDING_TIMING.checklistStep, () => revealCheck(n + 1));
        else after(ONBOARDING_TIMING.finishPause, onFinish);
      };
      revealCheck(1);
    });
  };

  const goStep2 = () => {
    setStep(2);
    setDayN(0);
    const revealDay = (n: number) => {
      setDayN(n);
      if (n < ONBOARDING_DAYS.length) after(ONBOARDING_TIMING.dayStep, () => revealDay(n + 1));
      else after(ONBOARDING_TIMING.daySettle, () => setStep(3));
    };
    revealDay(1);
  };

  useEffect(() => {
    after(ONBOARDING_TIMING.welcomePause, connect);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connect = () => {
    tokenRef.current += 1;
    setStep(1);
    setFoundN(0);
    const revealFound = (n: number) => {
      setFoundN(n);
      if (n < ONBOARDING_FOUND_CARDS.length) after(ONBOARDING_TIMING.foundCardStep, () => revealFound(n + 1));
      else after(ONBOARDING_TIMING.foundCardSettle, goStep2);
    };
    revealFound(1);
  };

  const pickTone = (nextTone: EmailTone) => {
    tokenRef.current += 1;
    setPickedTone(nextTone);
    onPickTone(nextTone);
    after(ONBOARDING_TIMING.tonePick, goStep4);
  };

  // The rail's per-tab progress fill mirrors the timer chains above exactly
  // (same constants) so a bar finishes filling at the same instant its step
  // actually advances, instead of just snapping to full the moment a step
  // becomes active.
  const tabFillMs: Partial<Record<number, number>> = {
    0: ONBOARDING_TIMING.welcomePause,
    1: ONBOARDING_TIMING.foundCardStep * (ONBOARDING_FOUND_CARDS.length - 1) + ONBOARDING_TIMING.foundCardSettle,
    2: ONBOARDING_TIMING.dayStep * (ONBOARDING_DAYS.length - 1) + ONBOARDING_TIMING.daySettle,
    3: ONBOARDING_TIMING.tonePick,
    4:
      ONBOARDING_TIMING.generating +
      ONBOARDING_TIMING.checklistStep * (ONBOARDING_CHECKLIST.length - 1) +
      ONBOARDING_TIMING.finishPause,
  };

  function renderStep(): React.ReactNode {
    if (step === 0) {
      return (
        <div className="nomi-onboarding-step-inner" key="step-0">
          <div className="nomi-onboarding-orbit" aria-hidden="true">
            {ONBOARDING_ORBIT_CHIPS.map((chip) => (
              <span
                key={chip.hue}
                className="nomi-onboarding-orbit-spin"
                style={{
                  animationDuration: `${chip.duration}s`,
                  animationDirection: chip.reverse ? "reverse" : "normal",
                } as React.CSSProperties}
              >
                <span
                  className="nomi-onboarding-orbit-counter"
                  style={{
                    left: `calc(50% + ${chip.x}px)`,
                    top: `calc(50% + ${chip.y}px)`,
                    animationDuration: `${chip.duration}s`,
                    // Cancels the outer wrapper's spin so the chip itself stays
                    // upright while still orbiting — same speed, opposite direction.
                    animationDirection: chip.reverse ? "normal" : "reverse",
                  } as React.CSSProperties}
                >
                  <span
                    className="nomi-onboarding-orbit-fly"
                    style={{
                      "--nomi-orb-fx": `${chip.x * 1.4}px`,
                      "--nomi-orb-fy": `${chip.y * 1.4}px`,
                      animationDelay: `${chip.delay}ms`,
                    } as React.CSSProperties}
                  >
                    <span
                      className={`nomi-onboarding-orbit-chip is-${chip.hue}`}
                      style={{ width: chip.size, height: chip.size }}
                    />
                  </span>
                </span>
              </span>
            ))}
            <span className="nomi-onboarding-orbit-center">
              <OnboardingMarkIcon />
            </span>
          </div>
          <div className="nomi-onboarding-copy is-orbit-copy">
            <h1 id="nomi-onboarding-title">Welcome, {shopName}.</h1>
            <p>Shopify already told us who you are. Let&rsquo;s get your emails ready.</p>
          </div>
        </div>
      );
    }

    if (step === 1) {
      return (
        <div className="nomi-onboarding-step-inner" key="step-1">
          <div className="nomi-onboarding-found" aria-hidden="true">
            {ONBOARDING_FOUND_CARDS.slice(0, foundN).map((card) => (
              <div
                key={card.tag}
                className="nomi-onboarding-found-card"
                style={{ marginLeft: card.offset, "--nomi-onb-rot": card.rotate } as React.CSSProperties}
              >
                <div className={`nomi-onboarding-found-swatch is-${card.hue}`} />
                <span className={`nomi-onboarding-found-tag is-${card.hue}`}>{card.tag}</span>
              </div>
            ))}
          </div>
          <div className="nomi-onboarding-copy">
            <h1 id="nomi-onboarding-title">Found you, {shopName}.</h1>
            <p>Your products, your colors, your fonts — already loaded, nothing to upload.</p>
          </div>
        </div>
      );
    }

    if (step === 2) {
      return (
        <div className="nomi-onboarding-step-inner" key="step-2">
          <div className="nomi-onboarding-days" aria-hidden="true">
            {ONBOARDING_DAYS.map((day, index) => (
              <div className="nomi-onboarding-day" key={day.label}>
                <span>{day.label}</span>
                <div className="nomi-onboarding-day-items">
                  {index < dayN
                    ? day.items.map((hue, itemIndex) => (
                        <span key={itemIndex} className={`nomi-onboarding-day-mail is-${hue}`}>
                          <OnboardingEnvelopeIcon />
                        </span>
                      ))
                    : null}
                </div>
              </div>
            ))}
          </div>
          <div className="nomi-onboarding-copy">
            <h1 id="nomi-onboarding-title">We&rsquo;ll know exactly when to say something.</h1>
            <p>Five moments over two weeks, from checkout to &ldquo;how was it?&rdquo;</p>
          </div>
        </div>
      );
    }

    if (step === 3) {
      return (
        <div className="nomi-onboarding-step-inner is-tight" key="step-3">
          <div className="nomi-onboarding-copy">
            <h1 id="nomi-onboarding-title">What&rsquo;s your vibe?</h1>
            <p>Pick a tone and we&rsquo;ll write like that everywhere.</p>
          </div>
          <div className="nomi-onboarding-tones" role="radiogroup" aria-label="Choose the tone for your emails">
            {ONBOARDING_TONE_OPTIONS.map((option) => (
              <button
                key={option.code}
                type="button"
                role="radio"
                aria-checked={activeTone === option.code}
                className={`nomi-onboarding-tone${activeTone === option.code ? " is-chosen" : ""}`}
                onClick={() => pickTone(option.code)}
              >
                <span className={`nomi-onboarding-tone-dot is-${option.hue}`} aria-hidden="true" />
                <span className="nomi-onboarding-tone-copy">
                  <strong>{option.name}</strong>
                  <em>“{option.example}”</em>
                </span>
                {activeTone === option.code ? (
                  <span className="nomi-onboarding-tone-check" aria-hidden="true">
                    <OnboardingCheckIcon />
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </div>
      );
    }

    if (generating) {
      return (
        <div className="nomi-onboarding-step-inner is-tight" key="step-4-loading">
          <span className="nomi-onboarding-icon is-small" aria-hidden="true">
            <OnboardingMarkIcon />
          </span>
          <div className="nomi-onboarding-copy">
            <h1 id="nomi-onboarding-title">Writing your five emails…</h1>
            <p>Pulling in your products, your colors, and the tone you picked.</p>
          </div>
          <div className="nomi-onboarding-progress-track" aria-hidden="true">
            <span className="nomi-onboarding-progress-fill" />
          </div>
        </div>
      );
    }

    return (
      <div className="nomi-onboarding-step-inner" key="step-4-ready">
        <div className="nomi-onboarding-checklist" aria-hidden="true">
          {ONBOARDING_CHECKLIST.map((item, index) => (
            <div key={item.name} className={`nomi-onboarding-check-row${index < checkN ? " is-on" : ""}`}>
              <span className="nomi-onboarding-check-mark-slot">
                {index < checkN ? (
                  <span className={`nomi-onboarding-check-mark is-${item.hue}`}>
                    <OnboardingCheckIcon />
                  </span>
                ) : (
                  <span className="nomi-onboarding-check-empty" />
                )}
              </span>
              <strong>{item.name}</strong>
            </div>
          ))}
        </div>
        <div className="nomi-onboarding-copy">
          <h1 id="nomi-onboarding-title">Five emails, ready when you are.</h1>
          <p>Nothing sends until you say go.</p>
        </div>
      </div>
    );
  }

  return (
    <main className="nomi-onboarding" aria-labelledby="nomi-onboarding-title">
      <div className="nomi-onboarding-brand">
        <span className="nomi-onboarding-mark" aria-hidden="true">
          <OnboardingMarkIcon />
        </span>
        <span className="nomi-onboarding-wordmark">Nomi</span>
      </div>

      <section className="nomi-onboarding-card" aria-live="polite">
        <div className="nomi-setup-header">
          <div>
            <strong>Setting up Nomi</strong>
            <span>{shopName}</span>
          </div>
          <button
            className="nomi-onboarding-close"
            type="button"
            onClick={onFinish}
            aria-label="Close setup"
          >
            <OnboardingCloseIcon />
          </button>
        </div>

        <div className="nomi-setup-tabs" aria-label={`Setup screen ${step + 1} of 5`}>
          {ONBOARDING_RAIL.map((label, index) => {
            const isActive = index === step;
            const isComplete = index < step;
            // Step 3 waits on a tone pick before it has a fixed duration to
            // animate against — it stays empty until one is chosen.
            const isFilling = isActive && (index !== 3 || pickedTone !== null);
            return (
              <div
                className={`${isActive ? "is-active" : ""}${isComplete ? " is-complete" : ""}${isFilling ? " is-filling" : ""}`}
                key={`${label}-${isActive}-${isFilling}`}
                style={
                  isFilling
                    ? ({ "--nomi-tab-duration": `${tabFillMs[index]}ms` } as React.CSSProperties)
                    : undefined
                }
              >
                <span>{label}</span>
                <i aria-hidden="true" />
              </div>
            );
          })}
        </div>

        <div className="nomi-setup-body">
          <div className="nomi-onboarding-step">{renderStep()}</div>
        </div>
      </section>

      {step < 4 ? (
        <button className="nomi-onboarding-skip" type="button" onClick={onFinish}>
          Skip setup
        </button>
      ) : null}
    </main>
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

// Four states, in order of preference: a "writing…" placeholder while a
// manually-triggered generation call is in flight; the real Claude-
// generated email once that call returns (or from a prior click — nothing
// here auto-generates); a hand-built preview using the same real order
// data before anyone has clicked Generate, or if generation failed; and
// the static Moon & Mango archetype when the store has no orders at all
// yet. The dashboard never shows an empty card.
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

// The hand-built, real-data-but-not-AI preview. Shown before Generate has
// been clicked, and again if generation fails — either way, real order
// data instead of reverting all the way to the static mockup.
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

// Same four-state pattern as the other cards: a real generated email for a
// real shipped order (from a prior Generate click — nothing here auto-
// generates), a "writing…" placeholder while that's in flight, a
// hand-built real-data preview before Generate is clicked or if generation
// failed, and the static mockup when the store has no fulfilled orders yet.
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

// The hand-built, real-data-but-not-AI fallback — shown before Generate is
// clicked and if generation fails — mirrors the other cards' RealData*.
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
// email for a real cart (from a prior Generate click), a "writing…"
// placeholder while that's in flight, a hand-built real-data preview
// before Generate is clicked or if generation failed, and the static
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

// Same four-state pattern as the other cards: a real generated email for a
// real delivered order (from a prior Generate click), a "writing…"
// placeholder while that's in flight, a hand-built real-data preview
// before Generate is clicked or if generation failed, and the static
// mockup when no order has been marked delivered yet.
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

// The hand-built, real-data-but-not-AI fallback — shown before Generate is
// clicked and if generation fails — mirrors the other cards' RealData*. The
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
