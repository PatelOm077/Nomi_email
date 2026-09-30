import type { ReactNode } from "react";
import { Link } from "react-router";
import { SENDING_FLOWS } from "../email-delivery/lifecycle-schedule";

// Inline so the state colors can't be lost to the embedded-iframe CSS issue.
const APP_EMBED_TAG_STYLE = {
  active: { color: "#004961", background: "#dff4f8" },
  inactive: { color: "#8a0046", background: "#fde7f1" },
  unknown: { color: "#5f5b58", background: "#e9e7e6" },
} as const;

type DashboardFlow = {
  id: string;
  ready: number;
  total: number;
  // Last-30-day delivery stats; null when nothing has been sent.
  stats: {
    sent: number;
    opened: number;
    clicked: number;
    conversions: number;
    conversionValue: number;
  } | null;
};

type DashboardCampaigns = {
  total: number;
  recent: { id: string; name: string; status: string; createdAt: string; editable: boolean }[];
};

function formatCampaignDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function formatRate(count: number, sent: number) {
  const rate = sent > 0 ? Math.round((count / sent) * 1000) / 10 : 0;
  return `${rate}% (${count})`;
}

function formatMoney(value: number, currency: string, fractionDigits = 2) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(fractionDigits)}`;
  }
}

export function NomiDashboard({
  shopName,
  flows,
  uniqueRecipients,
  campaigns,
  currency,
  generatedCount,
  totalEmailCount,
  sendingEnabled,
  appEmbed,
  providerConfigured,
  plan,
  onToggleSending,
}: {
  shopName: string;
  flows: DashboardFlow[];
  uniqueRecipients: number;
  campaigns: DashboardCampaigns;
  currency: string | null;
  generatedCount: number;
  totalEmailCount: number;
  sendingEnabled: boolean;
  appEmbed: { state: "active" | "inactive" | "unknown"; editorUrl: string };
  providerConfigured: boolean;
  plan: { name: string; priceUsd: number };
  onToggleSending: () => void;
}) {
  const completedSteps = 1 + Number(sendingEnabled) + Number(generatedCount > 0);
  const flowNames: Record<string, string> = {
    welcome: "Welcome",
    interest: "Still Interested?",
    cart: "Abandoned Cart",
    care: "How Was It?",
    winback: "Welcome Back",
  };

  const money = currency ?? "USD";
  const totals = flows.reduce(
    (sum, { stats }) => ({
      sent: sum.sent + (stats?.sent ?? 0),
      conversions: sum.conversions + (stats?.conversions ?? 0),
      value: sum.value + (stats?.conversionValue ?? 0),
    }),
    { sent: 0, conversions: 0, value: 0 },
  );

  return (
    <main className="nomi-dashboard-page">
      <section className="nomi-dashboard-shell" aria-labelledby="nomi-dashboard-title">
        <p className="nomi-dashboard-eyebrow">{shopName} · Store dashboard</p>
        <div className="nomi-dashboard-rule" aria-hidden="true"><i /></div>

        <div className="nomi-dashboard-brand">
          <span aria-hidden="true"><img src="/nomi-mark.svg" alt="" /></span>
          <strong>Nomi</strong>
        </div>
        <h1 id="nomi-dashboard-title">{shopName}, welcome to Nomi.</h1>

        <section className="nomi-dashboard-setup" aria-labelledby="nomi-dashboard-setup-title">
          <div className="nomi-dashboard-setup-meta">
            <span>Getting started · {completedSteps} of 3 complete</span>
            <span aria-hidden="true">⋮</span>
          </div>
          <h2 id="nomi-dashboard-setup-title">Get started with Nomi</h2>
          <p>Follow these steps to activate your email flows.</p>
          <div className="nomi-dashboard-progress" aria-label={`${completedSteps} of 3 setup steps complete`}>
            {[0, 1, 2].map((index) => <i className={index < completedSteps ? "is-complete" : ""} key={index} />)}
          </div>
          <div className="nomi-dashboard-checklist">
            <ChecklistRow complete title="Finish onboarding" detail="Your store and email preferences are saved." />
            <ChecklistRow
              complete={sendingEnabled}
              title="Activate your new email flows"
              action={!sendingEnabled ? onToggleSending : undefined}
              disabled={!providerConfigured}
              titleHint={!providerConfigured ? "Configure the email provider first" : undefined}
            />
            <ChecklistRow
              complete={generatedCount > 0}
              title="Build your lifecycle email family"
              detail={generatedCount > 0 ? `${generatedCount} of ${totalEmailCount} Brand Studio emails are ready.` : "Create all 13 emails together from one approved Brand System."}
              href="/app/brand-studio"
            />
          </div>
        </section>

        <section className="nomi-dashboard-trial" aria-label="Account activation">
          <div>
            <strong>You’re on the {plan.name} plan</strong>
            <p>See what you’ve used and what each plan includes. Upgrade or downgrade any time.</p>
          </div>
          <Link className="nomi-dashboard-plan-link" to="/app/pricing">See plans</Link>
        </section>

        <section className="nomi-dashboard-metrics" aria-label="Email performance">
          <div className="nomi-dashboard-period">▣&nbsp; Last 30 days</div>
          <div className="nomi-dashboard-primary-metrics">
            <Metric label="Attributed revenue" value={formatMoney(totals.value, money, 0)} accent />
            <Metric label="Conversions" value={String(totals.conversions)} />
            <Metric
              label="ROI"
              // Attributed revenue per dollar of Nomi's price; only when the store
              // sells in USD, so the two amounts are the same currency.
              value={plan.priceUsd > 0 && money === "USD" ? `${(totals.value / plan.priceUsd).toFixed(1)}x` : "—"}
            />
          </div>
          <div className="nomi-dashboard-secondary-metrics">
            <Metric label="Emails sent" value={String(totals.sent)} compact />
            <Metric label="Unique contacts emailed" value={String(uniqueRecipients)} compact />
            <Metric label="Flows revenue" value={formatMoney(totals.value, money, 0)} compact />
            <Metric label="Campaigns revenue" value={formatMoney(0, money, 0)} compact />
          </div>
        </section>

        <TableSection title="Flows">
          <table>
            <thead><tr><th>Flow name</th><th>Emails sent</th><th>Open rate</th><th>Click rate</th><th>Conversions</th><th>Conv. value</th><th>Status</th></tr></thead>
            <tbody>{flows.map((flow) => {
              const ready = flow.ready === flow.total;
              const stats = flow.stats ?? { sent: 0, opened: 0, clicked: 0, conversions: 0, conversionValue: 0 };
              // Welcome has emails but no live trigger yet (lifecycle-schedule.ts).
              const status = !SENDING_FLOWS.has(flow.id)
                ? <span className="nomi-dashboard-tag">Not sending yet</span>
                : <span className={ready ? "nomi-dashboard-status-ready" : "nomi-dashboard-status-needs"} aria-label={ready ? (sendingEnabled ? "Sending" : "Ready, flows off") : `${flow.ready} of ${flow.total} emails ready`}>{ready ? "●" : "▲"}</span>;
              return <tr key={flow.id}><td><Link to={`/app/flow-editor?flow=${flow.id}`}>› {flowNames[flow.id] ?? flow.id}</Link></td><td>{stats.sent}</td><td>{formatRate(stats.opened, stats.sent)}</td><td>{formatRate(stats.clicked, stats.sent)}</td><td>{stats.conversions}</td><td>{formatMoney(stats.conversionValue, money)}</td><td>{status}</td></tr>;
            })}</tbody>
          </table>
          <p className="nomi-dashboard-table-note"><span>▲ Emails not built yet — this flow won&rsquo;t send</span><span className="is-ready">{sendingEnabled ? "● Sending automatically" : "● Ready — sends once you activate your flows"}</span></p>
        </TableSection>

        <TableSection title="Campaigns">
          <table><thead><tr><th>Campaign name</th><th>Date</th><th>Emails</th><th>Open rate</th><th>Click rate</th><th>Placed order</th><th>Revenue</th><th>Status</th></tr></thead><tbody>{campaigns.recent.length ? campaigns.recent.map((campaign) => (
            <tr key={campaign.id}><td><Link to={campaign.editable ? `/app/campaigns/edit?id=${campaign.id}` : "/app/campaigns"}>{campaign.name}</Link></td><td style={{ whiteSpace: "nowrap" }}>{formatCampaignDate(campaign.createdAt)}</td><td>0</td><td>0% (0)</td><td>0% (0)</td><td>0</td><td>{formatMoney(0, money)}</td><td><span className="nomi-dashboard-tag">{campaign.status.charAt(0).toUpperCase() + campaign.status.slice(1)}</span></td></tr>
          )) : <tr><td><Link to="/app/campaigns?create=1">Create your first campaign</Link></td><td>—</td><td>0</td><td>0% (0)</td><td>0% (0)</td><td>0</td><td>$0.00</td><td><span className="nomi-dashboard-tag">Draft</span></td></tr>}</tbody></table>
          {campaigns.total > campaigns.recent.length ? <p className="nomi-dashboard-table-note"><Link to="/app/campaigns">View all {campaigns.total} campaigns</Link></p> : null}
        </TableSection>

        <footer className="nomi-dashboard-footer">
          <div>
            <span aria-hidden="true">⌘</span>
            <strong>Store app embed</strong>
            <span
              className="nomi-dashboard-on"
              style={APP_EMBED_TAG_STYLE[appEmbed.state]}
            >
              {appEmbed.state === "active" ? "On" : appEmbed.state === "inactive" ? "Off" : "Unknown"}
            </span>
          </div>
          {/* Opens Shopify's theme editor on App embeds with Nomi Script
              pre-toggled, in a new tab so this dashboard stays open. */}
          <a href={appEmbed.editorUrl} target="_blank" rel="noreferrer">
            {appEmbed.state === "active" ? "App embed settings" : "Turn on"}
          </a>
        </footer>
      </section>
    </main>
  );
}

function ChecklistRow({
  complete = false,
  title,
  detail,
  action,
  disabled = false,
  titleHint,
  href,
}: {
  complete?: boolean;
  title: string;
  detail?: string;
  action?: () => void;
  disabled?: boolean;
  titleHint?: string;
  href?: string;
}) {
  const content = <><span className={`nomi-dashboard-check${complete ? " is-complete" : ""}`} aria-hidden="true">{complete ? <svg viewBox="0 0 12 12" fill="none"><path d="M2.35 6.15 4.85 8.55 9.65 3.45" /></svg> : null}</span><span className="nomi-dashboard-check-copy"><strong>{title}</strong>{detail ? <small>{detail}</small> : null}</span></>;
  if (href) return <Link className="nomi-dashboard-check-row" to={href}>{content}</Link>;
  return action ? <button className="nomi-dashboard-check-row" type="button" onClick={action} disabled={disabled} title={titleHint}>{content}</button> : <div className="nomi-dashboard-check-row">{content}</div>;
}

function Metric({ label, value, accent = false, compact = false }: { label: string; value: string; accent?: boolean; compact?: boolean }) {
  return <div className={`nomi-dashboard-metric${compact ? " is-compact" : ""}`}><span>{label}</span><strong className={accent ? "is-accent" : ""}>{value}</strong></div>;
}

function TableSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="nomi-dashboard-table-card"><h2>{title}</h2><div className="nomi-dashboard-table-scroll">{children}</div></section>;
}
