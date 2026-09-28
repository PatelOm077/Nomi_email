// Real-catalogue product and collection pickers, shared by Campaigns and
// the Flow Editor regenerate modal. They search the merchant's live Shopify
// catalogue through the /app/campaigns loader (?kind=products|collections).
import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import type {
  CampaignCatalogCollection,
  CampaignCatalogProduct,
} from "../dashboard/campaign-catalog.server";


// A fixed-size, overflow-clipped wrapper around the <img> — belt-and-braces
// sizing so a real product photo (often several thousand pixels on a side)
// can never balloon the row/trigger no matter its intrinsic dimensions.
// Inline styles on purpose, in addition to the CSS classes: they apply
// straight from the DOM node itself, so sizing can't be lost to a stylesheet
// load race or a stale cache — see nomi.css for the class-based version of
// the same rules.
export const THUMB_WRAP_STYLE: React.CSSProperties = {
  position: "relative",
  display: "block",
  width: 40,
  height: 40,
  minWidth: 40,
  maxWidth: 40,
  maxHeight: 40,
  borderRadius: 8,
  overflow: "hidden",
  flexShrink: 0,
  flexGrow: 0,
};
export const THUMB_IMG_STYLE: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  maxWidth: "100%",
  maxHeight: "100%",
  objectFit: "cover",
  display: "block",
};

export function ProductThumb({ product }: { product: Pick<CampaignCatalogProduct, "title" | "imageUrl"> }) {
  return (
    <span className="nomi-cc-picker-thumb" style={THUMB_WRAP_STYLE}>
      {product.imageUrl ? <img src={product.imageUrl} alt="" style={THUMB_IMG_STYLE} /> : null}
    </span>
  );
}

