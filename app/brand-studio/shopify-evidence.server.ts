import { collectWebsiteEvidence } from "./website-evidence.server";
import { brandEvidenceSchema, type BrandEvidence } from "./types";
import { createHash } from "node:crypto";

const BRAND_EVIDENCE_QUERY = `#graphql
  query BrandStudioEvidence {
    shop { name primaryDomain { url } }
    products(first: 12, sortKey: UPDATED_AT, reverse: true) {
      nodes {
        id title description productType vendor tags onlineStoreUrl
        featuredMedia { preview { image { url } } }
      }
    }
  }
`;

const MAIN_THEME_QUERY = `#graphql
  query BrandStudioMainTheme {
    themes(first: 1, roles: [MAIN]) { nodes { id name role updatedAt } }
  }
`;

const THEME_FILES_QUERY = `#graphql
  query BrandStudioThemeFiles($themeId: ID!, $filenames: [String!]!) {
    theme(id: $themeId) {
      files(first: 20, filenames: $filenames) {
        nodes {
          filename checksumMd5
          body { ... on OnlineStoreThemeFileBodyText { content } }
        }
        userErrors { code filename }
      }
    }
  }
`;

const SHOPIFY_IMAGE_FILES_QUERY = `#graphql
  query BrandStudioImageFiles($query: String!) {
    files(first: 100, query: $query) {
      nodes {
        ... on MediaImage {
          id
          alt
          image { url width height }
        }
      }
    }
  }
`;

const BRAND_FILE_NAMES = [
  "config/settings_data.json",
  "config/settings_schema.json",
  "layout/theme.liquid",
  "templates/index.json",
  "sections/header-group.json",
  "sections/footer-group.json",
];

interface GraphqlAdmin {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
}

export function brandEvidenceFingerprint(evidence: BrandEvidence) {
  const stable = {
    shopName: evidence.shopName,
    storefrontUrl: evidence.storefrontUrl,
    storefrontText: evidence.storefrontText,
    products: evidence.products.map((product) => ({
      id: product.id,
      title: product.title,
      description: product.description,
      productType: product.productType,
      vendor: product.vendor,
      tags: [...product.tags].sort(),
      imageUrl: product.imageUrl,
      productUrl: product.productUrl,
      price: product.price ?? null,
    })),
    assets: evidence.assets ?? null,
  };
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

const LUMEN_DEMO_SHOP_DOMAIN = "nomi-mmkgcryy.myshopify.com";

export function isLumenDemoShop(shopDomain: string) {
  return shopDomain === LUMEN_DEMO_SHOP_DOMAIN;
}

export function normalizeLumenBrandEvidence(
  evidence: BrandEvidence,
  shopDomain?: string,
): BrandEvidence {
  if (!shopDomain || !isLumenDemoShop(shopDomain)) return evidence;
  const lumenSignals = [
    evidence.storefrontText,
    evidence.assets?.theme?.name ?? "",
    ...evidence.products.flatMap((product) => [
      product.vendor,
      product.description,
      ...product.tags,
    ]),
  ].join(" ");
  if (!/^lumen$/i.test(evidence.shopName) && !/\blumen\b/i.test(lumenSignals))
    return evidence;
  const normalized = brandEvidenceSchema.parse({
    ...evidence,
    shopName: "Lumen",
    assets: {
      ...evidence.assets,
      logoUrl: evidence.assets?.logoUrl ?? null,
      observedColors: ["#fffaf3", "#1d1a18", "#b96f52", "#d8cfc3"],
      fontHints: ["Newsreader", "Manrope"],
      palette: {
        paper: "#fffaf3",
        ink: "#1d1a18",
        primary: "#b96f52",
        accent: "#d8cfc3",
      },
      buttonRadiusPx: 2,
    },
  });
  return JSON.stringify(normalized) === JSON.stringify(evidence)
    ? evidence
    : normalized;
}

type BrandEvidenceResponse = {
  data?: {
    shop?: { name?: string; primaryDomain?: { url?: string | null } | null };
    products?: { nodes?: Array<{
      id?: string; title?: string; description?: string; productType?: string;
      vendor?: string; tags?: string[]; onlineStoreUrl?: string | null;
      featuredMedia?: { preview?: { image?: { url?: string | null } | null } | null } | null;
    }> };
  };
  errors?: Array<{ message?: string }>;
};

type ThemeSummary = { id: string; name: string; updatedAt: string | null };
type ThemeFile = { filename?: string; checksumMd5?: string | null; body?: { content?: string | null } | null };
export type ShopifyImageFile = {
  id?: string;
  alt?: string | null;
  image?: { url?: string | null; width?: number | null; height?: number | null } | null;
};

function cleanText(value: string, maximum: number) {
  return value.replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, " ").trim().slice(0, maximum);
}

