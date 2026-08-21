// The Templates page — real, hand-built templates as an alternative to AI
// generation, one lifecycle slot at a time. Deliberately separate from the
// Flow Editor (app._index.tsx): that page is AI generation only, this page
// is templates only. A slot's mode (AI vs template) is shared state
// (LifecycleTemplateChoice, persisted per shop+slot) — switching it here
// changes what the Flow Editor would show for that slot too, but the
// controls to do the switching live only here.
import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { loadDashboardData } from "../dashboard/dashboard-data.server";
import { buildLifecycleInputs } from "../dashboard/lifecycle-inputs";
import { LIFECYCLE_FLOWS, buildLifecycleSlots, type LifecycleFlowId } from "../dashboard/lifecycle-flow-catalog";
import { renderLifecycleTemplateHtml } from "../email-engine/templates/lifecycle-template";
import { LIFECYCLE_TEMPLATE_COPY } from "../email-engine/templates/lifecycle-template-copy";
import type { LifecycleTemplateCustomization } from "../email-engine/templates/types";
import type { EmailLanguage, EmailTone, LifecycleEmailId } from "../email-engine/types";

type TemplateChoice = { mode: "ai" | "template" } & LifecycleTemplateCustomization;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  const settings = await db.shopSettings.upsert({
    where: { shop: session.shop },
    create: { shop: session.shop },
    update: {},
  });

  const { shopName, products, order, cart, reviewRequest } = await loadDashboardData(admin);

  const templateChoices = Object.fromEntries(
    (await db.lifecycleTemplateChoice.findMany({ where: { shop: session.shop } })).map((row) => [
      row.slotId,
      { mode: row.mode as "ai" | "template", logoUrl: row.logoUrl, primaryColor: row.primaryColor, buttonText: row.buttonText },
    ]),
  ) as Partial<Record<LifecycleEmailId, TemplateChoice>>;

  return {
    shopName,
    products,
    order,
    cart,
    reviewRequest,
    language: settings.language as EmailLanguage,
    tone: settings.tone as EmailTone,
    templateChoices,
  };
};

type TemplatesActionRequest = {
  kind: "set-lifecycle-template";
  slotId: LifecycleEmailId;
  mode: "ai" | "template";
  logoUrl: string | null;
  primaryColor: string | null;
  buttonText: string | null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const formData = await request.formData();
  const payload = formData.get("payload");
  if (typeof payload !== "string") {
    return { error: "Missing request data." };
  }

  const parsed = JSON.parse(payload) as TemplatesActionRequest;
  if (parsed.kind !== "set-lifecycle-template") {
    return { error: "Unknown request." };
  }
  if (!(parsed.slotId in LIFECYCLE_TEMPLATE_COPY)) {
    return { error: "Unknown lifecycle email." };
  }
  if (parsed.mode !== "ai" && parsed.mode !== "template") {
    return { error: "Unknown template mode." };
  }

  await db.lifecycleTemplateChoice.upsert({
    where: { shop_slotId: { shop: session.shop, slotId: parsed.slotId } },
    create: {
      shop: session.shop,
      slotId: parsed.slotId,
      mode: parsed.mode,
      logoUrl: parsed.logoUrl,
      primaryColor: parsed.primaryColor,
      buttonText: parsed.buttonText,
    },
    update: {
      mode: parsed.mode,
      logoUrl: parsed.logoUrl,
      primaryColor: parsed.primaryColor,
      buttonText: parsed.buttonText,
    },
  });

  return { ok: true };
};

const EMPTY_CHOICE: TemplateChoice = { mode: "ai", logoUrl: null, primaryColor: null, buttonText: null };

