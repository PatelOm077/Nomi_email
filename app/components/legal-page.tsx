import type { ReactNode } from "react";

// Public legal pages (/privacy, /terms). Served outside the embedded admin,
// so they carry their own Nomi styling instead of nomi.css.
export const LEGAL_UPDATED = "28 September 2026";
export const LEGAL_CONTACT = "ombarvaliya7@gmail.com";

const css = `
.nomi-legal{min-height:100vh;background:#f3f2f2;color:#201e1d;font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:56px 16px 80px}
.nomi-legal main{max-width:720px;margin:0 auto}
.nomi-legal .lockup{display:inline-flex;align-items:center;gap:10px;margin:0 0 40px;color:#201e1d;text-decoration:none;font:700 24px/1 "Source Serif 4",Georgia,serif;letter-spacing:-.015em}
.nomi-legal .lockup img{display:block;border-radius:8px}
.nomi-legal .kicker{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#6b6765;margin:0 0 12px}
.nomi-legal h1{font-family:"Source Serif 4",Georgia,serif;font-weight:500;font-size:clamp(34px,6vw,48px);line-height:1.1;margin:0 0 12px}
.nomi-legal .lede{font-size:18px;color:#48443f;margin:0 0 8px}
.nomi-legal .updated{font-size:14px;color:#6b6765;margin:0 0 40px;padding-bottom:28px;border-bottom:1px solid #d9d6d3}
.nomi-legal h2{font-family:"Source Serif 4",Georgia,serif;font-weight:500;font-size:24px;line-height:1.25;margin:40px 0 10px}
.nomi-legal h3{font-size:16px;margin:24px 0 6px}
.nomi-legal p,.nomi-legal li{max-width:66ch}
.nomi-legal ul{padding-left:20px}
.nomi-legal li{margin:6px 0}
.nomi-legal a{color:#00789e}
.nomi-legal table{width:100%;border-collapse:collapse;margin:12px 0;font-size:15px;background:#fff;border:1px solid #d9d6d3}
.nomi-legal th,.nomi-legal td{text-align:left;vertical-align:top;padding:10px 12px;border-bottom:1px solid #d9d6d3}
.nomi-legal th{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#6b6765;font-weight:600}
.nomi-legal .table-wrap{overflow-x:auto}
.nomi-legal footer{margin-top:56px;padding-top:24px;border-top:1px solid #d9d6d3;font-size:14px;color:#6b6765}
`;

export function legalMeta(title: string, description: string) {
  return [
    { title: `${title} · Nomi` },
    { name: "description", content: description },
  ];
}

export const legalLinks = () => [
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Source+Serif+4:wght@400;500;600;700&display=swap",
  },
];

export function LegalPage({
  kicker,
  title,
  lede,
  children,
}: {
  kicker: string;
  title: string;
  lede: string;
  children: ReactNode;
}) {
  return (
    <div className="nomi-legal">
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <main>
        <a href="/privacy" className="lockup" aria-label="Nomi">
          <img src="/nomi-mark.svg" alt="" width="36" height="36" />
          <span>Nomi</span>
        </a>
        <p className="kicker">{kicker}</p>
        <h1>{title}</h1>
        <p className="lede">{lede}</p>
        <p className="updated">Last updated {LEGAL_UPDATED}</p>
        {children}
        <footer>
          Nomi · <a href="/privacy">Privacy policy</a> ·{" "}
          <a href="/terms">Terms and data processing agreement</a> ·{" "}
          <a href={`mailto:${LEGAL_CONTACT}`}>{LEGAL_CONTACT}</a>
        </footer>
      </main>
    </div>
  );
}
