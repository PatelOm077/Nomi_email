# Nomi context map

Use this as the fast starting point for any Nomi task. It exists so that a
new agent does not have to reconstruct product decisions from routes, prompts,
or old task history.

## Read in this order

1. `CLAUDE.md` — repository boundaries, stack, conventions, and do-not-touch
   rules.
2. `SPEC.md` — v1 promise, scope, and feature status.
3. `DECISIONS.md` — dated decisions. Newer entries win over older ones.
4. One focused document below, depending on the task:
   - Onboarding, Brand Studio, generated lifecycle previews, or the Templates
     handoff: [`docs/onboarding-system.md`](docs/onboarding-system.md)
   - Transactional generation, campaign generation, webhooks, queue, Resend,
     or launch: [`docs/email-system.md`](docs/email-system.md)

`BRAND_STUDIO.md`, `EMAIL_DELIVERY.md`, and the delivery launch runbook contain
the detailed briefs. The two focused documents above state the *current*
implementation and identify any important boundary between current code and the
longer-term product vision.

## Product in one sentence

Nomi is an embedded Shopify app that creates a merchant-specific email system,
then generates and eventually delivers lifecycle, transactional, and campaign
emails without making the merchant start from generic templates.

## Non-negotiable operating rules

- Do not invent merchant facts, URLs, discounts, tracking details, customer
  attributes, product claims, or placeholders disguised as real data.
- Keep `app/email-engine/` platform-neutral: Shopify mapping belongs in routes
  or delivery adapters, never in the engine.
- AI returns structured decisions wherever possible; Nomi code owns safe,
  deterministic email HTML. Do not replace this with arbitrary model-generated
  HTML for the Brand Studio path.
- No webhook may wait for AI generation or delivery. It only authenticates and
  enqueues durable work.
- Nothing sends, changes an audience, timing, offer, or lifecycle automatically
  without a clear merchant approval. Order/refund receipts have an additional,
  separate opt-in because they duplicate Shopify's native receipts.
- Preserve merchant-owned working-tree changes and never expose or edit `.env`.

## Current terminology

- **Brand Studio**: the onboarding system that reads storefront/Shopify evidence,
  creates a saved Brand System and 13 lifecycle recipes, and hands the merchant
  to Templates.
- **Transactional engine**: the existing Claude prompt/skeleton generator used
  by the durable webhook worker for order, shipping, refund, cart, and review
  mail.
- **Templates / Flow Editor**: the merchant UI for reviewing/selecting/editing
  lifecycle content. Its previews are not evidence that automated delivery is
  enabled.

When docs and source appear to disagree, prefer the newest dated decision and
the current route implementation; record the resolution in `DECISIONS.md` when
the change is a durable product decision.
