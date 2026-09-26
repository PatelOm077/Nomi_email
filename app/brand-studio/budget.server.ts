export const BRAND_STUDIO_HARD_CAP_MICROS = 3_000_000;

export type AiUsage = {
  provider: "openai" | "anthropic";
  inputTokens: number;
  outputTokens: number;
};

// Defaults reflect the approved model choices when Brand Studio was designed.
// Environment overrides let operations react to provider pricing changes
// without editing source or silently weakening the creative workflow.
function positiveRate(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function estimateUsageMicros(usage: AiUsage): number {
  const rates = usage.provider === "openai"
    ? {
        input: positiveRate("NOMI_SOL_INPUT_USD_PER_MTOK", 4),
        output: positiveRate("NOMI_SOL_OUTPUT_USD_PER_MTOK", 20),
      }
    : {
        input: positiveRate("NOMI_SONNET_INPUT_USD_PER_MTOK", 2),
        output: positiveRate("NOMI_SONNET_OUTPUT_USD_PER_MTOK", 10),
      };
  return Math.ceil(usage.inputTokens * rates.input + usage.outputTokens * rates.output);
}

export function assertStageBudget(currentMicros: number, reservedMicros: number) {
  if (currentMicros + reservedMicros > BRAND_STUDIO_HARD_CAP_MICROS) {
    throw new Error("This setup has reached Nomi's $3 generation limit. Continue with the saved direction or contact support before generating again.");
  }
}

export function formatCost(micros: number) {
  return `$${(micros / 1_000_000).toFixed(2)}`;
}
