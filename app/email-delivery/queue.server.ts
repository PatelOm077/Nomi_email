import { Prisma } from "@prisma/client";
import db from "../db.server";
import { attributeOrderConversion } from "./email-stats.server";
import {
  FLOW_STEPS,
  parseFlowSettings,
  passesNewContactRule,
  type SendingFlowId,
} from "./lifecycle-schedule";

type EnqueueInput = {
  webhookId: string;
  shop: string;
  topic: string;
  payload: Record<string, unknown>;
};

type Customerish = {
  id?: unknown;
  created_at?: unknown;
  email_marketing_consent?: { state?: unknown } | null;
} | null | undefined;

const PENDING = { in: ["pending", "processing"] };

function customerGid(id: unknown): string | null {
  if (typeof id === "number" || (typeof id === "string" && /^\d+$/.test(id))) return `gid://shopify/Customer/${id}`;
  return typeof id === "string" && id.startsWith("gid://") ? id : null;
}

// Queues every step of a flow for one trigger, each at its own send time
// (lifecycle-schedule.ts). A step already sent or sending is never reset;
// a still-pending one moves to the new time, so a customer who comes back
// to the same checkout isn't emailed twice.
async function scheduleFlow({
  shop,
  topic,
  payload,
  flowId,
  keyPrefix,
  customerId,
  anchor = Date.now(),
}: {
  shop: string;
  topic: string;
  payload: Record<string, unknown>;
  flowId: SendingFlowId;
  keyPrefix: string;
  customerId: string | null;
  anchor?: number;
}): Promise<"queued" | "duplicate"> {
  let queued = false;
  for (const [index, step] of FLOW_STEPS[flowId].entries()) {
    // Step 1 of a cart keeps the pre-multi-step key so older jobs still match.
    const webhookId = flowId === "cart" && index === 0 ? keyPrefix : `${keyPrefix}:${index + 1}`;
    const existing = await db.emailJob.findUnique({ where: { webhookId }, select: { status: true } });
    if (existing && ["sent", "processing"].includes(existing.status)) {
      if (index === 0) return "duplicate";
      continue;
    }
    const availableAt = new Date(anchor + step.afterMs);
    const data = { payload: JSON.stringify(payload), emailId: step.emailId, customerId, availableAt };
    await db.emailJob.upsert({
      where: { webhookId },
      create: { webhookId, shop, topic, ...data },
      update: { ...data, status: "pending", attempts: 0, lastError: null },
    });
    queued = true;
  }
  return queued ? "queued" : "duplicate";
}

async function cancelCustomerFlows(shop: string, customerId: string | null, emailPrefixes: string[], reason: string) {
  if (!customerId) return;
  await db.emailJob.updateMany({
    where: {
      shop,
      customerId,
      status: PENDING,
      deliveryStartedAt: null,
      OR: emailPrefixes.map((prefix) => ({ emailId: { startsWith: prefix } })),
    },
    data: { status: "skipped", lastError: reason },
  });
}

