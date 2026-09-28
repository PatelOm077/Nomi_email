import type { ActionFunctionArgs } from "react-router";
import { handleResendDomainEvent, verifyResendWebhook } from "../email-delivery/domains.server";
import { recordEmailEngagement } from "../email-delivery/email-stats.server";

// Resend → Nomi webhook (Svix-signed). domain.* events are used as a hint,
// and the row is refreshed from Resend's API so a forged-but-signed or
// out-of-order event can't set status directly. email.opened/email.clicked
// only stamp first-seen times on the matching sent EmailJob.
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

  let event: { type?: string; created_at?: string; data?: { id?: string; email_id?: string } };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response("Malformed payload", { status: 400 });
  }

  if (event.type?.startsWith("domain.") && typeof event.data?.id === "string") {
    await handleResendDomainEvent(event.data.id);
  }
  // Flow stats on the dashboard. Needs open/click tracking on in Resend.
  if (
    (event.type === "email.opened" || event.type === "email.clicked") &&
    typeof event.data?.email_id === "string"
  ) {
    const at = event.created_at ? new Date(event.created_at) : new Date();
    await recordEmailEngagement(
      event.data.email_id,
      event.type === "email.opened" ? "opened" : "clicked",
      Number.isNaN(at.getTime()) ? new Date() : at,
    );
  }
  return new Response(null, { status: 204 });
};
