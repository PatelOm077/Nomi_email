import type { ActionFunctionArgs } from "react-router";
import { handleResendDomainEvent, verifyResendWebhook } from "../email-delivery/domains.server";

// Resend → Nomi webhook (Svix-signed). Only domain.* events are handled:
// the payload is used as a hint, and the row is refreshed from Resend's API
// so a forged-but-signed or out-of-order event can't set status directly.
export const action = async ({ request }: ActionFunctionArgs) => {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return new Response("Webhook secret not configured", { status: 503 });

  const rawBody = await request.text();
  const valid = verifyResendWebhook(rawBody, {
    id: request.headers.get("svix-id"),
    timestamp: request.headers.get("svix-timestamp"),
    signature: request.headers.get("svix-signature"),
  }, secret);
  if (!valid) return new Response("Invalid signature", { status: 401 });

  let event: { type?: string; data?: { id?: string } };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response("Malformed payload", { status: 400 });
  }

  if (event.type?.startsWith("domain.") && typeof event.data?.id === "string") {
    await handleResendDomainEvent(event.data.id);
  }
  return new Response(null, { status: 204 });
};