// Same belt-and-braces reasoning as the thumb: the layout-critical box
// model (size, flex, position) is inline so it can't be lost to a
// stylesheet timing or caching issue. Colors/borders/hover states stay in
// nomi.css — losing those would be a cosmetic miss, not a broken layout.
export const PICKER_WRAP_STYLE: React.CSSProperties = { position: "relative", width: "100%", maxWidth: "100%", boxSizing: "border-box" };
// Trigger colors are inlined for the same reason the row colors below are:
// .nomi-cc-picker-trigger's CSS-only background/border was observed
// rendering as flat browser-default grey live (not the intended white),
// inconsistently across reloads — see CAMPAIGNS.md. The values here are
// also a deliberate refresh, not just a bugfix: a hairline neutral border
// instead of a filled grey box, a faint resting shadow for depth, and a
// cyan focus ring that only appears on open — restrained-cyan-for-feedback
// per CLAUDE.md's brand rule, not a default framework blue.
export const TRIGGER_STYLE: React.CSSProperties = {
  width: "100%", maxWidth: "100%", height: 48, maxHeight: 48, minHeight: 0,
  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
  padding: "0 36px 0 12px", boxSizing: "border-box", overflow: "hidden",
  cursor: "pointer", textAlign: "left",
  background: "#ffffff", border: "1.5px solid #d7d3d3", borderRadius: 10,
  color: "#201e1d", font: '13.5px/1 "IBM Plex Sans", sans-serif',
  boxShadow: "0 1px 2px rgba(32, 30, 29, .05)",
  transition: "border-color .15s ease, box-shadow .15s ease",
};
export const TRIGGER_OPEN_STYLE: React.CSSProperties = {
  ...TRIGGER_STYLE,
  borderColor: "#0088b0",
  boxShadow: "0 0 0 3px rgba(0, 136, 176, .14)",
};
export const TRIGGER_VALUE_STYLE: React.CSSProperties = { display: "flex", alignItems: "center", gap: 10, minWidth: 0, maxWidth: "100%", overflow: "hidden" };
export const TRIGGER_TITLE_STYLE: React.CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, flex: 1, fontWeight: 600 };
export const PLACEHOLDER_STYLE: React.CSSProperties = { display: "flex", alignItems: "center", gap: 9, overflow: "hidden", color: "#716d6d" };
export const ARROW_STYLE: React.CSSProperties = { position: "absolute", right: 13, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "#605d5d" };
// Same reasoning again, extended to color/border: in this environment the
// .nomi-cc-picker-row class was observed silently failing to apply (rows
// fell back to the browser's native grey/bordered <button> chrome, even
// though .nomi-cc-picker-panel right next to it rendered fine) — see
// CAMPAIGNS.md. Inlining background/border/color on the row itself is the
// only combination that's rendered correctly every time it's been checked
// live.
export const PANEL_STYLE: React.CSSProperties = {
  position: "absolute", zIndex: 30, top: "calc(100% + 6px)", left: 0, right: 0,
  maxWidth: "100%", display: "flex", flexDirection: "column", overflow: "hidden",
  background: "#ffffff", border: "1px solid #d7d3d3", borderRadius: 12,
  boxShadow: "0 18px 44px rgba(32, 30, 29, .18)",
};
export const SEARCH_WRAP_STYLE: React.CSSProperties = { position: "relative", flexShrink: 0, borderBottom: "1px solid #eae7e7" };
export const SEARCH_ICON_STYLE: React.CSSProperties = { position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "#716d6d" };
export const SEARCH_INPUT_STYLE: React.CSSProperties = {
  width: "100%", maxWidth: "100%", height: 42, maxHeight: 42, boxSizing: "border-box",
  padding: "0 12px 0 34px", border: 0, outline: "none", flexShrink: 0,
  background: "transparent", color: "#201e1d",
};
export const LIST_STYLE: React.CSSProperties = { maxHeight: 248, minHeight: 56, overflowY: "auto", overflowX: "hidden", padding: 5, boxSizing: "border-box", background: "#ffffff" };
export const ROW_STYLE: React.CSSProperties = {
  width: "100%", maxWidth: "100%", display: "flex", alignItems: "center", gap: 11,
  height: 50, maxHeight: 50, minHeight: 0, padding: "4px 8px", boxSizing: "border-box",
  overflow: "hidden", textAlign: "left", cursor: "pointer",
  background: "transparent", border: 0, borderRadius: 7, color: "#201e1d",
  font: '13.5px/1.3 "IBM Plex Sans", sans-serif',
};
export const ROW_SELECTED_STYLE: React.CSSProperties = { ...ROW_STYLE, background: "#e9f8ff" };
export const ROW_DISABLED_STYLE: React.CSSProperties = { ...ROW_STYLE, opacity: 0.4, cursor: "not-allowed" };
export const ROW_TITLE_STYLE: React.CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, flex: 1 };
export const CHECKBOX_STYLE: React.CSSProperties = { width: 19, height: 19, minWidth: 19, flexShrink: 0, display: "grid", placeItems: "center", boxSizing: "border-box" };
export const CHIP_LIST_STYLE: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 2, marginTop: 10, width: "100%" };
export const CHIP_ROW_STYLE: React.CSSProperties = { display: "flex", alignItems: "center", gap: 10, padding: "8px 2px", width: "100%", boxSizing: "border-box" };
export const CHIP_INDEX_STYLE: React.CSSProperties = { width: 14, flexShrink: 0 };
export const CHIP_TITLE_STYLE: React.CSSProperties = { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
export const CHIP_REMOVE_STYLE: React.CSSProperties = { width: 26, height: 26, minWidth: 26, display: "grid", placeItems: "center", border: 0, cursor: "pointer", flexShrink: 0, boxSizing: "border-box" };
// Calm editorial pill instead of a solid cyan fill — a plain "feature a
// product" utility icon isn't the active-feedback moment cyan is reserved
// for (see CLAUDE.md brand rules), so a saturated blue chip read as loud.
export const PROMPT_TOOL_STYLE: React.CSSProperties = {
  width: 24, height: 24, display: "grid", placeItems: "center", borderRadius: 7,
  background: "#ffffff", border: "1px solid #99e0ff", color: "#006786", boxSizing: "border-box",
};
export const GENERATE_ERROR_STYLE: React.CSSProperties = {
  margin: "10px 0 0", padding: "9px 12px", borderRadius: 6,
  background: "color-mix(in srgb, #d6006c 10%, transparent)", color: "#d6006c",
  font: '600 12px/1.4 "IBM Plex Sans", sans-serif',
};

export function useOutsideClose(open: boolean, ref: React.RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open, ref, onClose]);
}

