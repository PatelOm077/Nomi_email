import { useState, type ReactNode } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, Link, data, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { EMAIL_LANGUAGES } from "../email-engine/types";
import { loadDashboardCatalog } from "../dashboard/dashboard-data.server";
import { brandEvidenceSchema, safeJson, type BrandEvidence } from "../brand-studio/types";
import { normalizeLumenBrandEvidence } from "../brand-studio/shopify-evidence.server";
import { ColorField, LogoPicker } from "../components/brand-inputs";
import { loadShopFooterAddress, safeReturnTo } from "../dashboard/sender-footer.server";

type SectionId = "profile" | "branding" | "sender" | "plan" | "excluded";
const SECTIONS: { id: SectionId; label: string }[] = [
  { id: "profile", label: "Profile" }, { id: "branding", label: "Branding" }, { id: "sender", label: "Sender info" }, { id: "plan", label: "Plan & billing" }, { id: "excluded", label: "Excluded products" },
];

function parseExcluded(value: string | null | undefined) {
  try { const parsed = JSON.parse(value ?? "[]"); return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []; } catch { return []; }
}
function optional(form: FormData, key: string, max: number) { return String(form.get(key) ?? "").trim().slice(0, max) || null; }
function validWebUrl(value: string | null) { if (!value) return true; try { const url = new URL(value); return url.protocol === "http:" || url.protocol === "https:"; } catch { return false; } }

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const [settings, sessionRecord, catalog, brandProfile, shopAddress] = await Promise.all([
    db.shopSettings.upsert({ where: { shop: session.shop }, create: { shop: session.shop }, update: {} }),
    db.session.findUnique({ where: { id: session.id }, select: { firstName: true, lastName: true, email: true } }),
    loadDashboardCatalog(admin, session.shop),
    db.brandStudioProfile.findUnique({ where: { shop: session.shop }, select: { evidence: true } }),
    loadShopFooterAddress(admin),
  ]);
  const storedEvidence = brandProfile
    ? normalizeLumenBrandEvidence(
        safeJson(brandProfile.evidence, brandEvidenceSchema, null as BrandEvidence | null) ?? {
          shopName: catalog.shopName,
          storefrontUrl: null,
          storefrontText: "",
          products: [],
        },
        session.shop,
      )
    : null;
  const merchantName = storedEvidence?.shopName ?? catalog.shopName;
  const merchantPrimary = storedEvidence?.assets?.palette?.primary ?? "#0088b0";
  const requestedSection = new URL(request.url).searchParams.get("section");
  const activeSection = SECTIONS.some(({ id }) => id === requestedSection) ? requestedSection as SectionId : "profile";
  return {
    saved: new URL(request.url).searchParams.get("saved"),
    activeSection,
    profile: { firstName: sessionRecord?.firstName ?? null, lastName: sessionRecord?.lastName ?? null, email: sessionRecord?.email ?? null, phone: null },
    branding: {
      shopName: merchantName,
      logoUrl: settings.brandLogoUrl ?? storedEvidence?.assets?.logoUrl ?? null,
      detectedLogoUrl: storedEvidence?.assets?.logoUrl ?? null,
      primaryColor: settings.brandPrimaryColor ?? merchantPrimary,
      palette: storedEvidence?.assets?.palette ?? null,
      fonts: storedEvidence?.assets?.fontHints ?? [],
      themeName: storedEvidence?.assets?.theme?.name ?? null,
      language: settings.language,
    },
    // Empty fields fall back to the Shopify store address, so the form opens
    // prefilled and the merchant only fixes what's missing.
    sender: { name: settings.senderName ?? merchantName, website: settings.senderWebsite ?? storedEvidence?.storefrontUrl ?? null, country: settings.senderCountry ?? shopAddress?.country ?? null, province: settings.senderProvince ?? shopAddress?.province ?? null, city: settings.senderCity ?? shopAddress?.city ?? null, postalCode: settings.senderPostalCode ?? shopAddress?.postalCode ?? null, address: settings.senderAddress ?? shopAddress?.address ?? null },
    returnTo: safeReturnTo(new URL(request.url).searchParams.get("returnTo")),
    products: catalog.products.map((product) => ({ id: product.id, title: product.title, imageUrl: product.imageUrl, excluded: parseExcluded(settings.excludedProductIds).includes(product.id) })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "save-branding") {
    const submittedLogo = optional(form, "logoUrl", 1000);
    const primaryColor = optional(form, "primaryColor", 7);
    const language = String(form.get("language") ?? "");
    if (!validWebUrl(submittedLogo)) return data({ error: "Use a complete http or https URL for the logo.", section: "branding" }, { status: 422 });
    if (primaryColor && !/^#[0-9a-f]{6}$/i.test(primaryColor)) return data({ error: `Primary color “${primaryColor}” isn’t a valid hex color. Use six hex digits, like #1d1a18.`, section: "branding" }, { status: 422 });
    if (!EMAIL_LANGUAGES.some((item) => item.code === language)) return data({ error: "Choose a supported email language.", section: "branding" }, { status: 422 });
    // Picking the Shopify-detected logo means "no override" — store null so a
    // later theme logo change still flows through instead of being pinned.
    const profile = await db.brandStudioProfile.findUnique({ where: { shop: session.shop }, select: { evidence: true } });
    const detectedLogo = profile ? safeJson(profile.evidence, brandEvidenceSchema, null as BrandEvidence | null)?.assets?.logoUrl ?? null : null;
    const logoUrl = submittedLogo && submittedLogo !== detectedLogo ? submittedLogo : null;
    const values = { brandLogoUrl: logoUrl, brandPrimaryColor: primaryColor?.toLowerCase() ?? null, language };
    await db.shopSettings.upsert({ where: { shop: session.shop }, create: { shop: session.shop, ...values }, update: values });
    return redirect("/app/brand-settings?section=branding&saved=branding");
  }

  if (intent === "save-sender") {
    const senderWebsite = optional(form, "senderWebsite", 1000);
    if (!validWebUrl(senderWebsite)) return data({ error: "Use a complete http or https URL for the website.", section: "sender" }, { status: 422 });
    const values = { senderName: optional(form, "senderName", 120), senderWebsite, senderCountry: optional(form, "senderCountry", 100), senderProvince: optional(form, "senderProvince", 100), senderCity: optional(form, "senderCity", 100), senderPostalCode: optional(form, "senderPostalCode", 32), senderAddress: optional(form, "senderAddress", 240) };
    await db.shopSettings.upsert({ where: { shop: session.shop }, create: { shop: session.shop, ...values }, update: values });
    return redirect(safeReturnTo(form.get("returnTo")) ?? "/app/brand-settings?saved=sender");
  }

  if (intent === "save-exclusions") {
    const ids = form.getAll("productId").map(String).filter((id) => /^gid:\/\/shopify\/Product\/\d+$/.test(id)).slice(0, 250);
    await db.shopSettings.upsert({ where: { shop: session.shop }, create: { shop: session.shop, excludedProductIds: JSON.stringify(ids) }, update: { excludedProductIds: JSON.stringify(ids) } });
    return redirect("/app/brand-settings?saved=excluded");
  }
  return data({ error: "That settings action is not supported.", section: "profile" }, { status: 400 });
};

function SectionIcon({ id }: { id: SectionId }) {
  const paths: Record<SectionId, ReactNode> = {
    profile: <><circle cx="10" cy="7" r="3.1" /><path d="M4.2 17c.3-3.6 3.1-5.6 5.8-5.6s5.5 2 5.8 5.6" /></>,
    branding: <><rect x="2.5" y="4" width="15" height="12" rx="2" /><path d="M4 14.5 L8 10.5 L11 13.5 L14 9.5 L17.5 13" /></>,
    sender: <><rect x="2.5" y="5" width="15" height="10.5" rx="1.5" /><path d="M3 6 L10 11.5 L17 6" /></>,
    plan: <><path d="M5 2.5 H15 V17 L13 15.5 L11 17 L9 15.5 L7 17 L5 15.5 Z" /><path d="M7.5 7 H12.5 M7.5 10.5 H12.5" /></>,
    excluded: <><circle cx="10" cy="10" r="6.5" /><path d="M5.5 14.5 L14.5 5.5" /></>,
  };
  return <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[id]}</svg>;
}
function Field({ label, value }: { label: string; value: string | null }) { return <div className="nomi-brand-field"><span>{label}</span><span className={value ? undefined : "nomi-brand-field-empty"}>{value ?? "—"}</span></div>; }

