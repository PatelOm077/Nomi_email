import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { ActionFunctionArgs, LinksFunction, LoaderFunctionArgs } from "react-router";
import { Link, useFetcher, useLoaderData } from "react-router";
import v8EditorStyles from "../styles/v8-email-editor.css?url";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { rewriteCopy, type RewriteStyle } from "../email-engine/rewrite-copy";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: v8EditorStyles }];

// ─── TYPES ───────────────────────────────────────────────────────────────────
// This mirrors the approved Figma Make prototype ("Nomi Safe Block Editor
// Prototype", Version 8): a flat, ordered list of free-form blocks instead
// of a fixed set of sections. Any block (except the locked header/footer)
// can be added, duplicated, reordered, hidden, or deleted.

type FlowId = "welcome" | "interest" | "cart" | "review";
type LookId = "gauge" | "denizen";
type RailTab = "elements" | "style";
type PreviewWidth = "mobile" | "desktop";
type SaveState = "saved" | "unsaved" | "saving" | "save-failed";

const BLOCK_TYPES = [
  "header", "text", "image", "button", "divider", "spacer", "product", "product-row",
  "social-links", "footer", "navbar", "discount-code", "countdown", "shape-divider",
] as const;
type BlockType = (typeof BLOCK_TYPES)[number];

type MediaSource = "shopify" | "products" | "upload";
type LogoSource = "brand" | "shopify" | "upload";
type LogoVariant = "primary" | "light" | "dark";
type Alignment = "left" | "center" | "right";

interface ProductItem { name: string; price: string; sku: string; src: string; url: string }

interface BlockData {
  eyebrow?: string; headline?: string; body?: string; linkText?: string; linkUrl?: string;
  alignment?: Alignment;
  src?: string; alt?: string; fit?: "contain" | "cover"; imageSource?: MediaSource;
  label?: string; url?: string;
  productId?: string; productName?: string; productPrice?: string; productSku?: string; productImageSrc?: string;
  products?: ProductItem[]; networks?: string[]; height?: number;
  logoSrc?: string; logoAlt?: string; logoLink?: string; logoSource?: LogoSource; logoVariant?: LogoVariant;
  logoAlignment?: Alignment; logoWidthMode?: "fixed" | "full";
  logoWidth?: number; logoPaddingV?: number; logoPaddingH?: number;
  discountTreatment?: "outline" | "filled";
  discountBg?: string; discountBorder?: string; discountTextColor?: string;
  discountRadius?: number; discountPadV?: number; discountPadH?: number;
}

interface Block { id: string; type: BlockType; locked?: boolean; hidden?: boolean; data: BlockData }

interface EmailStyle {
  emailBg: string; contentBg: string; textColor: string; linkColor: string; buttonColor: string;
  headingFont: string; bodyFont: string; baseFontSize: number;
  buttonRadius: number; buttonVariant: "fill" | "outline"; buttonPaddingH: number; buttonPaddingV: number;
  contentWidth: number; blockSpacing: number;
}

type EditorDraft = { blocks: Block[]; style: EmailStyle; applySeries: boolean };
type SaveRequest = EditorDraft & { kind: "save-template" };
type UndoSnapshot = { blocks: Block[]; selectedBlockId: string | null; style: EmailStyle };

type AssetTarget = "hero" | "logo";
type MediaAsset = { id: string; name: string; url: string; alt: string; width: number | null; height: number | null; source: MediaSource };
type CatalogProduct = { id: string; name: string; price: string | null; url: string | null; imageSrc: string | null; imageAlt: string };

// ─── CATALOG (flows, emails, default copy) ──────────────────────────────────

const EMAIL_NAMES: Record<LookId, Record<FlowId, readonly string[]>> = {
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

const FLOW_LABELS: Record<FlowId, string> = {
  welcome: "Welcome",
  interest: "Still interested?",
  cart: "Abandoned cart",
  review: "How was it?",
};

const LOOK_LABELS: Record<LookId, string> = { gauge: "Gauge", denizen: "Denizen" };
const BRAND_NAME: Record<LookId, string> = { gauge: "GAUGE", denizen: "DENIZEN" };

const DEFAULT_HEADLINES: Record<FlowId, readonly string[]> = {
  welcome: ["The routine is still three steps.", "Each product has one place.", "Start with the step that went missing."],
  interest: ["Still deciding? Start with the ritual.", "A routine designed to fit."],
  cart: ["Your selected step is still here.", "The context behind your selection.", "Return when you are ready."],
  review: ["Your order is confirmed.", "How did the routine feel?"],
};

const DEFAULT_BODY = "A simple start, in the right order. Learn the three steps that make the routine feel easy to keep.";
const ROUTINE_STEPS = [
  { eyebrow: "01 CLEANSE", headline: "Morning + night", body: "A gentle reset before the next layer." },
  { eyebrow: "02 TREAT", headline: "Targeted care", body: "One active at a time, applied with patience." },
  { eyebrow: "03 SEAL", headline: "Keep the barrier calm", body: "Lock moisture in before the day starts." },
];

const HERO_ASSETS: Record<LookId, { id: string; src: string; name: string; alt: string; source: MediaSource }[]> = {
  gauge: [
    { id: "gauge-portrait-calm", src: "/template-looks/gauge-portrait-calm.jpg", name: "Gauge / calm portrait", alt: "Person applying Gauge skincare with a calm expression", source: "shopify" },
    { id: "gauge-portrait-freckle", src: "/template-looks/gauge-portrait-freckle.jpg", name: "Gauge / freckle portrait", alt: "Close-up portrait showing skin texture", source: "products" },
    { id: "gauge-portrait-shadow", src: "/template-looks/gauge-portrait-shadow.jpg", name: "Gauge / shadow portrait", alt: "Portrait with soft directional shadow", source: "upload" },
  ],
  denizen: [
    { id: "denizen-city", src: "/template-looks/denizen-city-walk.jpg", name: "City walk", alt: "Person walking through a city wearing Denizen shoes", source: "shopify" },
    { id: "denizen-vector", src: "/template-looks/denizen-vector-01.png", name: "Vector 01", alt: "Denizen shoe on a neutral background", source: "products" },
    { id: "denizen-material", src: "/template-looks/denizen-material-macro.png", name: "Material macro", alt: "Close-up view of Denizen shoe material", source: "upload" },
  ],
};

const CONTENT_ELEMENTS: { type: BlockType; label: string }[] = [
  { type: "text", label: "Text" },
  { type: "image", label: "Image" },
  { type: "button", label: "Button" },
  { type: "divider", label: "Divider" },
  { type: "spacer", label: "Spacer" },
  { type: "navbar", label: "Navbar" },
  { type: "social-links", label: "Social" },
  { type: "countdown", label: "Countdown" },
  { type: "discount-code", label: "Discount code" },
  { type: "shape-divider", label: "Shape divider" },
];

const COMMERCE_ELEMENTS: { type: BlockType; label: string }[] = [
  { type: "product", label: "Product" },
  { type: "product-row", label: "Product row" },
];

const DEFAULT_STYLE: EmailStyle = {
  emailBg: "#f3f2f2", contentBg: "#ffffff", textColor: "#716d6d", linkColor: "#0088b0", buttonColor: "#201e1d",
  headingFont: "Lora", bodyFont: "IBM Plex Sans", baseFontSize: 14,
  buttonRadius: 3, buttonVariant: "fill", buttonPaddingH: 24, buttonPaddingV: 12,
  contentWidth: 600, blockSpacing: 8,
};

const BRAND_STYLE: Record<LookId, EmailStyle> = {
  gauge: { ...DEFAULT_STYLE, textColor: "#4a4542", buttonRadius: 2, buttonPaddingH: 28, buttonPaddingV: 13 },
  denizen: { ...DEFAULT_STYLE, textColor: "#3b3936", buttonRadius: 0, buttonColor: "#1c2a22", buttonPaddingH: 30, buttonPaddingV: 14 },
};

function uid() { return Math.random().toString(36).slice(2, 9); }

function headerBlock(): Block {
  return { id: uid(), type: "header", locked: true, data: { headline: "", logoAlignment: "left", logoWidthMode: "fixed", logoWidth: 120, logoPaddingV: 18, logoPaddingH: 22, logoVariant: "primary", logoSource: "brand" } };
}
function footerBlock(look: LookId): Block {
  return { id: uid(), type: "footer", locked: true, data: { body: `${BRAND_NAME[look]} · 123 Placeholder Street, City, Country\nYou received this because you opted in · Unsubscribe` } };
}

function makeDefaultBlock(type: BlockType, look: LookId): Block {
  const id = uid();
  switch (type) {
    case "text": return { id, type, data: { eyebrow: "NEW", headline: "Add your headline here.", body: "Write your message to customers. Keep it focused and warm.", alignment: "left" } };
    case "image": return { id, type, data: { src: HERO_ASSETS[look][0].src, alt: HERO_ASSETS[look][0].alt, fit: "contain", alignment: "center", imageSource: "shopify" } };
    case "button": return { id, type, data: { label: "Shop now", url: "", alignment: "center" } };
    case "divider": return { id, type, data: {} };
    case "spacer": return { id, type, data: { height: 24 } };
    case "product": return { id, type, data: { productName: "", productPrice: "", productSku: "", productImageSrc: "", url: "" } };
    case "product-row": return { id, type, data: { products: [] } };
    case "social-links": return { id, type, data: { networks: ["instagram", "tiktok", "pinterest"] } };
    case "navbar": return { id, type, data: { headline: "Shop · Routine · About" } };
    case "discount-code": return { id, type, data: { eyebrow: "EXCLUSIVE OFFER", headline: "WELCOME15", body: "15% off your first order — automatically applied at checkout.", discountTreatment: "outline", alignment: "center", discountBg: "#f8f9f8", discountBorder: "#d7d3d3", discountTextColor: "#201e1d", discountRadius: 4, discountPadV: 20, discountPadH: 24 } };
    case "countdown": return { id, type, data: { eyebrow: "OFFER ENDS IN", headline: "48:00:00", body: "Limited-time offer." } };
    case "shape-divider": return { id, type, data: { height: 24 } };
    default: return { id, type, data: {} };
  }
}

function buildDefaultBlocks(flow: FlowId, emailIndex: number, look: LookId, heroOverride?: { src: string; alt: string; source: MediaSource }): Block[] {
  const hero = heroOverride ?? HERO_ASSETS[look][0];
  const discount = makeDefaultBlock("discount-code", look);
  return [
    headerBlock(),
    { id: uid(), type: "image", data: { src: hero.src, alt: hero.alt, fit: "contain", alignment: "center", imageSource: hero.source } },
    { id: uid(), type: "text", data: { eyebrow: `${FLOW_LABELS[flow].toUpperCase()} / 0${emailIndex + 1}`, headline: DEFAULT_HEADLINES[flow][emailIndex] ?? DEFAULT_HEADLINES.welcome[0], body: DEFAULT_BODY, alignment: "left" } },
    discount,
    ...ROUTINE_STEPS.map((step) => ({ id: uid(), type: "text" as const, data: { ...step, alignment: "left" as const } })),
    { id: uid(), type: "button", data: { label: "START THE ROUTINE", url: "", alignment: "center" } },
    footerBlock(look),
  ];
}

// ─── VALIDATION (server) ────────────────────────────────────────────────────

function isBlockType(value: unknown): value is BlockType {
  return typeof value === "string" && (BLOCK_TYPES as readonly string[]).includes(value);
}
function str(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.slice(0, max);
}
function num(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}
function hex(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}
function url(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  return value.startsWith("https://") || value.startsWith("/") || value.startsWith("data:") ? value.slice(0, 600) : undefined;
}
function align(value: unknown): Alignment | undefined {
  return value === "left" || value === "center" || value === "right" ? value : undefined;
}

function sanitizeBlockData(type: BlockType, raw: unknown): BlockData {
  const d = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const data: BlockData = {};
  if (str(d.eyebrow, 120) !== undefined) data.eyebrow = str(d.eyebrow, 120);
  if (str(d.headline, 300) !== undefined) data.headline = str(d.headline, 300);
  if (str(d.body, 2000) !== undefined) data.body = str(d.body, 2000);
  if (str(d.linkText, 120) !== undefined) data.linkText = str(d.linkText, 120);
  if (url(d.linkUrl)) data.linkUrl = url(d.linkUrl);
  if (align(d.alignment)) data.alignment = align(d.alignment);
  if (url(d.src)) data.src = url(d.src);
  if (str(d.alt, 300) !== undefined) data.alt = str(d.alt, 300);
  if (d.fit === "contain" || d.fit === "cover") data.fit = d.fit;
  if (d.imageSource === "shopify" || d.imageSource === "products" || d.imageSource === "upload") data.imageSource = d.imageSource;
  if (str(d.label, 80) !== undefined) data.label = str(d.label, 80);
  if (url(d.url)) data.url = url(d.url);
  if (str(d.productId, 200) !== undefined) data.productId = str(d.productId, 200);
  if (str(d.productName, 200) !== undefined) data.productName = str(d.productName, 200);
  if (str(d.productPrice, 40) !== undefined) data.productPrice = str(d.productPrice, 40);
  if (str(d.productSku, 80) !== undefined) data.productSku = str(d.productSku, 80);
  if (url(d.productImageSrc)) data.productImageSrc = url(d.productImageSrc);
  if (Array.isArray(d.products)) data.products = d.products.slice(0, 3).map((p) => {
    const item = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
    return { name: str(item.name, 200) ?? "", price: str(item.price, 40) ?? "", sku: str(item.sku, 80) ?? "", src: url(item.src) ?? "", url: url(item.url) ?? "" };
  });
  if (Array.isArray(d.networks)) data.networks = d.networks.filter((n): n is string => typeof n === "string").slice(0, 6);
  if (typeof d.height === "number") data.height = num(d.height, 4, 120, 24);
  if (url(d.logoSrc)) data.logoSrc = url(d.logoSrc);
  if (str(d.logoAlt, 200) !== undefined) data.logoAlt = str(d.logoAlt, 200);
  if (url(d.logoLink)) data.logoLink = url(d.logoLink);
  if (d.logoSource === "brand" || d.logoSource === "shopify" || d.logoSource === "upload") data.logoSource = d.logoSource;
  if (d.logoVariant === "primary" || d.logoVariant === "light" || d.logoVariant === "dark") data.logoVariant = d.logoVariant;
  if (align(d.logoAlignment)) data.logoAlignment = align(d.logoAlignment);
  if (d.logoWidthMode === "fixed" || d.logoWidthMode === "full") data.logoWidthMode = d.logoWidthMode;
  if (typeof d.logoWidth === "number") data.logoWidth = num(d.logoWidth, 40, 240, 120);
  if (typeof d.logoPaddingV === "number") data.logoPaddingV = num(d.logoPaddingV, 0, 60, 18);
  if (typeof d.logoPaddingH === "number") data.logoPaddingH = num(d.logoPaddingH, 0, 60, 22);
  if (d.discountTreatment === "outline" || d.discountTreatment === "filled") data.discountTreatment = d.discountTreatment;
  if (typeof d.discountBg === "string") data.discountBg = hex(d.discountBg, "#f8f9f8");
  if (typeof d.discountBorder === "string") data.discountBorder = hex(d.discountBorder, "#d7d3d3");
  if (typeof d.discountTextColor === "string") data.discountTextColor = hex(d.discountTextColor, "#201e1d");
  if (typeof d.discountRadius === "number") data.discountRadius = num(d.discountRadius, 0, 24, 4);
  if (typeof d.discountPadV === "number") data.discountPadV = num(d.discountPadV, 0, 60, 20);
  if (typeof d.discountPadH === "number") data.discountPadH = num(d.discountPadH, 0, 60, 24);
  return data;
}

function sanitizeBlocks(raw: unknown, look: LookId): Block[] | null {
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > 60) return null;
  const first = raw[0] as { type?: unknown; locked?: unknown } | undefined;
  const last = raw[raw.length - 1] as { type?: unknown; locked?: unknown } | undefined;
  if (first?.type !== "header" || last?.type !== "footer") return null;
  const blocks: Block[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < raw.length; i += 1) {
    const item = raw[i] as { id?: unknown; type?: unknown; locked?: unknown; hidden?: unknown; data?: unknown } | undefined;
    if (!item || !isBlockType(item.type)) return null;
    const isEdge = i === 0 || i === raw.length - 1;
    if ((item.type === "header" || item.type === "footer") && !isEdge) return null;
    if (isEdge && item.type !== (i === 0 ? "header" : "footer")) return null;
    const id = typeof item.id === "string" && item.id ? item.id.slice(0, 64) : uid();
    if (seen.has(id)) return null;
    seen.add(id);
    blocks.push({ id, type: item.type, locked: isEdge ? true : undefined, hidden: item.hidden === true && !isEdge ? true : undefined, data: sanitizeBlockData(item.type, item.data) });
  }
  return blocks;
}

