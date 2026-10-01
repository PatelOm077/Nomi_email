import { createHash } from "node:crypto";
import { type RefObject, useEffect, useId, useRef, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Link, redirect, useFetcher, useLoaderData, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getEmailDeliveryConfig, isEmailDeliveryConfigured } from "../email-delivery/config.server";
import { fromHeader } from "../email-delivery/from-header";
import { isSendingDomainReady } from "../email-delivery/sending-domain";
import { generateNewsletterEmail } from "../email-engine/generate-newsletter-email";
import { optimizeEmailImageUrl } from "../dashboard/email-image-url.server";
import { EMAIL_GENERATION_PAUSED } from "../email-engine/generation-status";
import { NomiDashboard } from "../dashboard/nomi-dashboard";
import { planFor } from "../billing/plans";
import { LIFECYCLE_FLOWS, buildLifecycleSlots } from "../dashboard/lifecycle-flow-catalog";
import { SENDING_FLOWS, parseFlowSettings, type SendingFlowId } from "../email-delivery/lifecycle-schedule";
import type {
  EmailLanguage,
  EmailTone,
  LifecycleEmailId,
  NewsletterCampaign,
} from "../email-engine/types";
import { EMAIL_LANGUAGES, EMAIL_TONES } from "../email-engine/types";
import { getApprovedBrandStudioFamily } from "../brand-studio/approved-family";
import { brandEvidenceSchema, safeJson, type BrandEvidence } from "../brand-studio/types";
import { isLumenDemoShop, normalizeLumenBrandEvidence } from "../brand-studio/shopify-evidence.server";
import { loadDashboardShopName } from "../dashboard/dashboard-data.server";
import { appEmbedEditorUrl, loadAppEmbedStatus } from "../dashboard/app-embed.server";
import { loadDashboardEmailStats } from "../email-delivery/email-stats.server";
import type { BrandStudioMetadataActionResult } from "./app.brand-studio.metadata";
import { RegenerateEmailModal } from "../components/regenerate-email-modal";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const showFlowEditor =
    url.pathname === "/app/flow-editor" || url.searchParams.get("view") === "flows";
  // Dashboard flow rows link to /app/flow-editor?flow=<id> to open that flow.
  const requestedFlow = url.searchParams.get("flow");
  const initialFlowId = LIFECYCLE_FLOWS.some(({ id }) => id === requestedFlow)
    ? (requestedFlow as (typeof LIFECYCLE_FLOWS)[number]["id"])
    : null;

  const providerConfigured = isEmailDeliveryConfigured();
  const [settings, pendingJobs, brandProfile] = await Promise.all([
    db.shopSettings.upsert({
      where: { shop: session.shop },
      create: {
        shop: session.shop,
        sendingEnabled: providerConfigured,
      },
      update: {},
    }),
    db.emailJob.count({ where: { shop: session.shop, status: "pending" } }),
    db.brandStudioProfile.findUnique({
      where: { shop: session.shop },
      select: {
        status: true,
        evidence: true,
        brandSystem: true,
        lifecycleRecipes: true,
        renderedEmails: true,
        evidenceFingerprint: true,
        snapshotEvidenceFingerprint: true,
        generatedEvidenceFingerprint: true,
        directions: true,
        selectedDirectionId: true,
      },
    }),
  ]);
  if (!showFlowEditor && !settings.onboardingCompletedAt) {
    // Keep Shopify's initial shop/host parameters until App Bridge has
    // bootstrapped. Dropping them here leaves the embedded iframe unable to
    // request its first session token and renders the auth response as `$`.
    throw redirect(`/app/brand-studio${url.search}`);
  }
  const themeName = null;
  // The dashboard's Store app embed row reads the live theme every load, and
  // a switched-off embed clears the verified flag so app.tsx re-gates setup.
  const appEmbedStatus = showFlowEditor ? null : await loadAppEmbedStatus(admin);
  if (appEmbedStatus && appEmbedStatus.state !== "unknown") {
    const verified = appEmbedStatus.state === "active";
    if (verified !== Boolean(settings.appEmbedVerifiedAt)) {
      await db.shopSettings.update({
        where: { shop: session.shop },
        data: { appEmbedVerifiedAt: verified ? new Date() : null },
      });
    }
  }
  const storedEvidence = brandProfile
    ? normalizeLumenBrandEvidence(
        safeJson(
          brandProfile.evidence,
          brandEvidenceSchema,
          null as BrandEvidence | null,
        ) ?? {
          shopName: await loadDashboardShopName(admin),
          storefrontUrl: null,
          storefrontText: "",
          products: [],
        },
        session.shop,
      )
    : null;
  const shopName = storedEvidence?.shopName ?? await loadDashboardShopName(admin);
  const primaryColor = settings.brandPrimaryColor && /^#[0-9a-f]{6}$/i.test(settings.brandPrimaryColor)
    ? settings.brandPrimaryColor
    : storedEvidence?.assets?.palette?.primary ?? "#0088b0";
  const approvedFamily = getApprovedBrandStudioFamily(brandProfile);
  const approvedRecipes = approvedFamily?.recipes ?? [];
  const approvedBrand = approvedFamily?.brandSystem ?? null;
  const brandPreviewHtmlById = approvedFamily?.renderedEmails ?? {};

  const [emailStats, recentCampaigns, campaignCount] = showFlowEditor
    ? [null, [], 0]
    : await Promise.all([
        loadDashboardEmailStats(session.shop, new Date(Date.now() - 30 * 24 * 60 * 60_000)),
        db.campaign.findMany({
          where: { shop: session.shop },
          orderBy: { createdAt: "desc" },
          take: 5,
          select: { id: true, name: true, status: true, createdAt: true, html: true },
        }),
        db.campaign.count({ where: { shop: session.shop } }),
      ]);

  return {
    showFlowEditor,
    initialFlowId,
    emailStats,
    // Campaigns don't send yet (SPEC.md), so the dashboard lists them with
    // zero delivery stats rather than inventing any.
    campaigns: {
      total: campaignCount,
      recent: recentCampaigns.map(({ id, name, status, createdAt, html }) => ({
        id,
        name,
        status,
        createdAt: createdAt.toISOString(),
        editable: Boolean(html),
      })),
    },
    shopName,
    shopDomain: session.shop,
    themeName,
    plan: (() => {
      const plan = planFor(settings.plan);
      return { name: plan.name, priceUsd: plan.priceUsd };
    })(),
    appEmbed: {
      state: appEmbedStatus?.state ?? "unknown",
      // eslint-disable-next-line no-undef
      editorUrl: appEmbedEditorUrl(session.shop, process.env.SHOPIFY_API_KEY || ""),
    },
    brand: {
      name: approvedBrand?.name ?? shopName,
      shopName,
      motif: approvedBrand?.signatureMotif ?? null,
      primaryColor,
      logoUrl: settings.brandLogoUrl ?? storedEvidence?.assets?.logoUrl ?? null,
      previewHtmlById: brandPreviewHtmlById,
      recipes: approvedRecipes,
      isLumenDemo: isLumenDemoShop(session.shop),
    },
    delivery: {
      providerConfigured,
      sendingEnabled: settings.sendingEnabled,
      flowSettings: parseFlowSettings(settings.flowSettings),
      language: settings.language,
      tone: settings.tone,
      // The From line real sends use (process-jobs.server.ts): the sender
      // name at hello@ the verified domain, else Nomi's address.
      fromAddress: providerConfigured
        ? await (async () => {
            const { fromName, fromEmail } = getEmailDeliveryConfig();
            const domain = await db.sendingDomain.findUnique({
              where: { shop: session.shop },
              select: { domain: true, status: true },
            });
            return fromHeader({
              senderName: settings.senderName || shopName,
              verifiedDomain: isSendingDomainReady(domain?.status) ? domain?.domain : null,
              fallbackName: fromName,
              fallbackEmail: fromEmail,
            });
          })()
        : null,
      pendingJobs,
    },
  };
};

