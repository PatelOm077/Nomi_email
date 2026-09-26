import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicClient } from "./anthropic-client";

export type RewriteStyle = "shorter" | "warmer" | "direct";

const REWRITE_INSTRUCTION: Record<RewriteStyle, string> = {
  shorter: "Make it noticeably shorter — trim to the essential idea. Keep the same meaning.",
  warmer: "Make it warmer and more personal, like a considerate note. Keep it concise.",
  direct: "Make it more direct and plain-spoken — state the point with no hedging.",
};

// Rewrites a single email text block's headline/body for the template
// editor's "Rewrite with Nomi" control. Deliberately narrow (no HTML, no
// design-system prompt) since this only ever touches two short strings.
export async function rewriteCopy(
  headline: string,
  body: string,
  style: RewriteStyle,
): Promise<{ headline: string; body: string }> {
  const response = await getAnthropicClient().messages.create({
    model: "claude-sonnet-5",
    max_tokens: 300,
    output_config: { effort: "low" },
    system:
      "You rewrite a short email headline and body for an ecommerce merchant's lifecycle email. " +
      "Reply with exactly two lines: the first line is the rewritten headline, the second line is the rewritten body. " +
      "No quotes, no labels, no markdown, no extra lines. Preserve any product names, numbers, or URLs exactly.",
    messages: [
      {
        role: "user",
        content: `${REWRITE_INSTRUCTION[style]}\n\nHeadline: ${headline}\nBody: ${body}`,
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("Claude declined to rewrite this text.");
  }

  const textBlock = response.content.find(
    (block): block is Anthropic.TextBlock => block.type === "text",
  );
  if (!textBlock) {
    throw new Error("Claude did not return a rewrite for this text.");
  }

  const lines = textBlock.text.trim().split("\n").map((line) => line.trim()).filter(Boolean);
  const [rewrittenHeadline, ...rest] = lines;
  if (!rewrittenHeadline) {
    throw new Error("Claude's rewrite was empty.");
  }

  return { headline: rewrittenHeadline, body: rest.join(" ") || body };
}
