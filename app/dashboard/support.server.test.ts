import { randomUUID } from "node:crypto";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  readConversation,
  replyAsOperator,
  supportInput,
  writeSupport,
} from "../support/conversations.server";
import { processSupportNotifications } from "../support/notifications.server";
import {
  isOperator,
  operatorCookie,
  validOperatorPassword,
} from "../support/operator-auth.server";

let client: PrismaClient;
let directory: string;
beforeAll(async () => {
  // Default answers come from the guides; no model call from tests.
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  directory = await mkdtemp(join(tmpdir(), "nomi-support-test-"));
  client = new PrismaClient({
    datasourceUrl: `file:${join(directory, "test.sqlite").replace(/\\/g, "/")}`,
  });
  for (const name of [
    "20260928120000_support_conversations",
    "20260928123000_support_notifications",
    "20260928170000_support_reply_alerts",
  ]) {
    const sql = await readFile(
      `prisma/migrations/${name}/migration.sql`,
      "utf8",
    );
    for (const statement of sql.split(";").filter((part) => part.trim()))
      await client.$executeRawUnsafe(statement);
  }
});
afterAll(async () => {
  await client.$disconnect();
  await rm(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe("support persistence", () => {
  it("isolates shops, saves answers and deduplicates a retry", async () => {
    const input = {
      intent: "message" as const,
      body: "How do I set up my theme?",
      requestId: randomUUID(),
    };
    await writeSupport("a.myshopify.com", input, client);
    await writeSupport("a.myshopify.com", input, client);
    expect(
      (await readConversation("a.myshopify.com", client))?.messages,
    ).toHaveLength(2);
    expect(await readConversation("b.myshopify.com", client)).toBeNull();
    await writeSupport("b.myshopify.com", input, client);
    expect(
      (await readConversation("b.myshopify.com", client))?.messages,
    ).toHaveLength(2);
  });
  it("queues human handoff once and stops automated replies", async () => {
    const input = {
      intent: "request-help" as const,
      email: "merchant@example.com",
      requestId: randomUUID(),
    };
    await writeSupport("a.myshopify.com", input, client);
    await writeSupport("a.myshopify.com", input, client);
    expect(await client.supportNotification.count()).toBe(1);
    const result = await writeSupport(
      "a.myshopify.com",
      { intent: "message", body: "Still need help", requestId: randomUUID() },
      client,
    );
    expect(result?.status).toBe("waiting");
    expect(result?.messages.at(-1)?.role).toBe("merchant");
    expect(await client.supportNotification.count()).toBe(2);
  });
  it("rate limits per shop and rejects invalid input", async () => {
    for (let i = 0; i < 12; i++)
      await writeSupport(
        "limited.myshopify.com",
        { intent: "message", body: "Help", requestId: randomUUID() },
        client,
      );
    await expect(
      writeSupport(
        "limited.myshopify.com",
        { intent: "message", body: "Help", requestId: randomUUID() },
        client,
      ),
    ).rejects.toThrow("SUPPORT_RATE_LIMIT");
    expect(
      supportInput.safeParse({
        intent: "message",
        body: " ",
        requestId: randomUUID(),
      }).success,
    ).toBe(false);
    expect(
      supportInput.safeParse({
        intent: "message",
        body: "a".repeat(2001),
        requestId: randomUUID(),
      }).success,
    ).toBe(false);
    expect(
      supportInput.safeParse({
        intent: "request-help",
        email: "bad",
        requestId: randomUUID(),
      }).success,
    ).toBe(false);
  });
  it("reopens resolved requests and cascades removal", async () => {
    await client.supportConversation.update({
      where: { shop: "a.myshopify.com" },
      data: { status: "resolved" },
    });
    const result = await writeSupport(
      "a.myshopify.com",
      { intent: "message", body: "Another detail", requestId: randomUUID() },
      client,
    );
    expect(result?.status).toBe("waiting");
    const conversation = await client.supportConversation.findUniqueOrThrow({
      where: { shop: "b.myshopify.com" },
    });
    await client.supportConversation.delete({ where: { id: conversation.id } });
    expect(
      await client.supportMessage.count({
        where: { conversationId: conversation.id },
      }),
    ).toBe(0);
  });
});

describe("assistant answers", () => {
  it("answers with the given history outside the save, once per request", async () => {
    const answer = vi.fn(async ({ history }: { history: { role: string; body: string }[] }) =>
      `You asked: ${history.at(-1)?.body}`,
    );
    const input = { intent: "message" as const, body: "Can I change the tone?", requestId: randomUUID() };
    await writeSupport("ai.myshopify.com", input, client, answer);
    const result = await writeSupport("ai.myshopify.com", input, client, answer);
    expect(answer).toHaveBeenCalledOnce();
    expect(answer.mock.calls[0][0].history.at(-1)).toMatchObject({ role: "merchant", body: "Can I change the tone?" });
    expect(result?.messages.map(({ role, body }) => [role, body])).toEqual([
      ["merchant", "Can I change the tone?"],
      ["assistant", "You asked: Can I change the tone?"],
    ]);
  });
  it("answers a retried request whose answer never landed", async () => {
    const input = { intent: "message" as const, body: "Where are my flows?", requestId: randomUUID() };
    await expect(
      writeSupport("retry.myshopify.com", input, client, async () => {
        throw new Error("timeout");
      }),
    ).rejects.toThrow("timeout");
    const result = await writeSupport("retry.myshopify.com", input, client, async () => "Open Flow Editor.");
    expect(result?.messages.map(({ role }) => role)).toEqual(["merchant", "assistant"]);
  });
  it("stops answering once the team is involved", async () => {
    const answer = vi.fn(async () => "AI");
    await writeSupport("human.myshopify.com", { intent: "request-help", email: "owner@example.com", requestId: randomUUID() }, client, answer);
    await writeSupport("human.myshopify.com", { intent: "message", body: "More detail", requestId: randomUUID() }, client, answer);
    expect(answer).not.toHaveBeenCalled();
  });
});

describe("team replies", () => {
  it("shows the reply, queues one merchant email, and deduplicates a resubmit", async () => {
    const conversation = await client.supportConversation.findUniqueOrThrow({ where: { shop: "human.myshopify.com" } });
    const requestId = randomUUID();
    await replyAsOperator(conversation.id, "Sending is off. Turn it on in Brand & Settings.", requestId, client);
    await replyAsOperator(conversation.id, "Sending is off. Turn it on in Brand & Settings.", requestId, client);
    const read = await readConversation("human.myshopify.com", client);
    expect(read?.status).toBe("replied");
    expect(read?.messages.filter(({ role }) => role === "agent")).toHaveLength(1);
    expect(
      await client.supportNotification.findMany({ where: { conversationId: conversation.id, recipient: "owner@example.com" } }),
    ).toHaveLength(1);
  });
});

describe("email outbox", () => {
  it("keeps alerts pending without configuration", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const send = vi.fn();
    expect(await processSupportNotifications(client, send)).toEqual({
      sent: 0,
      configured: false,
    });
    expect(send).not.toHaveBeenCalled();
  });
  it("retries failures, escapes content, sends to the authorized address and deduplicates workers", async () => {
    vi.stubEnv("RESEND_API_KEY", "test");
    vi.stubEnv("NOMI_FROM_EMAIL", "test@example.com");
    vi.stubEnv("NOMI_SUPPORT_EMAIL", "");
    const failed = vi.fn().mockRejectedValue(new Error("offline"));
    await processSupportNotifications(client, failed);
    expect(
      await client.supportNotification.count({ where: { status: "pending" } }),
    ).toBeGreaterThan(0);
    await client.supportNotification.updateMany({
      data: { availableAt: new Date(0), body: "<script>bad</script>" },
    });
    const send = vi.fn().mockResolvedValue("provider-id");
    await processSupportNotifications(client, send);
    expect(send.mock.calls[0][0].to).toBe("ombarvaliya7@gmail.com");
    expect(send.mock.calls[0][0].html).toContain("&lt;script&gt;");
    expect(send.mock.calls[0][0].html).not.toContain("<script>");
    send.mockClear();
    await processSupportNotifications(client, send);
    expect(send).not.toHaveBeenCalled();
  });
  it("emails the merchant a reply notice with a link back into Nomi", async () => {
    vi.stubEnv("RESEND_API_KEY", "test");
    vi.stubEnv("NOMI_FROM_EMAIL", "test@example.com");
    vi.stubEnv("SHOPIFY_API_KEY", "key123");
    const conversation = await client.supportConversation.findUniqueOrThrow({ where: { shop: "a.myshopify.com" } });
    await client.supportNotification.updateMany({ data: { status: "sent" } });
    await client.supportNotification.create({
      data: { conversationId: conversation.id, requestId: randomUUID(), recipient: "merchant@example.com", body: "Try <b>this</b>" },
    });
    const send = vi.fn().mockResolvedValue("provider-id");
    await processSupportNotifications(client, send);
    const email = send.mock.calls.find(([message]) => message.to === "merchant@example.com")?.[0];
    expect(email.subject).toBe("The Nomi team replied");
    expect(email.html).toContain("https://a.myshopify.com/admin/apps/key123");
    expect(email.html).toContain("Try &lt;b&gt;this&lt;/b&gt;");
  });
});

describe("operator access", () => {
  it("fails closed and rejects expired or tampered sessions", async () => {
    vi.stubEnv("NOMI_SUPPORT_ADMIN_SECRET", "");
    expect(validOperatorPassword("")).toBe(false);
    vi.stubEnv("NOMI_SUPPORT_ADMIN_SECRET", "a".repeat(40));
    expect(validOperatorPassword("wrong")).toBe(false);
    expect(validOperatorPassword("a".repeat(40))).toBe(true);
    const cookie = (await operatorCookie()).split(";")[0];
    expect(
      await isOperator(
        new Request("https://nomi.example/support-inbox", {
          headers: { cookie },
        }),
      ),
    ).toBe(true);
    expect(
      await isOperator(
        new Request("https://nomi.example/support-inbox", {
          headers: { cookie: cookie + "tampered" },
        }),
      ),
    ).toBe(false);
    expect(
      await isOperator(
        new Request("https://nomi.example/support-inbox", {
          headers: { cookie: (await operatorCookie(true)).split(";")[0] },
        }),
      ),
    ).toBe(false);
  });
});
