import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode, type Ref } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useLocation, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { appEmbedEditorUrl, loadAppEmbedStatus, type AppEmbedState } from "../dashboard/app-embed.server";
import db from "../db.server";
import { authenticate } from "../shopify.server";

// First screen after install: the merchant turns on the "Nomi Script" app
// embed in their live theme. app.tsx redirects every other /app page here
// until the embed is detected, so this route owns the only way forward.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const status = await loadAppEmbedStatus(admin);
  if (status.state === "active") {
    await db.shopSettings.upsert({
      where: { shop: session.shop },
      create: { shop: session.shop, appEmbedVerifiedAt: new Date() },
      update: { appEmbedVerifiedAt: new Date() },
    });
  }
  return {
    state: status.state,
    themeName: status.themeName,
    // eslint-disable-next-line no-undef
    editorUrl: appEmbedEditorUrl(session.shop, process.env.SHOPIFY_API_KEY || ""),
  };
};

// Layout is inline on purpose: new classes in nomi.css have silently failed
// to apply inside the embedded admin iframe before. The scoped <style> below
// only carries hover/focus states, keyframes and breakpoints.
const INK = "#201e1d";
const PAPER = "#f3f2f2";
const N200 = "#eae7e7";
const N300 = "#d7d3d3";
const N600 = "#7d7979";
const N700 = "#605d5d";
const MAGENTA = "#d6006c";
const SANS = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";
const SERIF = "'Source Serif 4', Georgia, serif";
const CARD: CSSProperties = {
  background: "#fff",
  borderRadius: 4,
  boxShadow: "0 1px 2px rgba(45,43,43,.14)",
  boxSizing: "border-box",
};
const BUTTON: CSSProperties = {
  minHeight: 44,
  padding: "0 18px",
  borderRadius: 4,
  font: `600 15px ${SANS}`,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  whiteSpace: "nowrap",
  cursor: "pointer",
  textDecoration: "none",
  boxSizing: "border-box",
};
const PRIMARY: CSSProperties = { ...BUTTON, background: INK, color: PAPER, border: `1px solid ${INK}` };
const SECONDARY: CSSProperties = { ...BUTTON, background: "#fff", color: INK, border: `1px solid ${N300}` };
const DISABLED: CSSProperties = { opacity: 0.4, cursor: "not-allowed" };

const STATUS_TAG: Record<string, { label: string; style: CSSProperties }> = {
  active: { label: "Active", style: { color: "#004961", background: "#dff4f8" } },
  inactive: { label: "Inactive", style: { color: N700, background: N200 } },
  unknown: { label: "Couldn't check", style: { color: "#8a0046", background: "#fde7f1" } },
  checking: { label: "Checking…", style: { color: N700, background: "#fff", boxShadow: `inset 0 0 0 1px ${N300}` } },
};

