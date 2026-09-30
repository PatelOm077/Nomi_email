// When each lifecycle email sends, measured from the event that starts its
// flow. The Flow Editor's timing labels (dashboard/lifecycle-flow-catalog.ts)
// describe exactly these numbers; change both together. Client-safe.
import type { LifecycleEmailId } from "../email-engine/types";

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

export type SendingFlowId = "cart" | "interest" | "care" | "winback";

type Step = { emailId: LifecycleEmailId; afterMs: number };

export const FLOW_STEPS: Record<SendingFlowId, Step[]> = {
  // From the checkout being left: 1 hour, then 24 and 48 hours after that.
  cart: [
    { emailId: "cart-1", afterMs: 1 * HOUR },
    { emailId: "cart-2", afterMs: 25 * HOUR },
    { emailId: "cart-3", afterMs: 73 * HOUR },
  ],
  // From joining the email list: 7 days, then 3 days later, if no order yet.
  interest: [
    { emailId: "interest-1", afterMs: 7 * DAY },
    { emailId: "interest-2", afterMs: 10 * DAY },
  ],
  // From the order being marked delivered.
  care: [{ emailId: "review-request", afterMs: 7 * DAY }],
  // From the customer's latest order: 30 days, then 14 and 30 days after that.
  winback: [
    { emailId: "winback-1", afterMs: 30 * DAY },
    { emailId: "winback-2", afterMs: 44 * DAY },
    { emailId: "winback-3", afterMs: 74 * DAY },
  ],
};

/** Flows Nomi actually sends. Welcome and the Thank-you email aren't wired yet. */
export const SENDING_FLOWS = new Set<string>(Object.keys(FLOW_STEPS));

export function flowOfEmail(emailId: string | null | undefined): SendingFlowId | null {
  for (const [flowId, steps] of Object.entries(FLOW_STEPS) as [SendingFlowId, Step[]][]) {
    if (steps.some((step) => step.emailId === emailId)) return flowId;
  }
  return null;
}

// Jobs queued before multi-step flows carry no emailId; their topic says which.
export function emailIdForJob(job: { emailId?: string | null; topic: string }): LifecycleEmailId | null {
  if (job.emailId) return job.emailId as LifecycleEmailId;
  if (job.topic === "CHECKOUTS_UPDATE") return "cart-1";
  if (job.topic === "FULFILLMENTS_UPDATE") return "review-request";
  return null;
}

export type FlowSettings = Partial<Record<SendingFlowId, { onlyNewSince?: string }>>;

export function parseFlowSettings(value: string | null | undefined): FlowSettings {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" ? (parsed as FlowSettings) : {};
  } catch {
    return {};
  }
}

/**
 * "Only send to new contacts": when on for a flow, only customers created
 * after it was switched on get that flow. An unknown creation date fails
 * closed, since the merchant asked to leave existing customers alone.
 */
export function passesNewContactRule(
  settings: FlowSettings,
  flowId: SendingFlowId,
  customerCreatedAt: string | Date | null | undefined,
): boolean {
  const since = settings[flowId]?.onlyNewSince;
  if (!since) return true;
  if (!customerCreatedAt) return false;
  return new Date(customerCreatedAt).getTime() >= new Date(since).getTime();
}
