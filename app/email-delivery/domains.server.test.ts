import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.server", () => ({ default: {} }));

import type { SendingDomain } from "@prisma/client";
import db from "../db.server";
import {
  allPendingRecordsPublished,
  diagnoseRecords,
  lookupDmarc,
  refreshSendingDomainRow,
  resendDomains,
  ResendApiError,
  verifyResendWebhook,
  type DnsLookup,
} from "./domains.server";
import type { ResendDnsRecord } from "./sending-domain";

function notFound(): never {
  throw Object.assign(new Error("queryTxt ENOTFOUND"), { code: "ENOTFOUND" });
}

function fakeDns(zone: { txt?: Record<string, string[]>; mx?: Record<string, string[]> }): DnsLookup {
  return {
    resolveTxt: async (host) => (zone.txt?.[host] ? zone.txt[host].map((v) => [v]) : notFound()),
    resolveMx: async (host) => (zone.mx?.[host] ? zone.mx[host].map((exchange) => ({ exchange, priority: 10 })) : notFound()),
    resolveCname: async () => notFound(),
  };
}

describe("resendDomains", () => {
  beforeEach(() => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => vi.unstubAllEnvs());

  it("creates a domain with the send return path", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ id: "d_1", name: "a.com", status: "not_started", records: [] }), { status: 201 }));
    const domain = await resendDomains.create("a.com");
    expect(domain.id).toBe("d_1");
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://api.resend.com/domains");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ name: "a.com", region: "us-east-1", custom_return_path: "send" });
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer re_test");
  });

  it("surfaces provider errors with their status", async () => {
    vi.mocked(fetch).mockImplementation(async () => new Response(JSON.stringify({ name: "validation_error", message: "Domain already exists" }), { status: 403 }));
    await expect(resendDomains.create("a.com")).rejects.toMatchObject({ status: 403, providerMessage: "Domain already exists" });
    await expect(resendDomains.create("a.com")).rejects.toBeInstanceOf(ResendApiError);
  });

  it("refuses to call Resend without an API key", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    await expect(resendDomains.get("d_1")).rejects.toThrow(/RESEND_API_KEY/);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("diagnoseRecords", () => {
  const records: ResendDnsRecord[] = [
    { record: "DKIM", name: "resend._domainkey", type: "TXT", value: "p=KEY", status: "pending" },
    { record: "SPF", name: "send", type: "MX", value: "feedback-smtp.us-east-1.amazonses.com", status: "pending" },
    { record: "SPF", name: "send", type: "TXT", value: "v=spf1 include:amazonses.com ~all", status: "pending" },
  ];

  it("reports found, doubled and mismatched records", async () => {
    const notes = await diagnoseRecords("a.com", records, fakeDns({
      txt: { "resend._domainkey.a.com": ["p=KEY"], "send.a.com": ["v=spf1 include:amazon"] },
      mx: { "send.a.com.a.com": ["feedback-smtp.us-east-1.amazonses.com."] },
    }));
    expect(notes).toEqual({
      "TXT:resend._domainkey": { kind: "found" },
      "MX:send": { kind: "doubled", fqdn: "send.a.com.a.com" },
      "TXT:send": { kind: "mismatch", found: "v=spf1 include:amazon" },
    });
  });

  it("reports missing records and skips verified ones", async () => {
    const notes = await diagnoseRecords("a.com", [{ ...records[0], status: "verified" }, records[1]], fakeDns({}));
    expect(notes).toEqual({ "MX:send": { kind: "missing", fqdn: "send.a.com" } });
  });

  it("says nothing when DNS itself fails", async () => {
    const dns = fakeDns({});
    dns.resolveMx = async () => { throw Object.assign(new Error("timeout"), { code: "ETIMEOUT" }); };
    expect(await diagnoseRecords("a.com", [records[1]], dns)).toEqual({});
  });
});

describe("allPendingRecordsPublished", () => {
  const records: ResendDnsRecord[] = [
    { record: "DKIM", name: "resend._domainkey", type: "TXT", value: "p=KEY", status: "pending" },
    { record: "SPF", name: "rsend", type: "CNAME", value: "send.forge.rmta.net", status: "verified" },
  ];

  it("is true when every unverified record is found in DNS", () => {
    expect(allPendingRecordsPublished(records, { "TXT:resend._domainkey": { kind: "found" } })).toBe(true);
  });

  it("is false while any unverified record is missing or wrong", () => {
    expect(allPendingRecordsPublished(records, {})).toBe(false);
    expect(allPendingRecordsPublished(records, { "TXT:resend._domainkey": { kind: "mismatch", found: "p=OLD" } })).toBe(false);
  });

  it("is false when nothing is pending", () => {
    expect(allPendingRecordsPublished([records[1]], {})).toBe(false);
  });
});

describe("refreshSendingDomainRow auto-verify", () => {
  const pending = { record: "DKIM", name: "resend._domainkey", type: "TXT", value: "p=KEY", status: "pending" };
  const row = { shop: "auto.myshopify.com", domain: "a.com", providerDomainId: "d_1", status: "pending", records: "[]", verifiedAt: null } as unknown as SendingDomain;
  const dns = fakeDns({ txt: { "resend._domainkey.a.com": ["p=KEY"] } });

  beforeEach(() => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    (db as unknown as { sendingDomain: unknown }).sendingDomain = { update: vi.fn(async ({ data }) => data) };
  });
  afterEach(() => vi.restoreAllMocks());

  it("asks Resend to verify once every record is published, then throttles", async () => {
    const get = vi.spyOn(resendDomains, "get")
      .mockResolvedValueOnce({ id: "d_1", name: "a.com", status: "pending", records: [pending] })
      .mockResolvedValueOnce({ id: "d_1", name: "a.com", status: "verified", records: [{ ...pending, status: "verified" }] })
      .mockResolvedValue({ id: "d_1", name: "a.com", status: "pending", records: [pending] });
    const verify = vi.spyOn(resendDomains, "verify").mockResolvedValue({ id: "d_1" });

    const saved = await refreshSendingDomainRow(row, dns);
    expect(verify).toHaveBeenCalledTimes(1);
    expect(saved).toMatchObject({ status: "verified", recordNotes: "{}" });

    await refreshSendingDomainRow(row, dns);
    expect(verify).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledTimes(3);
  });

  it("doesn't trigger verify while a record is still missing", async () => {
    vi.spyOn(resendDomains, "get").mockResolvedValue({ id: "d_1", name: "a.com", status: "pending", records: [pending] });
    const verify = vi.spyOn(resendDomains, "verify").mockResolvedValue({ id: "d_1" });
    await refreshSendingDomainRow({ ...row, shop: "missing.myshopify.com" }, fakeDns({}));
    expect(verify).not.toHaveBeenCalled();
  });
});

