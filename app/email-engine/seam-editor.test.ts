import { describe, expect, it } from "vitest";
import {
  annotateSeamKeys,
  applyImageSeamEdit,
  applyTextSeamEdit,
  findSeams,
  validateSeamEditedHtml,
} from "../brand-studio/seam-editor.server";

const sampleEmail = `<!doctype html><html><head><meta name="viewport" content="width=device-width"></head><body style="background:#fff;color:#111">
<table role="presentation"><tr><td>
<img data-nomi-seam="logo" src="https://cdn.shopify.com/logo.png" width="120" height="40" alt="Lumen">
<h1 data-nomi-seam="headline">Old headline</h1>
<p data-nomi-seam="body">Old body copy with useful detail in it.</p>
<img data-nomi-seam="image" src="https://cdn.shopify.com/hero.png" width="600" height="300" alt="Studio">
<img data-nomi-seam="product" data-nomi-product-id="prod-1" src="https://cdn.shopify.com/canopy.png" width="300" height="300" alt="Canopy">
<a data-nomi-seam="product" data-nomi-product-id="prod-1" href="https://example.com/products/canopy">Shop the Canopy</a>
<a data-nomi-seam="cta-label" href="https://example.com">Shop <b>now</b></a>
</td></tr></table>
</body></html>`;

describe("findSeams", () => {
  it("finds the three text seams, the logo, a generic image, and a paired product image+link", () => {
    const seams = findSeams(sampleEmail);
    const byId = Object.fromEntries(seams.map((s) => [s.id, s]));

    expect(byId.headline).toMatchObject({ kind: "text", text: "Old headline" });
    expect(byId.body).toMatchObject({
      kind: "text",
      text: "Old body copy with useful detail in it.",
    });
    expect(byId["cta-label"]).toMatchObject({ kind: "text", text: "Shop now" });
    expect(byId.logo).toMatchObject({
      kind: "logo",
      src: "https://cdn.shopify.com/logo.png",
      width: 120,
      height: 40,
    });
    expect(byId["image:0"]).toMatchObject({
      kind: "image",
      src: "https://cdn.shopify.com/hero.png",
    });
    expect(byId["product:prod-1"]).toMatchObject({
      kind: "product",
      productId: "prod-1",
      src: "https://cdn.shopify.com/canopy.png",
    });
    // Exactly one seam per product id — the paired <a> isn't double-counted.
    expect(seams.filter((s) => s.id === "product:prod-1")).toHaveLength(1);
  });

  it("returns an empty list for HTML with no seams at all", () => {
    expect(findSeams("<html><body><h1>No seams here</h1></body></html>")).toEqual([]);
  });
});

describe("annotateSeamKeys", () => {
  it("writes the same data-nomi-seam-key ids findSeams would compute, and shares one key between a product image and its paired link", () => {
    const annotated = annotateSeamKeys(sampleEmail);
    expect(annotated).toContain('data-nomi-seam="headline" data-nomi-seam-key="headline"');
    expect(annotated).toContain('data-nomi-seam="logo" src="https://cdn.shopify.com/logo.png" width="120" height="40" alt="Lumen" data-nomi-seam-key="logo"');
    const productKeyMatches = [...annotated.matchAll(/data-nomi-seam-key="product:prod-1"/g)];
    expect(productKeyMatches).toHaveLength(2); // the <img> and its paired <a>
  });
});

describe("applyTextSeamEdit", () => {
  it("replaces a text seam's content and HTML-escapes it", () => {
    const updated = applyTextSeamEdit(
      sampleEmail,
      "headline",
      "New headline & <script>alert(1)</script>",
    );
    expect(updated).toContain(
      "New headline &amp; &lt;script&gt;alert(1)&lt;/script&gt;",
    );
    expect(updated).not.toContain("<script>alert(1)</script>");
    // Nothing else moved.
    expect(findSeams(updated).find((s) => s.id === "body")).toMatchObject({
      text: "Old body copy with useful detail in it.",
    });
  });

  it("throws when the requested seam doesn't exist in this email", () => {
    const noCta = sampleEmail.replace(
      '<a data-nomi-seam="cta-label" href="https://example.com">Shop <b>now</b></a>',
      "",
    );
    expect(() => applyTextSeamEdit(noCta, "cta-label", "Buy now")).toThrow(
      /no "cta-label" seam/,
    );
  });
});