export default function Setup() {
  const initial = useLoaderData<typeof loader>();
  const { editorUrl } = initial;
  const navigate = useNavigate();
  const location = useLocation();
  const [status, setStatus] = useState<{ state: AppEmbedState; themeName: string | null }>({ state: initial.state, themeName: initial.themeName });
  const [checking, setChecking] = useState(false);
  const [offline, setOffline] = useState(false);
  const [openedEditor, setOpenedEditor] = useState(false);
  // True once a re-check sees the embed flip to Active during this visit;
  // the page then hands the merchant straight to Brand Studio onboarding.
  const [justActivated, setJustActivated] = useState(false);
  // Set when a check after opening the editor still reads Inactive: the
  // merchant came back (or saved) without the Nomi Script toggle on.
  const [stillOff, setStillOff] = useState(false);
  const [showMe, setShowMe] = useState(0);
  const exampleRef = useRef<HTMLElement>(null);
  const inFlight = useRef(false);

  const { state, themeName } = status;
  const active = state === "active";
  const statusKey = checking ? "checking" : state;

  // `returned` means the merchant just came back to this tab. Coming back
  // from an editor they opened here with the embed on hands off to Brand
  // Studio even if this page already read Active; otherwise only an
  // Inactive → Active flip does, so a background poll never jumps early.
  const recheck = useCallback(async ({ returned = false, quiet = false }: { returned?: boolean; quiet?: boolean } = {}) => {
    if (inFlight.current) return;
    inFlight.current = true;
    if (!quiet) setChecking(true);
    try {
      const response = await fetch("/app/setup-status", { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`status ${response.status}`);
      const next = (await response.json()) as { state: AppEmbedState; themeName: string | null };
      setStatus((previous) => {
        if (next.state === "active" && (previous.state !== "active" || (returned && openedEditor))) setJustActivated(true);
        return next;
      });
      setOffline(false);
      setStillOff(next.state === "inactive" && openedEditor);
    } catch {
      // A background poll failing isn't worth interrupting the merchant.
      if (!quiet) setOffline(true);
    } finally {
      inFlight.current = false;
      setChecking(false);
    }
  }, [openedEditor]);

  const pointToToggle = () => {
    exampleRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    setShowMe((n) => n + 1);
  };

  // The theme editor opens in a new tab. When the merchant comes back after
  // saving, re-read the theme so the status flips without a manual click.
  useEffect(() => {
    if (active && !openedEditor) return;
    const onReturn = () => {
      if (document.visibilityState === "visible") recheck({ returned: true });
    };
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [active, openedEditor, recheck]);

  // While the editor is open in the other tab and the embed is still off,
  // keep checking so this tab is already heading to Brand Studio by the
  // time the merchant switches back.
  useEffect(() => {
    if (active || !openedEditor) return;
    const timer = window.setInterval(() => recheck({ quiet: true }), 4000);
    return () => window.clearInterval(timer);
  }, [active, openedEditor, recheck]);

  useEffect(() => {
    if (!justActivated) return;
    const timer = window.setTimeout(() => navigate(`/app/brand-studio${location.search}`), 1200);
    return () => window.clearTimeout(timer);
  }, [justActivated, navigate, location.search]);

  // The theme editor can't report which panel is open, so steps 2–4 only
  // tick together once Nomi reads the saved embed.
  const TOGGLE_STEP = 2;
  const steps: { text: ReactNode; done: boolean }[] = [
    { text: "Open your theme editor.", done: openedEditor || active },
    { text: <>Click the <strong>App embeds</strong> icon in the editor&rsquo;s left toolbar.</>, done: active },
    { text: <>Turn the <strong>Nomi Script</strong> toggle on.</>, done: active },
    { text: <>Click <strong>Save</strong> at the top right, then come back to this tab. Nomi takes you to Brand Studio.</>, done: active },
  ];

  // Unknown means Shopify's theme read failed; app.tsx fails open in that
  // case, so the merchant isn't stuck here either.
  const canContinue = active || state === "unknown";
  const cont = () => navigate(`/app/brand-studio${location.search}`);

  return (
    <main
      className="nomi-setup"
      style={{ minHeight: "100vh", background: PAPER, color: INK, fontFamily: SANS, padding: "40px 32px 56px", boxSizing: "border-box" }}
    >
      <style>{SETUP_CSS}</style>
      <div style={{ maxWidth: 1240, margin: "0 auto 28px", display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ width: 40, height: 40, background: INK, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
          <NomiGlyph size={22} />
        </span>
        <span style={{ font: `600 22px/1 ${SERIF}`, letterSpacing: "-0.02em" }}>Nomi</span>
        <span style={{ font: `14px ${SANS}`, color: N600, marginLeft: 8 }}>Setup · Theme</span>
      </div>

      <div style={{ maxWidth: 1240, margin: "0 auto", display: "flex", flexWrap: "wrap", gap: 24, alignItems: "flex-start" }}>
        <div style={{ flex: "1 1 360px", minWidth: 0, display: "flex", flexDirection: "column", gap: 24 }}>
          <section className="nomi-setup-card" style={{ ...CARD, padding: "40px 44px", display: "flex", flexDirection: "column", gap: 20 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <h1 style={{ margin: 0, font: `600 28px/1.15 ${SERIF}`, letterSpacing: "-0.02em" }}>Enable Nomi on your theme</h1>
              <p style={{ margin: 0, font: `16px/1.55 ${SANS}`, color: N700 }}>
                Nomi needs its script on your store to show the sign-up pop-up and send emails based on what visitors do.
              </p>
            </div>
            <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
              {steps.map((step, index) => {
                const current = !step.done && (index === 0 || steps[index - 1].done);
                const flagged = stillOff && !active && index === TOGGLE_STEP;
                return (
                  <li key={index} style={{ display: "flex", gap: 12, alignItems: "baseline", font: `16px/1.5 ${SANS}`, color: step.done ? N600 : INK }}>
                    <span
                      aria-hidden="true"
                      style={{
                        width: 22, height: 22, flex: "none", borderRadius: "50%", boxSizing: "border-box",
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                        background: step.done ? INK : "#fff",
                        border: `1.5px solid ${flagged ? MAGENTA : step.done || current ? INK : N300}`,
                        color: step.done ? PAPER : flagged ? MAGENTA : current ? INK : N600,
                        font: `600 12px ${SANS}`, transform: "translateY(4px)",
                      }}
                    >
                      {step.done ? <CheckIcon /> : index + 1}
                    </span>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 12, minWidth: 0 }}>
                      <span>
                        {step.text}
                        {step.done && <span className="nomi-setup-sr"> (done)</span>}
                      </span>
                      {/* Step 1 is the only step Nomi can act on, so its button sits with it. */}
                      {index === 0 ? (
                        <a
                          className="nomi-setup-primary is-pulsing"
                          href={editorUrl}
                          target="_blank"
                          rel="noreferrer"
                          onClick={() => setOpenedEditor(true)}
                          style={{ ...PRIMARY, marginBottom: 6, borderRadius: 999, padding: "0 20px 0 8px", gap: 10 }}
                        >
                          {/* Same numbered-pill grammar as the practice panel's callouts. */}
                          <span aria-hidden="true" style={{ width: 28, height: 28, borderRadius: "50%", background: PAPER, color: INK, display: "inline-flex", alignItems: "center", justifyContent: "center", font: `600 13px/1 ${SANS}`, flex: "none" }}>1</span>
                          {stillOff && !active ? "Open theme editor again" : "Open theme editor"}
                          <ExternalIcon />
                        </a>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>

          <section className="nomi-setup-card" style={{ ...CARD, padding: "36px 44px", display: "flex", flexDirection: "column", gap: 20 }} aria-live="polite">
            <h2 style={{ margin: 0, font: `600 24px/1.2 ${SERIF}`, letterSpacing: "-0.015em" }}>Nomi Script status</h2>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", font: `16px ${SANS}` }}>
              <span style={{ color: N700 }}>App embed:</span>
              <span style={{ ...STATUS_TAG[statusKey].style, padding: "4px 10px", borderRadius: 999, font: `600 13px ${SANS}` }}>
                {STATUS_TAG[statusKey].label}
              </span>
            </div>
            {stillOff && !active && !checking ? (
              <div role="alert" className="nomi-setup-in" style={{ display: "flex", gap: 14, alignItems: "flex-start", padding: "16px 18px", borderRadius: 4, background: "#fdf1f6", boxShadow: `inset 3px 0 0 ${MAGENTA}` }}>
                <span className="nomi-setup-nudge" aria-hidden="true" style={{ flex: "none", width: 32, height: 32, borderRadius: "50%", background: "#fff", color: MAGENTA, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 1px 2px rgba(45,43,43,.14)" }}>
                  <PointerIcon />
                </span>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
                  <strong style={{ font: `600 16px/1.3 ${SERIF}`, color: INK }}>Turn on Nomi Script first</strong>
                  <span style={{ font: `15px/1.5 ${SANS}`, color: N700 }}>
                    Nomi Script is still off in {themeName ?? "your live theme"}. In the theme editor, click the <strong>App embeds</strong> icon in the left toolbar, turn <strong>Nomi Script</strong> on, then click Save.
                  </span>
                  <button type="button" onClick={pointToToggle} className="nomi-setup-link" style={{ alignSelf: "flex-start", minHeight: 44, padding: 0, border: 0, background: "transparent", color: "#006786", font: `600 14px ${SANS}`, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
                    Show me the toggle <span aria-hidden="true">→</span>
                  </button>
                </div>
              </div>
            ) : null}
            {offline && !checking ? (
              <p role="status" style={{ margin: 0, font: `14px/1.5 ${SANS}`, color: N700 }}>
                Couldn&rsquo;t reach Nomi to check your theme. Check your connection and click Check again.
              </p>
            ) : null}
            {stillOff && !active && !checking ? null : <p style={{ margin: 0, font: `15px/1.5 ${SANS}`, color: N600 }}>
              {justActivated
                ? "Nomi Script is on. Opening Brand Studio…"
                : active
                ? `Nomi is running on ${themeName ?? "your live theme"}.`
                : state === "unknown"
                  ? "Shopify didn't return your theme settings. Try again, or continue and check later from the dashboard."
                  : openedEditor
                    ? "Waiting for you to save in the theme editor. This updates when you come back to this tab."
                    : `Nomi Script isn't on in ${themeName ?? "your live theme"} yet.`}
            </p>}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, flexWrap: "wrap" }}>
              <button type="button" className="nomi-setup-secondary" onClick={() => recheck()} disabled={checking} style={{ ...SECONDARY, ...(checking ? DISABLED : null) }}>
                Check again
              </button>
              <button type="button" className="nomi-setup-primary" onClick={cont} disabled={!canContinue} style={{ ...PRIMARY, minWidth: 120, ...(!canContinue ? DISABLED : null) }}>
                {active ? "Continue to Brand Studio" : "Continue"}
              </button>
            </div>
          </section>
        </div>

        <SetupExample sectionRef={exampleRef} flag={stillOff && !active} showMe={showMe} />
      </div>

    </main>
  );
}

// A practice copy of Shopify's App embeds panel. It never touches the real
// theme — the status card above is the only source of truth.
function SetupExample({ sectionRef, flag, showMe }: { sectionRef: Ref<HTMLElement>; flag: boolean; showMe: number }) {
  const [on, setOn] = useState(false);
  const [saved, setSaved] = useState(false);
  const [popup, setPopup] = useState(false);
  const step = !on ? 1 : !saved ? 2 : 3;
  // "Show me the toggle" resets the practice panel so the pointer lands on it.
  useEffect(() => {
    if (!showMe) return;
    setOn(false);
    setSaved(false);
    setPopup(false);
  }, [showMe]);
  const pointAtToggle = flag && step === 1;

  return (
    <section
      ref={sectionRef}
      className="nomi-setup-example"
      aria-label="Setup example"
      style={{ ...CARD, flex: "1.5 1 520px", minWidth: 0, padding: "28px 28px 32px", display: "flex", flexDirection: "column", gap: 16 }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, font: `600 17px ${SERIF}` }}>Setup example</h3>
        <span style={{ font: `italic 14px ${SANS}`, color: N600 }}>
          {step === 3 ? "That's it. " : ""}Practice here. This doesn&rsquo;t change your store.
        </span>
      </div>

      <div style={{ position: "relative", border: `1px solid ${N300}`, borderRadius: 14, overflow: "hidden", background: "#fff", display: "flex", flexDirection: "column", minHeight: 460 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "12px 16px", borderBottom: `1px solid ${N200}` }}>
          <ExitIcon />
          <span style={{ font: `600 16px ${SERIF}` }}>Nomi</span>
          <span aria-hidden="true" style={{ font: `700 16px ${SANS}`, color: N600, letterSpacing: 2 }}>···</span>
          <div style={{ flex: 1 }} />
          <span className="nomi-setup-callout-save" style={{ display: "inline-flex", alignItems: "center", marginRight: -8, opacity: step === 2 ? 1 : 0.35, transition: "opacity .2s" }}>
            <Callout number={4} label="Save" />
            <span style={{ width: 22, borderTop: `1.5px dashed ${INK}` }} />
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: INK, flex: "none" }} />
          </span>
          <button
            type="button"
            className={step === 2 ? "is-pulsing" : ""}
            onClick={() => {
              setSaved(true);
              setPopup(true);
            }}
            disabled={step !== 2}
            style={{
              border: 0, borderRadius: 4, minHeight: 44, padding: "0 16px", font: `600 14px ${SANS}`,
              cursor: step === 2 ? "pointer" : "default",
              background: step === 2 ? INK : N200,
              color: step === 2 ? PAPER : N600,
            }}
          >
            {saved ? "Saved" : "Save"}
          </button>
        </div>

        <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
          <div className="nomi-setup-rail" style={{ width: 56, flex: "none", borderRight: `1px solid ${N200}`, display: "flex", flexDirection: "column", alignItems: "center", gap: 8, paddingTop: 14 }}>
            <RailIcon><path d="M224 128a8 8 0 0 1-8 8H40a8 8 0 0 1 0-16h176a8 8 0 0 1 8 8ZM40 72h176a8 8 0 0 0 0-16H40a8 8 0 0 0 0 16Zm176 112H40a8 8 0 0 0 0 16h176a8 8 0 0 0 0-16Z" /></RailIcon>
            <RailIcon><path d="M128 80a48 48 0 1 0 48 48 48.05 48.05 0 0 0-48-48Zm0 80a32 32 0 1 1 32-32 32 32 0 0 1-32 32Z" /><circle cx="128" cy="128" r="88" fill="none" stroke={N700} strokeWidth="16" strokeDasharray="22 12" /></RailIcon>
            <span title="App embeds" style={{ position: "relative", width: 38, height: 38, borderRadius: 4, background: "#e9f8ff", boxShadow: "inset 0 0 0 1.5px #0088b0", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span aria-hidden="true" style={{ position: "absolute", top: -7, right: -7, width: 18, height: 18, borderRadius: "50%", background: INK, color: PAPER, font: `600 10px/1 ${SANS}`, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 0 2px #fff" }}>2</span>
              <svg width="20" height="20" viewBox="0 0 256 256" fill="#006786" aria-hidden="true"><rect x="40" y="40" width="72" height="72" rx="8" opacity=".25" /><rect x="40" y="144" width="72" height="72" rx="8" opacity=".25" /><rect x="144" y="144" width="72" height="72" rx="8" opacity=".25" /><path d="M172 44a8 8 0 0 1 16 0v28h28a8 8 0 0 1 0 16h-28v28a8 8 0 0 1-16 0V88h-28a8 8 0 0 1 0-16h28Z" /></svg>
            </span>
          </div>

          <div className="nomi-setup-embeds" style={{ width: 300, flex: "none", borderRight: `1px solid ${N200}`, display: "flex", flexDirection: "column", minWidth: 0 }}>
            <div style={{ padding: "18px 18px 14px", font: `600 18px ${SERIF}`, borderBottom: `1px solid ${N200}` }}>App embeds</div>
            <div style={{ padding: "14px 18px", borderBottom: `1px solid ${N200}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, border: `1px solid ${N300}`, borderRadius: 4, padding: "8px 12px", font: `14px ${SANS}`, color: N600 }}>
                <svg width="15" height="15" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="m229.66 218.34-50.07-50.06a88.11 88.11 0 1 0-11.31 11.31l50.06 50.07a8 8 0 0 0 11.32-11.32ZM40 112a72 72 0 1 1 72 72 72.08 72.08 0 0 1-72-72Z" /></svg>
                Search app embeds
              </div>
            </div>
            <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 10, padding: "16px 18px", borderBottom: `1px solid ${N200}` }}>
              <span style={{ width: 28, height: 28, borderRadius: 6, background: INK, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                <NomiGlyph size={15} />
              </span>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                <span style={{ font: `600 15px ${SERIF}` }}>Nomi Script</span>
                <span style={{ font: `13px ${SANS}`, color: N600 }}>Nomi</span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label="Practice toggle for Nomi Script"
                className={pointAtToggle ? "is-flagged" : step === 1 ? "is-pulsing" : ""}
                onClick={() => {
                  setOn((value) => !value);
                  setSaved(false);
                  setPopup(false);
                }}
                style={{ width: 44, height: 44, border: 0, padding: 0, background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 12 }}
              >
                <span style={{ width: 42, height: 24, borderRadius: 12, padding: 3, boxSizing: "border-box", background: on ? INK : N300, display: "flex", justifyContent: on ? "flex-end" : "flex-start", transition: "background .2s" }}>
                  <span style={{ width: 18, height: 18, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 2px rgba(45,43,43,.14)" }} />
                </span>
              </button>
              <div
                aria-hidden="true"
                style={{ position: "absolute", right: 40, top: "50%", marginTop: 16, display: "flex", flexDirection: "column", alignItems: "flex-end", zIndex: 2, pointerEvents: "none", opacity: step === 1 ? 1 : 0.35, transition: "opacity .2s" }}
              >
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: pointAtToggle ? MAGENTA : INK, marginRight: -3 }} />
                <span style={{ height: 78, borderLeft: `1.5px dashed ${pointAtToggle ? MAGENTA : INK}` }} />
                <span style={{ marginRight: -24 }}><Callout number={3} label={pointAtToggle ? "Turn this on before you save" : "Turn on Nomi Script"} accent={pointAtToggle} /></span>
              </div>
            </div>
          </div>

          <div className="nomi-setup-store" style={{ flex: 1, minWidth: 0, background: "#f8f4f4", padding: 14, display: "flex" }}>
            <div style={{ flex: 1, background: "#fff", borderRadius: 6, position: "relative", overflow: "hidden", display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "14px 18px" }}>
                <span style={{ font: `italic 15px ${SERIF}`, color: N600 }}>your store</span>
              </div>
              <div style={{ flex: 1, margin: "0 14px 14px", background: N200, borderRadius: 4, display: "flex", flexDirection: "column", justifyContent: "flex-end", padding: 18, gap: 8 }}>
                <span style={{ height: 10, width: "60%", background: N300, borderRadius: 2 }} />
                <span style={{ height: 10, width: "40%", background: N300, borderRadius: 2 }} />
              </div>
              {popup && (
                <div className="nomi-setup-in" style={{ position: "absolute", inset: 0, background: "rgba(32,30,29,.3)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
                  <div style={{ ...CARD, boxShadow: "0 12px 32px rgba(45,43,43,.22)", padding: 20, maxWidth: 200, display: "flex", flexDirection: "column", gap: 10, position: "relative" }}>
                    <button type="button" onClick={() => setPopup(false)} aria-label="Close preview pop-up" style={{ position: "absolute", top: 2, right: 2, width: 32, height: 32, border: 0, background: "transparent", cursor: "pointer", color: N600, font: `18px ${SANS}` }}>×</button>
                    <span style={{ font: `600 11px ${SANS}`, letterSpacing: ".12em", textTransform: "uppercase", color: "#d6006c" }}>Nomi is live</span>
                    <span style={{ font: `600 18px/1.2 ${SERIF}` }}>Get 10% off your first order</span>
                    <span style={{ height: 30, border: `1px solid ${N300}`, borderRadius: 2 }} />
                    <span style={{ height: 30, background: "#0088b0", borderRadius: 2 }} />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Callout({ number, label, accent = false }: { number: number; label: string; accent?: boolean }) {
  return (
    <span className={accent ? "nomi-setup-in" : undefined} style={{ display: "inline-flex", alignItems: "center", gap: 8, background: accent ? MAGENTA : INK, color: accent ? "#fff" : PAPER, font: `500 13px/1 ${SANS}`, padding: "6px 12px 6px 6px", borderRadius: 999, boxShadow: "0 3px 10px rgba(45,43,43,.16)", whiteSpace: "nowrap" }}>
      <span style={{ width: 20, height: 20, borderRadius: "50%", background: PAPER, color: accent ? MAGENTA : INK, display: "inline-flex", alignItems: "center", justifyContent: "center", font: `600 11px/1 ${SANS}` }}>{number}</span>
      {label}
    </span>
  );
}

function NomiGlyph({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="10 10 44 44" fill="none" stroke="#ffffff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M50 16 L14 30 L29 36 L50 16 Z" />
      <path d="M29 36 L33 50 L50 16" />
    </svg>
  );
}

function RailIcon({ children }: { children: ReactNode }) {
  return (
    <span style={{ width: 38, height: 38, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <svg width="20" height="20" viewBox="0 0 256 256" fill={N700} aria-hidden="true">{children}</svg>
    </span>
  );
}

function ExitIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 256 256" fill={N700} aria-hidden="true">
      <path d="M120 216a8 8 0 0 1-8 8H48a8 8 0 0 1-8-8V40a8 8 0 0 1 8-8h64a8 8 0 0 1 0 16H56v160h56a8 8 0 0 1 8 8Zm109.66-93.66-40-40a8 8 0 0 0-11.32 11.32L204.69 120H112a8 8 0 0 0 0 16h92.69l-26.35 26.34a8 8 0 0 0 11.32 11.32l40-40a8 8 0 0 0 0-11.32Z" />
    </svg>
  );
}

function ExternalIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
      <path d="M224 104a8 8 0 0 1-16 0V59.32l-66.33 66.34a8 8 0 0 1-11.32-11.32L196.68 48H152a8 8 0 0 1 0-16h64a8 8 0 0 1 8 8Zm-40 24a8 8 0 0 0-8 8v72H48V80h72a8 8 0 0 0 0-16H48a16 16 0 0 0-16 16v128a16 16 0 0 0 16 16h128a16 16 0 0 0 16-16v-72a8 8 0 0 0-8-8Z" />
    </svg>
  );
}

function PointerIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
      <path d="M216 108v40a88 88 0 0 1-176 0v-4a20 20 0 0 1 32.63-15.53A20 20 0 0 1 72 124V44a20 20 0 0 1 40 0v36.4a20 20 0 0 1 28 8.07 20 20 0 0 1 36 11.57 20 20 0 0 1 40 8Zm-16 0a4 4 0 0 0-8 0v12a8 8 0 0 1-16 0v-20a4 4 0 0 0-8 0v12a8 8 0 0 1-16 0V100a4 4 0 0 0-8 0v12a8 8 0 0 1-16 0V44a4 4 0 0 0-8 0v112a8 8 0 0 1-14.93 4L73.38 139a4 4 0 0 0-7.4 3v6a72 72 0 0 0 144 0Z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
    </svg>
  );
}

const SETUP_CSS = `
@keyframes nomi-setup-pulse{0%{box-shadow:0 0 0 0 rgba(32,30,29,.35)}100%{box-shadow:0 0 0 12px rgba(32,30,29,0)}}
@keyframes nomi-setup-flag{0%{box-shadow:0 0 0 0 rgba(214,0,108,.45)}100%{box-shadow:0 0 0 14px rgba(214,0,108,0)}}
@keyframes nomi-setup-nudge{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}
@keyframes nomi-setup-in{0%{opacity:0;transform:translateY(8px)}100%{opacity:1;transform:none}}
.nomi-setup .is-pulsing{animation:nomi-setup-pulse 1.4s ease-out infinite}
.nomi-setup .nomi-setup-in{animation:nomi-setup-in .3s ease both}
.nomi-setup .is-flagged{animation:nomi-setup-flag 1.1s ease-out infinite}
.nomi-setup .nomi-setup-nudge svg{animation:nomi-setup-nudge 1.2s ease-in-out infinite}
.nomi-setup .nomi-setup-link:hover{color:#004961 !important;text-decoration:underline}
.nomi-setup .nomi-setup-primary:hover:not(:disabled){background:#444141 !important;border-color:#444141 !important}
.nomi-setup .nomi-setup-secondary:hover:not(:disabled){border-color:#201e1d !important}
.nomi-setup a:focus-visible,.nomi-setup button:focus-visible{outline:2px solid #0088b0;outline-offset:2px}
.nomi-setup-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@media (max-width: 1100px){.nomi-setup .nomi-setup-store{display:none !important}.nomi-setup .nomi-setup-embeds{flex:1 1 auto !important;width:auto !important;border-right:0 !important}}
@media (max-width: 640px){
  .nomi-setup{padding:20px 16px 40px !important}
  .nomi-setup .nomi-setup-card{padding:28px 20px !important}
  .nomi-setup .nomi-setup-example{padding:20px 16px 24px !important;flex-basis:100% !important}
  .nomi-setup .nomi-setup-rail{display:none !important}
  .nomi-setup .nomi-setup-callout-save{display:none !important}
}
@media (prefers-reduced-motion: reduce){.nomi-setup .is-pulsing,.nomi-setup .is-flagged,.nomi-setup .nomi-setup-nudge svg,.nomi-setup .nomi-setup-in{animation:none}}
`;

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
