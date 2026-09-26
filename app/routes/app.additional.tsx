import { useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Link, useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { LIFECYCLE_TEMPLATE_COPY } from "../email-engine/templates/lifecycle-template-copy";
import {
  LIFECYCLE_FLOWS,
  buildLifecycleSlots,
} from "../dashboard/lifecycle-flow-catalog";
import {
  auditCompiledEmail,
  auditEmailFamily,
  type EmailQualityReport,
} from "../brand-studio/email-quality";
import {
  type BrandSystem,
  type LifecycleRecipe,
} from "../brand-studio/types";
import { getApprovedBrandStudioFamily } from "../brand-studio/approved-family";

const LOOKS = [
  {
    id: "gauge",
    name: "Gauge",
    primaryColor: "#6e8d89",
    buttonText: "Revisit the system",
    description:
      "A measured look for care-led stores. The preview shows the palette and tone Nomi would carry across the brand’s emails.",
    bestFor: "Skincare · wellness · self-care · ritual-led products",
    eyebrow: "01 / Brand showcase",
    headline: "Measured care. Made visible.",
    feeling: "Quiet. Measured. Tactile.",
    palette: ["#f2f0e9", "#202520", "#6e8d89", "#d6b3a7"],
    paletteNames: ["Paper", "Ink", "Mineral", "Blush"],
    emails: [
      {
        kind: "Welcome",
        title: "The routine is still three steps.",
        timing: "Sent after sign-up",
      },
      {
        kind: "Educate",
        title: "Each product has one place.",
        timing: "Sent 1 day later",
      },
      {
        kind: "Reset",
        title: "Start with the step that went missing.",
        timing: "Sent 3 days later",
      },
    ],
  },
  {
    id: "denizen",
    name: "Denizen",
    primaryColor: "#405771",
    buttonText: "Return to your route",
    description:
      "A grounded look for practical, style-conscious stores. The preview shows the palette and tone Nomi would carry across the brand’s emails.",
    bestFor: "Footwear · fashion · accessories · everyday lifestyle",
    eyebrow: "02 / Brand showcase",
    headline: "Your route has more than one colour.",
    feeling: "Direct, grounded and useful. The palette carries the movement.",
    palette: ["#20231f", "#d6d4cb", "#6f786b", "#405771", "#be5544"],
    paletteNames: ["Asphalt", "Chalk", "Moss", "Cobalt", "Brick"],
    emails: [
      {
        kind: "Cart",
        title: "Your selected route is here.",
        timing: "Sent 1 hour after cart",
      },
      {
        kind: "Product",
        title: "Know the pair.",
        timing: "Sent 24 hours later",
      },
      {
        kind: "Return",
        title: "A clear way back.",
        timing: "Sent 3 days later",
      },
    ],
  },
] as const;

type Look = (typeof LOOKS)[number];
type LookId = Look["id"];
type TemplatesActionRequest = {
  kind: "apply-look";
  primaryColor: string;
  buttonText: string;
};

function isColor(value: string) {
  return /^#[0-9a-f]{6}$/i.test(value);
}
function getLookId(primaryColor: string | null): LookId {
  return (
    LOOKS.find((look) => look.primaryColor === primaryColor)?.id ?? "gauge"
  );
}
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const requestedLook = url.searchParams.get("look");
  const showGeneratedBrand = url.searchParams.get("brand") === "selected";
  const [choices, brandProfile] = await Promise.all([
    db.lifecycleTemplateChoice.findMany({
      where: { shop: session.shop },
      select: { primaryColor: true, buttonText: true },
      orderBy: { updatedAt: "desc" },
    }),
    db.brandStudioProfile.findUnique({
      where: { shop: session.shop },
      select: {
        evidence: true,
        brandSystem: true,
        lifecycleRecipes: true,
        renderedEmails: true,
        evidenceFingerprint: true,
        snapshotEvidenceFingerprint: true,
        generatedEvidenceFingerprint: true,
        status: true,
        directions: true,
        selectedDirectionId: true,
      },
    }),
  ]);
  const approvedFamily = getApprovedBrandStudioFamily(brandProfile);
  const generatedBrand = approvedFamily?.brandSystem ?? null;
  const generatedRecipes = approvedFamily?.recipes ?? [];
  const evidence = showGeneratedBrand ? approvedFamily?.evidence ?? null : null;
  const renderedEmails = approvedFamily?.renderedEmails ?? {};
  const generatedEmails =
    generatedBrand && evidence
      ? generatedRecipes.flatMap((recipe) => {
          const html = renderedEmails[recipe.id];
          if (!html) return [];
          return [{
            recipe,
            html,
            quality: auditCompiledEmail({
              html,
              recipe,
              brandSystem: generatedBrand,
              products: evidence.products,
              storefrontUrl: evidence.storefrontUrl,
            }),
          }];
        })
      : [];
  const familyQuality = generatedBrand
    ? auditEmailFamily({ brandSystem: generatedBrand, emails: generatedEmails })
    : null;
  return {
    selectedLookId: getLookId(choices[0]?.primaryColor ?? null),
    activeLookId: LOOKS.some((look) => look.id === requestedLook)
      ? (requestedLook as LookId)
      : null,
    buttonText: choices[0]?.buttonText ?? null,
    generatedBrand,
    showGeneratedBrand,
    generatedEmails,
    familyQuality,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const payload = (await request.formData()).get("payload");
  if (typeof payload !== "string") return { error: "Missing request data." };
  let parsed: TemplatesActionRequest;
  try {
    parsed = JSON.parse(payload) as TemplatesActionRequest;
  } catch {
    return { error: "The template update was not valid." };
  }
  if (
    parsed.kind !== "apply-look" ||
    !isColor(parsed.primaryColor) ||
    parsed.buttonText.trim().length === 0 ||
    parsed.buttonText.length > 80
  )
    return {
      error: "Choose a valid colour and a button label of up to 80 characters.",
    };
  await db.$transaction(
    Object.keys(LIFECYCLE_TEMPLATE_COPY).map((slotId) =>
      db.lifecycleTemplateChoice.upsert({
        where: { shop_slotId: { shop: session.shop, slotId } },
        create: {
          shop: session.shop,
          slotId,
          mode: "template",
          primaryColor: parsed.primaryColor,
          buttonText: parsed.buttonText.trim(),
        },
        update: {
          mode: "template",
          primaryColor: parsed.primaryColor,
          buttonText: parsed.buttonText.trim(),
        },
      }),
    ),
  );
  return { ok: true, message: "Look saved for every lifecycle email." };
};

export default function TemplatesPage() {
  const data = useLoaderData<typeof loader>();
  const activeLook = LOOKS.find((look) => look.id === data.activeLookId);
  if (
    data.showGeneratedBrand &&
    data.generatedBrand &&
    data.generatedEmails.length &&
    data.familyQuality
  )
    return (
      <GeneratedBrandEmailSelection
        brand={data.generatedBrand}
        emails={data.generatedEmails}
        familyQuality={data.familyQuality}
      />
    );
  return activeLook ? (
    <Page17LookPreview look={activeLook} />
  ) : (
    <TemplateAlternatives
      selectedLookId={data.selectedLookId}
      generatedBrand={data.generatedBrand}
    />
  );
}

export function GeneratedBrandEmailSelection({
  brand,
  emails,
  familyQuality,
}: {
  brand: BrandSystem;
  emails: {
    recipe: LifecycleRecipe;
    html: string;
    quality: EmailQualityReport;
  }[];
  familyQuality: ReturnType<typeof auditEmailFamily>;
}) {
  const slots = buildLifecycleSlots("Your store");
  const [flowId, setFlowId] = useState(LIFECYCLE_FLOWS[0].id);
  const [selectedId, setSelectedId] = useState(emails[0].recipe.id);
  const selected =
    emails.find(({ recipe }) => recipe.id === selectedId) ?? emails[0];
  const chooseFlow = (nextFlowId: typeof flowId) => {
    setFlowId(nextFlowId);
    const first = LIFECYCLE_FLOWS.find(({ id }) => id === nextFlowId)
      ?.templateIds[0];
    if (first) setSelectedId(first);
  };
  const selectedErrors = selected.quality.issues.filter(
    ({ severity }) => severity === "error",
  );
  const selectedWarnings = selected.quality.issues.filter(
    ({ severity }) => severity === "warning",
  );
  return (
    <main
      className="nomi-generated-selection"
      style={
        {
          "--generated-paper": brand.palette.paper,
          "--generated-ink": brand.palette.ink,
          "--generated-primary": brand.palette.primary,
          "--generated-accent": brand.palette.accent,
        } as React.CSSProperties
      }
    >
      <header>
        <div>
          <Link to="/app/brand-studio?step=complete">← Brand System</Link>
          <p>Created for your store</p>
          <h1>{brand.name}</h1>
        </div>
        <span>13 coordinated emails · nothing is sending</span>
      </header>
      <section
        className={`nomi-generated-proof is-${familyQuality.status}`}
        aria-label="A1 email quality proof"
      >
        <div>
          <p>A1 proof</p>
          <strong>
            {familyQuality.status === "ready"
              ? "A1 production gate passed"
              : "Below A1 — revision required"}
          </strong>
          <span>
            {familyQuality.readyCount} of {familyQuality.totalCount} A1-ready ·{" "}
            {familyQuality.structureCount} distinct structures
          </span>
          {familyQuality.issues.length ? (
            <ul className="nomi-generated-family-issues">
              {familyQuality.issues.map((item) => (
                <li key={item.code}>{item.message}</li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className="nomi-generated-proof-track" aria-hidden="true">
          {emails.map(({ recipe, quality }) => (
            <i
              className={`is-${quality.status}`}
              title={recipe.subject}
              key={recipe.id}
            />
          ))}
        </div>
      </section>
      <div className="nomi-generated-selection-layout">
        <section className="nomi-generated-flow-list" aria-label="Email flows">
          <p>Choose a flow</p>
          {LIFECYCLE_FLOWS.map((flow) => (
            <div
              className={flow.id === flowId ? "is-active" : ""}
              key={flow.id}
            >
              <button
                type="button"
                onClick={() => chooseFlow(flow.id)}
                aria-expanded={flow.id === flowId}
              >
                <span>
                  <strong>{flow.name}</strong>
                  <small>
                    {flow.templateIds.length} emails · {flow.purpose}
                  </small>
                </span>
                <i>{flow.id === flowId ? "−" : "+"}</i>
              </button>
              {flow.id === flowId ? (
                <div>
                  {flow.templateIds.map((id) => {
                    const slot = slots.find((item) => item.id === id);
                    const email = emails.find(({ recipe }) => recipe.id === id);
                    return (
                      <button
                        type="button"
                        className={selectedId === id ? "is-selected" : ""}
                        onClick={() => setSelectedId(id)}
                        aria-pressed={selectedId === id}
                        key={id}
                      >
                        <i aria-hidden="true">✉</i>
                        <span>{slot?.name ?? id}</span>
                        <em>
                          {email?.quality.status === "ready"
                            ? "A1 ready"
                            : "Revise"}
                        </em>
                        {selectedId === id ? <b>Previewing</b> : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          ))}
        </section>
        <section className="nomi-generated-live">
          <div>
            <p>Live preview</p>
            <h2>{selected.recipe.headline}</h2>
            <span>{selected.recipe.subject}</span>
            <div
              className={`nomi-generated-email-proof is-${selected.quality.status}`}
            >
              <strong>
                {selected.quality.status === "ready"
                  ? "A1 email proof passed"
                  : `${selectedErrors.length} A1 ${selectedErrors.length === 1 ? "issue" : "issues"}`}
              </strong>
              <span>
                {Math.ceil(selected.quality.byteSize / 1024)}KB compiled ·{" "}
                {selectedWarnings.length
                  ? `${selectedWarnings.length} ${selectedWarnings.length === 1 ? "note" : "notes"}`
                  : "no warnings"}
              </span>
              {selected.quality.issues.length ? (
                <ul>
                  {selected.quality.issues.map((item) => (
                    <li key={item.code}>{item.message}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
          <iframe
            key={selected.recipe.id}
            title={`${selected.recipe.subject} email preview`}
            srcDoc={selected.html}
            sandbox="allow-popups"
          />
          <footer>
            <span>Actual 600px email · scroll inside the preview</span>
            <Link to="/app/flow-editor">
              {selected.quality.status === "ready"
                ? "Open Flow Editor"
                : "Fix in Flow Editor"}
            </Link>
          </footer>
        </section>
      </div>
    </main>
  );
}

function TemplateAlternatives({
  selectedLookId: _selectedLookId,
  generatedBrand,
}: {
  selectedLookId: LookId;
  generatedBrand: BrandSystem | null;
}) {
  return (
    <main className="nomi-template-alternatives">
      <div className="nomi-template-alternatives-shell">
        <header className="nomi-template-alternatives-header">
          <h1>
            {generatedBrand
              ? "Your email identity is here."
              : "Template preview alternatives"}
          </h1>
          <p>
            {generatedBrand
              ? "Brand Studio created this direction from your store. Gauge and Denizen remain references—not replacements for your system."
              : "Two ways Nomi can show a merchant’s identity before generating the full email system. Each preview is a proposed visual direction, not an email layout."}
          </p>
        </header>
        {generatedBrand ? (
          <GeneratedBrandArrival brand={generatedBrand} />
        ) : (
          <section
            className="nomi-store-palette"
            aria-label="Your storefront palette"
          >
            <div className="nomi-store-palette-copy">
              <span>Default / your store</span>
              <h2>Start with your own brand.</h2>
              <p>
                Nomi captures the connected storefront palette and makes it the
                starting point for every generated email.
              </p>
            </div>
            <div className="nomi-store-palette-board">
              <i className="nomi-palette-orb nomi-palette-orb-large" />
              <i className="nomi-palette-orb nomi-palette-orb-small" />
              <div className="nomi-store-colors">
                <ColorChip color="#b9c8c9" name="Primary" />
                <ColorChip color="#dad6cd" name="Neutral" />
                <ColorChip color="#cf9d8f" name="Accent" />
              </div>
              <em>Current default</em>
            </div>
          </section>
        )}
        <div className="nomi-look-alternatives">
          {LOOKS.map((look) => (
            <LookCard key={look.id} look={look} />
          ))}
        </div>
      </div>
    </main>
  );
}

function GeneratedBrandArrival({ brand }: { brand: BrandSystem }) {
  return (
    <section
      className="nomi-generated-brand-arrival"
      style={
        {
          "--generated-paper": brand.palette.paper,
          "--generated-ink": brand.palette.ink,
          "--generated-primary": brand.palette.primary,
          "--generated-accent": brand.palette.accent,
        } as React.CSSProperties
      }
    >
      <div className="nomi-generated-brand-copy">
        <span>Created for your store</span>
        <h2>{brand.name}</h2>
        <p>{brand.feeling}</p>
        <dl>
          <div>
            <dt>Display</dt>
            <dd>{brand.typography.display}</dd>
          </div>
          <div>
            <dt>Body</dt>
            <dd>{brand.typography.body}</dd>
          </div>
        </dl>
        <Link to="/app/brand-studio?step=complete">View Brand System</Link>
      </div>
      <div className="nomi-generated-brand-card">
        <header>
          <span>{brand.signatureMotif}</span>
          <b>BRAND SYSTEM / 01</b>
        </header>
        <div className="nomi-generated-brand-swatches">
          {Object.entries(brand.palette).map(([name, color]) => (
            <i key={name} style={{ backgroundColor: color }} title={name} />
          ))}
        </div>
        <h3>{brand.name}</h3>
        <p>{brand.voice.principles[0]}</p>
        <b>{brand.buttonTreatment}</b>
      </div>
    </section>
  );
}

function LookCard({ look }: { look: Look }) {
  const isGauge = look.id === "gauge";
  return (
    <article
      className={`nomi-look-alternative nomi-look-alternative-${look.id}`}
    >
      <div className="nomi-look-brief">
        <span>{look.eyebrow}</span>
        <h2>{look.name}</h2>
        <p>{look.description}</p>
        <b>Best for</b>
        <strong>{look.bestFor}</strong>
        <div className="nomi-look-mini-palette">
          {look.palette.map((color) => (
            <i key={color} style={{ backgroundColor: color }} />
          ))}
        </div>
      </div>
      <div className="nomi-look-showcase">
        <header className="nomi-look-showcase-head">
          <span>{look.name}</span>
          {!isGauge ? <small>Footwear for the parts in between</small> : null}
        </header>
        {isGauge ? <div className="nomi-look-showcase-rule" /> : null}
        <div className="nomi-look-showcase-body">
          <div className="nomi-look-showcase-colors">
            {look.palette.map((color, index) => (
              <ColorChip
                key={color}
                color={color}
                name={look.paletteNames[index]}
              />
            ))}
          </div>
          <div className="nomi-look-feeling">
            <h3>{look.headline}</h3>
            <p>{look.feeling}</p>
          </div>
        </div>
        <Link className="nomi-look-view" to={`?look=${look.id}`}>
          View {look.name} <span aria-hidden="true">→</span>
        </Link>
      </div>
    </article>
  );
}

function ColorChip({ color, name }: { color: string; name: string }) {
  return (
    <span className="nomi-color-chip">
      <i style={{ backgroundColor: color }} />
      <b>{name}</b>
    </span>
  );
}

function LookPreview({ look, buttonText }: { look: Look; buttonText: string }) {
  const fetcher = useFetcher<typeof action>();
  const [emailIndex, setEmailIndex] = useState(0);
  const [device, setDevice] = useState<"auto" | "desktop" | "mobile">("auto");
  const email = look.emails[emailIndex];
  const saving = fetcher.state !== "idle";
  const saved = Boolean(fetcher.data && "message" in fetcher.data);
  const save = () =>
    fetcher.submit(
      {
        payload: JSON.stringify({
          kind: "apply-look",
          primaryColor: look.primaryColor,
          buttonText,
        }),
      },
      { method: "POST" },
    );
  return (
    <main className={`nomi-look-preview nomi-look-preview-${look.id}`}>
      <header className="nomi-look-preview-header">
        <div>
          <Link to=".">← Back to looks</Link>
          <h1>{look.name}</h1>
        </div>
        <p>3-email {look.id === "gauge" ? "welcome" : "cart recovery"} flow</p>
        <div
          className="nomi-device-controls"
          role="group"
          aria-label="Preview device"
        >
          {(["auto", "desktop", "mobile"] as const).map((option) => (
            <button
              key={option}
              className={device === option ? "is-active" : ""}
              type="button"
              onClick={() => setDevice(option)}
              aria-pressed={device === option}
            >
              {option}
            </button>
          ))}
          <small>Auto follows this screen · switch anytime to check</small>
        </div>
      </header>
      <div className="nomi-look-preview-layout">
        <aside className="nomi-flow-rail">
          <span>{look.id === "gauge" ? "Welcome back" : "Cart recovery"}</span>
          <h2>3 emails</h2>
          {look.emails.map((item, index) => (
            <button
              type="button"
              key={item.kind}
              className={index === emailIndex ? "is-active" : ""}
              onClick={() => setEmailIndex(index)}
              aria-pressed={index === emailIndex}
            >
              <b>0{index + 1}</b>
              <em>{item.kind}</em>
              <strong>{item.title}</strong>
              <small>{item.timing}</small>
            </button>
          ))}
          <p>Click an email to inspect it.</p>
        </aside>
        <section className="nomi-email-stage">
          <span>
            {device === "desktop" ? "Desktop" : "Mobile"} preview / 390px email
          </span>
          <EmailPreview look={look} email={email} buttonText={buttonText} />
        </section>
        <aside className="nomi-preview-details">
          <span>
            0{emailIndex + 1} / {email.kind}
          </span>
          <h2>{email.kind === "Welcome" ? "Routine reset" : email.kind}</h2>
          <p>{email.title}</p>
          <hr />
          <b>Responsive preview</b>
          <h3>{device[0].toUpperCase() + device.slice(1)}</h3>
          <p>
            Uses your current screen width. A narrow screen opens the mobile
            preview; a wide screen opens desktop.
          </p>
          <div>
            <b>Always check both</b>
            <p>
              The switch stays available, so a merchant can confirm the email is
              right on mobile before using this look.
            </p>
          </div>
          <b>Look status</b>
          <h3>{saved ? "Active for your emails" : "Ready to use"}</h3>
          <button type="button" onClick={save} disabled={saving || saved}>
            {saving
              ? "Saving…"
              : saved
                ? `${look.name} is active`
                : `Use ${look.name} for my emails`}
          </button>
          <p className="nomi-look-save-result" role="status" aria-live="polite">
            {fetcher.data && "error" in fetcher.data
              ? fetcher.data.error
              : fetcher.data && "message" in fetcher.data
                ? fetcher.data.message
                : ""}
          </p>
        </aside>
      </div>
    </main>
  );
}

type Page17FlowId = "welcome" | "interest" | "cart" | "review";

const PAGE17_FLOWS = [
  {
    id: "welcome",
    name: "Welcome",
    tone: "welcome",
    count: 3,
    purpose: "First impression",
  },
  {
    id: "interest",
    name: "Still interested?",
    tone: "interest",
    count: 2,
    purpose: "Consideration",
  },
  {
    id: "cart",
    name: "Abandoned cart",
    tone: "cart",
    count: 3,
    purpose: "Recovery",
  },
  {
    id: "review",
    name: "How was it?",
    tone: "care",
    count: 2,
    purpose: "Care",
  },
] as const;

const PAGE17_EMAIL_NAMES: Record<
  LookId,
  Record<Page17FlowId, readonly string[]>
> = {
  gauge: {
    welcome: ["Welcome", "Educate", "Reset"],
    interest: ["Considering", "Routine fit"],
    cart: ["Cart reminder", "Product context", "Checkout"],
    review: ["Order confirmed", "Review request"],
  },
  denizen: {
    welcome: ["Welcome", "Palette", "Route"],
    interest: ["Long way", "Rotation"],
    cart: ["Route waiting", "Know the pair", "One step"],
    review: ["Order update", "Review request"],
  },
};

function ordinal(index: number) {
  return index === 0 ? "1st" : index === 1 ? "2nd" : "3rd";
}

function Page17LookPreview({ look }: { look: Look }) {
  const [flowId, setFlowId] = useState<Page17FlowId>("welcome");
  const [expandedFlowId, setExpandedFlowId] = useState<Page17FlowId | null>(
    "welcome",
  );
  const [emailIndex, setEmailIndex] = useState(0);
  const [scrollRail, setScrollRail] = useState({ top: 0, height: 40 });
  const previewRef = useRef<HTMLDivElement>(null);
  const emailKind = PAGE17_EMAIL_NAMES[look.id][flowId][emailIndex];

  const chooseFlow = (nextFlowId: Page17FlowId) => {
    if (nextFlowId === expandedFlowId) {
      setExpandedFlowId(null);
      return;
    }
    setExpandedFlowId(nextFlowId);
    setFlowId(nextFlowId);
    setEmailIndex(0);
  };

  const syncScrollRail = (viewport: HTMLDivElement) => {
    const height = Math.max(
      18,
      (viewport.clientHeight / viewport.scrollHeight) * 100,
    );
    const remainingTrack = 100 - height;
    const top =
      viewport.scrollHeight > viewport.clientHeight
        ? (viewport.scrollTop /
            (viewport.scrollHeight - viewport.clientHeight)) *
          remainingTrack
        : 0;
    setScrollRail({ top, height });
  };

  useEffect(() => {
    const viewport = previewRef.current;
    if (!viewport) return;
    viewport.scrollTo({ top: 0 });
    syncScrollRail(viewport);
    const observer = new ResizeObserver(() => syncScrollRail(viewport));
    observer.observe(viewport);
    if (viewport.firstElementChild)
      observer.observe(viewport.firstElementChild);
    return () => observer.disconnect();
  }, [flowId, emailIndex, look.id]);

  return (
    <main className={`nomi-page17 nomi-page17-${look.id}`}>
      <div className="nomi-page17-shell">
        <section
          className="nomi-page17-selector"
          aria-labelledby="page17-flow-selector-title"
        >
          <p className="nomi-page17-kicker" id="page17-flow-selector-title">
            Choose a flow
          </p>
          {PAGE17_FLOWS.map((flow) => {
            const expanded = flow.id === expandedFlowId;
            const names = PAGE17_EMAIL_NAMES[look.id][flow.id];
            return (
              <div
                className={`nomi-page17-flow nomi-page17-flow-${flow.tone}${expanded ? " is-expanded" : ""}`}
                key={flow.id}
              >
                <button
                  className="nomi-page17-flow-head"
                  type="button"
                  onClick={() => chooseFlow(flow.id)}
                  aria-expanded={expanded}
                  aria-controls={`page17-${flow.id}-emails`}
                >
                  <span
                    className="nomi-page17-flow-accent"
                    aria-hidden="true"
                  />
                  <span className="nomi-page17-flow-copy">
                    <strong>{flow.name}</strong>
                    <small>
                      {flow.count} emails · {flow.purpose}
                    </small>
                  </span>
                  {!expanded ? (
                    <span
                      className="nomi-page17-flow-progress"
                      aria-hidden="true"
                    >
                      0 / {flow.count}
                    </span>
                  ) : null}
                  <span className="nomi-page17-flow-control" aria-hidden="true">
                    <svg viewBox="0 0 16 16" focusable="false">
                      <path
                        d={
                          expanded
                            ? "M3.5 10 8 5.5 12.5 10"
                            : "M3.5 6 8 10.5 12.5 6"
                        }
                      />
                    </svg>
                  </span>
                </button>
                {expanded ? (
                  <div
                    className="nomi-page17-emails"
                    id={`page17-${flow.id}-emails`}
                    role="list"
                    aria-label={`${flow.name} emails`}
                  >
                    {names.map((name, index) => (
                      <button
                        className={`nomi-page17-email${index === emailIndex ? " is-selected" : ""}`}
                        key={name}
                        type="button"
                        onClick={() => setEmailIndex(index)}
                        aria-pressed={index === emailIndex}
                      >
                        <span className="nomi-page17-mail" aria-hidden="true">
                          ✉
                        </span>
                        <span className="nomi-page17-email-name">
                          {ordinal(index)} {name} Email
                        </span>
                        {index === emailIndex ? (
                          <span className="nomi-page17-previewing">
                            Previewing
                          </span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </section>
        <section
          className="nomi-page17-live-preview"
          aria-labelledby="page17-live-preview-title"
        >
          <div className="nomi-page17-preview-heading">
            <p className="nomi-page17-kicker" id="page17-live-preview-title">
              Live preview
            </p>
            <h1>
              0{emailIndex + 1} / {emailKind}
            </h1>
            <p>Previewing at the actual email width.</p>
          </div>
          <div className="nomi-page17-email-window">
            <div
              className="nomi-page17-email-viewport"
              ref={previewRef}
              tabIndex={0}
              onScroll={(event) => syncScrollRail(event.currentTarget)}
              aria-label={`${look.name} ${emailKind} email preview. Scroll to view the full email.`}
            >
              <div
                className="nomi-page17-email-scale"
                key={`${look.id}-${flowId}-${emailIndex}`}
              >
                <Page17Email
                  look={look}
                  flowId={flowId}
                  emailIndex={emailIndex}
                />
              </div>
            </div>
            <span className="nomi-page17-scroll-rail" aria-hidden="true">
              <i
                style={{
                  top: `${scrollRail.top}%`,
                  height: `${scrollRail.height}%`,
                }}
              />
            </span>
          </div>
          <div className="nomi-page17-preview-footer">
            <span>Scroll to see the rest.</span>
            <Link
              className="nomi-page17-customize"
              to={`/app/template-editor?look=${look.id}&flow=${flowId}&email=${emailIndex}`}
            >
              Start customizing
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}

const GAUGE_FLOW_IMAGES: Record<Page17FlowId, readonly string[]> = {
  welcome: [
    "/template-looks/gauge-welcome-01.png",
    "/template-looks/gauge-welcome-02-v2.png",
    "/template-looks/gauge-welcome-03.png",
  ],
  interest: [
    "/template-looks/gauge-interest-01.png",
    "/template-looks/gauge-interest-02-v2.png",
  ],
  cart: [
    "/template-looks/gauge-cart-01.png",
    "/template-looks/gauge-cart-02.png",
    "/template-looks/gauge-cart-03-v2.png",
  ],
  review: [
    "/template-looks/gauge-review-01.png",
    "/template-looks/gauge-review-02-v2.png",
  ],
};

const DENIZEN_IMAGE_SOURCES = {
  catalog: "/template-looks/denizen-vector-01.png",
  detail: "/template-looks/denizen-material-macro.png",
  city: "/template-looks/denizen-city-walk.jpg",
  transit: "/template-looks/denizen-transit-pair.jpg",
  steps: "/template-looks/denizen-steps.jpg",
} as const;

const DENIZEN_FLOW_EMAILS = {
  welcome: [
    {
      eyebrow: "WELCOME / 01",
      title: "Built for the long way home.",
      copy: "For early starts, long crossings and the streets that become yours. A shoe built to keep pace without asking where you are going.",
      cta: "EXPLORE VECTOR 01",
      image: "city",
      theme: "dark",
    },
    {
      eyebrow: "THE COLOUR ROUTE / 02",
      title: "Your route has more than one colour.",
      copy: "Blacktop, chalk, moss, cobalt and brick. Five grounded colours for every part of the route.",
      cta: "SEE THE COLOUR ROUTE",
      image: "transit",
      theme: "light",
    },
    {
      eyebrow: "CHOOSE YOUR ROUTE / 03",
      title: "Start with the part that moves.",
      copy: "Begin with the pair that matches how you move. The rest of the route can follow.",
      cta: "CHOOSE YOUR PAIR",
      image: "steps",
      theme: "dark",
    },
  ],
  interest: [
    {
      eyebrow: "THE LONG WAY / 01",
      title: "Still thinking about the long way?",
      copy: "A route should feel useful before it feels familiar. Vector 01 is ready whenever the longer way calls.",
      cta: "SEE VECTOR 01",
      image: "catalog",
      theme: "light",
    },
    {
      eyebrow: "COLOUR ROUTE / 02",
      title: "A rotation, not a uniform.",
      copy: "A considered palette keeps every route open. Choose the colour that fits the day already in motion.",
      cta: "SEE THE COLOUR ROUTE",
      image: "transit",
      theme: "dark",
    },
  ],
  cart: [
    {
      eyebrow: "YOUR ROUTE / 01",
      title: "Your selected route is still here.",
      copy: "Vector 01 remains in your selection. Return when the pair still fits where you are going.",
      cta: "RETURN TO YOUR ROUTE",
      image: "city",
      theme: "dark",
    },
    {
      eyebrow: "KNOW THE PAIR / 02",
      title: "Know the pair before you continue.",
      copy: "Ripstop, suede and a grounded sole. The details are clear before you decide to continue.",
      cta: "REVIEW YOUR PAIR",
      image: "detail",
      theme: "dark",
    },
    {
      eyebrow: "ONE STEP / 03",
      title: "One step from the route.",
      copy: "Your selected pair is still here. Continue only if it still belongs on the route ahead.",
      cta: "CONTINUE CHECKOUT",
      image: "steps",
      theme: "dark",
    },
  ],
  review: [
    {
      eyebrow: "ORDER CONFIRMED / 01",
      title: "Your route is on its way.",
      copy: "Everything is in order. Keep this note nearby while your selected pair makes its way to you.",
      cta: "VIEW YOUR ORDER",
      image: "transit",
      theme: "light",
    },
    {
      eyebrow: "FIELD NOTE / 02",
      title: "Start where you are.",
      copy: "Your experience helps the next person understand how the pair moves through a real day.",
      cta: "LEAVE A FIELD NOTE",
      image: "city",
      theme: "light",
    },
  ],
} as const;

function Page17Email({
  look,
  flowId,
  emailIndex,
}: {
  look: Look;
  flowId: Page17FlowId;
  emailIndex: number;
}) {
  if (look.id === "gauge") {
    return (
      <img
        className="nomi-page17-email-image"
        src={GAUGE_FLOW_IMAGES[flowId][emailIndex]}
        alt={`Gauge ${PAGE17_EMAIL_NAMES.gauge[flowId][emailIndex]} email`}
      />
    );
  }

  const email = DENIZEN_FLOW_EMAILS[flowId][emailIndex];
  return (
    <article className={`nomi-denizen-email nomi-denizen-email-${email.theme}`}>
      <header>
        <strong>DENIZEN</strong>
        <span>VECTOR 01 / AUTUMN FIELD NOTES</span>
      </header>
      <img
        src={DENIZEN_IMAGE_SOURCES[email.image]}
        alt={`Denizen Vector 01 ${email.image} campaign view`}
      />
      <section className="nomi-denizen-email-intro">
        <small>{email.eyebrow}</small>
        <h2>{email.title}</h2>
        <p>{email.copy}</p>
        <strong>{email.cta}</strong>
      </section>
      {flowId === "welcome" && emailIndex === 0 ? (
        <section className="nomi-denizen-email-note">
          <small>01 / DETAILS</small>
          <h3>Quiet details, active days.</h3>
          <p>
            Ripstop, suede and a considered flash of brick. Built to register up
            close and disappear into the route.
          </p>
        </section>
      ) : null}
      {flowId === "welcome" && emailIndex === 2 ? (
        <div className="nomi-denizen-route-map" aria-hidden="true">
          <i />
          <i />
          <i />
          <span>HOME</span>
          <span>CITY</span>
          <span>BEYOND</span>
        </div>
      ) : null}
      <footer>
        <strong>DENIZEN</strong>
        <p>
          Footwear for the parts in between.
          <br />
          Manage preferences / Unsubscribe
        </p>
      </footer>
    </article>
  );
}

function EmailPreview({
  look,
  email,
  buttonText,
}: {
  look: Look;
  email: Look["emails"][number];
  buttonText: string;
}) {
  const image =
    look.id === "gauge"
      ? "/template-looks/gauge-welcome-01.png"
      : "/template-looks/denizen-vector-01.png";
  return (
    <article className="nomi-look-email">
      <header>
        <b>{look.name}</b>
        <i />
      </header>
      <img src={image} alt="" />
      <section>
        <h2>{email.title}</h2>
        <p>
          {look.id === "gauge"
            ? "Cleanse. Treat. Seal. Return to the system whenever you need a clearer place to begin."
            : "A considered selection is waiting. Come back whenever your route calls for it."}
        </p>
        <strong>{buttonText}</strong>
      </section>
      <footer>
        <b>{look.name}</b>
        <p>
          123 Placeholder Street, City, Country
          <br />
          Manage preferences · Unsubscribe
        </p>
      </footer>
    </article>
  );
}
