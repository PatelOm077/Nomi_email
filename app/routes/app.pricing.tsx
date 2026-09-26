import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

// Pricing scale (design: "Pricing Scale"). Layout-critical styles are inline
// on purpose — new classes in nomi.css have failed to apply inside the
// embedded admin iframe before (see CAMPAIGNS.md). The scoped <style> below
// only carries hover/focus states, which inline styles can't express.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

const MIN_CONTACTS = 500;
const MAX_CONTACTS = 200_000;
const STEP = 500;
const BASE_PRICE = 15;
const PRICE_PER_STEP = 5;
const SENDS_PER_CONTACT = 10;

const fmt = (n: number) => n.toLocaleString("en-US");
const clamp = (n: number) => Math.min(MAX_CONTACTS, Math.max(MIN_CONTACTS, n));
const monthlyTotal = (contacts: number) => BASE_PRICE + (contacts / STEP - 1) * PRICE_PER_STEP;

const INK = "#201e1d";
const CYAN = "#0088b0";
const MAGENTA = "#d6006c";
const N200 = "#eae7e7";
const N500 = "#9b9797";
const N600 = "#7d7979";
const N700 = "#605d5d";
const SANS = "'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif";
const MONO = "'IBM Plex Mono', ui-monospace, monospace";
const SERIF = "'Source Serif 4', Georgia, serif";

const CSS = `
.nomi-pricing-back:hover{color:${INK}!important}
.nomi-pricing-thumb:hover{transform:scale(1.1)}
.nomi-pricing-thumb:focus-visible{outline:2px solid ${CYAN};outline-offset:2px}
.nomi-pricing-cta:hover{background:#1186ac!important}
.nomi-pricing-cta:active{background:#006786!important}
.nomi-pricing-cta:focus-visible{outline:2px solid ${CYAN};outline-offset:2px}
`;

const KICKER: CSSProperties = { fontFamily: MONO, fontSize: 11, letterSpacing: "0.1em", color: N500 };
const PILL: CSSProperties = {
  display: "flex", alignItems: "center", gap: 8, padding: "7px 13px 7px 10px", borderRadius: 16,
  background: "#e5f5fb", color: "#004961", font: `500 13px ${SANS}`,
};

function Icon({ children, stroke = "currentColor", size = 15, width = 1.7 }: { children: ReactNode; stroke?: string; size?: number; width?: number }) {
  return <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke={stroke} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none" }} aria-hidden="true">{children}</svg>;
}

const FEATURES: { label: ReactNode | ((sends: string) => ReactNode); accent?: boolean; path: ReactNode }[] = [
  { label: (sends) => <>Up to <strong>{sends}</strong> monthly email sends</>, path: <path d="M17.5 2.5 L2.5 8.5 L9 11 L11.5 17.5 Z M9 11 L17.5 2.5" /> },
  { label: "Email campaigns", path: <><rect x="2.5" y="4.5" width="15" height="11" rx="1.5" /><path d="M3 5.5 L10 11 L17 5.5" /></> },
  { label: "Automated flows builder", path: <><circle cx="5" cy="5" r="2" /><circle cx="15" cy="5" r="2" /><circle cx="10" cy="15" r="2" /><path d="M5 7 V9 Q5 11 7 11 H13 Q15 11 15 9 V7 M10 11 V13" /></> },
  { label: "Nomi AI campaign builder", accent: true, path: <path d="M9 2.5 L10.6 7.4 L15.5 9 L10.6 10.6 L9 15.5 L7.4 10.6 L2.5 9 L7.4 7.4 Z M15 13 L15.7 15.3 L18 16 L15.7 16.7 L15 19 L14.3 16.7 L12 16 L14.3 15.3 Z" /> },
  { label: "Every essential email flow", path: <><rect x="3" y="3" width="14" height="14" rx="2" /><path d="M6.5 7 H13.5 M6.5 10 H13.5 M6.5 13 H10.5" /></> },
  { label: "Drag-and-drop email editor", path: <path d="M10 2.5 V17.5 M2.5 10 H17.5 M7.5 5 L10 2.5 L12.5 5 M7.5 15 L10 17.5 L12.5 15 M5 7.5 L2.5 10 L5 12.5 M15 7.5 L17.5 10 L15 12.5" /> },
  { label: "Gamified popups", path: <><rect x="3" y="8" width="14" height="9" rx="1" /><path d="M2 5.5 H18 V8 H2 Z M10 5.5 V17 M10 5.5 Q7 1.5 5.5 3.5 Q5 5.5 10 5.5 Q13 1.5 14.5 3.5 Q15 5.5 10 5.5" /></> },
  { label: "Full reporting & analytics", path: <path d="M3 17 H17 M5.5 14 V10 M9.5 14 V6 M13.5 14 V8.5" /> },
  { label: "Live customer support", path: <path d="M3.5 15.5 V5 Q3.5 3.5 5 3.5 H15 Q16.5 3.5 16.5 5 V11.5 Q16.5 13 15 13 H6.5 Z M7 7.5 H13 M7 10 H11" /> },
  { label: "Cancel anytime", path: <><circle cx="10" cy="10" r="7" /><path d="M7.5 7.5 L12.5 12.5 M12.5 7.5 L7.5 12.5" /></> },
];

