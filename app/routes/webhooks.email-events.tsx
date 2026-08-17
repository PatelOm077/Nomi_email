import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { enqueueEmailJob } from "../email-delivery/queue.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, session, shop, topic, webhookId } =
    await authenticate.webhook(request);
  if (!session) return new Response();

  const result = await enqueueEmailJob({
    webhookId,
    shop,
    topic: String(topic),
    payload,
  });
  console.log(`Email event ${webhookId} for ${shop}: ${result}`);
  return new Response();
};
