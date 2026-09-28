import { randomUUID } from "node:crypto";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  LinksFunction,
} from "react-router";
import {
  Form,
  Link,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import { z } from "zod";
import db from "../db.server";
import { replyAsOperator } from "../support/conversations.server";
import {
  isOperator,
  operatorConfigured,
  operatorCookie,
  sameOrigin,
  validOperatorPassword,
} from "../support/operator-auth.server";
import inboxStyles from "../styles/support-inbox.css?url";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: inboxStyles },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Source+Serif+4:wght@400;500;600&display=swap",
  },
];
// Every look at or change to support data is recorded (protected customer
// data access log). A log failure never blocks the operator.
async function logAccess(request: Request, action: string, target?: string) {
  const actor = request.headers.get("fly-client-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  await db.accessLog.create({ data: { actor: `operator@${actor}`, action, target } }).catch(() => undefined);
}
const noStore = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
};
export async function loader({ request }: LoaderFunctionArgs) {
  if (!(await isOperator(request)))
    return Response.json(
      {
        authorized: false,
        configured: operatorConfigured(),
        conversations: [],
        selected: null,
      },
      { headers: noStore },
    );
  const id = new URL(request.url).searchParams.get("id");
  await logAccess(request, id ? "view-conversation" : "view-inbox", id ?? undefined);
  const conversations = await db.supportConversation.findMany({
    where: { status: { not: "automated" } },
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: {
      id: true,
      shop: true,
      status: true,
      email: true,
      updatedAt: true,
    },
  });
  const selected = id
    ? await db.supportConversation.findUnique({
        where: { id },
        include: {
          messages: {
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 100,
          },
          notifications: {
            where: { status: { not: "sent" } },
            select: { id: true, status: true },
          },
        },
      })
    : null;
  if (selected) selected.messages.reverse();
  return Response.json(
    {
      authorized: true,
      configured: true,
      conversations,
      selected,
      replyId: randomUUID(),
    },
    { headers: noStore },
  );
}
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST" || !sameOrigin(request))
    return Response.json(
      { error: "Request not allowed." },
      { status: 403, headers: noStore },
    );
  if (Number(request.headers.get("content-length")) > 16_000)
    return Response.json(
      { error: "Request too long." },
      { status: 413, headers: noStore },
    );
  const form = await request.formData();
  const intent = form.get("intent");
  if (intent === "login") {
    const valid = validOperatorPassword(String(form.get("password") ?? ""));
    await logAccess(request, valid ? "sign-in" : "sign-in-failed");
    if (!valid)
      return Response.json(
        { error: "The access key is invalid." },
        { status: 401, headers: noStore },
      );
    return redirect("/support-inbox", {
      headers: { "Set-Cookie": await operatorCookie() },
    });
  }
  if (!(await isOperator(request)))
    return Response.json(
      { error: "Sign in again to continue." },
      { status: 401, headers: noStore },
    );
  if (intent === "logout")
    return redirect("/support-inbox", {
      headers: { "Set-Cookie": await operatorCookie(true) },
    });
  const id = String(form.get("id") ?? "");
  const conversation = await db.supportConversation.findUnique({
    where: { id },
  });
  if (!conversation)
    return Response.json(
      { error: "Conversation not found." },
      { status: 404, headers: noStore },
    );
  await logAccess(request, String(intent), id);
  if (intent === "reply") {
    const body = z.string().trim().min(1).max(4000).safeParse(form.get("body"));
    const requestId = z.uuid().safeParse(form.get("requestId"));
    if (!body.success || !requestId.success)
      return Response.json(
        { error: "Enter a reply of 1–4,000 characters." },
        { status: 400, headers: noStore },
      );
    await replyAsOperator(id, body.data, requestId.data);
  } else if (intent === "resolve") {
    await db.$transaction([
      db.supportConversation.update({
        where: { id },
        data: { status: "resolved" },
      }),
      db.supportMessage.create({
        data: {
          conversationId: id,
          role: "system",
          body: "The Nomi team marked this conversation resolved. Send a message here if you need more help.",
          requestId: randomUUID(),
        },
      }),
    ]);
  } else if (intent === "retry-notifications") {
    await db.supportNotification.updateMany({
      where: { conversationId: id, status: "failed" },
      data: { status: "pending", availableAt: new Date(), attempts: 0 },
    });
  } else
    return Response.json(
      { error: "Unknown action." },
      { status: 400, headers: noStore },
    );
  return redirect(`/support-inbox?id=${encodeURIComponent(id)}`);
}

