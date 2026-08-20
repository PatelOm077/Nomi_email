# Nomi read-only launch audit — 2026-08-20

Scope: delivery reliability, security boundaries, launch configuration, and
static accessibility review. The audit did not modify application routes,
delivery implementation, Prisma schema/migrations, Shopify configuration,
dependencies, prompts, or UI/CSS.

## Executive result

Do not treat the current revision as production-ready yet. Two confirmed
launch blockers are present:

1. A fresh database cannot apply the checked-in migration chain.
2. The deployable Shopify configuration still contains `example.com` URLs.

The delivery design has good admission and idempotency safeguards, but a
process crash can strand a claimed job forever. The public/install surface and
several custom UI controls also need launch and accessibility follow-up.

## Launch and reliability findings

### L-01 — Blocker: fresh Prisma migration chain fails

Evidence: the migrations sort as:

1. `20240530213853_create_session_table`
2. `20260817101327_add_receipt_email_toggle`
3. `20260817120000_add_email_delivery`
4. `20260819120000_add_email_tone`

The second migration tries to redefine `ShopSettings`, but the third migration
is the one that creates it. Applying the SQL files in order to a new temporary
SQLite database failed with `no such table: ShopSettings` at
`20260817101327_add_receipt_email_toggle`.

Impact: `npm run setup` cannot provision a fresh production database, so a new
deployment can fail before the app starts.

Required follow-up: repair and verify the migration history using a new empty
database and a copy of representative existing data. This audit intentionally
did not rename or edit migrations.

### L-02 — Blocker: deployable Shopify URLs are placeholders

Evidence: `shopify.app.toml` contains:

- line 4: `application_url = "https://example.com"`
- line 52: `redirect_urls = [ "https://example.com/api/auth" ]`
- line 55: `include_config_on_deploy = true`

Shopify's app configuration documentation says production configuration must
use the hosted app URL and that TOML changes take effect in production when the
configuration is deployed.

Impact: deploying this configuration can point app loading and OAuth at
`example.com`.

Required follow-up: create or select the production app configuration, set its
stable HTTPS application and auth callback URLs, and validate the intended
configuration before release.

### L-03 — High: webhook configuration targets a release candidate

