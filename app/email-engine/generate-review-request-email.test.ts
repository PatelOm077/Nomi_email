import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateReviewRequestEmail } from "./generate-review-request-email";
import { REVIEW_REQUEST_SKELETON_PROMPT } from "./review-request-prompt";
import type { ReviewRequest } from "./types";

const generateEmailHtml = vi.hoisted(() => vi.fn());

vi.mock("./generate-email", () => ({ generateEmailHtml }));

const baseRequest: ReviewRequest = {
  shopName: "Paper Boat Goods",
  customerFirstName: "Mina",
  orderNumber: "#1042",
  lineItems: [
    {
      title: "Linen Throw",
      quantity: 2,
      imageUrl: "https://cdn.example.com/linen.jpg",
    },
    { title: "Cedar Tray", quantity: 1, imageUrl: null },
  ],
  reviewUrl: "https://shop.example.com/products/linen-throw",
  language: "fr",
  tone: "warm-plain",
};

describe("generateReviewRequestEmail", () => {
  beforeEach(() => {
    generateEmailHtml.mockReset();
  });

  it("maps the neutral review shape into the shared generator call", async () => {
    generateEmailHtml.mockResolvedValue("<!DOCTYPE html><html></html>");

    await expect(generateReviewRequestEmail(baseRequest)).resolves.toBe(
      "<!DOCTYPE html><html></html>",
    );

    expect(generateEmailHtml).toHaveBeenCalledOnce();
    const [skeleton, message, language, tone] = generateEmailHtml.mock.calls[0];

    expect(skeleton).toBe(REVIEW_REQUEST_SKELETON_PROMPT);
    expect(language).toBe("fr");
    expect(tone).toBe("warm-plain");
    expect(message).toContain("Shop: Paper Boat Goods");
    expect(message).toContain("Customer first name: Mina");
    expect(message).toContain("Order: #1042");
    expect(message).toContain("Linen Throw × 2");
    expect(message).toContain("https://cdn.example.com/linen.jpg");
    expect(message).toContain("Cedar Tray × 1");
    expect(message).toContain(
      "Review URL: https://shop.example.com/products/linen-throw",
    );
  });

  it("turns null review facts into explicit name-free and no-CTA instructions", async () => {
    generateEmailHtml.mockResolvedValue("<!DOCTYPE html><html></html>");

    await generateReviewRequestEmail({
      ...baseRequest,
      customerFirstName: null,
      reviewUrl: null,
    });

    const message = generateEmailHtml.mock.calls[0][1];
    expect(message).toContain("Customer first name: not given");
    expect(message).toContain("write a name-free headline");
    expect(message).toContain(
      "Review URL: not given — omit the call-to-action button entirely",
    );
    expect(message).not.toContain("Customer first name: there");
    expect(message).not.toContain(": null");
    expect(message).not.toContain('href="#"');
    expect(message).not.toContain("image: null");
  });
});
