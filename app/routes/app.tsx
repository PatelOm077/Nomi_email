import type {
  HeadersFunction,
  LinksFunction,
  LoaderFunctionArgs,
  ShouldRevalidateFunction,
} from "react-router";
import type { CSSProperties } from "react";
import { Outlet, redirect, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { NomiRouteErrorBoundary } from "../dashboard/route-error-fallback";
import { loadAppEmbedStatus } from "../dashboard/app-embed.server";
import { templatesEnabled } from "../dashboard/reference-looks.server";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import nomiStyles from "../styles/nomi.css?url";
import supportStyles from "../styles/support.css?url";
import { SupportWidget } from "../support/SupportWidget";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: supportStyles },
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&family=Lora:wght@500;600&family=Source+Serif+4:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap",
  },
  { rel: "stylesheet", href: `${nomiStyles}?v=preview-label-center-20260923-1` },
];

const SETUP_PATH = "/app/setup";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);

  // Theme setup gate: nothing else in Nomi opens until the "Nomi Script"
  // app embed is on in the live theme. Once seen, the verified flag skips
  // the theme read on every later load; the dashboard re-checks it live.
  const settings = await db.shopSettings.findUnique({
    where: { shop: session.shop },
    select: { appEmbedVerifiedAt: true },
  });
  let embedVerified = Boolean(settings?.appEmbedVerifiedAt);
  if (!embedVerified) {
    const status = await loadAppEmbedStatus(admin);
    if (status.state === "active") {
      await db.shopSettings.upsert({
        where: { shop: session.shop },
        create: { shop: session.shop, appEmbedVerifiedAt: new Date() },
        update: { appEmbedVerifiedAt: new Date() },
      });
      embedVerified = true;
    } else if (status.state === "unknown") {
      // Fail open: a Shopify read error must not lock the merchant out of
      // the app they've installed. Setup stays reachable from the dashboard.
      embedVerified = true;
    }
  }
  if (!embedVerified && url.pathname !== SETUP_PATH) {
    // Keep Shopify's shop/host params so App Bridge can still bootstrap.
    throw redirect(`${SETUP_PATH}${url.search}`);
  }

  return {
    // eslint-disable-next-line no-undef
    apiKey: process.env.SHOPIFY_API_KEY || "",
    embedVerified,
    showTemplates: templatesEnabled(),
  };
};

// The embedded shell's data is static once the embed is verified, so child
// route changes skip the Shopify round trip. Leaving or entering setup is the
// exception: that's where the gate has to be re-evaluated.
export const shouldRevalidate: ShouldRevalidateFunction = ({ currentUrl, nextUrl }) =>
  currentUrl.pathname === SETUP_PATH || nextUrl.pathname === SETUP_PATH;

export default function App() {
  const { apiKey, embedVerified, showTemplates } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isNavigating = navigation.state !== "idle";
  const actionIntent = navigation.formData?.get("intent");
  const showRouteProgress = isNavigating && actionIntent !== "finalize";
  const routeProgressDuration = actionIntent === "analyze"
    ? "3700ms"
    : actionIntent === "generate-directions"
      ? "5200ms"
      : "1100ms";

  return (
    <AppProvider embedded apiKey={apiKey}>
      {showRouteProgress && (
        <div
          className="nomi-route-progress"
          style={{ "--nomi-route-progress-duration": routeProgressDuration } as CSSProperties}
          role="status"
          aria-label="Loading page"
        />
      )}
      {embedVerified ? (
        <s-app-nav>
          <s-link href="/app/brand-studio">Brand Studio</s-link>
          <s-link href="/app/flow-editor">Flow Editor</s-link>
          <s-link href="/app/contacts">Contacts</s-link>
          <s-link href="/app/campaigns">Campaigns</s-link>
          <s-link href="/app/brand-settings">Brand &amp; Settings</s-link>
          {showTemplates ? <s-link href="/app/additional">Templates</s-link> : null}
        </s-app-nav>
      ) : (
        // Setup is the only screen until the embed is on, so the sidebar
        // doesn't offer pages that would just bounce back here.
        <s-app-nav />
      )}
      <Outlet />
      <SupportWidget />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return <NomiRouteErrorBoundary />;
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
