import { beforeEach, describe, expect, it, vi } from "vitest";
import { action } from "../routes/webhooks.email-events";

const mocks = vi.hoisted(() => ({
  authenticateWebhook: vi.fn(),
  enqueueEmailJob: vi.fn(),
}));

vi.mock("../shopify.server", () => ({
  authenticate: { webhook: mocks.authenticateWebhook },
}));
vi.mock("./queue.server", () => ({
  enqueueEmailJob: mocks.enqueueEmailJob,
}));

function webhookRequest() {
  return new Request("https://nomi.example.com/webhooks/email-events", {
    method: "POST",
  });
}

describe("webhooks.email-events action", () => {
  beforeEach(() => {
    mocks.authenticateWebhook.mockReset();
    mocks.enqueueEmailJob.mockReset();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  it("returns without enqueueing when Shopify provides no session", async () => {
    const request = webhookRequest();
    mocks.authenticateWebhook.mockResolvedValue({
      payload: { id: 1042 },
      session: undefined,
      shop: "paper-boat.myshopify.com",
      topic: "ORDERS_CREATE",
      webhookId: "webhook-1",
    });

    const response = await action({ request } as never);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
    expect(mocks.authenticateWebhook).toHaveBeenCalledWith(request);
    expect(mocks.enqueueEmailJob).not.toHaveBeenCalled();
  });

  it("passes authenticated Shopify webhook facts to the queue", async () => {
    const request = webhookRequest();
    const payload = { id: 501, order_id: 1042 };
    mocks.authenticateWebhook.mockResolvedValue({
      payload,
      session: { id: "offline_paper-boat.myshopify.com" },
      shop: "paper-boat.myshopify.com",
      topic: "FULFILLMENTS_CREATE",
      webhookId: "webhook-501",
    });
    mocks.enqueueEmailJob.mockResolvedValue("queued");

    const response = await action({ request } as never);

    expect(response.status).toBe(200);
    expect(mocks.enqueueEmailJob).toHaveBeenCalledOnce();
    expect(mocks.enqueueEmailJob).toHaveBeenCalledWith({
      webhookId: "webhook-501",
      shop: "paper-boat.myshopify.com",
      topic: "FULFILLMENTS_CREATE",
      payload,
    });
    expect(console.log).toHaveBeenCalledWith(
      "Email event webhook-501 for paper-boat.myshopify.com: queued",
    );
  });
});
