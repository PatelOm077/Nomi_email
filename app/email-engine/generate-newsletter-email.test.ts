import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateNewsletterEmail } from "./generate-newsletter-email";
import { NEWSLETTER_SKELETON_PROMPT } from "./newsletter-prompt";
import type { NewsletterCampaign } from "./types";

const generateEmailHtml = vi.hoisted(() => vi.fn());

vi.mock("./generate-email", async (importOriginal) => ({
  EmailCutOffError: (await importOriginal<typeof import("./generate-email")>()).EmailCutOffError,
  generateEmailHtml,
}));

const baseCampaign: NewsletterCampaign = {
  shopName: "Paper Boat Goods",
  prompt: "A Diwali sale with 15% off linen for this weekend only",
  products: [
    {
      id: "gid://shopify/Product/1",
      title: "Linen Throw",
      price: "₹3,200.00",
      imageUrl: "https://cdn.example.com/linen.jpg",
      productUrl: "https://shop.example.com/products/linen-throw",
      cutoutImageUrl: "https://cdn.example.com/linen-cutout.png",
    },
    {
      id: "gid://shopify/Product/2",
      title: "Cedar Tray",
      price: "₹1,100.00",
      imageUrl: null,
      productUrl: null,
      cutoutImageUrl: null,
    },
  ],
  language: "pt",
  tone: "bright-bubbly",
};

