import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { brandEvidenceSchema, type BrandEvidence } from "../brand-studio/types";

const MAX_HTML_BYTES = 1_000_000;
const FETCH_TIMEOUT_MS = 12_000;

function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const [first, second] = address.split(".").map(Number);
    return first === 0 || first === 10 || first === 127 || first === 169 && second === 254 ||
      first === 172 && second >= 16 && second <= 31 || first === 192 && second === 168 ||
      first >= 224;
  }
  if (version === 6) {
    const lower = address.toLowerCase();
    return lower === "::1" || lower === "::" || lower.startsWith("fc") || lower.startsWith("fd") ||
      lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb") ||
      lower.startsWith("::ffff:127.") || lower.startsWith("::ffff:10.") || lower.startsWith("::ffff:192.168.");
  }
  return true;
}

async function assertPublicUrl(url: URL) {
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Use a public http or https website URL.");
  }
  if (url.username || url.password || url.port && !["80", "443"].includes(url.port)) {
    throw new Error("Use a normal public storefront URL without a custom port or credentials.");
  }
  if (isIP(url.hostname)) {
    if (isPrivateAddress(url.hostname)) throw new Error("That address is not a public website.");
    return;
  }
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error("That address is not a public website.");
  }
}

// fetch() throws a bare `TypeError: fetch failed` for any low-level network
// problem (DNS hiccup, TLS reset, a transient block from the storefront's
// bot-protection). Left uncaught, that raw message reaches the merchant
// verbatim and explains nothing. One retry absorbs a one-off blip; the
// caught error is turned into something the merchant can actually act on.
async function requestOnce(url: URL): Promise<Response> {
  return fetch(url, {
    redirect: "manual",
    headers: { "User-Agent": "Nomi Email Lab/1.0 (+https://nomi.app)" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
}

async function requestWithRetry(url: URL): Promise<Response> {
  try {
    return await requestOnce(url);
  } catch {
    try {
      return await requestOnce(url);
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      throw new Error(timedOut
        ? "That website took too long to respond. Try again."
        : "Nomi could not reach that website. Check the URL and try again.");
    }
  }
}

async function fetchStorefront(start: URL): Promise<{ url: URL; html: string }> {
  let url = start;
  for (let redirectCount = 0; redirectCount < 4; redirectCount += 1) {
    await assertPublicUrl(url);
    const response = await requestWithRetry(url);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("The website redirected without a destination.");
      url = new URL(location, url);
      continue;
    }
    if (!response.ok) throw new Error(`The website could not be read (${response.status}).`);
    if (!response.headers.get("content-type")?.toLowerCase().includes("text/html")) {
      throw new Error("That URL did not return a webpage.");
    }
    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > MAX_HTML_BYTES) throw new Error("That storefront page is too large to analyze.");
    const html = (await response.text()).slice(0, MAX_HTML_BYTES);
    return { url, html };
  }
  throw new Error("That website redirected too many times.");
}

function decode(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function stripHtml(html: string): string {
  return decode(html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim())
    .slice(0, 39_500);
}

function metaContent(html: string, names: string[]): string | null {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const nameMatch = tag.match(/(?:name|property)\s*=\s*["']?([^"'\s>]+)/i);
    if (!nameMatch || !names.includes(nameMatch[1].toLowerCase())) continue;
    const contentMatch = tag.match(/content\s*=\s*["']([^"']*)["']/i) ?? tag.match(/content\s*=\s*([^\s>]+)/i);
    if (contentMatch?.[1]?.trim()) return decode(contentMatch[1].trim());
  }
  return null;
}

function titleFromHtml(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1] ? decode(match[1].replace(/\s+/g, " ").trim()) : null;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function collectProducts(value: unknown, result: JsonRecord[]) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectProducts(item, result));
    return;
  }
  if (!isRecord(value)) return;
  const kind = value["@type"];
  if (kind === "Product" || Array.isArray(kind) && kind.includes("Product")) result.push(value);
  Object.values(value).forEach((item) => collectProducts(item, result));
}

