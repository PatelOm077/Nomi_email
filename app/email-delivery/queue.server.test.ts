import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { enqueueEmailJob } from "./queue.server";

const db = vi.hoisted(() => ({
  shopSettings: { findUnique: vi.fn() },
  emailJob: {
    create: vi.fn(),
    findUnique: vi.fn(),
    updateMany: vi.fn(),
    upsert: vi.fn(),
  },
}));

vi.mock("../db.server", () => ({ default: db }));

const baseInput = {
  webhookId: "webhook-123",
  shop: "paper-boat.myshopify.com",
  topic: "FULFILLMENTS_CREATE",
  payload: { id: 42, order_id: 1042 },
};

describe("enqueueEmailJob", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-19T12:00:00.000Z"));
    db.shopSettings.findUnique.mockReset();
    db.emailJob.create.mockReset();
    db.emailJob.findUnique.mockReset();
    db.emailJob.updateMany.mockReset();
    db.emailJob.upsert.mockReset();
  });

  it("does not enqueue when sending is disabled or settings are absent", async () => {
    db.shopSettings.findUnique.mockResolvedValue(null);

    await expect(enqueueEmailJob(baseInput)).resolves.toBe("disabled");

    expect(db.emailJob.create).not.toHaveBeenCalled();
  });

  it("queues an ordinary webhook with a serialized payload", async () => {
    db.shopSettings.findUnique.mockResolvedValue({
      sendingEnabled: true,
      sendReceiptEmails: false,
    });
    db.emailJob.create.mockResolvedValue({ id: "job-1" });

    await expect(enqueueEmailJob(baseInput)).resolves.toBe("queued");

    expect(db.emailJob.create).toHaveBeenCalledWith({
      data: {
        webhookId: "webhook-123",
        shop: "paper-boat.myshopify.com",
        topic: "FULFILLMENTS_CREATE",
        payload: JSON.stringify({ id: 42, order_id: 1042 }),
      },
    });
  });

  it("returns duplicate for Prisma's unique-key error", async () => {
    db.shopSettings.findUnique.mockResolvedValue({
      sendingEnabled: true,
      sendReceiptEmails: false,
    });
    db.emailJob.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
      }),
    );

    await expect(enqueueEmailJob(baseInput)).resolves.toBe("duplicate");
  });

  it("does not swallow non-idempotency database errors", async () => {
    db.shopSettings.findUnique.mockResolvedValue({
      sendingEnabled: true,
      sendReceiptEmails: false,
    });
    db.emailJob.create.mockRejectedValue(new Error("database unavailable"));

    await expect(enqueueEmailJob(baseInput)).rejects.toThrow(
      "database unavailable",
    );
  });

  it("cancels pending cart recovery even when receipt emails are disabled", async () => {
    db.shopSettings.findUnique.mockResolvedValue({
      sendingEnabled: true,
      sendReceiptEmails: false,
    });
    db.emailJob.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      enqueueEmailJob({
        ...baseInput,
        topic: "ORDERS_CREATE",
        payload: { id: 1042, checkout_token: "checkout-token" },
      }),
    ).resolves.toBe("disabled");

    expect(db.emailJob.updateMany).toHaveBeenCalledWith({
      where: {
        webhookId: "checkout:paper-boat.myshopify.com:checkout-token",
        status: "pending",
      },
      data: { status: "skipped", lastError: "Checkout completed." },
    });
    expect(db.emailJob.create).not.toHaveBeenCalled();
  });

  it("requires the narrower opt-in for duplicate-risk receipt topics", async () => {
    db.shopSettings.findUnique.mockResolvedValue({
      sendingEnabled: true,
      sendReceiptEmails: false,
    });

    await expect(
      enqueueEmailJob({ ...baseInput, topic: "REFUNDS_CREATE" }),
    ).resolves.toBe("disabled");

    expect(db.emailJob.create).not.toHaveBeenCalled();
  });

  it.each([
    [
      "missing token",
      { email: "mina@example.com", buyer_accepts_marketing: true },
    ],
    ["missing email", { token: "token-1", buyer_accepts_marketing: true }],
    [
      "completed checkout",
      {
        token: "token-1",
        email: "mina@example.com",
        buyer_accepts_marketing: true,
        completed_at: "2026-08-19T11:00:00Z",
      },
    ],
    [
      "closed checkout",
      {
        token: "token-1",
        email: "mina@example.com",
        buyer_accepts_marketing: true,
        closed_at: "2026-08-19T11:00:00Z",
      },
    ],
    [
      "no marketing consent",
      {
        token: "token-1",
        email: "mina@example.com",
        buyer_accepts_marketing: false,
      },
    ],
  ])("ignores an ineligible checkout with %s", async (_label, payload) => {
    db.shopSettings.findUnique.mockResolvedValue({
      sendingEnabled: true,
      sendReceiptEmails: false,
    });

    await expect(
      enqueueEmailJob({ ...baseInput, topic: "CHECKOUTS_UPDATE", payload }),
    ).resolves.toBe("ignored");

    expect(db.emailJob.findUnique).not.toHaveBeenCalled();
    expect(db.emailJob.upsert).not.toHaveBeenCalled();
  });

  it("resets an eligible checkout's stable delayed job", async () => {
    db.shopSettings.findUnique.mockResolvedValue({
      sendingEnabled: true,
      sendReceiptEmails: false,
    });
    db.emailJob.findUnique.mockResolvedValue({ status: "pending" });
    db.emailJob.upsert.mockResolvedValue({ id: "cart-job" });
    const payload = {
      token: "token-1",
      email: "mina@example.com",
      buyer_accepts_marketing: true,
      completed_at: null,
      closed_at: null,
    };

    await expect(
      enqueueEmailJob({ ...baseInput, topic: "CHECKOUTS_UPDATE", payload }),
    ).resolves.toBe("queued");

    const webhookId = "checkout:paper-boat.myshopify.com:token-1";
    const availableAt = new Date("2026-08-19T13:00:00.000Z");
    expect(db.emailJob.upsert).toHaveBeenCalledWith({
      where: { webhookId },
      create: {
        webhookId,
        shop: "paper-boat.myshopify.com",
        topic: "CHECKOUTS_UPDATE",
        payload: JSON.stringify(payload),
        availableAt,
      },
      update: {
        payload: JSON.stringify(payload),
        status: "pending",
        attempts: 0,
        lastError: null,
        availableAt,
      },
    });
  });

  it("does not restart a checkout recovery job that was already sent", async () => {
    db.shopSettings.findUnique.mockResolvedValue({
      sendingEnabled: true,
      sendReceiptEmails: false,
    });
    db.emailJob.findUnique.mockResolvedValue({ status: "sent" });

    await expect(
      enqueueEmailJob({
        ...baseInput,
        topic: "CHECKOUTS_UPDATE",
        payload: {
          token: "token-1",
          email: "mina@example.com",
          buyer_accepts_marketing: true,
        },
      }),
    ).resolves.toBe("duplicate");

    expect(db.emailJob.upsert).not.toHaveBeenCalled();
  });
});
