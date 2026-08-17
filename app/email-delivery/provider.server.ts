import { getEmailDeliveryConfig } from "./config.server";

type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  idempotencyKey: string;
};

type ResendResponse = { id?: string; message?: string; name?: string };

export async function sendEmail({
  to,
  subject,
  html,
  idempotencyKey,
}: SendEmailInput): Promise<string> {
  const config = getEmailDeliveryConfig();
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({
      from: `${config.fromName} <${config.fromEmail}>`,
      to: [to],
      subject,
      html,
    }),
  });
  const result = (await response.json()) as ResendResponse;
  if (!response.ok || !result.id) {
    throw new Error(
      `Resend rejected the email (${response.status}): ${result.message ?? result.name ?? "unknown error"}`,
    );
  }
  return result.id;
}
