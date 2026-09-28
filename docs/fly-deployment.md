# Nomi on Fly.io

Initial target: one always-on shared CPU Machine with 1GB RAM in Amsterdam,
port 3000, and a 1GB `nomi_data` volume mounted at `/data`.
SQLite is stored at `file:/data/nomi.sqlite`. Keep exactly one app Machine;
independent SQLite volumes do not share sessions or queued jobs.

## First deployment

1. Install the official Fly CLI and run `fly auth login`.
2. Run `fly apps list`. Use the existing app if the dashboard already created it.
   Otherwise create it with `fly apps create <app-name> --org <org-slug>`.
3. Validate with `fly config validate --app <app-name>`.
4. Create storage with `fly volumes create nomi_data --region ams --size 1 --app <app-name>`.
5. Configure secrets through Fly's Secrets UI or `fly secrets import --app <app-name>`
   using a secure input stream. Never put secret values in Git or command arguments.
   Required for app boot: `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`,
   and `SCOPES`. Set the URL to `https://<app-name>.fly.dev` and keep scopes aligned
   with `shopify.app.toml`. Generation additionally needs `ANTHROPIC_API_KEY`;
   `OPENAI_API_KEY` is optional. Delivery needs `RESEND_API_KEY`, `NOMI_FROM_EMAIL`,
   and `EMAIL_JOB_SECRET`; `NOMI_FROM_NAME` is optional.
6. Run `npm.cmd run build`, then
   `fly deploy --app <app-name> --ha=false --strategy immediate`.
   Migrations run at Machine startup, where the volume is mounted. Do not move
   SQLite migrations into a Fly release command, which has no attached volume.
7. Confirm `fly status --app <app-name>`, health checks, and the public URL.
   `/health` must return HTTP 200 and `{"status":"ok"}`. It checks SQLite
   connectivity without redirecting to Shopify authentication.
8. Update the production Shopify configuration's application URL and OAuth
   redirect URLs to the hosted URL (auth endpoints are under `/auth`), then
   deploy the Shopify configuration/extensions. Shopify CLI deployment alone
   does not host the web server. Verify installation in Shopify admin.
9. Separately configure a scheduler to POST `/tasks/email-jobs` with
   `Authorization: Bearer <EMAIL_JOB_SECRET>`. Follow the email delivery launch
   runbook before activating customer sends. Hosting does not activate this schedule.

## Data and updates

A new volume starts with an empty database. Local Brand Studio results and
sessions are not copied automatically. If existing data must be preserved,
plan a consistent SQLite backup and controlled restore before switching traffic.

Future updates: build, then run the same Fly deploy command. The volume persists
across releases. Single-Machine deployments can briefly interrupt service.
Verify backups and restoration before relying on this for production data.

The configuration uses `nomi-email`, selected in the dashboard form. Its global
availability must be confirmed before creation; CLI flags can override it.
No paid resource has been provisioned by creating this configuration file.

## Verification recorded on 2026-09-26

- `npm.cmd run typecheck`: passed.
- `npm.cmd run build`: passed.
- All Prisma migrations applied successfully to a separate empty SQLite database.
- Built `/health` loader returned HTTP 200 with a usable database and HTTP 503
  with an inaccessible database. Neither response exposes error details.
- `git diff --check`: passed.
- Fly CLI was subsequently installed and authenticated. The Docker image was
  built remotely and deployed successfully to Machine `8e6e75b766d4e8` in AMS.
  All 23 migrations applied to the production volume and Fly's health check passed.
- Public `https://nomi-email.fly.dev/health` returned HTTP 200, `{"status":"ok"}`.
- Shopify version `nomi-2` was released using `shopify.app.fly.toml`, with the
  Fly app URL and `/auth/callback` redirect. CLI 4.8.2 uses `--allow-updates`
  instead of the older `--force` flag.
- Chrome inspection found an active store development preview still routing
  to `dev.trynomi.email`. With merchant authorization the preview was cleared.
  After reload, Chrome confirmed the iframe origin is `https://nomi-email.fly.dev`
  and the Brand Studio onboarding screen rendered successfully in Shopify admin.
- Follow-up transfer copied the completed 13-email family, 10 campaigns,
  template choice/customization, settings, and sending-domain record. Existing
  Fly sessions were preserved; local sessions and historical jobs were excluded.
  The original production DB was backed up before importing. SQLite integrity
  passed and the saved HTML matched the local export exactly.
- `hello@trynomi.email` is verified in Resend. Fly delivery secrets and the
  existing GitHub Actions scheduler credentials were configured securely.
  A controlled test to the merchant's Gmail address was confirmed delivered
  by Resend. Unauthorized worker requests returned 401; authorized requests 200.
- Worker requests create a daily consistent SQLite backup (seven retained),
  alongside Fly volume snapshots. Interrupted processing has a 15-minute lease
  recovery with heartbeat, frozen provider requests, bounded retries, and manual
  review beyond the provider's 24-hour idempotency window (23-hour safety cutoff).
  Purchase cancellation now includes processing jobs; errors cannot revive them.
- All 249 tests passed, as did typecheck and build. Changed server files passed
  scoped ESLint. Repository-wide lint still reports 42 existing errors and three
  warnings in unrelated website-evidence/UI/domain code; no UI edits were made.
- This is one-server recovery, not automatic failover or a guarantee against
  crashes. Welcome, Still Interested, Welcome Back scheduling and campaign bulk
  delivery remain future work. Saved 13-email designs do not imply 13 sends.
- Final Machine image: `deployment-01M3EXJ59YWXMFBXBZW7THCHAC`, version 3,
  started with the health check passing. Data survived this redeployment.
- Sending was explicitly enabled for the development shop after verification.
  A signed checkout webhook queued a controlled test job; a signed purchase
  event canceled it. No real customer order was fabricated or emailed.
- The existing public-repository GitHub worker was enabled. Manual dispatch
  [36244627127](https://github.com/PatelOm077/Nomi_email/actions/runs/36244627127)
  completed successfully. Its five-minute schedule includes one-minute ticks;
  GitHub schedules may be delayed, so this is not a precise delivery-time SLA.
- Fly snapshot `vs_Xv2qBDakkq76f6NG1vpOR` was created (five-day retention).
  A consistent daily backup was downloaded to the ignored local file
  `.codex-runtime-production-backup.sqlite`; opening that copy passed integrity
  and confirmed the complete profile and 10 campaign drafts.
- Deployment used local source directly. These deployment/recovery edits are
  still uncommitted; do not deploy the older GitHub checkout over this version.
