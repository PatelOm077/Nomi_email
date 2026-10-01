// Plan limits, enforced before any AI spend. Actions call checkAllowance()
// before starting and recordUsage() after they succeed, so a failed build or
// a discarded error never uses up an allowance.
import db from "../db.server";
import {
  METRIC_LABELS,
  planFor,
  USAGE_METRICS,
  usagePeriod,
  type Plan,
  type UsageMetric,
} from "./plans";

export type Allowance = {
  plan: Plan;
  metric: UsageMetric;
  used: number;
  limit: number | null;
  allowed: boolean;
  /** Merchant-facing reason when not allowed. */
  message: string | null;
};

export async function shopPlan(shop: string): Promise<Plan> {
  const settings = await db.shopSettings.findUnique({ where: { shop }, select: { plan: true } });
  return planFor(settings?.plan);
}

async function usedCount(shop: string, period: string, metric: UsageMetric): Promise<number> {
  const row = await db.usageCounter.findUnique({
    where: { shop_period_metric: { shop, period, metric } },
  });
  return row?.count ?? 0;
}

function limitMessage(plan: Plan, metric: UsageMetric, limit: number): string {
  const label = METRIC_LABELS[metric];
  if (limit === 0) {
    return `${label.many[0].toUpperCase()}${label.many.slice(1)} aren't included in the ${plan.name} plan. Upgrade in Plan & billing to use them.`;
  }
  const noun = limit === 1 ? label.one : label.many;
  return plan.lifetimeAllowances && metric !== "email_sent"
    ? `You've used the ${limit} ${noun} included in the ${plan.name} plan. Upgrade in Plan & billing to keep going.`
    : `You've used the ${limit} ${noun} included in your ${plan.name} plan this month. Upgrade in Plan & billing, or they reset on the 1st.`;
}

export async function checkAllowance(shop: string, metric: UsageMetric, amount = 1): Promise<Allowance> {
  const plan = await shopPlan(shop);
  if (metric === "email_sent" && !plan.emailOverage) {
    // Free includes a set number of subscribed contacts; paid plans keep
    // sending past theirs (extra contacts are billed per block).
    const settings = await db.shopSettings.findUnique({ where: { shop }, select: { subscribedContacts: true } });
    const contacts = settings?.subscribedContacts ?? 0;
    if (contacts > plan.contacts) {
      const used = await usedCount(shop, usagePeriod(plan, metric), metric);
      return {
        plan,
        metric,
        used,
        limit: plan.limits[metric],
        allowed: false,
        message: `Your store has ${contacts.toLocaleString("en-US")} subscribed contacts, over the ${plan.contacts.toLocaleString("en-US")} included in the ${plan.name} plan. Upgrade in Plan & billing to keep sending.`,
      };
    }
  }
  const limit = plan.limits[metric];
  const used = await usedCount(shop, usagePeriod(plan, metric), metric);
  // Paid plans keep sending past their included emails, at no extra charge.
  const allowed =
    limit === null || used + amount <= limit || (metric === "email_sent" && plan.emailOverage);
  return {
    plan,
    metric,
    used,
    limit,
    allowed,
    message: allowed || limit === null ? null : limitMessage(plan, metric, limit),
  };
}

export async function recordUsage(shop: string, metric: UsageMetric, amount = 1): Promise<void> {
  const plan = await shopPlan(shop);
  const period = usagePeriod(plan, metric);
  await db.usageCounter.upsert({
    where: { shop_period_metric: { shop, period, metric } },
    create: { shop, period, metric, count: amount },
    update: { count: { increment: amount } },
  });
}

/** Every metric's use against the current plan, for the pricing page. */
export async function usageSummary(shop: string) {
  const plan = await shopPlan(shop);
  const rows = await Promise.all(
    USAGE_METRICS.map(async (metric) => ({
      metric,
      used: await usedCount(shop, usagePeriod(plan, metric), metric),
      limit: plan.limits[metric],
      lifetime: usagePeriod(plan, metric) === "lifetime",
    })),
  );
  const settings = await db.shopSettings.findUnique({ where: { shop }, select: { subscribedContacts: true } });
  return { plan, rows, contacts: settings?.subscribedContacts ?? null };
}
