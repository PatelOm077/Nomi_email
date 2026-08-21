import { describe, expect, it } from "vitest";
import { renderLifecycleTemplateHtml } from "./lifecycle-template";
import type { LifecycleEmail } from "../types";
import type { LifecycleTemplateCustomization } from "./types";

const noCustomization: LifecycleTemplateCustomization = {
  logoUrl: null,
  primaryColor: null,
  buttonText: null,
};

const baseEmail: LifecycleEmail = {
  id: "cart-2",
  shopName: "Paper Boat Goods",
  sequenceName: "Cart recovery",
  emailName: "A gentle reminder",
  position: 2,
  sequenceLength: 3,
  timing: "24 hours after checkout",
  objective: "Remind the customer what they left behind",
  customerFirstName: "Mina",
  products: [
    { title: "Linen Throw", price: "₹3,200.00", imageUrl: "https://cdn.example.com/linen.jpg", productUrl: "https://shop.example.com/products/linen-throw" },
    { title: "Cedar Tray", price: "₹1,100.00", imageUrl: null, productUrl: null },
    { title: "Stoneware Cup", price: "₹850.00", imageUrl: null, productUrl: "https://shop.example.com/products/stoneware-cup" },
    { title: "Extra Product", price: "₹500.00", imageUrl: null, productUrl: null },
  ],
  orderNumber: "#1042",
  orderTotal: "₹7,500.00",
  recoveryUrl: "https://shop.example.com/checkouts/recover/abc123",
  reviewUrl: "https://shop.example.com/products/linen-throw",
  language: "en",
  tone: "warm-plain",
};

describe("renderLifecycleTemplateHtml", () => {
  it("escapes shop name, customer name, and product titles", () => {
    const html = renderLifecycleTemplateHtml(
      {
        ...baseEmail,
        shopName: "<script>alert(1)</script> Shop",
        customerFirstName: `Mina" onmouseover="alert(1)`,
        products: [{ title: "<b>Bold</b> Throw", price: "$10", imageUrl: null, productUrl: null }],
      },
      noCustomization,
    );

    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain('onmouseover="alert(1)"');
    expect(html).toContain("&quot;");
    expect(html).not.toContain("<b>Bold</b> Throw");
    expect(html).toContain("&lt;b&gt;Bold&lt;/b&gt; Throw");
  });

  it("only shows up to three products", () => {
    const html = renderLifecycleTemplateHtml(baseEmail, noCustomization);
    expect(html).toContain("Linen Throw");
    expect(html).toContain("Cedar Tray");
    expect(html).toContain("Stoneware Cup");
    expect(html).not.toContain("Extra Product");
  });

  it("uses the recovery URL for the cart CTA button, never a fabricated link", () => {
    const html = renderLifecycleTemplateHtml(baseEmail, noCustomization);
    // The CTA button (bgcolor-wrapped link) must point at the recovery URL —
    // product thumbnails separately and legitimately link to their own page.
    const buttonMatch = html.match(/bgcolor="[^"]*"[^>]*>\s*<a href="([^"]+)"/);
    expect(buttonMatch?.[1]).toBe("https://shop.example.com/checkouts/recover/abc123");
    expect(html).not.toContain('href="#"');
  });

  it("uses the review URL for the review-request slot", () => {
    const html = renderLifecycleTemplateHtml({ ...baseEmail, id: "review-request" }, noCustomization);
    expect(html).not.toContain(`href="https://shop.example.com/checkouts/recover/abc123"`);
    expect(html).toContain(`href="https://shop.example.com/products/linen-throw"`);
  });

  it("uses the first supplied product URL for every other slot", () => {
    const html = renderLifecycleTemplateHtml({ ...baseEmail, id: "welcome-1" }, noCustomization);
    expect(html).toContain(`href="https://shop.example.com/products/linen-throw"`);
  });

  it("omits the CTA entirely when no real URL is available", () => {
    const html = renderLifecycleTemplateHtml(
      { ...baseEmail, id: "welcome-1", products: [{ title: "No Link", price: "$5", imageUrl: null, productUrl: null }] },
      noCustomization,
    );
    expect(html).not.toContain("<a href=");
  });

  it("falls back to a name-free greeting when no first name is captured", () => {
    const html = renderLifecycleTemplateHtml({ ...baseEmail, customerFirstName: null }, noCustomization);
    expect(html).toContain(">Hello,<");
    expect(html).not.toContain("Hey ");
  });

  it("applies customization overrides for logo, color, and button text", () => {
    const customization: LifecycleTemplateCustomization = {
      logoUrl: "https://cdn.example.com/logo.png",
      primaryColor: "#112233",
      buttonText: "Go now",
    };
    const html = renderLifecycleTemplateHtml(baseEmail, customization);
    expect(html).toContain('src="https://cdn.example.com/logo.png"');
    expect(html).toContain('bgcolor="#112233"');
    expect(html).toContain(">Go now<");
    expect(html).not.toContain("Paper Boat Goods</span>");
  });

  it("stays inside the email-safe table/inline-style contract", () => {
    const html = renderLifecycleTemplateHtml(baseEmail, noCustomization);
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).not.toContain("<div class=");
    expect(html).not.toContain("<style");
    expect(html).not.toContain("<script");
    expect(html).toContain("'Source Serif 4', Georgia, serif");
  });
});
