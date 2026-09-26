import { useEffect, useMemo, useRef, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, data, useFetcher, useLoaderData, useRevalidator, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  SendingDomainError,
  createSendingDomain,
  isDomainSetupConfigured,
  parseRecordNotes,
  parseRecords,
  refreshSendingDomainIfStale,
  removeSendingDomain,
  verifySendingDomain,
} from "../email-delivery/domains.server";
import {
  RETURN_PATH_SUBDOMAIN,
  buildDomainView,
  normalizeDomain,
  validateDomain,
  type DmarcState,
  type RecordView,
  type Tone,
} from "../email-delivery/sending-domain";
import { SENDING_DOMAIN_CSS } from "../components/sending-domain-styles";
import { loadShopFooterAddress, resolveSenderFooter } from "../dashboard/sender-footer.server";

// Sending-domain setup (design: "Nomi Sending Domain", SENDING_DOMAIN.md).
// Every state on this page comes from Resend via domains.server.ts — nothing
// here simulates a check or a verified state.

const SHOP_QUERY = `#graphql
  query SendingDomainShop { shop { name ianaTimezone primaryDomain { host } } }
`;

// Sender info opened from here returns to this page after saving.
const SENDER_INFO_PATH = `/app/brand-settings?section=sender&returnTo=${encodeURIComponent("/app/sending-domain")}`;

type ShopInfo = { name: string; timezone: string; primaryHost: string | null };

async function loadShopInfo(admin: { graphql: (q: string) => Promise<Response> }): Promise<ShopInfo | null> {
  try {
    const response = await admin.graphql(SHOP_QUERY);
    const json = (await response.json()) as {
      data?: { shop?: { name?: string; ianaTimezone?: string; primaryDomain?: { host?: string | null } | null } };
    };
    const shop = json.data?.shop;
    if (!shop) return null;
    return { name: shop.name ?? "", timezone: shop.ianaTimezone ?? "UTC", primaryHost: shop.primaryDomain?.host ?? null };
  } catch {
    return null;
  }
}

function formatDate(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).format(date);
  } catch {
    return date.toISOString().slice(0, 16).replace("T", " ");
  }
}

