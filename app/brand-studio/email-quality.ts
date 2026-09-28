import { needsPersonalSlots } from "../email-engine/personal-slots";
import type { BrandEvidence, BrandSystem, LifecycleRecipe } from "./types";

export type EmailQualityIssue = {
  code: string;
  severity: "error" | "warning";
  message: string;
};

export type EmailQualityReport = {
  status: "ready" | "needs-attention";
  issues: EmailQualityIssue[];
  byteSize: number;
};

export type EmailFamilyQualityReport = {
  status: "ready" | "needs-attention";
  readyCount: number;
  totalCount: number;
  creativeBriefCount: number;
  structureCount: number;
  issues: EmailQualityIssue[];
};

function occurrences(value: string, expression: RegExp) {
  return [...value.matchAll(expression)].length;
}

function issue(
  code: string,
  severity: EmailQualityIssue["severity"],
  message: string,
): EmailQualityIssue {
  return { code, severity, message };
}

function normalized(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function wordCount(value: string) {
  return normalized(value).split(/\s+/).filter(Boolean).length;
}

function structureFingerprint(html: string) {
  return [...html.matchAll(/<(table|tr|td|img|h1|h2|p|a|hr)\b([^>]*)>/gi)]
    .slice(0, 160)
    .map(([, tag, attributes]) => {
      const align = attributes.match(/\balign=["']?([^\s"'>]+)/i)?.[1] ?? "";
      const width = attributes.match(/\bwidth=["']?([^\s"'>]+)/i)?.[1] ?? "";
      const background =
        attributes.match(/\bbgcolor=["']?([^\s"'>]+)/i)?.[1] ?? "";
      return `${tag.toLowerCase()}:${align}:${width}:${background}`;
    })
    .join("|");
}

function isPublicUrl(value: string | null | undefined) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      !["localhost", "127.0.0.1", "::1"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

function canonicalUrl(value: string | null | undefined) {
  if (!isPublicUrl(value)) return null;
  return new URL(value as string).href;
}

const GENERIC_COPY =
  /\b(?:lorem ipsum|placeholder|your store|considered note|made for the days you keep|shop now|click here|must[- ]have|don'?t miss out|hurry)\b/i;

export function auditCompiledEmail(input: {
  html: string;
  recipe: LifecycleRecipe;
  brandSystem?: BrandSystem;
  products?: BrandEvidence["products"];
  storefrontUrl?: string | null;
}): EmailQualityReport {
  const {
    html,
    recipe,
    brandSystem,
    products = [],
    storefrontUrl = null,
  } = input;
  const issues: EmailQualityIssue[] = [];
  const byteSize = new TextEncoder().encode(html).length;
  const imageTags = [...html.matchAll(/<img\b[^>]*>/gi)].map(([tag]) => tag);
  const imageSources = imageTags.map(
    (tag) =>
      tag.match(/\bsrc=["']([^"']+)["']/i)?.[1]?.replace(/&amp;/g, "&") ?? "",
  );
  const links = [
    ...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi),
  ].map(([, href]) => canonicalUrl(href) ?? href);

  if (!/^<!doctype html>/i.test(html.trim()))
    issues.push(
      issue(
        "document",
        "error",
        "The email is missing its HTML document wrapper.",
      ),
    );
  if (!/<meta\s+name=["']viewport["']/i.test(html))
    issues.push(
      issue("viewport", "error", "The mobile viewport declaration is missing."),
    );
  if (!/max-width:\s*600px/i.test(html))
    issues.push(
      issue(
        "width",
        "error",
        "The email is not constrained to the 600px email-safe width.",
      ),
    );
  if (/<(?:script|form|iframe|video|object|embed)\b/i.test(html))
    issues.push(
      issue(
        "unsafe-element",
        "error",
        "The email contains an element that major inboxes block.",
      ),
    );
  if (/<link\b[^>]*rel=["']stylesheet/i.test(html) || /@import\s/i.test(html))
    issues.push(
      issue("external-css", "error", "The email depends on external CSS."),
    );
  if (imageTags.some((tag) => !/\balt=["'][^"']*["']/i.test(tag)))
    issues.push(
      issue(
        "image-alt",
        "error",
        "Every product or logo image needs alt text.",
      ),
    );
  if (imageTags.some((tag) => !/\b(?:width|style)=/i.test(tag)))
    issues.push(
      issue(
        "image-size",
        "warning",
        "An image is missing explicit sizing and may shift while loading.",
      ),
    );
  if (links.some((href) => !isPublicUrl(href)))
    issues.push(
      issue(
        "unsafe-link",
        "error",
        "A link does not use a safe public HTTP destination.",
      ),
    );
  if (links.length > 1)
    issues.push(
      issue(
        "cta-count",
        "warning",
        "The email contains more than one linked action.",
      ),
    );
  if (recipe.productIds.length > 0 && imageTags.length === 0)
    issues.push(
      issue(
        "missing-product-image",
        "warning",
        "This recipe asks for product imagery, but no usable public image was available.",
      ),
    );
  if (links.length === 0)
    issues.push(
      issue(
        "missing-destination",
        "warning",
        "The CTA is shown as text because no real product destination was available.",
      ),
    );
  if (byteSize > 102_400)
    issues.push(
      issue(
        "gmail-clip",
        "error",
        "The compiled email is larger than Gmail's 102KB clipping threshold.",
      ),
    );
  else if (byteSize > 90_000)
    issues.push(
      issue(
        "gmail-clip-near",
        "warning",
        "The email is close to Gmail's clipping threshold.",
      ),
    );
  if (occurrences(html, /<h1\b/gi) !== 1)
    issues.push(
      issue(
        "heading",
        "error",
        "The email must have exactly one primary heading.",
      ),
    );

  if (brandSystem) {
    const copy = `${recipe.subject} ${recipe.preheader} ${recipe.eyebrow} ${recipe.headline} ${recipe.body} ${recipe.ctaLabel}`;
    if (GENERIC_COPY.test(copy) || /[—-]\s*\d+\b/.test(recipe.headline))
      issues.push(
        issue(
          "generic-copy",
          "error",
          "The copy still reads like a placeholder or numbered template.",
        ),
      );
    if (recipe.subject.length > 64)
      issues.push(
        issue(
          "subject-craft",
          "error",
          "The subject must stay within the 64-character inbox limit.",
        ),
      );
    if (normalized(recipe.preheader) === normalized(recipe.subject))
      issues.push(
        issue(
          "preheader-craft",
          "error",
          "The preheader must add a distinct, useful second thought.",
        ),
      );
    else if (recipe.preheader.length < 20)
      issues.push(
        issue(
          "preheader-length",
          "warning",
          "The preheader is unusually short; confirm that the inbox preview still adds useful context.",
        ),
      );
    if (wordCount(recipe.headline) < 2)
      issues.push(
        issue(
          "headline-craft",
          "warning",
          "The headline is a single-word gesture; confirm that it carries enough meaning in the composition.",
        ),
      );
    if (wordCount(recipe.body) < 8)
      issues.push(
        issue(
          "body-craft",
          "warning",
          "The body is intentionally spare; confirm that the visual and surrounding copy still earn the send.",
        ),
      );
    const avoided = brandSystem.voice.avoidWords.find((word) =>
      new RegExp(
        `\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
        "i",
      ).test(copy),
    );
    if (avoided)
      issues.push(
        issue(
          "off-brand-language",
          "error",
          `The copy uses “${avoided}”, which the Brand System says to avoid.`,
        ),
      );
    const renderedPalette = html.toLowerCase();
    const carriesFoundation = [
      brandSystem.palette.paper,
      brandSystem.palette.ink,
    ].every((color) => renderedPalette.includes(color.toLowerCase()));
    const carriesBrandColor = [
      brandSystem.palette.primary,
      brandSystem.palette.accent,
    ].some((color) => renderedPalette.includes(color.toLowerCase()));
    if (!carriesFoundation || !carriesBrandColor)
      issues.push(
        issue(
          "brand-tokens",
          "error",
          "The email needs the approved paper and ink foundation plus a brand color.",
        ),
      );

    // Cart and review emails show a single preview item row (the sender
    // swaps in the customer's own items), so only its product is required.
    const requiredProductIds = needsPersonalSlots(recipe.id)
      ? recipe.productIds
          .filter((id) => isPublicUrl(products.find((product) => product.id === id)?.imageUrl))
          .slice(0, 1)
      : recipe.productIds;
    if (requiredProductIds.length > 0) {
      const selectedProducts = [...new Set(requiredProductIds)]
        .map((id) => products.find((product) => product.id === id))
        .filter((product): product is BrandEvidence["products"][number] =>
          Boolean(product),
        );
      const canonicalImageSources = new Set(
        imageSources
          .map((url) => canonicalUrl(url))
          .filter((url): url is string => Boolean(url)),
      );
      const selectedProductImageUrls = selectedProducts.map(({ imageUrl }) =>
        canonicalUrl(imageUrl),
      );
      const publicProductImages = [
        ...new Set(
          selectedProductImageUrls.filter((url): url is string => Boolean(url)),
        ),
      ];
      const missingProductImages = publicProductImages.filter(
        (url) => !canonicalImageSources.has(url),
      );
      if (
        selectedProducts.length !== new Set(requiredProductIds).size ||
        selectedProductImageUrls.some((url) => !url) ||
        missingProductImages.length > 0
      )
        issues.push(
          issue(
            "a1-product-image",
            "error",
            "An A1 product-led email needs the requested real, public product imagery.",
          ),
        );
      const productDestinations = selectedProducts
        .filter(({ productUrl }) => isPublicUrl(productUrl))
        .map(({ productUrl }) => canonicalUrl(productUrl) as string);
      const canonicalStorefront = canonicalUrl(storefrontUrl);
      const hasRealDestination = productDestinations.length
        ? productDestinations.some((url) => links.includes(url))
        : Boolean(canonicalStorefront && links.includes(canonicalStorefront));
      if (!hasRealDestination)
        issues.push(
          issue(
            "a1-product-link",
            "error",
            "An A1 product-led email needs a real product or storefront destination.",
          ),
        );
    }
  }

  return {
    status: issues.some(({ severity }) => severity === "error")
      ? "needs-attention"
      : "ready",
    issues,
    byteSize,
  };
}

export function auditEmailFamily(input: {
  brandSystem: BrandSystem;
  emails: Array<{
    recipe: LifecycleRecipe;
    html: string;
    quality: EmailQualityReport;
  }>;
}): EmailFamilyQualityReport {
  const { emails } = input;
  const issues: EmailQualityIssue[] = [];
  const creativeBriefCount = new Set(
    emails.map(({ recipe }) => normalized(recipe.creativeBrief)),
  ).size;
  const structureCount = new Set(
    emails.map(({ html }) => structureFingerprint(html)),
  ).size;
  const uniqueSubjects = new Set(
    emails.map(({ recipe }) => recipe.subject.trim().toLowerCase()),
  ).size;
  const uniqueHeadlines = new Set(
    emails.map(({ recipe }) => recipe.headline.trim().toLowerCase()),
  ).size;
  if (emails.length !== 13)
    issues.push(
      issue(
        "family-count",
        "error",
        `Expected 13 lifecycle emails, found ${emails.length}.`,
      ),
    );
  const uniquePreheaders = new Set(
    emails.map(({ recipe }) => normalized(recipe.preheader)),
  ).size;
  const uniqueBodies = new Set(
    emails.map(({ recipe }) => normalized(recipe.body)),
  ).size;
  if (creativeBriefCount !== emails.length)
    issues.push(
      issue(
        "creative-brief-repeat",
        "error",
        "Every lifecycle email needs its own art direction brief.",
      ),
    );
  if (structureCount < Math.min(10, emails.length))
    issues.push(
      issue(
        "structure-repeat",
        "error",
        "Too many finished emails reuse the same rendered structure.",
      ),
    );
  if (uniqueSubjects !== emails.length)
    issues.push(
      issue(
        "subject-repeat",
        "error",
        "Two or more emails repeat the same subject line.",
      ),
    );
  if (uniqueHeadlines !== emails.length)
    issues.push(
      issue(
        "headline-repeat",
        "error",
        "Two or more emails repeat the same headline.",
      ),
    );
  if (uniquePreheaders < 10)
    issues.push(
      issue(
        "preheader-repeat",
        "error",
        "The family repeats too many preheaders to feel individually art-directed.",
      ),
    );
  if (uniqueBodies !== emails.length)
    issues.push(
      issue(
        "body-repeat",
        "error",
        "Every lifecycle email needs its own useful body copy.",
      ),
    );
  const readyCount = emails.filter(
    ({ quality }) => quality.status === "ready",
  ).length;
  return {
    status:
      issues.some(({ severity }) => severity === "error") ||
      readyCount !== emails.length
        ? "needs-attention"
        : "ready",
    readyCount,
    totalCount: emails.length,
    creativeBriefCount,
    structureCount,
    issues,
  };
}
