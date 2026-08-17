import Anthropic from "@anthropic-ai/sdk";

// Lazy singleton: constructing the client reads ANTHROPIC_API_KEY from the
// environment, which we don't want to require at module-load time (breaks
// typecheck/build tooling that imports this file without the env set).
let client: Anthropic | null = null;
export function getAnthropicClient(): Anthropic {
  if (!client) {
    client = new Anthropic();
  }
  return client;
}
