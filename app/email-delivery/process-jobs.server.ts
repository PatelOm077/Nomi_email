import db from "../db.server";
import { unauthenticated } from "../shopify.server";
import { generateOrderConfirmationEmail } from "../email-engine/generate-order-confirmation-email";
import { generateShippingUpdateEmail } from "../email-engine/generate-shipping-update-email";
import { generateRefundConfirmationEmail } from "../email-engine/generate-refund-confirmation-email";
import { generateReviewRequestEmail } from "../email-engine/generate-review-request-email";
import { generateAbandonedCartEmail } from "../email-engine/generate-abandoned-cart-email";
import { EMAIL_LANGUAGES, type EmailLanguage } from "../email-engine/types";
import { sendEmail } from "./provider.server";

const EMAIL_ORDER_QUERY = `#graphql
  query EmailOrder($id: ID!) {
    shop { name }
    order(id: $id) {
      id
      name
      email
      customer { firstName }
      currentTotalPriceSet { shopMoney { amount currencyCode } }
      lineItems(first: 50) {
        edges {
          node {
            title
            quantity
            image { url }
            product { onlineStoreUrl }
            originalTotalSet { shopMoney { amount currencyCode } }
          }
        }
      }
      fulfillments(first: 20) {
        id
        displayStatus
        estimatedDeliveryAt
        trackingInfo { number url company }
      }
      refunds {
        id
        note
        totalRefundedSet { shopMoney { amount currencyCode } }
        refundLineItems(first: 50) {
          edges {
            node {
              quantity
              subtotalSet { shopMoney { amount currencyCode } }
              lineItem { title image { url } }
            }
          }
        }
      }
    }
  }
`;

const ABANDONED_CHECKOUT_QUERY = `#graphql
  query AbandonedEmailCheckout {
    shop { name }
    abandonedCheckouts(first: 25, sortKey: CREATED_AT, reverse: true) {
      edges {
        node {
          abandonedCheckoutUrl
          customer { firstName }
          totalPriceSet { shopMoney { amount currencyCode } }
          lineItems(first: 50) {
            edges {
              node {
                title
                quantity
                image { url }
                originalTotalPriceSet { shopMoney { amount currencyCode } }
              }
            }
          }
        }
      }
    }
  }
`;

type Money = { amount: string; currencyCode: string };
type OrderData = {
  id: string;
  name: string;
  email: string | null;
  customer: { firstName: string | null } | null;
  currentTotalPriceSet: { shopMoney: Money };
  lineItems: {
    edges: {
      node: {
        title: string;
        quantity: number;
        image: { url: string } | null;
        product: { onlineStoreUrl: string | null } | null;
        originalTotalSet: { shopMoney: Money };
      };
    }[];
  };
  fulfillments: {
    id: string;
    displayStatus: string;
    estimatedDeliveryAt: string | null;
    trackingInfo: { number: string | null; url: string | null; company: string | null }[];
  }[];
  refunds: {
    id: string;
    note: string | null;
    totalRefundedSet: { shopMoney: Money };
    refundLineItems: {
      edges: {
        node: {
          quantity: number;
          subtotalSet: { shopMoney: Money };
          lineItem: { title: string; image: { url: string } | null };
        };
      }[];
    };
  }[];
};

type EmailOrderResponse = {
  data: { shop: { name: string }; order: OrderData | null };
};

type AbandonedCheckoutResponse = {
  data: {
    shop: { name: string };
    abandonedCheckouts: {
      edges: {
        node: {
          abandonedCheckoutUrl: string;
          customer: { firstName: string | null } | null;
          totalPriceSet: { shopMoney: Money };
          lineItems: {
            edges: {
              node: {
                title: string | null;
                quantity: number;
                image: { url: string } | null;
                originalTotalPriceSet: { shopMoney: Money };
              };
            }[];
          };
        };
      }[];
    };
  };
};

type PreparedEmail = {
  to: string;
  subject: string;
  html: string;
  idempotencyKey: string;
};