function jsonLdProducts(html: string, baseUrl: URL): BrandEvidence["products"] {
  const scripts = html.match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) ?? [];
  const candidates: JsonRecord[] = [];
  for (const script of scripts) {
    const raw = script.replace(/^<script\b[^>]*>/i, "").replace(/<\/script>$/i, "").trim();
    try { collectProducts(JSON.parse(raw), candidates); } catch { /* third-party JSON-LD is often malformed */ }
  }
  const seen = new Set<string>();
  return candidates.flatMap((product, index) => {
    const title = typeof product.name === "string" ? product.name.trim() : "";
    if (!title || seen.has(title.toLowerCase())) return [];
    seen.add(title.toLowerCase());
    const image = Array.isArray(product.image) ? product.image[0] : product.image;
    const rawUrl = typeof product.url === "string" ? product.url : null;
    const offers = isRecord(product.offers) ? product.offers : Array.isArray(product.offers) && isRecord(product.offers[0]) ? product.offers[0] : null;
    const description = typeof product.description === "string" ? stripHtml(product.description) : "";
    const category = typeof product.category === "string" ? product.category : "";
    const brand = isRecord(product.brand) && typeof product.brand.name === "string" ? product.brand.name : "";
    const absolute = (value: unknown) => {
      if (typeof value !== "string") return null;
      try { return new URL(value, baseUrl).href; } catch { return null; }
    };
    return [{
      id: `website-product-${index + 1}`,
      title: title.slice(0, 200),
      description: description.slice(0, 2_000),
      productType: category.slice(0, 120),
      vendor: brand.slice(0, 120),
      tags: [],
      imageUrl: absolute(image),
      productUrl: absolute(rawUrl),
      price: offers && typeof offers.price === "string" ? offers.price.slice(0, 40) : typeof offers?.price === "number" ? String(offers.price) : null,
    }];
  }).slice(0, 12);
}

function absoluteUrl(value: unknown, baseUrl: URL) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim(), baseUrl);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

