import { useEffect, useId, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { useFetcher } from "react-router";

// Brand inputs shared by Brand Studio's snapshot step (app.brand-studio.tsx)
// and Brand & Settings (app.brand-settings.tsx). Layout-critical and
// native-button-reset styles are inline on purpose: fresh CSS classes on new
// picker UI have silently failed to apply inside the embedded admin iframe
// (see CAMPAIGNS.md), inline styles never have.

const INK = "#201e1d";
const MUTED = "#746f6b";
const LINE = "#bdb7b2";
const CYAN = "#0088b0";
const ERROR = "#b42318";
const UI_FONT = '"IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

const RESET_BUTTON: CSSProperties = {
  appearance: "none",
  margin: 0,
  padding: 0,
  border: 0,
  background: "transparent",
  color: "inherit",
  font: "inherit",
  cursor: "pointer",
};

/** "#abc", "abc", "#AABBCC" → "#aabbcc"; anything else → null. */
export function normalizeHex(value: string): string | null {
  const raw = value.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(raw))
    return `#${raw.split("").map((char) => char + char).join("")}`.toLowerCase();
  if (/^[0-9a-f]{6}$/i.test(raw)) return `#${raw}`.toLowerCase();
  return null;
}

type Hsv = { h: number; s: number; v: number };

export function hexToHsv(hex: string): Hsv {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  let h = 0;
  if (delta) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: max ? delta / max : 0, v: max };
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return `#${[r, g, b].map((channel) => Math.round((channel + m) * 255).toString(16).padStart(2, "0")).join("")}`;
}

const clamp = (value: number) => Math.min(1, Math.max(0, value));