describe("lookupDmarc", () => {
  it.each([
    [{}, { state: "missing", value: null }],
    [{ "_dmarc.a.com": ["v=DMARC1; p=none"] }, { state: "found", value: "v=DMARC1; p=none" }],
    [{ "_dmarc.a.com": ["v=DMARC1; p=none", "v=DMARC1; p=reject"] }, { state: "multiple", value: "v=DMARC1; p=none\nv=DMARC1; p=reject" }],
  ])("%j", async (txt, expected) => {
    expect(await lookupDmarc("a.com", fakeDns({ txt }))).toEqual(expected);
  });
});

describe("verifyResendWebhook", () => {
  const key = Buffer.from("super-secret-signing-key");
  const secret = `whsec_${key.toString("base64")}`;
  const body = JSON.stringify({ type: "domain.updated", data: { id: "d_1" } });
  const now = 1_790_000_000;
  const sign = (id: string, ts: number, payload: string) =>
    `v1,${createHmac("sha256", key).update(`${id}.${ts}.${payload}`).digest("base64")}`;

  it("accepts a valid signature among several", () => {
    expect(verifyResendWebhook(body, { id: "msg_1", timestamp: String(now), signature: `v1,bogus ${sign("msg_1", now, body)}` }, secret, now)).toBe(true);
  });
  it("rejects a tampered body", () => {
    expect(verifyResendWebhook(`${body} `, { id: "msg_1", timestamp: String(now), signature: sign("msg_1", now, body) }, secret, now)).toBe(false);
  });
  it("rejects a stale timestamp", () => {
    const old = now - 600;
    expect(verifyResendWebhook(body, { id: "msg_1", timestamp: String(old), signature: sign("msg_1", old, body) }, secret, now)).toBe(false);
  });
  it("rejects missing headers", () => {
    expect(verifyResendWebhook(body, { id: null, timestamp: String(now), signature: "v1,x" }, secret, now)).toBe(false);
  });
});
