import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.server", () => ({ default: {} }));

import { createUnsubscribeToken, listUnsubscribeHeaders, readUnsubscribeToken, unsubscribeUrl } from "./unsubscribe.server";

describe("unsubscribe tokens", () => {
  beforeEach(() => vi.stubEnv("UNSUBSCRIBE_SECRET", "test-secret"));
  afterEach(() => vi.unstubAllEnvs());

  it("round-trips shop and a normalized email", () => {
    const token = createUnsubscribeToken({ shop: "a.myshopify.com", email: " Jo@Example.com " });
    expect(readUnsubscribeToken(token)).toEqual({ shop: "a.myshopify.com", email: "jo@example.com" });
  });

  it("rejects tampered, foreign-secret and malformed tokens", () => {
    const token = createUnsubscribeToken({ shop: "a.myshopify.com", email: "jo@example.com" });
    const [payload, signature] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ s: "a.myshopify.com", e: "someone@else.com" })).toString("base64url");
    expect(readUnsubscribeToken(`${forged}.${signature}`)).toBeNull();
    vi.stubEnv("UNSUBSCRIBE_SECRET", "other-secret");
    expect(readUnsubscribeToken(`${payload}.${signature}`)).toBeNull();
    expect(readUnsubscribeToken("nonsense")).toBeNull();
    expect(readUnsubscribeToken(null)).toBeNull();
  });

  it("builds the public URL and RFC 8058 headers", () => {
    const url = unsubscribeUrl({ shop: "a.myshopify.com", email: "jo@example.com" }, "https://dev.trynomi.email/");
    expect(url).toMatch(/^https:\/\/dev\.trynomi\.email\/unsubscribe\?t=[\w-]+\.[\w-]+$/);
    expect(listUnsubscribeHeaders(url)).toEqual({ "List-Unsubscribe": `<${url}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
  });
});