type BrandingValues = Awaited<ReturnType<typeof loader>>["branding"];

function BrandingForm({ branding, busy }: { branding: BrandingValues; busy: boolean }) {
  const paper = branding.palette?.paper ?? "#fbfaf7";
  const ink = branding.palette?.ink ?? "#201e1d";
  const studioColors = branding.palette ? ([["Paper", branding.palette.paper], ["Ink", branding.palette.ink], ["Accent", branding.palette.accent]] as const) : [];
  const kicker = { margin: 0, color: "#5f5a57", font: '700 10px/1.2 "IBM Plex Sans", sans-serif', letterSpacing: ".07em", textTransform: "uppercase" } as const;
  return <Form method="post" className="nomi-settings-form">
    <input type="hidden" name="intent" value="save-branding" />
    <p>Nomi imports the logo and colors already configured in your Shopify theme. Change them here when email should look different.</p>
    <Link className="nomi-brand-flow-link" to="/app/flow-editor"><span aria-hidden="true">↗</span><span><strong>See emails in Flow Editor</strong><small>Your logo and primary color carry into the preview</small></span></Link>
    <fieldset style={{ minWidth: 0, margin: 0, padding: "18px 18px 16px", border: "1px solid #201e1d", background: "#fbfaf7", boxShadow: "6px 6px rgba(32,30,29,.08)" }}>
      <legend style={{ padding: "0 8px", color: "#201e1d", font: '700 11px/1.3 "IBM Plex Sans", sans-serif', letterSpacing: ".06em", textTransform: "uppercase" }}>Visual identity <span style={{ marginLeft: 8, color: "#746f6b", fontWeight: 500, letterSpacing: 0, textTransform: "none" }}>What carries into every email</span></legend>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))", gap: "20px 28px", alignItems: "start" }}>
        <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
          <p style={kicker}>Logo</p>
          <LogoPicker name="logoUrl" variant="settings" allowNone={false} defaultValue={branding.logoUrl} detectedLogoUrl={branding.detectedLogoUrl} shopName={branding.shopName} paper={paper} ink={ink} />
        </div>
        <div style={{ display: "grid", gap: 16, minWidth: 0, alignContent: "start" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 150px), 1fr))", gap: 12 }}>
            <ColorField name="primaryColor" label="Primary color" variant="settings" defaultValue={branding.primaryColor} />
            <label style={{ alignContent: "start" }}><span>Email language</span><select name="language" defaultValue={branding.language}>{EMAIL_LANGUAGES.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select></label>
          </div>
          {studioColors.length ? <div style={{ display: "grid", gap: 8 }}>
            <p style={kicker}>Brand Studio palette</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{studioColors.map(([label, color]) => <span key={label} style={{ display: "inline-flex", alignItems: "center", gap: 7, minHeight: 32, padding: "0 10px 0 6px", border: "1px solid #e3dfdb", borderRadius: 16, background: "#fff", color: "#201e1d", font: '500 12px/1 "IBM Plex Sans", sans-serif' }}><i aria-hidden="true" style={{ width: 20, height: 20, borderRadius: "50%", border: "1px solid rgba(32,30,29,.2)", background: color }} />{label} <code style={{ color: "#746f6b", fontSize: 11 }}>{color}</code></span>)}</div>
            <p style={{ margin: 0, color: "#746f6b", fontSize: 12, lineHeight: 1.45 }}>{branding.fonts.length ? <>Type: <strong style={{ color: "#201e1d" }}>{branding.fonts.slice(0, 2).join(" · ")}</strong>. </> : null}These come from Brand Studio, where changing them rebuilds your email family.</p>
          </div> : null}
        </div>
      </div>
      {branding.themeName ? <p style={{ margin: "14px 0 0", color: "#746f6b", fontSize: 12 }}>Read from published theme <strong style={{ color: "#201e1d" }}>{branding.themeName}</strong></p> : null}
    </fieldset>
    <button className="nomi-settings-save" disabled={busy}>{busy ? "Saving…" : "Save branding"}</button>
  </Form>;
}

