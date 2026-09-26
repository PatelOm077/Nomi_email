// Client-safe half of the sending-domain feature: normalization, validation
// and the Resend-status → UI-state mapping. No DB, DNS or network here so the
// route component can import it too (server-only work is in
// domains.server.ts). See SENDING_DOMAIN.md.

export type ResendDomainStatus =
  | "not_started"
  | "pending"
  | "verified"
  | "partially_verified"
  | "partially_failed"
  | "failed"
  | "temporary_failure";

export type ResendRecordStatus =
  | "not_started"
  | "pending"
  | "verified"
  | "failed"
  | "temporary_failure";

// Resend's records[] entry, stored verbatim.
export type ResendDnsRecord = {
  record: string; // "SPF" | "DKIM" | "DMARC" | "Receiving" | "Tracking" ...
  name: string; // host relative to the domain: "send", "resend._domainkey"
  type: string; // "TXT" | "MX" | "CNAME"
  value: string;
  ttl?: string | number;
  status: ResendRecordStatus | string;
  priority?: number | null;
};

// Result of Nomi's own DNS lookup for a record Resend hasn't verified yet.
export type RecordNote =
  | { kind: "found" } // DNS already has it; Resend will catch up
  | { kind: "missing"; fqdn: string }
  | { kind: "doubled"; fqdn: string } // provider appended the domain twice
  | { kind: "mismatch"; found: string };

export type DmarcState = "unknown" | "missing" | "found" | "multiple";

export const RETURN_PATH_SUBDOMAIN = "send";

// Free-mail and shared hosts a merchant can't publish DNS for.
const BLOCKED_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com",
  "msn.com", "yahoo.com", "ymail.com", "icloud.com", "me.com", "mac.com",
  "aol.com", "proton.me", "protonmail.com", "gmx.com", "mail.com",
  "zoho.com", "yandex.com",
]);

const HOSTNAME_RE =
  /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;

export function normalizeDomain(input: string | null | undefined): string {
  return String(input ?? "")
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/:\d+$/, "")
    .replace(/^www\./, "")
    .replace(/\.$/, "");
}

// Returns merchant-facing error copy, or null when the domain is usable.
// Expects an already-normalized domain.
export function validateDomain(domain: string): string | null {
  if (!domain) return "Enter your domain, like yourstore.com.";
  if (/(^|\.)myshopify\.com$/.test(domain))
    return "That’s your Shopify address. Enter the domain you own, like yourstore.com.";
  if (!HOSTNAME_RE.test(domain))
    return "That doesn’t look like a domain. Check for spaces or typos — it should look like yourstore.com.";
  if (BLOCKED_DOMAINS.has(domain))
    return `You can’t send campaigns from ${domain}. Use a domain your store owns.`;
  return null;
}

// Host as the merchant types it at their DNS provider. Resend returns hosts
// relative to the domain; an empty/"@" host means the root.
export function recordFqdn(record: Pick<ResendDnsRecord, "name">, domain: string): string {
  const name = record.name.trim().replace(/\.$/, "");
  if (!name || name === "@") return domain;
  if (name === domain || name.endsWith(`.${domain}`)) return name;
  return `${name}.${domain}`;
}

export function recordKey(record: Pick<ResendDnsRecord, "type" | "name">): string {
  return `${record.type.toUpperCase()}:${record.name}`;
}

export function recordPurpose(record: ResendDnsRecord): string {
  if (record.record === "DKIM") return "Signing (DKIM)";
  if (record.record === "SPF") return record.type === "MX" ? "Bounces (SPF)" : "Sender check (SPF)";
  if (record.record === "Tracking") return "Link tracking";
  if (record.record === "Receiving") return "Receiving";
  return record.record;
}

// ---------------------------------------------------------------------------
// UI state
// ---------------------------------------------------------------------------

export type CheckState = "idle" | "pending" | "partial" | "failed" | "verified" | "missing";
export type Tone = "neutral" | "checking" | "ok" | "warn" | "bad";

export type RecordView = ResendDnsRecord & {
  key: string;
  purpose: string;
  label: string;
  tone: Tone;
  detail: string | null;
};

export type DomainView = {
  check: CheckState;
  verified: boolean;
  verifiedCount: number;
  total: number;
  overallLabel: string;
  overallTone: Tone;
  notice: { title: string; body: string; tone: "warn" | "bad" } | null;
  checkLabel: string;
  records: RecordView[];
};

