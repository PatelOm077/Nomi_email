import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateOrderConfirmationEmail } from "./generate-order-confirmation-email";
import { ORDER_CONFIRMATION_SKELETON_PROMPT } from "./order-confirmation-prompt";
import type { OrderConfirmationOrder } from "./types";

const generateEmailHtml = vi.hoisted(() => vi.fn());

vi.mock("./generate-email", () => ({ generateEmailHtml }));

const baseOrder: OrderConfirmationOrder = {
  shopName: "Paper Boat Goods",
  customerFirstName: "Mina",
  orderNumber: "#1042",
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
  language: "en",
  tone: "warm-plain",
};

describe("generateOrderConfirmationEmail", () => {
  beforeEach(() => {
    generateEmailHtml.mockReset();
  });

  it("maps the neutral order shape into the shared generator call", async () => {
    generateEmailHtml.mockResolvedValue("<!DOCTYPE html><html></html>");

    await expect(generateOrderConfirmationEmail(baseOrder)).resolves.toBe(
      "<!DOCTYPE html><html></html>",
    );

    expect(generateEmailHtml).toHaveBeenCalledOnce();
    const [skeleton, message, language, tone] = generateEmailHtml.mock.calls[0];

    expect(skeleton).toBe(ORDER_CONFIRMATION_SKELETON_PROMPT);
    expect(language).toBe("en");
    expect(tone).toBe("warm-plain");
    expect(message).toContain("Shop: Paper Boat Goods");
    expect(message).toContain("Customer first name: Mina");
    expect(message).toContain("Order: #1042");
    expect(message).toContain("Linen Throw");
    expect(message).toContain("₹3,200.00");
    expect(message).toContain("https://cdn.example.com/linen.jpg");
    expect(message).toContain("Cedar Tray");
    expect(message).toContain("Order total: ₹7,500.00");
  });

  it("preserves a missing customer name as an explicit name-free fallback", async () => {
    generateEmailHtml.mockResolvedValue("<!DOCTYPE html><html></html>");

    await generateOrderConfirmationEmail({
      ...baseOrder,
      customerFirstName: null,
    });

    const message = generateEmailHtml.mock.calls[0][1];
    expect(message).toContain("Customer first name: not given");
    expect(message).toContain("write a name-free greeting");
    expect(message).not.toContain("Customer first name: there");
  });
});
