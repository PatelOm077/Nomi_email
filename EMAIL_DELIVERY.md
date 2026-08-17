# Nomi email delivery

Nomi uses Shopify app-specific webhooks, a SQLite-backed job queue, and
Resend. The webhook response only authenticates and persists an event. A
scheduled worker does the slow generation and provider call later.

## Required environment

- `RESEND_API_KEY` — Resend API key.
- `NOMI_FROM_EMAIL` — a sender on a domain verified in Resend.
- `NOMI_FROM_NAME` — optional display name; defaults to `Nomi`.
- `EMAIL_JOB_SECRET` — a long random value used to protect the worker.

Do not put real values in source control. With all required values present,
a newly authenticated shop starts with sending enabled. Existing shops can
enable or pause it from the dashboard.

Sending is gated by two switches, not one — see Launch constraint below for
why. `ShopSettings.sendingEnabled` covers shipping updates, cart recovery,
and review requests. `ShopSettings.sendReceiptEmails` is a separate,
narrower opt-in (default off, dashboard label "Order & refund receipts")
that additionally gates order-confirmation and refund-confirmation sends —
both `enqueueEmailJob` and the worker check it independently.

## Deploy and run

1. Run `prisma migrate deploy` in the release step.
2. Deploy `shopify.app.toml` so Shopify registers the event subscriptions.
3. Schedule an HTTP `POST /tasks/email-jobs` at least once per minute with
   `Authorization: Bearer <EMAIL_JOB_SECRET>`.
4. Create an order, fulfillment, delivery update, refund, and consented
   abandoned checkout on a non-production store. Confirm one provider send
   per event and inspect failed jobs before enabling a live shop.

Jobs retry up to five times with exponential backoff. Shopify webhook IDs
deduplicate event deliveries; Resend idempotency keys additionally protect
the provider call. Cart jobs use the checkout token, reset to one hour after
each update, and are cancelled by a matching order.

## Launch constraint

Shopify has no app-facing API for replacing native notification templates.
Researched per event (see DECISIONS.md, 2026-08-17):

- **Order confirmation** — no global disable exists, on any plan including
  Plus. It's the customer's legal receipt. Nomi's automatic send for this
  event will always duplicate Shopify's own.
- **Refund confirmation** — no global disable. Shopify only lets a human
  suppress it one refund at a time, via a checkbox in the manual-refund
  UI — not something an app can control. Nomi's automatic send for this
  event will always duplicate Shopify's own too, unless every refund on
  the store happens to be processed with that box unchecked.
- **Shipping updates** — different: "out for delivery" and "delivered"
  have a real global toggle in Settings > Notifications, and the initial
  shipping-confirmation email can be suppressed per-fulfillment. Safe to
  test and enable once that toggle/suppression is set on the store.
- **Abandoned cart recovery, review requests** — no native Shopify
  equivalent competing with these; not a duplication risk.

Net: order-confirmation and refund-confirmation sending stays off by default
(`sendReceiptEmails`) even on a shop with sending otherwise enabled — this
is not a "test and see" item, it cannot be resolved by store configuration,
so it needs an explicit, separate merchant opt-in rather than bundling with
the other three event types.

Newsletter generation is implemented, but bulk newsletter delivery is not:
it still needs an opted-in audience source, unsubscribe handling, sender
identity, and campaign scheduling. Do not reuse transactional recipients as
a marketing list.
