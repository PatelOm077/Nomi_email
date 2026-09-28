import type { PrismaClient } from "@prisma/client";
import db from "../db.server";
import { sendEmail } from "../email-delivery/provider.server";

const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!,
  );

// Tells the merchant the team answered; the conversation itself stays in Nomi.
function merchantReplyEmail(id: string, to: string, shop: string, body: string) {
  // /admin/apps/<api key> opens the embedded app in that store's admin.
  const apiKey = process.env.SHOPIFY_API_KEY;
  const link = apiKey ? `https://${shop}/admin/apps/${apiKey}` : `https://${shop}/admin/apps`;
  return {
    to,
    subject: "The Nomi team replied",
    html: `<!doctype html><html lang="en"><body style="margin:0;background:#f3f2f2"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f2f2"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #d9d6d3;border-radius:4px"><tr><td style="padding:32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#201e1d"><p style="margin:0 0 8px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6b6765">Nomi support</p><h1 style="margin:0 0 20px;font-family:'Source Serif 4',Georgia,serif;font-weight:500;font-size:26px;line-height:1.25">The Nomi team replied.</h1><div style="margin:0 0 24px;padding:16px 18px;border-left:3px solid #0088b0;background:#f3f2f2;font-size:15px;line-height:1.6;white-space:pre-wrap">${escape(body)}</div><a href="${escape(link)}" style="display:inline-block;padding:13px 20px;background:#201e1d;color:#ffffff;text-decoration:none;border-radius:4px;font-size:15px">Continue in Nomi</a><p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#6b6765">Replies to this email aren’t read. Open Nomi help in your Shopify admin to write back.</p></td></tr></table></td></tr></table></body></html>`,
    idempotencyKey: `nomi-support-${id}`,
  };
}

// Runs on the existing scheduled worker. No provider call blocks the chat UI.
export async function processSupportNotifications(
  client: PrismaClient = db,
  send = sendEmail,
) {
  if (!process.env.RESEND_API_KEY || !process.env.NOMI_FROM_EMAIL)
    return { sent: 0, configured: false };
  const jobs = await client.supportNotification.findMany({
    where: { status: "pending", availableAt: { lte: new Date() } },
    orderBy: { createdAt: "asc" },
    take: 10,
    include: { conversation: { select: { shop: true } } },
  });
  let sent = 0;
  for (const job of jobs) {
    // Lease using an atomic compare-and-swap; abandoned leases become available again.
    const claimed = await client.supportNotification.updateMany({
      where: {
        id: job.id,
        status: "pending",
        availableAt: { lte: new Date() },
      },
      data: {
        availableAt: new Date(Date.now() + 120_000),
        attempts: { increment: 1 },
      },
    });
    if (!claimed.count) continue;
    try {
      await send(
        job.recipient
          ? merchantReplyEmail(job.id, job.recipient, job.conversation.shop, job.body)
          : {
              to: process.env.NOMI_SUPPORT_EMAIL || "ombarvaliya7@gmail.com",
              subject: `Nomi support · ${job.conversation.shop}`,
              html: `<h2>Nomi support request</h2><p>Store: ${escape(job.conversation.shop)}</p><div style="white-space:pre-wrap">${escape(job.body)}</div><p>Reply through Nomi’s /support-inbox, or contact the merchant at the address above. Replying to this notification does not update the in-app conversation.</p>`,
              idempotencyKey: `nomi-support-${job.id}`,
            },
      );
      await client.supportNotification.update({
        where: { id: job.id },
        data: { status: "sent" },
      });
      sent++;
    } catch {
      // Stop before the provider's 24-hour idempotency window expires.
      await client.supportNotification.update({
        where: { id: job.id },
        data: {
          status: job.attempts >= 7 ? "failed" : "pending",
          availableAt: new Date(
            Date.now() + Math.min(3_600_000, 60_000 * 2 ** job.attempts),
          ),
        },
      });
    }
  }
  return { sent, configured: true };
}