function attributes(tag: string): Record<string, string> {
  return Object.fromEntries([...tag.matchAll(/([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)]
    .map(([, name, quoted, singleQuoted, bare]) => [name.toLowerCase(), decode(quoted ?? singleQuoted ?? bare ?? "")]));
}

function storefrontLogo(html: string, baseUrl: URL) {
  const images: Array<Record<string, string> & { tag: string }> = (html.match(/<img\b[^>]*>/gi) ?? []).map((tag) => ({ tag, ...attributes(tag) }));
  // A decorative footer asset (e.g. a divider illustration) can carry "logo"
  // in its alt text too. Excluding footer-scoped matches keeps this from
  // picking an illustration over the real header wordmark — or over nothing,
  // when the site's logo is inline SVG/text and has no image URL at all.
  const logo = images.find((image) => {
    const haystack = `${image.class ?? ""} ${image.id ?? ""} ${image.alt ?? ""} ${image.src ?? ""}`;
    return /logo|wordmark|brand-mark/i.test(haystack) && !/footer/i.test(haystack);
  });
  return absoluteUrl(logo?.src ?? logo?.["data-src"] ?? metaContent(html, ["og:logo"]), baseUrl);
}

// Cloudflare's email obfuscation swaps a real mailto for a data-cfemail hex
// blob and renders a literal "[email protected]" placeholder for anyone (or
// anything) that doesn't run its decoder script. Left alone, that placeholder
// string gets scraped as if it were the shop's real contact email. The cipher
// is a one-byte XOR keyed on the hex blob's first byte — decode it so the
// evidence carries the actual address instead of a decoy.
function decodeCloudflareEmail(hex: string): string | null {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0 || hex.length < 4) return null;
  const bytes = hex.match(/.{2}/g)!.map((byte) => Number.parseInt(byte, 16));
  const key = bytes[0];
  const decoded = bytes.slice(1).map((byte) => String.fromCharCode(byte ^ key)).join("");
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(decoded) ? decoded : null;
}

function decodeObfuscatedEmails(html: string): string {
  return html.replace(/<([a-z][a-z0-9]*)\b[^>]*\sdata-cfemail="([0-9a-f]+)"[^>]*>[\s\S]*?<\/\1>/gi, (match, _tag, hex) => {
    return decodeCloudflareEmail(hex) ?? match;
  });
}

function hexToRgb(color: string) {
  const [r, g, b] = color.match(/[\da-f]{2}/gi)!.map((channel) => Number.parseInt(channel, 16));
  return [r, g, b] as const;
}

function colorDistance(left: string, right: string) {
  const [lr, lg, lb] = hexToRgb(left);
  const [rr, rg, rb] = hexToRgb(right);
  return Math.sqrt((lr - rr) ** 2 + (lg - rg) ** 2 + (lb - rb) ** 2);
}

// A real stylesheet rarely repeats one exact brand hex — nav text, body copy,
// and borders are typically each a slightly different near-black shade (e.g.
// #231f20, #1e1e19, #252525). Ranked by raw hex frequency those near-duplicate
// neutrals split the count between themselves and can each out-rank a site's
// actual signature accent colour, which is used sparingly by design (that's
// what makes it an accent). Clustering perceptually close colours together
// before ranking credits the neutral family as a whole without letting it
// crowd every slot, so a true accent can still surface in the top 4.
const CLUSTER_DISTANCE = 24;

export function observedColors(markup: string) {
  const frequency = new Map<string, number>();
  for (const [color] of markup.matchAll(/#[0-9a-f]{6}\b/gi)) {
    const normalized = color.toLowerCase();
    frequency.set(normalized, (frequency.get(normalized) ?? 0) + 1);
  }
  // Source order is not design priority: a single embedded widget can put its
  // neon or support colour before the store's repeated brand tokens. Ranking
  // by repeated public use makes the evidence reflect the rendered store.
  const ranked = [...frequency.entries()]
    .sort(([leftColor, leftCount], [rightColor, rightCount]) => rightCount - leftCount || leftColor.localeCompare(rightColor));
  const clusters: Array<{ representative: string; total: number }> = [];
  for (const [color, count] of ranked) {
    const cluster = clusters.find(({ representative }) => colorDistance(representative, color) <= CLUSTER_DISTANCE);
    if (cluster) cluster.total += count;
    else clusters.push({ representative: color, total: count });
  }
  return clusters
    .sort((left, right) => right.total - left.total || left.representative.localeCompare(right.representative))
    .slice(0, 4)
    .map(({ representative }) => representative);
}

function fontHints(markup: string) {
  const hints = new Set<string>();
  for (const [, raw] of markup.matchAll(/font-family\s*:\s*([^;"}]+)/gi)) {
    const font = raw.split(",")[0]?.trim().replace(/["']/g, "");
    if (font && !/inherit|sans-serif|serif|system-ui|ui-|var\(|judgeme/i.test(font)) hints.add(font.slice(0, 100));
  }
  for (const [, raw] of markup.matchAll(/[?&]family=([^:&"']+)/gi)) {
    const font = decode(raw.replace(/\+/g, " ")).trim();
    if (font) hints.add(font.slice(0, 100));
  }
  return [...hints].slice(0, 6);
}

// A bare `<link rel="preconnect" href="https://fonts.googleapis.com">` hint
// matches the old "fonts.googleapis.com" substring check without ever being a
// real stylesheet — it fetches to an empty response and burns one of the few
// slots below. Only a genuine Google Fonts CSS request lives under /css.
const REAL_GOOGLE_FONTS_CSS = /fonts\.googleapis\.com\/css/i;

// Third-party widget CSS (icon fonts, phone-input pickers, cookie banners,
// review widgets) commonly appears earlier in a page's <link> order than the
// store's own theme stylesheet, so taking the first few matches in source
// order can starve the scan of the one file that actually carries the brand's
// colors and fonts — confirmed against a live storefront where the app's own
// bundled stylesheet was 4th in source order, behind fontawesome and a phone
// number input widget, and got excluded entirely by a fixed slice(0, 3).
const KNOWN_VENDOR_CSS = /font-?awesome|intl-tel-input|cookieconsent|klaviyo|judge\.?me|yotpo|recaptcha|trustpilot/i;

function stylesheetPriority(href: string, baseUrl: URL): number {
  if (KNOWN_VENDOR_CSS.test(href)) return 3;
  let hostname: string;
  try { hostname = new URL(href).hostname; } catch { return 3; }
  if (hostname === baseUrl.hostname) return 0;
  if (/cdn\.shopify\.com$|(?:^|\.)myshopify\.com$/i.test(hostname) || /\/cdn\/shop\//i.test(href)) return 0;
  if (REAL_GOOGLE_FONTS_CSS.test(href)) return 1;
  return 2;
}

async function fetchBrandStyles(html: string, baseUrl: URL) {
  const hrefs = [...html.matchAll(/<link\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi)]
    .map(([, href]) => absoluteUrl(href, baseUrl))
    .filter((href): href is string => Boolean(href))
    .filter((href) => /\.css(?:\?|$)/i.test(href) || REAL_GOOGLE_FONTS_CSS.test(href))
    .sort((left, right) => stylesheetPriority(left, baseUrl) - stylesheetPriority(right, baseUrl))
    .slice(0, 5);
  const styles = await Promise.all(hrefs.map(async (href) => {
    try {
      const url = new URL(href);
      await assertPublicUrl(url);
      const response = await fetch(url, { headers: { "User-Agent": "Nomi Email Lab/1.0 (+https://nomi.app)" }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!response.ok) return "";
      return (await response.text()).slice(0, 120_000);
    } catch {
      return "";
    }
  }));
  return styles.join("\n");
}

function shopifyProductRows(value: unknown, baseUrl: URL): BrandEvidence["products"] {
  if (!isRecord(value) || !Array.isArray(value.products)) return [];
  return value.products.flatMap((product, index) => {
    if (!isRecord(product) || typeof product.title !== "string" || !product.title.trim() || /^\d+$/.test(product.title.trim())) return [];
    const firstImage = Array.isArray(product.images) && isRecord(product.images[0]) ? product.images[0] : null;
    const firstVariant = Array.isArray(product.variants) && isRecord(product.variants[0]) ? product.variants[0] : null;
    const handle = typeof product.handle === "string" ? product.handle : "";
    return [{
      id: `website-product-shopify-${index + 1}`,
      title: product.title.trim().slice(0, 200),
      description: typeof product.body_html === "string" ? stripHtml(product.body_html).slice(0, 2_000) : "",
      productType: typeof product.product_type === "string" ? product.product_type.slice(0, 120) : "",
      vendor: typeof product.vendor === "string" ? product.vendor.slice(0, 120) : "",
      tags: typeof product.tags === "string" ? product.tags.split(",").map((tag) => tag.trim()).filter(Boolean).slice(0, 20) : [],
      imageUrl: absoluteUrl(firstImage?.src, baseUrl),
      productUrl: handle ? new URL(`/products/${handle}`, baseUrl).href : null,
      price: typeof firstVariant?.price === "string" ? firstVariant.price.slice(0, 40) : null,
    }];
  });
}

async function shopifyProducts(baseUrl: URL) {
  try {
    const url = new URL("/products.json?limit=12", baseUrl);
    await assertPublicUrl(url);
    const response = await fetch(url, { headers: { "User-Agent": "Nomi Email Lab/1.0 (+https://nomi.app)" }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) return [];
    const payload = JSON.parse((await response.text()).slice(0, 900_000));
    return shopifyProductRows(payload, baseUrl);
  } catch {
    return [];
  }
}

function firstImageUrl(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (isRecord(value)) {
    return typeof value.url === "string" ? value.url : typeof value.src === "string" ? value.src : null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const image = firstImageUrl(item);
      if (image) return image;
    }
  }
  return null;
}

function priceFromProduct(value: JsonRecord): string | null {
  if (typeof value.price === "string" || typeof value.price === "number") return String(value.price).slice(0, 40);
  if (!isRecord(value.price)) return null;
  const effective = isRecord(value.price.effective) ? value.price.effective : value.price;
  const amount = effective.min ?? effective.max ?? effective.value;
  const symbol = typeof effective.currency_symbol === "string" ? effective.currency_symbol : "";
  return typeof amount === "number" || typeof amount === "string" ? `${symbol}${amount}`.slice(0, 40) : null;
}

function embeddedProductRows(html: string, baseUrl: URL): BrandEvidence["products"] {
  const states = [...html.matchAll(/window\.__INITIAL_STATE__\s*=\s*([\s\S]*?);\s*(?=(?:\(function|<\/script))/gi)]
    .flatMap(([, raw]) => {
      try { return [JSON.parse(raw)]; } catch { return []; }
    });
  const candidates: JsonRecord[] = [];
  const seen = new WeakSet<object>();
  const visit = (value: unknown, depth = 0) => {
    if (depth > 18 || !value || typeof value !== "object") return;
    if (seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, depth + 1));
      return;
    }
    if (!isRecord(value)) return;
    const title = typeof value.name === "string" ? value.name.trim() : typeof value.title === "string" ? value.title.trim() : "";
    const hasProductRoute = typeof value.slug === "string" || typeof value.product_url === "string" ||
      typeof value.url === "string" && /\/product\//i.test(value.url);
    const hasMerchImage = Boolean(firstImageUrl(value.medias) ?? firstImageUrl(value.images) ?? firstImageUrl(value.image) ?? firstImageUrl(value.image_url));
    if (title && hasProductRoute && hasMerchImage) candidates.push(value);
    Object.values(value).forEach((item) => visit(item, depth + 1));
  };
  states.forEach((state) => visit(state));

  const byTitle = new Set<string>();
  return candidates.flatMap((product, index) => {
    const title = (typeof product.name === "string" ? product.name : product.title as string).trim();
    const key = title.toLowerCase();
    if (!title || /^\d+$/.test(title) || byTitle.has(key)) return [];
    byTitle.add(key);
    const rawUrl = typeof product.product_url === "string" ? product.product_url
      : typeof product.url === "string" ? product.url
      : typeof product.slug === "string" ? `/product/${product.slug}` : null;
    const attributes = isRecord(product.attributes) ? product.attributes : {};
    const category = typeof product.product_type === "string" ? product.product_type
      : Array.isArray(product.categories) && isRecord(product.categories[0]) && typeof product.categories[0].name === "string" ? product.categories[0].name
      : "";
    const brand = typeof product.brand === "string" ? product.brand : isRecord(product.brand) && typeof product.brand.name === "string" ? product.brand.name : "";
    const description = typeof product.description === "string" ? product.description
      : typeof attributes.product_details === "string" ? attributes.product_details : "";
    return [{
      id: `website-product-embedded-${index + 1}`,
      title: title.slice(0, 200),
      description: stripHtml(description).slice(0, 2_000),
      productType: category.slice(0, 120),
      vendor: brand.slice(0, 120),
      tags: [],
      imageUrl: absoluteUrl(firstImageUrl(product.medias) ?? firstImageUrl(product.images) ?? firstImageUrl(product.image) ?? firstImageUrl(product.image_url), baseUrl),
      productUrl: absoluteUrl(rawUrl, baseUrl),
      price: priceFromProduct(product),
    }];
  }).slice(0, 12);
}

function htmlProductRows(html: string, baseUrl: URL): BrandEvidence["products"] {
  const seen = new Set<string>();
  const cards = [...html.matchAll(/<a\b([^>]*)>([\s\S]{0,40_000}?)<\/a>/gi)];
  return cards.flatMap(([full, anchorAttributes, content], index) => {
    const href = attributes(`<a ${anchorAttributes}>`).href;
    const productUrl = absoluteUrl(href, baseUrl);
    if (!productUrl || !/\/(?:products?|shop|item|p)\//i.test(new URL(productUrl).pathname)) return [];
    const imageTag = content.match(/<img\b[^>]*>/i)?.[0];
    if (!imageTag) return [];
    const image = attributes(imageTag);
    const imageUrl = absoluteUrl(image.src ?? image["data-src"] ?? image["data-original"] ?? image["data-lazy-src"], baseUrl);
    const title = (image.alt ?? stripHtml(content)).replace(/\s+/g, " ").trim();
    const key = title.toLowerCase();
    if (!imageUrl || title.length < 3 || title.length > 200 || seen.has(key)) return [];
    seen.add(key);
    const price = stripHtml(content).match(/[₹$€£]\s?[\d,]+(?:\.\d{2})?/)?.[0] ?? null;
    return [{
      id: `website-product-html-${index + 1}`,
      title,
      description: "",
      productType: "",
      vendor: "",
      tags: [],
      imageUrl,
      productUrl,
      price,
    }];
  }).slice(0, 12);
}

function collectionFallbackUrl(html: string, baseUrl: URL): URL | null {
  const hrefs = [...html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi)].map(([, href]) => absoluteUrl(href, baseUrl));
  for (const href of hrefs) {
    if (!href) continue;
    const url = new URL(href);
    if (url.origin === baseUrl.origin && /^\/collection\/[\w-]+/i.test(url.pathname)) return url;
  }
  return null;
}

function mergeProducts(...lists: BrandEvidence["products"][]) {
  const byTitle = new Map<string, BrandEvidence["products"][number]>();
  for (const product of lists.flat()) {
    const key = product.title.toLowerCase();
    const current = byTitle.get(key);
    byTitle.set(key, current ? { ...current, imageUrl: current.imageUrl ?? product.imageUrl, productUrl: current.productUrl ?? product.productUrl, price: current.price ?? product.price } : product);
  }
  return [...byTitle.values()].slice(0, 12);
}

export async function collectWebsiteEvidence(input: string): Promise<BrandEvidence> {
  let requested: URL;
  try { requested = new URL(input.trim()); } catch { throw new Error("Paste a full website URL, for example https://yourstore.com."); }
  const { url, html: rawHtml } = await fetchStorefront(requested);
  const html = decodeObfuscatedEmails(rawHtml);
  const siteName = metaContent(html, ["og:site_name", "twitter:title"])
    ?? titleFromHtml(html)?.split(/[|–—-]/)[0]?.trim()
    ?? url.hostname.replace(/^www\./, "");
  const description = metaContent(html, ["description", "og:description", "twitter:description"]);
  const [css, shopifyRows] = await Promise.all([fetchBrandStyles(html, url), shopifyProducts(url)]);
  const embeddedRows = embeddedProductRows(html, url);
  const htmlRows = htmlProductRows(html, url);
  let fallbackRows: BrandEvidence["products"] = [];
  if (!shopifyRows.length && !embeddedRows.length && !htmlRows.length) {
    const collectionUrl = collectionFallbackUrl(html, url);
    if (collectionUrl) {
      try {
        const fallback = await fetchStorefront(collectionUrl);
        fallbackRows = embeddedProductRows(fallback.html, fallback.url);
      } catch { /* the original page still provides valid brand evidence */ }
    }
  }
  const text = [description, stripHtml(html)].filter(Boolean).join("\n\n").slice(0, 40_000);
  if (text.length < 80) throw new Error("Nomi could not find enough public storefront copy on that page.");
  return brandEvidenceSchema.parse({
    shopName: siteName.slice(0, 120),
    storefrontUrl: url.href,
    storefrontText: text,
    products: mergeProducts(jsonLdProducts(html, url), shopifyRows, embeddedRows, htmlRows, fallbackRows),
    assets: {
      logoUrl: storefrontLogo(html, url),
      observedColors: observedColors(`${html}\n${css}`),
      fontHints: fontHints(`${html}\n${css}`),
    },
  });
}