// Inline styles on purpose: new nomi.css classes have failed to apply inside
// the embedded admin iframe before (see CAMPAIGNS.md).
function PlanPanel() {
  const sans = '"IBM Plex Sans", ui-sans-serif, system-ui, sans-serif';
  const kicker = { margin: 0, color: "#5f5a57", font: `700 10px/1.2 ${sans}`, letterSpacing: ".07em", textTransform: "uppercase" } as const;
  const facts = [
    ["$0", "charged during beta"],
    ["5 of 5", "lifecycle flows unlocked"],
    ["Shopify", "handles billing at launch"],
  ] as const;
  return <div style={{ display: "grid", gap: 14 }}>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))", border: "1px solid #201e1d", background: "#fbfaf7", boxShadow: "6px 6px rgba(32,30,29,.08)" }}>
      <div style={{ display: "grid", gap: 10, alignContent: "start", padding: "20px 22px" }}>
        <p style={kicker}>Current plan</p>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ color: "#201e1d", font: '600 30px/1.05 "Source Serif 4", Georgia, serif', letterSpacing: "-.01em" }}>Private beta</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minHeight: 24, padding: "0 10px", borderRadius: 12, background: "#e5f5fb", color: "#004961", font: `600 11px/1 ${sans}` }}><i aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: "#0088b0" }} />Active</span>
        </div>
        <p style={{ margin: 0, maxWidth: 420, color: "#605d5d", font: `400 13px/1.55 ${sans}` }}>Every Nomi feature is open to your store while we are in beta. Paid plans will run through Shopify billing, and you approve any charge before it starts.</p>
      </div>
      <div style={{ display: "grid", alignContent: "space-between", gap: 16, padding: "20px 22px", background: "#fff" }}>
        <p style={kicker}>After launch</p>
        <p style={{ margin: 0, color: "#201e1d", font: `400 13px/1.5 ${sans}` }}>
          <span style={{ font: '600 26px/1 "Source Serif 4", Georgia, serif' }}>$15</span><span style={{ color: "#7d7979" }}> /mo</span>
          <span style={{ display: "block", marginTop: 6, color: "#605d5d" }}>for your first 500 contacts, then $5 per additional 500.</span>
        </p>
        <Link to="/app/pricing" className="nomi-settings-save" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 44, width: "max-content", textDecoration: "none" }}>See pricing <span aria-hidden="true">→</span></Link>
      </div>
    </div>
    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 180px), 1fr))", gap: 8 }}>
      {facts.map(([value, label]) => <li key={label} style={{ display: "grid", gap: 3, padding: "10px 12px", border: "1px solid #eae7e7", borderRadius: 3, background: "#fff" }}>
        <strong style={{ color: "#201e1d", font: '600 16px/1.2 "Source Serif 4", Georgia, serif' }}>{value}</strong>
        <span style={{ color: "#7d7979", font: `400 12px/1.35 ${sans}` }}>{label}</span>
      </li>)}
    </ul>
  </div>;
}

