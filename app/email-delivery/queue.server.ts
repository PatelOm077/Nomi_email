import { Prisma } from "@prisma/client";
import db from "../db.server";

type EnqueueInput = {
  webhookId: string;
  shop: string;
  topic: string;
  payload: Record<string, unknown>;
};

// Order confirmation and refund confirmation always duplicate Shopify's
// own native customer email for the same event — there's no store setting
// or API that suppresses the native side (see DECISIONS.md, 2026-08-17).
// These two topics need the narrower sendReceiptEmails opt-in on top of
// the main sendingEnabled switch; every other topic only needs the latter.
const DUPLICATE_RISK_TOPICS = new Set(["ORDERS_CREATE", "REFUNDS_CREATE"]);

export async function enqueueEmailJob({
  webhookId,
  shop,
  topic,
  payload,
}: EnqueueInput): Promise<"queued" | "duplicate" | "disabled" | "ignored"> {
  const settings = await db.shopSettings.findUnique({ where: { shop } });
  if (!settings?.sendingEnabled) return "disabled";

  // Runs regardless of sendReceiptEmails below: a completed order should
  // cancel its pending cart-recovery job whether or not Nomi is also
  // sending its own (duplicate-risk) order-confirmation email for it.
  if (topic === "ORDERS_CREATE" && typeof payload.checkout_token === "string") {
    await db.emailJob.updateMany({
      where: {
        webhookId: `checkout:${shop}:${payload.checkout_token}`,
        status: "pending",
      },
      data: { status: "skipped", lastError: "Checkout completed." },
    });
  }

  if (topic === "CHECKOUTS_UPDATE") {
    const token = payload.token;
    const eligible =
      typeof token === "string" &&
      typeof payload.email === "string" &&
      payload.completed_at == null &&
      payload.closed_at == null &&
      payload.buyer_accepts_marketing === true;
    if (!eligible) return "ignored";

    const checkoutJobId = `checkout:${shop}:${token}`;
    const existing = await db.emailJob.findUnique({
      where: { webhookId: checkoutJobId },
      select: { status: true },
    });
    if (existing?.status === "sent") return "duplicate";

    await db.emailJob.upsert({
      where: { webhookId: checkoutJobId },
      create: {
        webhookId: checkoutJobId,
        shop,
        topic,
        payload: JSON.stringify(payload),
        availableAt: new Date(Date.now() + 60 * 60_000),
      },
      update: {
        payload: JSON.stringify(payload),
        status: "pending",
        attempts: 0,
        lastError: null,
        availableAt: new Date(Date.now() + 60 * 60_000),
      },
    });
    return "queued";
  }

  if (DUPLICATE_RISK_TOPICS.has(topic) && !settings.sendReceiptEmails) {
    return "disabled";
  }

  try {
    await db.emailJob.create({
      data: {
        webhookId,
        shop,
        topic,
        payload: JSON.stringify(payload),
      },
    });
    return "queued";
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return "duplicate";
    }
    throw error;
  }
}
