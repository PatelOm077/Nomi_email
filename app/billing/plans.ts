// Nomi's plans (agreed 2026-09-28). The single source of truth for prices
// and allowances: the pricing page renders from it and
// app/billing/usage.server.ts enforces it. Client-safe — no server imports.
//
// Allowances are per calendar month, except on Free, where they are one-time
// ("lifetime"): Free is a trial of the whole product, not a small monthly
// plan. Emails sent are always monthly.

export const PLAN_IDS = ["free", "starter", "growth", "pro"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

// What's on sale right now (decided 2026-10-01): Free, Starter and Growth.
// Pro stays defined so it can launch later, but it isn't shown or offered.
// Keep in step with the public plans in the Partner Dashboard.
export const OFFERED_PLAN_IDS: readonly PlanId[] = ["free", "starter", "growth"];

/** Free trial on paid plans, set per plan in Shopify App Pricing. */
export const PAID_TRIAL_DAYS = 7;

export const USAGE_METRICS = [
  "brand_build",
  "email_regenerate",
  "regenerate_all",
  "campaign",
  "email_sent",
] as const;
export type UsageMetric = (typeof USAGE_METRICS)[number];

export type Plan = {
  id: PlanId;
  name: string;
  priceUsd: number;
  /** One-time allowances instead of monthly (Free). Emails stay monthly. */
  lifetimeAllowances: boolean;
  /** null means unlimited. */
  limits: Record<UsageMetric, number | null>;
  /**
   * Paid plans keep working past their allowances: extra subscribed contacts
   * are billed per block, extra emails send at no charge (decided
   * 2026-10-01). Free pauses sending when over either.
   */
  emailOverage: boolean;
  /** Email-subscribed customers included. */
  contacts: number;
  blurb: string;
};

export const EXTRA_CONTACTS_BLOCK = 500;
export const EXTRA_CONTACTS_PRICE_USD = 5;

// Add-on prices once a monthly allowance is used up (charged through
// Shopify App Pricing once the app is listed).
export const EXTRA_PRICES_USD: Partial<Record<UsageMetric, number>> = {
  email_regenerate: 1,
  campaign: 1.5,
  regenerate_all: 9,
};

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Free",
    priceUsd: 0,
    lifetimeAllowances: true,
    limits: { brand_build: 1, email_regenerate: 3, regenerate_all: 0, campaign: 3, email_sent: 500 },
    emailOverage: false,
    contacts: 250,
    blurb: "Try the whole product once.",
  },
  starter: {
    id: "starter",
    name: "Starter",
    priceUsd: 29,
    lifetimeAllowances: false,
    limits: { brand_build: null, email_regenerate: 15, regenerate_all: 0, campaign: 10, email_sent: 3_000 },
    emailOverage: true,
    contacts: 1000,
    blurb: "For a store starting to email.",
  },
  growth: {
    id: "growth",
    name: "Growth",
    priceUsd: 79,
    lifetimeAllowances: false,
    limits: { brand_build: null, email_regenerate: 30, regenerate_all: 1, campaign: 20, email_sent: 15_000 },
    emailOverage: true,
    contacts: 5000,
    blurb: "For a store emailing every week.",
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceUsd: 199,
    lifetimeAllowances: false,
    limits: { brand_build: null, email_regenerate: 75, regenerate_all: 3, campaign: 40, email_sent: 50_000 },
    emailOverage: true,
    contacts: 15000,
    blurb: "For high-volume stores.",
  },
};

export function planFor(id: string | null | undefined): Plan {
  return PLANS[(PLAN_IDS as readonly string[]).includes(id ?? "") ? (id as PlanId) : "free"];
}

/**
 * Our plan for a Shopify App Pricing subscription, from its item handles.
 * Plan handles in the Partner Dashboard just need to contain the plan id,
 * e.g. "growth" or "nomi_growth_monthly". The highest plan wins.
 */
export function planIdFromHandles(handles: string[]): PlanId | null {
  const text = handles.join(" ").toLowerCase();
  for (const id of ["pro", "growth", "starter", "free"] as const) {
    if (new RegExp(`(^|[^a-z])${id}([^a-z]|$)`).test(text)) return id;
  }
  return null;
}

export const METRIC_LABELS: Record<UsageMetric, { one: string; many: string }> = {
  brand_build: { one: "Brand Studio build", many: "Brand Studio builds" },
  email_regenerate: { one: "email regenerate", many: "email regenerates" },
  regenerate_all: { one: "Regenerate all", many: "Regenerate alls" },
  campaign: { one: "campaign", many: "campaigns" },
  email_sent: { one: "email", many: "emails" },
};

/** "2026-09" for monthly allowances, "lifetime" for one-time ones. */
export function usagePeriod(plan: Plan, metric: UsageMetric, now = new Date()): string {
  if (plan.lifetimeAllowances && metric !== "email_sent") return "lifetime";
  return now.toISOString().slice(0, 7);
}

/** Extra monthly cost for subscribed contacts past the plan's included amount. */
export function contactOverageUsd(plan: Plan, contacts: number): number {
  if (!plan.emailOverage || contacts <= plan.contacts) return 0;
  return Math.ceil((contacts - plan.contacts) / EXTRA_CONTACTS_BLOCK) * EXTRA_CONTACTS_PRICE_USD;
}