function sanitizeStyle(raw: unknown): EmailStyle {
  const d = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    emailBg: hex(d.emailBg, DEFAULT_STYLE.emailBg),
    contentBg: hex(d.contentBg, DEFAULT_STYLE.contentBg),
    textColor: hex(d.textColor, DEFAULT_STYLE.textColor),
    linkColor: hex(d.linkColor, DEFAULT_STYLE.linkColor),
    buttonColor: hex(d.buttonColor, DEFAULT_STYLE.buttonColor),
    headingFont: str(d.headingFont, 40) || DEFAULT_STYLE.headingFont,
    bodyFont: str(d.bodyFont, 40) || DEFAULT_STYLE.bodyFont,
    baseFontSize: num(d.baseFontSize, 11, 18, DEFAULT_STYLE.baseFontSize),
    buttonRadius: num(d.buttonRadius, 0, 24, DEFAULT_STYLE.buttonRadius),
    buttonVariant: d.buttonVariant === "outline" ? "outline" : "fill",
    buttonPaddingH: num(d.buttonPaddingH, 8, 48, DEFAULT_STYLE.buttonPaddingH),
    buttonPaddingV: num(d.buttonPaddingV, 6, 24, DEFAULT_STYLE.buttonPaddingV),
    contentWidth: num(d.contentWidth, 320, 700, DEFAULT_STYLE.contentWidth),
    blockSpacing: num(d.blockSpacing, 0, 32, DEFAULT_STYLE.blockSpacing),
  };
}

function isUploadFile(value: FormDataEntryValue | null): value is File {
  return Boolean(value && typeof value === "object" && "name" in value && "type" in value && "size" in value
    && typeof (value as File).name === "string" && typeof (value as File).type === "string"
    && typeof (value as File).size === "number" && typeof (value as Blob).arrayBuffer === "function");
}

// ─── SERVER ──────────────────────────────────────────────────────────────────

const SHOPIFY_MEDIA_QUERY = `#graphql
  query NomiTemplateMedia {
    files(first: 24, query: "media_type:IMAGE") {
      nodes { ... on MediaImage { id alt image { url altText width height } } }
    }
    products(first: 24) {
      nodes {
        id
        title
        onlineStoreUrl
        priceRangeV2 { minVariantPrice { amount currencyCode } }
        featuredMedia { ... on MediaImage { id image { url altText width height } } }
      }
    }
  }
`;