const SUBJECTS: Record<EmailLanguage, Record<"order" | "shipping" | "refund" | "review" | "cart", string>> = {
  en: { order: "Order confirmed", shipping: "Shipping update", refund: "Refund processed", review: "How was your order?", cart: "You left something behind" },
  es: { order: "Pedido confirmado", shipping: "Actualización del envío", refund: "Reembolso procesado", review: "¿Qué te pareció tu pedido?", cart: "Dejaste algo pendiente" },
  fr: { order: "Commande confirmée", shipping: "Mise à jour de livraison", refund: "Remboursement traité", review: "Que pensez-vous de votre commande ?", cart: "Vous avez laissé quelque chose" },
  de: { order: "Bestellung bestätigt", shipping: "Versandaktualisierung", refund: "Rückerstattung bearbeitet", review: "Wie war Ihre Bestellung?", cart: "Da ist noch etwas in Ihrem Warenkorb" },
  it: { order: "Ordine confermato", shipping: "Aggiornamento sulla spedizione", refund: "Rimborso elaborato", review: "Com'è andato il tuo ordine?", cart: "Hai lasciato qualcosa nel carrello" },
  pt: { order: "Pedido confirmado", shipping: "Atualização de envio", refund: "Reembolso processado", review: "O que achou do seu pedido?", cart: "Você deixou algo no carrinho" },
  hi: { order: "ऑर्डर की पुष्टि हो गई", shipping: "शिपिंग अपडेट", refund: "रिफ़ंड प्रोसेस हो गया", review: "आपका ऑर्डर कैसा था?", cart: "आपके कार्ट में कुछ रह गया है" },
  ja: { order: "ご注文を確認しました", shipping: "配送状況のお知らせ", refund: "返金を処理しました", review: "ご注文はいかがでしたか？", cart: "カートに商品が残っています" },
  ko: { order: "주문이 확인되었습니다", shipping: "배송 업데이트", refund: "환불이 처리되었습니다", review: "주문하신 상품은 어떠셨나요?", cart: "장바구니에 상품이 남아 있습니다" },
  "zh-CN": { order: "订单已确认", shipping: "配送更新", refund: "退款已处理", review: "您对订单满意吗？", cart: "您的购物车中还有商品" },
};

function resolveLanguage(value: unknown, fallback: string): EmailLanguage {
  const requested = typeof value === "string" ? value : fallback;
  const exact = EMAIL_LANGUAGES.find(({ code }) => code === requested)?.code;
  if (exact) return exact;
  const prefix = requested.toLowerCase().split(/[-_]/)[0];
  return EMAIL_LANGUAGES.find(({ code }) => code.toLowerCase().split("-")[0] === prefix)?.code ?? "en";
}

function formatMoney(money: Money, language: EmailLanguage): string {
  return new Intl.NumberFormat(language, {
    style: "currency",
    currency: money.currencyCode,
    maximumFractionDigits: 2,
  }).format(Number(money.amount));
}

function orderIdFromPayload(payload: Record<string, unknown>): string | null {
  if (typeof payload.order_id === "number" || typeof payload.order_id === "string") {
    return `gid://shopify/Order/${payload.order_id}`;
  }
  return typeof payload.admin_graphql_api_id === "string"
    ? payload.admin_graphql_api_id
    : null;
}

function resourceId(payload: Record<string, unknown>): string | null {
  if (typeof payload.admin_graphql_api_id === "string") {
    return payload.admin_graphql_api_id;
  }
  return typeof payload.id === "number" || typeof payload.id === "string"
    ? String(payload.id)
    : null;
}

function matchingResource<T extends { id: string }>(items: T[], id: string | null): T | null {
  if (!id) return items.at(-1) ?? null;
  return items.find((item) => item.id === id || item.id.endsWith(`/${id}`)) ?? null;
}