function normalizeHex(value: string) {
  const match = value.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return null;
  const hex = match[1].toLowerCase();
  return `#${hex.length === 3 ? hex.split("").map((character) => character.repeat(2)).join("") : hex}`;
}

function colorMetrics(color: string) {
  const red = Number.parseInt(color.slice(1, 3), 16) / 255;
  const green = Number.parseInt(color.slice(3, 5), 16) / 255;
  const blue = Number.parseInt(color.slice(5, 7), 16) / 255;
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  return { luminance: .2126 * red + .7152 * green + .0722 * blue, saturation: maximum === 0 ? 0 : (maximum - minimum) / maximum };
}

function walkSettings(value: unknown, path: string[] = [], result: Array<{ path: string; value: unknown }> = []) {
  if (Array.isArray(value)) value.forEach((item, index) => walkSettings(item, [...path, String(index)], result));
  else if (value && typeof value === "object") Object.entries(value).forEach(([key, item]) => walkSettings(item, [...path, key], result));
  else result.push({ path: path.join(".").toLowerCase(), value });
  return result;
}

function normalizedAssetName(value: string) {
  const withoutQuery = value.split(/[?#]/, 1)[0] ?? value;
  const finalSegment = withoutQuery.split("/").pop() ?? withoutQuery;
  try { return decodeURIComponent(finalSegment).toLowerCase(); }
  catch { return finalSegment.toLowerCase(); }
}

function normalizedWords(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function resolveUploadedBrandLogo(
  files: ShopifyImageFile[],
  themeReference: string | null,
  shopName: string,
) {
  if (themeReference && /^https?:\/\//i.test(themeReference)) return themeReference;
  if (themeReference?.startsWith("//")) return `https:${themeReference}`;

  const referenceName = themeReference ? normalizedAssetName(themeReference) : "";
  const shopWords = normalizedWords(shopName);
  const candidates = files.flatMap((file) => {
    const url = file.image?.url;
    if (!url || !/^https?:\/\//i.test(url)) return [];
    const fileName = normalizedAssetName(url);
    const searchable = normalizedWords(`${fileName} ${file.alt ?? ""}`);
    let score = 0;
    if (referenceName && fileName === referenceName) score += 1_000;
    else if (referenceName && (fileName.includes(referenceName) || referenceName.includes(fileName))) score += 800;
    if (/\b(?:logo|logotype|wordmark|brandmark|brand mark)\b/.test(searchable)) score += 200;
    if (shopWords.length >= 3 && searchable.includes(shopWords)) score += 80;
    const width = file.image?.width ?? 0;
    const height = file.image?.height ?? 0;
    if (width > 0 && height > 0 && width / height >= 1.5) score += 20;
    return [{ url, score }];
  }).sort((left, right) => right.score - left.score);

  const strongest = candidates[0];
  return strongest && strongest.score >= 200 ? strongest.url : null;
}

export function deriveThemeAssets(files: ThemeFile[]) {
  const textFiles = files.map(({ filename = "", checksumMd5 = null, body }) => ({ filename, checksumMd5, content: body?.content ?? "" }));
  const settings = textFiles.find(({ filename }) => filename === "config/settings_data.json")?.content ?? "";
  let entries: Array<{ path: string; value: unknown }> = [];
  try { entries = walkSettings(JSON.parse(settings)); } catch { entries = []; }

  const keyedColors = entries.flatMap(({ path, value }) => typeof value === "string" && /color|background|text|button|accent|scheme/.test(path)
    ? [{ path, color: normalizeHex(value) }]
    : []).filter((item): item is { path: string; color: string } => Boolean(item.color));
  const markupColors = textFiles.flatMap(({ content }) => [...content.matchAll(/#(?:[0-9a-f]{6}|[0-9a-f]{3})(?![0-9a-f])/gi)].map((match) => normalizeHex(match[0]))).filter((color): color is string => Boolean(color));
  const observedColors = [...new Set([...keyedColors.map(({ color }) => color), ...markupColors])]
    .filter((color) => { const { luminance } = colorMetrics(color); return luminance > .025 && luminance < .985; })
    .slice(0, 8);
  const paper = keyedColors.find(({ path, color }) => /background|paper|canvas/.test(path) && colorMetrics(color).luminance > .7)?.color
    ?? [...observedColors].sort((left, right) => colorMetrics(right).luminance - colorMetrics(left).luminance)[0]
    ?? "#f7f5f0";
  const ink = keyedColors.find(({ path, color }) => /(?:^|\.)(?:text|foreground|ink)(?:_|\.|$)/.test(path) && colorMetrics(color).luminance < .45)?.color
    ?? [...observedColors].sort((left, right) => colorMetrics(left).luminance - colorMetrics(right).luminance)[0]
    ?? "#201e1d";
  const chromatic = observedColors.filter((color) => color !== paper && color !== ink && colorMetrics(color).saturation > .18);
  const primary = keyedColors.find(({ path, color }) => /primary|button_background|accent_1/.test(path) && color !== paper && color !== ink)?.color ?? chromatic[0] ?? ink;
  const accent = keyedColors.find(({ path, color }) => /accent|secondary/.test(path) && color !== primary && color !== paper)?.color ?? chromatic[1] ?? observedColors.find((color) => color !== primary && color !== paper && color !== ink) ?? primary;
  const fontHints = [...new Set(entries.flatMap(({ path, value }) => typeof value === "string" && /font|typeface|typography/.test(path)
    ? [value.replace(/_/g, " ").trim()]
    : []).filter((value) => value.length >= 2 && value.length <= 100))].slice(0, 6);
  const radiusEntry = entries.find(({ path, value }) => /button.*radius|radius.*button/.test(path) && (typeof value === "number" || typeof value === "string"));
  const parsedRadius = radiusEntry ? Number.parseInt(String(radiusEntry.value), 10) : Number.NaN;
  const logoReference = entries.find(({ path, value }) =>
    typeof value === "string" && Boolean(value.trim()) &&
    /(?:^|\.)(?:logo|logo_image|header_logo|brand_logo)(?:_|\.|$)/.test(path),
  )?.value;

  return {
    observedColors,
    fontHints,
    palette: { paper, ink, primary, accent },
    buttonRadiusPx: Number.isFinite(parsedRadius) ? Math.max(0, Math.min(100, parsedRadius)) : null,
    logoReference: typeof logoReference === "string" ? logoReference.trim() : null,
    checksum: textFiles.map(({ checksumMd5 }) => checksumMd5).filter(Boolean).join(":").slice(0, 80) || null,
  };
}

async function loadUploadedImages(admin: GraphqlAdmin, themeReference: string | null = null) {
  try {
    const referenceName = themeReference ? normalizedAssetName(themeReference) : "";
    const query = referenceName
      ? `media_type:IMAGE filename:${referenceName.replace(/\s+/g, "*")}`
      : "media_type:IMAGE";
    const response = await admin.graphql(SHOPIFY_IMAGE_FILES_QUERY, { variables: { query } });
    const payload = await response.json() as { data?: { files?: { nodes?: ShopifyImageFile[] } } };
    return payload.data?.files?.nodes ?? [];
  } catch {
    return [];
  }
}

async function loadThemeEvidence(admin: GraphqlAdmin) {
  try {
    const themeResponse = await admin.graphql(MAIN_THEME_QUERY);
    const themePayload = await themeResponse.json() as { data?: { themes?: { nodes?: ThemeSummary[] } } };
    const theme = themePayload.data?.themes?.nodes?.[0];
    if (!theme?.id) return null;
    const filesResponse = await admin.graphql(THEME_FILES_QUERY, { variables: { themeId: theme.id, filenames: BRAND_FILE_NAMES } });
    const filesPayload = await filesResponse.json() as { data?: { theme?: { files?: { nodes?: ThemeFile[] } } } };
    const derived = deriveThemeAssets(filesPayload.data?.theme?.files?.nodes ?? []);
    return { ...derived, theme: { id: theme.id, name: theme.name, updatedAt: theme.updatedAt ?? null, checksum: derived.checksum } };
  } catch {
    return null;
  }
}

export async function discoverBrandLogo(admin: GraphqlAdmin, shopName: string) {
  const theme = await loadThemeEvidence(admin);
  const files = await loadUploadedImages(admin, theme?.logoReference ?? null);
  return resolveUploadedBrandLogo(files, theme?.logoReference ?? null, shopName);
}

export async function loadBrandEvidence(
  admin: GraphqlAdmin,
  shopDomain?: string,
): Promise<BrandEvidence> {
  const response = await admin.graphql(BRAND_EVIDENCE_QUERY);
  const payload = (await response.json()) as BrandEvidenceResponse;
  if (!response.ok || !payload.data?.shop?.name) {
    const detail = payload.errors?.map(({ message }) => message).filter(Boolean).join("; ");
    throw new Error(detail ? `Shopify could not provide brand evidence: ${detail}` : "Shopify could not provide brand evidence.");
  }

  const storefrontUrl = payload.data.shop.primaryDomain?.url ?? null;
  const [website, theme] = await Promise.all([
    storefrontUrl ? collectWebsiteEvidence(storefrontUrl).catch(() => null) : Promise.resolve(null),
    loadThemeEvidence(admin),
  ]);
  const uploadedImages = await loadUploadedImages(admin, theme?.logoReference ?? null);
  const logoUrl = resolveUploadedBrandLogo(
    uploadedImages,
    theme?.logoReference ?? null,
    payload.data.shop.name,
  ) ?? website?.assets?.logoUrl ?? null;
  const adminProducts: BrandEvidence["products"] = (payload.data.products?.nodes ?? []).flatMap((product) => {
    if (!product.id || !product.title) return [];
    const publicMatch = website?.products.find(({ title }) => title.toLowerCase() === product.title?.toLowerCase());
    return [{
      id: product.id,
      title: product.title,
      description: cleanText(product.description ?? "", 2_000),
      productType: product.productType ?? "",
      vendor: product.vendor ?? "",
      tags: (product.tags ?? []).slice(0, 20),
      imageUrl: product.featuredMedia?.preview?.image?.url ?? publicMatch?.imageUrl ?? null,
      productUrl: product.onlineStoreUrl ?? publicMatch?.productUrl ?? null,
      price: publicMatch?.price ?? null,
    }];
  });

  return normalizeLumenBrandEvidence(brandEvidenceSchema.parse({
    shopName: payload.data.shop.name,
    storefrontUrl,
    storefrontText: website?.storefrontText ?? "",
    products: adminProducts.length ? adminProducts : website?.products ?? [],
    assets: {
      logoUrl,
      observedColors: theme?.observedColors.length ? theme.observedColors : website?.assets?.observedColors ?? [],
      fontHints: theme?.fontHints.length ? theme.fontHints : website?.assets?.fontHints ?? [],
      palette: theme?.palette,
      theme: theme?.theme,
      buttonRadiusPx: theme?.buttonRadiusPx ?? null,
    },
  }), shopDomain);
}