export default function TemplatesPage() {
  const { shopName, products, order, cart, reviewRequest, language, tone, templateChoices: initialTemplateChoices } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();

  const [templateChoices, setTemplateChoices] =
    useState<Partial<Record<LifecycleEmailId, TemplateChoice>>>(initialTemplateChoices);
  const [selectedSlotId, setSelectedSlotId] = useState<LifecycleEmailId>("welcome-1");
  const [expandedFlowId, setExpandedFlowId] = useState<LifecycleFlowId | "">("welcome");

  const getChoice = (id: LifecycleEmailId) => templateChoices[id] ?? EMPTY_CHOICE;

  const updateChoice = (id: LifecycleEmailId, patch: Partial<TemplateChoice>) => {
    const next = { ...getChoice(id), ...patch };
    setTemplateChoices((current) => ({ ...current, [id]: next }));
    fetcher.submit(
      { payload: JSON.stringify({ kind: "set-lifecycle-template", slotId: id, ...next }) },
      { method: "POST" },
    );
  };

  const slots = buildLifecycleSlots(shopName);
  const lifecycleInputs = buildLifecycleInputs({ shopName, language, tone, products, order, cart, reviewRequest });

  const selectedSlot = slots.find(({ id }) => id === selectedSlotId) ?? slots[0];
  const selectedChoice = getChoice(selectedSlotId);
  const templateCount = slots.filter(({ id }) => getChoice(id).mode === "template").length;
  const previewHtml =
    selectedChoice.mode === "template"
      ? renderLifecycleTemplateHtml(lifecycleInputs[selectedSlotId], selectedChoice)
      : null;

  return (
    <main className="nomi-flow-page">
      <div className="nomi-flow-shell">
        <header className="nomi-flow-header">
          <div className="nomi-flow-title">
            <span className="nomi-flow-reference-arrow" aria-hidden="true">←</span>
            <div>
              <h1>Templates</h1>
              <p>Real, hand-built templates for your lifecycle emails — pick one instead of AI generation, per email.</p>
            </div>
          </div>
          <div className="nomi-flow-progress" aria-label={`${templateCount} of ${slots.length} using a real template`}>
            <strong>{templateCount} / {slots.length} TEMPLATE</strong>
            <i><b style={{ width: `${(templateCount / slots.length) * 100}%` }} /></i>
          </div>
        </header>

        <div className="nomi-flow-workspace">
          <section className="nomi-flow-selector">
            <div className="nomi-flow-groups">
              {LIFECYCLE_FLOWS.map((flow) => {
                const flowSlots = slots.filter(({ flowId }) => flowId === flow.id);
                const templatedInFlow = flowSlots.filter(({ id }) => getChoice(id).mode === "template").length;
                const isExpanded = expandedFlowId === flow.id;
                return (
                  <article
                    key={flow.id}
                    className={`nomi-flow-group tone-${flow.id}${flow.id === selectedSlot.flowId ? " is-current" : ""}`}
                  >
                    <button
                      type="button"
                      className="nomi-flow-group-head"
                      aria-expanded={isExpanded}
                      onClick={() => setExpandedFlowId(isExpanded ? "" : flow.id)}
                    >
                      <span className="nomi-flow-count">{templatedInFlow}/{flowSlots.length}</span>
                      <span className="nomi-flow-group-copy">
                        <strong>{flow.name}</strong>
                      </span>
                      <span className="nomi-flow-group-toggle" aria-hidden="true">
                        <span className="nomi-flow-chevron">⌄</span>
                      </span>
                    </button>
                    {isExpanded ? (
                      <div className="nomi-flow-email-list">
                        {flowSlots.map((slot) => {
                          const choice = getChoice(slot.id);
                          return (
                            <div
                              key={slot.id}
                              className={`nomi-flow-email-row${slot.id === selectedSlotId ? " is-selected" : ""}`}
                            >
                              <button
                                type="button"
                                className="nomi-flow-email-select"
                                onClick={() => setSelectedSlotId(slot.id)}
                              >
                                <i className="nomi-flow-mail-icon" aria-hidden="true">✉</i>
                                <span><strong>{slot.name}</strong><small>{slot.timing}</small></span>
                              </button>
                              <span className={`nomi-flow-state${choice.mode === "template" ? " is-ready" : ""}`}>
                                {choice.mode === "template" ? "Template" : "AI"}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </section>

          <aside className="nomi-flow-proof" aria-labelledby="nomi-templates-proof-title">
            <div className="nomi-flow-proof-topline">
              <div>
                <span>{selectedSlot.name} — preview</span>
                <h2 className="nomi-visually-hidden" id="nomi-templates-proof-title">{selectedSlot.subject}</h2>
              </div>
              <div className="nomi-mode-toggle" role="group" aria-label="Email source">
                <button
                  type="button"
                  className={selectedChoice.mode === "ai" ? "is-active" : undefined}
                  onClick={() => updateChoice(selectedSlotId, { mode: "ai" })}
                >
                  AI
                </button>
                <button
                  type="button"
                  className={selectedChoice.mode === "template" ? "is-active" : undefined}
                  onClick={() => updateChoice(selectedSlotId, { mode: "template" })}
                >
                  Template
                </button>
              </div>
            </div>

            {selectedChoice.mode === "template" ? (
              <div className="nomi-template-settings">
                <label>
                  <span>Logo URL</span>
                  <input
                    type="text"
                    placeholder="https://…"
                    value={selectedChoice.logoUrl ?? ""}
                    onChange={(event) =>
                      updateChoice(selectedSlotId, { logoUrl: event.target.value || null })
                    }
                  />
                </label>
                <label>
                  <span>Primary color</span>
                  <input
                    type="color"
                    value={selectedChoice.primaryColor ?? "#57534b"}
                    onChange={(event) =>
                      updateChoice(selectedSlotId, { primaryColor: event.target.value })
                    }
                  />
                </label>
                <label>
                  <span>Button text</span>
                  <input
                    type="text"
                    placeholder={LIFECYCLE_TEMPLATE_COPY[selectedSlotId].ctaLabel}
                    value={selectedChoice.buttonText ?? ""}
                    onChange={(event) =>
                      updateChoice(selectedSlotId, { buttonText: event.target.value || null })
                    }
                  />
                </label>
              </div>
            ) : null}

            <div className="nomi-flow-inbox-meta">
              <div><strong>Subject</strong><span>{selectedSlot.subject}</span></div>
              <div><strong>Preview</strong><span>{selectedSlot.previewText}</span></div>
            </div>

            <div className="nomi-flow-proof-canvas" aria-live="polite">
              {previewHtml ? (
                <iframe
                  className="nomi-flow-generated-frame"
                  srcDoc={previewHtml}
                  title={`${selectedSlot.name} template preview`}
                  sandbox=""
                />
              ) : (
                <div className="nomi-templates-ai-note">
                  <strong>Using AI generation</strong>
                  <span>
                    This email is written by Nomi&apos;s AI from the Flow Editor. Switch to
                    Template above for a real, hand-built alternative you fully control.
                  </span>
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
