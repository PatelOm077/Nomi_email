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
    const html = `<table width="600"><tr><td>Hi</td></tr></table>`;
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
