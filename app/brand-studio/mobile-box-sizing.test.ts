import { describe, expect, it } from "vitest";
import { hardenMobileBoxSizing } from "./ai.server";

describe("hardenMobileBoxSizing", () => {
  it("adds border-box sizing inside the mobile media query only", () => {
    const html = `<style>.x{padding:8px}@media only screen and (max-width:600px){.stack{display:block !important;width:100% !important;}}</style>`;
    expect(hardenMobileBoxSizing(html)).toBe(
      `<style>.x{padding:8px}@media only screen and (max-width:600px){table,td,th,div{box-sizing:border-box !important;}.stack{display:block !important;width:100% !important;}}</style>`,
    );
  });

  it("leaves an email without a mobile query untouched", () => {
    const html = `<table width="100%" style="max-width:600px;"><tr><td width="90">Hi</td></tr></table>`;
    expect(hardenMobileBoxSizing(html)).toBe(html);
  });

  it("lets a fixed 600px container shrink to a phone screen", () => {
    expect(hardenMobileBoxSizing(`<table role="presentation" width="600" align="center" style="max-width:600px;">`)).toBe(
      `<table role="presentation" width="600" align="center" style="width:100%;max-width:600px;">`,
    );
    expect(hardenMobileBoxSizing(`<table width="600"><tr><td>Hi</td></tr></table>`)).toBe(
      `<table style="width:100%;max-width:600px;" width="600"><tr><td>Hi</td></tr></table>`,
    );
  });

  it("leaves small fixed tables and ones that already set a width alone", () => {
    const html = `<table width="120"></table><table width="600" style="width:600px;max-width:100%"></table>`;
    expect(hardenMobileBoxSizing(html)).toBe(html);
  });
});

describe("hardenMobileBoxSizing on stored emails", () => {
  it("is idempotent, so reading an already-fixed email changes nothing", () => {
    const html = `<style>@media (max-width:600px){.stack{width:100% !important;}}</style>`;
    const once = hardenMobileBoxSizing(html);
    expect(hardenMobileBoxSizing(once)).toBe(once);
  });
});
