export type EmailDeliveryConfig = {
  apiKey: string;
  fromEmail: string;
  fromName: string;
};

export function isEmailDeliveryConfigured(): boolean {
  return Boolean(
    process.env.RESEND_API_KEY &&
      process.env.NOMI_FROM_EMAIL &&
      process.env.EMAIL_JOB_SECRET,
  );
}

export function getEmailDeliveryConfig(): EmailDeliveryConfig {
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.NOMI_FROM_EMAIL;
  if (!apiKey || !fromEmail) {
    throw new Error(
      "Email delivery is not configured. Set RESEND_API_KEY and NOMI_FROM_EMAIL.",
    );
  }
  return {
    apiKey,
    fromEmail,
    fromName: process.env.NOMI_FROM_NAME?.trim() || "Nomi",
  };
}
