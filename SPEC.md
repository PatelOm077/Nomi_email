# Nomi — Spec

One-line promise: "Install it, and your store's email is done."

Nomi is an AI email app embedded in Shopify admin. It reads the store's real
brand and catalogue, creates a coordinated lifecycle system, and lets the
merchant review and customize it without starting from generic templates.

## V1 lifecycle scope

Nomi owns exactly five lifecycle flows and 13 emails:

1. Welcome — 3 emails.
2. Still Interested? — 2 emails.
3. Abandoned Cart — 3 emails.
4. How Was It? — 2 emails.
5. Welcome Back — 3 emails.

Order confirmations, shipping notifications, and refund confirmations are not
Nomi flows. Shopify remains responsible for those notifications. Nomi must not
generate or send duplicates of them.

## The five launch capabilities

### 1. Magic setup

AI reads approved Shopify and storefront evidence, asks two editable intent
questions, proposes three creative directions, and creates a merchant-approved
Brand System.

Done means a merchant can complete setup without manually designing each
message, evidence is fingerprinted, and stale or mismatched output fails closed.

[status: Brand Studio setup, approval, fingerprints, checkpoints, and replay
are implemented]

### 2. Coordinated lifecycle family

Claude plans and authors all 13 emails with family-wide awareness. Every email
has its own creative brief and complete responsive HTML while sharing the
approved Brand System.

Done means all five flows and 13 slots exist, factual assets and links validate,
the family passes deterministic safety and diversity checks, and incomplete
builds never appear complete.

[status: 13-email planning, authoring, critique, targeted regeneration,
validation, persistence, and resume are implemented]

### 3. Templates and customization

The merchant can compare approved looks, select a flow and email, preview the
real contained mobile composition, and continue into customization without
losing the selected look or lifecycle context.

Done means the Templates and Flow Editor experiences use the same selected
identity and email, preserve image aspect ratios, and remain usable at desktop,
tablet, and mobile widths.

[status: Templates, Flow Editor, and template customization exist; continued
visual QA is required for merchant-facing changes]

### 4. Event-driven lifecycle delivery

Nomi-owned lifecycle messages use authenticated Shopify webhooks, a durable
idempotent queue, a separately scheduled worker, and Resend. Webhook requests
never wait on Claude or the provider.

Current event coverage:

- `checkouts/update` schedules or resets consented Abandoned Cart recovery.
- `orders/create` only cancels a matching pending cart recovery after purchase;
  it never creates a customer email.
- `fulfillments/update` creates a How Was It? review request only after delivery.

Done means retries, idempotency, merchant opt-in, abandoned-checkout rechecks,
completed-checkout cancellation, stale-brand blocking, and controlled-inbox
verification all pass.

[status: queue, worker, provider adapter, cancellation, and the two current
event-driven sends are built; production still needs verified sender/secrets,
scheduler activation, and live-store controlled-inbox verification]

The approved Brand System and closest recipe currently guide fresh runtime HTML
generation. Exact hydration of the saved Brand Studio HTML is separate work and
must not be claimed as complete.

### 5. One-prompt campaigns

The merchant describes a campaign and receives a branded, localized draft for
review.

Done means a free-text brief produces a send-ready preview without inventing
products, discounts, or destinations. Audience selection, unsubscribe handling,
scheduling, and bulk delivery are separate launch work.

[status: campaign drafting and preview are implemented; audience and delivery
remain separate work]

## Cross-cutting properties

- Supported languages: English, Spanish, German, French, Portuguese (Brazil),
  Italian, Japanese, Dutch, Simplified Chinese, and Korean.
- One flat price: the merchant's bill does not scale with contact count.
- Shopify Admin is authoritative for catalogue facts and product imagery.
- Generated email HTML remains inbox-safe, factual, and accessibility checked.
- Missing facts are omitted, never replaced with invented values.

## Explicitly out of scope for v1

- Order confirmations, shipping notifications, and refund confirmations.
- SMS.
- Popups.
- Complex segmentation.
- Settings sprawl.
- A generic template library unrelated to the merchant's brand.

## Choice principle

Never remove choice; remove effort. The merchant chooses the look and whether
to adopt a seasonal direction. Nomi performs the production work. Options are
always shown in the merchant's brand.

## Roadmap

[status: merchant-directed seasonal Remix is implemented as a goal → directions
→ approval workflow. Automatic seasonal refresh remains future work.]

Future work includes lifecycle scheduling for Welcome, Still Interested?, and
Welcome Back; runtime hydration of approved HTML; campaign audience/delivery;
seasonal auto-refresh; recommendations; attribution; and multi-platform support
for WooCommerce, Wix, and BigCommerce.
