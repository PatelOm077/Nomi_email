import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateShippingUpdateEmail } from "./generate-shipping-update-email";
import { SHIPPING_UPDATE_SKELETON_PROMPT } from "./shipping-update-prompt";
import type { ShippingUpdate } from "./types";

const generateEmailHtml = vi.hoisted(() => vi.fn());

vi.mock("./generate-email", () => ({ generateEmailHtml }));

const baseUpdate: ShippingUpdate = {
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
  fulfillmentStatus: "out for delivery",
  trackingNumber: "TRACK-1042",
  carrierName: "Blue Dart",
  trackingUrl: "https://carrier.example.com/track/TRACK-1042",
  estimatedDelivery: "August 20",
  language: "de",
  tone: "calm-minimal",
};

describe("generateShippingUpdateEmail", () => {
  beforeEach(() => {
    generateEmailHtml.mockReset();
  });

  it("maps the neutral shipping shape into the shared generator call", async () => {
    generateEmailHtml.mockResolvedValue("<!DOCTYPE html><html></html>");

    await expect(generateShippingUpdateEmail(baseUpdate)).resolves.toBe(
      "<!DOCTYPE html><html></html>",
    );

    expect(generateEmailHtml).toHaveBeenCalledOnce();
    const [skeleton, message, language, tone] = generateEmailHtml.mock.calls[0];

    expect(skeleton).toBe(SHIPPING_UPDATE_SKELETON_PROMPT);
    expect(language).toBe("de");
    expect(tone).toBe("calm-minimal");
    expect(message).toContain("Shop: Paper Boat Goods");
    expect(message).toContain("Customer first name: Mina");
    expect(message).toContain("Order: #1042");
    expect(message).toContain("Fulfillment status: out for delivery");
    expect(message).toContain("Linen Throw × 2");
    expect(message).toContain("https://cdn.example.com/linen.jpg");
    expect(message).toContain("Cedar Tray × 1");
    expect(message).toContain("Tracking number: TRACK-1042");
    expect(message).toContain("Carrier: Blue Dart");
    expect(message).toContain(
      "Tracking URL: https://carrier.example.com/track/TRACK-1042",
    );
    expect(message).toContain("Estimated delivery: August 20");
  });

  it("turns null shipment facts into explicit omission instructions", async () => {
    generateEmailHtml.mockResolvedValue("<!DOCTYPE html><html></html>");

    await generateShippingUpdateEmail({
      ...baseUpdate,
      customerFirstName: null,
      trackingNumber: null,
      carrierName: null,
      trackingUrl: null,
      estimatedDelivery: null,
    });

    const message = generateEmailHtml.mock.calls[0][1];
    expect(message).toContain("Customer first name: not given");
    expect(message).toContain("write a name-free headline");
    expect(message).toContain("Tracking number: not given");
    expect(message).toContain("Carrier: not given");
    expect(message).toContain(
      "Tracking URL: not given — omit the call-to-action button entirely",
    );
    expect(message).toContain("Estimated delivery: not given");
    expect(message).not.toContain("Customer first name: there");
    expect(message).not.toContain(": null");
    expect(message).not.toContain('href="#"');
    expect(message).not.toContain("image: null");
  });
});
