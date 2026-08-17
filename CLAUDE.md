@AGENTS.md

# Nomi

AI email app embedded in Shopify admin. "Install it, and your store's email is done."
See SPEC.md for features and DECISIONS.md for why choices were made.

## Stack
React Router v7 + TypeScript, scaffolded from Shopify's CLI app template.
Shopify Admin GraphQL via `@shopify/shopify-app-react-router`, sessions in
Prisma/SQLite (dev). Email generation via `@anthropic-ai/sdk`, model
`claude-sonnet-5`.

## Folder layout
- `app/routes/app._index.tsx` — the dashboard. `loader` fetches shop,
  products, and the most recent order; `action` maps that order into the
  engine's shape and calls it.
- `app/routes/app.tsx` — embedded app shell (nav, auth).
- `app/routes/_index/`, `app/routes/auth.login/` — the public install/login
  flow, required by SingleMerchant distribution. Not the embedded admin
  path, but don't delete them (see Don't touch).
- `app/email-engine/` — the generation engine. **No Shopify imports allowed
  in this folder** — that boundary is the whole point of it being
  platform-independent (Shopify today, WooCommerce/Wix/BigCommerce later).
  - `types.ts` — neutral order/cart/line-item shapes
  - `design-system-prompt.ts` — `SHARED_DESIGN_SYSTEM_PROMPT`: the rules
    every skeleton shares (output contract, table-based HTML, typography,
    brand-skin invention, voice). Sent as its own cache_control block, so
    it's written to cache once and read by every email type, not just
    repeats of the same one.
  - `order-confirmation-prompt.ts`, `abandoned-cart-prompt.ts`,
    `shipping-update-prompt.ts`, `review-request-prompt.ts` — the
    structural skeleton specific to each email type, each its own
    cache_control block appended after the shared one. Adding a new email
    type means adding one of these, not touching the shared prompt.
  - `anthropic-client.ts` — the lazy Anthropic client singleton
  - `generate-email.ts` — shared call-Claude-and-return-HTML logic (system
    blocks, stop_reason handling, code-fence stripping) used by every
    `generate-*-email.ts` file
  - `generate-order-confirmation-email.ts`, `generate-abandoned-cart-email.ts`,
    `generate-shipping-update-email.ts`, `generate-review-request-email.ts`,
    `generate-refund-confirmation-email.ts`, `generate-newsletter-email.ts`
    — one per email type; each just builds its user message and calls
    `generateEmailHtml()` with its own skeleton prompt
- `app/email-delivery/` — Resend provider adapter, durable webhook queue,
  and worker. Webhook routes only enqueue; never call Claude or Resend in a
  Shopify webhook request.
- `app/routes/webhooks.email-events.tsx` — authenticated Shopify event
  ingress for transactional and delayed cart-recovery jobs.
- `app/routes/tasks.email-jobs.tsx` — secret-protected worker endpoint;
  production must POST to it on a schedule.
- `app/styles/nomi.css` — Nomi's own dashboard UI brand. Not the merchant
  email's brand — the AI invents that per shop, see below.
- `app/shopify.server.ts` — Shopify app config (scopes, distribution,
  session storage).
- `shopify.app.toml` — scopes, webhooks, distribution-adjacent config.
- `prisma/schema.prisma` — session table.
- Design mockups live in `Shopify email marketing app (1)/` — not
  `/design`, which doesn't exist despite older notes referencing it.

## Conventions
- Shopify-shape mapping (GraphQL field renaming, response shaping) belongs
  in the route file, never inside `app/email-engine/`.
- Generated email HTML is always table-based with inline styles only, font
  stack `Source Serif 4 → Georgia → serif`. Never freeform HTML — follow
  the shared contract in `design-system-prompt.ts` plus the relevant
  `*-prompt.ts` skeleton.
- `SHARED_DESIGN_SYSTEM_PROMPT` is marked `cache_control` on purpose — keep
  it long enough to clear Sonnet 5's ~1024-token cache-eligible minimum on
  its own. Shrinking it carelessly silently kills caching, not an error.
