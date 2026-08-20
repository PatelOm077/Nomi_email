import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateNewsletterEmail } from "./generate-newsletter-email";
import { NEWSLETTER_SKELETON_PROMPT } from "./newsletter-prompt";
import type { NewsletterCampaign } from "./types";

const generateEmailHtml = vi.hoisted(() => vi.fn());

vi.mock("./generate-email", () => ({ generateEmailHtml }));

const baseCampaign: NewsletterCampaign = {
  shopName: "Paper Boat Goods",
  prompt: "A Diwali sale with 15% off linen for this weekend only",
  products: [
    {
      title: "Linen Throw",
      price: "₹3,200.00",
      imageUrl: "https://cdn.example.com/linen.jpg",
      productUrl: "https://shop.example.com/products/linen-throw",
    },
    {
      title: "Cedar Tray",
      price: "₹1,100.00",
      imageUrl: null,
      productUrl: null,
    },
  ],
  language: "pt",
  tone: "bright-bubbly",
};

describe("generateNewsletterEmail", () => {
  beforeEach(() => {
    generateEmailHtml.mockReset();
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
  });

  it("explicitly prevents product invention when the product list is empty", async () => {
    generateEmailHtml.mockResolvedValue("<!DOCTYPE html><html></html>");

    await generateNewsletterEmail({ ...baseCampaign, products: [] });

    const message = generateEmailHtml.mock.calls[0][1];
    expect(message).toContain("No products supplied — do not invent any.");
    expect(message).not.toContain(": null");
    expect(message).not.toContain('href="#"');
  });
});