function lastCheckedLabel(date: Date | null, timeZone: string): string {
  if (!date) return "Not checked yet";
  const minutes = Math.floor((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return "Last checked just now";
  if (minutes < 60) return `Last checked ${minutes} min ago`;
  return `Last checked ${formatDate(date, timeZone)}`;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const configured = isDomainSetupConfigured();

  let row = null;
  let refreshError: string | null = null;
  try {
    row = await refreshSendingDomainIfStale(session.shop);
  } catch (error) {
    refreshError = error instanceof Error ? error.message : "Couldn’t reach Nomi’s email provider.";
    row = await db.sendingDomain.findUnique({ where: { shop: session.shop } });
  }

  const [shop, settings, shopAddress] = await Promise.all([
    loadShopInfo(admin),
    db.shopSettings.findUnique({
      where: { shop: session.shop },
      select: { senderName: true, senderAddress: true, senderCity: true, senderProvince: true, senderPostalCode: true, senderCountry: true },
    }),
    loadShopFooterAddress(admin),
  ]);
  const footer = resolveSenderFooter(settings, shopAddress);
  const timeZone = shop?.timezone ?? "UTC";
  const primary = normalizeDomain(shop?.primaryHost);
  const suggestedDomain = primary && !validateDomain(primary) ? primary : null;

  return {
    configured,
    refreshError,
    suggestedDomain,
    fromName: settings?.senderName || shop?.name || null,
    footer: { complete: footer.complete, source: footer.source, line: footer.line },
    domain: row
      ? {
          domain: row.domain,
          status: row.status,
          records: parseRecords(row),
          notes: parseRecordNotes(row),
          dmarcState: row.dmarcState as DmarcState,
          dmarcValue: row.dmarcValue,
          checked: Boolean(row.lastCheckedAt),
          lastChecked: lastCheckedLabel(row.lastCheckedAt, timeZone),
          verifiedAt: row.verifiedAt ? formatDate(row.verifiedAt, timeZone) : null,
          lastError: row.lastError,
        }
      : null,
  };
};

type ActionResult = { ok: true; intent: string } | { ok: false; intent: string; error: string };

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  try {
    if (intent === "create") await createSendingDomain(session.shop, String(form.get("domain") ?? ""));
    else if (intent === "verify") await verifySendingDomain(session.shop);
    else if (intent === "remove") await removeSendingDomain(session.shop);
    else return data<ActionResult>({ ok: false, intent, error: "Unknown action." }, { status: 400 });
    return data<ActionResult>({ ok: true, intent });
  } catch (error) {
    if (error instanceof SendingDomainError)
      return data<ActionResult>({ ok: false, intent, error: error.message }, { status: error.status });
    console.error("[sending-domain]", intent, error);
    return data<ActionResult>(
      { ok: false, intent, error: "Nomi’s email provider didn’t respond. Try again in a minute." },
      { status: 502 },
    );
  }
};

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

const Icon = {
  info: (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><circle cx="10" cy="10" r="7.5" /><path d="M10 9 V14" /><path d="M10 6.2 V6.4" /></svg>
  ),
  alert: (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><circle cx="10" cy="10" r="7.5" /><path d="M10 6 V10.5" /><path d="M10 13.6 V13.8" /></svg>
  ),
  check: (size = 14, width = 2) => (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 10.5 L8.2 14.5 L16 6" /></svg>
  ),
  copy: (
    <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1" /><path d="M13 4 H4 V13" /></svg>
  ),
  spin: (
    <svg className="spin" width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M10 2.5 A7.5 7.5 0 1 1 2.5 10" /></svg>
  ),
  shield: (
    <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true"><path d="M10 2.5 L16 5 V9.5 C16 13.5 13.4 16.3 10 17.5 C6.6 16.3 4 13.5 4 9.5 V5 Z" /><path d="M7.5 10 L9.3 11.8 L12.8 8.3" /></svg>
  ),
};

function copyText(text: string) {
  try {
    if (navigator.clipboard?.writeText) return void navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  } catch { /* embedded iframe may deny the async clipboard */ }
  fallbackCopy(text);
}

function fallbackCopy(text: string) {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  try { document.execCommand("copy"); } catch { /* nothing else to try */ }
  area.remove();
}

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<number>();
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return {
    copied,
    copy: (key: string, text: string) => {
      copyText(text);
      setCopied(key);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(null), 1600);
    },
  };
}

function CopyButton({ id, text, label, copier, wide }: { id: string; text: string; label: string; copier: ReturnType<typeof useCopy>; wide?: boolean }) {
  const done = copier.copied === id;
  return (
    <button type="button" className={`copy${wide ? " wide" : ""}${done ? " done" : ""}`} onClick={() => copier.copy(id, text)} aria-label={label}>
      {done ? Icon.check(13, 2) : Icon.copy}
      <span>{done ? "Copied" : "Copy"}</span>
    </button>
  );
}

function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={`pill ${tone}`}><i />{children}</span>;
}

function Dialog({ labelledBy, onClose, children }: { labelledBy: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="scrim" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby={labelledBy}>{children}</div>
    </div>
  );
}

