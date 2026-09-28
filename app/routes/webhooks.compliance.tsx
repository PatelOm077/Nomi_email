import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

// Shopify's mandatory privacy webhooks, required for App Store apps.
// authenticate.webhook verifies the HMAC and answers 401 on a bad one.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  if (topic === "CUSTOMERS_DATA_REQUEST") {
    // Nomi holds no customer profile of its own: only queued/sent email jobs
    // (the customer's address and cart). Logged so the team can answer the
    // merchant within Shopify's 30 days.
    const email = (payload as { customer?: { email?: string } }).customer?.email?.toLowerCase();
    const jobs = email
      ? await db.emailJob.count({ where: { shop, OR: [{ recipient: email }, { payload: { contains: email } }] } })
      : 0;
    console.log(`Data request for a customer of ${shop}: ${jobs} email job(s) hold their data.`);
  }

  if (topic === "CUSTOMERS_REDACT") {
    const customer = (payload as { customer?: { id?: number; email?: string } }).customer;
    const email = customer?.email?.toLowerCase();
    const matches = [
      ...(email ? [{ recipient: email }, { payload: { contains: email } }] : []),
      ...(customer?.id ? [{ payload: { contains: `"customer_id":${customer.id}` } }, { payload: { contains: `/Customer/${customer.id}"` } }] : []),
    ];
    // The suppression row stays: it only exists so an unsubscribed address is
    // never emailed again.
    if (matches.length) await db.emailJob.deleteMany({ where: { shop, OR: matches } });
  }

  if (topic === "SHOP_REDACT") {
    // 48 hours after uninstall: remove everything Nomi stored for the shop.
    await db.$transaction([
      db.emailJob.deleteMany({ where: { shop } }),
      db.emailSuppression.deleteMany({ where: { shop } }),
      db.campaign.deleteMany({ where: { shop } }),
      db.templateCustomization.deleteMany({ where: { shop } }),
      db.lifecycleTemplateChoice.deleteMany({ where: { shop } }),
      db.productImageCutout.deleteMany({ where: { shop } }),
      db.brandStudioProfile.deleteMany({ where: { shop } }),
      db.sendingDomain.deleteMany({ where: { shop } }),
      db.usageCounter.deleteMany({ where: { shop } }),
      db.supportConversation.deleteMany({ where: { shop } }),
      db.shopSettings.deleteMany({ where: { shop } }),
      db.session.deleteMany({ where: { shop } }),
    ]);
  }

  return new Response();
};
