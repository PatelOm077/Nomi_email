# Nomi email delivery launch runbook

This runbook covers the existing Nomi-owned delivery path: Shopify webhooks
enqueue durable jobs, `/tasks/email-jobs` processes them, Claude generates the
HTML, and Resend delivers it. It does not cover newsletter audience selection
or campaign delivery, which remain separate launch work in `SPEC.md`.

## Launch rule

Do not enable merchant sending until every item in the final checklist is
green. Keep **Order & refund receipts** off during normal validation: those two
Nomi messages always duplicate Shopify's native customer receipt.

## 1. Prepare persistent application storage

The current Prisma datasource is SQLite at `prisma/dev.sqlite`. It is safe only
for a single application instance and only when that file is on a persistent
volume.

1. Provision a persistent volume for the application.
2. Confirm the deployed process resolves `prisma/dev.sqlite` onto that volume.
3. Back up the database before every migration or rollback.
4. Run `npm run setup` once for a fresh deployment and on every release that
   contains a migration.
5. Restart the app and confirm both `ShopSettings` and `EmailJob` are readable.

Do not launch with ephemeral container storage. Losing `EmailJob` loses pending
delivery and idempotency history; losing `Session` disconnects the Shopify app.

## 2. Configure the runtime

Set these values in the application host. Never put their values in the
repository, scheduler URL, screenshots, or logs.

| Variable             | Required | Purpose                                              |
| -------------------- | -------- | ---------------------------------------------------- |
| `SHOPIFY_API_KEY`    | Yes      | Shopify app client ID                                |
| `SHOPIFY_API_SECRET` | Yes      | Webhook and OAuth authentication                     |
| `SHOPIFY_APP_URL`    | Yes      | Stable public HTTPS origin                           |
| `SCOPES`             | Yes      | Must match the intended scopes in `shopify.app.toml` |
| `ANTHROPIC_API_KEY`  | Yes      | Email generation                                     |
| `RESEND_API_KEY`     | Yes      | Email delivery                                       |
| `NOMI_FROM_EMAIL`    | Yes      | Verified Resend sender address                       |
| `NOMI_FROM_NAME`     | No       | Sender display name; defaults to `Nomi`              |
| `EMAIL_JOB_SECRET`   | Yes      | Authenticates scheduler calls to the worker          |
| `NODE_ENV`           | Yes      | Set to `production`                                  |

Generate `EMAIL_JOB_SECRET` as a high-entropy random value of at least 32 bytes.
Store the same value in the application host and the scheduler's encrypted
secret store. Do not reuse the Shopify or Resend secret.

After configuration, restart the application. Installation creates
`ShopSettings.sendingEnabled` from the configured-state check only for a new
shop record; an existing shop must still be checked in the Nomi dashboard.

## 3. Verify the Resend sender

1. Add the sending domain to Resend.
2. Publish every DNS record Resend requires for domain verification.
3. Wait until Resend reports the domain as verified.
4. Set `NOMI_FROM_EMAIL` to an address on that exact verified domain.
5. Send a provider-level test to a controlled inbox.
6. Confirm the message arrives, the From address is correct, and SPF/DKIM pass
   in the received message headers.

Do not use a Resend onboarding/test sender for production customer mail.

## 4. Activate and verify the existing scheduler

The repository already contains `.github/workflows/email-jobs.yml`. Do not add
a second scheduler.

Configure its GitHub environment values:

- Repository variable `NOMI_APP_URL`: the same public HTTPS origin as
  `SHOPIFY_APP_URL`, without a route suffix.
- Repository secret `EMAIL_JOB_SECRET`: the exact worker secret configured on
  the application host.

Then:

1. Run the workflow manually with **workflow_dispatch**.
2. Confirm it posts to `${NOMI_APP_URL}/tasks/email-jobs`.
3. Confirm the response is HTTP 2xx JSON with `sent`, `skipped`, `retried`, and
   `failed` counters.
4. Confirm a request with a missing or incorrect bearer secret returns 401.
5. Enable the scheduled workflow only after the manual call succeeds.

The scheduled job runs every five minutes and makes five one-minute worker
ticks. GitHub concurrency is configured not to cancel an in-progress worker.

## 5. Live-store test sequence

Use a dev store, controlled recipient inbox, low-value products, and reversible
orders. Keep **Order & refund receipts** off until the dedicated duplicate test.

