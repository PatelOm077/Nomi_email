// The Flow Editor's "Regenerate email" dialog. Same look and inputs as
// Create Campaign (a brief, what to feature, an optional real discount), so
// a merchant can steer one lifecycle email instead of only re-rolling it.
// It shows the campaign "Generating…" animation while the email is built,
// then the finished email with Save / Discard. Only Save replaces the Flow
// Editor email (see app.brand-studio.regenerate.tsx). Nothing in the form is
// required: submitting it empty regenerates the email as designed.
import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { GeneratingProgress } from "./generating-progress";
import type {
  CampaignCatalogCollection,
  CampaignCatalogProduct,
} from "../dashboard/campaign-catalog.server";
import {
  CollectionPicker,
  MultiProductPicker,
  SingleProductPicker,
} from "./catalog-pickers";

type Feature = "current" | "product" | "collection" | "all_products";
type DiscountType = "percentage" | "fixed";

function isoDateOffset(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function randomDiscountCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 8 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}

function toIso(date: string, time: string): string {
  if (!date) return "";
  const value = new Date(`${date}T${time || "00:00"}`);
  return Number.isNaN(value.getTime()) ? "" : value.toISOString();
}

const SPARK = (
  <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.6 5.2L19 10l-5.4 1.8L12 17l-1.6-5.2L5 10l5.4-1.8Z" fill="currentColor" /></svg>
);

// Mirrors the campaign pipeline each lifecycle email now goes through,
// paced to the 1–2 minutes it takes.
const REGENERATE_ROWS = [
  "Reading your brief and products",
  "Planning the email's sections",
  "Designing the email and creating photos",
  "Checking it against your brand and products",
  "Finalizing your email",
];
const LIVE_STEP_MS = 22_000;
const POLL_MS = 2_000;
const SETTLE_MS = 900;

type RegenerateResult = {
  ok: boolean;
  recipeId: string | null;
  status: "pending" | "done" | "saved" | "discarded" | "error";
  html?: string;
  error?: string;
};

const REVIEW_FRAME_STYLE: React.CSSProperties = {
  display: "block", width: "100%", height: "min(62vh, 640px)", border: "1px solid #eae7e7",
  borderRadius: 8, background: "#ffffff", boxSizing: "border-box",
};
const ERROR_STYLE: React.CSSProperties = {
  margin: "0 0 4px", padding: "9px 12px", borderRadius: 6,
  background: "color-mix(in srgb, #d6006c 10%, transparent)", color: "#d6006c",
  font: '600 12px/1.4 "IBM Plex Sans", sans-serif',
};

