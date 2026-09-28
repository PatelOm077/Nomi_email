import type { LoaderFunctionArgs } from "react-router";

import { login } from "../../shopify.server";

// Merchants never type their shop's domain (App Store requirement 2.3.1):
// Shopify opens Nomi from the admin or the App Store with ?shop= already set,
// and login() sends that straight on to authentication. Without it there's
// nothing to ask, so the page just says where to open Nomi.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (new URL(request.url).searchParams.get("shop")) await login(request);
  return null;
};

export default function Auth() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "24px 16px",
        background: "#f3f2f2",
        color: "#201e1d",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      <div style={{ maxWidth: 440 }}>
        <p style={{ margin: "0 0 10px", fontSize: 12, letterSpacing: ".12em", textTransform: "uppercase", color: "#6b6765" }}>
          Nomi
        </p>
        <h1 style={{ margin: "0 0 12px", fontFamily: "'Source Serif 4', Georgia, serif", fontWeight: 500, fontSize: 34, lineHeight: 1.15 }}>
          Open Nomi from your Shopify admin.
        </h1>
        <p style={{ margin: 0, fontSize: 16, lineHeight: 1.6, color: "#48443f" }}>
          Nomi runs inside Shopify. Find it under Apps in your store’s admin, or install Nomi Email Marketing from
          the Shopify App Store.
        </p>
      </div>
    </main>
  );
}
