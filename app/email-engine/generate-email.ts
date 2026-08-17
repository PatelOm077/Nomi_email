import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicClient } from "./anthropic-client";
import { SHARED_DESIGN_SYSTEM_PROMPT } from "./design-system-prompt";
import { EMAIL_LANGUAGES, type EmailLanguage } from "./types";

// Strips a markdown code fence if the model wraps the HTML in one despite
// the system prompt telling it not to — cheap safety net, not the primary
// contract enforcement mechanism.
function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:html)?\n([\s\S]*?)\n```$/);
  return fenced ? fenced[1] : trimmed;
}

// Shared by every email type's generator (order confirmation, abandoned
// cart, and whatever's next). Two system blocks, each with its own
// cache_control: the shared block is byte-identical across every email
// type, so the first call of ANY type writes it to cache and every later
// call of every type reads it back — not just repeats of the same type.
// The second block is the skeleton specific to this one email type.
export async function generateEmailHtml(
  skeletonPrompt: string,
  userMessage: string,
  language: EmailLanguage,
): Promise<string> {
  const languageName = EMAIL_LANGUAGES.find(
    (candidate) => candidate.code === language,
  )?.label;
  if (!languageName) {
    throw new Error(`Unsupported email language: ${language}`);
  }

  const response = await getAnthropicClient().messages.create({
    model: "claude-sonnet-5",
    max_tokens: 4096,
    output_config: { effort: "medium" },
    system: [
      {
        type: "text",
        text: SHARED_DESIGN_SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
      {
        type: "text",
        text: skeletonPrompt,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: `${userMessage}\n\nLanguage requirement: write every customer-visible word in ${languageName}. Localize headings, labels, button text, dates, and footer copy. Preserve shop names, product names, order numbers, URLs, currency figures, tracking numbers, and discount codes exactly as supplied. Set the HTML document's lang attribute to "${language}".`,
      },
    ],
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