export function SingleProductPicker({ value, onChange, placeholder }: {
  value: CampaignCatalogProduct | null;
  onChange: (product: CampaignCatalogProduct) => void;
  placeholder: string;
}) {
  const fetcher = useFetcher<{ products: CampaignCatalogProduct[] }>();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<number | null>(null);
  const autoSelectedRef = useRef(false);

  useOutsideClose(open, containerRef, () => setOpen(false));

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      fetcher.load(`/app/campaigns?kind=products&q=${encodeURIComponent(query)}`);
    }, query ? 250 : 0);
    return () => { if (debounceRef.current) window.clearTimeout(debounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  useEffect(() => {
    if (autoSelectedRef.current || value) return;
    const products = fetcher.data?.products;
    if (products && products.length) {
      autoSelectedRef.current = true;
      onChange(products[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data]);

  const products = fetcher.data?.products ?? [];

  return (
    <div className="nomi-cc-picker" style={PICKER_WRAP_STYLE} ref={containerRef}>
      <button type="button" className={`nomi-cc-picker-trigger${open ? " is-open" : ""}`} style={open ? TRIGGER_OPEN_STYLE : TRIGGER_STYLE} onClick={() => setOpen((isOpen) => !isOpen)}>
        {value ? (
          <span className="nomi-cc-picker-trigger-value" style={TRIGGER_VALUE_STYLE}>
            <ProductThumb product={value} />
            <span className="nomi-cc-picker-trigger-title" style={TRIGGER_TITLE_STYLE}>{value.title}</span>
          </span>
        ) : (
          <span className="nomi-cc-picker-placeholder" style={PLACEHOLDER_STYLE}>{placeholder}</span>
        )}
        <span className="nomi-cc-select-arrow" style={ARROW_STYLE} aria-hidden="true"><svg width="11" height="11" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 7.5L10 12.5L15 7.5" /></svg></span>
      </button>
      {open ? (
        <div className="nomi-cc-picker-panel" style={PANEL_STYLE}>
          <div className="nomi-cc-picker-search-wrap" style={SEARCH_WRAP_STYLE}>
            <svg style={SEARCH_ICON_STYLE} width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" /><path d="M13 13 L17 17" strokeLinecap="round" /></svg>
            <input
              type="text"
              className="nomi-cc-picker-search"
              style={SEARCH_INPUT_STYLE}
              placeholder="Search products"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              autoFocus
            />
          </div>
          <div className="nomi-cc-picker-list" style={LIST_STYLE}>
            {fetcher.state !== "idle" && products.length === 0 ? (
              <p className="nomi-cc-picker-empty">Searching…</p>
            ) : products.length ? (
              products.map((product) => (
                <button
                  type="button"
                  key={product.id}
                  className={`nomi-cc-picker-row${value?.id === product.id ? " is-selected" : ""}`}
                  style={value?.id === product.id ? ROW_SELECTED_STYLE : ROW_STYLE}
                  onClick={() => { onChange(product); setOpen(false); setQuery(""); }}
                >
                  <ProductThumb product={product} />
                  <span className="nomi-cc-picker-row-title" style={ROW_TITLE_STYLE}>{product.title}</span>
                </button>
              ))
            ) : (
              <p className="nomi-cc-picker-empty">No products found.</p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function CollectionPicker({ value, onChange, placeholder }: {
  value: CampaignCatalogCollection | null;
  onChange: (collection: CampaignCatalogCollection) => void;
  placeholder: string;
}) {
  const fetcher = useFetcher<{ collections: CampaignCatalogCollection[] }>();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<number | null>(null);
  const autoSelectedRef = useRef(false);

  useOutsideClose(open, containerRef, () => setOpen(false));

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      fetcher.load(`/app/campaigns?kind=collections&q=${encodeURIComponent(query)}`);
    }, query ? 250 : 0);
    return () => { if (debounceRef.current) window.clearTimeout(debounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  useEffect(() => {
    if (autoSelectedRef.current || value) return;
    const collections = fetcher.data?.collections;
    if (collections && collections.length) {
      autoSelectedRef.current = true;
      onChange(collections[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data]);

  const collections = fetcher.data?.collections ?? [];

  return (
    <div className="nomi-cc-picker" style={PICKER_WRAP_STYLE} ref={containerRef}>
      <button type="button" className={`nomi-cc-picker-trigger${open ? " is-open" : ""}`} style={open ? TRIGGER_OPEN_STYLE : TRIGGER_STYLE} onClick={() => setOpen((isOpen) => !isOpen)}>
        {value ? (
          <span className="nomi-cc-picker-trigger-title" style={TRIGGER_TITLE_STYLE}>{value.title}</span>
        ) : (
          <span className="nomi-cc-picker-placeholder" style={PLACEHOLDER_STYLE}>{placeholder}</span>
        )}
        <span className="nomi-cc-select-arrow" style={ARROW_STYLE} aria-hidden="true"><svg width="11" height="11" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 7.5L10 12.5L15 7.5" /></svg></span>
      </button>
      {open ? (
        <div className="nomi-cc-picker-panel" style={PANEL_STYLE}>
          <div className="nomi-cc-picker-search-wrap" style={SEARCH_WRAP_STYLE}>
            <svg style={SEARCH_ICON_STYLE} width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" /><path d="M13 13 L17 17" strokeLinecap="round" /></svg>
            <input
              type="text"
              className="nomi-cc-picker-search"
              style={SEARCH_INPUT_STYLE}
              placeholder="Search collections"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              autoFocus
            />
          </div>
          <div className="nomi-cc-picker-list" style={LIST_STYLE}>
            {fetcher.state !== "idle" && collections.length === 0 ? (
              <p className="nomi-cc-picker-empty">Searching…</p>
            ) : collections.length ? (
              collections.map((collection) => (
                <button
                  type="button"
                  key={collection.id}
                  className={`nomi-cc-picker-row nomi-cc-picker-row-text${value?.id === collection.id ? " is-selected" : ""}`}
                  style={value?.id === collection.id ? ROW_SELECTED_STYLE : ROW_STYLE}
                  onClick={() => { onChange(collection); setOpen(false); setQuery(""); }}
                >
                  <span className="nomi-cc-picker-row-title" style={ROW_TITLE_STYLE}>{collection.title}</span>
                </button>
              ))
            ) : (
              <p className="nomi-cc-picker-empty">No collections found.</p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function MultiProductPicker({ value, onChange, max = 3 }: {
  value: CampaignCatalogProduct[];
  onChange: (products: CampaignCatalogProduct[]) => void;
  max?: number;
}) {
  const fetcher = useFetcher<{ products: CampaignCatalogProduct[] }>();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<number | null>(null);

  useOutsideClose(open, containerRef, () => setOpen(false));

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      fetcher.load(`/app/campaigns?kind=products&q=${encodeURIComponent(query)}`);
    }, query ? 250 : 0);
    return () => { if (debounceRef.current) window.clearTimeout(debounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const products = fetcher.data?.products ?? [];

  const toggle = (product: CampaignCatalogProduct) => {
    const exists = value.some((item) => item.id === product.id);
    if (exists) { onChange(value.filter((item) => item.id !== product.id)); return; }
    if (value.length >= max) return;
    onChange([...value, product]);
  };

  return (
    <div>
      <div className="nomi-cc-picker" style={PICKER_WRAP_STYLE} ref={containerRef}>
        <button type="button" className={`nomi-cc-picker-trigger${open ? " is-open" : ""}`} style={open ? TRIGGER_OPEN_STYLE : TRIGGER_STYLE} onClick={() => setOpen((isOpen) => !isOpen)}>
          <span className="nomi-cc-picker-placeholder" style={PLACEHOLDER_STYLE}>
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" /><path d="M13 13 L17 17" strokeLinecap="round" /></svg>
            Search Products
          </span>
          <span className="nomi-cc-select-arrow" style={ARROW_STYLE} aria-hidden="true"><svg width="11" height="11" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 7.5L10 12.5L15 7.5" /></svg></span>
        </button>
        {open ? (
          <div className="nomi-cc-picker-panel" style={PANEL_STYLE}>
            <div className="nomi-cc-picker-search-wrap" style={SEARCH_WRAP_STYLE}>
              <svg style={SEARCH_ICON_STYLE} width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" /><path d="M13 13 L17 17" strokeLinecap="round" /></svg>
              <input
                type="text"
                className="nomi-cc-picker-search"
                style={SEARCH_INPUT_STYLE}
                placeholder="Search products"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                autoFocus
              />
            </div>
            <div className="nomi-cc-picker-list" style={LIST_STYLE}>
              {fetcher.state !== "idle" && products.length === 0 ? (
                <p className="nomi-cc-picker-empty">Searching…</p>
              ) : products.length ? (
                products.map((product) => {
                  const checked = value.some((item) => item.id === product.id);
                  const disabled = !checked && value.length >= max;
                  return (
                    <button
                      type="button"
                      key={product.id}
                      className={`nomi-cc-picker-row nomi-cc-picker-row-check${checked ? " is-selected" : ""}${disabled ? " is-disabled" : ""}`}
                      style={disabled ? ROW_DISABLED_STYLE : checked ? ROW_SELECTED_STYLE : ROW_STYLE}
                      onClick={() => toggle(product)}
                      disabled={disabled}
                    >
                      <span className={`nomi-cc-picker-checkbox${checked ? " is-checked" : ""}`} style={CHECKBOX_STYLE} aria-hidden="true">
                        {checked ? (
                          <svg width="10" height="10" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M4 10l4 4 8-8" /></svg>
                        ) : null}
                      </span>
                      <ProductThumb product={product} />
                      <span className="nomi-cc-picker-row-title" style={ROW_TITLE_STYLE}>{product.title}</span>
                    </button>
                  );
                })
              ) : (
                <p className="nomi-cc-picker-empty">No products found.</p>
              )}
            </div>
          </div>
        ) : null}
      </div>
      {value.length ? (
        <div className="nomi-cc-chip-list" style={CHIP_LIST_STYLE}>
          {value.map((product, index) => (
            <div className="nomi-cc-chip-row" style={CHIP_ROW_STYLE} key={product.id}>
              <span className="nomi-cc-chip-index" style={CHIP_INDEX_STYLE}>{index + 1}.</span>
              <ProductThumb product={product} />
              <span className="nomi-cc-chip-title" style={CHIP_TITLE_STYLE}>{product.title}</span>
              <button
                type="button"
                className="nomi-cc-chip-remove"
                style={CHIP_REMOVE_STYLE}
                aria-label={`Remove ${product.title}`}
                onClick={() => onChange(value.filter((item) => item.id !== product.id))}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5l14 14M19 5L5 19" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