describe("generateNewsletterEmail", () => {
  beforeEach(() => {
    generateEmailHtml.mockReset();
  });

  it("retries once, more compactly, when the email runs out of room", async () => {
    const { EmailCutOffError } = await import("./generate-email");
    generateEmailHtml
      .mockRejectedValueOnce(new EmailCutOffError())
      .mockResolvedValueOnce("<!DOCTYPE html><html>ok</html>");

    await expect(generateNewsletterEmail(baseCampaign)).resolves.toBe("<!DOCTYPE html><html>ok</html>");
    expect(generateEmailHtml).toHaveBeenCalledTimes(2);
    expect(generateEmailHtml.mock.calls[1][1]).toContain("ran out of room");
    expect(generateEmailHtml.mock.calls[0][4]).toEqual({ maxTokens: 24_000, effort: "medium" });
  });

  it("maps the campaign brief and products into the shared generator call", async () => {
    generateEmailHtml.mockResolvedValue("<!DOCTYPE html><html></html>");

    await expect(generateNewsletterEmail(baseCampaign)).resolves.toBe(
      "<!DOCTYPE html><html></html>",
    );

    expect(generateEmailHtml).toHaveBeenCalledOnce();
    const [skeleton, message, language, tone] = generateEmailHtml.mock.calls[0];

    expect(skeleton).toBe(NEWSLETTER_SKELETON_PROMPT);
    expect(language).toBe("pt");
    expect(tone).toBe("bright-bubbly");
    expect(message).toContain("Shop: Paper Boat Goods");
    expect(message).toContain(
      "Merchant's campaign brief: A Diwali sale with 15% off linen for this weekend only",
    );
    expect(message).toContain("Linen Throw — ₹3,200.00");
    expect(message).toContain("image: https://cdn.example.com/linen.jpg");
    expect(message).toContain(
      "URL: https://shop.example.com/products/linen-throw",
    );
    expect(message).toContain("Cedar Tray — ₹1,100.00");
    expect(message).not.toContain("image: null");
    expect(message).not.toContain("URL: null");
    expect(message).toContain("id: gid://shopify/Product/1");
    expect(message).toContain("id: gid://shopify/Product/2");
  });

  it("includes a product's cutout image URL only when one is present", async () => {
    generateEmailHtml.mockResolvedValue("<!DOCTYPE html><html></html>");

    await generateNewsletterEmail(baseCampaign);

    const message = generateEmailHtml.mock.calls[0][1];
    expect(message).toContain(
      "cutoutImageUrl (same product, background removed): https://cdn.example.com/linen-cutout.png",
    );
    expect(message).not.toContain("cutoutImageUrl: null");
    // Cedar Tray has no cutout — its line shouldn't mention cutoutImageUrl at all.
    const cedarLine = message
      .split("\n")
      .find((line: string) => line.startsWith("- Cedar Tray"));
    expect(cedarLine).not.toContain("cutoutImageUrl");
  });

  it("explicitly prevents product invention when the product list is empty", async () => {
    generateEmailHtml.mockResolvedValue("<!DOCTYPE html><html></html>");

    await generateNewsletterEmail({ ...baseCampaign, products: [] });

    const message = generateEmailHtml.mock.calls[0][1];
    expect(message).toContain("No products supplied — do not invent any.");
    expect(message).not.toContain(": null");
    expect(message).not.toContain('href="#"');
  });

  it("lists generated photos and product facts only when supplied", async () => {
    generateEmailHtml.mockResolvedValue("<!DOCTYPE html><html></html>");

    await generateNewsletterEmail(baseCampaign);
    const plain = generateEmailHtml.mock.calls[0][1];
    expect(plain).not.toContain("Photographs generated for this campaign");
    expect(plain).not.toContain("product type:");

    await generateNewsletterEmail({
      ...baseCampaign,
      products: [{ ...baseCampaign.products[0], productType: "Throw", description: "Stonewashed linen." }],
      generatedImages: [
        {
          key: "hero-bed",
          url: "https://cdn.example.com/hero.jpg",
          alt: "Linen on a sunlit bed",
          role: "hero",
          width: 1024,
          height: 1536,
          productIds: [],
        },
      ],
      concept: "Slow linen mornings",
      sections: [
        { type: "hero-photo", purpose: "Open on the bed scene.", productIds: [], imageKey: "hero-bed" },
        { type: "category-chips", purpose: "Browse by room.", productIds: [], imageKey: null },
      ],
      collections: [{ title: "Bedroom", url: "https://shop.example.com/collections/bedroom" }],
      storefrontUrl: "https://shop.example.com",
    });
    const withPhotos = generateEmailHtml.mock.calls[1][1];
    expect(withPhotos).toContain("product type: Throw");
    expect(withPhotos).toContain("merchant's description: Stonewashed linen.");
    expect(withPhotos).toContain(
      "- key hero-bed: hero photo (1024x1536): https://cdn.example.com/hero.jpg; alt: Linen on a sunlit bed; shows no product",
    );
    expect(withPhotos).toContain("concept: Slow linen mornings");
    expect(withPhotos).toContain("1. hero-photo — Open on the bed scene.; photo: hero-bed");
    expect(withPhotos).toContain("2. category-chips — Browse by room.");
    expect(withPhotos).toContain('Collection "Bedroom": https://shop.example.com/collections/bedroom');
    expect(withPhotos).toContain("Storefront homepage: https://shop.example.com");
    expect(plain).not.toContain("Art director's section plan");
    expect(plain).not.toContain("Other real destinations");
  });

  it("wears an approved brand under the merchant's name, never the direction name", async () => {
    generateEmailHtml.mockResolvedValue("<!DOCTYPE html><html></html>");

    await generateNewsletterEmail({
      ...baseCampaign,
      shopName: "Lumen",
      brandIdentity: {
        system: {
          name: "Weathered Almanac",
          audience: "Skincare minimalists",
          feeling: "Quiet",
          palette: { paper: "#f7f2ea", ink: "#231f1c", primary: "#5d6b4f", accent: "#a45a3c" },
          typography: { display: "Serif", body: "Sans", fallback: "Georgia" },
          voice: { principles: [], preferredWords: [], avoidWords: [] },
          layoutRules: [],
          imageTreatment: "Warm window light",
          buttonTreatment: "Pill",
          signatureMotif: "Leaf",
        },
        logoUrl: "https://cdn.example.com/logo.png",
        referenceRecipe: null,
      },
    });

    const message = generateEmailHtml.mock.calls[0][1];
    expect(message).toContain('The brand\'s name is exactly "Lumen"');
    expect(message).toContain("https://cdn.example.com/logo.png");
    expect(message).toContain("Warm window light");
    expect(message).not.toContain("Weathered Almanac");
    expect(message).not.toContain("Invent a tasteful, editorial brand skin");
  });
});
