import type { CSSProperties, ReactNode } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  EXTRA_EMAILS_BLOCK,
  EXTRA_EMAILS_PRICE_USD,
  EXTRA_PRICES_USD,
  METRIC_LABELS,
  PLAN_IDS,
  PLANS,
  emailOverageUsd,
  type Plan,
  type PlanId,
  type UsageMetric,
} from "../billing/plans";
import { usageSummary } from "../billing/usage.server";

// Plan & billing. Plans and allowances come from app/billing/plans.ts; usage
// from app/billing/usage.server.ts. Charging goes through Shopify App
// Pricing, which needs the app listed publicly — until then a development
// store can switch plans freely (Shopify also makes every plan free on dev
// stores), and a live store sees that billing opens with the listing.
// Layout-critical styles are inline on purpose — new classes in nomi.css have
// failed to apply inside the embedded admin iframe before (see CAMPAIGNS.md).

async function isDevelopmentStore(admin: { graphql: (query: string) => Promise<Response> }) {
  try {
    const response = await admin.graphql(`#graphql
      query PricingShopPlan { shop { plan { partnerDevelopment } } }
    `);
    const { data } = (await response.json()) as { data?: { shop?: { plan?: { partnerDevelopment?: boolean } } } };
    return Boolean(data?.shop?.plan?.partnerDevelopment);
  } catch {
    return false;
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const [summary, devStore] = await Promise.all([usageSummary(session.shop), isDevelopmentStore(admin)]);
  return { planId: summary.plan.id, rows: summary.rows, devStore };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const planId = formData.get("plan");
  if (typeof planId !== "string" || !(PLAN_IDS as readonly string[]).includes(planId)) {
    return { ok: false, message: "Choose a valid plan." };
  }
  if (!(await isDevelopmentStore(admin))) {
    return {
      ok: false,
      message: "Paid plans open once Nomi is listed on the Shopify App Store. Nothing has been charged.",
    };
  }
  await db.shopSettings.upsert({
    where: { shop: session.shop },
    create: { shop: session.shop, plan: planId },
    update: { plan: planId },
  });
  return { ok: true, message: `You're on ${PLANS[planId as PlanId].name}. Development stores switch plans at no charge.` };
};

const INK = "#201e1d";
const CYAN = "#0088b0";
const MAGENTA = "#d6006c";
const N100 = "#f3f2f2";
const N200 = "#eae7e7";
const N500 = "#9b9797";
const N600 = "#7d7979";
const N700 = "#605d5d";
const SANS = "'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif";
const MONO = "'IBM Plex Mono', ui-monospace, monospace";
const SERIF = "'Source Serif 4', Georgia, serif";

const CSS = `
.nomi-pricing-back:hover{color:${INK}!important}
.nomi-pricing-cta:hover:not(:disabled){background:#1186ac!important}
.nomi-pricing-cta:active:not(:disabled){background:#006786!important}
.nomi-pricing-cta:focus-visible,.nomi-pricing-back:focus-visible{outline:2px solid ${CYAN};outline-offset:2px}
`;

const KICKER: CSSProperties = { fontFamily: MONO, fontSize: 11, letterSpacing: "0.1em", color: N500 };
const CARD: CSSProperties = {
  background: "#fff", border: `1px solid ${N200}`, borderRadius: 4, boxShadow: "0 1px 2px rgba(45,43,43,0.14)",
  boxSizing: "border-box",
};

const fmt = (n: number) => n.toLocaleString("en-US");
const money = (usd: number) => (Number.isInteger(usd) ? `$${usd}` : `$${usd.toFixed(2)}`);

function allowanceLine(plan: Plan, metric: UsageMetric): ReactNode {
  const limit = plan.limits[metric];
  const label = METRIC_LABELS[metric];
  const per = plan.lifetimeAllowances && metric !== "email_sent" ? " total" : " / month";
  if (metric === "brand_build") {
    return limit === null ? "Brand Studio build included" : <><strong>{limit}</strong> Brand Studio build, one time</>;
  }
  if (limit === null) return <>Unlimited {label.many}</>;
  if (limit === 0) {
    const extra = EXTRA_PRICES_USD[metric];
    return <span style={{ color: N600 }}>{label.many[0].toUpperCase() + label.many.slice(1)}: {extra && !plan.lifetimeAllowances ? `${money(extra)} each` : "not included"}</span>;
  }
  const noun = metric === "email_sent" ? "emails sent" : limit === 1 ? label.one : label.many;
  return <><strong>{fmt(limit)}</strong> {noun}{per}</>;
}

const LINE_METRICS: UsageMetric[] = ["email_sent", "campaign", "email_regenerate", "regenerate_all", "brand_build"];

function Check() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke={CYAN} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: "none", marginTop: 2 }}>
      <path d="M4 10.5 L8 14 L16 6" />
    </svg>
  );
}

