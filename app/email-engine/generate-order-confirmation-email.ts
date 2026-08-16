import Anthropic from "@anthropic-ai/sdk";
import { DESIGN_SYSTEM_PROMPT } from "./design-system-prompt";
import type { OrderConfirmationOrder } from "./types";

// Lazy singleton: constructing the client reads ANTHROPIC_API_KEY from the
// environment, which we don't want to require at module-load time (breaks
// typecheck/build tooling that imports this file without the env set).
let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic();
  }
  return client;
}

function buildOrderMessage(order: OrderConfirmationOrder): string {
  const lineItems = order.lineItems
    .map((item) => {
      const image = item.imageUrl ? ` (image: ${item.imageUrl})` : "";
      return `- ${item.title} × ${item.quantity} — ${item.price}${image}`;
    })
    .join("\n");

  const customerFirstName = order.customerFirstName
    ? order.customerFirstName
    : "not given — this order has no customer name attached, write a name-free greeting per the rules above";

  return `Generate the order confirmation email for this order.

Shop: ${order.shopName}
Customer first name: ${customerFirstName}
Order: ${order.orderNumber}
Line items:
${lineItems}
Order total: ${order.total}

Invent a tasteful, editorial brand skin for "${order.shopName}" as described above, since no real brand assets are connected for this shop yet. Return only the finished HTML document.`;
}

// Strips a markdown code fence if the model wraps the HTML in one despite
// the system prompt telling it not to — cheap safety net, not the primary
// contract enforcement mechanism.
function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:html)?\n([\s\S]*?)\n```$/);
  return fenced ? fenced[1] : trimmed;
}

export async function generateOrderConfirmationEmail(
  order: OrderConfirmationOrder,
): Promise<string> {
  const response = await getClient().messages.create({
    model: "claude-sonnet-5",
    max_tokens: 4096,
    output_config: { effort: "medium" },
    system: [
      {
        type: "text",
        text: DESIGN_SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: buildOrderMessage(order) }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("Claude declined to generate this email.");
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error(
      "The generated email was cut off before it finished — try again.",
    );
  }

  const textBlock = response.content.find(
    (block): block is Anthropic.TextBlock => block.type === "text",
  );
  if (!textBlock) {
    throw new Error("Claude did not return any HTML for this email.");
  }

  return stripCodeFence(textBlock.text);
}