describe("applyImageSeamEdit", () => {
  it("swaps the logo image and its size/alt", () => {
    const updated = applyImageSeamEdit(sampleEmail, "logo", {
      src: "https://cdn.shopify.com/new-logo.png",
      alt: "New alt",
      width: 140,
      height: 48,
    });
    const seam = findSeams(updated).find((s) => s.id === "logo");
    expect(seam).toMatchObject({
      src: "https://cdn.shopify.com/new-logo.png",
      alt: "New alt",
      width: 140,
      height: 48,
    });
  });

  it("swapping a product updates both the image and its paired link together", () => {
    const updated = applyImageSeamEdit(sampleEmail, "product:prod-1", {
      src: "https://cdn.shopify.com/new-product.png",
      alt: "New Product",
      width: 300,
      height: 300,
      href: "https://example.com/products/new-product",
    });
    const seam = findSeams(updated).find((s) => s.id === "product:prod-1");
    expect(seam).toMatchObject({ src: "https://cdn.shopify.com/new-product.png" });
    expect(updated).toContain('href="https://example.com/products/new-product"');
  });

  it("escapes an ampersand in a swapped-in URL", () => {
    const updated = applyImageSeamEdit(sampleEmail, "image:0", {
      src: "https://cdn.shopify.com/hero.png?v=1&w=600",
      alt: "Studio",
      width: 600,
      height: 300,
    });
    expect(updated).toContain('src="https://cdn.shopify.com/hero.png?v=1&amp;w=600"');
  });

  it("throws when the requested image seam doesn't exist", () => {
    expect(() =>
      applyImageSeamEdit(sampleEmail, "product:does-not-exist", {
        src: "https://cdn.shopify.com/x.png",
        alt: "x",
        width: 10,
        height: 10,
      }),
    ).toThrow(/no "product:does-not-exist" image seam/);
  });
});

describe("eyebrow and footer text seams", () => {
  const emailWithEyebrowAndFooter = `<!doctype html><html><body>
<p data-nomi-seam="eyebrow">FIELD NOTE NO. 1</p>
<h1 data-nomi-seam="headline">Old headline</h1>
<p data-nomi-seam="footer">Notes for weathered skin, kept plain on purpose. You are receiving this because you joined Lumen. Preferences and unsubscribe options are available below.</p>
</body></html>`;

  it("finds an eyebrow and a footer seam alongside the headline", () => {
    const seams = findSeams(emailWithEyebrowAndFooter);
    const byId = Object.fromEntries(seams.map((s) => [s.id, s]));
    expect(byId.eyebrow).toMatchObject({ kind: "text", text: "FIELD NOTE NO. 1" });
    expect(byId.footer).toMatchObject({ kind: "text" });
    expect((byId.footer as { text: string }).text).toContain("unsubscribe");
  });

  it("edits an eyebrow seam independently of the headline and footer", () => {
    const updated = applyTextSeamEdit(emailWithEyebrowAndFooter, "eyebrow", "FIELD NOTE NO. 2");
    expect(findSeams(updated).find((s) => s.id === "eyebrow")).toMatchObject({ text: "FIELD NOTE NO. 2" });
    expect(findSeams(updated).find((s) => s.id === "headline")).toMatchObject({ text: "Old headline" });
  });

  it("returns no eyebrow/footer seam for HTML generated before these markers existed", () => {
    const seams = findSeams(sampleEmail);
    expect(seams.find((s) => s.id === "eyebrow")).toBeUndefined();
    expect(seams.find((s) => s.id === "footer")).toBeUndefined();
  });
});