export function RegenerateEmailModal({
  recipeId,
  emailLabel,
  onClose,
  onSaved,
}: {
  recipeId: string;
  emailLabel: string;
  onClose: () => void;
  onSaved: (html: string) => void;
}) {
  const fetcher = useFetcher<RegenerateResult>();
  const [stage, setStage] = useState<"configure" | "generating" | "review">("configure");
  const [step, setStep] = useState(0);
  const [draftHtml, setDraftHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timersRef = useRef<number[]>([]);
  const clearTimers = () => {
    timersRef.current.forEach((id) => window.clearTimeout(id));
    timersRef.current = [];
  };
  useEffect(() => clearTimers, []);

  const [prompt, setPrompt] = useState("");
  const [feature, setFeature] = useState<Feature>("current");
  const [product, setProduct] = useState<CampaignCatalogProduct | null>(null);
  const [collection, setCollection] = useState<CampaignCatalogCollection | null>(null);
  const [products, setProducts] = useState<CampaignCatalogProduct[]>([]);
  const [discountMethod, setDiscountMethod] = useState<"code" | "none">("none");
  const [discountCode, setDiscountCode] = useState("");
  const [discountType, setDiscountType] = useState<DiscountType>("percentage");
  const [discountValue, setDiscountValue] = useState("10");
  const [startDate, setStartDate] = useState(isoDateOffset(0));
  const [startTime, setStartTime] = useState("09:00");
  const [endDate, setEndDate] = useState(isoDateOffset(14));
  const [endTime, setEndTime] = useState("23:59");

  useEffect(() => {
    if (stage === "generating") return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [stage, onClose]);

  // Drives the whole round trip: poll while pending, reveal when done, hand
  // the saved email back to the Flow Editor.
  useEffect(() => {
    const result = fetcher.data;
    if (fetcher.state !== "idle" || !result) return;
    if (result.status === "pending") {
      const timer = window.setTimeout(() => {
        fetcher.submit({ recipeId }, { method: "post", action: "/app/brand-studio/regenerate" });
      }, POLL_MS);
      return () => window.clearTimeout(timer);
    }
    if (result.status === "done" && result.html) {
      const html = result.html;
      clearTimers();
      setStep(REGENERATE_ROWS.length - 1);
      timersRef.current.push(window.setTimeout(() => { setDraftHtml(html); setStage("review"); }, SETTLE_MS));
      return;
    }
    if (result.status === "saved" && result.html) {
      onSaved(result.html);
      return;
    }
    if (result.status === "error") {
      clearTimers();
      setError(result.error ?? "Nomi could not regenerate this email.");
      if (stage === "generating") setStage("configure");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);

  const submit = () => {
    const productIds =
      feature === "product" ? (product ? [product.id] : [])
      : feature === "all_products" ? products.map(({ id }) => id)
      : [];
    if (feature === "product" && !productIds.length) { setError("Pick a product to feature."); return; }
    if (feature === "all_products" && !productIds.length) { setError("Pick at least one product to feature."); return; }
    if (feature === "collection" && !collection) { setError("Pick a collection to feature."); return; }
    setError(null);
    setDraftHtml(null);
    clearTimers();
    setStep(0);
    setStage("generating");
    let current = 0;
    const interval = window.setInterval(() => {
      current = Math.min(current + 1, REGENERATE_ROWS.length - 2);
      setStep(current);
    }, LIVE_STEP_MS);
    timersRef.current.push(interval as unknown as number);
    fetcher.submit({
      recipeId,
      prompt: prompt.trim(),
      feature,
      productIds: productIds.join(","),
      collectionId: feature === "collection" && collection ? collection.id : "",
      discountMethod,
      ...(discountMethod === "code"
        ? {
            discountCode: discountCode.trim(),
            discountType,
            discountValue: discountValue.trim(),
            startAt: toIso(startDate, startTime),
            endAt: toIso(endDate, endTime),
          }
        : {}),
    }, { method: "post", action: "/app/brand-studio/regenerate" });
  };

  const save = () => {
    setError(null);
    fetcher.submit({ recipeId, intent: "save" }, { method: "post", action: "/app/brand-studio/regenerate" });
  };
  // An unsaved draft is simply left to expire server-side; nothing about the
  // Flow Editor email changes.
  const discard = onClose;
  const saving = stage === "review" && fetcher.state !== "idle";

  const closeButton = (onClick: () => void) => (
    <button type="button" className="nomi-cc-close" aria-label="Close" onClick={onClick}>
      <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5l14 14M19 5L5 19" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
    </button>
  );

  if (stage === "generating") {
    return (
      <div className="nomi-cc-backdrop" role="presentation">
        <div className="nomi-cc-modal" role="dialog" aria-modal="true" aria-label="Generating your email">
          <GeneratingProgress title="Generating Your Email" rows={REGENERATE_ROWS} step={step} note="This usually takes 1–2 minutes." />
        </div>
      </div>
    );
  }

  if (stage === "review" && draftHtml) {
    return (
      <div className="nomi-cc-backdrop" role="presentation">
        <div className="nomi-cc-modal" role="dialog" aria-modal="true" aria-label={`New ${emailLabel}`}>
          <div className="nomi-cc-modal-head">
            <h2>Your new {emailLabel}</h2>
            {closeButton(discard)}
          </div>
          <div className="nomi-cc-body">
            {error ? <p role="alert" style={ERROR_STYLE}>{error}</p> : null}
            <p style={{ margin: 0, fontSize: 13, color: "#605d5d" }}>
              Save it to replace this email in your flow, or discard it to keep the current one.
            </p>
            <iframe title={`New ${emailLabel} preview`} srcDoc={draftHtml} style={REVIEW_FRAME_STYLE} sandbox="" />
          </div>
          <div className="nomi-cc-modal-foot">
            <button type="button" className="nomi-cc-discard" onClick={discard} disabled={saving}>Discard</button>
            <button type="button" className="nomi-cc-generate" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save to flow"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const featureButton = (value: Feature, label: string) => (
    <button type="button" className={`nomi-cc-feature-btn${feature === value ? " is-active" : ""}`} onClick={() => setFeature(value)}>
      {label}
    </button>
  );

  return (
    <div className="nomi-cc-backdrop" role="presentation">
      <div className="nomi-cc-modal" role="dialog" aria-modal="true" aria-label="Regenerate email">
        <div className="nomi-cc-modal-head">
          <h2>Regenerate {emailLabel}</h2>
          {closeButton(onClose)}
        </div>

        <div className="nomi-cc-body">
          {error ? <p role="alert" style={ERROR_STYLE}>{error}</p> : null}
          <div>
            <span className="nomi-cc-label" style={{ color: "var(--nomi-cyan-700)", display: "inline-flex", alignItems: "center", gap: 5 }}>
              Tell Nomi AI more about this email
              <svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.6 5.2L19 10l-5.4 1.8L12 17l-1.6-5.2L5 10l5.4-1.8Z" fill="#006786" /></svg>
            </span>
            <div className="nomi-cc-prompt-wrap">
              <textarea
                className="nomi-cc-prompt"
                value={prompt}
                maxLength={600}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="e.g. mention free shipping over $50, a warmer tone, lead with our bestseller"
              />
            </div>
          </div>

          <div>
            <span className="nomi-cc-label">What should this email feature?</span>
            <div className="nomi-cc-feature-row">
              {featureButton("current", "As designed")}
              {featureButton("product", "Product")}
              {featureButton("collection", "Collection")}
              {featureButton("all_products", "Products")}
            </div>
            {feature === "collection" ? (
              <>
                <span className="nomi-cc-label" style={{ marginBottom: 6, fontWeight: 700, fontSize: 12 }}>Featured Collection</span>
                <CollectionPicker value={collection} onChange={setCollection} placeholder="Select a collection" />
              </>
            ) : feature === "product" ? (
              <>
                <span className="nomi-cc-label" style={{ marginBottom: 6, fontWeight: 700, fontSize: 12 }}>Featured Product</span>
                <SingleProductPicker value={product} onChange={setProduct} placeholder="Select a product" />
              </>
            ) : feature === "all_products" ? (
              <>
                <span className="nomi-cc-label" style={{ marginBottom: 6, fontWeight: 700, fontSize: 12 }}>Showcase these products (up to 3)</span>
                <MultiProductPicker value={products} onChange={setProducts} max={3} />
              </>
            ) : (
              <p className="nomi-cc-label" style={{ fontWeight: 400, fontSize: 12, color: "#716d6d", margin: 0 }}>
                Keeps the products this email already uses.
              </p>
            )}
          </div>

          <div className="nomi-cc-discount-box">
            <span className="nomi-cc-discount-title">Email Discount</span>
            <span className="nomi-cc-label">Method</span>
            <div className="nomi-cc-feature-row">
              <button type="button" className={`nomi-cc-feature-btn${discountMethod === "none" ? " is-active" : ""}`} onClick={() => setDiscountMethod("none")}>No Discount</button>
              <button
                type="button"
                className={`nomi-cc-feature-btn${discountMethod === "code" ? " is-active" : ""}`}
                onClick={() => { setDiscountMethod("code"); if (!discountCode) setDiscountCode(randomDiscountCode()); }}
              >
                Discount Code
              </button>
            </div>

            {discountMethod === "code" ? (
              <>
                <div className="nomi-cc-discount-row">
                  <span className="nomi-cc-fieldlabel">Discount Code</span>
                  <button type="button" className="nomi-cc-random-code" onClick={() => setDiscountCode(randomDiscountCode())}>Generate random code</button>
                </div>
                <input type="text" className="nomi-cc-input nomi-cc-code-input" value={discountCode} onChange={(event) => setDiscountCode(event.target.value)} />
                <p style={{ margin: "-4px 0 12px", fontSize: 12, color: "#716d6d" }}>
                  Create this code in Shopify Discounts too. This email sends to every customer in the flow until the end date.
                </p>

                <span className="nomi-cc-label" style={{ fontWeight: 700, fontSize: 12 }}>Discount Value</span>
                <div className="nomi-cc-value-row">
                  <select className="nomi-cc-select nomi-cc-value-select" value={discountType} onChange={(event) => setDiscountType(event.target.value as DiscountType)}>
                    <option value="percentage">Percentage</option>
                    <option value="fixed">Fixed amount</option>
                  </select>
                  <div className="nomi-cc-value-field">
                    <input type="number" className="nomi-cc-input nomi-cc-value-input" style={{ marginBottom: 0 }} value={discountValue} onChange={(event) => setDiscountValue(event.target.value)} />
                    <span className="nomi-cc-value-suffix">{discountType === "percentage" ? "%" : ""}</span>
                  </div>
                </div>

                <span className="nomi-cc-label" style={{ fontWeight: 700, fontSize: 12 }}>Discount Active Dates</span>
                <div className="nomi-cc-dates">
                  <div><small>Start date</small><input type="date" className="nomi-cc-date-input" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></div>
                  <div><small>Start time</small><input type="time" className="nomi-cc-date-input" value={startTime} onChange={(event) => setStartTime(event.target.value)} /></div>
                  <div><small>End date</small><input type="date" className="nomi-cc-date-input" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></div>
                  <div><small>End time</small><input type="time" className="nomi-cc-date-input" value={endTime} onChange={(event) => setEndTime(event.target.value)} /></div>
                </div>
              </>
            ) : null}
          </div>
        </div>

        <div className="nomi-cc-modal-foot">
          <button type="button" className="nomi-cc-discard" onClick={onClose}>Discard</button>
          <button type="button" className="nomi-cc-generate" onClick={submit}>
            {SPARK}
            Regenerate
          </button>
        </div>
      </div>
    </div>
  );
}