export default function SendingDomainPage() {
  const loaderData = useLoaderData<typeof loader>();
  const { configured, suggestedDomain, fromName, footer } = loaderData;
  const current = loaderData.domain;
  const fetcher = useFetcher<ActionResult>();
  const revalidator = useRevalidator();
  const copier = useCopy();

  const busyIntent = fetcher.state !== "idle" ? String(fetcher.formData?.get("intent") ?? "") : null;
  const result = fetcher.state === "idle" ? fetcher.data : undefined;

  const [domainInput, setDomainInput] = useState(suggestedDomain ?? "");
  const [suggested, setSuggested] = useState(Boolean(suggestedDomain));
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [modal, setModal] = useState<null | "confirm" | "change">(null);
  const [added, setAdded] = useState(Boolean(current?.checked));

  // Close dialogs once the server accepted the action.
  useEffect(() => {
    if (!result) return;
    if (result.ok && (result.intent === "create" || result.intent === "remove")) {
      setModal(null);
      if (result.intent === "remove") { setDomainInput(""); setSuggested(false); setAdded(false); }
    }
  }, [result]);

  const view = useMemo(
    () => (current ? buildDomainView({ domain: current.domain, status: current.status, records: current.records, notes: current.notes }) : null),
    [current],
  );
  const step: "entry" | "records" | "verified" = !current ? "entry" : view?.verified ? "verified" : "records";

  // Replay: once verified, the merchant can walk back through all three
  // pages (?replay=1 from Campaigns) with the real domain and records.
  // Read-only — step 1 can't submit a new domain.
  const [searchParams] = useSearchParams();
  const [replay, setReplay] = useState<1 | 2 | 3 | null>(() => {
    const n = Number(searchParams.get("replay"));
    return n === 1 || n === 2 || n === 3 ? n : null;
  });
  const replaying = step === "verified" && replay !== null;
  const shownStep: typeof step = replaying ? (["entry", "records", "verified"] as const)[replay - 1] : step;
  const goTo = (n: 1 | 2 | 3) => {
    setReplay(n === 3 ? null : n);
    window.scrollTo({ top: 0 });
  };

  // While Resend is still checking, pull fresh status in the background.
  useEffect(() => {
    if (step !== "records") return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible" && revalidator.state === "idle") revalidator.revalidate();
    }, 20_000);
    return () => window.clearInterval(id);
  }, [step, revalidator]);

  const shown = normalizeDomain(domainInput) || "yourstore.com";
  const pendingDomain = normalizeDomain(domainInput);
  const checking = busyIntent === "verify";

  const onContinue = () => {
    const err = validateDomain(pendingDomain);
    if (err) { setFieldError(err); return; }
    setDomainInput(pendingDomain);
    setFieldError(null);
    setModal("confirm");
  };

  const stepCls = (n: number) => {
    const order = { entry: 1, records: 2, verified: 3 }[shownStep];
    return n < order ? "done" : n === order ? "on" : "";
  };

  const actionError = result && !result.ok ? result.error : null;

  return (
    <main className="nomi-flow-page nomi-sd">
      <style dangerouslySetInnerHTML={{ __html: SENDING_DOMAIN_CSS }} />
      <div className="nomi-flow-shell">
        <header className="head">
          <div className="head-l">
            <Link className="back" to="/app/campaigns" aria-label="Back to Campaigns">←</Link>
            <div><div className="crumb">Campaigns</div><h1>Sending domain</h1></div>
          </div>
        </header>
        <ol className="steps" aria-label="Setup progress">
          {([[1, "Domain"], [2, "DNS records"], [3, "Verified"]] as const).map(([n, label]) => (
            <li key={n} className={stepCls(n)}>
              {step === "verified" ? (
                <button type="button" onClick={() => goTo(n)} aria-current={stepCls(n) === "on" ? "step" : undefined} style={{ display: "inherit", alignItems: "inherit", gap: "inherit", flexDirection: "inherit", width: "100%", minHeight: 44, margin: "-12px 0 -10px", padding: "12px 0 10px", border: 0, background: "none", color: "inherit", font: "inherit", textAlign: "left", cursor: "pointer" }}>
                  <b>0{n}</b><span>{label}</span>
                </button>
              ) : (<><b>0{n}</b><span>{label}</span></>)}
            </li>
          ))}
        </ol>

        {replaying ? (
          <div role="status" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", margin: "-12px 0 24px", padding: "10px 12px 10px 16px", border: "1px solid var(--sd-line)", background: "#fff", borderRadius: 2 }}>
            <p style={{ margin: 0, flex: "1 1 260px", fontSize: 14, lineHeight: 1.45, color: "var(--sd-ink)" }}>
              <strong>Replaying setup · step {replay} of 3.</strong> {current?.domain} is already verified — nothing here changes it.
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {replay > 1 ? <button type="button" className="btn ghost" onClick={() => goTo((replay - 1) as 1 | 2)} style={{ minHeight: 44 }}>Back</button> : null}
              <button type="button" className="btn cta" onClick={() => goTo((replay + 1) as 2 | 3)} style={{ minHeight: 44 }}>{replay === 2 ? "Finish replay" : "Next"}</button>
            </div>
          </div>
        ) : null}

        {!configured ? (
          <div className="notice bad" role="alert" style={{ margin: "0 0 24px" }}>
            {Icon.alert}
            <div><strong>Domain setup isn’t connected yet</strong><p>Set <code>RESEND_API_KEY</code> (a full-access Resend key) on the server to add a sending domain.</p></div>
          </div>
        ) : null}

        {shownStep === "entry" ? (
          <div className="grid">
            <div className="col">
              <section className="card pad" aria-labelledby="entry-title">
                <div className="eyebrow">Step 1 · Your domain</div>
                <h2 id="entry-title">Send campaigns from your own domain</h2>
                <p className="lede">Campaigns go out from an address like <b>hello@{replaying ? current?.domain : shown}</b>. Inbox providers check that mail really comes from the domain it names, so a verified domain is what gets your campaigns to the inbox.</p>
                <form className={`field${fieldError ? " bad" : ""}`} onSubmit={(e) => { e.preventDefault(); onContinue(); }} noValidate>
                  <label htmlFor="domain-input">Your domain</label>
                  <input
                    id="domain-input"
                    type="text"
                    inputMode="url"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="yourstore.com"
                    value={replaying ? current?.domain ?? "" : domainInput}
                    readOnly={replaying}
                    onChange={(e) => { setDomainInput(e.target.value); setFieldError(null); setSuggested(false); }}
                    aria-describedby="domain-help"
                    aria-invalid={fieldError ? true : undefined}
                  />
                  {suggested && !fieldError && !replaying ? <span className="suggest">{Icon.check(14, 2)}Suggested from your Shopify primary domain</span> : null}
                  {fieldError ? <span className="err" role="alert">{Icon.alert}{fieldError}</span> : null}
                  <p id="domain-help" className="help">Use the domain your customers visit. Your .myshopify.com address can’t be used as a sender.</p>
                </form>
                <div className="subd">
                  <div className="k">Bounce subdomain</div>
                  <div className="mono">{RETURN_PATH_SUBDOMAIN}.{replaying ? current?.domain : shown}</div>
                  <p className="help">Nomi uses this subdomain behind the scenes to handle bounces. Your website and current inbox keep working exactly as they are.</p>
                </div>
                {replaying ? null : <div className="actions"><button type="button" className="btn cta" onClick={onContinue}>Continue</button></div>}
              </section>
            </div>
            <aside className="aside" aria-label="Before you start">
              <h4>Before you start</h4>
              <div className="tip"><b>01</b><div><strong>Know where your domain lives</strong><p>GoDaddy, Namecheap, Cloudflare, Squarespace — wherever you bought or manage it.</p></div></div>
              <div className="tip"><b>02</b><div><strong>About ten minutes</strong><p>You’ll copy a few records into your DNS settings. Nomi shows the exact values.</p></div></div>
              <div className="tip"><b>03</b><div><strong>No passwords</strong><p>Nomi never asks for your domain login or account access. You stay in control of your DNS.</p></div></div>
            </aside>
          </div>
        ) : null}

        {shownStep === "records" && current && view ? (
          <RecordsStep
            domain={current.domain}
            view={view}
            lastChecked={checking ? "Checking now" : view.check === "failed" ? "Stopped after 72 hours of checks" : current.lastChecked}
            dmarcState={current.dmarcState}
            dmarcValue={current.dmarcValue}
            copier={copier}
            checking={checking}
            added={added || replaying}
            setAdded={setAdded}
            error={actionError && result?.intent === "verify" ? actionError : current.lastError ? "Nomi couldn’t reach its email provider on the last check. Showing the last known status." : null}
            onVerify={() => fetcher.submit({ intent: "verify" }, { method: "post" })}
            onChange={() => setModal("change")}
            replay={replaying}
          />
        ) : null}

        {shownStep === "verified" && current && view ? (
          <div className="grid">
            <div className="col">
              <section className="card pad" aria-labelledby="ver-title">
                <div className="okmark">{Icon.check(28, 2)}</div>
                <div className="eyebrow">Step 3 · Verified</div>
                <h2 id="ver-title" style={{ wordBreak: "break-word" }}>{current.domain} is verified</h2>
                <p className="lede">Inbox providers can now confirm your campaigns really come from you.</p>
                <dl className="metagrid">
                  <div><dt>Domain</dt><dd>{current.domain}</dd></div>
                  <div><dt>Status</dt><dd><Pill tone="ok">Verified</Pill></dd></div>
                  <div><dt>Verified</dt><dd>{current.verifiedAt ?? "—"}</dd></div>
                  <div><dt>Last checked</dt><dd>{current.lastChecked.replace(/^Last checked /, "").replace(/^./, (c) => c.toUpperCase())}</dd></div>
                </dl>
              </section>
              {footer.complete ? (
                <section className="next" aria-labelledby="next-title">
                  <div>
                    <div className="eyebrow">Next</div>
                    <h3 id="next-title">Your sender is set</h3>
                    <p>Customers will see this name and address in their inbox.</p>
                    <div className="fromprev">{fromName ? `${fromName} ` : ""}&lt;hello@{current.domain}&gt;</div>
                    <p style={{ margin: "14px 0 0", fontSize: 14, lineHeight: 1.5 }}>
                      Business address: {footer.line}
                      <br />
                      <span style={{ color: "#bdb8b4" }}>Marketing emails must show a postal address. Nomi will add this one to your campaign footers. {footer.source === "shopify" ? "From your Shopify store details." : "From Nomi Sender info."}</span>{" "}
                      <Link to={SENDER_INFO_PATH} style={{ color: "#99e0ff", textDecoration: "underline", textUnderlineOffset: 3, display: "inline-block", minHeight: 24 }}>Edit</Link>
                    </p>
                  </div>
                  <Link className="btn light" to="/app/campaigns">Go to Campaigns</Link>
                </section>
              ) : (
                <section className="next" aria-labelledby="next-title">
                  <div>
                    <div className="eyebrow">Next</div>
                    <h3 id="next-title">Add your business address</h3>
                    <p>Marketing emails must show a postal address in the footer. Your Shopify store details don’t have a complete one, so add it once in Sender info.</p>
                    <div className="fromprev">{fromName ? `${fromName} ` : ""}&lt;hello@{current.domain}&gt;</div>
                  </div>
                  <Link className="btn light" to={SENDER_INFO_PATH}>Add sender info</Link>
                </section>
              )}
              <section className="card" aria-labelledby="vr-title">
                <div className="vhead"><strong id="vr-title" style={{ fontSize: 15 }}>{view.verifiedCount} of {view.total} records verified</strong><span className="meta">Nomi re-checks daily and flags it here if a record goes missing.</span></div>
                <div className="vlist">
                  {view.records.map((r) => (
                    <div className="vrow" key={r.key}><span className="type">{r.type}</span><code>{r.name}</code><Pill tone="ok">Verified</Pill></div>
                  ))}
                  <div className="vrow">
                    <span className="type">DMARC</span><code>_dmarc</code>
                    {current.dmarcState === "found" ? <Pill tone="ok">Policy found</Pill> : current.dmarcState === "multiple" ? <Pill tone="bad">Duplicate policies</Pill> : current.dmarcState === "missing" ? <Pill tone="warn">Recommended</Pill> : <Pill tone="neutral">Not checked</Pill>}
                  </div>
                </div>
              </section>
              <section className="card danger-zone">
                <div><strong>Change sending domain</strong><p>A new domain starts from step 1 and needs its own records.</p></div>
                <button type="button" className="btn ghost" onClick={() => setModal("change")}>Change domain</button>
              </section>
            </div>
            <aside className="aside" aria-label="What happens now">
              <h4>What happens now</h4>
              <div className="tip"><b>01</b><div><strong>Leave the records in place</strong><p>Removing them later stops campaigns from sending. Nomi pauses sends and flags it here if that happens.</p></div></div>
              <div className="tip"><b>02</b><div><strong>Same domain, any address</strong><p>hello@, news@, team@ — every address on {current.domain} is covered.</p></div></div>
              <div className="tip"><b>03</b><div><strong>Store emails unchanged</strong><p>Shopify order and shipping emails keep their current settings.</p></div></div>
            </aside>
          </div>
        ) : null}
      </div>

      {modal === "confirm" ? (
        <Dialog labelledBy="confirm-title" onClose={() => busyIntent !== "create" && setModal(null)}>
          <header><div><div className="eyebrow">Confirm domain</div><h2 id="confirm-title">Use {pendingDomain}?</h2></div><button type="button" className="x" onClick={() => setModal(null)} disabled={busyIntent === "create"} aria-label="Close">×</button></header>
          <div className="body">
            <p>Nomi will create sending records for this domain. You’ll add them at your domain provider in the next step.</p>
            <div className="dl">
              <div><span>From addresses</span><code>anything@{pendingDomain}</code></div>
              <div><span>Bounce subdomain</span><code>{RETURN_PATH_SUBDOMAIN}.{pendingDomain}</code></div>
            </div>
            {actionError && result?.intent === "create" ? <p className="err" role="alert">{Icon.alert}{actionError}</p> : null}
          </div>
          <footer>
            <button type="button" className="btn ghost" onClick={() => setModal(null)} disabled={busyIntent === "create"}>Edit domain</button>
            <button type="button" className="btn cta" disabled={busyIntent === "create"} onClick={() => fetcher.submit({ intent: "create", domain: pendingDomain }, { method: "post" })}>
              {busyIntent === "create" ? <>{Icon.spin}Creating records…</> : "Create records"}
            </button>
          </footer>
        </Dialog>
      ) : null}

      {modal === "change" && current ? (
        <Dialog labelledBy="change-title" onClose={() => busyIntent !== "remove" && setModal(null)}>
          <header><div><div className="eyebrow" style={{ color: "#a3004f" }}>Change sending domain</div><h2 id="change-title">{view?.verified ? `Stop sending from ${current.domain}?` : `Remove ${current.domain}?`}</h2></div><button type="button" className="x" onClick={() => setModal(null)} disabled={busyIntent === "remove"} aria-label="Close">×</button></header>
          <div className="body">
            <p>{view?.verified
              ? `Campaigns can’t send until the new domain is verified. From addresses on ${current.domain} stop working in Nomi as soon as you continue.`
              : `Nomi removes ${current.domain} and its records from its email provider. You can delete the DNS records you added at your domain provider.`}</p>
            <div className="dl">
              <div><span>From address affected</span><code>anything@{current.domain}</code></div>
              {view?.verified ? <div><span>Scheduled campaigns</span><code>Paused until verified</code></div> : null}
            </div>
            {actionError && result?.intent === "remove" ? <p className="err" role="alert">{Icon.alert}{actionError}</p> : null}
          </div>
          <footer>
            <button type="button" className="btn ghost" onClick={() => setModal(null)} disabled={busyIntent === "remove"}>Keep {current.domain}</button>
            <button type="button" className="btn danger" disabled={busyIntent === "remove"} onClick={() => fetcher.submit({ intent: "remove" }, { method: "post" })}>
              {busyIntent === "remove" ? <>{Icon.spin}Removing…</> : view?.verified ? "Change domain" : "Remove domain"}
            </button>
          </footer>
        </Dialog>
      ) : null}
    </main>
  );
}

