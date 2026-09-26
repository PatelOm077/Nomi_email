import { describe, expect, it } from "vitest";
import { appEmbedEditorUrl, isNomiEmbedEnabled } from "./app-embed.server";

const banner = "/*\n * IMPORTANT: The contents of this file are auto-generated.\n */\n";
const settings = (blocks: Record<string, unknown>) =>
  banner + JSON.stringify({ current: { sections: {}, blocks } });

describe("isNomiEmbedEnabled", () => {
  it("is true when the Nomi Script embed is present and not disabled", () => {
    expect(
      isNomiEmbedEnabled(
        settings({ "1": { type: "shopify://apps/nomi/blocks/nomi-script/abc-123", disabled: false } }),
      ),
    ).toBe(true);
  });

  it("is false once the embed has been switched off", () => {
    expect(
      isNomiEmbedEnabled(
        settings({ "1": { type: "shopify://apps/nomi/blocks/nomi-script/abc-123", disabled: true } }),
      ),
    ).toBe(false);
  });

  it("ignores other apps' embeds and themes with no blocks", () => {
    expect(
      isNomiEmbedEnabled(
        settings({ "1": { type: "shopify://apps/wiz/blocks/app-embed/xyz", disabled: false } }),
      ),
    ).toBe(false);
    expect(isNomiEmbedEnabled(banner + JSON.stringify({ current: {} }))).toBe(false);
  });

  it("reads a preset-named current", () => {
    const text = JSON.stringify({
      current: "Default",
      presets: { Default: { blocks: { a: { type: "shopify://apps/nomi/blocks/nomi-script/u" } } } },
    });
    expect(isNomiEmbedEnabled(text)).toBe(true);
  });

  it("returns null for unreadable JSON", () => {
    expect(isNomiEmbedEnabled("{ not json")).toBeNull();
  });
});

describe("appEmbedEditorUrl", () => {
  it("builds Shopify's activateAppId deep link", () => {
    expect(appEmbedEditorUrl("tarn.myshopify.com", "key123")).toBe(
      "https://tarn.myshopify.com/admin/themes/current/editor?context=apps&activateAppId=key123/nomi-script",
    );
  });
});
