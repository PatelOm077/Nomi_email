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
  - `types.ts` — neutral order/line-item shapes
  - `design-system-prompt.ts` — the static, cached system prompt: the
    email-safe skeleton contract, voice rules, brand-skin instructions
  - `generate-order-confirmation-email.ts` — calls Claude, returns HTML
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
  the skeleton contract in `design-system-prompt.ts`.
- The design-system prompt is marked `cache_control` on purpose — keep it
  long enough to actually clear Sonnet 5's ~1024-token cache-eligible
  minimum. Shrinking it carelessly silently kills caching, not an error.
- A missing field (customer name, etc.) is `null`, never a placeholder
  string like "there" — the prompt has real fallback copy for the no-name
  case ("Thank you for your order."). Don't hand the model a fake value
  and let it treat it as real data.

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
  (60-day window) covers what this app needs today.
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

See SPEC.md for features and DECISIONS.md for why choices were made.
