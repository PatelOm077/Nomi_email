import { describe, expect, it } from "vitest";
import {
  deriveThemeAssets,
  normalizeLumenBrandEvidence,
  resolveUploadedBrandLogo,
} from "../brand-studio/shopify-evidence.server";

describe("Brand Studio theme evidence", () => {
  it("derives semantic tokens from the published theme settings", () => {
    const assets = deriveThemeAssets([{
      filename: "config/settings_data.json",
      checksumMd5: "abc123",
      body: { content: JSON.stringify({ current: { colors_background_1: "#faf7ef", colors_text: "#171717", color_primary: "#235f55", color_accent: "#d26b45", type_header_font: "Cormorant Garamond", type_body_font: "Inter", button_border_radius: 8, logo: "shopify://shop_images/northwind-wordmark.png" } }) },
    }]);
    expect(assets.palette).toEqual({ paper: "#faf7ef", ink: "#171717", primary: "#235f55", accent: "#d26b45" });
    expect(assets.fontHints).toEqual(["Cormorant Garamond", "Inter"]);
    expect(assets.buttonRadiusPx).toBe(8);
    expect(assets.logoReference).toBe("shopify://shop_images/northwind-wordmark.png");
    expect(assets.checksum).toBe("abc123");
  });

  it("resolves the exact theme logo from the merchant's uploaded Shopify files", () => {
    const logoUrl = resolveUploadedBrandLogo([
      { id: "product", alt: "Product bottle", image: { url: "https://cdn.shopify.com/s/files/1/files/bottle.png?v=1", width: 800, height: 1200 } },
      { id: "logo", alt: "Northwind", image: { url: "https://cdn.shopify.com/s/files/1/files/northwind-wordmark.png?v=2", width: 640, height: 160 } },
    ], "shopify://shop_images/northwind-wordmark.png", "Northwind");

    expect(logoUrl).toBe("https://cdn.shopify.com/s/files/1/files/northwind-wordmark.png?v=2");
  });

  it("uses a clearly named uploaded logo when the theme has no explicit logo", () => {
    const logoUrl = resolveUploadedBrandLogo([
      { id: "product", alt: "Northwind product", image: { url: "https://cdn.shopify.com/s/files/1/files/northwind-serum.png", width: 800, height: 1000 } },
      { id: "logo", alt: "Primary logo", image: { url: "https://cdn.shopify.com/s/files/1/files/brand-logo.svg", width: 500, height: 120 } },
    ], null, "Northwind");

    expect(logoUrl).toBe("https://cdn.shopify.com/s/files/1/files/brand-logo.svg");
  });

  it("does not mistake an arbitrary merchant product image for a logo", () => {
    const logoUrl = resolveUploadedBrandLogo([
      { id: "product", alt: "Northwind product", image: { url: "https://cdn.shopify.com/s/files/1/files/northwind-serum.png", width: 800, height: 1000 } },
    ], null, "Northwind");

    expect(logoUrl).toBeNull();
  });

  it("uses Lumen when the development shop name conflicts with Lumen storefront evidence", () => {
    const evidence = normalizeLumenBrandEvidence({
      shopName: "Nomi",
      storefrontUrl: null,
      storefrontText: "Lumen makes focused skincare formulas.",
      products: [{
        id: "gid://shopify/Product/1",
        title: "Canopy",
        description: "A focused Lumen formula.",
        productType: "Skincare",
        vendor: "Lumen",
        tags: ["skincare"],
        imageUrl: null,
        productUrl: null,
      }],
    }, "nomi-mmkgcryy.myshopify.com");

    expect(evidence.shopName).toBe("Lumen");
    expect(evidence.assets?.palette).toEqual({
      paper: "#fffaf3",
      ink: "#1d1a18",
      primary: "#b96f52",
      accent: "#d8cfc3",
    });
    expect(evidence.assets?.fontHints).toEqual(["Newsreader", "Manrope"]);
  });

  it("never applies the Lumen demo identity to another merchant", () => {
    const evidence = normalizeLumenBrandEvidence({
      shopName: "Northwind",
      storefrontUrl: null,
      storefrontText: "Lumen is mentioned in a product description.",
      products: [],
    }, "northwind.myshopify.com");

    expect(evidence.shopName).toBe("Northwind");
    expect(evidence.assets).toBeUndefined();
  });
});
