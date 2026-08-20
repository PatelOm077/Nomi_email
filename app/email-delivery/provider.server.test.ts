import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendEmail } from "./provider.server";

const getEmailDeliveryConfig = vi.hoisted(() => vi.fn());

vi.mock("./config.server", () => ({ getEmailDeliveryConfig }));

const baseEmail = {
  to: "mina@example.com",
  subject: "Your order is on its way",
  html: "<!DOCTYPE html><html><body>Shipped</body></html>",
  idempotencyKey: "shipping:paper-boat.myshopify.com:fulfillment-1",
};

describe("sendEmail", () => {
  beforeEach(() => {
    getEmailDeliveryConfig.mockReset();
    getEmailDeliveryConfig.mockReturnValue({
      apiKey: "resend-test-key",
      fromEmail: "mail@example.com",
      fromName: "Paper Boat",
    });
    vi.stubGlobal("fetch", vi.fn());
  });

  it("sends the provider request with the stable idempotency key", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ id: "provider-message-1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(sendEmail(baseEmail)).resolves.toBe("provider-message-1");

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer resend-test-key",
        "Content-Type": "application/json",
        "Idempotency-Key": "shipping:paper-boat.myshopify.com:fulfillment-1",
      },
      body: JSON.stringify({
        from: "Paper Boat <mail@example.com>",
        to: ["mina@example.com"],
        subject: "Your order is on its way",
        html: "<!DOCTYPE html><html><body>Shipped</body></html>",
      }),
    });
  });

  it("surfaces the provider's message when a request is rejected", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ message: "Invalid recipient" }), {
        status: 422,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(sendEmail(baseEmail)).rejects.toThrow(
      "Resend rejected the email (422): Invalid recipient",
    );
  });

  it("rejects a nominally successful response without a message ID", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ name: "missing_id" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(sendEmail(baseEmail)).rejects.toThrow(
      "Resend rejected the email (200): missing_id",
    );
  });
});
