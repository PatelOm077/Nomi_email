// Brand & Settings — a tabbed settings shell mirroring the Flow Editor's page
// header, with a left contents rail and a right detail panel. Fully static:
// no loader, no real merchant data. None of the five sections (profile,
// branding, sender info, plan, excluded products) are wired to persistence
// yet, so every field renders its empty-value dash rather than a fabricated
// value — the one exception is the plan tier, which mirrors the flat-price
// decision already made in DECISIONS.md.
import { useState } from "react";

type SectionId = "profile" | "branding" | "sender" | "plan" | "excluded";

const SECTIONS: { id: SectionId; label: string; icon: SectionId }[] = [
  { id: "profile", label: "Profile", icon: "profile" },
  { id: "branding", label: "Branding", icon: "branding" },
  { id: "sender", label: "Sender info", icon: "sender" },
  { id: "plan", label: "Plan & billing", icon: "plan" },
  { id: "excluded", label: "Excluded products", icon: "excluded" },
];

function SectionIcon({ id }: { id: SectionId }) {
  switch (id) {
    case "profile":
      return (
        <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="10" cy="7" r="3.1" />
          <path d="M4.2 17c.3-3.6 3.1-5.6 5.8-5.6s5.5 2 5.8 5.6" />
        </svg>
      );
    case "branding":
      return (
        <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="2.5" y="4" width="15" height="12" rx="2" />
          <circle cx="7.5" cy="8.5" r="1.3" />
          <path d="M4 14.5 L8 10.5 L11 13.5 L14 9.5 L17.5 13" />
        </svg>
      );
    case "sender":
      return (
        <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="2.5" y="5" width="15" height="10.5" rx="1.5" />
          <path d="M3 6 L10 11.5 L17 6" />
        </svg>
      );
    case "plan":
      return (
        <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M5 2.5 H15 V17 L13 15.5 L11 17 L9 15.5 L7 17 L5 15.5 Z" />
          <path d="M7.5 7 H12.5 M7.5 10.5 H12.5" />
        </svg>
      );
    case "excluded":
      return (
        <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="10" cy="10" r="2.6" />
          <path d="M10 3.5 V5.5 M10 14.5 V16.5 M3.5 10 H5.5 M14.5 10 H16.5 M5.5 5.5 L6.9 6.9 M13.1 13.1 L14.5 14.5 M5.5 14.5 L6.9 13.1 M13.1 6.9 L14.5 5.5" />
        </svg>
      );
  }
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="nomi-brand-field">
      <span>{label}</span>
      <span className={value ? undefined : "nomi-brand-field-empty"}>{value ?? "—"}</span>
    </div>
  );
}

export default function BrandSettingsPage() {
  const [active, setActive] = useState<SectionId>("profile");
  const [hovered, setHovered] = useState<SectionId | null>(null);

  return (
    <main className="nomi-flow-page nomi-brand-settings-page">
      <div className="nomi-flow-shell">
        <header className="nomi-flow-header">
          <div className="nomi-flow-title">
            <span className="nomi-flow-reference-arrow" aria-hidden="true">←</span>
            <h1>Brand &amp; Settings</h1>
          </div>
        </header>

        <div className="nomi-brand-layout">
          <nav className="nomi-brand-rail" aria-label="Settings sections">
            <span className="nomi-brand-rail-kicker">Contents</span>
            {SECTIONS.map((section, index) => {
              const isActive = section.id === active;
              const isHovered = section.id === hovered;
              return (
                <button
                  key={section.id}
                  type="button"
                  className={
                    "nomi-brand-rail-item" +
                    (isActive ? " nomi-brand-rail-item-active" : "") +
                    (isHovered && !isActive ? " nomi-brand-rail-item-hover" : "")
                  }
                  onClick={() => setActive(section.id)}
                  onMouseEnter={() => setHovered(section.id)}
                  onMouseLeave={() => setHovered(null)}
                >
                  <span className="nomi-brand-rail-icon"><SectionIcon id={section.icon} /></span>
                  <span className="nomi-brand-rail-label">{section.label}</span>
                  {isHovered && !isActive ? (
                    <span className="nomi-brand-rail-arrow" aria-hidden="true">→</span>
                  ) : (
                    <span className="nomi-brand-rail-num">{String(index + 1).padStart(2, "0")}</span>
                  )}
                </button>
              );
            })}
          </nav>

          <div className="nomi-brand-panel">
            {active === "profile" && (
              <section className="nomi-brand-profile">
                <span className="nomi-brand-initial">B</span>
                <div className="nomi-brand-profile-body">
                  <p>
                    <strong>Profile.</strong> This information is not visible to your
                    customers &amp; email recipients.
                  </p>
                  <div className="nomi-brand-field-grid">
                    <Field label="First name" value={null} />
                    <Field label="Last name" value={null} />
                    <Field label="Email" value={null} />
                    <Field label="Phone number" value={null} />
                  </div>
                </div>
              </section>
            )}

            {active === "branding" && (
              <section className="nomi-brand-section">
                <h2>Branding</h2>
                <p>
                  Update your branding assets to guide your campaigns&rsquo; look and
                  feel. Logo changes automatically update your email flows.
                </p>
                <div className="nomi-brand-row">
                  <span className="nomi-brand-row-label">
                    Logo &amp; colors <em>— edit your brand logo, colors &amp; language.</em>
                  </span>
                  <button type="button" className="nomi-brand-link">Regenerate flows</button>
                  <button type="button" className="nomi-brand-link nomi-brand-link-accent">Edit branding</button>
                </div>
              </section>
            )}

            {active === "sender" && (
              <section className="nomi-brand-section">
                <h2>Sender info</h2>
                <div className="nomi-brand-subsection">
                  <span className="nomi-brand-rail-kicker">Name &amp; website</span>
                  <div className="nomi-brand-field-grid">
                    <Field label="Company name" value={null} />
                    <Field label="Website" value={null} />
                  </div>
                </div>
                <div className="nomi-brand-subsection">
                  <span className="nomi-brand-rail-kicker">Address</span>
                  <div className="nomi-brand-field-grid">
                    <Field label="Country" value={null} />
                    <Field label="State / Province / Territory" value={null} />
                    <Field label="City" value={null} />
                    <Field label="Zip code" value={null} />
                  </div>
                  <div className="nomi-brand-field-grid nomi-brand-field-grid-1">
                    <Field label="Address" value={null} />
                  </div>
                </div>
                <p className="nomi-brand-legal">
                  Including your complete business address in marketing emails is
                  required to comply with international regulations (CAN-SPAM,
                  GDPR, CASL). This information is legally mandated in many
                  jurisdictions, builds recipient trust, and helps avoid
                  penalties. Removal may result in legal consequences.
                </p>
              </section>
            )}

            {active === "plan" && (
              <section className="nomi-brand-plan">
                <span className="nomi-brand-rail-kicker">Plan</span>
                <span className="nomi-brand-plan-name">Pro AI</span>
                <button type="button" className="nomi-brand-link nomi-brand-link-accent">View the pricing scale</button>
              </section>
            )}

            {active === "excluded" && (
              <section className="nomi-brand-section">
                <h2>Excluded products</h2>
                <p>
                  These products are removed from your recommended-products
                  collection in emails.
                </p>
                <div className="nomi-brand-row">
                  <span className="nomi-brand-search">Search products</span>
                  <button type="button" className="nomi-brand-link nomi-brand-link-accent">Browse</button>
                </div>
                <p className="nomi-brand-empty">There are no excluded products.</p>
              </section>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
