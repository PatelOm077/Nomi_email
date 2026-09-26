import { describe, expect, it } from "vitest";
import { resolveSenderFooter, safeReturnTo, type FooterAddress } from "./sender-footer.server";

const shopify: FooterAddress = { name: "Lumen", address: "12 Ring Road", city: "Surat", province: "Gujarat", postalCode: "394101", country: "India" };

describe("resolveSenderFooter", () => {
  it("uses the Shopify store address when Sender info is empty", () => {
    const footer = resolveSenderFooter(null, shopify);
    expect(footer).toMatchObject({ source: "shopify", complete: true });
    expect(footer.line).toBe("Lumen · 12 Ring Road, Surat, Gujarat 394101, India");
  });

  it("prefers a complete Sender info override", () => {
    const footer = resolveSenderFooter(
      { senderName: "Lumen Studio", senderAddress: "4 Park St", senderCity: "Pune", senderCountry: "India" },
      shopify,
    );
    expect(footer).toMatchObject({ source: "sender-info", complete: true, city: "Pune" });
  });

  it("ignores a partial override when Shopify has a full address", () => {
    expect(resolveSenderFooter({ senderName: "Lumen Studio" }, shopify).source).toBe("shopify");
  });

  it("is incomplete when neither source has a street, city and country", () => {
    const footer = resolveSenderFooter({ senderName: "Lumen" }, { ...shopify, address: null });
    expect(footer).toMatchObject({ complete: false, source: null, line: null, city: "Surat" });
  });
});

describe("safeReturnTo", () => {
  it("allows in-app paths only", () => {
    expect(safeReturnTo("/app/campaigns")).toBe("/app/campaigns");
    expect(safeReturnTo("/app")).toBe("/app");
    expect(safeReturnTo("https://evil.test/app")).toBeNull();
    expect(safeReturnTo("//evil.test")).toBeNull();
    expect(safeReturnTo("/application")).toBeNull();
    expect(safeReturnTo(null)).toBeNull();
  });
});