- Adding a new email type (newsletter is the only one left): add a
  `<type>-prompt.ts` skeleton, a `generate-<type>-email.ts` that calls
  `generateEmailHtml()` from `generate-email.ts`, and a fetcher + card
  dispatcher in the route — follow `abandoned-cart-*`, `shipping-update-*`,
  or `review-request-*` as the template, not `order-confirmation-*` (that
  one predates the shared-prompt split). Newsletter is the odd one out:
  its input is a free-text prompt, not a Shopify record, so it won't reuse
  the `toEngine*` mapping pattern the other four share.
- A card's data doesn't have to come from its own GraphQL query — the
  review-request card reuses the same `shippedOrders` fetch as shipping
  update (a review request is just that same order once its fulfillment
  reads `delivered`), rather than firing a second near-identical query.
  Check whether an existing fetch already answers the new card's question
  before adding one.
- A missing field (customer name, etc.) is `null`, never a placeholder
  string like "there" — every prompt has real fallback copy for the
  no-name case. Don't hand the model a fake value and let it treat it as
  real data.
- Don't let a skeleton invent things the merchant hasn't actually offered
  — a hallucinated discount code, tracking number, tracking URL, or review
  URL is a broken promise, not a stylistic slip. Each skeleton's prompt
  says so explicitly, and the shipping-update and review-request prompts
  both conditionally omit their CTA button when no real URL was given,
  rather than faking one with `href="#"`. `Product.onlineStoreUrl` is
  `null` whenever a product isn't published to the Online Store channel —
  expect that to be common on a fresh dev store, not a bug.
- When checking a new GraphQL field's required scope, don't take a
  Shopify docs sentence like "Requires scope A, scope B ... or scope F" at
  face value as "needs all of these" — it's usually a role-specific
  alternative list (fulfillment-service app vs. order-management app vs.
  marketplace app), and only one applies to a plain merchant-facing app
  like this one. Test against the live store with current scopes before
  adding anything new.

## Brand (dashboard UI only — see DECISIONS.md for why)
Ink `#201e1d` · Paper `#f3f2f2` · Cyan `#0088b0` (interaction only) ·
Magenta `#d6006c` (one spot accent, never a second UI color). Source
Serif 4 for headings/wordmark, system sans for UI chrome. Voice: plain
sentences, no exclamation marks, name the action, state numbers plainly.
This governs Nomi's own UI only — merchant emails get an AI-invented
brand skin per shop, never these colors.

## Don't touch
- `.env` — holds `ANTHROPIC_API_KEY` and Shopify secrets. Gitignored;
  never commit it or print its contents back in full.
- `shopify.server.ts`'s `distribution` must match whatever's selected in
  the Partner/Dev Dashboard (currently Custom → `AppDistribution.
  SingleMerchant`, not `ShopifyAdmin`). Changing one without the other
  breaks auth at process boot — confirmed the hard way.
- Don't add `read_all_orders` to scopes — Shopify rejects it without a
  separate approval process the CLI can't grant on its own. `read_orders`
  (60-day window) and `read_customers` cover what this app needs today and
  both auto-grant fine on your own dev store.
- The email-safe rules in `design-system-prompt.ts` (table layout, inline
  styles only, no `<script>`, no external stylesheets) exist because
  Outlook/Gmail break on anything else — not stylistic caution.

## Running it
- `npm run dev` — starts `shopify app dev` (tunnel, OAuth, HMR). Scope
  changes auto-grant silently on your own dev store; no browser prompt to
  click through in that case.
- `npm run typecheck && npm run build` — run both after touching `app/`.
  One pre-existing gap is expected, not a regression: `s-app-nav` isn't in
  `@shopify/polaris-types` yet (`app/routes/app.tsx`).
- Email sending needs `RESEND_API_KEY`, a verified `NOMI_FROM_EMAIL`,
  optional `NOMI_FROM_NAME`, and `EMAIL_JOB_SECRET`. Never generate or send
  inside the webhook route; run the worker endpoint separately.

See SPEC.md for features and DECISIONS.md for why choices were made.