export default function BrandSettingsPage() {
  const page = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [active, setActive] = useState<SectionId | null>((actionData?.section as SectionId | undefined) ?? page.activeSection);
  const busy = navigation.state === "submitting";
  const status = page.saved ? `${page.saved === "excluded" ? "Product exclusions" : page.saved === "sender" ? "Sender information" : "Brand settings"} saved.` : null;

  return <main className="nomi-flow-page nomi-brand-settings-page"><div className="nomi-flow-shell">
    <header className="nomi-flow-header"><div className="nomi-flow-title"><Link to="/app" className="nomi-flow-reference-arrow" aria-label="Back to home">←</Link><h1>Brand &amp; Settings</h1></div></header>
    {status ? <p className="nomi-settings-status" role="status">{status}</p> : null}{actionData?.error ? <p className="nomi-form-error" role="alert">{actionData.error}</p> : null}
    <div className="nomi-brand-accordion">{SECTIONS.map((section) => { const isOpen = section.id === active; return <div key={section.id} data-section={section.id} className={`nomi-brand-card${isOpen ? " nomi-brand-card-open" : ""}`}>
      <button type="button" className="nomi-brand-card-head" onClick={() => setActive((current) => current === section.id ? null : section.id)} aria-expanded={isOpen} aria-controls={`brand-section-${section.id}`}><span className="nomi-brand-card-icon"><SectionIcon id={section.id} /></span><span className="nomi-brand-card-title">{section.label}</span>{section.id === "plan" ? <span className="nomi-brand-card-badge">Private beta</span> : null}<svg className="nomi-brand-card-chevron" width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M6 8 L10 12 L14 8" /></svg></button>
      {isOpen ? <div className="nomi-brand-card-body" id={`brand-section-${section.id}`}>
        {section.id === "profile" ? <><p>This account information comes from the authenticated Shopify staff session and store record.</p><div className="nomi-brand-field-grid"><Field label="First name" value={page.profile.firstName} /><Field label="Last name" value={page.profile.lastName} /><Field label="Email" value={page.profile.email} /><Field label="Phone number" value={page.profile.phone} /></div></> : null}
        {section.id === "branding" ? <BrandingForm branding={page.branding} busy={busy} /> : null}
        {section.id === "sender" ? <Form method="post" className="nomi-settings-form"><input type="hidden" name="intent" value="save-sender" />{page.returnTo ? <input type="hidden" name="returnTo" value={page.returnTo} /> : null}<p>Used in Nomi email footers and sender context. Saving here does not overwrite your Shopify store details.</p><div className="nomi-brand-field-grid"><label><span>Company name</span><input name="senderName" defaultValue={page.sender.name ?? ""} maxLength={120} /></label><label><span>Website</span><input name="senderWebsite" type="url" defaultValue={page.sender.website ?? ""} /></label><label><span>Country</span><input name="senderCountry" defaultValue={page.sender.country ?? ""} /></label><label><span>State / Province</span><input name="senderProvince" defaultValue={page.sender.province ?? ""} /></label><label><span>City</span><input name="senderCity" defaultValue={page.sender.city ?? ""} /></label><label><span>Postal code</span><input name="senderPostalCode" defaultValue={page.sender.postalCode ?? ""} /></label></div><label><span>Address</span><input name="senderAddress" defaultValue={page.sender.address ?? ""} maxLength={240} /></label><p className="nomi-brand-legal">A complete business address is required in marketing email footers in many jurisdictions.</p><button className="nomi-settings-save" disabled={busy}>{busy ? "Saving…" : "Save sender info"}</button></Form> : null}
        {section.id === "plan" ? <PlanPanel /> : null}
        {section.id === "excluded" ? <Form method="post" className="nomi-settings-form"><input type="hidden" name="intent" value="save-exclusions" /><p>Checked products stay out of Nomi campaign recommendations.</p><div className="nomi-excluded-products">{page.products.length ? page.products.map((product) => <label key={product.id}><input type="checkbox" name="productId" value={product.id} defaultChecked={product.excluded} />{product.imageUrl ? <img src={product.imageUrl} alt="" /> : <span className="nomi-product-placeholder" aria-hidden="true" />}<span>{product.title}</span></label>) : <p className="nomi-brand-empty">No products are available to exclude.</p>}</div><button className="nomi-settings-save" disabled={busy}>{busy ? "Saving…" : "Save exclusions"}</button></Form> : null}
      </div> : null}
    </div>; })}</div>
  </div></main>;
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
