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
Before enabling a production shop, verify whether Shopify also sends each
native order, fulfillment, or refund message. Keep Nomi paused wherever a
duplicate native message cannot be disabled. This is a platform/product
constraint, not something the webhook worker can solve.

Newsletter generation is implemented, but bulk newsletter delivery is not:
it still needs an opted-in audience source, unsubscribe handling, sender
identity, and campaign scheduling. Do not reuse transactional recipients as
a marketing list.