function subject(kind: keyof (typeof SUBJECTS)["en"], language: EmailLanguage, orderNumber: string) {
  return `${SUBJECTS[language][kind]} — ${orderNumber}`;
}

async function prepareAbandonedCart(
  shop: string,
  payload: Record<string, unknown>,
): Promise<PreparedEmail | null> {
  const token = typeof payload.token === "string" ? payload.token : null;
  const email = typeof payload.email === "string" ? payload.email : null;
  if (!token || !email || payload.buyer_accepts_marketing !== true) return null;

  const { admin } = await unauthenticated.admin(shop);
  const response = await admin.graphql(ABANDONED_CHECKOUT_QUERY);
  const { data } = (await response.json()) as AbandonedCheckoutResponse;
  const checkout = data.abandonedCheckouts.edges.find(({ node }) =>
    node.abandonedCheckoutUrl.includes(token),
  )?.node;
  if (!checkout) return null;

  const settings = await db.shopSettings.findUnique({ where: { shop } });
  const language = resolveLanguage(payload.customer_locale, settings?.language ?? "en");
  const html = await generateAbandonedCartEmail({
    shopName: data.shop.name,
    language,
    customerFirstName: checkout.customer?.firstName ?? null,
    recoveryUrl: checkout.abandonedCheckoutUrl,
    total: formatMoney(checkout.totalPriceSet.shopMoney, language),
    lineItems: checkout.lineItems.edges.map(({ node }) => ({
      title: node.title ?? "Item",
      quantity: node.quantity,
      price: formatMoney(node.originalTotalPriceSet.shopMoney, language),
      imageUrl: node.image?.url ?? null,
    })),
  });
  return {
    to: email,
    subject: SUBJECTS[language].cart,
    html,
    idempotencyKey: `cart:${shop}:${token}`,
  };
}

async function prepareEmail(
  shop: string,
  topic: string,
  payload: Record<string, unknown>,
): Promise<PreparedEmail | null> {
  if (topic === "CHECKOUTS_UPDATE") {
    return prepareAbandonedCart(shop, payload);
  }

  const orderId = orderIdFromPayload(payload);
  if (!orderId) throw new Error(`Webhook ${topic} did not include an order ID.`);

  const { admin } = await unauthenticated.admin(shop);
  const response = await admin.graphql(EMAIL_ORDER_QUERY, { variables: { id: orderId } });
  const { data } = (await response.json()) as EmailOrderResponse;
  const order = data.order;
  if (!order?.email) throw new Error(`Order ${orderId} has no customer email.`);

  const settings = await db.shopSettings.findUnique({ where: { shop } });
  const language = resolveLanguage(payload.customer_locale, settings?.language ?? "en");
  const common = {
    shopName: data.shop.name,
    language,
    customerFirstName: order.customer?.firstName ?? null,
    orderNumber: order.name,
  };

  if (topic === "ORDERS_CREATE") {
    const html = await generateOrderConfirmationEmail({
      ...common,
      total: formatMoney(order.currentTotalPriceSet.shopMoney, language),
      lineItems: order.lineItems.edges.map(({ node }) => ({
        title: node.title,
        quantity: node.quantity,
        price: formatMoney(node.originalTotalSet.shopMoney, language),
        imageUrl: node.image?.url ?? null,
      })),
    });
    return { to: order.email, subject: subject("order", language, order.name), html, idempotencyKey: `order:${shop}:${order.id}` };
  }

  if (topic === "FULFILLMENTS_CREATE") {
    const fulfillment = matchingResource(order.fulfillments, resourceId(payload));
    if (!fulfillment) throw new Error(`Fulfillment was not found on ${order.name}.`);
    const tracking = fulfillment.trackingInfo[0] ?? null;
    const html = await generateShippingUpdateEmail({
      ...common,
      fulfillmentStatus: fulfillment.displayStatus.toLowerCase().replace(/_/g, " "),
      trackingNumber: tracking?.number ?? null,
      carrierName: tracking?.company ?? null,
      trackingUrl: tracking?.url ?? null,
      estimatedDelivery: fulfillment.estimatedDeliveryAt,
      lineItems: order.lineItems.edges.map(({ node }) => ({
        title: node.title,
        quantity: node.quantity,
        imageUrl: node.image?.url ?? null,
      })),
    });
    return { to: order.email, subject: subject("shipping", language, order.name), html, idempotencyKey: `shipping:${shop}:${fulfillment.id}` };
  }

  if (topic === "FULFILLMENTS_UPDATE") {
    if (String(payload.shipment_status).toLowerCase() !== "delivered") return null;
    const html = await generateReviewRequestEmail({
      ...common,
      reviewUrl: order.lineItems.edges[0]?.node.product?.onlineStoreUrl ?? null,
      lineItems: order.lineItems.edges.map(({ node }) => ({
        title: node.title,
        quantity: node.quantity,
        imageUrl: node.image?.url ?? null,
      })),
    });
    return { to: order.email, subject: subject("review", language, order.name), html, idempotencyKey: `review:${shop}:${order.id}` };
  }

  if (topic === "REFUNDS_CREATE") {
    const refund = matchingResource(order.refunds, resourceId(payload));
    if (!refund) throw new Error(`Refund was not found on ${order.name}.`);
    const html = await generateRefundConfirmationEmail({
      ...common,
      reason: refund.note,
      refundedTotal: formatMoney(refund.totalRefundedSet.shopMoney, language),
      lineItems: refund.refundLineItems.edges.map(({ node }) => ({
        title: node.lineItem.title,
        quantity: node.quantity,
        price: formatMoney(node.subtotalSet.shopMoney, language),
        imageUrl: node.lineItem.image?.url ?? null,
      })),
    });
    return { to: order.email, subject: subject("refund", language, order.name), html, idempotencyKey: `refund:${shop}:${refund.id}` };
  }

  throw new Error(`Unsupported email webhook topic: ${topic}`);
}

