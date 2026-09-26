# Nomi sending domain (per-shop Resend domains)

Status: **built 24 Sep 2026** — route, Resend client, webhook, scheduled refresh,
Campaigns banner and a 3-campaign cap for unverified shops
(`UNVERIFIED_CAMPAIGN_LIMIT` in `app/email-delivery/sending-domain.ts`).
Delivery-side `resolveSender` (section "Delivery changes") is **not** built yet.

Design canvas: "Nomi Sending Domain" in
Claude Design (Desktop 1280 / Tablet 768 / Mobile 375 / Entry points pages).
Every board there is clickable; each board's starting state is a Tweak.

This is the gate for campaign delivery: a campaign can only send once the shop
has its **own** verified domain in Resend. Nothing here may be simulated in
the real UI — no fake checks, no "ready" state derived from a shared address.

## What the code does today (and why it has to change)

| File | Today | Problem |
| --- | --- | --- |
| `app/email-delivery/config.server.ts` | One global `NOMI_FROM_EMAIL` / `NOMI_FROM_NAME` | Every shop sends as Nomi |
| `app/email-delivery/provider.server.ts` | `from: ${fromName} <${fromEmail}>` from global config | No per-shop sender, no reply-to |
| `app/email-delivery/process-jobs.server.ts` | Calls `sendEmail` with global sender | Same |
| `app/routes/app._index.tsx` loader | `sendingEnabled` defaults to `isEmailDeliveryConfigured()` | "Ready" is claimed from env vars alone |
| `app/routes/app.brand-settings.tsx` Sender info | Company/address only, no From address | Nowhere to pick `hello@<domain>` |
| `app/routes/app.campaigns.tsx` (~L1602) | Magenta "Create and approve campaigns now" notice | No domain gate or entry point |

`extensions/` is empty — no theme app embed exists, so the domain flow has no
theme-embed step.

## Data model (`prisma/schema.prisma`)

```prisma
model SendingDomain {
  shop             String    @id
  domain           String              // normalized root: moonandmango.com
  provider         String    @default("resend")
  providerDomainId String    @unique   // Resend domain id
  region           String    @default("us-east-1")
  returnPath       String    @default("send")
  status           String    // mirrors Resend: not_started | pending | verified |
                             // partially_verified | partially_failed | failed | temporary_failure
  records          String    @default("[]") // Resend records[] verbatim (JSON)
  dmarcState       String    @default("unknown") // unknown | missing | found | multiple
  dmarcValue       String?
  lastCheckedAt    DateTime?
  verifiedAt       DateTime?
  lastError        String?
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt
}
```

`ShopSettings` gains `fromLocalPart String?` (e.g. `hello`) and
`replyTo String?`. From name reuses `senderName`.

Records are stored **exactly as Resend returns them** (`record`, `type`,
`name`, `value`, `priority`, `ttl`, `status`) and the UI renders from that
array — never from constants. The design shows Resend's current shape
(TXT `resend._domainkey`, MX + TXT on `send`) only as example data.

## Provider module — `app/email-delivery/domains.server.ts` (new)

| Function | Resend call | Notes |
| --- | --- | --- |
| `createSendingDomain(shop, input)` | `POST /domains` `{ name, region, custom_return_path: "send" }` | Normalize + validate first (below). If Resend says the domain already exists in Nomi's account and it belongs to another shop → refuse; never share a domain across shops. |
| `verifySendingDomain(shop)` | `POST /domains/{id}/verify`, then `GET /domains/{id}` | Backs the **Check records** button. Returns fresh status + per-record status. |
| `refreshSendingDomain(shop)` | `GET /domains/{id}` | Loader refresh when `lastCheckedAt` is older than ~60 s. |
| `removeSendingDomain(shop)` | `DELETE /domains/{id}` | Backs **Change domain**; also clears `fromLocalPart`. |
| `lookupDmarc(domain)` | `node:dns/promises` `resolveTxt("_dmarc." + domain)` | Count `v=DMARC1` strings: 0 → `missing`, 1 → `found` (store value), >1 → `multiple`. Only `missing` shows the add row. |

Validation (server, mirrored in UI): strip protocol, path, trailing dot and
`www.`; lowercase; valid hostname regex; ≤253 chars; reject
`*.myshopify.com`; reject free-mail domains (gmail.com, outlook.com, …).
Suggest the shop's primary domain from Admin GraphQL `shop.primaryDomain.host`
when it is not a myshopify host.

Status updates without the merchant watching:
- New route `app/routes/webhooks.resend.tsx` for Resend's `domain.updated`
  webhook; verify the signature with `RESEND_WEBHOOK_SECRET`, update the row
  by `providerDomainId`.
- The existing `/tasks/email-jobs` schedule also refreshes non-final domains
  and re-checks verified ones daily (catches `temporary_failure`).