type GenerationRequest = {
  kind: "newsletter";
  shopName: string;
  language: EmailLanguage;
  tone: EmailTone;
  prompt: string;
  products: NewsletterCampaign["products"];
};

type DashboardActionRequest =
  | GenerationRequest
  | { kind: "set-sending"; enabled: boolean }
  | { kind: "set-tone"; tone: EmailTone }
  | { kind: "set-only-new"; flow: string; enabled: boolean };

// The dashboard reloads its loader data (and re-fires generation) on every
// page load, so identical order/cart/etc. data would otherwise re-call
// Claude every single reload. Keyed on shop + the exact generation request,
// so any real change in the underlying record (new total, new refund, a
// different language) still misses and regenerates. Process-lifetime only
// on purpose — this is the dashboard preview cache, not the lifecycle delivery
// send path, which already has its own DB-backed idempotency.
const previewCache = new Map<string, string>();

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const formData = await request.formData();
  const payload = formData.get("payload");
  if (typeof payload !== "string") {
    return { error: "Missing request data." };
  }

  try {
    const parsed = JSON.parse(payload) as DashboardActionRequest;
    if (parsed.kind === "set-sending") {
      if (parsed.enabled && !isEmailDeliveryConfigured()) {
        return { error: "Configure the email provider before enabling sends." };
      }
      await db.shopSettings.upsert({
        where: { shop: session.shop },
        create: { shop: session.shop, sendingEnabled: parsed.enabled },
        update: { sendingEnabled: parsed.enabled },
      });
      return { deliveryUpdated: true };
    }
    // Emails are English only for now (decided 2026-10-01); the language
    // can't be changed, so there is no set-language action.
    if (parsed.kind === "set-only-new") {
      if (!SENDING_FLOWS.has(parsed.flow)) return { error: "This flow isn’t sending yet." };
      const current = await db.shopSettings.findUnique({ where: { shop: session.shop }, select: { flowSettings: true } });
      const flowSettings = parseFlowSettings(current?.flowSettings);
      const flow = parsed.flow as SendingFlowId;
      // The moment it's switched on is the line: only customers created
      // after it get this flow (email-delivery/lifecycle-schedule.ts).
      flowSettings[flow] = parsed.enabled ? { onlyNewSince: new Date().toISOString() } : {};
      await db.shopSettings.upsert({
        where: { shop: session.shop },
        create: { shop: session.shop, flowSettings: JSON.stringify(flowSettings) },
        update: { flowSettings: JSON.stringify(flowSettings) },
      });
      return { deliveryUpdated: true };
    }
    if (parsed.kind === "set-tone") {
      if (!EMAIL_TONES.some(({ code }) => code === parsed.tone)) {
        return { error: "Unsupported email tone." };
      }
      await db.shopSettings.upsert({
        where: { shop: session.shop },
        create: { shop: session.shop, tone: parsed.tone },
        update: { tone: parsed.tone },
      });
      return { deliveryUpdated: true };
    }

    if (EMAIL_GENERATION_PAUSED) {
      return { error: "Email generation is paused until you choose to start it." };
    }

    const cacheKey = createHash("sha256")
      .update(`${session.shop}:${JSON.stringify(parsed)}`)
      .digest("hex");
    const cachedHtml = previewCache.get(cacheKey);
    if (cachedHtml) return { html: cachedHtml };

    let html: string;
    switch (parsed.kind) {
      case "newsletter": {
        const prompt = parsed.prompt.trim();
        if (!prompt || prompt.length > 1000) {
          return { error: "Describe the campaign in 1–1000 characters." };
        }
        html = await generateNewsletterEmail({
          shopName: parsed.shopName,
          language: "en",
          tone: parsed.tone,
          prompt,
          products: await Promise.all(parsed.products.map(async (product) => ({
            ...product,
            imageUrl: await optimizeEmailImageUrl(product.imageUrl),
          }))),
        });
        break;
      }
    }
    previewCache.set(cacheKey, html);
    return { html };
  } catch (error) {
    console.error("Email generation failed:", error);
    return { error: "Couldn't generate that email — try again." };
  }
};

// v4, not v3: the whole flow was rebuilt to match the approved mockup
// pixel-for-pixel (new step content, new pacing, the URL-entry step is
// gone entirely), so a shop that saw any earlier version sees this one
// once rather than staying silently on record as "onboarded" for a flow
// it never saw.
const ONBOARDING_VERSION = "v4";

const ONBOARDING_RAIL = ["Welcome", "Look around", "Good timing", "Your tone", "All set"] as const;

function resolveDashboardLanguage(value: string): EmailLanguage {
  return EMAIL_LANGUAGES.some(({ code }) => code === value)
    ? (value as EmailLanguage)
    : "en";
}

function resolveDashboardTone(value: string): EmailTone {
  return EMAIL_TONES.some(({ code }) => code === value)
    ? (value as EmailTone)
    : "warm-plain";
}

type ReferenceFlowId = "welcome" | "interest" | "cart" | "care" | "winback";

type ReferenceFlowTemplate = {
  id: LifecycleEmailId;
  flowId: ReferenceFlowId;
  name: string;
  subject: string;
  previewText: string;
  timing: string;
  generatedHtml: string | null;
};

function FlowChevronIcon() {
  return (
    <svg className="nomi-flow-chevron" width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 8 L10 12 L14 8" />
    </svg>
  );
}

// A merchant-facing menu for acting on one Brand Studio email.
// "Regenerate email" (full AI regenerate) and "Edit email template" (the
// tagged-seam editor at app.brand-studio.edit.tsx, for hand-editing text and
// images without touching Claude's layout) are wired. Test sends remain the
// only disabled placeholder in this menu.
function EditActionsMenu({
  isOpen,
  triggerRef,
  onToggle,
  onClose,
  onEditMetadata,
  onRegenerate,
  recipeId,
}: {
  isOpen: boolean;
  triggerRef: RefObject<HTMLButtonElement>;
  onToggle: () => void;
  onClose: () => void;
  onEditMetadata: () => void;
  onRegenerate: () => void;
  recipeId: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen, onClose]);

  return (
    <div className="nomi-edit-menu" ref={ref}>
      <button
        ref={triggerRef}
        type="button"
        className="nomi-edit-menu-trigger"
        aria-expanded={isOpen}
        aria-haspopup="menu"
        onClick={onToggle}
      >
        Edit <FlowChevronIcon />
      </button>
      {isOpen ? (
        <div className="nomi-edit-menu-list" role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onEditMetadata();
              onClose();
            }}
          >
            Edit Subject Line &amp; Preview Text
          </button>
          <Link to={`/app/brand-studio/edit?recipeId=${recipeId}`} role="menuitem" onClick={onClose}>
            Edit email template
          </Link>
          <hr />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onRegenerate();
              onClose();
            }}
          >
            Regenerate email
          </button>
          <hr />
          <button type="button" role="menuitem" disabled>
            Send Test Email
            <small>Soon</small>
          </button>
        </div>
      ) : null}
    </div>
  );
}