export async function processPendingEmailJobs(limit = 10) {
  const jobs = await db.emailJob.findMany({
    where: { status: "pending", availableAt: { lte: new Date() } },
    orderBy: { createdAt: "asc" },
    take: Math.min(Math.max(limit, 1), 25),
  });
  const results = { sent: 0, skipped: 0, retried: 0, failed: 0 };

  for (const job of jobs) {
    const claimed = await db.emailJob.updateMany({
      where: { id: job.id, status: "pending" },
      data: { status: "processing", attempts: { increment: 1 } },
    });
    if (claimed.count !== 1) continue;

    try {
      const settings = await db.shopSettings.findUnique({ where: { shop: job.shop } });
      if (!settings?.sendingEnabled) {
        await db.emailJob.update({ where: { id: job.id }, data: { status: "skipped", lastError: "Sending disabled for shop." } });
        results.skipped += 1;
        continue;
      }
      const prepared = await prepareEmail(
        job.shop,
        job.topic,
        JSON.parse(job.payload) as Record<string, unknown>,
      );
      if (!prepared) {
        await db.emailJob.update({ where: { id: job.id }, data: { status: "skipped", lastError: null } });
        results.skipped += 1;
        continue;
      }
      const providerMessageId = await sendEmail(prepared);
      await db.emailJob.update({
        where: { id: job.id },
        data: { status: "sent", providerMessageId, sentAt: new Date(), lastError: null },
      });
      results.sent += 1;
    } catch (error) {
      const attempts = job.attempts + 1;
      const exhausted = attempts >= 5;
      const message = error instanceof Error ? error.message : "Unknown email job error";
      await db.emailJob.update({
        where: { id: job.id },
        data: {
          status: exhausted ? "failed" : "pending",
          availableAt: new Date(Date.now() + Math.min(60, 2 ** attempts) * 60_000),
          lastError: message.slice(0, 2000),
        },
      });
      results[exhausted ? "failed" : "retried"] += 1;
    }
  }
  return results;
}
