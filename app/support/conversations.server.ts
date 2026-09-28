import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import db from "../db.server";
import { aiSupportAnswer, type SupportAnswer } from "./assistant.server";

export const supportInput = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("message"),
    body: z.string().trim().min(1).max(2000),
    requestId: z.string().uuid(),
  }),
  z.object({
    intent: z.literal("request-help"),
    email: z.email().max(254),
    requestId: z.string().uuid(),
  }),
]);

export async function readConversation(
  shop: string,
  client: PrismaClient = db,
) {
  const conversation = await client.supportConversation.findUnique({
    where: { shop },
    include: {
      messages: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100 },
    },
  });
  if (!conversation) return null;
  return {
    id: conversation.id,
    email: conversation.email,
    status: conversation.status,
    messages: conversation.messages.reverse().map((message) => ({
      id: message.id,
      role: message.role,
      body: message.body,
      createdAt: message.createdAt.toISOString(),
    })),
  };
}

export async function writeSupport(
  shop: string,
  input: z.infer<typeof supportInput>,
  client: PrismaClient = db,
  answer: SupportAnswer = aiSupportAnswer,
) {
  const requestId = `${shop}:${input.requestId}`;
  // A transaction makes retries and concurrent requests safe, including the rate limit.
  await client.$transaction(async (tx) => {
    if (await tx.supportMessage.findUnique({ where: { requestId } })) return;
    const conversation = await tx.supportConversation.upsert({
      where: { shop },
      create: { shop },
      update: {},
    });
    const recent = await tx.supportMessage.count({
      where: {
        conversationId: conversation.id,
        role: { in: ["merchant", "system"] },
        createdAt: { gte: new Date(Date.now() - 60_000) },
      },
    });
    if (recent >= 12) throw new Error("SUPPORT_RATE_LIMIT");
    if (input.intent === "request-help") {
      await tx.supportConversation.update({
        where: { id: conversation.id },
        data: { email: input.email, status: "waiting" },
      });
      await tx.supportMessage.create({
        data: {
          conversationId: conversation.id,
          requestId,
          role: "system",
          body: "Your request is saved for the Nomi team. Replies will appear here. You can add more details below.",
        },
      });
      const transcript = await tx.supportMessage.findMany({
        where: { conversationId: conversation.id },
        orderBy: { createdAt: "desc" },
        take: 20,
      });
      await tx.supportNotification.create({
        data: {
          conversationId: conversation.id,
          requestId,
          body: `Reply contact: ${input.email}\n\n${transcript
            .reverse()
            .map((message) => `${message.role}: ${message.body}`)
            .join("\n\n")}`,
        },
      });
      return;
    }
    await tx.supportMessage.create({
      data: {
        conversationId: conversation.id,
        requestId,
        role: "merchant",
        body: input.body,
      },
    });
    if (conversation.status !== "automated") {
      await tx.supportNotification.create({
        data: {
          conversationId: conversation.id,
          requestId,
          body: `Reply contact: ${conversation.email ?? "Not provided"}\n\n${input.body}`,
        },
      });
    }
    await tx.supportConversation.update({
      where: { id: conversation.id },
      data: {
        updatedAt: new Date(),
        ...(conversation.status !== "automated" ? { status: "waiting" } : {}),
      },
    });
  });

  // The assistant answers outside the transaction: a model call must never
  // hold the SQLite write lock. A retried request whose answer never landed
  // (timeout, crash) gets answered now; one that already has it doesn't.
  if (input.intent === "message") {
    const conversation = await client.supportConversation.findUnique({
      where: { shop },
      include: {
        messages: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 13 },
      },
    });
    const answerId = `${requestId}:answer`;
    if (
      conversation?.status === "automated" &&
      !(await client.supportMessage.findUnique({ where: { requestId: answerId } }))
    ) {
      const history = conversation.messages.reverse();
      const body = await answer({ shop, history, client });
      try {
        await client.supportMessage.create({
          data: { conversationId: conversation.id, requestId: answerId, role: "assistant", body },
        });
      } catch (error) {
        // A concurrent retry answered first; keep that one.
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
      }
    }
  }
  return readConversation(shop, client);
}

/** A reply from the Nomi team, shown in the chat and emailed to the merchant. */
export async function replyAsOperator(
  conversationId: string,
  body: string,
  requestId: string,
  client: PrismaClient = db,
) {
  await client.$transaction(async (tx) => {
    const key = `operator:${conversationId}:${requestId}`;
    if (await tx.supportMessage.findUnique({ where: { requestId: key } })) return;
    const conversation = await tx.supportConversation.update({
      where: { id: conversationId },
      data: { status: "replied" },
    });
    await tx.supportMessage.create({
      data: { conversationId, role: "agent", body, requestId: key },
    });
    if (conversation.email) {
      await tx.supportNotification.create({
        data: { conversationId, requestId: `${key}:merchant`, recipient: conversation.email, body },
      });
    }
  });
}
