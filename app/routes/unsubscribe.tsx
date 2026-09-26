import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import { Form, data, useActionData, useLoaderData, useNavigation } from "react-router";
import { unauthenticated } from "../shopify.server";
import { isSuppressed, readUnsubscribeToken, unsubscribe } from "../email-delivery/unsubscribe.server";

// Public page behind every email's Unsubscribe link (not embedded, no
// merchant login). GET only asks — link scanners and inbox previews follow
// links, so a GET must never unsubscribe anyone. The form POST does it, and
// so does Gmail/Yahoo's RFC 8058 one-click POST (List-Unsubscribe-Post).

export const meta: MetaFunction = () => [{ title: "Unsubscribe" }, { name: "robots", content: "noindex" }];

async function shopAdmin(shop: string) {
  try {
    return (await unauthenticated.admin(shop)).admin;
  } catch {
    return null; // app uninstalled or shop unknown — local suppression still applies
  }
}

async function shopName(shop: string): Promise<string> {
  const admin = await shopAdmin(shop);
  if (!admin) return shop.replace(/\.myshopify\.com$/, "");
  try {
    const response = await admin.graphql(`#graphql
      query UnsubscribeShopName { shop { name } }`);
    const json = (await response.json()) as { data?: { shop?: { name?: string } } };
    return json.data?.shop?.name || shop.replace(/\.myshopify\.com$/, "");
  } catch {
    return shop.replace(/\.myshopify\.com$/, "");
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const recipient = readUnsubscribeToken(new URL(request.url).searchParams.get("t"));
  if (!recipient) return data({ state: "invalid" as const, email: null, shopName: null }, { status: 400 });
  const [name, already] = await Promise.all([shopName(recipient.shop), isSuppressed(recipient)]);
  return { state: already ? ("done" as const) : ("ask" as const), email: recipient.email, shopName: name };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const recipient = readUnsubscribeToken(new URL(request.url).searchParams.get("t"));
  const body = await request.formData().catch(() => null);
  const oneClick = body?.get("List-Unsubscribe") === "One-Click";
  if (!recipient) return oneClick ? new Response("Invalid link", { status: 400 }) : data({ ok: false }, { status: 400 });
  await unsubscribe(recipient, { source: oneClick ? "one-click" : "link", admin: await shopAdmin(recipient.shop) });
  return oneClick ? new Response("Unsubscribed", { status: 200 }) : data({ ok: true });
};

const INK = "#201e1d";
const MUTE = "#6b6560";

export default function UnsubscribePage() {
  const page = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>() as { ok: boolean } | undefined;
  const busy = useNavigation().state === "submitting";
  const done = page.state === "done" || result?.ok;

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "32px 16px", background: "#f3f2f2", color: INK, fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" }}>
      <section style={{ width: "100%", maxWidth: 440, padding: "36px 32px", background: "#fff", border: "1px solid #e3dfdb", borderRadius: 2, boxSizing: "border-box" }}>
        {page.state === "invalid" || result?.ok === false ? (
          <>
            <h1 style={{ margin: "0 0 10px", font: "600 26px/1.2 'Source Serif 4', Georgia, serif" }}>This link doesn’t work</h1>
            <p style={{ margin: 0, color: MUTE, fontSize: 15, lineHeight: 1.55 }}>It may be incomplete. Open the Unsubscribe link from the email again, or reply to the email and ask to be removed.</p>
          </>
        ) : done ? (
          <>
            <h1 style={{ margin: "0 0 10px", font: "600 26px/1.2 'Source Serif 4', Georgia, serif" }}>You’re unsubscribed</h1>
            <p style={{ margin: 0, color: MUTE, fontSize: 15, lineHeight: 1.55 }}><strong style={{ color: INK, wordBreak: "break-all" }}>{page.email}</strong> won’t get marketing emails from {page.shopName} anymore. Order and shipping updates still arrive.</p>
          </>
        ) : (
          <>
            <h1 style={{ margin: "0 0 10px", font: "600 26px/1.2 'Source Serif 4', Georgia, serif" }}>Unsubscribe from {page.shopName}?</h1>
            <p style={{ margin: "0 0 24px", color: MUTE, fontSize: 15, lineHeight: 1.55 }}><strong style={{ color: INK, wordBreak: "break-all" }}>{page.email}</strong> will stop getting marketing emails from {page.shopName}. Order and shipping updates still arrive.</p>
            <Form method="post">
              <button type="submit" disabled={busy} style={{ width: "100%", minHeight: 48, border: 0, borderRadius: 2, background: INK, color: "#fff", font: "600 15px/1 ui-sans-serif, system-ui, sans-serif", cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1 }}>
                {busy ? "Unsubscribing…" : "Unsubscribe"}
              </button>
            </Form>
          </>
        )}
      </section>
    </main>
  );
}