function parseFlow(value: string | null): FlowId {
  return value === "interest" || value === "cart" || value === "review" ? value : "welcome";
}
function parseLook(value: string | null): LookId {
  return value === "denizen" ? "denizen" : "gauge";
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const params = new URL(request.url).searchParams;
  const look = parseLook(params.get("look"));
  const flow = parseFlow(params.get("flow"));
  const maximum = EMAIL_NAMES[look][flow].length - 1;
  const requestedEmail = Number.parseInt(params.get("email") ?? "0", 10);
  const emailIndex = Number.isFinite(requestedEmail) ? Math.max(0, Math.min(maximum, requestedEmail)) : 0;

  let shopifyFiles: MediaAsset[] = [];
  let productMedia: MediaAsset[] = [];
  let catalogProducts: CatalogProduct[] = [];
  let mediaError: string | undefined;
  try {
    const response = await admin.graphql(SHOPIFY_MEDIA_QUERY);
    const result = (await response.json()) as {
      data?: {
        files?: { nodes?: Array<{ id: string; alt?: string | null; image?: { url: string; altText?: string | null; width?: number | null; height?: number | null } | null }> };
        products?: { nodes?: Array<{ id: string; title: string; onlineStoreUrl?: string | null; priceRangeV2?: { minVariantPrice?: { amount: string; currencyCode: string } } | null; featuredMedia?: { id: string; image?: { url: string; altText?: string | null; width?: number | null; height?: number | null } | null } | null }> };
      };
      errors?: Array<{ message?: string }>;
    };
    mediaError = result.errors?.[0]?.message;
    shopifyFiles = (result.data?.files?.nodes ?? []).flatMap((file) => (file.image ? [{ id: file.id, name: file.alt || "Shopify image", url: file.image.url, alt: file.image.altText || file.alt || "", width: file.image.width ?? null, height: file.image.height ?? null, source: "shopify" as const }] : []));
    const products = result.data?.products?.nodes ?? [];
    productMedia = products.flatMap((product) => (product.featuredMedia?.image ? [{ id: product.featuredMedia.id, name: product.title, url: product.featuredMedia.image.url, alt: product.featuredMedia.image.altText || product.title, width: product.featuredMedia.image.width ?? null, height: product.featuredMedia.image.height ?? null, source: "products" as const }] : []));
    catalogProducts = products.map((product) => ({
      id: product.id,
      name: product.title,
      price: product.priceRangeV2?.minVariantPrice ? `${product.priceRangeV2.minVariantPrice.currencyCode} ${product.priceRangeV2.minVariantPrice.amount}` : null,
      url: product.onlineStoreUrl ?? null,
      imageSrc: product.featuredMedia?.image?.url ?? null,
      imageAlt: product.featuredMedia?.image?.altText || product.title,
    }));
  } catch (error) {
    mediaError = error instanceof Error ? error.message : "Shopify media is temporarily unavailable.";
  }

  // Prefer a real product photo from the store's own catalog over the local
  // placeholder so a fresh draft never shows imagery the merchant didn't
  // actually offer (see CLAUDE.md on not inventing content).
  const preferredHero = productMedia[0] ?? shopifyFiles[0];
  const heroOverride = preferredHero ? { src: preferredHero.url, alt: preferredHero.alt, source: preferredHero.source } : undefined;

  const records = await db.templateCustomization.findMany({ where: { shop: session.shop, lookId: look, flowId: flow }, orderBy: { emailIndex: "asc" } });
  const drafts: EditorDraft[] = EMAIL_NAMES[look][flow].map((_, index) => {
    const record = records.find((r) => r.emailIndex === index);
    if (!record) return { blocks: buildDefaultBlocks(flow, index, look, heroOverride), style: BRAND_STYLE[look], applySeries: false };
    let parsedBlocks: unknown;
    let parsedStyle: unknown;
    try { parsedBlocks = JSON.parse(record.blocks); parsedStyle = JSON.parse(record.style); } catch { parsedBlocks = null; parsedStyle = null; }
    const blocks = sanitizeBlocks(parsedBlocks, look) ?? buildDefaultBlocks(flow, index, look, heroOverride);
    return { blocks, style: sanitizeStyle(parsedStyle), applySeries: record.applySeries };
  });

  return { look, flow, emailIndex, drafts, shopifyFiles, productMedia, catalogProducts, mediaError };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const params = new URL(request.url).searchParams;
  const look = parseLook(params.get("look"));
  const flow = parseFlow(params.get("flow"));
  const maximum = EMAIL_NAMES[look][flow].length - 1;
  const emailIndex = Number.parseInt(params.get("email") ?? "0", 10);
  if (!Number.isInteger(emailIndex) || emailIndex < 0 || emailIndex > maximum) return { ok: false as const, error: "Choose a valid email before saving." };

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "rewrite-copy") {
    const headline = formData.get("headline");
    const body = formData.get("body");
    const style = formData.get("style");
    if (typeof headline !== "string" || typeof body !== "string" || (style !== "shorter" && style !== "warmer" && style !== "direct")) {
      return { ok: false as const, error: "Nothing to rewrite." };
    }
    try {
      const rewritten = await rewriteCopy(headline.slice(0, 300), body.slice(0, 2000), style as RewriteStyle);
      return { ok: true as const, rewrite: rewritten };
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : "Nomi could not rewrite this text right now." };
    }
  }

  if (intent === "media-status") {
    const id = formData.get("id");
    if (typeof id !== "string" || !id.startsWith("gid://")) return { ok: false as const, error: "That upload could not be checked." };
    try {
      const response = await admin.graphql(`#graphql
        query NomiUploadedImage($id: ID!) {
          node(id: $id) { ... on MediaImage { id alt fileStatus image { url altText width height } } }
        }`, { variables: { id } });
      const result = (await response.json()) as { data?: { node?: { id: string; alt?: string | null; fileStatus?: string | null; image?: { url: string; altText?: string | null; width?: number | null; height?: number | null } | null } | null } };
      const image = result.data?.node;
      if (!image) return { ok: false as const, error: "Shopify could not find that uploaded image." };
      if (image.fileStatus === "FAILED") return { ok: false as const, error: "Shopify could not process that image. Try a different JPG, PNG, or GIF." };
      if (!image.image?.url) return { ok: true as const, processing: true as const, fileId: image.id };
      return { ok: true as const, asset: { id: image.id, name: image.alt || "Uploaded image", url: image.image.url, alt: image.image.altText || image.alt || "Uploaded image", width: image.image.width ?? null, height: image.image.height ?? null, source: "upload" as const } };
    } catch {
      return { ok: false as const, error: "Shopify could not check the upload status. Please try again." };
    }
  }

  if (intent === "upload-media") {
    const file = formData.get("file");
    const target = formData.get("target") === "logo" ? "logo" : "hero";
    const permittedTypes = new Set(["image/jpeg", "image/png", "image/gif"]);
    const maximumBytes = target === "logo" ? 5 * 1024 * 1024 : 20 * 1024 * 1024;
    if (!isUploadFile(file)) return { ok: false as const, error: "Choose a JPG, PNG, or GIF image to upload." };
    if (!permittedTypes.has(file.type)) return { ok: false as const, error: "This file type is not supported. Choose a JPG, PNG, or GIF image." };
    if (file.size > maximumBytes) return { ok: false as const, error: `This ${target === "logo" ? "logo" : "image"} is bigger than the ${target === "logo" ? "5" : "20"} MB limit, so it was not uploaded.` };
    try {
      const stagedResponse = await admin.graphql(`#graphql
        mutation StageNomiImage($input: [StagedUploadInput!]!) {
          stagedUploadsCreate(input: $input) { stagedTargets { url resourceUrl parameters { name value } } userErrors { message } }
        }`, { variables: { input: [{ filename: file.name, mimeType: file.type, resource: "FILE", httpMethod: "POST", fileSize: String(file.size) }] } });
      const staged = (await stagedResponse.json()) as { data?: { stagedUploadsCreate?: { stagedTargets?: Array<{ url: string; resourceUrl: string; parameters: Array<{ name: string; value: string }> }>; userErrors?: Array<{ message: string }> } } };
      const stagedTarget = staged.data?.stagedUploadsCreate?.stagedTargets?.[0];
      const stageError = staged.data?.stagedUploadsCreate?.userErrors?.[0]?.message;
      if (!stagedTarget) return { ok: false as const, error: stageError || "Shopify could not prepare that upload." };
      const uploadBody = new FormData();
      stagedTarget.parameters.forEach((parameter) => uploadBody.append(parameter.name, parameter.value));
      uploadBody.append("file", file, file.name);
      const uploaded = await fetch(stagedTarget.url, { method: "POST", body: uploadBody });
      if (!uploaded.ok) return { ok: false as const, error: "The file could not be sent to Shopify. Please try again." };
      const createdResponse = await admin.graphql(`#graphql
        mutation CreateNomiImage($files: [FileCreateInput!]!) {
          fileCreate(files: $files) { files { ... on MediaImage { id alt fileStatus image { url altText width height } } } userErrors { message } }
        }`, { variables: { files: [{ contentType: "IMAGE", originalSource: stagedTarget.resourceUrl, alt: file.name.replace(/\.[^.]+$/, "") }] } });
      const created = (await createdResponse.json()) as { data?: { fileCreate?: { files?: Array<{ id: string; alt?: string | null; fileStatus?: string | null; image?: { url: string; altText?: string | null; width?: number | null; height?: number | null } | null }>; userErrors?: Array<{ message: string }> } } };
      const image = created.data?.fileCreate?.files?.[0];
      const createError = created.data?.fileCreate?.userErrors?.[0]?.message;
      if (!image) return { ok: false as const, error: createError || "Shopify could not create that image file." };
      if (image.fileStatus === "FAILED") return { ok: false as const, error: "Shopify could not process that image. Try a different JPG, PNG, or GIF." };
      if (!image.image?.url) return { ok: true as const, processing: true as const, fileId: image.id };
      return { ok: true as const, asset: { id: image.id, name: file.name, url: image.image.url, alt: image.image.altText || image.alt || file.name, width: image.image.width ?? null, height: image.image.height ?? null, source: "upload" as const } };
    } catch {
      return { ok: false as const, error: "The image could not be uploaded to Shopify. Please try again." };
    }
  }

  const rawPayload = formData.get("payload");
  if (typeof rawPayload !== "string" || rawPayload.length > 60_000) return { ok: false as const, error: "The template update was not valid." };
  let payload: SaveRequest;
  try { payload = JSON.parse(rawPayload) as SaveRequest; } catch { return { ok: false as const, error: "The template update was not valid." }; }
  if (payload.kind !== "save-template") return { ok: false as const, error: "The template update was not valid." };
  const blocks = sanitizeBlocks(payload.blocks, look);
  if (!blocks) return { ok: false as const, error: "Check the email content, then try again." };
  const style = sanitizeStyle(payload.style);
  const applySeries = payload.applySeries === true;

  const data = { blocks: JSON.stringify(blocks), style: JSON.stringify(style), applySeries };
  const operations = [db.templateCustomization.upsert({
    where: { shop_lookId_flowId_emailIndex: { shop: session.shop, lookId: look, flowId: flow, emailIndex } },
    create: { shop: session.shop, lookId: look, flowId: flow, emailIndex, ...data },
    update: data,
  })];
  if (applySeries) {
    for (let index = 0; index <= maximum; index += 1) {
      if (index === emailIndex) continue;
      const existing = await db.templateCustomization.findUnique({ where: { shop_lookId_flowId_emailIndex: { shop: session.shop, lookId: look, flowId: flow, emailIndex: index } } });
      const existingBlocks = existing ? sanitizeBlocks(JSON.parse(existing.blocks), look) ?? buildDefaultBlocks(flow, index, look) : buildDefaultBlocks(flow, index, look);
      operations.push(db.templateCustomization.upsert({
        where: { shop_lookId_flowId_emailIndex: { shop: session.shop, lookId: look, flowId: flow, emailIndex: index } },
        create: { shop: session.shop, lookId: look, flowId: flow, emailIndex: index, blocks: JSON.stringify(existingBlocks), style: JSON.stringify(style), applySeries: true },
        update: { style: JSON.stringify(style), applySeries: true },
      }));
    }
  }
  await db.$transaction(operations);
  return { ok: true as const, message: applySeries ? "Changes saved. Style applied across this series." : "Changes saved for this email." };
};

// ─── LABELS / ICONS ──────────────────────────────────────────────────────────

function blockLabel(block: Block): string {
  switch (block.type) {
    case "header": return "Logo";
    case "footer": return "Footer";
    case "image": return "Image";
    case "text": {
      const eyebrow = (block.data.eyebrow || "").toUpperCase();
      if (eyebrow.includes("WELCOME") || eyebrow.includes("/")) return "Intro copy";
      if (/^\d/.test(eyebrow)) return "Routine step";
      return "Text";
    }
    case "button": return "Button";
    case "product": return "Product";
    case "product-row": return "Product row";
    case "divider": return "Divider";
    case "spacer": return "Spacer";
    case "social-links": return "Social links";
    case "navbar": return "Navbar";
    case "discount-code": return "Discount code";
    case "countdown": return "Countdown";
    case "shape-divider": return "Shape divider";
    default: return block.type;
  }
}

function ElemIcon({ type }: { type: BlockType }) {
  const icons: Partial<Record<BlockType, ReactNode>> = {
    text: <><rect x="3" y="5" width="18" height="2" rx="1" /><rect x="3" y="10" width="14" height="2" rx="1" /><rect x="3" y="15" width="16" height="2" rx="1" /></>,
    image: <><rect x="3" y="4" width="18" height="16" rx="1.5" strokeWidth="1.5" fill="none" /><circle cx="8.5" cy="9" r="1.5" /><path d="M3 15l4-4 3 3 3-3 5 5" strokeWidth="1.5" fill="none" /></>,
    button: <><rect x="3" y="8" width="18" height="8" rx="2" strokeWidth="1.5" fill="none" /><rect x="7" y="10.5" width="10" height="3" rx="1" fill="currentColor" opacity=".4" /></>,
    divider: <><line x1="3" y1="12" x2="21" y2="12" strokeWidth="1.5" /></>,
    spacer: <><line x1="12" y1="4" x2="12" y2="20" strokeWidth="1.5" /><path d="M8 7l4-3 4 3M8 17l4 3 4-3" strokeWidth="1.5" fill="none" /></>,
    navbar: <><rect x="3" y="5" width="18" height="14" rx="1.5" strokeWidth="1.5" fill="none" /><line x1="3" y1="10" x2="21" y2="10" strokeWidth="1" /></>,
    "social-links": <><circle cx="7" cy="12" r="2" strokeWidth="1.5" fill="none" /><circle cx="17" cy="7" r="2" strokeWidth="1.5" fill="none" /><circle cx="17" cy="17" r="2" strokeWidth="1.5" fill="none" /><line x1="9" y1="11" x2="15" y2="8" strokeWidth="1.5" /><line x1="9" y1="13" x2="15" y2="16" strokeWidth="1.5" /></>,
    countdown: <><circle cx="12" cy="12" r="8" strokeWidth="1.5" fill="none" /><path d="M12 8v4l2.5 2.5" strokeWidth="1.5" strokeLinecap="round" fill="none" /></>,
    "discount-code": <><rect x="3" y="7" width="18" height="10" rx="1.5" strokeWidth="1.5" fill="none" /><line x1="9" y1="7" x2="9" y2="17" strokeWidth="1" strokeDasharray="2 1" /></>,
    "shape-divider": <><path d="M3 14 Q7.5 8 12 14 T21 14" strokeWidth="1.5" fill="none" /></>,
    product: <><rect x="5" y="3" width="14" height="14" rx="1.5" strokeWidth="1.5" fill="none" /><line x1="5" y1="18" x2="19" y2="18" strokeWidth="1.5" strokeLinecap="round" /></>,
    "product-row": <><rect x="2" y="5" width="9" height="14" rx="1.5" strokeWidth="1.5" fill="none" /><rect x="13" y="5" width="9" height="14" rx="1.5" strokeWidth="1.5" fill="none" /></>,
  };
  return <svg viewBox="0 0 24 24" className="v9-elem-icon" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">{icons[type] ?? <rect x="3" y="3" width="18" height="18" rx="2" strokeWidth="1.5" />}</svg>;
}

// ─── CANVAS RENDERERS ────────────────────────────────────────────────────────

