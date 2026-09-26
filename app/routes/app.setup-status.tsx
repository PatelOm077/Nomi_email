import type { LoaderFunctionArgs } from "react-router";

import { loadAppEmbedStatus } from "../dashboard/app-embed.server";
import db from "../db.server";
import { authenticate } from "../shopify.server";

// JSON re-check for /app/setup. The setup page calls this with a plain
// fetch (App Bridge adds the session token) instead of revalidating its own
// loader, so a dropped connection shows an inline note rather than bubbling
// a "Failed to fetch" into Shopify's full-page Application Error.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const status = await loadAppEmbedStatus(admin);
  if (status.state === "active") {
    await db.shopSettings.upsert({
      where: { shop: session.shop },
      create: { shop: session.shop, appEmbedVerifiedAt: new Date() },
      update: { appEmbedVerifiedAt: new Date() },
    });
  }
  return Response.json({ state: status.state, themeName: status.themeName });
};
