import { beforeEach, describe, expect, it, vi } from "vitest";
import { ABANDONED_CART_SKELETON_PROMPT } from "./abandoned-cart-prompt";
import { generateAbandonedCartEmail } from "./generate-abandoned-cart-email";
import type { AbandonedCartRecovery } from "./types";

const generateEmailHtml = vi.hoisted(() => vi.fn());

vi.mock("./generate-email", () => ({ generateEmailHtml }));

const baseCart: AbandonedCartRecovery = {
  shopName: "Paper Boat Goods",
  customerFirstName: "Mina",
  lineItems: [
    {
      title: "Linen Throw",
      quantity: 2,
      price: "₹3,200.00",
      imageUrl: "https://cdn.example.com/linen.jpg",
    },
    {
      title: "Cedar Tray",
      quantity: 1,
      price: "₹1,100.00",
      imageUrl: null,
    },
  ],
  total: "₹7,500.00",
  recoveryUrl: "https://shop.example.com/checkouts/recover/abc123",
  language: "es",
  tone: "bright-bubbly",
};

describe("generateAbandonedCartEmail", () => {
  beforeEach(() => {
    generateEmailHtml.mockReset();
  });

  it("maps the neutral cart shape into the shared generator call", async () => {
    generateEmailHtml.mockResolvedValue("<!DOCTYPE html><html></html>");

    await expect(generateAbandonedCartEmail(baseCart)).resolves.toBe(
      "<!DOCTYPE html><html></html>",
    );

    expect(generateEmailHtml).toHaveBeenCalledOnce();
    const [skeleton, message, language, tone] = generateEmailHtml.mock.calls[0];

    expect(skeleton).toBe(ABANDONED_CART_SKELETON_PROMPT);
    expect(language).toBe("es");
    expect(tone).toBe("bright-bubbly");
    expect(message).toContain("Shop: Paper Boat Goods");
    expect(message).toContain("Customer first name: Mina");
    expect(message).toContain("Linen Throw × 2 — ₹3,200.00");
    expect(message).toContain("https://cdn.example.com/linen.jpg");
    expect(message).toContain("Cedar Tray × 1 — ₹1,100.00");
    expect(message).toContain("Cart total: ₹7,500.00");
    expect(message).toContain(
      "Recovery URL: https://shop.example.com/checkouts/recover/abc123",
    );
  });

  it("preserves a missing customer name as an explicit name-free fallback", async () => {
    generateEmailHtml.mockResolvedValue("<!DOCTYPE html><html></html>");

    await generateAbandonedCartEmail({
      ...baseCart,
      customerFirstName: null,
    });

    const message = generateEmailHtml.mock.calls[0][1];
    expect(message).toContain("Customer first name: not given");
    expect(message).toContain("write a name-free hook");
    expect(message).not.toContain("Customer first name: null");
    expect(message).not.toContain("Customer first name: there");
    expect(message).not.toContain("image: null");
  });
});