type InboxData = {
  replyId?: string;
  authorized: boolean;
  configured: boolean;
  conversations: {
    id: string;
    shop: string;
    status: string;
    email: string | null;
  }[];
  selected: null | {
    id: string;
    shop: string;
    email: string | null;
    status: string;
    updatedAt: string;
    messages: { id: string; role: string; body: string }[];
    notifications: { id: string; status: string }[];
  };
};
export default function SupportInbox() {
  const data = useLoaderData() as InboxData;
  const result = useActionData<typeof action>() as
    { error?: string } | undefined;
  const busy = useNavigation().state !== "idle";
  return (
    <main className="nomi-inbox">
      <header>
        <div>
          <span className="nomi-inbox-kicker">Nomi / operations</span>
          <h1>Support inbox</h1>
        </div>
        {data.authorized && (
          <Form method="post">
            <button name="intent" value="logout">
              Sign out
            </button>
          </Form>
        )}
      </header>
      {result?.error && (
        <p role="alert" className="nomi-inbox-error">
          {result.error}
        </p>
      )}
      {!data.authorized ? (
        <section className="nomi-inbox-login">
          <h2>A place to listen.</h2>
          <p>Private access for the Nomi support team.</p>
          {data.configured ? (
            <Form method="post">
              <input type="hidden" name="intent" value="login" />
              <label htmlFor="operator-password">Support access key</label>
              <input
                id="operator-password"
                type="password"
                name="password"
                autoComplete="current-password"
                required
              />
              <button disabled={busy}>
                {busy ? "Signing in…" : "Open inbox"}
              </button>
            </Form>
          ) : (
            <p>
              Operator access is not configured. Set NOMI_SUPPORT_ADMIN_SECRET
              to a random secret of at least 32 characters on the server.
            </p>
          )}
        </section>
      ) : (
        <div className="nomi-inbox-layout">
          <nav aria-label="Support conversations">
            <h2>
              Conversations <span>{data.conversations.length}</span>
            </h2>
            {!data.conversations.length && (
              <p>No requests yet. Merchant requests will appear here.</p>
            )}
            {data.conversations.map((conversation) => (
              <Link
                key={conversation.id}
                aria-current={
                  data.selected?.id === conversation.id ? "page" : undefined
                }
                to={`?id=${conversation.id}`}
              >
                <strong>{conversation.shop}</strong>
                <span>{conversation.email}</span>
                <small>{conversation.status}</small>
              </Link>
            ))}
          </nav>
          <section className="nomi-inbox-thread">
            {data.selected ? (
              <>
                <header>
                  <div>
                    <h2>{data.selected.shop}</h2>
                    <p>
                      {data.selected.email} · {data.selected.status}
                    </p>
                  </div>
                  <Form method="post">
                    <input type="hidden" name="id" value={data.selected.id} />
                    <button
                      name="intent"
                      value="resolve"
                      disabled={busy || data.selected.status === "resolved"}
                    >
                      Resolve
                    </button>
                  </Form>
                </header>
                <div className="nomi-inbox-log">
                  {data.selected.messages.map((message) => (
                    <article key={message.id} data-role={message.role}>
                      <small>{message.role}</small>
                      <p>{message.body}</p>
                    </article>
                  ))}
                </div>
                <Form
                  method="post"
                  key={`${data.selected.id}:${data.selected.updatedAt}`}
                >
                  <input type="hidden" name="id" value={data.selected.id} />
                  <input type="hidden" name="requestId" value={data.replyId} />
                  <label htmlFor="operator-reply">Reply in Nomi</label>
                  <textarea
                    id="operator-reply"
                    name="body"
                    required
                    maxLength={4000}
                    rows={4}
                    placeholder="Write a helpful reply…"
                  />
                  <button name="intent" value="reply" disabled={busy}>
                    {busy ? "Saving…" : "Send reply"}
                  </button>
                  <p className="nomi-inbox-caption">
                    Appears in the merchant’s conversation
                    {data.selected.email
                      ? `, and ${data.selected.email} gets an email saying the team replied.`
                      : ". They left no email, so they’ll see it next time they open Nomi help."}
                  </p>
                </Form>
                {Boolean(data.selected.notifications.length) && (
                  <Form method="post">
                    <input type="hidden" name="id" value={data.selected.id} />
                    <p className="nomi-inbox-caption">
                      {
                        data.selected.notifications.filter(
                          (item) => item.status === "pending",
                        ).length
                      }{" "}
                      email alerts pending ·{" "}
                      {
                        data.selected.notifications.filter(
                          (item) => item.status === "failed",
                        ).length
                      }{" "}
                      failed
                    </p>
                    <button
                      name="intent"
                      value="retry-notifications"
                      disabled={
                        busy ||
                        !data.selected.notifications.some(
                          (item) => item.status === "failed",
                        )
                      }
                    >
                      Retry failed alerts
                    </button>
                  </Form>
                )}
              </>
            ) : (
              <div className="nomi-inbox-empty">
                <h2>Every conversation, in one place.</h2>
                <p>Choose a store to read the conversation and reply.</p>
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
