import { describe, expect, it } from "vitest";
import { withComplianceFooter } from "./compliance-footer";

const EMAIL = `<!DOCTYPE html><html><body style="background-color:#F4EEE6;"><table role="presentation"><tr><td>Hi</td></tr></table></body></html>`;

describe("withComplianceFooter", () => {
  it("adds the postal address and a real unsubscribe link before </body>", () => {
    const html = withComplianceFooter(EMAIL, { postalLine: "Lumen · 12 Ring Road, Surat, India", unsubscribeUrl: "https://app.test/unsubscribe?t=a.b" });
    expect(html).toContain("Lumen · 12 Ring Road, Surat, India");
    expect(html).toContain('<a href="https://app.test/unsubscribe?t=a.b"');
    expect(html.indexOf("data-nomi-compliance")).toBeLessThan(html.indexOf("</body>"));
  });

  it("shows inert Unsubscribe text in previews — never href=\"#\"", () => {
    const html = withComplianceFooter(EMAIL, { postalLine: null, unsubscribeUrl: null });
    expect(html).toContain("<span");
    expect(html).not.toContain('href="#"');
  });

  it("replaces an existing footer instead of stacking a second one", () => {
    const preview = withComplianceFooter(EMAIL, { postalLine: "Old address", unsubscribeUrl: null });
    const sent = withComplianceFooter(preview, { postalLine: "New address", unsubscribeUrl: "https://app.test/u" });
    expect(sent.match(/data-nomi-compliance/g)).toHaveLength(1);
    expect(sent).toContain("New address");
    expect(sent).not.toContain("Old address");
  });

  it("escapes merchant-entered text", () => {
    expect(withComplianceFooter(EMAIL, { postalLine: "<b>A&B</b>", unsubscribeUrl: null })).toContain("&lt;b&gt;A&amp;B&lt;/b&gt;");
  });
});