function PlanCard({ plan, current, devStore }: { plan: Plan; current: boolean; devStore: boolean }) {
  const fetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== "idle";
  return (
    <section
      aria-label={`${plan.name} plan`}
      style={{ ...CARD, padding: 22, display: "flex", flexDirection: "column", gap: 16, borderColor: current ? CYAN : N200, boxShadow: current ? `0 0 0 1px ${CYAN}` : CARD.boxShadow }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <h2 style={{ margin: 0, font: `600 20px ${SERIF}` }}>{plan.name}</h2>
        {current ? <span style={{ ...KICKER, color: CYAN }}>CURRENT</span> : null}
      </div>
      <div>
        <span style={{ font: `600 36px/1 ${SERIF}`, letterSpacing: "-0.02em" }}>{money(plan.priceUsd)}</span>
        <span style={{ font: `400 14px ${SANS}`, color: N600, marginLeft: 4 }}>{plan.priceUsd ? "/mo" : "forever"}</span>
        <p style={{ margin: "8px 0 0", font: `400 13px/1.45 ${SANS}`, color: N700 }}>{plan.blurb}</p>
      </div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10, font: `400 13.5px/1.4 ${SANS}`, flex: 1 }}>
        {LINE_METRICS.map((metric) => (
          <li key={metric} style={{ display: "flex", gap: 9 }}><Check /><span>{allowanceLine(plan, metric)}</span></li>
        ))}
        {plan.emailOverage ? (
          <li style={{ display: "flex", gap: 9 }}><Check /><span>More emails: {money(EXTRA_EMAILS_PRICE_USD)}/mo per {fmt(EXTRA_EMAILS_BLOCK)}</span></li>
        ) : null}
      </ul>
      <fetcher.Form method="post">
        <input type="hidden" name="plan" value={plan.id} />
        <button
          type="submit"
          className="nomi-pricing-cta"
          disabled={current || busy}
          style={{
            width: "100%", minHeight: 44, border: 0, borderRadius: 4, cursor: current ? "default" : "pointer",
            font: `600 14px ${SANS}`, transition: "background .16s ease",
            background: current ? N100 : CYAN, color: current ? N700 : "#fff",
          }}
        >
          {current ? "Your plan" : busy ? "Switching…" : devStore ? `Switch to ${plan.name}` : `Choose ${plan.name}`}
        </button>
      </fetcher.Form>
      {fetcher.data?.message ? (
        <p role="status" style={{ margin: 0, font: `400 12.5px/1.45 ${SANS}`, color: fetcher.data.ok ? N700 : MAGENTA }}>{fetcher.data.message}</p>
      ) : null}
    </section>
  );
}