function CanvasTextBlock({ data }: { data: BlockData }) {
  return <div className="v9-block-text" style={{ textAlign: data.alignment || "left" }}>
    {data.eyebrow ? <p className="v9-eyebrow">{data.eyebrow}</p> : null}
    {data.headline ? <h3>{data.headline}</h3> : null}
    {data.body ? <p className="v9-body">{data.body}</p> : null}
  </div>;
}
function CanvasImageBlock({ data }: { data: BlockData }) {
  return <div className="v9-block-image"><img src={data.src} alt={data.alt || ""} style={{ objectFit: data.fit || "contain" }} /></div>;
}
function CanvasButtonBlock({ data, style }: { data: BlockData; style: EmailStyle }) {
  const outline = style.buttonVariant === "outline";
  return <div className="v9-block-button" style={{ textAlign: data.alignment || "center" }}>
    <span style={{ backgroundColor: outline ? "transparent" : style.buttonColor, color: outline ? style.buttonColor : "#ffffff", border: outline ? `2px solid ${style.buttonColor}` : "none", borderRadius: style.buttonRadius, padding: `${style.buttonPaddingV}px ${style.buttonPaddingH}px` }}>{data.label || "Shop now"}</span>
  </div>;
}
function CanvasDividerBlock() { return <div className="v9-block-divider" />; }
function CanvasSpacerBlock({ data }: { data: BlockData }) { return <div style={{ height: data.height ?? 24 }} />; }
function CanvasHeaderBlock({ data }: { data: BlockData }) {
  const justify: Record<Alignment, string> = { left: "flex-start", center: "center", right: "flex-end" };
  const align = data.logoAlignment || "left";
  return <div className="v9-block-header" style={{ justifyContent: justify[align], paddingTop: data.logoPaddingV ?? 18, paddingBottom: data.logoPaddingV ?? 18, paddingLeft: data.logoPaddingH ?? 22, paddingRight: data.logoPaddingH ?? 22 }}>
    {data.logoSrc ? <img src={data.logoSrc} alt={data.logoAlt || "Brand logo"} style={{ width: data.logoWidthMode === "full" ? "100%" : (data.logoWidth ?? 120), height: "auto" }} /> : <strong>{data.headline}</strong>}
  </div>;
}
function CanvasFooterBlock({ data }: { data: BlockData }) {
  return <div className="v9-block-footer">{(data.body || "").split("\n").map((line, i) => <p key={i}>{line}</p>)}</div>;
}
function CanvasProductBlock({ data }: { data: BlockData }) {
  if (!data.productName) return <div className="v9-block-product v9-block-product-empty"><p>Choose a product from your catalog.</p></div>;
  return <div className="v9-block-product"><div>
    {data.productImageSrc ? <img src={data.productImageSrc} alt={data.productName} /> : null}
    <div className="v9-block-product-copy">
      {data.productSku ? <p className="v9-eyebrow">{data.productSku}</p> : null}
      <p className="v9-block-product-name">{data.productName}</p>
      {data.productPrice ? <p className="v9-block-product-price">{data.productPrice}</p> : null}
      {data.url ? <span className="v9-block-product-cta">View product</span> : null}
    </div>
  </div></div>;
}
function CanvasProductRowBlock({ data }: { data: BlockData }) {
  const products = data.products || [];
  if (!products.length) return <div className="v9-block-product-row v9-block-product-empty"><p>Choose products from your catalog.</p></div>;
  return <div className="v9-block-product-row">{products.map((p, i) => <div key={i}>{p.src ? <img src={p.src} alt={p.name} /> : null}<p>{p.name}</p><span>{p.price}</span></div>)}</div>;
}
function CanvasSocialBlock({ data }: { data: BlockData }) {
  const icons: Record<string, string> = { instagram: "IG", tiktok: "TK", pinterest: "PT", facebook: "FB", x: "X" };
  return <div className="v9-block-social">{(data.networks || []).map((n) => <span key={n}>{icons[n] || n.slice(0, 2).toUpperCase()}</span>)}</div>;
}
function CanvasNavbarBlock({ data }: { data: BlockData }) {
  const links = (data.headline || "Shop · Routine · About").split("·").map((s) => s.trim()).filter(Boolean);
  return <div className="v9-block-navbar">{links.map((l, i) => <span key={i}>{l}</span>)}</div>;
}
function CanvasDiscountBlock({ data }: { data: BlockData }) {
  const treatment = data.discountTreatment || "outline";
  return <div className="v9-block-discount" style={{ textAlign: data.alignment || "center", padding: `${data.discountPadV ?? 20}px ${data.discountPadH ?? 24}px` }}>
    {data.eyebrow ? <p className="v9-eyebrow" style={{ color: data.discountTextColor, opacity: 0.6 }}>{data.eyebrow}</p> : null}
    <span className="v9-discount-box" style={{ borderRadius: data.discountRadius ?? 4, backgroundColor: treatment === "filled" ? (data.discountBg || "#f8f9f8") : "transparent", border: `2px ${treatment === "filled" ? "solid" : "dashed"} ${data.discountBorder || "#d7d3d3"}`, color: data.discountTextColor || "#201e1d" }}>{data.headline || "WELCOME15"}</span>
    {data.body ? <p className="v9-body" style={{ color: data.discountTextColor, opacity: 0.7 }}>{data.body}</p> : null}
  </div>;
}
function CanvasCountdownBlock({ data }: { data: BlockData }) {
  const segments = (data.headline || "48:00:00").split(":");
  const labels = ["Hours", "Minutes", "Seconds"];
  return <div className="v9-block-countdown">
    {data.eyebrow ? <p className="v9-eyebrow">{data.eyebrow}</p> : null}
    <div className="v9-countdown-segments">{segments.map((seg, i) => <div key={i}><span>{seg}</span><small>{labels[i] ?? ""}</small></div>)}</div>
    {data.body ? <p className="v9-body">{data.body}</p> : null}
  </div>;
}
function CanvasShapeDividerBlock() {
  return <div className="v9-block-shape-divider"><svg viewBox="0 0 390 32" preserveAspectRatio="none"><path d="M0,16 Q97.5,0 195,16 T390,16" fill="none" stroke="#d7d3d3" strokeWidth="1" /></svg></div>;
}

function BlockRenderer({ block, style }: { block: Block; style: EmailStyle }) {
  switch (block.type) {
    case "header": return <CanvasHeaderBlock data={block.data} />;
    case "footer": return <CanvasFooterBlock data={block.data} />;
    case "text": return <CanvasTextBlock data={block.data} />;
    case "image": return <CanvasImageBlock data={block.data} />;
    case "button": return <CanvasButtonBlock data={block.data} style={style} />;
    case "divider": return <CanvasDividerBlock />;
    case "spacer": return <CanvasSpacerBlock data={block.data} />;
    case "product": return <CanvasProductBlock data={block.data} />;
    case "product-row": return <CanvasProductRowBlock data={block.data} />;
    case "social-links": return <CanvasSocialBlock data={block.data} />;
    case "navbar": return <CanvasNavbarBlock data={block.data} />;
    case "discount-code": return <CanvasDiscountBlock data={block.data} />;
    case "countdown": return <CanvasCountdownBlock data={block.data} />;
    case "shape-divider": return <CanvasShapeDividerBlock />;
    default: return null;
  }
}

// ─── SHARED UI PIECES ────────────────────────────────────────────────────────

function InsertionRail({ active, label, onDrop, onHover, onLeave }: { active: boolean; label: string; onDrop: () => void; onHover: () => void; onLeave: () => void }) {
  return <div className="v9-insertion-rail" style={{ opacity: active ? 1 : 0.35 }} onDragOver={(e) => { e.preventDefault(); onHover(); }} onDragLeave={onLeave} onDrop={(e) => { e.preventDefault(); onDrop(); }}>
    <div className="v9-insertion-line" /><div className="v9-insertion-dot"><span aria-hidden="true">+</span></div>
    {active ? <span className="v9-insertion-label">{label}</span> : null}
  </div>;
}

function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => { const t = window.setTimeout(onDone, 2800); return () => window.clearTimeout(t); }, [onDone]);
  return <div className="v9-toast" role="status">{message}</div>;
}

function OverflowMenu({ isHidden, canDelete, isFirst, isLast, onMoveUp, onMoveDown, onToggleHide, onDelete, onClose }: { isHidden?: boolean; canDelete: boolean; isFirst: boolean; isLast: boolean; onMoveUp: () => void; onMoveDown: () => void; onToggleHide: () => void; onDelete: () => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);
  const item = (label: string, action: () => void, disabled?: boolean, danger?: boolean) => (
    <button type="button" disabled={disabled} onClick={() => { action(); onClose(); }} className={danger ? "is-danger" : ""}>{label}</button>
  );
  return <div ref={ref} className="v9-overflow-menu" role="menu">
    {item("Move up", onMoveUp, isFirst)}
    {item("Move down", onMoveDown, isLast)}
    <hr />
    {item(isHidden ? "Show block" : "Hide block", onToggleHide)}
    {canDelete ? <><hr />{item("Delete block", onDelete, false, true)}</> : null}
  </div>;
}

// ─── TOP BAR ─────────────────────────────────────────────────────────────────

function TopBar({ look, flow, emails, emailIndex, saveState, canUndo, canRedo, previewMode, onSelectEmail, onUndo, onRedo, onPreview, onSave }: {
  look: LookId; flow: FlowId; emails: readonly string[]; emailIndex: number; saveState: SaveState; canUndo: boolean; canRedo: boolean; previewMode: boolean;
  onSelectEmail: (index: number) => void; onUndo: () => void; onRedo: () => void; onPreview: () => void; onSave: () => void;
}) {
  const sc: Record<SaveState, string> = { saved: "Saved", unsaved: "Unsaved", saving: "Saving…", "save-failed": "Save failed" };
  return <header className="v9-topbar">
    <Link to={`/app/additional?look=${look}`} className="v9-topbar-back"><span aria-hidden="true">←</span> {FLOW_LABELS[flow]} series</Link>
    <div className="v9-topbar-divider" aria-hidden="true" />
    <div className="v9-topbar-context">
      <span>{LOOK_LABELS[look]}</span><span className="v9-topbar-slash">/</span>
      {emails.length > 1 ? (
        <select aria-label="Choose email" value={emailIndex} onChange={(e) => onSelectEmail(Number(e.target.value))}>
          {emails.map((email, index) => <option key={email} value={index}>{email} email</option>)}
        </select>
      ) : <strong>{emails[emailIndex]} email</strong>}
    </div>
    <div className="v9-topbar-actions">
      <span className={`v9-save-state is-${saveState}`} role="status" aria-live="polite"><i aria-hidden="true" />{sc[saveState]}</span>
      <button type="button" aria-label="Undo" onClick={onUndo} disabled={!canUndo}>↶</button>
      <button type="button" aria-label="Redo" onClick={onRedo} disabled={!canRedo}>↷</button>
      <button type="button" className={previewMode ? "is-active" : ""} onClick={onPreview}>{previewMode ? "Exit preview" : "Preview"}</button>
      {!previewMode ? <button type="button" className="v9-save-button" onClick={onSave} disabled={saveState === "saving"}>{saveState === "saving" ? "Saving…" : "Save changes"}</button> : null}
    </div>
  </header>;
}

// ─── LEFT PANEL ──────────────────────────────────────────────────────────────

function Accordion({ title, isOpen, onToggle, children }: { title: string; isOpen: boolean; onToggle: () => void; children: ReactNode }) {
  return <div className="v9-accordion"><button type="button" aria-expanded={isOpen} onClick={onToggle}>{title}<span aria-hidden="true">{isOpen ? "−" : "+"}</span></button>{isOpen ? <div className="v9-accordion-body">{children}</div> : null}</div>;
}
function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return <div className="v9-color-row"><label>{label}</label><div><input type="color" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} /><span>{value.toUpperCase()}</span></div></div>;
}
function SliderRow({ label, value, min, max, unit, onChange }: { label: string; value: number; min: number; max: number; unit?: string; onChange: (v: number) => void }) {
  return <div className="v9-slider-row"><div><label>{label}</label><span>{value}{unit || ""}</span></div><input aria-label={label} type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} /></div>;
}

const FONT_OPTIONS = ["IBM Plex Sans", "Lora", "Georgia", "Arial", "Helvetica", "system-ui"];