function ColorPopover({
  hex,
  align,
  label,
  onChange,
  onClose,
}: {
  hex: string;
  align: "left" | "right";
  label: string;
  onChange: (hex: string) => void;
  onClose: () => void;
}) {
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(hex));
  const [draft, setDraft] = useState(hex);
  const areaRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);

  // Keep the popover in step when the hex is typed in the field behind it,
  // without snapping hue back to 0 for greys (where hue is undefined).
  useEffect(() => {
    if (hsvToHex(hsv) === hex) return;
    const next = hexToHsv(hex);
    setHsv((current) => (next.s === 0 ? { ...next, h: current.h } : next));
    setDraft(hex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hex]);

  const commit = (next: Hsv) => {
    setHsv(next);
    const nextHex = hsvToHex(next);
    setDraft(nextHex);
    onChange(nextHex);
  };

  const dragArea = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = areaRef.current?.getBoundingClientRect();
    if (!rect) return;
    commit({ h: hsv.h, s: clamp((event.clientX - rect.left) / rect.width), v: clamp(1 - (event.clientY - rect.top) / rect.height) });
  };
  const dragHue = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = hueRef.current?.getBoundingClientRect();
    if (!rect) return;
    commit({ ...hsv, h: Math.min(359.9, clamp((event.clientY - rect.top) / rect.height) * 360) });
  };
  const startDrag = (handler: (event: ReactPointerEvent<HTMLDivElement>) => void) => (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    handler(event);
  };
  const moveDrag = (handler: (event: ReactPointerEvent<HTMLDivElement>) => void) => (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) handler(event);
  };
  const nudge = (key: string, ds: number, dv: number) => {
    const step = key.startsWith("Arrow") ? 0.02 : 0;
    if (!step) return false;
    commit({ ...hsv, s: clamp(hsv.s + ds * step), v: clamp(hsv.v + dv * step) });
    return true;
  };

  const draftValid = normalizeHex(draft) !== null;
  const hueColor = hsvToHex({ h: hsv.h, s: 1, v: 1 });

  return (
    <div
      role="dialog"
      aria-label={`${label} color picker`}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
      style={{
        position: "absolute",
        top: "calc(100% + 8px)",
        [align]: 0,
        zIndex: 40,
        width: 252,
        boxSizing: "border-box",
        padding: 14,
        border: "1px solid #e3dfdb",
        borderRadius: 12,
        background: "#fff",
        boxShadow: "0 12px 32px rgba(32,30,29,.16), 0 2px 6px rgba(32,30,29,.08)",
        textTransform: "none",
        letterSpacing: 0,
        fontFamily: UI_FONT,
      }}
    >
      <div style={{ display: "flex", gap: 12 }}>
        <div
          ref={areaRef}
          role="slider"
          tabIndex={0}
          aria-label="Saturation and brightness"
          aria-valuetext={`Saturation ${Math.round(hsv.s * 100)}%, brightness ${Math.round(hsv.v * 100)}%`}
          onPointerDown={startDrag(dragArea)}
          onPointerMove={moveDrag(dragArea)}
          onKeyDown={(event) => {
            const moved =
              event.key === "ArrowLeft" ? nudge(event.key, -1, 0)
              : event.key === "ArrowRight" ? nudge(event.key, 1, 0)
              : event.key === "ArrowUp" ? nudge(event.key, 0, 1)
              : event.key === "ArrowDown" ? nudge(event.key, 0, -1)
              : false;
            if (moved) event.preventDefault();
          }}
          style={{
            position: "relative",
            flex: "1 1 auto",
            height: 150,
            borderRadius: 6,
            cursor: "crosshair",
            touchAction: "none",
            outlineOffset: 2,
            background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hueColor})`,
          }}
        >
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              left: `${hsv.s * 100}%`,
              top: `${(1 - hsv.v) * 100}%`,
              width: 14,
              height: 14,
              boxSizing: "border-box",
              border: "2px solid #fff",
              borderRadius: "50%",
              boxShadow: "0 0 0 1px rgba(0,0,0,.35)",
              transform: "translate(-50%, -50%)",
              background: hsvToHex(hsv),
              pointerEvents: "none",
            }}
          />
        </div>
        <div
          ref={hueRef}
          role="slider"
          tabIndex={0}
          aria-label="Hue"
          aria-valuemin={0}
          aria-valuemax={360}
          aria-valuenow={Math.round(hsv.h)}
          onPointerDown={startDrag(dragHue)}
          onPointerMove={moveDrag(dragHue)}
          onKeyDown={(event) => {
            if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
            event.preventDefault();
            commit({ ...hsv, h: (hsv.h + (event.key === "ArrowDown" ? 6 : -6) + 360) % 360 });
          }}
          style={{
            position: "relative",
            flex: "0 0 16px",
            height: 150,
            borderRadius: 8,
            cursor: "ns-resize",
            touchAction: "none",
            outlineOffset: 2,
            background: "linear-gradient(to bottom, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)",
          }}
        >
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              left: "50%",
              top: `${(hsv.h / 360) * 100}%`,
              width: 18,
              height: 18,
              boxSizing: "border-box",
              border: "3px solid #fff",
              borderRadius: "50%",
              boxShadow: "0 0 0 1px rgba(0,0,0,.35)",
              transform: "translate(-50%, -50%)",
              background: hueColor,
              pointerEvents: "none",
            }}
          />
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
        <span
          aria-hidden="true"
          style={{ flex: "0 0 36px", height: 36, borderRadius: 6, border: "1px solid rgba(32,30,29,.2)", background: hex }}
        />
        <input
          value={draft}
          aria-label={`${label} hex value`}
          aria-invalid={!draftValid}
          spellCheck={false}
          maxLength={7}
          onChange={(event) => {
            setDraft(event.target.value);
            const next = normalizeHex(event.target.value);
            if (next && event.target.value.replace(/^#/, "").length === 6) {
              setHsv(hexToHsv(next));
              onChange(next);
            }
          }}
          onBlur={() => {
            const next = normalizeHex(draft);
            if (next) {
              setDraft(next);
              setHsv(hexToHsv(next));
              onChange(next);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              const next = normalizeHex(draft);
              if (next) {
                onChange(next);
                onClose();
              }
            }
          }}
          style={{
            flex: "1 1 auto",
            minWidth: 0,
            height: 36,
            minHeight: 36,
            boxSizing: "border-box",
            padding: "0 10px",
            border: `1px solid ${draftValid ? "#d8d4d0" : ERROR}`,
            borderRadius: 6,
            background: "#fbfaf9",
            color: INK,
            font: `500 13px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`,
            textTransform: "none",
          }}
        />
      </div>
      {!draftValid ? (
        <p style={{ margin: "6px 0 0", color: ERROR, font: `500 11px/1.35 ${UI_FONT}` }}>Use six hex digits, like #1d1a18.</p>
      ) : null}
    </div>
  );
}

/**
 * A hex color field: a swatch that opens a picker popover, plus a typed hex
 * input that validates as you go. The typed input carries `name`, so an
 * invalid value blocks native form submission via setCustomValidity instead
 * of being silently replaced server-side.
 */
/**
 * A required typeface name (Brand Studio's display/body character, and the
 * same fields in Brand & Settings). Blank blocks the form with an inline
 * message instead of silently keeping the old font.
 */
export function FontField({
  name,
  label,
  defaultValue,
  example,
  variant = "studio",
}: {
  name: string;
  label: string;
  defaultValue: string;
  example: string;
  variant?: "studio" | "settings";
}) {
  const id = useId();
  const [value, setValue] = useState(defaultValue);
  const [touched, setTouched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const error = value.trim() ? null : `Add a ${label.toLowerCase()}, like ${example}.`;
  const showError = Boolean(error) && touched;

  useEffect(() => {
    inputRef.current?.setCustomValidity(error ?? "");
  }, [error]);

  const studio = variant === "studio";
  const labelStyle: CSSProperties = studio
    ? { display: "grid", gap: 7, color: "#5f5a57", font: `700 9px/1.2 ${UI_FONT}`, letterSpacing: ".07em", textTransform: "uppercase" }
    : { display: "grid", gap: 7, color: "var(--nomi-neutral-700, #5f5a57)", fontSize: 11, fontWeight: 600 };

  return (
    <div style={{ display: "grid", gap: 6, minWidth: 0, alignContent: "start" }}>
      <label htmlFor={id} style={labelStyle}>{label}</label>
      <input
        ref={inputRef}
        id={id}
        name={name}
        value={value}
        maxLength={100}
        autoComplete="off"
        spellCheck={false}
        placeholder={example}
        aria-invalid={showError}
        aria-describedby={showError ? `${id}-error` : undefined}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => setTouched(true)}
        onInvalid={() => setTouched(true)}
        style={{
          width: "100%",
          minHeight: 44,
          boxSizing: "border-box",
          padding: studio ? "0 12px" : "9px 11px",
          border: `1px solid ${showError ? ERROR : studio ? LINE : "var(--nomi-neutral-300, #d8d4d0)"}`,
          borderRadius: studio ? 0 : 3,
          background: showError ? "#fff7f6" : "#fff",
          color: INK,
          font: `500 13px/1 ${UI_FONT}`,
          textTransform: "none",
          boxShadow: showError ? "0 0 0 3px rgba(180,35,24,.1)" : undefined,
        }}
      />
      {showError ? (
        <p id={`${id}-error`} role="alert" style={{ margin: 0, color: ERROR, font: `500 11px/1.35 ${UI_FONT}`, textTransform: "none", letterSpacing: 0 }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function ColorField({
  name,
  label,
  defaultValue,
  variant = "studio",
  onColorChange,
}: {
  name: string;
  label: string;
  defaultValue: string;
  variant?: "studio" | "settings";
  onColorChange?: (hex: string) => void;
}) {
  const id = useId();
  const initial = normalizeHex(defaultValue) ?? "#000000";
  const [text, setText] = useState(initial);
  const [color, setColor] = useState(initial);
  const [touched, setTouched] = useState(false);
  const [open, setOpen] = useState(false);
  const [align, setAlign] = useState<"left" | "right">("left");
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const parsed = normalizeHex(text);
  const error = parsed ? null : text.trim() ? `“${text.trim()}” isn’t a color. Use six hex digits, like #1d1a18.` : `${label} needs a color.`;
  const showError = Boolean(error) && (touched || text.replace(/^#/, "").length >= 6);

  useEffect(() => {
    inputRef.current?.setCustomValidity(error ?? "");
  }, [error]);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const apply = (hex: string) => {
    setColor(hex);
    setText(hex);
    setTouched(false);
    onColorChange?.(hex);
  };

  const toggle = () => {
    const rect = wrapRef.current?.getBoundingClientRect();
    // Right-align in the right-hand part of the page so the popover stays
    // over its own card instead of hanging past the edge.
    if (rect) setAlign(rect.left + 252 > window.innerWidth - 12 || rect.left > window.innerWidth * 0.62 ? "right" : "left");
    setOpen((current) => !current);
  };

  const studio = variant === "studio";
  const labelStyle: CSSProperties = studio
    ? { color: "#5f5a57", font: `700 9px/1.2 ${UI_FONT}`, letterSpacing: ".07em", textTransform: "uppercase" }
    : { color: "var(--nomi-neutral-700, #5f5a57)", fontSize: 11, fontWeight: 600 };

  return (
    <div ref={wrapRef} style={{ position: "relative", display: "grid", gap: 7, minWidth: 0, alignContent: "start" }}>
      <label htmlFor={id} style={labelStyle}>{label}</label>
      <button
        type="button"
        aria-label={`Open ${label.toLowerCase()} color picker, current ${color}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={toggle}
        style={{
          ...RESET_BUTTON,
          display: "block",
          width: "100%",
          height: studio ? 48 : 44,
          minHeight: 44,
          boxSizing: "border-box",
          border: `1px solid ${open ? CYAN : "rgba(32,30,29,.25)"}`,
          borderRadius: studio ? 0 : 3,
          boxShadow: open ? "0 0 0 3px rgba(0,136,176,.18)" : "none",
          background: color,
        }}
      />
      <div style={{ position: "relative" }}>
        <input
          ref={inputRef}
          id={id}
          name={name}
          value={text}
          maxLength={7}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={showError}
          aria-describedby={showError ? `${id}-error` : undefined}
          onChange={(event) => {
            setText(event.target.value);
            const next = normalizeHex(event.target.value);
            if (next && event.target.value.replace(/^#/, "").length === 6) {
              setColor(next);
              onColorChange?.(next);
            }
          }}
          onBlur={() => {
            setTouched(true);
            if (parsed) apply(parsed);
          }}
          onInvalid={() => setTouched(true)}
          style={{
            width: "100%",
            minHeight: studio ? 34 : 44,
            boxSizing: "border-box",
            padding: studio ? "0 7px" : "9px 11px",
            border: `1px solid ${showError ? ERROR : studio ? LINE : "var(--nomi-neutral-300, #d8d4d0)"}`,
            borderRadius: studio ? 0 : 3,
            background: showError ? "#fff7f6" : "#fff",
            color: INK,
            font: `500 ${studio ? 11 : 13}px/1 ${UI_FONT}`,
            textTransform: "none",
            boxShadow: showError ? "0 0 0 3px rgba(180,35,24,.1)" : undefined,
          }}
        />
      </div>
      {showError ? (
        <p id={`${id}-error`} role="alert" style={{ margin: 0, color: ERROR, font: `500 11px/1.35 ${UI_FONT}`, textTransform: "none", letterSpacing: 0 }}>
          {error}
        </p>
      ) : null}
      {open ? <ColorPopover hex={color} align={align} label={label} onChange={apply} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

type MediaAsset = { id: string; name: string; url: string; alt: string; width: number | null; height: number | null };
type FilesResult = { ok: boolean; files: MediaAsset[]; error?: string };
type UploadResult = { ok: boolean; asset?: MediaAsset; processing?: boolean; fileId?: string; error?: string };
type LogoTab = "detected" | "files" | "upload";

/**
 * Logo chooser: the logo Nomi detected in the Shopify theme, anything in
 * Shopify Files, or a fresh upload from the merchant's computer (stored in
 * Shopify Files so emails get a real CDN URL). The chosen URL is posted as
 * `name`; an empty value means "no logo".
 */
export function LogoPicker({
  name,
  defaultValue,
  detectedLogoUrl,
  shopName,
  paper = "#fbfaf7",
  ink = INK,
  variant = "studio",
  allowNone = true,
  onLogoChange,
}: {
  allowNone?: boolean;
  name: string;
  defaultValue: string | null;
  detectedLogoUrl: string | null;
  shopName: string;
  paper?: string;
  ink?: string;
  variant?: "studio" | "settings";
  onLogoChange?: (url: string | null) => void;
}) {
  const [value, setValue] = useState<string | null>(defaultValue);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<LogoTab>(detectedLogoUrl ? "detected" : "files");
  const [broken, setBroken] = useState(false);
  const filesFetcher = useFetcher<FilesResult>();
  const uploadFetcher = useFetcher<UploadResult>();
  const pollAttempts = useRef(0);
  const [processing, setProcessing] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const panelId = useId();

  useEffect(() => {
    if (open && tab === "files" && filesFetcher.state === "idle" && !filesFetcher.data) filesFetcher.load("/app/brand-media");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab]);

  // fileCreate can return before Shopify's CDN has the image — poll the
  // fileId the same way the seam editor does rather than showing nothing.
  useEffect(() => {
    const result = uploadFetcher.data;
    if (!result) return;
    if (!result.ok || result.asset) {
      pollAttempts.current = 0;
      setProcessing(false);
      if (result.asset) choose(result.asset.url);
      return;
    }
    if (result.processing && result.fileId) {
      if (pollAttempts.current >= 15) {
        setProcessing(false);
        setTimedOut(true);
        return;
      }
      pollAttempts.current += 1;
      setProcessing(true);
      const fileId = result.fileId;
      const timer = window.setTimeout(
        () => uploadFetcher.submit({ intent: "media-status", id: fileId }, { method: "post", action: "/app/brand-media" }),
        1000,
      );
      return () => window.clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadFetcher.data]);

  function choose(url: string | null) {
    setValue(url);
    setBroken(false);
    onLogoChange?.(url);
    setOpen(false);
  }

  const uploading = uploadFetcher.state !== "idle" || processing;
  const studio = variant === "studio";
  const source =
    !value ? "No logo — the store name is set in type"
    : value === detectedLogoUrl ? "Detected from your Shopify theme"
    : "Chosen for email";

  const tabButton = (id: LogoTab, text: string) => (
    <button
      key={id}
      type="button"
      role="tab"
      aria-selected={tab === id}
      aria-controls={panelId}
      onClick={() => setTab(id)}
      style={{
        ...RESET_BUTTON,
        minHeight: 44,
        padding: "0 12px",
        borderBottom: `2px solid ${tab === id ? INK : "transparent"}`,
        color: tab === id ? INK : MUTED,
        font: `${tab === id ? 600 : 500} 12px/1 ${UI_FONT}`,
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </button>
  );

  const tile = (asset: { key: string; url: string; label: string }) => {
    const selected = value === asset.url;
    return (
      <button
        key={asset.key}
        type="button"
        onClick={() => choose(asset.url)}
        aria-pressed={selected}
        title={asset.label}
        style={{
          ...RESET_BUTTON,
          display: "grid",
          gridTemplateRows: "72px auto",
          gap: 6,
          minWidth: 0,
          padding: 6,
          boxSizing: "border-box",
          border: `1px solid ${selected ? CYAN : "#e3dfdb"}`,
          borderRadius: 6,
          boxShadow: selected ? "0 0 0 2px rgba(0,136,176,.22)" : "none",
          background: "#fff",
          textAlign: "left",
        }}
      >
        <span style={{ display: "grid", placeItems: "center", minHeight: 0, background: "#f5f3f0", borderRadius: 4, overflow: "hidden" }}>
          <img src={asset.url} alt="" loading="lazy" style={{ display: "block", maxWidth: "100%", maxHeight: 72, objectFit: "contain" }} />
        </span>
        <span style={{ overflow: "hidden", color: INK, font: `500 11px/1.3 ${UI_FONT}`, textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{asset.label}</span>
      </button>
    );
  };

  const hint = (text: string, tone: "muted" | "error" = "muted") => (
    <p role={tone === "error" ? "alert" : undefined} style={{ margin: 0, color: tone === "error" ? ERROR : MUTED, font: `500 12px/1.45 ${UI_FONT}`, textTransform: "none", letterSpacing: 0 }}>{text}</p>
  );

  return (
    // Explicit zeros: Brand Studio's `.nomi-make-identity-mark > div` rule
    // would otherwise frame this wrapper like the old logo tile.
    <div style={{ display: "grid", gap: 10, minWidth: 0, minHeight: 0, padding: 0, border: 0, background: "transparent", placeItems: "stretch" }}>
      <input type="hidden" name={name} value={value ?? ""} />
      <div
        style={{
          display: "grid",
          placeItems: "center",
          minHeight: studio ? 112 : 104,
          padding: 20,
          boxSizing: "border-box",
          border: "1px solid #d8d4d0",
          borderRadius: studio ? 0 : 4,
          background: paper,
        }}
      >
        {value && !broken ? (
          <img src={value} alt={`${shopName} logo`} onError={() => setBroken(true)} style={{ display: "block", maxWidth: 180, maxHeight: 64, objectFit: "contain" }} />
        ) : (
          <strong style={{ color: ink, font: "600 23px/1.2 Lora, Georgia, serif", textAlign: "center", textTransform: "none", letterSpacing: 0 }}>{shopName}</strong>
        )}
      </div>
      {value && broken ? hint("This logo URL didn’t load. Choose another logo below.", "error") : null}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <span style={{ color: MUTED, font: `500 12px/1.35 ${UI_FONT}`, textTransform: "none", letterSpacing: 0 }}>{source}</span>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((current) => !current)}
          style={{
            ...RESET_BUTTON,
            minHeight: 44,
            padding: "0 16px",
            boxSizing: "border-box",
            border: `1px solid ${INK}`,
            borderRadius: studio ? 0 : 3,
            background: open ? INK : "#fff",
            color: open ? "#fff" : INK,
            font: `600 12px/1 ${UI_FONT}`,
            textTransform: "none",
            letterSpacing: 0,
          }}
        >
          {open ? "Close" : "Change logo"}
        </button>
      </div>
      {open ? (
        <div style={{ border: "1px solid #e3dfdb", borderRadius: studio ? 0 : 6, background: "#fff", textTransform: "none", letterSpacing: 0 }}>
          <div role="tablist" aria-label="Logo source" style={{ display: "flex", gap: 2, padding: "0 6px", borderBottom: "1px solid #eeeae6", overflowX: "auto" }}>
            {tabButton("detected", "Shopify logo")}
            {tabButton("files", "Shopify files")}
            {tabButton("upload", "Upload")}
          </div>
          <div id={panelId} role="tabpanel" style={{ display: "grid", gap: 10, padding: 12 }}>
            {tab === "detected" ? (
              detectedLogoUrl ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 8 }}>
                  {tile({ key: "detected", url: detectedLogoUrl, label: "Theme logo" })}
                </div>
              ) : (
                hint("Your published Shopify theme doesn’t have a logo set. Pick one from Shopify files or upload one.")
              )
            ) : null}
            {tab === "files" ? (
              filesFetcher.state !== "idle" && !filesFetcher.data ? (
                hint("Loading Shopify files…")
              ) : filesFetcher.data && !filesFetcher.data.ok ? (
                hint(filesFetcher.data.error ?? "Shopify files could not be loaded.", "error")
              ) : filesFetcher.data?.files.length ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(104px, 1fr))", gap: 8, maxHeight: 280, overflowY: "auto", paddingRight: 2 }}>
                  {filesFetcher.data.files.map((file) => tile({ key: file.id, url: file.url, label: file.name }))}
                </div>
              ) : (
                hint("No images in Shopify files yet. Upload one from your computer instead.")
              )
            ) : null}
            {tab === "upload" ? (
              <>
                <label
                  style={{
                    position: "relative",
                    display: "grid",
                    placeItems: "center",
                    minHeight: 96,
                    padding: 16,
                    boxSizing: "border-box",
                    border: `1px dashed ${uploading ? CYAN : LINE}`,
                    borderRadius: 6,
                    background: "#fbfaf9",
                    color: INK,
                    font: `600 13px/1.4 ${UI_FONT}`,
                    textAlign: "center",
                    textTransform: "none",
                    letterSpacing: 0,
                    cursor: uploading ? "progress" : "pointer",
                  }}
                >
                  <span>
                    {uploadFetcher.state !== "idle" && !processing ? "Uploading to Shopify…" : processing ? "Shopify is preparing the image…" : "Choose a logo from your computer"}
                    <span style={{ display: "block", marginTop: 4, color: MUTED, fontWeight: 500, fontSize: 12 }}>JPG, PNG, or GIF, up to 5 MB. Saved to Shopify files.</span>
                  </span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/gif"
                    disabled={uploading}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      pollAttempts.current = 0;
                      setProcessing(false);
                      setTimedOut(false);
                      const body = new FormData();
                      body.set("intent", "upload-media");
                      body.set("target", "logo");
                      body.set("file", file);
                      uploadFetcher.submit(body, { method: "post", action: "/app/brand-media", encType: "multipart/form-data" });
                      event.currentTarget.value = "";
                    }}
                    style={{ position: "absolute", width: 1, height: 1, minHeight: 0, padding: 0, border: 0, opacity: 0, overflow: "hidden" }}
                  />
                </label>
                {timedOut ? hint("Shopify is taking longer than usual to process this image. Try again in a moment.", "error") : null}
                {uploadFetcher.data && !uploadFetcher.data.ok ? hint(uploadFetcher.data.error ?? "The logo could not be uploaded.", "error") : null}
              </>
            ) : null}
            {value && allowNone ? (
              <button
                type="button"
                onClick={() => choose(null)}
                style={{ ...RESET_BUTTON, justifySelf: "start", minHeight: 44, color: MUTED, font: `500 12px/1 ${UI_FONT}`, textDecoration: "underline", textUnderlineOffset: 3 }}
              >
                Use no logo — set the store name in type
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
