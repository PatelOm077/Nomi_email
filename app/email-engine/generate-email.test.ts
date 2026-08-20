import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSharedDesignSystemPrompt } from "./design-system-prompt";
import { generateEmailHtml } from "./generate-email";

const createMessage = vi.hoisted(() => vi.fn());

vi.mock("./anthropic-client", () => ({
  getAnthropicClient: () => ({
    messages: { create: createMessage },
  }),
}));

describe("generateEmailHtml", () => {
  beforeEach(() => {
    createMessage.mockReset();
  });

  it.each([
    ["an HTML fence", "```html\n<!DOCTYPE html><html></html>\n```"],
    ["an unlabelled fence", "```\n<!DOCTYPE html><html></html>\n```"],
    ["an unclosed HTML fence", "```html\n<!DOCTYPE html><html></html>"],
  ])("strips %s from the model output", async (_label, text) => {
    createMessage.mockResolvedValue({
      stop_reason: "end_turn",
      content: [{ type: "text", text }],
    });

    await expect(
      generateEmailHtml("Skeleton", "Order data", "en", "warm-plain"),
    ).resolves.toBe("<!DOCTYPE html><html></html>");
  });

  it("trims an unfenced response", async () => {
    createMessage.mockResolvedValue({
      stop_reason: "end_turn",
      content: [{ type: "text", text: "  <!DOCTYPE html><html></html>  " }],
    });

    await expect(
      generateEmailHtml("Skeleton", "Order data", "en", "warm-plain"),
    ).resolves.toBe("<!DOCTYPE html><html></html>");
  });

  it("builds two independently cacheable system prompt blocks", async () => {
    createMessage.mockResolvedValue({
      stop_reason: "end_turn",
      content: [{ type: "text", text: "<!DOCTYPE html><html></html>" }],
    });

    await generateEmailHtml(
      "A shipping-specific skeleton",
      "Shipment facts",
      "es",
      "calm-minimal",
    );

    expect(createMessage).toHaveBeenCalledOnce();
    expect(createMessage).toHaveBeenCalledWith({
      model: "claude-sonnet-5",
      max_tokens: 4096,
      output_config: { effort: "medium" },
      system: [
        {
          type: "text",
          text: getSharedDesignSystemPrompt("calm-minimal"),
          cache_control: { type: "ephemeral" },
        },
        {
          type: "text",
          text: "A shipping-specific skeleton",
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: expect.stringMatching(
            /^Shipment facts\n\nLanguage requirement:.*Spanish.*lang attribute to "es"\.$/s,
          ),
        },
      ],
    });
  });

  it.each([
    ["refusal", "Claude declined to generate this email."],
    ["max_tokens", "The generated email was cut off before it finished"],
  ] as const)("rejects a %s stop reason", async (stopReason, errorMessage) => {
    createMessage.mockResolvedValue({
      stop_reason: stopReason,
      content: [{ type: "text", text: "ignored" }],
    });

    await expect(
      generateEmailHtml("Skeleton", "Order data", "en", "warm-plain"),
    ).rejects.toThrow(errorMessage);
  });

  it("rejects a response without a text block", async () => {
    createMessage.mockResolvedValue({
      stop_reason: "end_turn",
      content: [{ type: "tool_use", id: "tool-1", name: "ignored", input: {} }],
    });

    await expect(
      generateEmailHtml("Skeleton", "Order data", "en", "warm-plain"),
    ).rejects.toThrow("Claude did not return any HTML for this email.");
  });

  it("rejects an unsupported language before calling Claude", async () => {
    await expect(
      generateEmailHtml("Skeleton", "Order data", "xx" as never, "warm-plain"),
    ).rejects.toThrow("Unsupported email language: xx");

    expect(createMessage).not.toHaveBeenCalled();
  });
});
