# Nomi lifecycle delivery

Nomi uses Shopify app-specific webhooks, a SQLite-backed job queue, and Resend.
The webhook response only authenticates and persists an event. A scheduled
worker performs generation and provider delivery later.

Nomi sends lifecycle email only. Shopify remains responsible for order
confirmations, shipping notifications, and refund confirmations.

## Required environment

- `RESEND_API_KEY` — Resend API key.
- `NOMI_FROM_EMAIL` — sender on a Resend-verified domain.
- `NOMI_FROM_NAME` — optional display name; defaults to `Nomi`.
- `EMAIL_JOB_SECRET` — long random value protecting the worker endpoint.
- `UNSUBSCRIBE_SECRET` — optional; signs unsubscribe links. Falls back to
  `SHOPIFY_API_SECRET`. Changing it invalidates links in emails already sent.
- `SHOPIFY_APP_URL` — public app URL; unsubscribe links point at
  `<SHOPIFY_APP_URL>/unsubscribe`.

## Footer, unsubscribe, suppression

Every email the worker sends gets, by code and never by the model
(`app/email-engine/compliance-footer.ts`):
- the business postal address — Sender info if complete, else the Shopify
  store address (`app/dashboard/sender-footer.server.ts`). With no complete
  address the job is skipped with "Add a complete business address…";
- a per-recipient signed Unsubscribe link plus RFC 8058 `List-Unsubscribe` /
  `List-Unsubscribe-Post` headers (Gmail/Yahoo one-click).

`/unsubscribe` (public, `app/routes/unsubscribe.tsx`) asks on GET — link
scanners must not unsubscribe anyone — and acts on the form POST or the
one-click POST. It writes an `EmailSuppression` row and sets the customer's
Shopify email-marketing consent to `UNSUBSCRIBED`. The worker checks
`EmailSuppression` before generating, so a suppressed address never costs a
Claude call.

Do not put real values in source control. `ShopSettings.sendingEnabled` is the
single merchant control for lifecycle delivery. The queue checks it before
creating sendable work and the worker checks it again before generation.

## Supported event behavior

- `checkouts/update` creates or resets a consented Abandoned Cart recovery job
  for one hour after the most recent update.
- `orders/create` only cancels a matching pending recovery after checkout. It
  is processed even when lifecycle sending is off and never creates an email.
- `fulfillments/update` can create a How Was It? review request only when the
  shipment status is `delivered`.

All other webhook topics are ignored. Old queued jobs for removed email types
are marked skipped by the worker before any Shopify data fetch or provider call.

## Deploy and run

1. Run `prisma migrate deploy` in the release step.
2. Deploy `shopify.app.toml` so Shopify registers the subscriptions.
3. Schedule `POST /tasks/email-jobs` with
   `Authorization: Bearer <EMAIL_JOB_SECRET>`.
4. In a development store, test a consented abandoned checkout, its completed
   order cancellation, and a delivered fulfillment using controlled inboxes.
5. Confirm exactly one provider send per eligible lifecycle event and inspect
   failed jobs before enabling a live shop.

Jobs retry up to five times with exponential backoff. Shopify webhook IDs
deduplicate event deliveries; Resend idempotency keys protect provider calls.
Cart jobs use the checkout token, reset to one hour after each update, and are
cancelled by a matching order.

Campaign generation is implemented, but bulk campaign delivery still needs an
opted-in audience, unsubscribe handling, verified sender identity, and
scheduling. Never reuse lifecycle recipients as a marketing list.
