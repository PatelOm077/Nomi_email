import { createHmac, timingSafeEqual } from "node:crypto";
import { Resolver } from "node:dns/promises";
import type { SendingDomain } from "@prisma/client";
import db from "../db.server";
import {
  RETURN_PATH_SUBDOMAIN,
  isSendingDomainReady,
  normalizeDomain,
  recordFqdn,
  recordKey,
  validateDomain,
  type DmarcState,
  type RecordNote,
  type ResendDnsRecord,
} from "./sending-domain";

// Per-shop sending domains in Nomi's Resend account (SENDING_DOMAIN.md).
// Resend is the source of truth for verification; Nomi adds its own DNS
// lookups only to explain *why* a record isn't verified yet.

const RESEND_API = "https://api.resend.com";
const DEFAULT_REGION = "us-east-1";
// Loader refresh throttle while a domain is still verifying.
export const PENDING_REFRESH_MS = 15_000;
// Background re-check of verified domains (catches temporary_failure).
const VERIFIED_RECHECK_MS = 24 * 60 * 60 * 1000;
const UNVERIFIED_RECHECK_MS = 5 * 60 * 1000;

export class SendingDomainError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "SendingDomainError";
  }
}

export function isDomainSetupConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

// ---------------------------------------------------------------------------
// Resend Domains API
// ---------------------------------------------------------------------------

export type ResendDomain = {
  id: string;
  name: string;
  status: string;
  region?: string;
  records?: ResendDnsRecord[];
};

type ResendError = { message?: string; name?: string; statusCode?: number };

