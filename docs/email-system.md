# Email generation and delivery system

Read this with `NOMI_CONTEXT.md`, `CLAUDE.md`, `SPEC.md`, and the delivery
runbook before changing prompts, lifecycle generation, Shopify webhooks, the
worker, provider delivery, or merchant sending controls.

## Product scope

Nomi owns five lifecycle flows and 13 coordinated emails:

- Welcome: 3 emails
- Still Interested?: 2 emails
- Abandoned Cart: 3 emails
- How Was It?: 2 emails
- Welcome Back: 3 emails

Nomi does not create or send order confirmations, shipping notifications, or
refund confirmations. Shopify remains responsible for those notifications.

## Brand Studio preview path

Brand Studio saves confirmed Shopify storefront evidence, a merchant-approved
Brand System, 13 open art-direction briefs, and Claude's 13 finished responsive
HTML documents. There is no fixed layout menu or local creative compiler in
this path. A family-wide Claude review sees every completed document, requests
targeted structural revisions when emails repeat, and then Nomi runs the
deterministic A1 safety proof. A build is not complete unless the full family
passes. Details live in `docs/onboarding-system.md`.

`app/brand-studio/email-quality.ts` blocks unsafe elements, external CSS,
non-public links, missing image accessibility data, oversized Gmail payloads,
and malformed heading structure. Its A1 checks also require useful, distinct
copy; the approved palette and voice rules; exact approved product imagery and
destinations; all 13 lifecycle slots; unique creative briefs; and structural
variety in the finished HTML.

The dashboard, Templates page, and Flow Editor are preview/approval surfaces.
Opening or changing a preview never creates a delivery job.

The dashboard and Flow Editor render lifecycle HTML only from the current,
fingerprint-matched `BrandStudioProfile.renderedEmails`. They do not generate,
rewrite, compile, or synthesize lifecycle previews. When a current 13-email
family is unavailable, they link back to Brand Studio for a complete rebuild.
Campaign preview generation and event-driven live delivery remain separate
systems with separate contracts.

`app/brand-studio/approved-family.ts` is the shared acceptance boundary for
Brand Studio consumers. It requires complete status, matching evidence
fingerprints, a valid Brand System, exactly 13 recipes, and all 13 rendered HTML
documents. Partial flow checkpoints are never exposed as an approved family.

## Live lifecycle delivery

The current production worker sends two event-driven parts of the lifecycle
family:

- Abandoned Cart: a consented checkout recovery after the one-hour delay.
- How Was It?: a review request after Shopify reports delivery.

Before generation, the worker loads the current approved Brand Studio identity
through `app/email-delivery/approved-brand.server.ts`. Claude receives the
approved Brand System, logo, and the closest lifecycle recipe as art direction.
Current Shopify cart, order, product, and customer facts remain authoritative.

The approved preview HTML and live-send HTML are not yet the same artifact.
Live delivery generates a fresh, inbox-safe message from the approved identity
and current Shopify facts. Do not describe live delivery as exact hydration of
the saved Brand Studio HTML until a runtime-template layer is implemented.

Evidence and generated output carry matching fingerprints. A saved profile
that predates fingerprinting, is incomplete, or was built from different
evidence fails closed before Shopify customer data is fetched or Resend is
called. A shop with no Brand Studio profile keeps the restrained legacy brand
fallback for backwards compatibility.

## Engine contract

`app/email-engine/` has no Shopify imports. It receives platform-neutral
lifecycle inputs and returns HTML. Shopify GraphQL fields are mapped in routes
or the delivery adapter.

Runtime emails use two cacheable system blocks:

1. `design-system-prompt.ts`: the shared output contract, inbox-safe rules,
   typography, and merchant-brand guidance.
2. A supported lifecycle skeleton such as `abandoned-cart-prompt.ts` or
   `review-request-prompt.ts`.

`generate-email.ts` submits both blocks with Anthropic prompt caching, rejects
refusal or truncation, and strips an accidental Markdown fence. Keep the shared
prompt large enough to remain cache eligible.

Always preserve these rules:

- table layout and inline styles only; no scripts or external stylesheets;
- Source Serif 4, then Georgia, then serif for runtime email content;
- missing values are explicit absence, never fabricated customer data;
- never invent discounts, product URLs, review URLs, or merchant promises;
- omit a conditional CTA when no genuine destination exists;
- customer locale wins when supported, then shop language is the fallback;
- no Shopify dependency inside `app/email-engine/`.

## Event delivery architecture

```text
Shopify webhook
  -> authenticated ingress: routes/webhooks.email-events.tsx
  -> durable, idempotent EmailJob: email-delivery/queue.server.ts
  -> scheduled POST /tasks/email-jobs
  -> worker claims one job: email-delivery/process-jobs.server.ts
  -> current Shopify data is fetched and mapped
  -> Claude generates HTML
  -> Resend sends with an idempotency key
  -> job becomes sent, skipped, retryable, or failed
```

Webhooks return after enqueueing. They never wait on Claude or Resend. The
worker claims jobs atomically, processes a bounded batch, retries at most five
times with exponential backoff, and records the provider message ID.

Event coverage:

- `CHECKOUTS_UPDATE`: creates or resets one consented abandoned-cart job for
  one hour after the latest checkout update.
- `ORDERS_CREATE`: cancellation signal only. It marks a matching pending cart
  job skipped and never creates a customer email.
- `FULFILLMENTS_UPDATE`: creates a How Was It? review request only when
  `shipment_status` is `delivered`.

All other topics are ignored by the queue, and legacy queued jobs for removed
email types are marked skipped by the worker.

## Sending gates and launch safety

`ShopSettings.sendingEnabled` is the only lifecycle-delivery switch. It is
checked at enqueue time and again immediately before generation. The order
cancellation signal is processed even when sending is disabled so an old cart
job cannot be revived after checkout completes.

The worker endpoint is `POST /tasks/email-jobs`, protected by
`Authorization: Bearer <EMAIL_JOB_SECRET>`. Production needs a verified Resend
sender, persistent database storage, and the existing scheduled GitHub Actions
worker. Release and rollback procedures live in
`docs/email-delivery-launch-runbook.md`.

Campaign generation exists, but bulk campaign delivery is separate launch
work. Never reuse lifecycle recipients as a marketing audience without the
required consent, unsubscribe, sender-identity, and scheduling controls.

## Change checklist

- Keep Shopify mapping at the platform boundary and test null/missing facts.
- Preserve queue idempotency and worker re-checks.
- Verify real URLs, localized copy, safe HTML, and responsive inbox rendering.
- Run queue/worker tests and the production build after delivery changes.
- Use only controlled inboxes for live delivery verification.
