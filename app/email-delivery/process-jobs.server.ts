import db from "../db.server";
import { unauthenticated } from "../shopify.server";
import { generateReviewRequestEmail } from "../email-engine/generate-review-request-email";
import { generateAbandonedCartEmail } from "../email-engine/generate-abandoned-cart-email";
import { optimizeEmailImageUrl } from "../dashboard/email-image-url.server";
import { EMAIL_GENERATION_PAUSED } from "../email-engine/generation-status";
import { EMAIL_LANGUAGES, EMAIL_TONES, type EmailBrandIdentity, type EmailLanguage, type EmailTone } from "../email-engine/types";
import { sendEmail, type SendEmailInput } from "./provider.server";
import { getEmailDeliveryConfig } from "./config.server";
import { loadApprovedBrandIdentity, loadApprovedPersonalEmail, type ApprovedPersonalEmail } from "./approved-brand.server";
import { fillPersonalSlots } from "../email-engine/personal-slots";
import { checkAllowance, recordUsage } from "../billing/usage.server";
import type { GenerateEmailOptions } from "../email-engine/generate-email";
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

// The approved Brand Studio email is written in the store's language, so it
// is only sent pre-built to customers who read that language. Everyone else
// (and any shop whose approved email predates the slot markup) gets a
// per-send generated email; the brand is already designed, so low effort.
const FALLBACK_GENERATION: GenerateEmailOptions = { effort: "low" };

function isStoreLanguage(language: EmailLanguage, storeLanguage: string | null | undefined): boolean {
  return language === resolveLanguage(storeLanguage ?? "en", "en");
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
  approved: ApprovedPersonalEmail | null,
  cached?: PreparedEmail,
): Promise<PreparedEmail | null> {
  const token =typeof payload.token === "string" ? payload.token : null;
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
  if (cached) return cached;

  const settings = await db.shopSettings.findUnique({ where: { shop } });
  const language = resolveLanguage(payload.customer_locale, settings?.language ?? "en");
  const tone = resolveTone(settings?.tone);
  const lineItems = await Promise.all(checkout.lineItems.edges.map(async ({ node }) => ({
    title: node.title ?? "Item",
    quantity: node.quantity,
    price: formatMoney(node.originalTotalPriceSet.shopMoney, language),
    imageUrl: await optimizeEmailImageUrl(node.image?.url),
  })));
  const idempotencyKey = `cart:${shop}:${token}`;

  const prebuilt = approved && isStoreLanguage(language, settings?.language)
    ? fillPersonalSlots(approved.html, {
        actionUrl: checkout.abandonedCheckoutUrl,
        items: lineItems.map((item) => ({ ...item, url: null })),
      })
    : null;
  if (prebuilt) return { to: email, subject: approved!.subject, html: prebuilt, idempotencyKey };

  const html = await generateAbandonedCartEmail({
    shopName: data.shop.name,
    language,
    tone,
    ...(brandIdentity ? { brandIdentity } : {}),
    customerFirstName: checkout.customer?.firstName ?? null,
    recoveryUrl: checkout.abandonedCheckoutUrl,
    total: formatMoney(checkout.totalPriceSet.shopMoney, language),
    lineItems,
  }, FALLBACK_GENERATION);
  return {
    to: email,
    subject: SUBJECTS[language].cart,
    html,
    idempotencyKey,
  };
}

async function prepareEmail(
  shop: string,
  topic: string,
  payload: Record<string, unknown>,
  brandIdentity: EmailBrandIdentity | undefined,
  approved: ApprovedPersonalEmail | null,
  cached?: PreparedEmail,
): Promise<PreparedEmail | null> {
  if (topic === "CHECKOUTS_UPDATE") {
    return prepareAbandonedCart(shop, payload, brandIdentity, approved, cached);
  }

  const orderId = orderIdFromPayload(payload);
  if (!orderId) throw new Error(`Webhook ${topic} did not include an order ID.`);

  const { admin } = await unauthenticated.admin(shop);
  const response = await admin.graphql(EMAIL_ORDER_QUERY, { variables: { id: orderId } });
  const { data } = (await response.json()) as EmailOrderResponse;
  const order = data.order;
  if (!order?.email) throw new Error(`Order ${orderId} has no customer email.`);
  if (await isSuppressed({ shop, email: order.email })) return null;
  if (cached) return cached.to === order.email ? cached : null;

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
    const reviewUrl = order.lineItems.edges[0]?.node.product?.onlineStoreUrl ?? null;
    const lineItems = await Promise.all(order.lineItems.edges.map(async ({ node }) => ({
      title: node.title,
      quantity: node.quantity,
      imageUrl: await optimizeEmailImageUrl(node.image?.url),
      url: node.product?.onlineStoreUrl ?? null,
    })));
    const idempotencyKey = `review:${shop}:${order.id}`;

    const actionUrl = reviewUrl ?? approved?.storefrontUrl ?? null;
    const prebuilt = approved && actionUrl && isStoreLanguage(language, settings?.language)
      ? fillPersonalSlots(approved.html, {
          actionUrl,
          items: lineItems.map((item) => ({ ...item, price: null })),
        })
      : null;
    if (prebuilt) return { to: order.email, subject: approved!.subject, html: prebuilt, idempotencyKey };

    const html = await generateReviewRequestEmail({
      ...common,
      reviewUrl,
      lineItems: lineItems.map(({ title, quantity, imageUrl }) => ({ title, quantity, imageUrl })),
    }, FALLBACK_GENERATION);
    return { to: order.email, subject: subject("review", language, order.name), html, idempotencyKey };
  }

  throw new Error(`Unsupported email webhook topic: ${topic}`);
}