describe("cta-label destination URL", () => {
  it("reads the href off the enclosing <a> even when the seam marker sits on an inner span, not the <a> itself", () => {
    const html = `<!doctype html><html><body><a href="https://example.com/shop"><span data-nomi-seam="cta-label">Begin Slowly</span></a></body></html>`;
    const seams = findSeams(html);
    expect(seams.find((s) => s.id === "cta-label")).toMatchObject({
      text: "Begin Slowly",
      url: "https://example.com/shop",
    });
  });

  it("reads the href straight off the seam element when the marker sits on the <a> itself", () => {
    const seams = findSeams(sampleEmail);
    expect(seams.find((s) => s.id === "cta-label")).toMatchObject({
      text: "Shop now",
      url: "https://example.com",
    });
  });

  it("updates the href on save alongside the label text", () => {
    const updated = applyTextSeamEdit(
      sampleEmail,
      "cta-label",
      "Begin slowly",
      "https://example.com/new?ref=1&x=2",
    );
    expect(updated).toContain('href="https://example.com/new?ref=1&amp;x=2"');
    expect(findSeams(updated).find((s) => s.id === "cta-label")).toMatchObject({ text: "Begin slowly" });
  });

  it("leaves the href untouched when no href override is given", () => {
    const updated = applyTextSeamEdit(sampleEmail, "cta-label", "New label");
    expect(updated).toContain('href="https://example.com"');
  });
});

// A seam save is the merchant's own deliberate edit, not AI output, so it no
// longer re-runs the full-document `validateCreativeEmail` safety/quality
// audit (see seam-editor.server.ts's `validateSeamEditedHtml` doc comment
// and BRAND_STUDIO_REGENERATE.md's 2026-09-22 update) — an unrelated
// pre-existing issue elsewhere in the email used to fail every save with a
// generic error, regardless of which seam was actually touched.
describe("validateSeamEditedHtml", () => {
  it("returns the HTML unchanged, with no audit to fail on unrelated content", () => {
    const html = `<!doctype html><html><body><h1 data-nomi-seam="headline">Anything at all, even something an audit would have rejected</h1></body></html>`;
    expect(validateSeamEditedHtml({ html })).toBe(html);
  });
});

describe("repeatable text and button seams", () => {
  const campaign = `<table><tr><td><span data-nomi-seam="headline">Slow mornings</span>
<p><span data-nomi-seam="text">Get the look</span></p>
<p><span data-nomi-seam="text">A calm first step.</span></p>
<a href="https://shop.example.com/products/loam"><span data-nomi-seam="button">Shop Loam</span></a>
<a href="https://shop.example.com"><span data-nomi-seam="cta-label">Shop the ritual</span></a>
</td></tr></table>`;

  it("finds every text and button seam by document order, with button links", () => {
    const byId = Object.fromEntries(findSeams(campaign).map((seam) => [seam.id, seam]));
    expect(byId["text:0"]).toMatchObject({ kind: "text", text: "Get the look" });
    expect(byId["text:1"]).toMatchObject({ kind: "text", text: "A calm first step." });
    expect(byId["button:0"]).toMatchObject({ text: "Shop Loam", url: "https://shop.example.com/products/loam" });
    expect(annotateSeamKeys(campaign)).toContain('data-nomi-seam-key="text:1"');
  });

  it("edits one repeatable seam and a secondary button's link", () => {
    const edited = applyTextSeamEdit(campaign, "text:1", "A gentle <first> step.");
    expect(edited).toContain("A gentle &lt;first&gt; step.");
    expect(edited).toContain("Get the look");
    const button = applyTextSeamEdit(campaign, "button:0", "Meet Loam", "https://shop.example.com/collections/care");
    expect(findSeams(button).find((seam) => seam.id === "button:0")).toMatchObject({
      text: "Meet Loam",
      url: "https://shop.example.com/collections/care",
    });
    expect(() => applyTextSeamEdit(campaign, "text:9", "x")).toThrow(/no "text:9" seam/);
  });
});