Evidence: `shopify.app.toml:37` sets webhook API version `2026-10`, while the
server uses `ApiVersion.July26`. On 2026-08-20, Shopify lists `2026-07` as the
latest stable version and `2026-10` as the next release candidate. Shopify
advises against release candidates in production because incompatible changes
can still be added. See [Shopify API versioning](https://shopify.dev/docs/api/usage/versioning).

Impact: production webhook payload shape can change before the October stable
release and differs from the version used by Admin GraphQL calls.

Required follow-up: use a stable webhook version for launch or explicitly test
and accept the release-candidate risk.

### L-04 — High: a crash can strand jobs in `processing`

Evidence: `process-jobs.server.ts:367-377` finds pending jobs and atomically
changes a claimed row to `processing`. Production code never queries stale
`processing` rows or records a claim lease. Only success, skip, or the catch
path moves a claimed job onward.

Impact: process termination, host restart, or an unbounded external call after
claiming can leave a job permanently invisible to future worker runs.

Required follow-up: add a claim timestamp/lease or a bounded stale-processing
recovery rule, then integration-test crash recovery. Keep provider
idempotency keys stable when recovering.

### L-05 — Medium: external calls have no explicit worker-level deadline

Evidence: GraphQL preparation, Claude generation, and the Resend `fetch` run
after a job is claimed. The provider request in `provider.server.ts` has no
abort timeout, and the worker has no per-job deadline.

Impact: a hung dependency can hold the HTTP worker open and contributes to the
stale-`processing` failure mode.

Required follow-up: define bounded timeouts appropriate to each dependency and
make timeout failures enter the existing retry path.

### L-06 — Medium: existing shop settings do not re-evaluate configuration

Evidence: `shopify.server.ts:31-33` sets `sendingEnabled` when creating
`ShopSettings`, but the upsert uses `update: {}` for an existing record.

Impact: adding delivery secrets after the first install does not automatically
activate an existing shop. This is safe by default but can surprise deployment
operators.

Required follow-up: keep the behavior and document the dashboard activation
step, or make the intended reconfiguration behavior explicit in product logic.

### L-07 — Medium: requested scopes exceed the documented current design

Evidence: `shopify.app.toml:10` includes `read_themes`, while `DECISIONS.md`
states that real theme extraction remains blocked and the app currently uses
an AI-invented brand skin. The same scope line includes customer data scopes
that need an approval review before public distribution.

Impact: unnecessary or unapproved scopes can complicate install consent and a
future public-app review.

Required follow-up: before public distribution, map every requested scope to a
shipped v1 code path and complete protected-customer-data/access approvals.
Do not remove a scope until the live Shopify queries have been checked against
that map.

### L-08 — Medium: the public install page still contains template copy

Evidence: `app/routes/_index/route.tsx:24-50` renders “A short heading about
[your app],” a placeholder tagline, and three placeholder product features.

Impact: merchants who reach the required public login/install surface see an
unfinished template rather than Nomi's identity and value proposition.

Required follow-up: replace the copy as a separately reviewed UI task while
preserving the required SingleMerchant login flow.

## Security and privacy findings

### S-01 — High advisory requiring dependency triage

`npm audit --omit=dev` reported one root high-severity advisory:
`deepmerge-ts <8.0.0` can exhaust the stack on recursive object graphs
([GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx)).
It is present through `@prisma/config`/`prisma`; npm expands this into four
affected package entries.

Impact: the vulnerable merge utility is primarily in Prisma configuration,
so exploitability from Nomi's customer-facing request path is not established,
but a high production dependency finding must be resolved or formally accepted
before launch.

Required follow-up: review the patched Prisma line and Shopify session-storage
compatibility. Do not apply npm's suggested major/downgrade fix blindly.

### S-02 — Medium: webhook payload PII has no retention policy

Evidence: `queue.server.ts:63,67,87` serializes full webhook payloads into
`EmailJob.payload`; `schema.prisma:62` stores them without expiry. No production
cleanup path deletes or redacts completed jobs.

Impact: customer emails, names, checkout tokens, order facts, and related
payload fields can remain in SQLite indefinitely.

Required follow-up: define the minimum payload fields and retention period,
then prune or redact sent/skipped/failed records without removing active
idempotency protection prematurely.

### S-03 — Medium: whitespace-only required values count as configured

Evidence: `config.server.ts:8-12` checks required variables with JavaScript
truthiness. A value containing only spaces is truthy. Only `NOMI_FROM_NAME` is
trimmed.

Impact: a malformed deployment can create `ShopSettings` with sending enabled
even though provider or worker configuration is unusable.

Required follow-up: trim and validate required values at startup, including a
basic sender-address shape check, without logging the values.

## Accessibility findings (static review only)

### A-01 — Medium: custom radio group lacks radio keyboard behavior

Evidence: `app._index.tsx:2126-2134` uses buttons with `role="radio"` and
`aria-checked`, but does not implement arrow-key navigation or roving
`tabIndex`.

Impact: keyboard and screen-reader users receive radio semantics without the
expected radio-group interaction model.

### A-02 — Medium: active/selected navigation state is visual only

Evidence:

- `app.brand-settings.tsx:91-101` marks the current settings section only with
  an active CSS class.
- `app._index.tsx:1599-1605` marks the selected email visually but the button
  has no `aria-pressed`, `aria-current`, or equivalent selected-state signal.

Impact: non-visual users cannot reliably identify the current settings section
or selected email.

### A-03 — Medium: exposed static buttons perform no action

Evidence: campaign actions at `app.campaigns.tsx:30,46,54,60,98` and several
brand/settings actions render enabled buttons without handlers.

Impact: keyboard and assistive-technology users can focus and activate controls
that provide no response. If these are intentionally unavailable, they should
be disabled or presented as non-interactive status until wired.

### A-04 — Low: campaign table lacks an explicit accessible name

Evidence: `app.campaigns.tsx:71-91` has no `<caption>` or table `aria-label`, and
column headers omit explicit `scope="col"`.

Impact: many screen readers infer the headers, but table purpose and header
relationships are less robust. The fixed-width table also has no obvious
small-screen overflow wrapper in the reviewed CSS.

### A-05 — Low: onboarding progress semantics are incomplete

Evidence: `app._index.tsx:2221` gives a plain `div` an `aria-label` for the
current setup screen, while visual completion/current state is expressed only
through classes. Automated step changes do not move focus to the new heading.

Impact: progress and focus changes can be unclear during the timed onboarding
sequence.

## Safeguards verified

- Shopify webhook authentication remains delegated to
  `authenticate.webhook`; the webhook route does not generate or send mail.
- The worker bearer secret uses equal-length checking plus `timingSafeEqual`.
- Logs include webhook ID, shop, and queue result, not the full webhook payload
  or configured secrets.
- Queue uniqueness and stable provider idempotency keys protect against normal
  webhook replay and concurrent claims.
- Sending and duplicate-risk receipt settings are rechecked after a worker
  claims a job.
- Abandoned checkout delivery requires an email, marketing consent, an open
  checkout, the delay, and a fresh abandoned-checkout lookup.
- Generated preview iframes have titles and an empty sandbox.
- UI CSS provides visible focus outlines and reduced-motion rules; decorative
  SVGs and preview-only visuals are generally hidden from assistive technology.

## Audit evidence executed

- Applied migrations in filename order to a new OS-temporary SQLite database;
  the temporary directory was removed afterward.
- Ran `npm audit --omit=dev --json`; no dependency was changed.
- Searched application code for secret handling, payload logging, job state
  transitions, cleanup, interactive controls, focus styles, labels, reduced
  motion, and iframe sandboxing.
- Checked Shopify API version and deployment configuration behavior using the
  project-mandated Shopify developer documentation tooling.