function SubjectPreviewDialog({
  template,
  returnFocusRef,
  onClose,
  onSaved,
}: {
  template: ReferenceFlowTemplate;
  returnFocusRef: RefObject<HTMLButtonElement>;
  onClose: () => void;
  onSaved: (result: Extract<BrandStudioMetadataActionResult, { ok: true }>) => void;
}) {
  const fetcher = useFetcher<BrandStudioMetadataActionResult>();
  const [subject, setSubject] = useState(template.subject);
  const [previewText, setPreviewText] = useState(template.previewText);
  const subjectRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const isSaving = fetcher.state !== "idle";
  const hasChanges =
    subject.trim() !== template.subject || previewText.trim() !== template.previewText;
  const isValid =
    subject.trim().length >= 3 &&
    subject.trim().length <= 64 &&
    previewText.trim().length >= 3 &&
    previewText.trim().length <= 140;

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const returnFocusTarget = returnFocusRef.current ?? previouslyFocused;
    subjectRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSaving) onClose();
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      returnFocusTarget?.focus();
    };
  }, [isSaving, onClose, returnFocusRef]);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) {
      onSaved(fetcher.data);
      onClose();
    }
  }, [fetcher.state, fetcher.data, onClose, onSaved]);

  const previewSubject = subject.trim() || "Your subject line";
  const previewCopy =
    previewText.trim() || "Preview text gives the inbox a useful second thought.";

  return (
    <div className="nomi-inbox-editor-backdrop">
      <section
        ref={dialogRef}
        className="nomi-inbox-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="nomi-inbox-editor-title"
        aria-describedby="nomi-inbox-editor-description"
      >
        <header>
          <div>
            <span>Inbox details</span>
            <h2 id="nomi-inbox-editor-title">Edit subject &amp; preview</h2>
            <p id="nomi-inbox-editor-description">{template.name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            aria-label="Close inbox details editor"
          >
            &times;
          </button>
        </header>

        <fetcher.Form method="post" action="/app/brand-studio/metadata">
          <input type="hidden" name="recipeId" value={template.id} />

          <div className="nomi-inbox-editor-sample" aria-label="Inbox preview">
            <span aria-hidden="true">N</span>
            <div>
              <strong>{previewSubject}</strong>
              <p>{previewCopy}</p>
            </div>
            <small>now</small>
          </div>

          <label>
            <span>
              Subject line
              <small className={subject.length > 64 ? "is-over" : ""}>
                {subject.length} / 64
              </small>
            </span>
            <input
              ref={subjectRef}
              type="text"
              name="subject"
              required
              minLength={3}
              maxLength={64}
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              autoComplete="off"
            />
          </label>

          <label>
            <span>
              Preview text
              <small className={previewText.length > 140 ? "is-over" : ""}>
                {previewText.length} / 140
              </small>
            </span>
            <textarea
              name="previewText"
              required
              minLength={3}
              maxLength={140}
              rows={3}
              value={previewText}
              onChange={(event) => setPreviewText(event.target.value)}
            />
          </label>
          <p className="nomi-inbox-editor-help">
            Shown beside the subject in most inboxes. This does not change the email body or layout.
          </p>

          {fetcher.data && !fetcher.data.ok ? (
            <p className="nomi-inbox-editor-error" role="alert">{fetcher.data.error}</p>
          ) : null}

          <footer>
            <button
              type="button"
              className="is-secondary"
              onClick={onClose}
              disabled={isSaving}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="is-primary"
              disabled={isSaving || !hasChanges || !isValid}
            >
              {isSaving ? "Saving…" : "Save changes"}
            </button>
          </footer>
        </fetcher.Form>
      </section>
    </div>
  );
}

function RuleAddedIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="10" cy="10" r="7.25" />
      <path d="M10 6.5 L10 13.5 M6.5 10 L13.5 10" />
    </svg>
  );
}

function RuleRemovedIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="10" cy="10" r="7.25" />
      <path d="M6.5 10 L13.5 10" />
    </svg>
  );
}

// Every visual property here is inlined, not left to nomi.css classes: in
// this embedded Shopify admin iframe, freshly served CSS classes on
// newly-added elements have repeatedly failed to apply live (confirmed for
// the Campaigns picker popup — see the campaigns-picker-inline-styles
// memory) even when the served CSS is correct. Inline styles ship inside
// the JS bundle itself, so they aren't subject to whatever caching/proxy
// layer causes that.
const LANGUAGE_MENU_WRAP_STYLE: React.CSSProperties = { position: "relative", display: "inline-flex" };
// Sized and bordered to match the sibling "Replay setup" button
// (.nomi-replay-setup in nomi.css) so the two controls in this row read as
// one matched pair of compact pill buttons, not a button next to a
// legacy label+field form group.
const LANGUAGE_TRIGGER_STYLE: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  height: 44,
  padding: "0 14px",
  font: '600 12px/1 "IBM Plex Sans", sans-serif',
  color: "#201e1d",
  background: "#ffffff",
  border: "1px solid #d7d3d3",
  borderRadius: 0,
  cursor: "pointer",
  boxSizing: "border-box",
  whiteSpace: "nowrap",
};
const LANGUAGE_TRIGGER_HOVER_STYLE: React.CSSProperties = {
  ...LANGUAGE_TRIGGER_STYLE,
  borderColor: "#201e1d",
  background: "rgba(32, 30, 29, 0.03)",
};
const LANGUAGE_ICON_STYLE: React.CSSProperties = { flex: "none", color: "#0088b0" };
const LANGUAGE_LIST_STYLE: React.CSSProperties = {
  position: "absolute",
  zIndex: 30,
  top: "calc(100% + 6px)",
  right: 0,
  minWidth: "100%",
  width: "max-content",
  maxWidth: 240,
  maxHeight: 260,
  overflowY: "auto",
  margin: 0,
  padding: 6,
  listStyle: "none",
  font: '13px "IBM Plex Sans", sans-serif',
  letterSpacing: "normal",
  textTransform: "none",
  background: "#ffffff",
  border: "1px solid #d7d3d3",
  borderRadius: 4,
  boxShadow: "0 8px 24px rgba(32, 30, 29, 0.18)",
  boxSizing: "border-box",
  outline: "none",
};
const LANGUAGE_OPTION_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  padding: "8px 10px",
  borderRadius: 2,
  color: "#201e1d",
  cursor: "pointer",
  boxSizing: "border-box",
};
const LANGUAGE_OPTION_ACTIVE_STYLE: React.CSSProperties = {
  ...LANGUAGE_OPTION_STYLE,
  background: "#f8f4f4",
};
const LANGUAGE_OPTION_SELECTED_STYLE: React.CSSProperties = {
  ...LANGUAGE_OPTION_STYLE,
  color: "#006786",
  fontWeight: 600,
};
const LANGUAGE_OPTION_SELECTED_ACTIVE_STYLE: React.CSSProperties = {
  ...LANGUAGE_OPTION_SELECTED_STYLE,
  background: "#f8f4f4",
};