function LeftPanel({ tab, style, draggingType, onTabChange, onDragStart, onDragEnd, onClickAdd, onStyleChange, onApplyBrand }: {
  tab: RailTab; style: EmailStyle; draggingType: BlockType | null;
  onTabChange: (t: RailTab) => void; onDragStart: (type: BlockType) => void; onDragEnd: () => void; onClickAdd: (type: BlockType) => void;
  onStyleChange: (patch: Partial<EmailStyle>) => void; onApplyBrand: () => void;
}) {
  const [open, setOpen] = useState("brand");
  const toggle = (key: string) => setOpen((current) => (current === key ? "" : key));
  const tile = (el: { type: BlockType; label: string }) => (
    <div key={el.type} draggable tabIndex={0} role="button" aria-label={`Add ${el.label}`}
      onDragStart={() => onDragStart(el.type)} onDragEnd={onDragEnd} onClick={() => onClickAdd(el.type)}
      onKeyDown={(e) => { if (e.key === "Enter") onClickAdd(el.type); }} className={`v9-elem-tile${draggingType === el.type ? " is-dragging" : ""}`}>
      <ElemIcon type={el.type} /><span>{el.label}</span>
    </div>
  );
  return <aside className="v9-left-panel" aria-label="Email editor rail">
    <div className="v9-left-head"><p>NOMI</p><h2>Edit this email</h2></div>
    <div className="v9-left-tabs" role="tablist">
      <button type="button" role="tab" aria-selected={tab === "elements"} onClick={() => onTabChange("elements")}>Elements</button>
      <button type="button" role="tab" aria-selected={tab === "style"} onClick={() => onTabChange("style")}>Style</button>
    </div>
    {tab === "elements" ? <div className="v9-elements-tab">
      <p className="v9-group-label">Content</p><div className="v9-elem-grid">{CONTENT_ELEMENTS.map(tile)}</div>
      <p className="v9-group-label">Commerce</p><div className="v9-elem-grid">{COMMERCE_ELEMENTS.map(tile)}</div>
    </div> : <div className="v9-style-tab">
      <Accordion title="Brand System" isOpen={open === "brand"} onToggle={() => toggle("brand")}>
        <div className="v9-brand-card"><p>Nomi Brand System</p><span>Active · fills colors, fonts, buttons, and layout.</span>
          <button type="button" onClick={onApplyBrand}>Apply my brand</button>
        </div>
      </Accordion>
      <Accordion title="Colors" isOpen={open === "colors"} onToggle={() => toggle("colors")}>
        <ColorRow label="Email background" value={style.emailBg} onChange={(v) => onStyleChange({ emailBg: v })} />
        <ColorRow label="Content background" value={style.contentBg} onChange={(v) => onStyleChange({ contentBg: v })} />
        <ColorRow label="Text color" value={style.textColor} onChange={(v) => onStyleChange({ textColor: v })} />
        <ColorRow label="Link color" value={style.linkColor} onChange={(v) => onStyleChange({ linkColor: v })} />
        <ColorRow label="Button color" value={style.buttonColor} onChange={(v) => onStyleChange({ buttonColor: v })} />
      </Accordion>
      <Accordion title="Fonts" isOpen={open === "fonts"} onToggle={() => toggle("fonts")}>
        <label className="v9-select-row">Heading font<select value={style.headingFont} onChange={(e) => onStyleChange({ headingFont: e.target.value })}>{FONT_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}</select></label>
        <label className="v9-select-row">Body font<select value={style.bodyFont} onChange={(e) => onStyleChange({ bodyFont: e.target.value })}>{FONT_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}</select></label>
        <SliderRow label="Base text size" value={style.baseFontSize} min={11} max={18} unit="px" onChange={(v) => onStyleChange({ baseFontSize: v })} />
      </Accordion>
      <Accordion title="Buttons" isOpen={open === "buttons"} onToggle={() => toggle("buttons")}>
        <SliderRow label="Corner radius" value={style.buttonRadius} min={0} max={24} unit="px" onChange={(v) => onStyleChange({ buttonRadius: v })} />
        <div className="v9-segmented"><button type="button" className={style.buttonVariant === "fill" ? "is-active" : ""} onClick={() => onStyleChange({ buttonVariant: "fill" })}>Fill</button><button type="button" className={style.buttonVariant === "outline" ? "is-active" : ""} onClick={() => onStyleChange({ buttonVariant: "outline" })}>Outline</button></div>
        <SliderRow label="Padding horizontal" value={style.buttonPaddingH} min={8} max={48} unit="px" onChange={(v) => onStyleChange({ buttonPaddingH: v })} />
        <SliderRow label="Padding vertical" value={style.buttonPaddingV} min={6} max={24} unit="px" onChange={(v) => onStyleChange({ buttonPaddingV: v })} />
      </Accordion>
      <Accordion title="Layout" isOpen={open === "layout"} onToggle={() => toggle("layout")}>
        <div className="v9-number-row"><label>Content width</label><div><input type="number" min={320} max={700} value={style.contentWidth} onChange={(e) => onStyleChange({ contentWidth: Number(e.target.value) })} /><span>px</span></div></div>
        <input aria-label="Content width" type="range" min={320} max={700} value={style.contentWidth} onChange={(e) => onStyleChange({ contentWidth: Number(e.target.value) })} className="v9-plain-range" />
        <p className="v9-hint">Default 600px · most clients clip above 700px</p>
        <SliderRow label="Block spacing" value={style.blockSpacing} min={0} max={32} unit="px" onChange={(v) => onStyleChange({ blockSpacing: v })} />
      </Accordion>
    </div>}
  </aside>;
}

// ─── CONTEXTUAL EDITOR ───────────────────────────────────────────────────────

const Field = ({ label, children }: { label: string; children: ReactNode }) => <div className="v9-field"><label>{label}</label>{children}</div>;

function AlignButtons({ value, onChange }: { value?: Alignment; onChange: (v: Alignment) => void }) {
  return <div className="v9-segmented">{(["left", "center", "right"] as const).map((a) => <button type="button" key={a} className={value === a ? "is-active" : ""} onClick={() => onChange(a)}>{a[0].toUpperCase() + a.slice(1)}</button>)}</div>;
}