export async function processPendingEmailJobs(limit = 10) {
  // Leave pending work untouched while generation is paused so no Claude call
  // or delivery attempt starts, and the queue can resume cleanly later.
  if (EMAIL_GENERATION_PAUSED) {
    return { sent: 0, skipped: 0, retried: 0, failed: 0 };
  }

  // An active worker refreshes updatedAt. Only reclaim abandoned leases.
  // Legacy interrupted jobs have no frozen provider body: require review.
  const stale = new Date(Date.now() - 15 * 60_000);
  await db.emailJob.updateMany({
    where: { status: "processing", updatedAt: { lt: stale }, deliveryStartedAt: null },
    data: { status: "failed", lastError: "Interrupted before durable delivery tracking; review before retrying." },
  });
  await db.emailJob.updateMany({
    where: { status: "processing", updatedAt: { lt: stale }, deliveryStartedAt: { not: null }, attempts: { lt: 5 } },
    data: { status: "pending", availableAt: new Date(), lastError: "Recovered interrupted worker." },
  });
  await db.emailJob.updateMany({
    where: { status: "processing", updatedAt: { lt: stale }, attempts: { gte: 5 } },
    data: { status: "failed", lastError: "Interrupted worker exhausted retries; review provider delivery status." },
  });

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
    const heartbeat = setInterval(() => {
      void db.emailJob.updateMany({ where: { id: job.id, status: "processing" }, data: { updatedAt: new Date() } }).catch(() => {});
    }, 30_000);
    heartbeat.unref();

    try {
      if (job.deliveryStartedAt && Date.now() - job.deliveryStartedAt.getTime() >= 23 * 60 * 60_000) {
        throw new Error("Delivery outcome uncertain beyond provider idempotency window; manual review required.");
      }
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
      // Checked before any generation cost. Paid plans always pass (extra
      // emails are billed per block); Free stops at its monthly emails. A job
      // already handed to the provider is always finished.
      if (!job.deliveryStartedAt) {
        const allowance = await checkAllowance(job.shop, "email_sent");
        if (!allowance.allowed) {
          await db.emailJob.update({
            where: { id: job.id },
            data: { status: "skipped", lastError: allowance.message },
          });
          results.skipped += 1;
          continue;
        }
      }
      const approvedEmail = job.preparedEmail ? null : await loadApprovedPersonalEmail(job.shop, job.topic);
      const prepared = await prepareEmail(
        job.shop,
        job.topic,
        JSON.parse(job.payload) as Record<string, unknown>,
        brandIdentity,
        approvedEmail,
        job.preparedEmail ? JSON.parse(job.preparedEmail) as SendEmailInput : undefined,
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
      const config = getEmailDeliveryConfig();
      const delivery: SendEmailInput = job.preparedEmail ? JSON.parse(job.preparedEmail) as SendEmailInput : {
        ...prepared,
        from: `${config.fromName} <${config.fromEmail}>`,
        html: withComplianceFooter(prepared.html, { postalLine: footer.line, unsubscribeUrl: unsubscribeLink }),
        headers: listUnsubscribeHeaders(unsubscribeLink),
      };
      const ready = await db.emailJob.updateMany({
        where: { id: job.id, status: "processing" },
        data: { preparedEmail: JSON.stringify(delivery), deliveryStartedAt: job.deliveryStartedAt ?? new Date() },
      });
      if (ready.count !== 1 || await isSuppressed({ shop: job.shop, email: delivery.to })) continue;
      const providerMessageId = await sendEmail(delivery);
      await db.emailJob.update({
        where: { id: job.id },
        data: { status: "sent", providerMessageId, sentAt: new Date(), lastError: null, recipient: delivery.to.toLowerCase() },
      });
      await recordUsage(job.shop, "email_sent").catch((error) => console.error("Email usage count failed:", error));
      results.sent += 1;
    } catch (error) {
      const attempts = job.attempts + 1;
      const exhausted = attempts >= 5 || Boolean(job.deliveryStartedAt && Date.now() - job.deliveryStartedAt.getTime() >= 23 * 60 * 60_000);
      const message = error instanceof Error ? error.message : "Unknown email job error";
      await db.emailJob.updateMany({
        where: { id: job.id, status: "processing" },
        data: {
          status: exhausted ? "failed" : "pending",
          availableAt: new Date(Date.now() + Math.min(60, 2 ** attempts) * 60_000),
          lastError: message.slice(0, 2000),
        },
      });
      results[exhausted ? "failed" : "retried"] += 1;
    } finally {
      clearInterval(heartbeat);
    }
  }
  return results;
}