### Shipping update

1. Turn on Nomi's main sending switch.
2. Create an order addressed to the controlled inbox.
3. Create a fulfillment with a real carrier, tracking number, and tracking URL.
4. Confirm one job is queued and then becomes `sent` with a provider message ID.
5. Confirm the received Nomi message contains only the real tracking facts and
   link supplied by Shopify.
6. Replay the same webhook ID and confirm a second email is not delivered.

### Review request

1. Use an order whose first product is published to the Online Store channel.
2. Update its fulfillment to `delivered`.
3. Confirm the review request links to the real storefront product URL.
4. Repeat with an unpublished product and confirm the email omits the CTA
   rather than inventing a link.

### Abandoned checkout recovery

1. Start a checkout using the controlled inbox and grant marketing consent.
2. Confirm a delayed job is created for one hour after the update.
3. Update the checkout and confirm the same job is reset instead of duplicated.
4. Leave it abandoned for the full delay and confirm the worker rechecks that
   it remains in Shopify's abandoned-checkout list before sending.
5. Run a second checkout, complete it as an order, and confirm the pending
   recovery job becomes `skipped` with `Checkout completed.`

### Order and refund receipt safeguard

Shopify's native order and refund receipts cannot be disabled globally. Perform
this test only with the controlled inbox and expect two customer messages.

1. Confirm **Order & refund receipts** is off and that Nomi skips these topics.
2. Turn it on temporarily and create one controlled order and refund.
3. Confirm Nomi sends at most one message per webhook ID while Shopify also
   sends its native receipt.
4. Turn the receipt switch off immediately after the test.

### Localization and rendering

For each tested message, confirm:

- the customer locale wins when supported and shop language is the fallback;
- shop/product names, order numbers, URLs, currency, and tracking values remain
  unchanged;
- customer-visible copy is localized;
- HTML has no Markdown fence, script, external stylesheet, or fake `href="#"`;
- desktop and mobile rendering remain readable in the controlled inbox.

## 6. Monitoring during launch

For the first launch window, record without exposing payload contents:

- worker counters from every scheduled invocation;
- count of jobs by `pending`, `processing`, `sent`, `skipped`, and `failed`;
- age of the oldest pending job;
- jobs with attempts greater than zero;
- Resend rejection and bounce events;
- unexpected duplicate customer reports.

Investigate any job left `processing`, any increase in `failed`, or a pending
age longer than the scheduler interval plus generation time.

## 7. Rollback

Use the narrowest rollback that stops customer impact.

1. Turn off **Order & refund receipts** first if duplicate receipts are the
   issue. The worker rechecks this setting immediately before generation.
2. Turn off the main Nomi sending switch to make newly claimed pending jobs
   become `skipped` at the worker settings check.
3. Disable the GitHub Actions schedule to preserve still-pending work without
   starting new worker runs.
4. If messages continue because a worker was already past its settings check,
   revoke the Resend API key as the delivery-level emergency stop.
5. Roll back the application version without deleting or recreating the
   database. Restore the database backup only when the rollback specifically
   requires it.
6. Diagnose and test with controlled data before re-enabling the scheduler or
   merchant switches.

Changing a switch is not guaranteed to stop a job already processing after its
last settings check. Use the provider-key stop for an active incident where no
further customer message is acceptable.

## Final launch checklist

- [ ] Production storage is persistent, backed up, and limited to one app
      instance while SQLite is in use.
- [ ] `npm run setup`, `npm test`, `npm run lint`, and `npm run build` pass on
      the release revision.
- [ ] Shopify production URLs and OAuth redirects point to the stable HTTPS
      origin.
- [ ] Required Shopify webhooks are deployed from `shopify.app.toml`.
- [ ] Resend domain and From address are verified; SPF/DKIM pass.
- [ ] Anthropic, Resend, Shopify, and worker secrets are set only in secret
      stores.
- [ ] Manual worker dispatch succeeds and unauthorized calls return 401.
- [ ] Scheduled workflow runs successfully without overlapping workers.
- [ ] Shipping, review, abandoned recovery, cancellation, retry, and webhook
      replay tests pass against the controlled inbox.
- [ ] Main sending is opt-in and **Order & refund receipts** remains off by
      default.
- [ ] Rollback owner, provider-key access, and database backup location are
      known before launch.
