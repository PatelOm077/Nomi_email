import { parse, type HTMLElement } from "node-html-parser";

// Reads and writes the `data-nomi-seam` markers the three HTML-producing
// prompts in ai.server.ts (initial generation, repair, family revision) are
// instructed to emit. A seam is one hand-editable element inside an
// otherwise untouched, bespoke, Claude-authored email: leaves creativity,
// composition, and factual boundaries alone; only ever changes the exact
// text/image content one seam names.

export const TEXT_SEAM_IDS = ["eyebrow", "headline", "body", "cta-label", "footer"] as const;
export type FixedTextSeamId = (typeof TEXT_SEAM_IDS)[number];

// Repeatable seams, keyed by document order like `image:N`: every other
// piece of editable copy (`data-nomi-seam="text"`: section headings,
// callouts, steps, benefits, card copy, closing lines) and every button
// beyond the primary CTA (`data-nomi-seam="button"`, on its label text).
const REPEATABLE_TEXT_KINDS = ["text", "button"] as const;
type RepeatableTextKind = (typeof REPEATABLE_TEXT_KINDS)[number];
export type TextSeamId = FixedTextSeamId | `${RepeatableTextKind}:${number}`;

// `url` is only ever populated for button seams ("cta-label" and
// `button:N`) — the destination of the nearest enclosing <a>, read straight
// off the live HTML rather than a separate marker, so link-editing works
// even on emails generated before this field existed (see applyTextSeamEdit).
export type TextSeam = { id: TextSeamId; kind: "text"; text: string; url?: string };
export type ImageSeam = {
  id: string; // "logo" | `image:${number}` | `product:${productId}`
  kind: "logo" | "image" | "product";
  productId: string | null;
  src: string;
  alt: string;
  width: number | null;
  height: number | null;
};
export type Seam = TextSeam | ImageSeam;

function escapeAttr(value: string) {
  return value.replace(/&/g, "&amp;");
}