function recordView(record: ResendDnsRecord, domain: string, note: RecordNote | undefined): RecordView {
  const base = { ...record, key: recordKey(record), purpose: recordPurpose(record) };
  const fqdn = recordFqdn(record, domain);
  if (record.status === "verified") return { ...base, label: "Verified", tone: "ok", detail: null };

  if (note?.kind === "found")
    return { ...base, label: "Found", tone: "checking", detail: null };
  if (note?.kind === "doubled")
    return {
      ...base, label: "Not found", tone: "bad",
      detail: `Found at ${note.fqdn} instead of ${fqdn}. Your provider adds ${domain} automatically, so the host should be just ${record.name} — not ${fqdn}.`,
    };
  if (note?.kind === "mismatch")
    return {
      ...base, label: "Doesn’t match", tone: "bad",
      detail: `Found, but the value doesn’t match: “${truncate(note.found, 60)}”. Paste the full value on one line and save.`,
    };
  if (note?.kind === "missing")
    return {
      ...base, label: "Not found", tone: "bad",
      detail: `Not found at ${fqdn}. If your provider adds your domain automatically, the host should be just ${record.name} — not ${fqdn}.`,
    };

  if (record.status === "failed" || record.status === "temporary_failure")
    return { ...base, label: "Not found", tone: "bad", detail: null };
  if (record.status === "pending") return { ...base, label: "Checking", tone: "checking", detail: null };
  return { ...base, label: "Not checked", tone: "neutral", detail: null };
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

export function buildDomainView(input: {
  domain: string;
  status: string;
  records: ResendDnsRecord[];
  notes: Record<string, RecordNote>;
}): DomainView {
  const records = input.records.map((r) => recordView(r, input.domain, input.notes[recordKey(r)]));
  const total = records.length;
  const verifiedCount = records.filter((r) => r.status === "verified").length;
  const needsFix = records.filter((r) => r.tone === "bad").length;
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

  let check: CheckState;
  switch (input.status) {
    case "verified": check = "verified"; break;
    case "failed": check = "failed"; break;
    case "temporary_failure": check = "missing"; break;
    case "partially_verified":
    case "partially_failed": check = "partial"; break;
    case "pending": check = verifiedCount > 0 || needsFix > 0 ? "partial" : "pending"; break;
    default: check = "idle";
  }

  const overall: Record<CheckState, [string, Tone]> = {
    idle: ["Waiting for records", "neutral"],
    pending: ["Checking in the background", "checking"],
    partial: [`${verifiedCount} of ${total} found`, "warn"],
    missing: [`${verifiedCount} of ${total} found`, "warn"],
    failed: ["Verification stopped", "bad"],
    verified: ["Verified", "ok"],
  };

  let notice: DomainView["notice"] = null;
  if (check === "partial" && needsFix > 0)
    notice = {
      title: `${plural(needsFix, "record")} need${needsFix === 1 ? "s" : ""} a fix`,
      body: verifiedCount > 0
        ? `${plural(verifiedCount, "record")} ${verifiedCount === 1 ? "is" : "are"} set up. Fix the ${needsFix === 1 ? "one" : needsFix} below, then check again.`
        : "Fix the records marked below, then check again.",
      tone: "warn",
    };
  if (check === "missing")
    notice = {
      title: "A record went missing",
      body: "This domain was verified, but a record is no longer found. Campaign sending is paused until it’s back.",
      tone: "bad",
    };
  if (check === "failed")
    notice = {
      title: "We couldn’t find these records",
      body: "We kept checking for 72 hours. Nothing is broken — add the records below, then restart verification.",
      tone: "bad",
    };

  const checkLabel: Record<CheckState, string> = {
    idle: "Verify records",
    pending: "Verify again",
    partial: "Verify again",
    missing: "Verify again",
    failed: "Restart verification",
    verified: "Verify again",
  };

  return {
    check,
    verified: check === "verified",
    verifiedCount,
    total,
    overallLabel: overall[check][0],
    overallTone: overall[check][1],
    notice,
    checkLabel: checkLabel[check],
    records,
  };
}

// A shop may send campaigns only from a verified domain.
export function isSendingDomainReady(status: string | null | undefined): boolean {
  return status === "verified";
}

// Until its domain is verified a shop can create this many campaigns in
// total (drafts included). Verified shops have no cap.
export const UNVERIFIED_CAMPAIGN_LIMIT = 3;

export function campaignLimitReached(campaignCount: number, domainStatus: string | null | undefined): boolean {
  return !isSendingDomainReady(domainStatus) && campaignCount >= UNVERIFIED_CAMPAIGN_LIMIT;
}

export const CAMPAIGN_LIMIT_MESSAGE =
  `You’ve created ${UNVERIFIED_CAMPAIGN_LIMIT} campaigns. Set up and verify your custom domain to create more.`;
