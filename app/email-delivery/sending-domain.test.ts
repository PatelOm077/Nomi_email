import { describe, expect, it } from "vitest";
import {
  buildDomainView,
  campaignLimitReached,
  normalizeDomain,
  recordFqdn,
  validateDomain,
  type ResendDnsRecord,
} from "./sending-domain";

const records: ResendDnsRecord[] = [
  { record: "DKIM", name: "resend._domainkey", type: "TXT", value: "p=MIGf", status: "verified" },
  { record: "SPF", name: "send", type: "MX", value: "feedback-smtp.us-east-1.amazonses.com", priority: 10, status: "pending" },
  { record: "SPF", name: "send", type: "TXT", value: "v=spf1 include:amazonses.com ~all", status: "pending" },
];

describe("normalizeDomain", () => {
  it.each([
    ["https://www.MoonAndMango.com/collections/all", "moonandmango.com"],
    ["  moonandmango.com.  ", "moonandmango.com"],
    ["http://shop.moonandmango.com:443?x=1", "shop.moonandmango.com"],
    ["", ""],
  ])("%s → %s", (input, expected) => {
    expect(normalizeDomain(input)).toBe(expected);
  });
});

describe("validateDomain", () => {
  it("accepts a real domain", () => expect(validateDomain("moonandmango.com")).toBeNull());
  it("accepts a subdomain", () => expect(validateDomain("mail.moonandmango.co.uk")).toBeNull());
  it("rejects myshopify hosts", () => expect(validateDomain("moon-and-mango.myshopify.com")).toMatch(/Shopify address/));
  it("rejects free-mail domains", () => expect(validateDomain("gmail.com")).toMatch(/Use a domain your store owns/));
  it.each(["", "moon and mango.com", "localhost", "moon..com", "-moon.com"])("rejects %j", (value) => {
    expect(validateDomain(value)).not.toBeNull();
  });
});

describe("recordFqdn", () => {
  it("joins a relative host", () => expect(recordFqdn({ name: "send" }, "a.com")).toBe("send.a.com"));
  it("treats @ as the root", () => expect(recordFqdn({ name: "@" }, "a.com")).toBe("a.com"));
  it("leaves an already-qualified host", () => expect(recordFqdn({ name: "send.a.com" }, "a.com")).toBe("send.a.com"));
});

describe("buildDomainView", () => {
  it("maps not_started to the waiting state", () => {
    const view = buildDomainView({ domain: "a.com", status: "not_started", records: records.map((r) => ({ ...r, status: "not_started" })), notes: {} });
    expect(view.check).toBe("idle");
    expect(view.overallLabel).toBe("Waiting for records");
    expect(view.records.every((r) => r.label === "Not checked")).toBe(true);
  });

  it("explains a doubled host and a truncated value from Nomi's own lookup", () => {
    const view = buildDomainView({
      domain: "a.com",
      status: "pending",
      records,
      notes: {
        "MX:send": { kind: "doubled", fqdn: "send.a.com.a.com" },
        "TXT:send": { kind: "mismatch", found: "v=spf1 include:amazon" },
      },
    });
    expect(view.check).toBe("partial");
    expect(view.overallLabel).toBe("1 of 3 found");
    expect(view.notice?.title).toBe("2 records need a fix");
    expect(view.records[1].detail).toContain("send.a.com.a.com");
    expect(view.records[2].label).toBe("Doesn’t match");
  });

  it("shows a found-but-unconfirmed record as checking, not as an error", () => {
    const view = buildDomainView({ domain: "a.com", status: "pending", records: records.map((r) => ({ ...r, status: "pending" })), notes: { "TXT:send": { kind: "found" } } });
    expect(view.check).toBe("pending");
    expect(view.records[2]).toMatchObject({ label: "Found", tone: "checking", detail: null });
  });

  it("maps failed and temporary_failure", () => {
    expect(buildDomainView({ domain: "a.com", status: "failed", records, notes: {} }).checkLabel).toBe("Restart verification");
    expect(buildDomainView({ domain: "a.com", status: "temporary_failure", records, notes: {} }).notice?.title).toBe("A record went missing");
  });

  it("is verified only when Resend says so", () => {
    const all = records.map((r) => ({ ...r, status: "verified" }));
    expect(buildDomainView({ domain: "a.com", status: "pending", records: all, notes: {} }).verified).toBe(false);
    expect(buildDomainView({ domain: "a.com", status: "verified", records: all, notes: {} }).verified).toBe(true);
  });
});

describe("campaignLimitReached", () => {
  it("caps unverified shops at three campaigns", () => {
    expect(campaignLimitReached(2, null)).toBe(false);
    expect(campaignLimitReached(3, null)).toBe(true);
    expect(campaignLimitReached(3, "pending")).toBe(true);
    expect(campaignLimitReached(8, "partially_verified")).toBe(true);
  });
  it("has no cap once the domain is verified", () => {
    expect(campaignLimitReached(50, "verified")).toBe(false);
  });
});