// Replaces a native <select> for the language picker. A native select's
// trigger can be themed, but its open popup is rendered by the OS/browser
// and can't be restyled — this listbox-button pattern (ARIA APG "Listbox
// Popup") keeps the open state inside Nomi's own design system end to end.
function LanguageMenu({
  value,
  label,
  onChange,
}: {
  value: EmailLanguage;
  label: string;
  onChange: (language: EmailLanguage) => void;
}) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const optionRefs = useRef<(HTMLLIElement | null)[]>([]);
  const triggerId = useId();
  const selected =
    EMAIL_LANGUAGES.find((item) => item.code === value) ?? EMAIL_LANGUAGES[0];

  useEffect(() => {
    if (!open) return;
    setActiveIndex(Math.max(EMAIL_LANGUAGES.findIndex((item) => item.code === value), 0));
    listRef.current?.focus();
    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open, value]);

  useEffect(() => {
    if (open) optionRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  function commit(index: number) {
    const next = EMAIL_LANGUAGES[index];
    if (next) onChange(next.code);
    setOpen(false);
  }

  return (
    <div className="nomi-language-menu" style={LANGUAGE_MENU_WRAP_STYLE} ref={rootRef}>
      <button
        type="button"
        id={triggerId}
        title={label}
        style={hovered || open ? LANGUAGE_TRIGGER_HOVER_STYLE : LANGUAGE_TRIGGER_STYLE}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${selected.label}`}
        onClick={() => setOpen((current) => !current)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={LANGUAGE_ICON_STYLE}>
          <circle cx="10" cy="10" r="7.5" />
          <path d="M2.5 10 H17.5" />
          <path d="M10 2.5 C13 5.5 13 14.5 10 17.5 C7 14.5 7 5.5 10 2.5 Z" />
        </svg>
        <span>{selected.label}</span>
        <svg aria-hidden="true" width="10" height="10" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ ...LANGUAGE_ICON_STYLE, transform: open ? "rotate(180deg)" : undefined, transition: "transform 140ms ease" }}><path d="M6 8 L10 12 L14 8" /></svg>
      </button>
      {open ? (
        <ul
          className="nomi-language-menu-list"
          style={LANGUAGE_LIST_STYLE}
          role="listbox"
          tabIndex={-1}
          aria-label={label}
          aria-activedescendant={`${triggerId}-option-${activeIndex}`}
          ref={listRef}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActiveIndex((index) => Math.min(index + 1, EMAIL_LANGUAGES.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((index) => Math.max(index - 1, 0));
            } else if (event.key === "Home") {
              event.preventDefault();
              setActiveIndex(0);
            } else if (event.key === "End") {
              event.preventDefault();
              setActiveIndex(EMAIL_LANGUAGES.length - 1);
            } else if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              commit(activeIndex);
            } else if (event.key === "Escape" || event.key === "Tab") {
              setOpen(false);
            }
          }}
        >
          {EMAIL_LANGUAGES.map((item, index) => (
            <li
              key={item.code}
              id={`${triggerId}-option-${index}`}
              role="option"
              aria-selected={item.code === value}
              className={`nomi-language-menu-option${item.code === value ? " is-selected" : ""}${index === activeIndex ? " is-active" : ""}`}
              style={
                item.code === value
                  ? index === activeIndex
                    ? LANGUAGE_OPTION_SELECTED_ACTIVE_STYLE
                    : LANGUAGE_OPTION_SELECTED_STYLE
                  : index === activeIndex
                    ? LANGUAGE_OPTION_ACTIVE_STYLE
                    : LANGUAGE_OPTION_STYLE
              }
              ref={(node) => {
                optionRefs.current[index] = node;
              }}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => commit(index)}
            >
              <span>{item.label}</span>
              {item.code === value ? (
                <svg aria-hidden="true" width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 10.5 L8.5 14 L15 6.5" /></svg>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export default function Index() {
  const {
    showFlowEditor,
    initialFlowId,
    emailStats,
    campaigns,
    shopName,
    delivery,
    brand,
    appEmbed,
    plan,
  } = useLoaderData<typeof loader>();
  const [tone, setTone] = useState<EmailTone>(resolveDashboardTone(delivery.tone));
  // Resolve the browser-only completion flag before mounting the animated
  // onboarding. Rendering it during SSR can start its CSS animations before
  // React hydrates the page, which makes the welcome sequence appear to run
  // twice in development.
  const [showOnboarding, setShowOnboarding] = useState(false);
  const navigate = useNavigate();
  const initialFlow = LIFECYCLE_FLOWS.find(({ id }) => id === initialFlowId);
  const [selectedTemplateId, setSelectedTemplateId] = useState<LifecycleEmailId>(
    initialFlow?.templateIds[0] ?? "welcome-1",
  );
  const [expandedFlowId, setExpandedFlowId] = useState<ReferenceFlowId | "">(
    initialFlow?.id ?? "welcome",
  );
  useEffect(() => {
    const flow = LIFECYCLE_FLOWS.find(({ id }) => id === initialFlowId);
    if (!flow) return;
    setExpandedFlowId(flow.id);
    setSelectedTemplateId(flow.templateIds[0]);
  }, [initialFlowId]);
  // The preview panel otherwise depends entirely on `brand.previewHtmlById`
  // from the route loader being revalidated after a successful regenerate.
  // That revalidation is a plain GET behind whatever sits in front of this
  // app (dev tunnel, CDN, browser cache) and isn't guaranteed to bypass it —
  // this was seen live returning stale HTML even after a full page reload.
  // Applying the fetcher's own successful response directly makes the
  // preview correct regardless of what any intermediate cache does.
  const [regeneratedHtmlById, setRegeneratedHtmlById] = useState<
    Partial<Record<LifecycleEmailId, string>>
  >({});
  const [previewMenuOpen, setPreviewMenuOpen] = useState(false);
  const [editingMetadataId, setEditingMetadataId] = useState<LifecycleEmailId | null>(null);
  const editMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const [savedMetadataById, setSavedMetadataById] = useState<
    Partial<Record<LifecycleEmailId, { subject: string; previewText: string }>>
  >({});
  // "Regenerate email" opens the brief modal; it builds the new version,
  // shows it, and only a Save there replaces this email (onSaved below).
  const [regenerateModalId, setRegenerateModalId] = useState<LifecycleEmailId | null>(null);
  const deliveryFetcher = useFetcher<typeof action>();

  const onboardingStorageKey = `nomi:onboarding:${shopName}:${ONBOARDING_VERSION}`;

  const finishOnboarding = () => {
    try {
      window.localStorage.setItem(onboardingStorageKey, "complete");
    } catch {
      // See the storage note above. Closing the setup must always work.
    }
    setShowOnboarding(false);
    navigate("/app/flow-editor");
  };

  // Embedded apps run inside an iframe on the app's own origin, not
  // admin.shopify.com — devtools opened on the parent page can't see or
  // clear this storage key. Do it from inside the app itself instead.
  const replayOnboarding = () => {
    navigate("/app/brand-studio?step=welcome&replay=1");
  };

  const approvedRecipesById = new Map(brand.recipes.map((recipe) => [recipe.id, recipe]));
  const referenceTemplateDefinitions = buildLifecycleSlots(shopName);
  const referenceTemplates: ReferenceFlowTemplate[] = referenceTemplateDefinitions.map((template) => {
    const savedMetadata = savedMetadataById[template.id];
    return {
      ...template,
      subject:
        savedMetadata?.subject ?? approvedRecipesById.get(template.id)?.subject ?? template.subject,
      previewText:
        savedMetadata?.previewText ??
        approvedRecipesById.get(template.id)?.preheader ??
        template.previewText,
      generatedHtml: regeneratedHtmlById[template.id] ?? brand.previewHtmlById[template.id] ?? null,
    };
  });

  const referenceFlows = LIFECYCLE_FLOWS;

  const selectedTemplate =
    referenceTemplates.find(({ id }) => id === selectedTemplateId) ?? referenceTemplates[0];
  const editingMetadataTemplate = editingMetadataId
    ? referenceTemplates.find(({ id }) => id === editingMetadataId) ?? null
    : null;
  const selectedFlow =
    referenceFlows.find(({ id }) => id === selectedTemplate.flowId) ?? referenceFlows[0];
  const generatedCount = referenceTemplates.filter(({ generatedHtml }) => Boolean(generatedHtml)).length;
  const totalLifecycleEmails = referenceTemplates.length;
  const isLifecycleRunComplete = totalLifecycleEmails > 0 && generatedCount >= totalLifecycleEmails;
  const liveRunLabel = isLifecycleRunComplete && brand.name
    ? "Brand system ready"
    : isLifecycleRunComplete
      ? "Email run complete"
    : generatedCount > 0
        ? `${generatedCount} emails ready`
        : "Brand Studio build required";

  if (showOnboarding === null) {
    return <main className="nomi-onboarding" aria-label="Loading setup" />;
  }

  if (showOnboarding) {
    return (
      <NomiOnboarding
        shopName={shopName}
        tone={tone}
        onPickTone={(nextTone) => {
          setTone(nextTone);
          deliveryFetcher.submit(
            { payload: JSON.stringify({ kind: "set-tone", tone: nextTone }) },
            { method: "POST" },
          );
        }}
        onFinish={finishOnboarding}
      />
    );
  }

  // The Nomi app entry point is the dashboard. The established Flow Editor
  // remains available through the explicit sidebar destination below.
  if (!showFlowEditor) {
    return (
      <NomiDashboard
        shopName={shopName}
        flows={referenceFlows.map((flow) => {
          const flowTemplates = referenceTemplates.filter(({ id }) =>
            flow.templateIds.includes(id),
          );
          return {
            id: flow.id,
            ready: flowTemplates.filter(({ generatedHtml }) => Boolean(generatedHtml)).length,
            total: flowTemplates.length,
            stats: emailStats?.flows[flow.id] ?? null,
          };
        })}
        uniqueRecipients={emailStats?.uniqueRecipients ?? 0}
        campaigns={campaigns}
        currency={emailStats?.currency ?? null}
        generatedCount={generatedCount}
        totalEmailCount={referenceTemplates.length}
        sendingEnabled={delivery.sendingEnabled}
        appEmbed={appEmbed}
        providerConfigured={delivery.providerConfigured}
        plan={plan}
        onToggleSending={() =>
          deliveryFetcher.submit(
            { payload: JSON.stringify({ kind: "set-sending", enabled: !delivery.sendingEnabled }) },
            { method: "POST" },
          )
        }
      />
    );
  }

  return (
    <main className="nomi-flow-page nomi-flow-page-reference">
      <div className="nomi-flow-shell">
        <header className="nomi-flow-header nomi-control-rail">
          <div className="nomi-control-rail-intro">
            <span className="nomi-control-rail-kicker">Email engine</span>
            <h1>Your emails, in your voice.</h1>
            <p>Settings apply to every email in this run.</p>
          </div>

          <div className="nomi-control-rail-tools">
            <Link
              className={`nomi-flow-brand-link${brand.name ? " is-ready" : ""}`}
              to="/app/brand-settings?section=branding"
              style={{ "--nomi-flow-brand-primary": brand.primaryColor ?? "#0088b0" } as React.CSSProperties}
            >
              {brand.logoUrl ? <img src={brand.logoUrl} alt="" /> : brand.isLumenDemo ? <img src="/lumen-mark.svg" alt="" /> : <span className="nomi-flow-brand-swatch" aria-hidden="true" />}
              <span>
                <small>{brand.shopName} email brand</small>
                <strong>{brand.name ?? "Set your brand"}</strong>
                <em>{brand.name ? `Editing updates these ${brand.shopName} previews` : "Open brand editor"}</em>
              </span>
              <b aria-hidden="true">Edit ↗</b>
            </Link>
            <div
              className={`nomi-live-run${isLifecycleRunComplete ? " is-complete" : ""}`}
              role="progressbar"
              aria-label={`${generatedCount} of ${totalLifecycleEmails} emails generated`}
              aria-valuemin={0}
              aria-valuemax={totalLifecycleEmails}
              aria-valuenow={generatedCount}
              aria-live="polite"
            >
              <div className="nomi-live-run-copy">
                <span className="nomi-live-run-pulse" aria-hidden="true" />
                <strong>{liveRunLabel}</strong>
                <b>{generatedCount} of {totalLifecycleEmails} live</b>
              </div>
              <div className="nomi-live-run-beats" aria-hidden="true">
                {Array.from({ length: totalLifecycleEmails }, (_, index) => (
                  <i
                    className={index < generatedCount ? "is-ready" : ""}
                    key={index}
                  />
                ))}
              </div>
            </div>

            <div className="nomi-control-rail-actions">
              <button
                className="nomi-replay-setup"
                type="button"
                onClick={replayOnboarding}
              >
                <span aria-hidden="true">↻</span>
                Replay setup
              </button>
            </div>
          </div>
        </header>

        <section className="nomi-reference-activation" aria-label="Account and flow activation">
          <article className="nomi-reference-activation-card is-trial">
            <div className="nomi-reference-activation-title">
              <span aria-hidden="true">!</span>
              <strong>You’re on the {plan.name} plan</strong>
            </div>
            <p>See what you’ve used and what each plan includes. Upgrade or downgrade any time.</p>
            <Link className="nomi-reference-activation-link" to="/app/pricing">See plans</Link>
          </article>

          <article className="nomi-reference-activation-card is-flows">
            <div className="nomi-reference-activation-title">
              <span aria-hidden="true">!</span>
              <strong>Activate your email flows</strong>
            </div>
            <p>Activate your email flows to start recovering checkout abandoners &amp; grow your revenue.</p>
            <div className="nomi-reference-activation-actions">
              <button
                type="button"
                disabled={deliveryFetcher.state !== "idle" || !delivery.providerConfigured}
                title={delivery.providerConfigured ? undefined : "Add the Resend sender and worker secrets first"}
                onClick={() =>
                  deliveryFetcher.submit(
                    { payload: JSON.stringify({ kind: "set-sending", enabled: !delivery.sendingEnabled }) },
                    { method: "POST" },
                  )
                }
              >
                {delivery.sendingEnabled ? "Activated" : "Activate"}
              </button>
              <a
                href="#support"
                onClick={(event) => {
                  event.preventDefault();
                  window.dispatchEvent(new CustomEvent("nomi:open-support", { detail: { contact: true } }));
                }}
              >
                ▢&nbsp; Talk to support
              </a>
            </div>
          </article>
        </section>

        <div className="nomi-flow-workspace">
          <section className="nomi-flow-selector" aria-labelledby="nomi-flow-selector-title">
            <div className="nomi-flow-panel-label" id="nomi-flow-selector-title">Flow selector</div>
            <div className="nomi-flow-groups">
              {referenceFlows.map((flow) => {
                const flowTemplates = referenceTemplates.filter(({ id }) => flow.templateIds.includes(id));
                const readyInFlow = flowTemplates.filter(({ generatedHtml }) => Boolean(generatedHtml)).length;
                const isExpanded = expandedFlowId === flow.id;
                return (
                  <article className={`nomi-flow-group tone-${flow.id}${selectedFlow.id === flow.id ? " is-current" : ""}${isExpanded ? " is-expanded" : ""}`} key={flow.id}>
                    <button
                      className="nomi-flow-group-head"
                      type="button"
                      aria-expanded={isExpanded}
                      aria-controls={`nomi-${flow.id}-emails`}
                      onClick={() => setExpandedFlowId(isExpanded ? "" : flow.id)}
                    >
                      <span className="nomi-flow-group-accent" aria-hidden="true" />
                      <span className="nomi-flow-group-copy">
                        <strong>{flow.name}</strong>
                        <small>{flowTemplates.length} emails · {flow.purpose}</small>
                      </span>
                      {!isExpanded ? <span className="nomi-flow-group-progress" aria-hidden="true">{readyInFlow} / {flowTemplates.length}</span> : null}
                      <span className="nomi-flow-group-toggle">
                        <FlowChevronIcon />
                      </span>
                    </button>

                    {isExpanded ? (
                      <div className="nomi-flow-email-list" id={`nomi-${flow.id}-emails`}>
                        {flowTemplates.map((template) => (
                          <div className={`nomi-flow-email-row${selectedTemplate.id === template.id ? " is-selected" : ""}`} key={template.id}>
                            <button
                              className="nomi-flow-email-select"
                              type="button"
                              onClick={() => setSelectedTemplateId(template.id)}
                            >
                              <span className="nomi-flow-mail-icon" aria-hidden="true">✉</span>
                              <span><strong>{template.name}</strong><small>{template.timing}</small></span>
                            </button>
                            <span className={`nomi-flow-state${template.generatedHtml ? " is-ready" : ""}`}>
                              {template.generatedHtml ? "BRAND SYSTEM" : "BUILD REQUIRED"}
                            </span>
                            {template.generatedHtml ? null : (
                              <Link className="nomi-flow-generate" to="/app/brand-studio">
                                Build
                              </Link>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>

            <section className="nomi-flow-rules" aria-labelledby="nomi-flow-rules-title">
              <div className="nomi-flow-panel-label" id="nomi-flow-rules-title">{selectedFlow.name} — triggers &amp; funnel</div>
              <p className="nomi-reference-best-practice">All Nomi triggers are based on the industry&apos;s best practices</p>
              <div className="nomi-flow-rule-grid">
                <div>
                  <strong><RuleAddedIcon /> Added when</strong>
                  <p>{selectedFlow.trigger}</p>
                </div>
                <div>
                  <strong><RuleRemovedIcon /> Removed when</strong>
                  <p>{selectedFlow.stop}</p>
                </div>
              </div>
              {SENDING_FLOWS.has(selectedFlow.id) ? (
                <label className="nomi-reference-new-contacts">
                  <input
                    type="checkbox"
                    checked={Boolean(delivery.flowSettings[selectedFlow.id as SendingFlowId]?.onlyNewSince)}
                    disabled={deliveryFetcher.state !== "idle"}
                    onChange={(event) =>
                      deliveryFetcher.submit(
                        { payload: JSON.stringify({ kind: "set-only-new", flow: selectedFlow.id, enabled: event.currentTarget.checked }) },
                        { method: "POST" },
                      )
                    }
                  />
                  Only send to new contacts
                  {delivery.flowSettings[selectedFlow.id as SendingFlowId]?.onlyNewSince ? (
                    <small style={{ display: "block", marginLeft: 26, color: "#605d5d" }}>
                      Customers who joined before{" "}
                      {new Date(delivery.flowSettings[selectedFlow.id as SendingFlowId]!.onlyNewSince!).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}{" "}
                      won’t get this flow.
                    </small>
                  ) : null}
                </label>
              ) : (
                <p className="nomi-reference-new-contacts" style={{ color: "#605d5d" }}>
                  This flow isn’t sending yet.
                </p>
              )}
              <div className="nomi-reference-timing-list">
                {referenceTemplates
                  .filter(({ flowId }) => flowId === selectedFlow.id)
                  .map((template) => (
                    <div key={template.id}>
                      <i aria-hidden="true" />
                      <span><strong>{template.name}</strong><small>{template.timing}</small></span>
                      <button type="button" onClick={() => setSelectedTemplateId(template.id)} aria-label={`Edit ${template.name}`}>⌕</button>
                    </div>
                  ))}
              </div>
              <p className="nomi-flow-ai-note"><span aria-hidden="true">ⓘ</span> AI can make mistakes, so double-check that the results are accurate before using them.</p>
            </section>
          </section>

          <aside className="nomi-flow-proof" aria-labelledby="nomi-flow-proof-title">
            <div className="nomi-flow-proof-topline">
              <div>
                <span>{selectedTemplate.name} — preview</span>
                <h2 className="nomi-visually-hidden" id="nomi-flow-proof-title">{selectedTemplate.subject}</h2>
              </div>
              <div className="nomi-flow-proof-actions">
                {selectedTemplate.generatedHtml ? (
                  <EditActionsMenu
                    isOpen={previewMenuOpen}
                    triggerRef={editMenuTriggerRef}
                    onToggle={() => setPreviewMenuOpen((open) => !open)}
                    onClose={() => setPreviewMenuOpen(false)}
                    onEditMetadata={() => setEditingMetadataId(selectedTemplate.id)}
                    onRegenerate={() => setRegenerateModalId(selectedTemplate.id)}
                    recipeId={selectedTemplate.id}
                  />
                ) : (
                  <Link className="nomi-flow-proof-action" to="/app/brand-studio">
                    Build in Brand Studio
                  </Link>
                )}
              </div>
            </div>
            <div className="nomi-flow-inbox-meta">
              <div><strong>From</strong><span>{delivery.fromAddress ?? `${shopName} via Nomi`}</span></div>
              <div><strong>Subject</strong><span>{selectedTemplate.subject}</span></div>
              <div><strong>Preview</strong><span>{selectedTemplate.previewText}</span></div>
            </div>

            <div className="nomi-flow-proof-canvas" aria-live="polite">
              {selectedTemplate.generatedHtml ? (
                <FlowGeneratedEmailPreview html={selectedTemplate.generatedHtml} title={`${selectedTemplate.name} Brand Studio preview`} />
              ) : (
                <div className="nomi-flow-brand-empty">
                  <span aria-hidden="true">13</span>
                  <strong>Build one complete email family.</strong>
                  <p>Brand Studio uses your approved Brand System and creative briefs to author all 13 lifecycle emails together.</p>
                  <Link to="/app/brand-studio">Open Brand Studio</Link>
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>
      {regenerateModalId ? (
        <RegenerateEmailModal
          emailLabel={
            referenceTemplates.find(({ id }) => id === regenerateModalId)?.name ?? "email"
          }
          recipeId={regenerateModalId}
          onClose={() => setRegenerateModalId(null)}
          onSaved={(html) => {
            const recipeId = regenerateModalId;
            setRegeneratedHtmlById((current) => ({ ...current, [recipeId]: html }));
            setRegenerateModalId(null);
          }}
        />
      ) : null}
      {editingMetadataTemplate ? (
        <SubjectPreviewDialog
          key={editingMetadataTemplate.id}
          template={editingMetadataTemplate}
          returnFocusRef={editMenuTriggerRef}
          onClose={() => setEditingMetadataId(null)}
          onSaved={(result) => {
            setSavedMetadataById((current) => ({
              ...current,
              [result.recipeId]: {
                subject: result.subject,
                previewText: result.previewText,
              },
            }));
          }}
        />
      ) : null}
    </main>
  );
}

function FlowGeneratedEmailPreview({ html, title }: { html: string; title: string }) {
  // Vite asset paths are root-relative. An iframe `srcDoc` otherwise resolves
  // them against Shopify Admin, not the embedded Nomi app, which leaves local
  // Lumen product photography broken in the email preview.
  const previewHtml = typeof window === "undefined"
    ? html
    : html.replace("<head>", `<head><base href="${window.location.origin}/">`);
  return (
    <iframe
      className="nomi-flow-generated-frame"
      srcDoc={previewHtml}
      title={title}
      sandbox=""
    />
  );
}

const ONBOARDING_TONE_OPTIONS: {
  code: EmailTone;
  name: string;
  example: string;
  hue: "cyan" | "magenta" | "neutral";
}[] = [
  { code: "warm-plain", name: "Warm & plain", example: "Welcome, Ananya — we're glad you're here", hue: "cyan" },
  { code: "bright-bubbly", name: "Bright & bubbly", example: "You left something lovely behind!", hue: "magenta" },
  { code: "calm-minimal", name: "Calm & minimal", example: "Welcome back.", hue: "neutral" },
];

const ONBOARDING_FOUND_CARDS: {
  tag: string;
  hue: "cyan" | "magenta" | "gold" | "neutral";
  rotate: string;
  offset: string;
}[] = [
  { tag: "24 items", hue: "cyan", rotate: "-8deg", offset: "-150px" },
  { tag: "your colors", hue: "magenta", rotate: "-2deg", offset: "-40px" },
  { tag: "your fonts", hue: "gold", rotate: "4deg", offset: "70px" },
  { tag: "your tone", hue: "neutral", rotate: "9deg", offset: "180px" },
];

const ONBOARDING_ORBIT_CHIPS: {
  hue: "cyan" | "magenta" | "gold" | "neutral" | "cyan-deep";
  size: number;
  x: number;
  y: number;
  duration: number;
  reverse: boolean;
  delay: number;
}[] = [
  { hue: "cyan", size: 46, x: -70, y: -70, duration: 10, reverse: false, delay: 280 },
  { hue: "magenta", size: 38, x: 80, y: -30, duration: 13, reverse: true, delay: 560 },
  { hue: "gold", size: 34, x: -90, y: 60, duration: 15, reverse: false, delay: 840 },
  { hue: "neutral", size: 30, x: 75, y: 65, duration: 11, reverse: true, delay: 1120 },
  { hue: "cyan-deep", size: 26, x: -16, y: -104, duration: 17, reverse: false, delay: 1400 },
];

const ONBOARDING_DAYS: { label: string; items: ("cyan" | "magenta" | "neutral")[] }[] = [
  { label: "Day 0", items: ["cyan", "magenta"] },
  { label: "Day 1", items: ["cyan"] },
  { label: "Day 3", items: [] },
  { label: "Day 7", items: ["neutral"] },
  { label: "Day 10", items: ["cyan"] },
  { label: "Day 14", items: [] },
];

const ONBOARDING_CHECKLIST: { name: string; hue: "cyan" | "magenta" }[] = [
  { name: "Welcome", hue: "cyan" },
  { name: "Still Interested?", hue: "magenta" },
  { name: "Abandoned Cart", hue: "cyan" },
  { name: "How Was It?", hue: "magenta" },
  { name: "Welcome Back", hue: "cyan" },
];

// All the reveal-chain delays in one place, in ms, so the rail's progress
// fill (below) can be computed from the same numbers that actually drive
// the timers instead of a second, hand-copied set that could drift out of
// sync.
const ONBOARDING_TIMING = {
  welcomePause: 3900,
  foundCardStep: 700,
  foundCardSettle: 1800,
  dayStep: 430,
  daySettle: 1400,
  tonePick: 1100,
  generating: 2200,
  checklistStep: 750,
  finishPause: 1200,
} as const;

function OnboardingMarkIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M50 16 L14 30 L29 36 L50 16 Z" />
      <path d="M29 36 L33 50 L50 16" />
    </svg>
  );
}

function OnboardingEnvelopeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round">
      <rect x="2.5" y="5" width="19" height="14" rx="2" />
      <path d="M3 6 L12 13.5 L21 6" />
    </svg>
  );
}

function OnboardingCheckIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="9" fill="currentColor" />
      <path d="M5.8 10.3 L8.6 13.1 L14.2 7.3" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function OnboardingCloseIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M5 5 L15 15 M15 5 L5 15" />
    </svg>
  );
}

function NomiOnboarding({
  shopName,
  tone,
  onPickTone,
  onFinish,
}: {
  shopName: string;
  tone: EmailTone;
  onPickTone: (tone: EmailTone) => void;
  onFinish: () => void;
}) {
  const [step, setStep] = useState(0);
  const [foundN, setFoundN] = useState(0);
  const [dayN, setDayN] = useState(0);
  const [pickedTone, setPickedTone] = useState<EmailTone | null>(null);
  const [generating, setGenerating] = useState(false);
  const [checkN, setCheckN] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);

  // Bumped at the start of every top-level action (a click, or unmount) so
  // any timers still in flight from a previous chain become no-ops instead
  // of firing into stale state — the same guard the approved mockup's own
  // state machine uses.
  const tokenRef = useRef(0);

  const activeTone = pickedTone ?? tone;

  useEffect(() => {
    setReducedMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onFinish();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onFinish]);

  useEffect(() => {
    return () => {
      tokenRef.current += 1;
    };
  }, []);

  const after = (ms: number, fn: () => void) => {
    const myToken = tokenRef.current;
    window.setTimeout(() => {
      if (myToken === tokenRef.current) fn();
    }, reducedMotion ? 0 : ms);
  };

  const goStep4 = () => {
    setStep(4);
    setGenerating(true);
    setCheckN(0);
    after(ONBOARDING_TIMING.generating, () => {
      setGenerating(false);
      const revealCheck = (n: number) => {
        setCheckN(n);
        if (n < ONBOARDING_CHECKLIST.length) after(ONBOARDING_TIMING.checklistStep, () => revealCheck(n + 1));
        else after(ONBOARDING_TIMING.finishPause, onFinish);
      };
      revealCheck(1);
    });
  };

  const goStep2 = () => {
    setStep(2);
    setDayN(0);
    const revealDay = (n: number) => {
      setDayN(n);
      if (n < ONBOARDING_DAYS.length) after(ONBOARDING_TIMING.dayStep, () => revealDay(n + 1));
      else after(ONBOARDING_TIMING.daySettle, () => setStep(3));
    };
    revealDay(1);
  };

  useEffect(() => {
    after(ONBOARDING_TIMING.welcomePause, connect);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connect = () => {
    tokenRef.current += 1;
    setStep(1);
    setFoundN(0);
    const revealFound = (n: number) => {
      setFoundN(n);
      if (n < ONBOARDING_FOUND_CARDS.length) after(ONBOARDING_TIMING.foundCardStep, () => revealFound(n + 1));
      else after(ONBOARDING_TIMING.foundCardSettle, goStep2);
    };
    revealFound(1);
  };

  const pickTone = (nextTone: EmailTone) => {
    tokenRef.current += 1;
    setPickedTone(nextTone);
    onPickTone(nextTone);
    after(ONBOARDING_TIMING.tonePick, goStep4);
  };

  // The rail's per-tab progress fill mirrors the timer chains above exactly
  // (same constants) so a bar finishes filling at the same instant its step
  // actually advances, instead of just snapping to full the moment a step
  // becomes active.
  const tabFillMs: Partial<Record<number, number>> = {
    0: ONBOARDING_TIMING.welcomePause,
    1: ONBOARDING_TIMING.foundCardStep * (ONBOARDING_FOUND_CARDS.length - 1) + ONBOARDING_TIMING.foundCardSettle,
    2: ONBOARDING_TIMING.dayStep * (ONBOARDING_DAYS.length - 1) + ONBOARDING_TIMING.daySettle,
    3: ONBOARDING_TIMING.tonePick,
    4:
      ONBOARDING_TIMING.generating +
      ONBOARDING_TIMING.checklistStep * (ONBOARDING_CHECKLIST.length - 1) +
      ONBOARDING_TIMING.finishPause,
  };

  function renderStep(): React.ReactNode {
    if (step === 0) {
      return (
        <div className="nomi-onboarding-step-inner" key="step-0">
          <div className="nomi-onboarding-orbit" aria-hidden="true">
            {ONBOARDING_ORBIT_CHIPS.map((chip) => (
              <span
                key={chip.hue}
                className="nomi-onboarding-orbit-spin"
                style={{
                  animationDuration: `${chip.duration}s`,
                  animationDirection: chip.reverse ? "reverse" : "normal",
                } as React.CSSProperties}
              >
                <span
                  className="nomi-onboarding-orbit-counter"
                  style={{
                    left: `calc(50% + ${chip.x}px)`,
                    top: `calc(50% + ${chip.y}px)`,
                    animationDuration: `${chip.duration}s`,
                    // Cancels the outer wrapper's spin so the chip itself stays
                    // upright while still orbiting — same speed, opposite direction.
                    animationDirection: chip.reverse ? "normal" : "reverse",
                  } as React.CSSProperties}
                >
                  <span
                    className="nomi-onboarding-orbit-fly"
                    style={{
                      "--nomi-orb-fx": `${chip.x * 1.4}px`,
                      "--nomi-orb-fy": `${chip.y * 1.4}px`,
                      animationDelay: `${chip.delay}ms`,
                    } as React.CSSProperties}
                  >
                    <span
                      className={`nomi-onboarding-orbit-chip is-${chip.hue}`}
                      style={{ width: chip.size, height: chip.size }}
                    />
                  </span>
                </span>
              </span>
            ))}
            <span className="nomi-onboarding-orbit-center">
              <OnboardingMarkIcon />
            </span>
          </div>
          <div className="nomi-onboarding-copy is-orbit-copy">
            <h1 id="nomi-onboarding-title">Welcome, {shopName}.</h1>
            <p>Shopify already told us who you are. Let&rsquo;s get your emails ready.</p>
          </div>
        </div>
      );
    }

    if (step === 1) {
      return (
        <div className="nomi-onboarding-step-inner" key="step-1">
          <div className="nomi-onboarding-found" aria-hidden="true">
            {ONBOARDING_FOUND_CARDS.slice(0, foundN).map((card) => (
              <div
                key={card.tag}
                className="nomi-onboarding-found-card"
                style={{ marginLeft: card.offset, "--nomi-onb-rot": card.rotate } as React.CSSProperties}
              >
                <div className={`nomi-onboarding-found-swatch is-${card.hue}`} />
                <span className={`nomi-onboarding-found-tag is-${card.hue}`}>{card.tag}</span>
              </div>
            ))}
          </div>
          <div className="nomi-onboarding-copy">
            <h1 id="nomi-onboarding-title">Found you, {shopName}.</h1>
            <p>Your products, your colors, your fonts — already loaded, nothing to upload.</p>
          </div>
        </div>
      );
    }

    if (step === 2) {
      return (
        <div className="nomi-onboarding-step-inner" key="step-2">
          <div className="nomi-onboarding-days" aria-hidden="true">
            {ONBOARDING_DAYS.map((day, index) => (
              <div className="nomi-onboarding-day" key={day.label}>
                <span>{day.label}</span>
                <div className="nomi-onboarding-day-items">
                  {index < dayN
                    ? day.items.map((hue, itemIndex) => (
                        <span key={itemIndex} className={`nomi-onboarding-day-mail is-${hue}`}>
                          <OnboardingEnvelopeIcon />
                        </span>
                      ))
                    : null}
                </div>
              </div>
            ))}
          </div>
          <div className="nomi-onboarding-copy">
            <h1 id="nomi-onboarding-title">We&rsquo;ll know exactly when to say something.</h1>
            <p>Five moments over two weeks, from checkout to &ldquo;how was it?&rdquo;</p>
          </div>
        </div>
      );
    }

    if (step === 3) {
      return (
        <div className="nomi-onboarding-step-inner is-tight" key="step-3">
          <div className="nomi-onboarding-copy">
            <h1 id="nomi-onboarding-title">What&rsquo;s your vibe?</h1>
            <p>Pick a tone and we&rsquo;ll write like that everywhere.</p>
          </div>
          <div className="nomi-onboarding-tones" role="radiogroup" aria-label="Choose the tone for your emails">
            {ONBOARDING_TONE_OPTIONS.map((option) => (
              <button
                key={option.code}
                type="button"
                role="radio"
                aria-checked={activeTone === option.code}
                className={`nomi-onboarding-tone${activeTone === option.code ? " is-chosen" : ""}`}
                onClick={() => pickTone(option.code)}
              >
                <span className={`nomi-onboarding-tone-dot is-${option.hue}`} aria-hidden="true" />
                <span className="nomi-onboarding-tone-copy">
                  <strong>{option.name}</strong>
                  <em>“{option.example}”</em>
                </span>
                {activeTone === option.code ? (
                  <span className="nomi-onboarding-tone-check" aria-hidden="true">
                    <OnboardingCheckIcon />
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </div>
      );
    }

    if (generating) {
      return (
        <div className="nomi-onboarding-step-inner is-tight" key="step-4-loading">
          <span className="nomi-onboarding-icon is-small" aria-hidden="true">
            <OnboardingMarkIcon />
          </span>
          <div className="nomi-onboarding-copy">
            <h1 id="nomi-onboarding-title">Writing your five emails…</h1>
            <p>Pulling in your products, your colors, and the tone you picked.</p>
          </div>
          <div className="nomi-onboarding-progress-track" aria-hidden="true">
            <span className="nomi-onboarding-progress-fill" />
          </div>
        </div>
      );
    }

    return (
      <div className="nomi-onboarding-step-inner" key="step-4-ready">
        <div className="nomi-onboarding-checklist" aria-hidden="true">
          {ONBOARDING_CHECKLIST.map((item, index) => (
            <div key={item.name} className={`nomi-onboarding-check-row${index < checkN ? " is-on" : ""}`}>
              <span className="nomi-onboarding-check-mark-slot">
                {index < checkN ? (
                  <span className={`nomi-onboarding-check-mark is-${item.hue}`}>
                    <OnboardingCheckIcon />
                  </span>
                ) : (
                  <span className="nomi-onboarding-check-empty" />
                )}
              </span>
              <strong>{item.name}</strong>
            </div>
          ))}
        </div>
        <div className="nomi-onboarding-copy">
          <h1 id="nomi-onboarding-title">Five emails, ready when you are.</h1>
          <p>Nothing sends until you say go.</p>
        </div>
      </div>
    );
  }

  return (
    <main className="nomi-onboarding" aria-labelledby="nomi-onboarding-title">
      <div className="nomi-onboarding-brand">
        <span className="nomi-onboarding-mark" aria-hidden="true">
          <OnboardingMarkIcon />
        </span>
        <span className="nomi-onboarding-wordmark">Nomi</span>
      </div>

      <section className="nomi-onboarding-card" aria-live="polite">
        <div className="nomi-setup-header">
          <div>
            <strong>Setting up Nomi</strong>
            <span>{shopName}</span>
          </div>
          <button
            className="nomi-onboarding-close"
            type="button"
            onClick={onFinish}
            aria-label="Close setup"
          >
            <OnboardingCloseIcon />
          </button>
        </div>

        <div className="nomi-setup-tabs" aria-label={`Setup screen ${step + 1} of 5`}>
          {ONBOARDING_RAIL.map((label, index) => {
            const isActive = index === step;
            const isComplete = index < step;
            // Step 3 waits on a tone pick before it has a fixed duration to
            // animate against — it stays empty until one is chosen.
            const isFilling = isActive && (index !== 3 || pickedTone !== null);
            return (
              <div
                className={`${isActive ? "is-active" : ""}${isComplete ? " is-complete" : ""}${isFilling ? " is-filling" : ""}`}
                key={`${label}-${isActive}-${isFilling}`}
                style={
                  isFilling
                    ? ({ "--nomi-tab-duration": `${tabFillMs[index]}ms` } as React.CSSProperties)
                    : undefined
                }
              >
                <span>{label}</span>
                <i aria-hidden="true" />
              </div>
            );
          })}
        </div>

        <div className="nomi-setup-body">
          <div className="nomi-onboarding-step">{renderStep()}</div>
        </div>
      </section>

      {step < 4 ? (
        <button className="nomi-onboarding-skip" type="button" onClick={onFinish}>
          Skip setup
        </button>
      ) : null}
    </main>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  const headers = boundary.headers(headersArgs);
  // Merchant-specific, frequently-mutated dashboard data (Brand Studio
  // rendered emails in particular) must never be served stale by a dev
  // tunnel, CDN, or the browser's own cache after a regenerate.
  headers.set("Cache-Control", "no-store");
  return headers;
};