export async function enqueueEmailJob({
  shop,
  topic,
  payload,
}: EnqueueInput): Promise<"queued" | "duplicate" | "disabled" | "ignored"> {
  // An order stops Abandoned Cart and Still interested? for that customer and
  // restarts their Welcome back countdown. Stops run even if sending was
  // disabled after the jobs were queued, so nothing stale is ever revived.
  if (topic === "ORDERS_CREATE") {
    const customer = payload.customer as Customerish;
    const customerId = customerGid(customer?.id);
    if (typeof payload.checkout_token === "string") {
      await db.emailJob.updateMany({
        where: {
          webhookId: { startsWith: `checkout:${shop}:${payload.checkout_token}` },
          status: PENDING,
          deliveryStartedAt: null,
        },
        data: { status: "skipped", lastError: "Checkout completed." },
      });
    }
    await cancelCustomerFlows(shop, customerId, ["cart-", "interest-", "winback-"], "Customer placed an order.");
    await attributeOrderConversion(shop, payload);

    const settings = await db.shopSettings.findUnique({ where: { shop } });
    const subscribed =
      payload.buyer_accepts_marketing === true || customer?.email_marketing_consent?.state === "subscribed";
    const orderId = payload.admin_graphql_api_id ?? payload.id;
    if (
      !settings?.sendingEnabled ||
      !customerId ||
      !subscribed ||
      (typeof orderId !== "string" && typeof orderId !== "number") ||
      !passesNewContactRule(parseFlowSettings(settings.flowSettings), "winback", customer?.created_at as string)
    ) {
      return "ignored";
    }
    return scheduleFlow({
      shop,
      topic,
      payload: { customer_id: customerId, order_id: String(orderId) },
      flowId: "winback",
      keyPrefix: `winback:${shop}:${orderId}`,
      customerId,
    });
  }

  // Joining the email list starts Still interested?; leaving it stops every
  // marketing email still waiting for that customer.
  if (topic === "CUSTOMERS_CREATE" || topic === "CUSTOMERS_UPDATE") {
    const customerId = customerGid(payload.id);
    const state = (payload.email_marketing_consent as { state?: unknown } | null | undefined)?.state;
    if (state !== "subscribed") {
      await cancelCustomerFlows(shop, customerId, ["cart-", "interest-", "winback-"], "Customer unsubscribed.");
      return "ignored";
    }
    const settings = await db.shopSettings.findUnique({ where: { shop } });
    if (!settings?.sendingEnabled) return "disabled";
    if (
      !customerId ||
      typeof payload.email !== "string" ||
      !passesNewContactRule(parseFlowSettings(settings.flowSettings), "interest", payload.created_at as string)
    ) {
      return "ignored";
    }
    // Once per customer: a later update while still subscribed changes nothing.
    const already = await db.emailJob.findFirst({
      where: { shop, customerId, emailId: { startsWith: "interest-" } },
      select: { id: true },
    });
    if (already) return "duplicate";
    return scheduleFlow({
      shop,
      topic,
      payload: { customer_id: customerId },
      flowId: "interest",
      keyPrefix: `interest:${shop}:${customerId}`,
      customerId,
    });
  }

  const settings = await db.shopSettings.findUnique({ where: { shop } });
  if (!settings?.sendingEnabled) return "disabled";
  const flowSettings = parseFlowSettings(settings.flowSettings);

  if (topic === "CHECKOUTS_UPDATE") {
    const token = payload.token;
    const customer = payload.customer as Customerish;
    const eligible =
      typeof token === "string" &&
      typeof payload.email === "string" &&
      payload.completed_at == null &&
      payload.closed_at == null &&
      payload.buyer_accepts_marketing === true &&
      passesNewContactRule(flowSettings, "cart", customer?.created_at as string);
    if (!eligible) return "ignored";
    return scheduleFlow({
      shop,
      topic,
      payload,
      flowId: "cart",
      keyPrefix: `checkout:${shop}:${token}`,
      customerId: customerGid(customer?.id),
    });
  }

  // Only a delivered order starts the review request, once per order. The
  // new-contact rule needs the order's customer, so the worker checks it.
  if (topic === "FULFILLMENTS_UPDATE") {
    if (String(payload.shipment_status).toLowerCase() !== "delivered") return "ignored";
    const orderId = payload.order_id;
    if (typeof orderId !== "number" && typeof orderId !== "string") return "ignored";
    try {
      await db.emailJob.create({
        data: {
          webhookId: `review:${shop}:${orderId}`,
          shop,
          topic,
          payload: JSON.stringify(payload),
          emailId: FLOW_STEPS.care[0].emailId,
          availableAt: new Date(Date.now() + FLOW_STEPS.care[0].afterMs),
        },
      });
      return "queued";
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return "duplicate";
      throw error;
    }
  }

  return "ignored";
}
