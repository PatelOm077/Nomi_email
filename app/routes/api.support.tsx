import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  readConversation,
  supportInput,
  writeSupport,
} from "../support/conversations.server";

const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  return json({ conversation: await readConversation(session.shop) });
}
export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  if (request.method !== "POST")
    return json({ error: "Method not allowed." }, 405);
  if (Number(request.headers.get("content-length")) > 12_000)
    return json({ error: "Message is too long." }, 413);
  const body = await request.text();
  if (body.length > 12_000) return json({ error: "Message is too long." }, 413);
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return json({ error: "Could not read the message." }, 400);
  }
  const parsed = supportInput.safeParse(value);
  if (!parsed.success)
    return json(
      { error: "Enter a valid email or a message of 1–2,000 characters." },
      400,
    );
  try {
    return json({
      conversation: await writeSupport(session.shop, parsed.data),
    });
  } catch (error) {
    if (error instanceof Error && error.message === "SUPPORT_RATE_LIMIT")
      return json(
        { error: "Please wait a minute before sending another message." },
        429,
      );
    return json(
      { error: "Could not save your message. Please try again." },
      503,
    );
  }
}