export default function PricingPage() {
  const [contacts, setContacts] = useState(MIN_CONTACTS);
  const [ctaNote, setCtaNote] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const pct = `${((contacts - MIN_CONTACTS) / (MAX_CONTACTS - MIN_CONTACTS)) * 100}%`;
  const sends = fmt(contacts * SENDS_PER_CONTACT);

  const setFromX = (x: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    const t = Math.min(1, Math.max(0, (x - rect.left) / rect.width));
    setContacts(MIN_CONTACTS + Math.round(t * ((MAX_CONTACTS - MIN_CONTACTS) / STEP)) * STEP);
  };
  const onDown = (e: PointerEvent<HTMLDivElement>) => { dragging.current = true; e.currentTarget.setPointerCapture(e.pointerId); setFromX(e.clientX); };
  const onMove = (e: PointerEvent<HTMLDivElement>) => { if (dragging.current) setFromX(e.clientX); };
  const onUp = () => { dragging.current = false; };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const deltas: Record<string, number> = { ArrowRight: STEP, ArrowUp: STEP, ArrowLeft: -STEP, ArrowDown: -STEP, PageUp: STEP * 10, PageDown: -STEP * 10 };
    if (e.key === "Home") { e.preventDefault(); setContacts(MIN_CONTACTS); return; }
    if (e.key === "End") { e.preventDefault(); setContacts(MAX_CONTACTS); return; }
    const d = deltas[e.key];
    if (d) { e.preventDefault(); setContacts((c) => clamp(c + d)); }
  };

  return (
    <main style={{ minHeight: "100vh", background: "#faf9f9", color: INK, fontFamily: SANS, padding: "26px clamp(16px, 4vw, 30px) 64px", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 34 }}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <Link to="/app/brand-settings?section=plan" className="nomi-pricing-back" style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 44, color: N700, font: `500 13px ${SANS}`, width: "max-content", textDecoration: "none", transition: "color .16s ease" }}>
        <Icon size={16} width={1.8}><path d="M16 10 H5 M9 6 L5 10 L9 14" /></Icon>Plan &amp; billing
      </Link>

      <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 760 }}>
        <span style={{ ...KICKER, letterSpacing: "0.12em" }}>NOMI PRICING</span>
        <h1 style={{ margin: 0, font: `600 clamp(36px, 7vw, 48px)/1.02 ${SERIF}`, letterSpacing: "-0.03em", textWrap: "balance" } as CSSProperties}>
          Your store, <em style={{ fontStyle: "italic", fontWeight: 400, color: CYAN }}>growing.</em>
        </h1>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <span style={PILL}><Icon><circle cx="10" cy="10" r="7" /><path d="M10 6 V10 L12.8 11.8" /></Icon>7-day free trial</span>
          <span style={PILL}><Icon><path d="M3 7 H15 L12 4 M17 13 H5 L8 16" /></Icon>Free migration, on us</span>
          <span style={PILL}><Icon><path d="M4 12 V10 A6 6 0 0 1 16 10 V12" /><rect x="3" y="11" width="3" height="5" rx="1" /><rect x="14" y="11" width="3" height="5" rx="1" /></Icon>24/7 support</span>
        </div>
      </div>

      <section style={{ background: "#fff", border: `1px solid ${N200}`, borderRadius: 4, boxShadow: "0 1px 2px rgba(45,43,43,0.14)", padding: "clamp(20px, 4vw, 30px) clamp(18px, 4vw, 32px)", display: "flex", flexDirection: "column", gap: 30, maxWidth: 760, width: "100%", boxSizing: "border-box" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <span id="nomi-pricing-contacts-label" style={KICKER}>ACTIVE CONTACTS</span>
            <span style={{ font: `600 20px ${SERIF}` }}>Up to {fmt(contacts)}{contacts >= MAX_CONTACTS ? "+" : ""}</span>
          </div>
          <div ref={trackRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
            style={{ position: "relative", height: 28, cursor: "pointer", touchAction: "none", userSelect: "none" }}>
            <div style={{ position: "absolute", left: 0, right: 0, top: 12, height: 4, borderRadius: 2, background: N200 }} />
            <div style={{ position: "absolute", left: 0, top: 12, height: 4, borderRadius: 2, background: CYAN, width: pct }} />
            <div className="nomi-pricing-thumb" tabIndex={0} role="slider" aria-labelledby="nomi-pricing-contacts-label"
              aria-valuemin={MIN_CONTACTS} aria-valuemax={MAX_CONTACTS} aria-valuenow={contacts} aria-valuetext={`${fmt(contacts)} contacts, $${fmt(monthlyTotal(contacts))} per month`}
              onKeyDown={onKey}
              style={{ position: "absolute", top: 2, left: pct, width: 24, height: 24, marginLeft: -12, borderRadius: "50%", background: "#fff", border: `2px solid ${INK}`, boxSizing: "border-box", boxShadow: "0 1px 2px rgba(45,43,43,0.14)", cursor: "grab", transition: "transform .12s ease" }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontFamily: MONO, fontSize: 11, color: N500 }}><span>500</span><span>200,000+</span></div>
          <span style={{ font: `400 12.5px ${SANS}`, color: N600 }}>$15/mo for your first 500 contacts, then $5 for every additional 500.</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <h2 style={{ margin: 0, font: `600 18px ${SERIF}` }}>Everything in Nomi</h2>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: "14px 30px", font: `400 13.5px ${SANS}` }}>
            {FEATURES.map((feature, i) => (
              <li key={i} style={{ display: "flex", alignItems: "center", gap: 11 }}>
                <Icon size={18} width={1.6} stroke={feature.accent ? MAGENTA : CYAN}>{feature.path}</Icon>
                <span>{typeof feature.label === "function" ? feature.label(sends) : feature.label}</span>
              </li>
            ))}
          </ul>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 22, borderTop: `1px solid ${N200}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={KICKER}>YOUR TOTAL</span>
              <span aria-live="polite" style={{ font: `600 44px/1 ${SERIF}`, letterSpacing: "-0.02em" }}>
                ${fmt(monthlyTotal(contacts))}<span style={{ font: `400 15px ${SANS}`, color: N600, marginLeft: 4 }}>/mo</span>
              </span>
            </div>
            <button type="button" className="nomi-pricing-cta" onClick={() => setCtaNote(true)}
              style={{ font: `600 14px ${SANS}`, background: CYAN, color: "#fff", border: 0, minHeight: 44, padding: "13px 24px", borderRadius: 4, cursor: "pointer", transition: "background .16s ease" }}>
              Update plan
            </button>
          </div>
          {ctaNote ? <p role="status" style={{ margin: 0, font: `400 12.5px ${SANS}`, color: N700 }}>Nomi is in private beta. Plan changes open once Shopify billing is connected — nothing has been charged.</p> : null}
        </div>
      </section>
    </main>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
