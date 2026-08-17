import { Prisma } from "@prisma/client";
import db from "../db.server";

type EnqueueInput = {
  webhookId: string;
  shop: string;
  topic: string;
  payload: Record<string, unknown>;
};

export async function enqueueEmailJob({
  webhookId,
  shop,
  topic,
  payload,
}: EnqueueInput): Promise<"queued" | "duplicate" | "disabled" | "ignored"> {
  const settings = await db.shopSettings.findUnique({ where: { shop } });
  if (!settings?.sendingEnabled) return "disabled";

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