function PanelHeader({ label, kicker, isHidden, canDuplicate, canDelete, isFirst, isLast, onDuplicate, onMoveUp, onMoveDown, onHide, onDelete }: {
  label: string; kicker: string; isHidden?: boolean; canDuplicate: boolean; canDelete: boolean; isFirst: boolean; isLast: boolean;
  onDuplicate: () => void; onMoveUp: () => void; onMoveDown: () => void; onHide: () => void; onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  return <div className="v9-panel-head">
    <div><p className="v9-kicker">{kicker}</p><h3>{label}</h3></div>
    {canDuplicate || canDelete ? <div className="v9-panel-head-actions">
      {canDuplicate ? <button type="button" onClick={onDuplicate}>Duplicate</button> : null}
      <div className="v9-menu-anchor">
        <button type="button" aria-label="More actions" onClick={() => setMenuOpen((v) => !v)}>⋯</button>
        {menuOpen ? <OverflowMenu isHidden={isHidden} canDelete={canDelete} isFirst={isFirst} isLast={isLast} onMoveUp={onMoveUp} onMoveDown={onMoveDown} onToggleHide={onHide} onDelete={onDelete} onClose={() => setMenuOpen(false)} /> : null}
      </div>
    </div> : null}
  </div>;
}

type PanelProps = {
  block: Block; isFirst: boolean; isLast: boolean;
  onUpdate: (d: Partial<BlockData>) => void;
  onDuplicate: () => void; onHide: () => void; onDelete: () => void; onMoveUp: () => void; onMoveDown: () => void;
};

function LogoEditor({ block, onUpdate, look, shopifyFiles, uploadState, onUpload }: PanelProps & { look: LookId; shopifyFiles: MediaAsset[]; uploadState: UploadState; onUpload: (file: File, target: AssetTarget) => void }) {
  const d = block.data;
  const [linkedPad, setLinkedPad] = useState(true);
  const source = d.logoSource || "brand";
  const handlePadV = (v: number) => onUpdate({ logoPaddingV: v, ...(linkedPad ? { logoPaddingH: v } : {}) });
  const handlePadH = (v: number) => onUpdate({ logoPaddingH: v, ...(linkedPad ? { logoPaddingV: v } : {}) });
  return <div className="v9-panel">
    <div className="v9-panel-head"><div><p className="v9-kicker">LOGO</p><h3>Choose a logo source</h3><p className="v9-panel-intro">The header container is inbox-safe. You control the logo, link, and spacing.</p></div></div>
    <div className="v9-panel-body">
      <div className="v9-source-grid">
        <button type="button" className={source === "brand" ? "is-active" : ""} onClick={() => onUpdate({ logoSource: "brand", logoSrc: undefined })}>Brand name</button>
        <button type="button" className={source === "shopify" ? "is-active" : ""} onClick={() => onUpdate({ logoSource: "shopify" })}>Shopify files</button>
        <button type="button" className={source === "upload" ? "is-active" : ""} onClick={() => onUpdate({ logoSource: "upload" })}>Upload</button>
      </div>
      {source === "shopify" ? <div className="v9-asset-list">{shopifyFiles.length ? shopifyFiles.map((asset) => <button type="button" key={asset.id} className={d.logoSrc === asset.url ? "is-selected" : ""} onClick={() => onUpdate({ logoSrc: asset.url, logoAlt: asset.alt })}><img src={asset.url} alt="" /><span>{asset.name}</span></button>) : <p className="v9-hint">No Shopify files yet.</p>}</div> : null}
      {source === "upload" ? <>
        <label className="v9-upload-control">{uploadState.uploading ? "Uploading…" : "Choose logo from computer"}<input type="file" accept="image/jpeg,image/png,image/gif" disabled={uploadState.uploading} onChange={(e) => { const file = e.target.files?.[0]; if (file) onUpload(file, "logo"); e.currentTarget.value = ""; }} /></label>
        {uploadState.error ? <p className="v9-error" role="alert">{uploadState.error}</p> : null}
        {uploadState.status ? <p className="v9-hint" role="status">{uploadState.status}</p> : null}
      </> : null}
      <div className="v9-current-asset">
        {d.logoSrc ? <img src={d.logoSrc} alt="" /> : <strong>{BRAND_NAME[look]}</strong>}
        <span>Current logo</span>
      </div>
      <Field label="Alt text (required)"><input value={d.logoAlt || ""} onChange={(e) => onUpdate({ logoAlt: e.target.value })} placeholder={`e.g. ${BRAND_NAME[look]}`} /></Field>
      <Field label="Alignment"><AlignButtons value={d.logoAlignment || "left"} onChange={(v) => onUpdate({ logoAlignment: v })} /></Field>
      <Field label="Treatment"><div className="v9-segmented">{(["primary", "light", "dark"] as const).map((v) => <button type="button" key={v} className={(d.logoVariant || "primary") === v ? "is-active" : ""} onClick={() => onUpdate({ logoVariant: v })}>{v[0].toUpperCase() + v.slice(1)}</button>)}</div></Field>
      <Field label="Width mode"><div className="v9-segmented"><button type="button" className={(d.logoWidthMode || "fixed") === "fixed" ? "is-active" : ""} onClick={() => onUpdate({ logoWidthMode: "fixed" })}>Fixed</button><button type="button" className={d.logoWidthMode === "full" ? "is-active" : ""} onClick={() => onUpdate({ logoWidthMode: "full" })}>Full width</button></div></Field>
      {(d.logoWidthMode || "fixed") === "fixed" ? <Field label="Width (40–240px)"><input type="number" min={40} max={240} value={d.logoWidth ?? 120} onChange={(e) => onUpdate({ logoWidth: Math.max(40, Math.min(240, Number(e.target.value))) })} /></Field> : null}
      <Field label="Destination link"><input value={d.logoLink || ""} onChange={(e) => onUpdate({ logoLink: e.target.value })} placeholder="https://…" /></Field>
      <div className="v9-linked-padding">
        <div><label>Padding</label><button type="button" className={linkedPad ? "is-active" : ""} onClick={() => setLinkedPad((v) => !v)}>{linkedPad ? "∞ Linked" : "Unlinked"}</button></div>
        <div className="v9-padding-pair">
          <label>Top / bottom<input type="number" min={0} max={60} value={d.logoPaddingV ?? 18} onChange={(e) => handlePadV(Number(e.target.value))} /></label>
          <label>Left / right<input type="number" min={0} max={60} value={d.logoPaddingH ?? 22} onChange={(e) => handlePadH(Number(e.target.value))} /></label>
        </div>
      </div>
    </div>
  </div>;
}

function ImageEditor(props: PanelProps & { look: LookId; shopifyFiles: MediaAsset[]; productMedia: MediaAsset[]; uploadState: UploadState; onUpload: (file: File, target: AssetTarget) => void }) {
  const { block, look, shopifyFiles, productMedia, uploadState, onUpload, onUpdate, isFirst, isLast, onDuplicate, onHide, onDelete, onMoveUp, onMoveDown } = props;
  const d = block.data;
  const source = d.imageSource || "shopify";
  const options: Record<MediaSource, MediaAsset[]> = { shopify: shopifyFiles, products: productMedia, upload: HERO_ASSETS[look].map((a) => ({ id: a.id, name: a.name, url: a.src, alt: a.alt, width: null, height: null, source: "upload" })) };
  return <div className="v9-panel">
    <PanelHeader label="Edit image" kicker="IMAGE" isHidden={block.hidden} canDuplicate canDelete isFirst={isFirst} isLast={isLast} onDuplicate={onDuplicate} onMoveUp={onMoveUp} onMoveDown={onMoveDown} onHide={onHide} onDelete={onDelete} />
    <div className="v9-panel-body">
      <div className="v9-source-grid">
        <button type="button" className={source === "shopify" ? "is-active" : ""} onClick={() => onUpdate({ imageSource: "shopify" })}>Shopify files</button>
        <button type="button" className={source === "products" ? "is-active" : ""} onClick={() => onUpdate({ imageSource: "products" })}>Products</button>
        <button type="button" className={source === "upload" ? "is-active" : ""} onClick={() => onUpdate({ imageSource: "upload" })}>Upload</button>
      </div>
      {source === "upload" ? <>
        <label className="v9-upload-control">{uploadState.uploading ? "Uploading…" : "Choose image from computer"}<input type="file" accept="image/jpeg,image/png,image/gif" disabled={uploadState.uploading} onChange={(e) => { const file = e.target.files?.[0]; if (file) onUpload(file, "hero"); e.currentTarget.value = ""; }} /></label>
        {uploadState.error ? <p className="v9-error" role="alert">{uploadState.error}</p> : null}
        {uploadState.status ? <p className="v9-hint" role="status">{uploadState.status}</p> : null}
      </> : null}
      <div className="v9-asset-list">{options[source].length ? options[source].map((asset) => <button type="button" key={asset.id} className={d.src === asset.url ? "is-selected" : ""} onClick={() => onUpdate({ src: asset.url, alt: asset.alt, imageSource: source })}><img src={asset.url} alt="" /><span>{asset.name}</span></button>) : <p className="v9-hint">No images available from this source yet.</p>}</div>
      {d.src ? <div className="v9-current-asset"><img src={d.src} alt="" /><span>Selected — natural ratio preserved</span></div> : null}
      <Field label="Alt text"><input value={d.alt || ""} onChange={(e) => onUpdate({ alt: e.target.value })} placeholder="Describe the image for screen readers…" /></Field>
      <Field label="Link (optional)"><input value={d.linkUrl || ""} onChange={(e) => onUpdate({ linkUrl: e.target.value })} placeholder="https://…" /></Field>
      <Field label="Fit"><div className="v9-segmented"><button type="button" className={(d.fit || "contain") === "contain" ? "is-active" : ""} onClick={() => onUpdate({ fit: "contain" })}>Contain</button><button type="button" className={d.fit === "cover" ? "is-active" : ""} onClick={() => onUpdate({ fit: "cover" })}>Cover</button></div></Field>
    </div>
  </div>;
}

function TextEditor(props: PanelProps & { rewriteState: RewriteState; onRewrite: (style: RewriteStyle) => void; onApplyRewrite: () => void; onDiscardRewrite: () => void }) {
  const { block, onUpdate, isFirst, isLast, onDuplicate, onHide, onDelete, onMoveUp, onMoveDown, rewriteState, onRewrite, onApplyRewrite, onDiscardRewrite } = props;
  const d = block.data;
  const [rewriteOpen, setRewriteOpen] = useState(false);
  const label = blockLabel(block);
  return <div className="v9-panel">
    <PanelHeader label={`Edit ${label.toLowerCase()}`} kicker="TEXT" isHidden={block.hidden} canDuplicate canDelete isFirst={isFirst} isLast={isLast} onDuplicate={onDuplicate} onMoveUp={onMoveUp} onMoveDown={onMoveDown} onHide={onHide} onDelete={onDelete} />
    <div className="v9-panel-body">
      <Field label="Eyebrow"><input value={d.eyebrow || ""} onChange={(e) => onUpdate({ eyebrow: e.target.value })} placeholder="e.g. WELCOME / 01" /></Field>
      <Field label="Headline"><input value={d.headline || ""} onChange={(e) => onUpdate({ headline: e.target.value })} placeholder="Add a headline…" /></Field>
      <Field label="Body copy"><textarea rows={4} value={d.body || ""} onChange={(e) => onUpdate({ body: e.target.value })} placeholder="Write body copy…" /></Field>
      <Field label="Alignment"><AlignButtons value={d.alignment || "left"} onChange={(v) => onUpdate({ alignment: v })} /></Field>
      <div className="v9-rewrite">
        <button type="button" className="v9-rewrite-toggle" onClick={() => setRewriteOpen((v) => !v)}><span>✦ Rewrite with Nomi</span><span aria-hidden="true">{rewriteOpen ? "▲" : "▼"}</span></button>
        {rewriteOpen ? <div className="v9-rewrite-body">
          {rewriteState.preview ? <div className="v9-rewrite-preview">
            <p className="v9-kicker">Preview</p>
            <p className="v9-rewrite-headline">{rewriteState.preview.headline}</p>
            <p className="v9-hint">{rewriteState.preview.body}</p>
            <div className="v9-rewrite-preview-actions"><button type="button" onClick={onApplyRewrite}>Apply</button><button type="button" onClick={onDiscardRewrite}>Discard</button></div>
          </div> : null}
          {rewriteState.error ? <p className="v9-error" role="alert">{rewriteState.error}</p> : null}
          <div className="v9-rewrite-options">
            {(["shorter", "warmer", "direct"] as const).map((opt) => <button type="button" key={opt} disabled={rewriteState.loading !== null} onClick={() => onRewrite(opt)}>{rewriteState.loading === opt ? "Rewriting…" : opt === "shorter" ? "Shorter" : opt === "warmer" ? "Warmer" : "More direct"}</button>)}
          </div>
          <p className="v9-hint">Only this block changes. Undo restores the original.</p>
        </div> : null}
      </div>
    </div>
  </div>;
}

function ButtonEditor({ block, onUpdate, isFirst, isLast, onDuplicate, onHide, onDelete, onMoveUp, onMoveDown }: PanelProps) {
  const d = block.data;
  return <div className="v9-panel">
    <PanelHeader label="Edit button" kicker="BUTTON" isHidden={block.hidden} canDuplicate canDelete isFirst={isFirst} isLast={isLast} onDuplicate={onDuplicate} onMoveUp={onMoveUp} onMoveDown={onMoveDown} onHide={onHide} onDelete={onDelete} />
    <div className="v9-panel-body">
      <Field label="Button label"><input value={d.label || ""} onChange={(e) => onUpdate({ label: e.target.value })} placeholder="Shop now" /></Field>
      <Field label="Destination URL"><input value={d.url || ""} onChange={(e) => onUpdate({ url: e.target.value })} placeholder="https://…" /></Field>
      <Field label="Alignment"><AlignButtons value={d.alignment || "center"} onChange={(v) => onUpdate({ alignment: v })} /></Field>
    </div>
  </div>;
}

function ProductEditor({ block, onUpdate, isFirst, isLast, onDuplicate, onHide, onDelete, onMoveUp, onMoveDown, catalogProducts }: PanelProps & { catalogProducts: CatalogProduct[] }) {
  const d = block.data;
  return <div className="v9-panel">
    <PanelHeader label="Edit product" kicker="PRODUCT" isHidden={block.hidden} canDuplicate canDelete isFirst={isFirst} isLast={isLast} onDuplicate={onDuplicate} onMoveUp={onMoveUp} onMoveDown={onMoveDown} onHide={onHide} onDelete={onDelete} />
    <div className="v9-panel-body">
      <p className="v9-panel-intro">Choose a real product from your catalog. Nomi never invents a price, SKU, or link.</p>
      <div className="v9-catalog-list">{catalogProducts.length ? catalogProducts.map((p) => <button type="button" key={p.id} className={d.productId === p.id ? "is-selected" : ""} onClick={() => onUpdate({ productId: p.id, productName: p.name, productPrice: p.price || "", productImageSrc: p.imageSrc || "", url: p.url || "" })}>{p.imageSrc ? <img src={p.imageSrc} alt="" /> : <span className="v9-catalog-placeholder" aria-hidden="true" />}<span><strong>{p.name}</strong><small>{p.price || "No price"} {p.url ? "" : "· not published online"}</small></span></button>) : <p className="v9-hint">No products found in this store yet.</p>}</div>
      {d.productName ? <p className="v9-hint">{d.url ? "Links to the live product page." : "This product isn't published to Online Store, so no link will show."}</p> : null}
    </div>
  </div>;
}

function DiscountEditor({ block, onUpdate, isFirst, isLast, onDuplicate, onHide, onDelete, onMoveUp, onMoveDown }: PanelProps) {
  const d = block.data;
  const [linkedPad, setLinkedPad] = useState(true);
  const handlePadV = (v: number) => onUpdate({ discountPadV: v, ...(linkedPad ? { discountPadH: v } : {}) });
  const handlePadH = (v: number) => onUpdate({ discountPadH: v, ...(linkedPad ? { discountPadV: v } : {}) });
  return <div className="v9-panel">
    <PanelHeader label="Edit discount code" kicker="DISCOUNT CODE" isHidden={block.hidden} canDuplicate canDelete isFirst={isFirst} isLast={isLast} onDuplicate={onDuplicate} onMoveUp={onMoveUp} onMoveDown={onMoveDown} onHide={onHide} onDelete={onDelete} />
    <div className="v9-panel-body">
      <p className="v9-section-label">Content</p>
      <Field label="Eyebrow / label"><input value={d.eyebrow || ""} onChange={(e) => onUpdate({ eyebrow: e.target.value })} placeholder="EXCLUSIVE OFFER" /></Field>
      <Field label="Discount code"><input value={d.headline || ""} onChange={(e) => onUpdate({ headline: e.target.value.trim() })} className="v9-mono" placeholder="WELCOME15" /></Field>
      <Field label="Supporting text"><textarea rows={3} value={d.body || ""} onChange={(e) => onUpdate({ body: e.target.value })} placeholder="15% off your first order — automatically applied at checkout." /></Field>
      <p className="v9-section-label">Appearance</p>
      <Field label="Treatment"><div className="v9-segmented"><button type="button" className={(d.discountTreatment || "outline") === "outline" ? "is-active" : ""} onClick={() => onUpdate({ discountTreatment: "outline" })}>Outline</button><button type="button" className={d.discountTreatment === "filled" ? "is-active" : ""} onClick={() => onUpdate({ discountTreatment: "filled" })}>Filled</button></div></Field>
      <Field label="Alignment"><AlignButtons value={d.alignment || "center"} onChange={(v) => onUpdate({ alignment: v })} /></Field>
      <ColorRow label="Background color" value={d.discountBg || "#f8f9f8"} onChange={(v) => onUpdate({ discountBg: v })} />
      <ColorRow label="Border color" value={d.discountBorder || "#d7d3d3"} onChange={(v) => onUpdate({ discountBorder: v })} />
      <ColorRow label="Text color" value={d.discountTextColor || "#201e1d"} onChange={(v) => onUpdate({ discountTextColor: v })} />
      <SliderRow label="Corner radius" value={d.discountRadius ?? 4} min={0} max={24} unit="px" onChange={(v) => onUpdate({ discountRadius: v })} />
      <p className="v9-section-label">Spacing</p>
      <div className="v9-linked-padding">
        <div><label>Padding</label><button type="button" className={linkedPad ? "is-active" : ""} onClick={() => setLinkedPad((v) => !v)}>{linkedPad ? "∞ Linked" : "Unlinked"}</button></div>
        <div className="v9-padding-pair">
          <label>Top / bottom<input type="number" min={0} max={60} value={d.discountPadV ?? 20} onChange={(e) => handlePadV(Number(e.target.value))} /></label>
          <label>Left / right<input type="number" min={0} max={60} value={d.discountPadH ?? 24} onChange={(e) => handlePadH(Number(e.target.value))} /></label>
        </div>
      </div>
    </div>
  </div>;
}

function GenericEditor({ block, onUpdate, isFirst, isLast, onDuplicate, onHide, onDelete, onMoveUp, onMoveDown }: PanelProps) {
  const d = block.data;
  const label = blockLabel(block);
  const kicker = block.type.replace("-", " ").toUpperCase();
  return <div className="v9-panel">
    <PanelHeader label={label} kicker={kicker} isHidden={block.hidden} canDuplicate canDelete isFirst={isFirst} isLast={isLast} onDuplicate={onDuplicate} onMoveUp={onMoveUp} onMoveDown={onMoveDown} onHide={onHide} onDelete={onDelete} />
    <div className="v9-panel-body">
      {block.type === "spacer" || block.type === "shape-divider" ? <Field label="Height"><input type="range" min={8} max={80} value={d.height ?? 24} onChange={(e) => onUpdate({ height: Number(e.target.value) })} /></Field> : null}
      {block.type === "social-links" ? <p className="v9-panel-intro">Social links use the accounts connected in Brand &amp; settings.</p> : null}
      {block.type === "navbar" ? <Field label="Links (separate with ·)"><input value={d.headline || ""} onChange={(e) => onUpdate({ headline: e.target.value })} placeholder="Shop · Routine · About" /></Field> : null}
      {block.type === "product-row" ? <p className="v9-panel-intro">Product rows pull from your Shopify catalog. Building a full picker for multiple products is coming soon — use a single Product block for now.</p> : null}
      {block.type === "countdown" ? <><Field label="Eyebrow"><input value={d.eyebrow || ""} onChange={(e) => onUpdate({ eyebrow: e.target.value })} /></Field><Field label="Target (HH:MM:SS)"><input value={d.headline || ""} onChange={(e) => onUpdate({ headline: e.target.value })} placeholder="48:00:00" /></Field><Field label="Supporting text"><input value={d.body || ""} onChange={(e) => onUpdate({ body: e.target.value })} /></Field></> : null}
    </div>
  </div>;
}

function EditorEmptyState() {
  return <div className="v9-empty-state"><div className="v9-empty-icon" aria-hidden="true">↖</div><p>Select something to edit</p><span>Click any block in the email, or add one from the Elements tab.</span></div>;
}

type UploadState = { uploading: boolean; error?: string; status?: string };
type RewriteState = { loading: RewriteStyle | null; preview: { headline: string; body: string } | null; error?: string };

function ContextualEditor({ block, isFirst, isLast, look, shopifyFiles, productMedia, catalogProducts, uploadState, onUpload, rewriteState, onRewrite, onApplyRewrite, onDiscardRewrite, onUpdate, onDuplicate, onHide, onDelete, onMoveUp, onMoveDown }: {
  block: Block | null; isFirst: boolean; isLast: boolean; look: LookId; shopifyFiles: MediaAsset[]; productMedia: MediaAsset[]; catalogProducts: CatalogProduct[];
  uploadState: UploadState; onUpload: (file: File, target: AssetTarget) => void;
  rewriteState: RewriteState; onRewrite: (style: RewriteStyle) => void; onApplyRewrite: () => void; onDiscardRewrite: () => void;
  onUpdate: (d: Partial<BlockData>) => void; onDuplicate: () => void; onHide: () => void; onDelete: () => void; onMoveUp: () => void; onMoveDown: () => void;
}) {
  if (!block) return <aside className="v9-right-panel" aria-label="Section editor"><EditorEmptyState /></aside>;
  if (block.type === "footer") return <aside className="v9-right-panel" aria-label="Section editor"><div className="v9-panel"><div className="v9-panel-head"><div><p className="v9-kicker">FOOTER</p><h3>Protected details</h3></div></div><div className="v9-panel-body"><p className="v9-panel-intro">Required address, preferences, and unsubscribe information are managed in Brand &amp; settings and can't be removed here.</p></div></div></aside>;
  const shared: PanelProps = { block, isFirst, isLast, onUpdate, onDuplicate, onHide, onDelete, onMoveUp, onMoveDown };
  let content: ReactNode;
  if (block.type === "header") content = <LogoEditor {...shared} look={look} shopifyFiles={shopifyFiles} uploadState={uploadState} onUpload={onUpload} />;
  else if (block.type === "image") content = <ImageEditor {...shared} look={look} shopifyFiles={shopifyFiles} productMedia={productMedia} uploadState={uploadState} onUpload={onUpload} />;
  else if (block.type === "text") content = <TextEditor {...shared} rewriteState={rewriteState} onRewrite={onRewrite} onApplyRewrite={onApplyRewrite} onDiscardRewrite={onDiscardRewrite} />;
  else if (block.type === "button") content = <ButtonEditor {...shared} />;
  else if (block.type === "product" || block.type === "product-row") content = block.type === "product" ? <ProductEditor {...shared} catalogProducts={catalogProducts} /> : <GenericEditor {...shared} />;
  else if (block.type === "discount-code") content = <DiscountEditor {...shared} />;
  else content = <GenericEditor {...shared} />;
  return <aside className="v9-right-panel" aria-label="Section editor" key={block.id}>{content}</aside>;
}

// ─── WORKBENCH ───────────────────────────────────────────────────────────────

function WorkbenchArea({ emailName, blocks, style, selectedBlockId, previewWidth, draggingType, onSelectBlock, onInsertBlock, onPreviewWidthChange }: {
  emailName: string; blocks: Block[]; style: EmailStyle; selectedBlockId: string | null; previewWidth: PreviewWidth; draggingType: BlockType | null;
  onSelectBlock: (id: string | null) => void; onInsertBlock: (index: number) => void; onPreviewWidthChange: (w: PreviewWidth) => void;
}) {
  const [hoveredRail, setHoveredRail] = useState<number | null>(null);
  const isDragging = draggingType !== null;
  const canvasWidth = previewWidth === "mobile" ? 390 : style.contentWidth;
  const dragLabel = draggingType ? `Add ${draggingType.replace("-", " ")}` : "Add block";
  const drop = (index: number) => { onInsertBlock(index); setHoveredRail(null); };
  const viewportRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (viewportRef.current) viewportRef.current.scrollTop = 0; }, [emailName]);
  return <div className="v9-workbench">
    <div className="v9-workbench-head">
      <p>{emailName} email</p>
      <div className="v9-device-switch">
        <button type="button" className={previewWidth === "mobile" ? "is-active" : ""} onClick={() => onPreviewWidthChange("mobile")}>Mobile <span>390px</span></button>
        <button type="button" className={previewWidth === "desktop" ? "is-active" : ""} onClick={() => onPreviewWidthChange("desktop")}>Desktop <span>{style.contentWidth}px</span></button>
      </div>
    </div>
    <div className="v9-canvas-scroll" style={{ backgroundColor: style.emailBg }} onClick={(e) => { if (e.target === e.currentTarget) onSelectBlock(null); }}>
      <div className="v9-canvas-viewport" ref={viewportRef} style={{ width: canvasWidth }}>
        <div className="v9-email-content" style={{ backgroundColor: style.contentBg, "--v9-heading-font": `'${style.headingFont}', Georgia, serif`, "--v9-body-font": `'${style.bodyFont}', Arial, sans-serif`, "--v9-base-size": `${style.baseFontSize}px`, "--v9-block-gap": `${style.blockSpacing}px`, "--v9-link-color": style.linkColor, "--v9-text-color": style.textColor } as CSSProperties}>
          {blocks.map((block, idx) => {
            const isEdge = idx === 0 || idx === blocks.length - 1;
            const isSelected = block.id === selectedBlockId;
            if (block.type === "footer") return <div key={block.id} className="v9-locked-block" title="Required email details are managed in Brand & settings."><BlockRenderer block={block} style={style} /></div>;
            return <div key={block.id}>
              {isDragging && idx === 1 ? <InsertionRail active={hoveredRail === 1} label={dragLabel} onDrop={() => drop(1)} onHover={() => setHoveredRail(1)} onLeave={() => setHoveredRail(null)} /> : null}
              {block.type === "header" ? <div className="v9-locked-block" title="The logo is editable; the header container stays inbox-safe."><BlockRenderer block={block} style={style} /></div> : (
                <div className={`v9-canvas-block${isSelected ? " is-selected" : ""}${block.hidden ? " is-hidden" : ""}`} role="button" tabIndex={0} aria-pressed={isSelected} aria-label={`${blockLabel(block)} block`}
                  onClick={(e) => { e.stopPropagation(); onSelectBlock(block.id); }} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelectBlock(block.id); } }}>
                  {isSelected ? <span className="v9-selection-tag">{blockLabel(block)}{block.hidden ? " · Hidden" : ""}</span> : null}
                  <BlockRenderer block={block} style={style} />
                </div>
              )}
              {isDragging && !isEdge && idx < blocks.length - 2 ? <InsertionRail active={hoveredRail === idx + 1} label={dragLabel} onDrop={() => drop(idx + 1)} onHover={() => setHoveredRail(idx + 1)} onLeave={() => setHoveredRail(null)} /> : null}
            </div>;
          })}
        </div>
      </div>
    </div>
  </div>;
}

