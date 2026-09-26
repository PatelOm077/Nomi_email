import { Prisma } from "@prisma/client";
import db from "../db.server";

type EnqueueInput = {
  webhookId: string;
  shop: string;
  topic: string;
  payload: Record<string, unknown>;
};

// Only the five approved lifecycle flows belong to Nomi. The delivery
// worker currently receives Shopify events for Abandoned Cart and the
// delivered-order step of How Was It?.
const SENDABLE_TOPICS = new Set(["CHECKOUTS_UPDATE", "FULFILLMENTS_UPDATE"]);

export async function enqueueEmailJob({
  webhookId,
  shop,
  topic,
  payload,
}: EnqueueInput): Promise<"queued" | "duplicate" | "disabled" | "ignored"> {
  // orders/create is only a stop signal for Abandoned Cart. It never creates
  // a customer-email job of its own. Process it even if sending was disabled
  // after the recovery job was queued, so a completed checkout can never be
  // revived by a later settings change.
  if (topic === "ORDERS_CREATE") {
    if (typeof payload.checkout_token === "string") {
      await db.emailJob.updateMany({
        where: {
          webhookId: `checkout:${shop}:${payload.checkout_token}`,
          status: "pending",
        },
        data: { status: "skipped", lastError: "Checkout completed." },
      });
    }
    return "ignored";
  }

  const settings = await db.shopSettings.findUnique({ where: { shop } });
  if (!settings?.sendingEnabled) return "disabled";

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

  if (!SENDABLE_TOPICS.has(topic)) return "ignored";

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
