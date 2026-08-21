import type { LifecycleEmail } from "../types";
import { escapeHtml } from "./escape-html";
import { LIFECYCLE_TEMPLATE_COPY } from "./lifecycle-template-copy";
import type { LifecycleTemplateCustomization } from "./types";

// A deliberately neutral starting palette — not Nomi's own dashboard brand
// (see CLAUDE.md: merchant emails never use Nomi's ink/paper/cyan/magenta).
// Merchants override the accent via customization.primaryColor; logo/text
// header still needs a sane default before they do.
const DEFAULT_PRIMARY_COLOR = "#57534b";
const PAPER = "#f6f5f2";
const INK = "#2a2723";
const MUTED = "#6b675f";
const DIVIDER = "#ece9e4";

const FONT_HEADING = `'Source Serif 4', Georgia, serif`;
const FONT_UI = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`;

function greetingLine(firstName: string | null): string {
  return firstName ? `Hey ${escapeHtml(firstName)},` : "Hello,";
}

// Same rule the AI path enforces (lifecycle-email-prompt.ts): a cart email
// may only link to the real recovery URL, a review request only to the real
// review URL, and every other slot only to a real supplied product URL.
// Never a fabricated href="#" — if nothing real is available, no button.
function resolveCtaUrl(email: LifecycleEmail): string | null {
  if (email.id.startsWith("cart-")) return email.recoveryUrl;
  if (email.id === "review-request") return email.reviewUrl;
  return email.products.find((product) => product.productUrl)?.productUrl ?? null;
}

function renderButton(url: string, label: string, color: string): string {
  return `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td align="center" style="padding: 24px 0 4px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td bgcolor="${color}" style="border-radius: 2px;">
                  <a href="${escapeHtml(url)}" style="display: inline-block; padding: 13px 28px; font-family: ${FONT_UI}; font-size: 14px; color: #ffffff; text-decoration: none;">${escapeHtml(label)}</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>`;
}

function renderProducts(products: LifecycleEmail["products"]): string {
  const shown = products.slice(0, 3);
  if (shown.length === 0) return "";

  const cells = shown
    .map((product) => {
      const title = escapeHtml(product.title);
      const price = escapeHtml(product.price);
      const image = product.imageUrl
        ? `<img src="${escapeHtml(product.imageUrl)}" width="120" height="120" alt="${title}" style="display: block; width: 120px; height: 120px; object-fit: cover; border-radius: 2px;" />`
        : `<div style="width: 120px; height: 120px; background: ${DIVIDER}; border-radius: 2px;"></div>`;
      const inner = `${image}<div style="font-family: ${FONT_UI}; font-size: 13px; color: ${INK}; margin-top: 8px;">${title}</div><div style="font-family: ${FONT_UI}; font-size: 13px; color: ${MUTED};">${price}</div>`;
      const content = product.productUrl
        ? `<a href="${escapeHtml(product.productUrl)}" style="display: block; text-decoration: none; color: inherit;">${inner}</a>`
        : inner;
      return `<td width="120" valign="top" style="padding: 0 16px 16px 0;">${content}</td>`;
    })
    .join("");

  return `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top: 12px;">
        <tr>${cells}</tr>
      </table>`;
}

// Pure function — no I/O, no DOM — so it can be called from the browser for
// an instant live preview today, and reused server-side later if an
// automated send path for these flows gets built.
export function renderLifecycleTemplateHtml(
  email: LifecycleEmail,
  customization: LifecycleTemplateCustomization,
): string {
  const copy = LIFECYCLE_TEMPLATE_COPY[email.id];
  const primaryColor = customization.primaryColor || DEFAULT_PRIMARY_COLOR;
  const shopName = escapeHtml(email.shopName);

  const headerContent = customization.logoUrl
    ? `<img src="${escapeHtml(customization.logoUrl)}" alt="${shopName}" style="display: block; max-height: 40px;" />`
    : `<span style="font-family: ${FONT_HEADING}; font-size: 20px; font-weight: 600; color: ${INK};">${shopName}</span>`;

  const ctaUrl = resolveCtaUrl(email);
  const button = ctaUrl ? renderButton(ctaUrl, customization.buttonText || copy.ctaLabel, primaryColor) : "";

  const bodyParagraphs = copy.body
    .map(
      (paragraph) =>
        `<p style="font-family: ${FONT_UI}; font-size: 15px; line-height: 1.6; color: ${INK}; margin: 0 0 14px;">${escapeHtml(paragraph)}</p>`,
    )
    .join("");

  const productsBlock = renderProducts(email.products);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${shopName}</title>
</head>
<body style="margin: 0; padding: 0; background: ${PAPER};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background: ${PAPER};">
    <tr>
      <td align="center" style="padding: 32px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" align="center" style="max-width: 600px; width: 100%; background: #ffffff;">
          <tr>
            <td style="padding: 28px 32px 20px; border-bottom: 1px solid ${DIVIDER};">
              ${headerContent}
            </td>
          </tr>
          <tr>
            <td style="padding: 32px;">
              <p style="font-family: ${FONT_HEADING}; font-size: 15px; color: ${INK}; margin: 0 0 18px;">${greetingLine(email.customerFirstName)}</p>
              <h1 style="font-family: ${FONT_HEADING}; font-size: 26px; font-weight: 600; color: ${INK}; margin: 0 0 16px;">${escapeHtml(copy.headline)}</h1>
              ${bodyParagraphs}${button}${productsBlock}
            </td>
          </tr>
          <tr>
            <td style="padding: 20px 32px 28px; border-top: 1px solid ${DIVIDER};">
              <p style="font-family: ${FONT_UI}; font-size: 12px; color: ${MUTED}; margin: 0;">${shopName}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
