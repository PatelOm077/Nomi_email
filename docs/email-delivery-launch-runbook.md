# Nomi lifecycle delivery launch runbook

This runbook covers Nomi-owned lifecycle delivery: Shopify webhooks enqueue
durable jobs, `/tasks/email-jobs` processes them, Claude generates inbox-safe
HTML, and Resend delivers it. Nomi does not send order confirmations, shipping
notifications, or refund confirmations.

## Launch rule

Do not enable merchant sending until every item in the final checklist is
green. Test only with a development store and controlled recipient inboxes.

## 1. Prepare persistent application storage

The local Prisma default is SQLite at `prisma/dev.sqlite`. Production is safe
only with one application instance and a database file on persistent storage.

### Chosen host: Fly.io

`fly.toml` defines one shared-CPU Machine and an encrypted persistent volume
mounted at `/data`, with `DATABASE_URL=file:/data/nomi.sqlite`. Supply credentials
through Fly secrets and keep one instance while SQLite is in use. Fly's restart
policy is `always`; autostop is disabled. See `docs/fly-deployment.md`.

1. Provision the persistent volume.
2. Confirm the production database resolves onto that volume.
3. Back up the database before migrations or rollback.
4. Run `npm run setup` for a fresh deployment and every migration release.
5. Restart and confirm `ShopSettings` and `EmailJob` remain readable.

Do not launch with ephemeral storage. Losing `EmailJob` loses pending delivery
and idempotency history; losing `Session` disconnects the Shopify app.

## 2. Configure the runtime

Set these values in the application host. Never place their values in the
repository, scheduler URL, screenshots, or logs.

| Variable | Required | Purpose |
| --- | --- | --- |
| `SHOPIFY_API_KEY` | Yes | Shopify app client ID |
| `SHOPIFY_API_SECRET` | Yes | Webhook and OAuth authentication |
| `SHOPIFY_APP_URL` | Yes | Stable public HTTPS origin |
| `SCOPES` | Yes | Must match `shopify.app.toml` |
| `ANTHROPIC_API_KEY` | Yes | Runtime email generation |
| `RESEND_API_KEY` | Yes | Email delivery |
| `NOMI_FROM_EMAIL` | Yes | Verified Resend sender address |
| `NOMI_FROM_NAME` | No | Sender name; defaults to `Nomi` |
| `EMAIL_JOB_SECRET` | Yes | Authenticates worker calls |
| `NODE_ENV` | Yes | Set to `production` |

Generate `EMAIL_JOB_SECRET` as at least 32 random bytes. Store the same value
in the application host and scheduler's encrypted secret store.

## 3. Verify the Resend sender

1. Add the sending domain to Resend.
2. Publish all required DNS records.
3. Wait for domain verification.
4. Set `NOMI_FROM_EMAIL` to an address on that domain.
5. Send a provider-level message to a controlled inbox.
6. Confirm the From address and SPF/DKIM results in the received headers.

Do not use a Resend onboarding/test sender for production customer mail.

## 4. Activate the existing scheduler

The repository already contains `.github/workflows/email-jobs.yml`. Do not add
a second scheduler.

Configure:

- Repository variable `NOMI_APP_URL`: the stable HTTPS app origin.
- Repository secret `EMAIL_JOB_SECRET`: the worker secret.

Then:

1. Run the workflow manually with `workflow_dispatch`.
2. Confirm it posts to `${NOMI_APP_URL}/tasks/email-jobs`.
3. Confirm a 2xx JSON response with `sent`, `skipped`, `retried`, and `failed`.
4. Confirm a missing or incorrect bearer secret returns 401.
5. Enable the schedule only after the manual call succeeds.

## 5. Live-store test sequence

Use a development store, controlled inbox, low-value products, and reversible
test activity.

### How Was It?

1. Enable Nomi lifecycle sending.
2. Create an order addressed to the controlled inbox.
3. Use a product published to the Online Store channel.
4. Update its fulfillment to `delivered`.
5. Confirm one review job is queued and sent with a provider message ID.
6. Confirm the CTA uses the real storefront product URL.
7. Repeat with an unpublished product and confirm the CTA is omitted.
8. Replay the same webhook ID and confirm a second email is not delivered.

`fulfillments/update` is used only as the delivered signal. Nomi must not send
a shipping notification for in-transit, out-for-delivery, or other statuses.

### Abandoned Cart

1. Start a checkout with the controlled inbox and marketing consent.
2. Confirm a delayed job is scheduled one hour after the update.
3. Update the checkout and confirm the same job resets instead of duplicating.
4. Leave it abandoned for the delay and confirm the worker rechecks Shopify
   before sending.
5. Start another checkout, complete it as an order, and confirm the pending
   recovery becomes `skipped` with `Checkout completed.`
6. Confirm the order event itself creates no customer email.

### Removed email-type safeguard

1. Trigger order creation, fulfillment creation, and refund events in the test
   store.
2. Confirm Nomi creates no order, shipping, or refund email job.
3. If a pre-migration legacy job exists for a removed type, confirm the worker
   marks it skipped with `Email type is no longer supported.`

### Localization and rendering

For each Nomi lifecycle message, confirm:

- supported customer locale wins and shop language is the fallback;
- names, URLs, products, order numbers, and currency remain factual;
- HTML has no Markdown fence, script, external stylesheet, or fake link;
- desktop and mobile inbox rendering remain readable.

## 6. Monitoring

Record without exposing payload contents:

- worker counters from every scheduled invocation;
- jobs by `pending`, `processing`, `sent`, `skipped`, and `failed`;
- age of the oldest pending job;
- jobs with attempts greater than zero;
- Resend rejection and bounce events;
- unexpected duplicate customer reports.

Investigate any job stuck in `processing`, increase in `failed`, or pending age
longer than the scheduler interval plus generation time.

## 7. Rollback

1. Turn off lifecycle sending so newly claimed work is skipped.
2. Disable the GitHub Actions schedule to preserve still-pending work.
3. If a worker has already passed its settings check, revoke the Resend API key
   as the delivery-level emergency stop.
4. Roll back the application without deleting or recreating the database.
5. Restore a database backup only when the rollback specifically requires it.
6. Diagnose with controlled data before re-enabling delivery.

## Final launch checklist

- [ ] Persistent production storage is backed up and limited to one instance.
- [ ] `npm run setup`, `npm test`, `npm run lint`, and `npm run build` pass.
- [ ] Shopify URLs and OAuth redirects use the stable HTTPS origin.
- [ ] Webhook subscriptions are deployed from `shopify.app.toml`.
- [ ] Resend sender verification and SPF/DKIM pass.
- [ ] Anthropic, Resend, Shopify, and worker secrets exist only in secret stores.
- [ ] Manual worker dispatch succeeds and unauthorized requests return 401.
- [ ] Scheduled work runs without overlapping workers.
- [ ] How Was It?, abandoned recovery, cancellation, retry, and replay pass.
- [ ] Order, shipping, and refund events produce no Nomi email.
- [ ] Lifecycle sending remains merchant opt-in.
- [ ] Rollback owner, provider access, and backup location are known.
