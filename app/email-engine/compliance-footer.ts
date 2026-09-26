// The legally required part of every marketing email's footer: the sender's
// postal address and a working unsubscribe link (CAN-SPAM, GDPR/PECR, and
// Gmail/Yahoo bulk-sender rules). It is appended by code after generation —
// never left to the model — so it can't be forgotten, reworded away, or
// hallucinated. Platform-neutral: callers pass plain strings.

export type ComplianceFooterInput = {
  // One-line postal form, e.g. "Lumen · 12 Ring Road, Surat, Gujarat 394101, India".
  postalLine: string | null;
  // Real per-recipient URL when sending; null in merchant previews, where the
  // link is shown as inert text rather than faked with href="#".
  unsubscribeUrl: string | null;
};

const MARKER = "data-nomi-compliance";
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function complianceFooterHtml({ postalLine, unsubscribeUrl }: ComplianceFooterInput): string {
  const linkStyle = "color:#6b6560; text-decoration:underline;";
  const unsubscribe = unsubscribeUrl
    ? `<a href="${escapeHtml(unsubscribeUrl)}" style="${linkStyle}">Unsubscribe</a>`
    : `<span style="${linkStyle}">Unsubscribe</span>`;
  const address = postalLine
    ? `<p style="margin:0 0 6px 0; font-family:${SANS}; font-size:12px; line-height:1.6; color:#6b6560;">${escapeHtml(postalLine)}</p>`
    : "";
  return `<table role="presentation" ${MARKER}="footer" width="100%" cellpadding="0" cellspacing="0" border="0">
  <tr>
    <td align="center" style="padding:0 16px 32px 16px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" align="center" style="max-width:600px; width:100%;">
        <tr>
          <td align="center" style="padding:0 16px;">
            ${address}<p style="margin:0; font-family:${SANS}; font-size:12px; line-height:1.6; color:#6b6560;">Don’t want these emails? ${unsubscribe}</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;
}

// Idempotent: re-applying replaces the previous footer, so a stored preview
// footer can be swapped for the real per-recipient one at send time.
export function withComplianceFooter(html: string, input: ComplianceFooterInput): string {
  const footer = complianceFooterHtml(input);
  const existing = new RegExp(`<table role="presentation" ${MARKER}="footer"[\\s\\S]*?</table>\\s*</td>\\s*</tr>\\s*</table>`);
  if (existing.test(html)) return html.replace(existing, footer);
  const bodyClose = html.search(/<\/body>/i);
  return bodyClose === -1 ? `${html}\n${footer}` : `${html.slice(0, bodyClose)}${footer}\n${html.slice(bodyClose)}`;
}