function RecordsStep(props: {
  domain: string;
  view: NonNullable<ReturnType<typeof buildDomainView>>;
  lastChecked: string;
  dmarcState: DmarcState;
  dmarcValue: string | null;
  copier: ReturnType<typeof useCopy>;
  checking: boolean;
  added: boolean;
  setAdded: (v: boolean) => void;
  error: string | null;
  onVerify: () => void;
  onChange: () => void;
  // Replay shows the page as it was, minus anything that edits the domain.
  replay?: boolean;
}) {
  const { domain, view, copier, checking } = props;
  const records: RecordView[] = checking
    ? view.records.map((r) => (r.status === "verified" ? r : { ...r, label: "Checking", tone: "checking" as Tone, detail: null }))
    : view.records;
  const overallLabel = checking ? "Checking…" : view.overallLabel;
  const overallTone: Tone = checking ? "checking" : view.overallTone;
  const note = !props.added
    ? "Tick the box once the records are saved at your domain provider."
    : checking ? "Asking your domain provider for these records now."
    : view.check === "failed" ? "Once the records are saved, restart and Nomi checks again for 72 hours."
    : view.check === "idle" ? "DNS changes usually show up within minutes; some providers take a few hours."
    : "Your progress is saved. Nomi keeps checking in the background and updates this page.";
  const dmarcAdd = "v=DMARC1; p=none;";

  return (
    <div className="grid full">
      <div className="col">
        <section className="card" aria-labelledby="rec-title">
          <div className="summary">
            <div><div className="eyebrow">Step 2 · DNS records</div><div className="dom" id="rec-title">{domain}</div></div>
            <div className="sum-r">
              <Pill tone={overallTone}>{overallLabel}</Pill>
              <span className="meta">{props.lastChecked}</span>
              {props.replay ? null : <button type="button" className="linkbtn" onClick={props.onChange}>Use a different domain</button>}
            </div>
          </div>
          {!checking && view.notice ? (
            <div className={`notice ${view.notice.tone}`} role="status">{Icon.alert}<div><strong>{view.notice.title}</strong><p>{view.notice.body}</p></div></div>
          ) : null}
          {props.error ? (
            <div className="notice bad" role="alert">{Icon.alert}<div><strong>Couldn’t check just now</strong><p>{props.error}</p></div></div>
          ) : null}
          <div className="howto">
            <div><b>01</b><strong>Open your DNS settings</strong><p>Sign in where you manage {domain} and find DNS, Zone editor or Advanced DNS.</p></div>
            <div><b>02</b><strong>Add each record below</strong><p>Match the type, host and value exactly. Copy each field on its own.</p></div>
            <div><b>03</b><strong>Save, then verify here</strong><p>Tick the box below, then verify. Your progress is saved.</p></div>
          </div>
          <div className="hostnote">{Icon.info}<p>Some providers add <code>{domain}</code> to the end of the host automatically. If yours does, enter only what’s in the Host column — <code>{RETURN_PATH_SUBDOMAIN}</code>, not <code>{RETURN_PATH_SUBDOMAIN}.{domain}</code>.</p></div>
          <div className="group-t"><strong style={{ fontSize: 14 }}>Required for sending</strong><span>{records.length} records from Nomi’s email provider for {domain}</span></div>

          <div className="rt" role="table" aria-label="DNS records to add">
            <div className="rt-row rt-h" role="row"><div role="columnheader">Type</div><div role="columnheader">Host / Name</div><div role="columnheader">Value / Points to</div><div role="columnheader">Status</div></div>
            {records.map((r) => (
              <div className="rt-item" key={r.key}>
                <div className="rt-row" role="row">
                  <div className="rt-c" role="cell"><span className="type">{r.type}</span><span className="purpose">{r.purpose}</span></div>
                  <div className="rt-c row2" role="cell"><code className="h">{r.name}</code><CopyButton id={`${r.key}-h`} text={r.name} label={`Copy host for ${r.purpose}`} copier={copier} /></div>
                  <div className="rt-c" role="cell">
                    <div className="rt-c row2" style={{ padding: 0 }}><code className="v">{r.value}</code><CopyButton id={`${r.key}-v`} text={r.value} label={`Copy value for ${r.purpose}`} copier={copier} /></div>
                    {r.priority != null ? <span className="prio">Priority <code>{r.priority}</code></span> : null}
                  </div>
                  <div className="rt-c st" role="cell"><Pill tone={r.tone}>{r.label}</Pill></div>
                </div>
                {r.detail ? <div className="rt-detail" role="note">{Icon.alert}<p>{r.detail}</p></div> : null}
              </div>
            ))}
          </div>

          <div className="rcards" role="list" aria-label="DNS records to add">
            {records.map((r) => (
              <article className="rc" role="listitem" key={r.key}>
                <div className="rc-h"><div><span className="type">{r.type} record</span><span className="purpose">{r.purpose}</span></div><Pill tone={r.tone}>{r.label}</Pill></div>
                <div className="rc-b">
                  <div className="rc-kv"><span className="k">Host / Name</span><div className="rc-line"><code className="h">{r.name}</code><CopyButton id={`${r.key}-h`} text={r.name} label={`Copy host for ${r.purpose}`} copier={copier} /></div></div>
                  <div className="rc-kv"><span className="k">Value / Points to</span><code className="v">{r.value}</code><CopyButton id={`${r.key}-v`} text={r.value} label={`Copy value for ${r.purpose}`} copier={copier} wide /></div>
                  {r.priority != null ? <span className="prio">Priority <code>{r.priority}</code></span> : null}
                  {r.detail ? <div className="rt-detail" role="note" style={{ margin: 0 }}>{Icon.alert}<p>{r.detail}</p></div> : null}
                </div>
              </article>
            ))}
          </div>

          <div className="dmarc-sec" role="group" aria-labelledby="dmarc-title">
            <div className="eyebrow">DMARC · Recommended</div>
            {props.dmarcState === "found" ? (
              <>
                <h3 id="dmarc-title">DMARC policy found</h3>
                <div className="found"><span className="k" style={{ color: "#00789e" }}>_dmarc.{domain}</span><code>{props.dmarcValue}</code></div>
                <p style={{ marginTop: 12 }}>Keep it as it is. There’s nothing to add.</p>
              </>
            ) : props.dmarcState === "multiple" ? (
              <>
                <h3 id="dmarc-title">{domain} has more than one DMARC record</h3>
                <p>Inbox providers ignore DMARC when there are two policies at <b>_dmarc.{domain}</b>. Delete all but one at your domain provider.</p>
                <div className="found"><code style={{ whiteSpace: "pre-wrap" }}>{props.dmarcValue}</code></div>
              </>
            ) : props.dmarcState === "missing" ? (
              <>
                <h3 id="dmarc-title">No DMARC policy found for {domain}</h3>
                <p>We looked up <b>_dmarc.{domain}</b> and found nothing. A DMARC policy tells Gmail and Yahoo how to treat mail that fails the checks above — they expect one from stores that send campaigns.</p>
                <div className="dm-row" role="group" aria-label="Suggested DMARC record">
                  <div><span className="type">TXT</span></div>
                  <div><code className="h">_dmarc</code><CopyButton id="dm-h" text="_dmarc" label="Copy DMARC host" copier={copier} /></div>
                  <div><code className="v">{dmarcAdd}</code><CopyButton id="dm-v" text={dmarcAdd} label="Copy DMARC value" copier={copier} /></div>
                </div>
                <div className="caution">{Icon.alert}<span>Add this only if your DNS has no <b>_dmarc</b> record yet. Two DMARC records cancel each other out — if one exists, keep it as it is.</span></div>
              </>
            ) : (
              <>
                <h3 id="dmarc-title">DMARC not checked yet</h3>
                <p>Nomi looks up <b>_dmarc.{domain}</b> when you verify your records.</p>
              </>
            )}
          </div>

          <div className="vfoot">
            <label className="added" htmlFor="added-box">
              <input id="added-box" type="checkbox" checked={props.added} disabled={props.replay} onChange={(e) => props.setAdded(e.target.checked)} />
              <span className="box" aria-hidden="true">{Icon.check(12, 2.6)}</span>
              <span>I’ve added these records</span>
            </label>
            <div className="vfoot-r">
              <button type="button" className="btn verify" onClick={props.onVerify} disabled={!props.added || checking}>
                {checking ? Icon.spin : Icon.shield}<span>{checking ? "Verifying…" : view.checkLabel}</span>
              </button>
            </div>
          </div>
          <p className="vnote">{note}</p>
        </section>
      </div>
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