// ─── FULL-SCREEN PREVIEW ─────────────────────────────────────────────────────

function PreviewScreen({ lookName, flow, emails, emailIndex, blocks, style, onSelectEmail, onExit }: {
  lookName: string; flow: FlowId; emails: readonly string[]; emailIndex: number; blocks: Block[]; style: EmailStyle; onSelectEmail: (index: number) => void; onExit: () => void;
}) {
  const [width, setWidth] = useState<PreviewWidth>("mobile");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onExit(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onExit]);
  return <div className="v9-preview-screen">
    <div className="v9-preview-head">
      <p>{lookName} / {FLOW_LABELS[flow]} · {emails[emailIndex]} email</p>
      <div className="v9-device-switch">
        <button type="button" className={width === "mobile" ? "is-active" : ""} onClick={() => setWidth("mobile")}>Mobile</button>
        <button type="button" className={width === "desktop" ? "is-active" : ""} onClick={() => setWidth("desktop")}>Desktop</button>
      </div>
      <button type="button" className="v9-exit-preview" onClick={onExit}>Exit preview</button>
    </div>
    {emails.length > 1 ? <nav className="v9-preview-nav" aria-label="Emails in this flow">{emails.map((email, index) => <button type="button" key={email} className={index === emailIndex ? "is-active" : ""} onClick={() => onSelectEmail(index)}>0{index + 1} {email}</button>)}</nav> : null}
    <div className="v9-preview-body">
      <div className="v9-preview-frame" style={{ width: width === "mobile" ? 390 : style.contentWidth }}>
        <div className="v9-email-content" style={{ backgroundColor: style.contentBg, "--v9-heading-font": `'${style.headingFont}', Georgia, serif`, "--v9-body-font": `'${style.bodyFont}', Arial, sans-serif`, "--v9-base-size": `${style.baseFontSize}px`, "--v9-block-gap": `${style.blockSpacing}px`, "--v9-link-color": style.linkColor, "--v9-text-color": style.textColor } as CSSProperties}>
          {blocks.filter((b) => !b.hidden).map((block) => <div key={block.id}><BlockRenderer block={block} style={style} /></div>)}
        </div>
      </div>
    </div>
  </div>;
}

// ─── APP ─────────────────────────────────────────────────────────────────────

