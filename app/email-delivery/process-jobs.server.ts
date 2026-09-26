import db from "../db.server";
import { unauthenticated } from "../shopify.server";
import { generateReviewRequestEmail } from "../email-engine/generate-review-request-email";
import { generateAbandonedCartEmail } from "../email-engine/generate-abandoned-cart-email";
import { optimizeEmailImageUrl } from "../dashboard/email-image-url.server";
import { EMAIL_GENERATION_PAUSED } from "../email-engine/generation-status";
import { EMAIL_LANGUAGES, EMAIL_TONES, type EmailBrandIdentity, type EmailLanguage, type EmailTone } from "../email-engine/types";
import { sendEmail } from "./provider.server";
import { loadApprovedBrandIdentity } from "./approved-brand.server";
import { isSuppressed, listUnsubscribeHeaders, unsubscribeUrl } from "./unsubscribe.server";
import { withComplianceFooter } from "../email-engine/compliance-footer";
import { loadShopFooterAddress, resolveSenderFooter } from "../dashboard/sender-footer.server";

const SENDABLE_TOPICS = new Set(["CHECKOUTS_UPDATE", "FULFILLMENTS_UPDATE"]);

const EMAIL_ORDER_QUERY = `#graphql
  query EmailOrder($id: ID!) {
    shop { name }
    order(id: $id) {
      id
      name
      email
      customer { firstName }
      lineItems(first: 50) {
        edges {
          node {
            title
            quantity
            image { url }
            product { onlineStoreUrl }
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
  lineItems: {
    edges: {
      node: {
        title: string;
        quantity: number;
        image: { url: string } | null;
        product: { onlineStoreUrl: string | null } | null;
      };
    }[];
  };
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

const SUBJECTS: Record<EmailLanguage, Record<"review" | "cart", string>> = {
  en: { review: "How was your order?", cart: "You left something behind" },
  es: { review: "¿Qué te pareció tu pedido?", cart: "Dejaste algo pendiente" },
  de: { review: "Wie war Ihre Bestellung?", cart: "Da ist noch etwas in Ihrem Warenkorb" },
  fr: { review: "Que pensez-vous de votre commande ?", cart: "Vous avez laissé quelque chose" },
  pt: { review: "O que achou do seu pedido?", cart: "Você deixou algo no carrinho" },
  it: { review: "Com'è andato il tuo ordine?", cart: "Hai lasciato qualcosa nel carrello" },
  ja: { review: "ご注文はいかがでしたか？", cart: "カートに商品が残っています" },
  nl: { review: "Hoe was je bestelling?", cart: "Je hebt iets laten liggen" },
  "zh-CN": { review: "您对订单满意吗？", cart: "您的购物车中还有商品" },
  ko: { review: "주문하신 상품은 어떠셨나요?", cart: "장바구니에 상품이 남아 있습니다" },
};

function resolveLanguage(value: unknown, fallback: string): EmailLanguage {
  const requested = typeof value === "string" ? value : fallback;
  const exact = EMAIL_LANGUAGES.find(({ code }) => code === requested)?.code;
  if (exact) return exact;
  const prefix = requested.toLowerCase().split(/[-_]/)[0];
  return EMAIL_LANGUAGES.find(({ code }) => code.toLowerCase().split("-")[0] === prefix)?.code ?? "en";
}

function resolveTone(value: string | undefined): EmailTone {
  return EMAIL_TONES.some(({ code }) => code === value) ? (value as EmailTone) : "warm-plain";
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

function subject(kind: keyof (typeof SUBJECTS)["en"], language: EmailLanguage, orderNumber: string) {
  return `${SUBJECTS[language][kind]} — ${orderNumber}`;
}

async function prepareAbandonedCart(
  shop: string,
  payload: Record<string, unknown>,
  brandIdentity: EmailBrandIdentity | undefined,
): Promise<PreparedEmail | null> {
  const token = typeof payload.token === "string" ? payload.token : null;
  const email = typeof payload.email === "string" ? payload.email : null;
  if (!token || !email || payload.buyer_accepts_marketing !== true) return null;
  if (await isSuppressed({ shop, email })) return null;

  const { admin } = await unauthenticated.admin(shop);
  const response = await admin.graphql(ABANDONED_CHECKOUT_QUERY);
  const { data } = (await response.json()) as AbandonedCheckoutResponse;
  const checkout = data.abandonedCheckouts.edges.find(({ node }) =>
    node.abandonedCheckoutUrl.includes(token),
  )?.node;
  if (!checkout) return null;

  const settings = await db.shopSettings.findUnique({ where: { shop } });
  const language = resolveLanguage(payload.customer_locale, settings?.language ?? "en");
  const tone = resolveTone(settings?.tone);
  const html = await generateAbandonedCartEmail({
    shopName: data.shop.name,
    language,
    tone,
    ...(brandIdentity ? { brandIdentity } : {}),
    customerFirstName: checkout.customer?.firstName ?? null,
    recoveryUrl: checkout.abandonedCheckoutUrl,
    total: formatMoney(checkout.totalPriceSet.shopMoney, language),
    lineItems: await Promise.all(checkout.lineItems.edges.map(async ({ node }) => ({
      title: node.title ?? "Item",
      quantity: node.quantity,
      price: formatMoney(node.originalTotalPriceSet.shopMoney, language),
      imageUrl: await optimizeEmailImageUrl(node.image?.url),
    }))),
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
  brandIdentity: EmailBrandIdentity | undefined,
): Promise<PreparedEmail | null> {
  if (topic === "CHECKOUTS_UPDATE") {
    return prepareAbandonedCart(shop, payload, brandIdentity);
  }

  const orderId = orderIdFromPayload(payload);
  if (!orderId) throw new Error(`Webhook ${topic} did not include an order ID.`);

  const { admin } = await unauthenticated.admin(shop);
  const response = await admin.graphql(EMAIL_ORDER_QUERY, { variables: { id: orderId } });
  const { data } = (await response.json()) as EmailOrderResponse;
  const order = data.order;
  if (!order?.email) throw new Error(`Order ${orderId} has no customer email.`);
  if (await isSuppressed({ shop, email: order.email })) return null;

  const settings = await db.shopSettings.findUnique({ where: { shop } });
  const language = resolveLanguage(payload.customer_locale, settings?.language ?? "en");
  const tone = resolveTone(settings?.tone);
  const common = {
    shopName: data.shop.name,
    language,
    tone,
    ...(brandIdentity ? { brandIdentity } : {}),
    customerFirstName: order.customer?.firstName ?? null,
    orderNumber: order.name,
  };

  if (topic === "FULFILLMENTS_UPDATE") {
    if (String(payload.shipment_status).toLowerCase() !== "delivered") return null;
    const html = await generateReviewRequestEmail({
      ...common,
      reviewUrl: order.lineItems.edges[0]?.node.product?.onlineStoreUrl ?? null,
      lineItems: await Promise.all(order.lineItems.edges.map(async ({ node }) => ({
        title: node.title,
        quantity: node.quantity,
        imageUrl: await optimizeEmailImageUrl(node.image?.url),
      }))),
    });
    return { to: order.email, subject: subject("review", language, order.name), html, idempotencyKey: `review:${shop}:${order.id}` };
  }

  throw new Error(`Unsupported email webhook topic: ${topic}`);
}

export async function processPendingEmailJobs(limit = 10) {
  // Leave pending work untouched while generation is paused so no Claude call
  // or delivery attempt starts, and the queue can resume cleanly later.
  if (EMAIL_GENERATION_PAUSED) {
    return { sent: 0, skipped: 0, retried: 0, failed: 0 };
  }

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
      if (!SENDABLE_TOPICS.has(job.topic)) {
        await db.emailJob.update({
          where: { id: job.id },
          data: { status: "skipped", lastError: "Email type is no longer supported." },
        });
        results.skipped += 1;
        continue;
      }
      const settings = await db.shopSettings.findUnique({ where: { shop: job.shop } });
      if (!settings?.sendingEnabled) {
        await db.emailJob.update({ where: { id: job.id }, data: { status: "skipped", lastError: "Sending disabled for shop." } });
        results.skipped += 1;
        continue;
      }
      const brandIdentity = await loadApprovedBrandIdentity(job.shop, job.topic);
      if (brandIdentity === null) {
        await db.emailJob.update({
          where: { id: job.id },
          data: {
            status: "skipped",
            lastError: "Brand Studio evidence changed or predates verification. Rebuild the approved email system before sending.",
          },
        });
        results.skipped += 1;
        continue;
      }
      const prepared = await prepareEmail(
        job.shop,
        job.topic,
        JSON.parse(job.payload) as Record<string, unknown>,
        brandIdentity,
      );
      if (!prepared) {
        await db.emailJob.update({ where: { id: job.id }, data: { status: "skipped", lastError: null } });
        results.skipped += 1;
        continue;
      }
      // Every marketing email carries the business address and a working
      // unsubscribe link (+ RFC 8058 headers). Without a complete address
      // the email isn't legal to send, so the job waits for Sender info.
      const { admin } = await unauthenticated.admin(job.shop);
      const footer = resolveSenderFooter(settings, await loadShopFooterAddress(admin));
      if (!footer.complete) {
        await db.emailJob.update({
          where: { id: job.id },
          data: { status: "skipped", lastError: "Add a complete business address in Sender info before sending." },
        });
        results.skipped += 1;
        continue;
      }
      const unsubscribeLink = unsubscribeUrl({ shop: job.shop, email: prepared.to });
      const providerMessageId = await sendEmail({
        ...prepared,
        html: withComplianceFooter(prepared.html, { postalLine: footer.line, unsubscribeUrl: unsubscribeLink }),
        headers: listUnsubscribeHeaders(unsubscribeLink),
      });
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
