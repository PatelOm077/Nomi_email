import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = process.cwd();
const dashboardRoute = readFileSync(
  resolve(projectRoot, "app/routes/app._index.tsx"),
  "utf8",
);
const brandStudioRoute = readFileSync(
  resolve(projectRoot, "app/routes/app.brand-studio.tsx"),
  "utf8",
);
const templatesRoute = readFileSync(
  resolve(projectRoot, "app/routes/app.additional.tsx"),
  "utf8",
);
const brandSettingsRoute = readFileSync(
  resolve(projectRoot, "app/routes/app.brand-settings.tsx"),
  "utf8",
);
const approvedDelivery = readFileSync(
  resolve(projectRoot, "app/email-delivery/approved-brand.server.ts"),
  "utf8",
);

describe("Brand Studio lifecycle HTML boundary", () => {
  it("keeps obsolete dashboard lifecycle renderers deleted", () => {
    expect(
      existsSync(resolve(projectRoot, "app/email-engine/generate-lifecycle-email.ts")),
    ).toBe(false);
    expect(
      existsSync(resolve(projectRoot, "app/email-engine/templates/lifecycle-template.ts")),
    ).toBe(false);
    expect(
      existsSync(resolve(projectRoot, "app/dashboard/lifecycle-inputs.ts")),
    ).toBe(false);
  });

  it("renders persisted Brand Studio HTML or a rebuild state", () => {
    expect(dashboardRoute).toContain("brand.previewHtmlById[template.id]");
    expect(dashboardRoute).toContain("Build in Brand Studio");
    expect(dashboardRoute).not.toContain("generateLifecycleEmail");
    expect(dashboardRoute).not.toContain("Recommended for you");
    expect(dashboardRoute).not.toContain("BUY NOW");
    expect(dashboardRoute).not.toContain("Pending activation");
  });

  it("connects generation, persistence, previews, and delivery to Brand Studio", () => {
    expect(brandStudioRoute).toContain("generateCreativeEmailFamilyWithSonnet");
    expect(brandStudioRoute).toContain("renderedEmails: JSON.stringify(creative.value)");
    expect(brandStudioRoute).toContain('status: "complete"');
    expect(dashboardRoute).toContain("getApprovedBrandStudioFamily");
    expect(templatesRoute).toContain("getApprovedBrandStudioFamily");
    expect(approvedDelivery).toContain("getApprovedBrandStudioFamily");
  });

  it("does not install the Lumen demo fixture as another merchant's fallback", () => {
    expect(dashboardRoute).not.toContain("LUMEN_DEMO_BRAND_SYSTEM");
    expect(dashboardRoute).not.toContain("LUMEN_DEMO_RECIPES");
    expect(brandSettingsRoute).not.toContain("LUMEN_DEMO_BRAND_SYSTEM");
    expect(brandSettingsRoute).not.toContain("LUMEN_DEMO_SHOP_NAME");
  });
});
