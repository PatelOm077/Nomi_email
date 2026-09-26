import { describe, expect, it } from "vitest";
import {
  assertStageBudget,
  estimateUsageMicros,
  formatCost,
} from "../brand-studio/budget.server";

describe("Brand Studio budget", () => {
  it("prices provider usage in microdollars", () => {
    expect(
      estimateUsageMicros({
        provider: "openai",
        inputTokens: 1_000,
        outputTokens: 500,
      }),
    ).toBe(14_000);
    expect(
      estimateUsageMicros({
        provider: "anthropic",
        inputTokens: 1_000,
        outputTokens: 500,
      }),
    ).toBe(7_000);
  });

  it("enforces the hard cap before a stage begins", () => {
    expect(() => assertStageBudget(2_100_000, 800_000)).not.toThrow();
    expect(() => assertStageBudget(2_300_000, 800_000)).toThrow(
      /\$3 generation limit/,
    );
  });

  it("formats merchant-facing cost", () => {
    expect(formatCost(1_845_000)).toBe("$1.84");
  });
});
