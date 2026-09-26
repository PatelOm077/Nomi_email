import { describe, expect, expectTypeOf, it } from "vitest";
import {
  EMAIL_LANGUAGES,
  EMAIL_TONES,
  type EmailLanguage,
  type EmailLineItem,
  type EmailTone,
  type AbandonedCartRecovery,
  type ReviewRequest,
} from "./types";

describe("email engine contracts", () => {
  it("keeps the supported language catalog stable and unique", () => {
    const codes = EMAIL_LANGUAGES.map(({ code }) => code);

    expect(codes).toEqual([
      "en",
      "es",
      "de",
      "fr",
      "pt",
      "it",
      "ja",
      "nl",
      "zh-CN",
      "ko",
    ]);
    expect(new Set(codes).size).toBe(codes.length);
    expect(EMAIL_LANGUAGES.every(({ label }) => label.length > 0)).toBe(true);
  });

  it("keeps the supported tone catalog stable and unique", () => {
    const codes = EMAIL_TONES.map(({ code }) => code);

    expect(codes).toEqual(["warm-plain", "bright-bubbly", "calm-minimal"]);
    expect(new Set(codes).size).toBe(codes.length);
    expect(EMAIL_TONES.every(({ label }) => label.length > 0)).toBe(true);
  });

  it("keeps platform-neutral generation inputs structurally compatible", () => {
    expectTypeOf<EmailLineItem>().toMatchTypeOf<{
      title: string;
      quantity: number;
      price?: string;
      imageUrl?: string | null;
    }>();
    expectTypeOf<AbandonedCartRecovery>().toMatchTypeOf<{
      language: EmailLanguage;
      tone: EmailTone;
      customerFirstName: string | null;
      lineItems: EmailLineItem[];
      total: string;
      recoveryUrl: string;
    }>();
    expectTypeOf<ReviewRequest>().toMatchTypeOf<{
      orderNumber: string;
      reviewUrl: string | null;
      lineItems: EmailLineItem[];
    }>();
  });
});