- Auto-verify: Resend doesn't reliably re-check after a failed first pass
  (seen live on trynomi.email — a CNAME briefly saved as Cloudflare-proxied
  left the other three records `pending` long after DNS was correct). So any
  refresh that finds every unverified record already published in DNS calls
  Resend's verify itself, at most once a minute per shop
  (`refreshSendingDomainRow`). No merchant click needed.

New env: `RESEND_WEBHOOK_SECRET`. `RESEND_API_KEY` stays a single Nomi key.
Check the Resend plan's domain limit before beta — it's one domain per
merchant. The dropshipping pool (see learnings) can use a second Resend
account/API key selected per shop.

## State model → UI

| Resend status | UI state (design board) | Pill | Primary action | Campaign sends |
| --- | --- | --- | --- | --- |
| no row | Entry (`Main`, `*-Entry`) | — | Continue → confirm modal | Blocked |
| `not_started` | Records, not checked | Waiting for records | Check records | Blocked |
| request in flight | Checking | Checking… | disabled | Blocked |
| `pending` + some records verified | Partially verified | `n of m found` | Check again | Blocked |
| `pending`, none verified | Records | Waiting for records | Check again | Blocked |
| `partially_verified` / `partially_failed` | Partially verified | `n of m found` | Check again | Blocked |
| `failed` (72 h, nothing found) | Verification stopped | Verification stopped | Restart verification (= verify call) | Blocked |
| `verified` | Verified | Verified | Open Sender info | Allowed once From address set |
| `temporary_failure` | Partially verified + notice "A record went missing" | `n of m found` | Check again | **Paused** |

Per-record error copy is derived from the record's own `status` plus a server
DNS lookup of that host: not found at host, found at a doubled host
(`send.domain.com.domain.com`), or value mismatch/truncated. The checkbox
"I've added these" pattern is not used — only provider status moves state.

## Routes and components

- **New `app/routes/app.sending-domain.tsx`** — the flow. Loader returns
  `SendingDomain` + suggested domain + DMARC state. Action intents:
  `create`, `verify`, `remove`. Page shell reuses `nomi-flow-page` /
  `nomi-flow-title` like Campaigns; confirm/change dialogs reuse
  `.nomi-dialog`. Styles go in a `/* — sending domain — */` block in
  `app/styles/nomi.css`; follow the inline-style rule in `CAMPAIGNS.md` for
  layout-critical sizing inside the embedded iframe.
- **Campaigns** (`app.campaigns.tsx` ~L1602) — loader adds a domain summary.
  Not verified → the domain callout replaces `.nomi-campaigns-upsell` (one
  magenta notice at a time). Verified → slim "Sending from …" line and the
  original notice returns. Boards: `Campaigns`, `Campaigns-Pending`,
  `Campaigns-Verified`, `Campaigns-Mobile`.
- **Home** (`app._index.tsx` control rail) — a "Sending domain" tile next to
  `nomi-flow-brand-link`. Board: `Home`.
- **Sender info** (`app.brand-settings.tsx`) — new From block: From name,
  From address (local part + fixed `@domain` suffix, disabled until
  verified), Reply-to. `save-sender` validates the local part. Board:
  `SenderInfo`.

## Delivery changes

1. `config.server.ts` → `getProviderConfig()` (API key only) and
   `resolveSender(shop)` → `{ from, replyTo }` from a **verified**
   `SendingDomain` + `ShopSettings`; throws `SenderNotReady` otherwise.
2. `provider.server.ts` → `sendEmail({ from, replyTo, ... })`.
3. `process-jobs.server.ts` → resolve the sender per job; on
   `SenderNotReady` mark the job `blocked_sender` without burning retries.
4. `app._index.tsx` loader → readiness = provider configured **and** domain
   verified **and** From address set. Never from `NOMI_FROM_EMAIL`.
5. `NOMI_FROM_EMAIL` stays only as a dev/test fallback outside production.
6. `sendingEnabled` can't be switched on for campaigns until
   `resolveSender` succeeds.

**Open decision for OM:** lifecycle emails (abandoned cart, review request)
currently send from the shared address. Either (A) require the merchant
domain for all sending, or (B) keep a shared Nomi address for lifecycle only
and label it plainly in the UI ("Sent from Nomi's address until your domain
is verified"). Campaigns always require (A).

## Tests to add

- Domain normalization/validation table (myshopify, www, protocol, IDN, free mail).
- `domains.server` against a mocked Resend: create, verify, status mapping, delete.
- DMARC lookup: 0 / 1 / 2 records.
- Webhook signature rejection + status update.
- `resolveSender` refuses unverified shops; `process-jobs` blocks without retry.
- Campaigns/Home loaders never report ready without a verified domain.
