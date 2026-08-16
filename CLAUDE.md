@AGENTS.md
# Nomi

AI email app embedded in Shopify admin.
One-line promise: "Install it, and your store's email is done."

## What Nomi does
Merchant installs → AI reads their store (logo, colors, products, brand voice)
→ every notification and marketing email is branded, written, and live in about
a minute. The templates are AI-generated per merchant, not picked from a library.

## The five features (v1 only — nothing else)
1. Magic setup — AI brands and writes every email from the storefront
2. Order emails — order confirmation, shipping, refunds (sent natively by Shopify)
3. Abandoned cart recovery — works out of the box
4. One-prompt newsletters — describe a campaign, get a send-ready email
5. Review requests — post-delivery follow-up

Explicitly NOT in v1: SMS, popups, complex segmentation, settings sprawl.
When tempted to add a feature, the answer is "not yet."

## Brand
- Ink #201e1d · Paper #f3f2f2
- Cyan #0088b0 — interaction only (links, buttons)
- Magenta #d6006c — one spot accent at a time, never a second UI color
- Type: Source Serif 4 for headings and the Nomi wordmark;
  clean system sans-serif for UI chrome (labels, tables, buttons)
- In merchant emails, use fallback stack: Source Serif 4 → Georgia → serif

## Voice
Plain sentences. No exclamation marks. Say what the app does, not what it
unlocks. Name the action: send, schedule, preview. State numbers plainly,
no adjectives around them.

## Architecture principles
- Keep the email-generation engine platform-independent. Shopify is one
  adapter; WooCommerce/Wix/BigCommerce come later. Don't bake Shopify
  specifics into the core generator.
- Emails render from a small set of bulletproof, email-safe HTML skeletons
  (table-based, inline styles). AI generates the skin (colors, copy, layout
  choices) poured into a skeleton — never freeform HTML per send.
- Generation model: Claude Sonnet. Cache the static design-system prompt.

## Design specs
See the /design folder — exported mockups from Claude Design.
The dashboard mockup is the layout law. The Moon & Mango order confirmation
is the hero email archetype (editorial style, skeleton #1).

## Context
Solo developer, new to Shopify apps. Explain steps while building.
Stack: React Router (Remix) template, TypeScript, Shopify CLI.