function parseIntOrNull(value: string | null | undefined) {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function isTextSeamId(value: string): value is TextSeamId {
  if ((TEXT_SEAM_IDS as readonly string[]).includes(value)) return true;
  return /^(text|button):\d+$/.test(value);
}

/** Seams whose edit panel also offers the destination URL. */
export function isButtonSeamId(value: string): boolean {
  return value === "cta-label" || value.startsWith("button:");
}

function locateTextSeamElement(doc: HTMLElement, seamId: TextSeamId): HTMLElement | null {
  const match = /^(text|button):(\d+)$/.exec(seamId);
  if (!match) return doc.querySelector(`[data-nomi-seam="${seamId}"]`);
  return doc.querySelectorAll(`[data-nomi-seam="${match[1]}"]`)[Number(match[2])] ?? null;
}

/** Returns every seam a stored email currently exposes, in document order. */
export function findSeams(html: string): Seam[] {
  const doc = parse(html);
  const seams: Seam[] = [];

  for (const id of TEXT_SEAM_IDS) {
    const el = doc.querySelector(`[data-nomi-seam="${id}"]`);
    if (!el) continue;
    if (id === "cta-label") {
      const anchor = el.closest("a");
      seams.push({ id, kind: "text", text: el.text.trim(), url: anchor?.getAttribute("href") || undefined });
    } else {
      seams.push({ id, kind: "text", text: el.text.trim() });
    }
  }
  for (const kind of REPEATABLE_TEXT_KINDS) {
    doc.querySelectorAll(`[data-nomi-seam="${kind}"]`).forEach((el, index) => {
      const url = kind === "button" ? el.closest("a")?.getAttribute("href") || undefined : undefined;
      seams.push({ id: `${kind}:${index}`, kind: "text", text: el.text.trim(), url });
    });
  }

  let genericImageIndex = 0;
  const seenProductIds = new Set<string>();
  for (const el of doc.querySelectorAll("img[data-nomi-seam]")) {
    const kind = el.getAttribute("data-nomi-seam");
    if (kind !== "logo" && kind !== "image" && kind !== "product") continue;
    const productId =
      kind === "product" ? el.getAttribute("data-nomi-product-id") ?? null : null;
    if (kind === "product" && !productId) continue; // malformed — no id to key on, skip rather than guess
    const id =
      kind === "logo"
        ? "logo"
        : kind === "product"
          ? `product:${productId}`
          : `image:${genericImageIndex++}`;
    if (kind === "product" && seenProductIds.has(id)) continue;
    if (kind === "product") seenProductIds.add(id);
    seams.push({
      id,
      kind,
      productId,
      src: el.getAttribute("src") ?? "",
      alt: el.getAttribute("alt") ?? "",
      width: parseIntOrNull(el.getAttribute("width")),
      height: parseIntOrNull(el.getAttribute("height")),
    });
  }
  return seams;
}

/**
 * Writes each seam's computed id onto its element(s) as `data-nomi-seam-key`,
 * so client-side code can map a clicked DOM node straight back to the seam
 * id from `findSeams` without recomputing the same indexing/dedup logic in
 * the browser. The paired <a> for a product seam gets the same key as its
 * <img>, so clicking either one selects the same seam.
 */
export function annotateSeamKeys(html: string): string {
  const doc = parse(html);

  for (const id of TEXT_SEAM_IDS) {
    doc.querySelector(`[data-nomi-seam="${id}"]`)?.setAttribute("data-nomi-seam-key", id);
  }
  for (const kind of REPEATABLE_TEXT_KINDS) {
    doc.querySelectorAll(`[data-nomi-seam="${kind}"]`).forEach((el, index) =>
      el.setAttribute("data-nomi-seam-key", `${kind}:${index}`),
    );
  }

  let genericImageIndex = 0;
  for (const el of doc.querySelectorAll("img[data-nomi-seam]")) {
    const kind = el.getAttribute("data-nomi-seam");
    if (kind !== "logo" && kind !== "image" && kind !== "product") continue;
    if (kind === "product") {
      const productId = el.getAttribute("data-nomi-product-id");
      if (!productId) continue;
      const key = `product:${productId}`;
      el.setAttribute("data-nomi-seam-key", key);
      for (const link of doc.querySelectorAll(
        `a[data-nomi-seam="product"][data-nomi-product-id="${productId}"]`,
      ))
        link.setAttribute("data-nomi-seam-key", key);
    } else if (kind === "logo") {
      el.setAttribute("data-nomi-seam-key", "logo");
    } else {
      el.setAttribute("data-nomi-seam-key", `image:${genericImageIndex++}`);
    }
  }
  return doc.toString();
}

function locateImageSeamElements(doc: HTMLElement, seamId: string): HTMLElement[] {
  if (seamId === "logo") return doc.querySelectorAll('[data-nomi-seam="logo"]');
  if (seamId.startsWith("product:")) {
    const productId = seamId.slice("product:".length);
    return doc.querySelectorAll(
      `[data-nomi-seam="product"][data-nomi-product-id="${productId}"]`,
    );
  }
  if (seamId.startsWith("image:")) {
    const index = Number.parseInt(seamId.slice("image:".length), 10);
    if (!Number.isFinite(index)) return [];
    const all = doc.querySelectorAll('img[data-nomi-seam="image"]');
    return all[index] ? [all[index]] : [];
  }
  return [];
}

/**
 * Replaces one text seam's content in place. Input is always HTML-escaped.
 * For a button seam ("cta-label" or `button:N`), an optional `href` also
 * updates the destination of the
 * nearest enclosing <a> — whether the seam marker sits on the <a> itself or
 * on an inner label span, `closest("a")` finds it either way, so this works
 * on emails generated before eyebrow/footer seams existed too.
 */
export function applyTextSeamEdit(
  html: string,
  seamId: TextSeamId,
  text: string,
  href?: string,
): string {
  const doc = parse(html);
  const el = locateTextSeamElement(doc, seamId);
  if (!el) throw new Error(`This email has no "${seamId}" seam to edit.`);
  el.textContent = text;
  if (isButtonSeamId(seamId) && href) {
    const anchor = el.closest("a");
    if (anchor) anchor.setAttribute("href", escapeAttr(href));
  }
  return doc.toString();
}

/**
 * Replaces one image/logo/product seam's photo in place. For a product seam,
 * also updates the paired <a href> (the link Claude wrapped around that same
 * product's photo), if one exists, to `href`.
 */
export function applyImageSeamEdit(
  html: string,
  seamId: string,
  update: { src: string; alt: string; width: number; height: number; href?: string },
): string {
  const doc = parse(html);
  const matches = locateImageSeamElements(doc, seamId);
  if (!matches.length)
    throw new Error(`This email has no "${seamId}" image seam to edit.`);
  for (const el of matches) {
    if (el.tagName === "IMG") {
      el.setAttribute("src", escapeAttr(update.src));
      el.setAttribute("alt", escapeAttr(update.alt));
      el.setAttribute("width", String(update.width));
      el.setAttribute("height", String(update.height));
    } else if (el.tagName === "A" && update.href) {
      el.setAttribute("href", escapeAttr(update.href));
    }
  }
  return doc.toString();
}

/**
 * A seam save is the merchant's own deliberate edit, not AI output, so it no
 * longer runs the full-generation safety/quality audit (`validateCreativeEmail`)
 * before persisting. That audit re-checked the ENTIRE document on every save,
 * not just the touched seam — an unrelated pre-existing issue anywhere else
 * in the email (e.g. a stale product image from a past generation) failed
 * the save with a generic, non-actionable error. Merchant decision (see
 * BRAND_STUDIO_REGENERATE.md's 2026-09-22 update): remove it entirely rather
 * than scope it down to the touched seam only.
 */
export function validateSeamEditedHtml(input: { html: string }): string {
  return input.html;
}

export function isKnownTextSeamId(value: string): value is TextSeamId {
  return isTextSeamId(value);
}
