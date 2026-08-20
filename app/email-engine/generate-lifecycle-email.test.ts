import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateLifecycleEmail } from "./generate-lifecycle-email";
import { LIFECYCLE_EMAIL_SKELETON_PROMPT } from "./lifecycle-email-prompt";
import type { LifecycleEmail } from "./types";

const generateEmailHtml = vi.hoisted(() => vi.fn());

vi.mock("./generate-email", () => ({ generateEmailHtml }));

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
    {
      title: "Stoneware Cup",
      price: "₹850.00",
      imageUrl: null,
      productUrl: "https://shop.example.com/products/stoneware-cup",
    },
    {
      title: "Extra Product",
      price: "₹500.00",
      imageUrl: null,
      productUrl: null,
    },
  ],
  orderNumber: "#1042",
  orderTotal: "₹7,500.00",
  recoveryUrl: "https://shop.example.com/checkouts/recover/abc123",
  reviewUrl: "https://shop.example.com/products/linen-throw",
  language: "ja",
  tone: "warm-plain",
};

describe("generateLifecycleEmail", () => {
  beforeEach(() => {
    generateEmailHtml.mockReset();
  });

  it("maps lifecycle context and at most three products into the generator call", async () => {
    generateEmailHtml.mockResolvedValue("<!DOCTYPE html><html></html>");

    await expect(generateLifecycleEmail(baseEmail)).resolves.toBe(
      "<!DOCTYPE html><html></html>",
    );

    expect(generateEmailHtml).toHaveBeenCalledOnce();
    const [skeleton, message, language, tone] = generateEmailHtml.mock.calls[0];

    expect(skeleton).toBe(LIFECYCLE_EMAIL_SKELETON_PROMPT);
    expect(language).toBe("ja");
    expect(tone).toBe("warm-plain");
    expect(message).toContain("Shop: Paper Boat Goods");
    expect(message).toContain("Journey: Cart recovery");
    expect(message).toContain("Email: A gentle reminder");
    expect(message).toContain("Position: 2 of 3");
    expect(message).toContain("Timing: 24 hours after checkout");
    expect(message).toContain(
      "Objective: Remind the customer what they left behind",
    );
    expect(message).toContain("Customer first name: Mina");
    expect(message).toContain("Order number: #1042");
    expect(message).toContain("Order total: ₹7,500.00");
    expect(message).toContain(
      "Real recovery URL: https://shop.example.com/checkouts/recover/abc123",
    );
    expect(message).toContain(
      "Real review URL: https://shop.example.com/products/linen-throw",
    );
    expect(message).toContain("Linen Throw — ₹3,200.00");
    expect(message).toContain("Cedar Tray — ₹1,100.00");
    expect(message).toContain("Stoneware Cup — ₹850.00");
    expect(message).not.toContain("Extra Product");
    expect(message).not.toContain("image: null");
    expect(message).not.toContain("URL: null");
  });

  it("turns null lifecycle facts into explicit non-placeholder fallbacks", async () => {
    generateEmailHtml.mockResolvedValue("<!DOCTYPE html><html></html>");

    await generateLifecycleEmail({
      ...baseEmail,
      customerFirstName: null,
      products: [],
      orderNumber: null,
      orderTotal: null,
      recoveryUrl: null,
      reviewUrl: null,
    });

    const message = generateEmailHtml.mock.calls[0][1];
    expect(message).toContain("Customer first name: not captured");
    expect(message).toContain("Order number: not supplied");
    expect(message).toContain("Order total: not supplied");
    expect(message).toContain("Real recovery URL: not supplied");
    expect(message).toContain("Real review URL: not supplied");
    expect(message).toContain("No products supplied — do not invent any.");
    expect(message).not.toContain("Customer first name: there");
    expect(message).not.toContain(": null");
    expect(message).not.toContain('href="#"');
  });
});
