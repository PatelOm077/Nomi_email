import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicClient } from "./anthropic-client";
import { getSharedDesignSystemPrompt } from "./design-system-prompt";
import { EMAIL_GENERATION_PAUSED } from "./generation-status";
import { EMAIL_LANGUAGES, type EmailLanguage, type EmailTone } from "./types";

// Strips a markdown code fence if the model wraps the HTML in one despite
// the system prompt telling it not to — cheap safety net, not the primary
// contract enforcement mechanism.
function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  return trimmed
    .replace(/^```(?:html)?[^\S\r\n]*\r?\n/i, "")
    .replace(/\r?\n```[^\S\r\n]*$/, "")
    .trim();
}

// Thrown when the model hit max_tokens mid-document, so a caller can retry
// with a more compact brief instead of surfacing a half-built email.
export class EmailCutOffError extends Error {
  constructor() {
    super("The generated email was cut off before it finished — try again.");
    this.name = "EmailCutOffError";
  }
}

export type GenerateEmailOptions = {
  maxTokens?: number;
  // Sonnet 5 thinks adaptively by default, and that thinking shares the
  // max_tokens budget and the wall clock with the HTML itself. A caller
  // whose composition was already planned upstream can lower this.
  effort?: "low" | "medium" | "high";
};

// Shared by every supported email generator. Two system blocks, each with its own
// cache_control: the shared block is byte-identical across every email
// type, so the first call of ANY type writes it to cache and every later
// call of every type reads it back — not just repeats of the same type.
// The second block is the skeleton specific to this one email type.
export async function generateEmailHtml(
  skeletonPrompt: string,
  userMessage: string,
  language: EmailLanguage,
  tone: EmailTone,
  options: GenerateEmailOptions = {},
): Promise<string> {
  if (EMAIL_GENERATION_PAUSED) {
    throw new Error("Email generation is paused.");
  }

  const languageName = EMAIL_LANGUAGES.find(
    (candidate) => candidate.code === language,
  )?.label;
  if (!languageName) {
    throw new Error(`Unsupported email language: ${language}`);
  }

  // Streamed so a long document never hits the SDK's non-streaming timeout
  // guard (it refuses large max_tokens without streaming); finalMessage()
  // still hands back one complete response.
  const response = await getAnthropicClient().messages.stream({
    model: "claude-sonnet-5",
    // A single genuinely art-directed email — table-constructed graphics
    // (see newsletter-prompt.ts's shape-building rules), a full product
    // showcase, a designed discount treatment — routinely needs more than a
    // plain notice ever did. 4096 was cutting real generations off
    // mid-document once the newsletter skeleton started asking for more.
    max_tokens: options.maxTokens ?? 16_000,
    output_config: { effort: options.effort ?? "high" },
    system: [
      {
        type: "text",
        text: getSharedDesignSystemPrompt(tone),
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
  }).finalMessage();

  if (response.stop_reason === "refusal") {
    throw new Error("Claude declined to generate this email.");
  }
  if (response.stop_reason === "max_tokens") {
    throw new EmailCutOffError();
  }

  const textBlock = response.content.find(
    (block): block is Anthropic.TextBlock => block.type === "text",
  );
  if (!textBlock) {
    throw new Error("Claude did not return any HTML for this email.");
  }

  return stripCodeFence(textBlock.text);
}