async function resendRequest<T>(path: string, init: { method: string; body?: unknown }): Promise<T> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new SendingDomainError("Domain setup isn’t available: RESEND_API_KEY is not set.", 503);
  const response = await fetch(`${RESEND_API}${path}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await response.text();
  const json = text ? (JSON.parse(text) as T & ResendError) : ({} as T & ResendError);
  if (!response.ok) {
    const error = new ResendApiError(response.status, json.message ?? json.name ?? "unknown error");
    throw error;
  }
  return json;
}

export class ResendApiError extends Error {
  constructor(readonly status: number, readonly providerMessage: string) {
    super(`Resend domains API ${status}: ${providerMessage}`);
    this.name = "ResendApiError";
  }
}

export const resendDomains = {
  create: (name: string, region = DEFAULT_REGION) =>
    resendRequest<ResendDomain>("/domains", {
      method: "POST",
      body: { name, region, custom_return_path: RETURN_PATH_SUBDOMAIN },
    }),
  get: (id: string) => resendRequest<ResendDomain>(`/domains/${encodeURIComponent(id)}`, { method: "GET" }),
  verify: (id: string) =>
    resendRequest<{ id: string }>(`/domains/${encodeURIComponent(id)}/verify`, { method: "POST" }),
  remove: (id: string) =>
    resendRequest<{ id: string; deleted: boolean }>(`/domains/${encodeURIComponent(id)}`, { method: "DELETE" }),
};

// ---------------------------------------------------------------------------
// DNS diagnostics
// ---------------------------------------------------------------------------

export type DnsLookup = {
  resolveTxt(host: string): Promise<string[][]>;
  resolveMx(host: string): Promise<{ exchange: string; priority: number }[]>;
  resolveCname(host: string): Promise<string[]>;
};

function defaultResolver(): DnsLookup {
  return new Resolver({ timeout: 2500, tries: 2 });
}

const NOT_FOUND_CODES = new Set(["ENOTFOUND", "ENODATA", "ENOENT", "NXDOMAIN"]);
const isNotFound = (error: unknown) =>
  NOT_FOUND_CODES.has((error as { code?: string } | null)?.code ?? "");

const clean = (value: string) => value.trim().replace(/\.$/, "").toLowerCase();

// Values at `host` for this record's type, [] when nothing is published,
// null when DNS itself failed (timeout etc.) and we shouldn't claim anything.
async function valuesAt(dns: DnsLookup, type: string, host: string): Promise<string[] | null> {
  try {
    if (type === "TXT") return (await dns.resolveTxt(host)).map((chunks) => chunks.join(""));
    if (type === "MX") return (await dns.resolveMx(host)).map((mx) => clean(mx.exchange));
    if (type === "CNAME") return (await dns.resolveCname(host)).map(clean);
    return null;
  } catch (error) {
    return isNotFound(error) ? [] : null;
  }
}

function matches(record: ResendDnsRecord, found: string): boolean {
  if (record.type === "TXT") return found.trim() === record.value.trim();
  return found === clean(record.value);
}

// TXT values that are clearly an attempt at *this* record (same leading
// tag), so a different value is a mismatch rather than an unrelated record.
function sameKind(record: ResendDnsRecord, found: string): boolean {
  const tag = (v: string) => v.trim().split(/[\s;]/)[0]?.toLowerCase() ?? "";
  return tag(found) === tag(record.value);
}

export async function diagnoseRecords(
  domain: string,
  records: ResendDnsRecord[],
  dns: DnsLookup = defaultResolver(),
): Promise<Record<string, RecordNote>> {
  const notes: Record<string, RecordNote> = {};
  await Promise.all(
    records
      .filter((record) => record.status !== "verified")
      .map(async (record) => {
        const fqdn = recordFqdn(record, domain);
        const found = await valuesAt(dns, record.type, fqdn);
        if (found === null) return;
        if (found.some((value) => matches(record, value))) {
          notes[recordKey(record)] = { kind: "found" };
          return;
        }
        const attempt = record.type === "TXT" ? found.find((value) => sameKind(record, value)) : found[0];
        if (attempt) {
          notes[recordKey(record)] = { kind: "mismatch", found: attempt };
          return;
        }
        const doubledHost = `${fqdn}.${domain}`;
        const doubled = await valuesAt(dns, record.type, doubledHost);
        notes[recordKey(record)] = doubled && doubled.some((value) => matches(record, value))
          ? { kind: "doubled", fqdn: doubledHost }
          : { kind: "missing", fqdn };
      }),
  );
  return notes;
}

export async function lookupDmarc(
  domain: string,
  dns: DnsLookup = defaultResolver(),
): Promise<{ state: DmarcState; value: string | null }> {
  try {
    const policies = (await dns.resolveTxt(`_dmarc.${domain}`))
      .map((chunks) => chunks.join(""))
      .filter((value) => /^v=DMARC1/i.test(value.trim()));
    if (policies.length === 0) return { state: "missing", value: null };
    if (policies.length > 1) return { state: "multiple", value: policies.join("\n") };
    return { state: "found", value: policies[0] };
  } catch (error) {
    return isNotFound(error) ? { state: "missing", value: null } : { state: "unknown", value: null };
  }
}

// ---------------------------------------------------------------------------
// Shop-level operations
// ---------------------------------------------------------------------------

export function parseRecords(row: Pick<SendingDomain, "records">): ResendDnsRecord[] {
  try {
    const parsed = JSON.parse(row.records);
    return Array.isArray(parsed) ? (parsed as ResendDnsRecord[]) : [];
  } catch {
    return [];
  }
}

export function parseRecordNotes(row: Pick<SendingDomain, "recordNotes">): Record<string, RecordNote> {
  try {
    const parsed = JSON.parse(row.recordNotes);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, RecordNote>) : {};
  } catch {
    return {};
  }
}

export async function getSendingDomain(shop: string) {
  return db.sendingDomain.findUnique({ where: { shop } });
}

export async function getSendingDomainSummary(shop: string) {
  const row = await getSendingDomain(shop);
  if (!row) return null;
  return { domain: row.domain, status: row.status, verified: isSendingDomainReady(row.status) };
}

// Writes a fresh Resend snapshot (plus optional DNS diagnostics) to the row.
async function saveSnapshot(
  row: SendingDomain,
  remote: ResendDomain,
  extra: { notes?: Record<string, RecordNote>; dmarc?: { state: DmarcState; value: string | null } } = {},
) {
  const nowVerified = remote.status === "verified";
  return db.sendingDomain.update({
    where: { shop: row.shop },
    data: {
      status: remote.status,
      records: JSON.stringify(remote.records ?? parseRecords(row)),
      ...(extra.notes ? { recordNotes: JSON.stringify(extra.notes) } : nowVerified ? { recordNotes: "{}" } : {}),
      ...(extra.dmarc ? { dmarcState: extra.dmarc.state, dmarcValue: extra.dmarc.value } : {}),
      lastCheckedAt: new Date(),
      verifiedAt: nowVerified ? row.verifiedAt ?? new Date() : row.verifiedAt,
      lastError: null,
    },
  });
}

export async function createSendingDomain(shop: string, rawDomain: string, dns?: DnsLookup) {
  const domain = normalizeDomain(rawDomain);
  const invalid = validateDomain(domain);
  if (invalid) throw new SendingDomainError(invalid);

  const existing = await getSendingDomain(shop);
  if (existing) {
    if (existing.domain === domain) return existing;
    throw new SendingDomainError(`Remove ${existing.domain} before adding a new domain.`);
  }
  const claimed = await db.sendingDomain.findUnique({ where: { domain } });
  if (claimed) throw new SendingDomainError(`${domain} is already connected to another store in Nomi.`, 409);

  let remote: ResendDomain;
  try {
    remote = await resendDomains.create(domain);
  } catch (error) {
    if (error instanceof ResendApiError && (error.status === 403 || error.status === 409 || /already/i.test(error.providerMessage)))
      throw new SendingDomainError(`${domain} is already registered with Nomi’s email provider. Contact support to move it to this store.`, 409);
    if (error instanceof ResendApiError && error.status === 422)
      throw new SendingDomainError(`Nomi’s email provider rejected ${domain}: ${error.providerMessage}`);
    throw error;
  }

  const dmarc = await lookupDmarc(domain, dns);
  return db.sendingDomain.create({
    data: {
      shop,
      domain,
      providerDomainId: remote.id,
      region: remote.region ?? DEFAULT_REGION,
      returnPath: RETURN_PATH_SUBDOMAIN,
      status: remote.status ?? "not_started",
      records: JSON.stringify(remote.records ?? []),
      dmarcState: dmarc.state,
      dmarcValue: dmarc.value,
    },
  });
}

// Backs the "Verify records" button: asks Resend to re-check now, then
// snapshots the result and runs Nomi's own lookups for per-record copy.
export async function verifySendingDomain(shop: string, dns?: DnsLookup) {
  const row = await getSendingDomain(shop);
  if (!row) throw new SendingDomainError("Add a domain first.");
  try {
    await resendDomains.verify(row.providerDomainId);
  } catch (error) {
    // A 404 means the domain was deleted in Resend — forget it locally.
    if (error instanceof ResendApiError && error.status === 404) {
      await db.sendingDomain.delete({ where: { shop } });
      throw new SendingDomainError("This domain was removed from Nomi’s email provider. Add it again to continue.", 404);
    }
    throw error;
  }
  const remote = await resendDomains.get(row.providerDomainId);
  const [notes, dmarc] = await Promise.all([
    diagnoseRecords(row.domain, remote.records ?? [], dns),
    lookupDmarc(row.domain, dns),
  ]);
  return saveSnapshot(row, remote, { notes, dmarc });
}

// True when every record Resend hasn't verified yet is already correct in
// public DNS — i.e. only Resend's own re-check is outstanding.
export function allPendingRecordsPublished(
  records: ResendDnsRecord[],
  notes: Record<string, RecordNote>,
): boolean {
  const pending = records.filter((record) => record.status !== "verified");
  return pending.length > 0 && pending.every((record) => notes[recordKey(record)]?.kind === "found");
}

// Resend doesn't reliably re-check on its own after a failed first pass
// (e.g. a record that was briefly proxied), so once Nomi sees every record
// published we trigger its verify ourselves — at most once a minute per shop.
export const AUTO_VERIFY_INTERVAL_MS = 60_000;
const lastAutoVerifyAt = new Map<string, number>();

async function autoVerifyIfPublished(
  row: SendingDomain,
  remote: ResendDomain,
  notes: Record<string, RecordNote>,
  now = Date.now(),
): Promise<boolean> {
  if (!allPendingRecordsPublished(remote.records ?? [], notes)) return false;
  if (now - (lastAutoVerifyAt.get(row.shop) ?? 0) < AUTO_VERIFY_INTERVAL_MS) return false;
  lastAutoVerifyAt.set(row.shop, now);
  await resendDomains.verify(row.providerDomainId);
  return true;
}

// Status pull used by the page loader while a domain is verifying, the
// scheduled task and the Resend webhook. Only triggers Resend's verify when
// Nomi's own lookups show every record already published.
export async function refreshSendingDomainRow(row: SendingDomain, dns?: DnsLookup) {
  try {
    let remote = await resendDomains.get(row.providerDomainId);
    // DNS lookups are cheap and bounded (2.5s timeout); re-run them while
    // unverified so a fixed record stops showing stale "Not found" copy.
    const verifying = remote.status !== "verified";
    let [notes, dmarc] = verifying || remote.status !== row.status
      ? await Promise.all([
          verifying ? diagnoseRecords(row.domain, remote.records ?? [], dns) : Promise.resolve(undefined),
          lookupDmarc(row.domain, dns),
        ])
      : [undefined, undefined];
    if (notes && (await autoVerifyIfPublished(row, remote, notes))) {
      remote = await resendDomains.get(row.providerDomainId);
      const stillPending = new Set((remote.records ?? []).filter((r) => r.status !== "verified").map(recordKey));
      notes = Object.fromEntries(Object.entries(notes).filter(([key]) => stillPending.has(key)));
    }
    return await saveSnapshot(row, remote, { notes, dmarc });
  } catch (error) {
    if (error instanceof ResendApiError && error.status === 404) {
      await db.sendingDomain.delete({ where: { shop: row.shop } });
      return null;
    }
    const message = error instanceof Error ? error.message : String(error);
    return db.sendingDomain.update({ where: { shop: row.shop }, data: { lastError: message.slice(0, 500) } });
  }
}

export async function refreshSendingDomainIfStale(shop: string) {
  const row = await getSendingDomain(shop);
  if (!row || row.status === "verified" || !isDomainSetupConfigured()) return row;
  const age = row.lastCheckedAt ? Date.now() - row.lastCheckedAt.getTime() : Infinity;
  if (age < PENDING_REFRESH_MS) return row;
  return refreshSendingDomainRow(row);
}

export async function removeSendingDomain(shop: string) {
  const row = await getSendingDomain(shop);
  if (!row) return;
  try {
    await resendDomains.remove(row.providerDomainId);
  } catch (error) {
    if (!(error instanceof ResendApiError && error.status === 404)) throw error;
  }
  await db.sendingDomain.delete({ where: { shop } });
}

// Called from the scheduled /tasks/email-jobs run.
export async function refreshStaleSendingDomains(limit = 25) {
  if (!isDomainSetupConfigured()) return { refreshed: 0 };
  const now = Date.now();
  const rows = await db.sendingDomain.findMany({
    where: {
      OR: [
        { lastCheckedAt: null },
        { status: { not: "verified" }, lastCheckedAt: { lt: new Date(now - UNVERIFIED_RECHECK_MS) } },
        { status: "verified", lastCheckedAt: { lt: new Date(now - VERIFIED_RECHECK_MS) } },
      ],
      // Resend stops checking after 72h; don't poll a stopped domain forever.
      NOT: { status: "failed" },
    },
    orderBy: { lastCheckedAt: "asc" },
    take: limit,
  });
  for (const row of rows) await refreshSendingDomainRow(row);
  return { refreshed: rows.length };
}

export async function handleResendDomainEvent(providerDomainId: string) {
  const row = await db.sendingDomain.findUnique({ where: { providerDomainId } });
  if (!row) return false;
  await refreshSendingDomainRow(row);
  return true;
}

// ---------------------------------------------------------------------------
// Resend webhook signatures (Svix scheme)
// ---------------------------------------------------------------------------

const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

export function verifyResendWebhook(
  rawBody: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  if (!headers.id || !headers.timestamp || !headers.signature) return false;
  const timestamp = Number(headers.timestamp);
  if (!Number.isFinite(timestamp) || Math.abs(nowSeconds - timestamp) > WEBHOOK_TOLERANCE_SECONDS) return false;

  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key)
    .update(`${headers.id}.${headers.timestamp}.${rawBody}`)
    .digest();

  return headers.signature.split(" ").some((part) => {
    const [version, value] = part.split(",");
    if (version !== "v1" || !value) return false;
    const supplied = Buffer.from(value, "base64");
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  });
}