export default function TemplateEditor() {
  const { look, flow, emailIndex: initialEmailIndex, drafts: loadedDrafts, shopifyFiles, productMedia, catalogProducts, mediaError } = useLoaderData<typeof loader>();
  const saveFetcher = useFetcher<typeof action>();
  const uploadFetcher = useFetcher<typeof action>();
  const rewriteFetcher = useFetcher<typeof action>();

  const emails = EMAIL_NAMES[look][flow];
  const lookName = LOOK_LABELS[look];

  const draftCache = useRef<EditorDraft[]>(loadedDrafts);
  const dirtyEmails = useRef(new Set<number>());
  const savingEmail = useRef<number | null>(null);

  const [emailIndex, setEmailIndex] = useState(initialEmailIndex);
  const [blocks, setBlocks] = useState<Block[]>(loadedDrafts[initialEmailIndex].blocks);
  const [style, setStyle] = useState<EmailStyle>(loadedDrafts[initialEmailIndex].style);
  const [applySeries, setApplySeries] = useState(loadedDrafts[initialEmailIndex].applySeries);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [saved, setSaved] = useState(true);
  const [leftTab, setLeftTab] = useState<RailTab>("elements");
  const [previewWidth, setPreviewWidth] = useState<PreviewWidth>("mobile");
  const [previewMode, setPreviewMode] = useState(false);
  const [draggingType, setDraggingType] = useState<BlockType | null>(null);
  const [notification, setNotification] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<UndoSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<UndoSnapshot[]>([]);
  const [uploadedAssets, setUploadedAssets] = useState<MediaAsset[]>([]);
  const [uploadStatus, setUploadStatus] = useState<string | undefined>();
  const [uploadClientError, setUploadClientError] = useState<string | undefined>();
  const pendingUploadTarget = useRef<AssetTarget | null>(null);
  const uploadPollAttempts = useRef(0);
  const [rewriteState, setRewriteState] = useState<RewriteState>({ loading: null, preview: null });

  const selectedBlock = blocks.find((b) => b.id === selectedBlockId) ?? null;
  const selectedIdx = selectedBlock ? blocks.findIndex((b) => b.id === selectedBlock.id) : -1;

  const shopifyFilesWithUploads = useMemo(() => [...uploadedAssets, ...shopifyFiles], [uploadedAssets, shopifyFiles]);

  const snapshotDraft = useCallback((): EditorDraft => ({ blocks, style, applySeries }), [blocks, style, applySeries]);
  const hydrateDraft = (draft: EditorDraft) => { setBlocks(draft.blocks); setStyle(draft.style); setApplySeries(draft.applySeries); };
  const markChanged = () => { dirtyEmails.current.add(emailIndex); setSaved(false); };

  const recordChange = (nextBlocks?: Block[], nextStyle?: EmailStyle) => {
    setUndoStack((current) => [...current.slice(-29), { blocks, selectedBlockId, style }]);
    setRedoStack([]);
    if (nextBlocks) setBlocks(nextBlocks);
    if (nextStyle) setStyle(nextStyle);
    markChanged();
  };

  const updateSelectedBlock = (patch: Partial<BlockData>) => {
    if (!selectedBlock) return;
    recordChange(blocks.map((b) => (b.id === selectedBlock.id ? { ...b, data: { ...b.data, ...patch } } : b)));
  };

  const undo = () => setUndoStack((current) => {
    const previous = current.at(-1);
    if (!previous) return current;
    setRedoStack((redo) => [...redo, { blocks, selectedBlockId, style }]);
    setBlocks(previous.blocks); setSelectedBlockId(previous.selectedBlockId); setStyle(previous.style);
    markChanged();
    return current.slice(0, -1);
  });
  const redo = () => setRedoStack((current) => {
    const next = current.at(-1);
    if (!next) return current;
    setUndoStack((undoHistory) => [...undoHistory, { blocks, selectedBlockId, style }]);
    setBlocks(next.blocks); setSelectedBlockId(next.selectedBlockId); setStyle(next.style);
    markChanged();
    return current.slice(0, -1);
  });

  const selectEmail = (nextIndex: number) => {
    if (nextIndex === emailIndex) return;
    draftCache.current[emailIndex] = snapshotDraft();
    setEmailIndex(nextIndex);
    setSelectedBlockId(null);
    setUndoStack([]); setRedoStack([]);
    hydrateDraft(draftCache.current[nextIndex]);
    setSaved(!dirtyEmails.current.has(nextIndex));
  };

  const saveChanges = () => {
    const draft = snapshotDraft();
    draftCache.current[emailIndex] = draft;
    savingEmail.current = emailIndex;
    saveFetcher.submit({ payload: JSON.stringify({ kind: "save-template", ...draft } satisfies SaveRequest) }, { method: "POST", action: `/app/template-editor?look=${look}&flow=${flow}&email=${emailIndex}` });
  };

  useEffect(() => {
    if (!saveFetcher.data) return;
    if (!saveFetcher.data.ok) return;
    const savedEmail = savingEmail.current;
    if (savedEmail !== null) dirtyEmails.current.delete(savedEmail);
    if (savedEmail === emailIndex) setSaved(true);
  }, [saveFetcher.data, emailIndex]);

  // ── Insert / duplicate / hide / delete / reorder ─────────────────────────
  const insertBlockAt = (type: BlockType, index: number) => {
    const nb = makeDefaultBlock(type, look);
    const safeIdx = Math.max(1, Math.min(index, blocks.length - 1));
    recordChange([...blocks.slice(0, safeIdx), nb, ...blocks.slice(safeIdx)]);
    setSelectedBlockId(nb.id);
    setNotification(`${nb.type.replace("-", " ")} added`);
  };
  const addBlockAfterSelection = (type: BlockType) => {
    const insertAt = selectedIdx >= 0 ? selectedIdx + 1 : blocks.length - 1;
    insertBlockAt(type, insertAt);
  };
  const duplicateBlock = () => {
    if (!selectedBlock || selectedIdx < 0) return;
    const nb: Block = { ...selectedBlock, id: uid(), locked: undefined };
    recordChange([...blocks.slice(0, selectedIdx + 1), nb, ...blocks.slice(selectedIdx + 1)]);
    setSelectedBlockId(nb.id);
    setNotification("Block duplicated");
  };
  const hideBlock = () => {
    if (!selectedBlock) return;
    const willHide = !selectedBlock.hidden;
    recordChange(blocks.map((b) => (b.id === selectedBlock.id ? { ...b, hidden: willHide } : b)));
    setNotification(willHide ? "Block hidden" : "Block shown");
  };
  const deleteBlock = () => {
    if (!selectedBlock || selectedBlock.locked) return;
    recordChange(blocks.filter((b) => b.id !== selectedBlock.id));
    setSelectedBlockId(null);
    setNotification("Block deleted — ↶ to undo");
  };
  const moveBlock = (from: number, to: number) => {
    if (blocks[from]?.locked || blocks[to]?.locked) return;
    const next = [...blocks];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    recordChange(next);
  };
  const moveSelectedUp = () => { if (selectedIdx > 1) moveBlock(selectedIdx, selectedIdx - 1); };
  const moveSelectedDown = () => { if (selectedIdx > 0 && selectedIdx < blocks.length - 2) moveBlock(selectedIdx, selectedIdx + 1); };

  const applyBrand = () => {
    recordChange(undefined, BRAND_STYLE[look]);
    setNotification("Brand system applied — ↶ to undo");
  };

  // ── Upload (Shopify staged upload, unchanged flow) ───────────────────────
  const uploadAsset = async (file: File, target: AssetTarget) => {
    const allowed = ["image/jpeg", "image/png", "image/gif"];
    const maximumBytes = target === "logo" ? 5 * 1024 * 1024 : 20 * 1024 * 1024;
    if (!allowed.includes(file.type)) { setUploadClientError("This file type is not supported. Choose a JPG, PNG, or GIF image."); return; }
    if (file.size > maximumBytes) { setUploadClientError(`This ${target === "logo" ? "logo" : "image"} is bigger than the ${target === "logo" ? "5" : "20"} MB limit, so it was not uploaded.`); return; }
    uploadPollAttempts.current = 0;
    pendingUploadTarget.current = target;
    setUploadClientError(undefined);
    setUploadStatus(`Uploading ${target === "logo" ? "logo" : "image"} to Shopify…`);
    const data = new FormData();
    data.append("intent", "upload-media");
    data.append("target", target);
    data.append("file", file);
    uploadFetcher.submit(data, { method: "POST", encType: "multipart/form-data", action: `/app/template-editor?look=${look}&flow=${flow}&email=${emailIndex}` });
  };

  useEffect(() => {
    const result = uploadFetcher.data;
    if (!result) return;
    if (!result.ok) { setUploadStatus(undefined); pendingUploadTarget.current = null; return; }
    if ("asset" in result && result.asset) {
      const asset = result.asset;
      setUploadedAssets((current) => (current.some((a) => a.id === asset.id) ? current : [asset, ...current]));
      const target = pendingUploadTarget.current;
      if (target && selectedBlock) {
        if (target === "hero") updateSelectedBlock({ src: asset.url, alt: asset.alt, imageSource: "upload" });
        else updateSelectedBlock({ logoSrc: asset.url, logoAlt: asset.alt, logoSource: "upload" });
      }
      pendingUploadTarget.current = null;
      setUploadStatus("Upload complete.");
      return;
    }
    if ("processing" in result && result.processing && "fileId" in result) {
      if (uploadPollAttempts.current >= 15) { setUploadStatus(undefined); setUploadClientError("Shopify is taking longer than expected. Try again in a moment."); return; }
      uploadPollAttempts.current += 1;
      setUploadStatus("Shopify is preparing the image…");
      const timer = window.setTimeout(() => uploadFetcher.submit({ intent: "media-status", id: result.fileId }, { method: "POST", action: `/app/template-editor?look=${look}&flow=${flow}&email=${emailIndex}` }), 1000);
      return () => window.clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadFetcher.data]);

  // ── Rewrite with Nomi ─────────────────────────────────────────────────────
  const requestRewrite = (style: RewriteStyle) => {
    if (!selectedBlock) return;
    setRewriteState({ loading: style, preview: null });
    rewriteFetcher.submit({ intent: "rewrite-copy", headline: selectedBlock.data.headline || "", body: selectedBlock.data.body || "", style }, { method: "POST", action: `/app/template-editor?look=${look}&flow=${flow}&email=${emailIndex}` });
  };
  useEffect(() => {
    const result = rewriteFetcher.data;
    if (!result || rewriteFetcher.state !== "idle") return;
    if (!result.ok) { setRewriteState({ loading: null, preview: null, error: result.error }); return; }
    if ("rewrite" in result && result.rewrite) setRewriteState({ loading: null, preview: result.rewrite });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rewriteFetcher.data, rewriteFetcher.state]);
  const applyRewrite = () => {
    if (!rewriteState.preview) return;
    updateSelectedBlock({ headline: rewriteState.preview.headline, body: rewriteState.preview.body });
    setRewriteState({ loading: null, preview: null });
    setNotification("Rewrite applied — ↶ to undo");
  };
  const discardRewrite = () => setRewriteState({ loading: null, preview: null });
  useEffect(() => setRewriteState({ loading: null, preview: null }), [selectedBlockId]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      const target = e.target as HTMLElement;
      const typing = target.matches("input,textarea,select");
      if (meta && e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      if (meta && (e.key === "y" || (e.key === "z" && e.shiftKey))) { e.preventDefault(); redo(); }
      if (meta && e.key === "s") { e.preventDefault(); saveChanges(); }
      if (e.key === "Escape" && !typing) setSelectedBlockId(null);
      if ((e.key === "Delete" || e.key === "Backspace") && selectedBlockId && !typing) deleteBlock();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBlockId, blocks, undoStack, redoStack]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirtyEmails.current.size > 0) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const saveState: SaveState = saveFetcher.state !== "idle" ? "saving" : saveFetcher.data && !saveFetcher.data.ok ? "save-failed" : dirtyEmails.current.size > 0 || !saved ? "unsaved" : "saved";
  const uploadState: UploadState = { uploading: uploadFetcher.state !== "idle", error: uploadClientError || (uploadFetcher.state === "idle" && uploadFetcher.data && !uploadFetcher.data.ok ? uploadFetcher.data.error : undefined), status: uploadStatus };

  if (previewMode) {
    return <PreviewScreen lookName={lookName} flow={flow} emails={emails} emailIndex={emailIndex} blocks={blocks} style={style} onSelectEmail={selectEmail} onExit={() => setPreviewMode(false)} />;
  }

  return <main className="v9-editor">
    <TopBar look={look} flow={flow} emails={emails} emailIndex={emailIndex} saveState={saveState} canUndo={undoStack.length > 0} canRedo={redoStack.length > 0} previewMode={previewMode}
      onSelectEmail={selectEmail} onUndo={undo} onRedo={redo} onPreview={() => setPreviewMode(true)} onSave={saveChanges} />
    <div className="v9-workspace">
      <LeftPanel tab={leftTab} style={style} draggingType={draggingType}
        onTabChange={setLeftTab} onDragStart={setDraggingType} onDragEnd={() => setDraggingType(null)}
        onClickAdd={addBlockAfterSelection} onStyleChange={(patch) => recordChange(undefined, { ...style, ...patch })} onApplyBrand={applyBrand} />
      <WorkbenchArea emailName={emails[emailIndex]} blocks={blocks} style={style} selectedBlockId={selectedBlockId} previewWidth={previewWidth} draggingType={draggingType}
        onSelectBlock={setSelectedBlockId} onInsertBlock={(index) => { if (draggingType) insertBlockAt(draggingType, index); setDraggingType(null); }} onPreviewWidthChange={setPreviewWidth} />
      <ContextualEditor block={selectedBlock} isFirst={selectedIdx <= 1} isLast={selectedIdx >= blocks.length - 2} look={look} shopifyFiles={shopifyFilesWithUploads} productMedia={productMedia} catalogProducts={catalogProducts}
        uploadState={uploadState} onUpload={uploadAsset} rewriteState={rewriteState} onRewrite={requestRewrite} onApplyRewrite={applyRewrite} onDiscardRewrite={discardRewrite}
        onUpdate={updateSelectedBlock} onDuplicate={duplicateBlock} onHide={hideBlock} onDelete={deleteBlock} onMoveUp={moveSelectedUp} onMoveDown={moveSelectedDown} />
    </div>
    {mediaError ? <p className="v9-media-error" role="status">Shopify media library: {mediaError}</p> : null}
    {notification ? <Toast message={notification} onDone={() => setNotification(null)} /> : null}
  </main>;
}