export default function PricingPage() {
  const { planId, rows, devStore } = useLoaderData<typeof loader>();
  const plan = PLANS[planId as PlanId];
  const emailsSent = rows.find(({ metric }) => metric === "email_sent")?.used ?? 0;
  const overage = emailOverageUsd(plan, emailsSent);

  return (
    <main style={{ minHeight: "100vh", background: "#faf9f9", color: INK, fontFamily: SANS, padding: "26px clamp(16px, 4vw, 30px) 64px", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 30 }}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <Link to="/app/brand-settings?section=plan" className="nomi-pricing-back" style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 44, color: N700, font: `500 13px ${SANS}`, width: "max-content", textDecoration: "none", transition: "color .16s ease" }}>
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M16 10 H5 M9 6 L5 10 L9 14" /></svg>
        Plan &amp; billing
      </Link>

      <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 760 }}>
        <span style={{ ...KICKER, letterSpacing: "0.12em" }}>NOMI PRICING</span>
        <h1 style={{ margin: 0, font: `600 clamp(34px, 7vw, 46px)/1.04 ${SERIF}`, letterSpacing: "-0.03em" }}>
          Pick the plan that <em style={{ fontStyle: "italic", fontWeight: 400, color: CYAN }}>fits.</em>
        </h1>
        <p style={{ margin: 0, font: `400 14px/1.5 ${SANS}`, color: N700 }}>
          Every plan gets the full Brand Studio email system, AI campaigns, and all five flows. Plans differ in how much you send and generate.
        </p>
      </div>

      <section aria-label="This month's usage" style={{ ...CARD, padding: "20px clamp(18px, 4vw, 26px)", display: "flex", flexDirection: "column", gap: 16, maxWidth: 1100 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0, font: `600 18px ${SERIF}` }}>Your usage on {plan.name}</h2>
          <span style={KICKER}>{plan.lifetimeAllowances ? "FREE PLAN · ONE-TIME ALLOWANCES" : "RESETS ON THE 1ST"}</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "16px 24px" }}>
          {LINE_METRICS.map((metric) => {
            const row = rows.find((candidate) => candidate.metric === metric)!;
            const pct = row.limit ? Math.min(100, (row.used / row.limit) * 100) : 0;
            const over = row.limit !== null && row.used >= row.limit && row.limit > 0;
            return (
              <div key={metric} style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                <span style={{ font: `500 12.5px ${SANS}`, color: N700 }}>{METRIC_LABELS[metric].many[0].toUpperCase() + METRIC_LABELS[metric].many.slice(1)}</span>
                <span style={{ font: `600 16px ${SANS}` }}>
                  {fmt(row.used)}
                  <span style={{ color: N600, fontWeight: 400 }}> / {row.limit === null ? "unlimited" : fmt(row.limit)}</span>
                </span>
                <div style={{ height: 4, borderRadius: 2, background: N200, overflow: "hidden" }}>
                  <div style={{ height: 4, width: `${row.limit === null ? 0 : pct}%`, background: over ? MAGENTA : CYAN }} />
                </div>
              </div>
            );
          })}
        </div>
        {overage > 0 ? (
          <p style={{ margin: 0, font: `400 13px ${SANS}`, color: N700 }}>
            {fmt(emailsSent - (plan.limits.email_sent ?? 0))} emails over your plan this month: {money(overage)} extra.
          </p>
        ) : null}
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 16, maxWidth: 1100 }}>
        {PLAN_IDS.map((id) => (
          <PlanCard key={id} plan={PLANS[id]} current={id === planId} devStore={devStore} />
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: 760, font: `400 12.5px/1.5 ${SANS}`, color: N600 }}>
        <span>
          Used up an allowance? Extras, once billing opens: email regenerate {money(EXTRA_PRICES_USD.email_regenerate!)}, campaign {money(EXTRA_PRICES_USD.campaign!)}, Regenerate all {money(EXTRA_PRICES_USD.regenerate_all!)}.
          Monthly allowances reset on the 1st.
        </span>
        <span>
          {devStore
            ? "This is a development store, so you can switch plans freely to test them. Nothing is charged."
            : "Billing is handled by Shopify and opens once Nomi is listed on the Shopify App Store."}
        </span>
      </div>
    </main>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
