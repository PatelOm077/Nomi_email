import type { ReactNode } from "react";

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
};

export function NomiDashboard({
  shopName,
  flows,
  generatedCount,
  totalEmailCount,
  sendingEnabled,
  appEmbed,
  providerConfigured,
  trialStarted,
  onStartTrial,
  onToggleSending,
}: {
  shopName: string;
  flows: DashboardFlow[];
  generatedCount: number;
  totalEmailCount: number;
  sendingEnabled: boolean;
  appEmbed: { state: "active" | "inactive" | "unknown"; editorUrl: string };
  providerConfigured: boolean;
  trialStarted: boolean;
  onStartTrial: () => void;
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
            <span>Getting started · {completedSteps} of 4 complete</span>
            <span aria-hidden="true">⋮</span>
          </div>
          <h2 id="nomi-dashboard-setup-title">Get started with Nomi</h2>
          <p>Follow these steps to activate your email flows.</p>
          <div className="nomi-dashboard-progress" aria-label={`${completedSteps} of 4 setup steps complete`}>
            {[0, 1, 2, 3].map((index) => <i className={index < completedSteps ? "is-complete" : ""} key={index} />)}
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
            <ChecklistRow title="Rate your experience so far" rating />
          </div>
        </section>

        <section className="nomi-dashboard-trial" aria-label="Account activation">
          <div>
            <strong>Activate your account to start sending emails</strong>
            <p>Start your 7-day free trial to enable email sending to your customers.</p>
          </div>
          <button type="button" onClick={onStartTrial} disabled={trialStarted}>
            {trialStarted ? "Trial started" : "Start free trial"}
          </button>
        </section>

        <section className="nomi-dashboard-metrics" aria-label="Email performance">
          <div className="nomi-dashboard-period">▣&nbsp; Last 30 days</div>
          <div className="nomi-dashboard-primary-metrics">
            <Metric label="Attributed revenue" value="$0" accent />
            <Metric label="Conversions" value="0" />
            <Metric label="ROI" value="0x" />
          </div>
          <div className="nomi-dashboard-secondary-metrics">
            <Metric label="Emails sent" value="0" compact />
            <Metric label="Unique contacts emailed" value="0" compact />
            <Metric label="Flows revenue" value="$0" compact />
            <Metric label="Campaigns revenue" value="$0" compact />
          </div>
        </section>

        <TableSection title="Flows">
          <table>
            <thead><tr><th>Flow name</th><th>Emails sent</th><th>Open rate</th><th>Click rate</th><th>Conversions</th><th>Conv. value</th><th>Status</th></tr></thead>
            <tbody>{flows.map((flow) => {
              const ready = flow.ready === flow.total;
              return <tr key={flow.id}><td><a href="/app?view=flows">› {flowNames[flow.id] ?? flow.id}</a></td><td>0</td><td>0% (0)</td><td>0% (0)</td><td>0</td><td>$0.00</td><td><span className={ready ? "nomi-dashboard-status-ready" : "nomi-dashboard-status-needs"} aria-label={ready ? "Ready" : `${flow.ready} of ${flow.total} emails ready`}>{ready ? "●" : "▲"}</span></td></tr>;
            })}</tbody>
          </table>
          <p className="nomi-dashboard-table-note"><span>▲ Not set up — this flow won&rsquo;t send</span><span className="is-ready">● Once activated, it sends automatically</span></p>
        </TableSection>

        <TableSection title="Campaigns">
          <table><thead><tr><th>Campaign name</th><th>Date</th><th>Emails</th><th>Open rate</th><th>Click rate</th><th>Placed order</th><th>Revenue</th><th>Status</th></tr></thead><tbody><tr><td><a href="/app/campaigns">Create your first campaign</a></td><td>—</td><td>0</td><td>0% (0)</td><td>0% (0)</td><td>0</td><td>$0.00</td><td><span className="nomi-dashboard-tag">Draft</span></td></tr></tbody></table>
        </TableSection>

        <TableSection title="Email collection forms">
          <table><thead><tr><th>Form</th><th>Impressions</th><th>Submitted emails</th><th>Submitted phones</th><th>Submit rate</th><th>Status</th></tr></thead><tbody><tr><td><a href="/app/brand-settings">Pop-up</a></td><td>0</td><td>0</td><td>0</td><td>0.00%</td><td><span className="nomi-dashboard-status-needs" aria-label="Needs setup">▲</span></td></tr></tbody></table>
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
  rating = false,
  action,
  disabled = false,
  titleHint,
  href,
}: {
  complete?: boolean;
  title: string;
  detail?: string;
  rating?: boolean;
  action?: () => void;
  disabled?: boolean;
  titleHint?: string;
  href?: string;
}) {
  const content = <><span className={`nomi-dashboard-check${complete ? " is-complete" : ""}`} aria-hidden="true">{complete ? <svg viewBox="0 0 12 12" fill="none"><path d="M2.35 6.15 4.85 8.55 9.65 3.45" /></svg> : null}</span><span className="nomi-dashboard-check-copy"><strong>{title}</strong>{detail ? <small>{detail}</small> : null}</span>{rating ? <span className="nomi-dashboard-rating" aria-label="Not yet rated">☆ ☆ ☆ ☆ ☆</span> : null}</>;
  if (href) return <a className="nomi-dashboard-check-row" href={href}>{content}</a>;
  return action ? <button className="nomi-dashboard-check-row" type="button" onClick={action} disabled={disabled} title={titleHint}>{content}</button> : <div className="nomi-dashboard-check-row">{content}</div>;
}

function Metric({ label, value, accent = false, compact = false }: { label: string; value: string; accent?: boolean; compact?: boolean }) {
  return <div className={`nomi-dashboard-metric${compact ? " is-compact" : ""}`}><span>{label}</span><strong className={accent ? "is-accent" : ""}>{value}</strong></div>;
}

function TableSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="nomi-dashboard-table-card"><h2>{title}</h2><div className="nomi-dashboard-table-scroll">{children}</div></section>;
}
