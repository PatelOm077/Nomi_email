import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateRefundConfirmationEmail } from "./generate-refund-confirmation-email";
import { REFUND_CONFIRMATION_SKELETON_PROMPT } from "./refund-confirmation-prompt";
import type { RefundConfirmation } from "./types";

const generateEmailHtml = vi.hoisted(() => vi.fn());

vi.mock("./generate-email", () => ({ generateEmailHtml }));

const baseRefund: RefundConfirmation = {
  shopName: "Paper Boat Goods",
  customerFirstName: "Mina",
  orderNumber: "#1042",
  lineItems: [
    {
      title: "Linen Throw",
      quantity: 1,
      price: "₹3,200.00",
      imageUrl: "https://cdn.example.com/linen.jpg",
    },
    { title: "Cedar Tray", quantity: 1, imageUrl: null },
  ],
  refundedTotal: "₹3,200.00",
  reason: "Item arrived damaged",
  language: "hi",
  tone: "calm-minimal",
};

describe("generateRefundConfirmationEmail", () => {
  beforeEach(() => {
    generateEmailHtml.mockReset();
  });

  it("maps the neutral refund shape into the shared generator call", async () => {
    generateEmailHtml.mockResolvedValue("<!DOCTYPE html><html></html>");

    await expect(generateRefundConfirmationEmail(baseRefund)).resolves.toBe(
      "<!DOCTYPE html><html></html>",
    );

    expect(generateEmailHtml).toHaveBeenCalledOnce();
    const [skeleton, message, language, tone] = generateEmailHtml.mock.calls[0];

    expect(skeleton).toBe(REFUND_CONFIRMATION_SKELETON_PROMPT);
    expect(language).toBe("hi");
    expect(tone).toBe("calm-minimal");
    expect(message).toContain("Shop: Paper Boat Goods");
    expect(message).toContain("Customer first name: Mina");
    expect(message).toContain("Order: #1042");
    expect(message).toContain("Linen Throw × 1 — ₹3,200.00");
    expect(message).toContain("https://cdn.example.com/linen.jpg");
    expect(message).toContain("Cedar Tray × 1");
    expect(message).toContain("Refunded total: ₹3,200.00");
    expect(message).toContain("Refund reason: Item arrived damaged");
  });

  it("turns null refund facts into explicit omission instructions", async () => {
    generateEmailHtml.mockResolvedValue("<!DOCTYPE html><html></html>");

    await generateRefundConfirmationEmail({
      ...baseRefund,
      customerFirstName: null,
      reason: null,
    });

    const message = generateEmailHtml.mock.calls[0][1];
    expect(message).toContain(
      "Customer first name: not given — write a name-free headline",
    );
    expect(message).toContain(
      "Refund reason: not given — omit the reason entirely",
    );
    expect(message).not.toContain("Customer first name: there");
    expect(message).not.toContain(": null");
    expect(message).not.toContain("— undefined");
    expect(message).not.toContain("image: null");
  });
});
