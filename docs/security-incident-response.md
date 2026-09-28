# Nomi security incident response policy

Owner: Om Barvaliya (ombarvaliya7@gmail.com). Last reviewed 2026-09-28.

An incident is any confirmed or suspected unauthorized access to, loss of, or
disclosure of merchant or customer data, or of a secret that protects it
(Shopify API secret, Anthropic, OpenAI, or Resend keys, `EMAIL_JOB_SECRET`,
`NOMI_SUPPORT_ADMIN_SECRET`).

## 1. Detect (as soon as it is noticed)
Sources: Fly app logs and health checks, Shopify Dev Dashboard webhook and API
error reports, Resend bounce and complaint alerts, the `AccessLog` table
(support inbox sign-ins, failed sign-ins, conversations opened), GitHub
security alerts, and reports from merchants or Shopify.

## 2. Contain (within 1 hour of detection)
- Rotate every affected secret: `flyctl secrets set … -a nomi-email`, and
  rotate the Shopify client secret in the Dev Dashboard.
- Sign every operator out by changing `NOMI_SUPPORT_ADMIN_SECRET`.
- If the server itself is suspect, stop sending: pause the email-jobs GitHub
  Action, and stop the Fly machine if needed.
- Keep evidence: take a Fly volume snapshot and save the logs before changing
  data.

## 3. Assess (within 24 hours)
Work out which shops and customers are affected, which data (names, emails,
cart or order contents, support messages), the time window, and the cause.

## 4. Notify (within 72 hours of confirmation)
- Affected merchants, by email: what happened, which data, and what they
  should do. Merchants are the data controllers and notify their customers
  and regulators as their law requires; Nomi supports them with the facts.
- Shopify, through the Partner support channel, when Shopify data or
  credentials are involved.

## 5. Recover and review (within 2 weeks)
Restore from the daily SQLite backup or a Fly snapshot if data was lost or
changed. Fix the cause, add a test or check that would have caught it, and
record a short write-up (timeline, impact, fix) in this folder.
