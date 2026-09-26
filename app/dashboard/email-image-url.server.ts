// Shopify-CDN image URLs sized for email. Product photos come back from
// Admin GraphQL as the original upload (often a multi-MB PNG), but an email
// never shows one wider than its 600px container. Shopify's CDN resizes and
// re-encodes on the fly from query params, so a 1.3 MB PNG becomes ~40 KB of
// JPEG at 1200px (2× for retina). Lives outside app/email-engine because the
// `width=` / `format=` params are Shopify-specific.

// 2× the 600px email container.
export const EMAIL_IMAGE_WIDTH = 1200;

type Fetch = typeof fetch;

export function isShopifyCdnImage(url: string): boolean {
  try {
    const { protocol, hostname, pathname } = new URL(url);
    if (protocol !== "https:") return false;
    return hostname === "cdn.shopify.com" || pathname.startsWith("/cdn/shop/");
  } catch {
    return false;
  }
}

export function emailImageUrl(url: string, { keepFormat }: { keepFormat: boolean }): string {
  if (!isShopifyCdnImage(url)) return url;
  const parsed = new URL(url);
  parsed.searchParams.set("width", String(EMAIL_IMAGE_WIDTH));
  if (keepFormat) parsed.searchParams.delete("format");
  else parsed.searchParams.set("format", "jpg");
  return parsed.toString();
}

// Reads just the file header to tell whether the image can be transparent.
// JPEG would fill transparent areas with a solid color, so anything that may
// have alpha (or that we can't read) keeps its own format and is only resized.
export async function mayHaveTransparency(url: string, fetchImpl: Fetch = fetch): Promise<boolean> {
  try {
    const response = await fetchImpl(url, { headers: { Range: "bytes=0-63" }, signal: AbortSignal.timeout(3000) });
    if (!response.ok) return true;
    const bytes = new Uint8Array(await response.arrayBuffer()).subarray(0, 64);
    const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return false; // JPEG: never transparent
    if (bytes[0] === 0x89 && ascii(1, 4) === "PNG") {
      const colorType = bytes[25];
      return colorType === 3 || colorType === 4 || colorType === 6; // palette (tRNS), gray+alpha, RGBA
    }
    if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") {
      if (ascii(12, 16) === "VP8L") return true; // lossless: alpha possible, don't guess
      if (ascii(12, 16) === "VP8X") return (bytes[20] & 0x10) !== 0;
      return false; // simple lossy VP8: no alpha
    }
    return true; // GIF, AVIF, unknown: keep format
  } catch {
    return true;
  }
}

const decided = new Map<string, string>();

// Best effort: never throws, and returns non-Shopify URLs unchanged.
// `transparent: true` is for background-removed cutouts, which must stay PNG.
export async function optimizeEmailImageUrl(
  url: string | null | undefined,
  { transparent = false, fetchImpl = fetch }: { transparent?: boolean; fetchImpl?: Fetch } = {},
): Promise<string | null> {
  if (!url) return null;
  if (!isShopifyCdnImage(url)) return url;
  const key = `${transparent ? "t" : "o"}:${url}`;
  const cached = decided.get(key);
  if (cached) return cached;
  const keepFormat = transparent || (await mayHaveTransparency(url, fetchImpl));
  const optimized = emailImageUrl(url, { keepFormat });
  if (decided.size > 2000) decided.clear();
  decided.set(key, optimized);
  return optimized;
}
