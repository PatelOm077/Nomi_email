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
- `app/routes/app._index.tsx` — the lifecycle dashboard. It reads the active
  catalogue and approved Brand Studio output for the five supported flows.
- `app/routes/app.tsx` — embedded app shell (nav, auth). Also the theme
  setup gate: every `/app/*` page redirects to `/app/setup` until the
  "Nomi Script" app embed is on in the live theme
  (`ShopSettings.appEmbedVerifiedAt`). Detection lives in
  `app/dashboard/app-embed.server.ts` (reads the MAIN theme's
  `config/settings_data.json`, `read_themes` only); it fails open on a
  Shopify read error so merchants aren't locked out.
- `app/routes/app.setup.tsx` — the first-install "Enable Nomi on your
  theme" screen. Deep-links into the theme editor with
  `activateAppId=<api key>/nomi-script`. Once the embed reads Active it hands
  off to Brand Studio onboarding (`/app/brand-studio`), not the dashboard.
- `extensions/nomi-theme/` — theme app extension; `blocks/nomi-script.liquid`
  is the app embed. Its filename is the detection key and deep-link handle —
  don't rename it. With it present, `shopify app dev` needs the storefront
  password (`SHOPIFY_FLAG_STORE_PASSWORD`) to run non-interactively.
- `app/routes/_index/`, `app/routes/auth.login/` — the public install/login
  flow, required by public (AppStore) distribution. Not the embedded admin
  path, but don't delete them (see Don't touch).
- `app/email-engine/` — the generation engine. **No Shopify imports allowed
  in this folder** — that boundary is the whole point of it being
  platform-independent (Shopify today, WooCommerce/Wix/BigCommerce later).
  - `types.ts` — neutral lifecycle/cart/line-item shapes
  - `design-system-prompt.ts` — `SHARED_DESIGN_SYSTEM_PROMPT`: the rules
    every skeleton shares (output contract, table-based HTML, typography,
    brand-skin invention, voice). Sent as its own cache_control block, so
    it's written to cache once and read by every email type, not just
    repeats of the same one.
  - `abandoned-cart-prompt.ts` and `review-request-prompt.ts` — runtime
    lifecycle skeletons, each appended as its own cache-control block.
  - `anthropic-client.ts` — the lazy Anthropic client singleton
  - `generate-email.ts` — shared call-Claude-and-return-HTML logic (system
    blocks, stop_reason handling, code-fence stripping) used by every
    `generate-*-email.ts` file
  - `generate-abandoned-cart-email.ts`, `generate-review-request-email.ts`,
    and `generate-newsletter-email.ts` — supported runtime generators.
  - `background-removal.ts` — optional, `REMOVE_BG_API_KEY`-gated product
    photo cutout for campaigns. Platform-neutral (no Shopify import): takes
    a real image URL, returns raw cutout bytes or `null`. Hosting those
    bytes at a public URL is Shopify-shape work, so that half
    (`uploadImageBufferToShopify`) lives in
    `app/dashboard/campaign-catalog.server.ts` instead, called from
    `app.campaigns.tsx`'s action. `ProductImageCutout` (Prisma) caches a hit
    per shop+product+source-photo so the same product is never billed to
    the paid removal API twice.
  - `campaign-creative-plan.ts` + `image-generation.ts` — the campaign
    creative director and optional AI photography. Claude plans the whole
    email (which sections, how many, what order, and how many text-free
    photos, with no fixed template; every email gets a CTA), OpenAI's Image
    API (`OPENAI_IMAGE_MODEL`, default `gpt-image-2.5-sunburst`) renders the
    photos, `campaign-image-review.ts` checks each one, and
    `app.campaigns.tsx` hosts them via `uploadImageBufferToShopify`. The
    email is written while photos render, using placeholder srcs from
    `generated-photo-slots.ts` that are swapped (or the `<img>` removed) at
    the end. Off when `OPENAI_API_KEY` is unset or
    `NOMI_CAMPAIGN_IMAGES=off`. The photo rules (no hands/skin, no text,
    faithful products) live once in `photo-direction-rules.ts`.
  - Brand Studio's 13 lifecycle emails are built by the campaign pipeline,
    one email at a time (`app/brand-studio/campaign-engine.server.ts`): the
    campaign creative director plans each, its photos render, the campaign
    designer writes it from a lifecycle brief (flow, role, creative brief,
    approved copy), and it is checked against the Brand Studio quality gate
    and rewritten once with the exact problems if it fails. The first build,
    Regenerate all, and single-email regenerate all use it. The older
    batch-per-flow writer (`generateCreativeEmailFamilyWithSonnet`) and the
    shared photo kit below are no longer called by any route.
  - `lifecycle-photo-kit-plan.ts` — Brand Studio's photo director: reads
    the 13 creative briefs and plans a small reusable photo kit (which
    emails use which photo; often only some emails get one). Rendering,
    review, hosting, and the $3-cap cost live in
    `app/brand-studio/photo-kit.server.ts` (stored as
    `BrandStudioProfile.photoKit`, reused by every regenerate) via the shared
    `app/dashboard/generated-photo.server.ts`.
  - `personal-slots.ts` — the send path for abandoned cart and review
    request. Brand Studio writes cart-1/2/3 and review-request with a
    `data-nomi-slot="items"` row and a `data-nomi-field="action-url"` CTA;
    the worker (`process-jobs.server.ts`) fills in the customer's real items
    and checkout/product link by code, no Claude call. It falls back to
    per-send generation at low effort when the customer's language differs
    from the store's or the approved email predates the markup.
- `app/billing/` — plans and limits. `plans.ts` is the one source of prices
  and allowances. On sale now (`OFFERED_PLAN_IDS`, 2026-10-01): Free,
  Starter and Growth, paid plans with a 7-day free trial (`PAID_TRIAL_DAYS`,
  set in the Partner Dashboard); Pro is defined but not offered or shown
  (Free $0 one-time trial, Starter $29, Growth $79, Pro $199;
  extra emails or subscribed contacts $5 per 500; contacts are Shopify
  customers subscribed to email marketing, 250 / 1k / 5k / 15k by plan,
  counted hourly by `contacts.server.ts`; Free pauses sending when over). `usage.server.ts` checks an allowance before any
  AI spend and records it after success; campaigns, single regenerate,
  Regenerate all, the Brand Studio build, and the send worker all call it.
  Charging goes through Shopify App Pricing: plans live in the Partner
  Dashboard, "Choose" opens Shopify's hosted plan page, and
  `shopify-pricing.server.ts` reads the active subscription from the Partner
  API (needs SHOPIFY_PARTNER_API_ACCESS_TOKEN, SHOPIFY_PARTNER_ORG_ID,
  SHOPIFY_APP_GID). Plan handles must contain free/starter/growth/pro. Until
  those are set, `/app/pricing` switches plans on development stores only.
  Overage ($5 per started 500 extra emails or subscribed contacts a month)
  is billed by `usage-billing.server.ts`: the email-jobs worker queues each
  block as a `UsageReport` and sends it once to the App Events API (meters
  `extra_emails_500` and `extra_contacts_500` on each paid plan, Fixed, $5
  per unit, 0 included). Off until `NOMI_USAGE_BILLING=on`.
- `app/support/` — the in-app help chat (`SupportWidget.tsx`, mounted in
  `app.tsx` on every page) and its backend (`api.support.tsx`). Merchant
  questions are answered by Claude (`assistant.server.ts`), grounded on the
  Help library in `guides.ts`, the plans, and the shop's live state (plan and
  usage, sending on/off, Brand Studio status, recent unsent emails); keyword
  guide lookup is the fallback when there's no API key, the call fails, or a
  shop passes 60 AI answers a day. "Talk to the team" hands the conversation
  to a person: `SupportNotification` emails the team
  (`NOMI_SUPPORT_EMAIL`, default ombarvaliya7@gmail.com) from the email-jobs
  worker, the team answers at `/support-inbox` (password
  `NOMI_SUPPORT_ADMIN_SECRET`, 32+ chars), and the merchant gets a "The Nomi
  team replied" email plus an unread dot on the launcher.
- `app/email-delivery/` — Resend provider adapter, durable webhook queue,
  and worker. `lifecycle-schedule.ts` is the one source of when each email
  sends (the Flow Editor's timing labels must match it): Abandoned cart at
  1h / +24h / +48h after the checkout (stopped by an order), Still
  interested? 7 and 10 days after a customer joins the email list if they
  haven't ordered (customers/create|update), How was it? review request 7
  days after delivery, Welcome back 30 / +14 / +30 days after a subscribed
  customer's latest order (each new order restarts it). Every step is queued
  up front as an EmailJob with its `emailId`/`customerId`; an order or an
  unsubscribe cancels that customer's pending steps, and the worker re-checks
  consent (and no-order for Still interested?) before sending. Welcome and
  the Thank-you email are designed but not triggered yet. "Only send to new
  contacts" (ShopSettings.flowSettings) skips customers created before it
  was switched on. Webhook routes only enqueue; never call Claude or Resend in a
  Shopify webhook request.
- `app/routes/webhooks.email-events.tsx` — authenticated Shopify lifecycle
  ingress. `orders/create` is cancellation-only; it never sends an email.
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
- Emails are English only for now (decided 2026-10-01): no language picker
  in the Flow Editor or Brand & Settings, and every write/send path uses
  "en" whatever the customer's locale or the old `ShopSettings.language`.
  The multi-language plumbing (`EMAIL_LANGUAGES`, the unused `LanguageMenu`
  in `app._index.tsx`) is kept for when languages come back.
- Shopify-shape mapping (GraphQL field renaming, response shaping) belongs
  in the route file, never inside `app/email-engine/`.
- Generated email HTML is always table-based with inline styles only, font
  stack `Source Serif 4 → Georgia → serif`. Never freeform HTML — follow
  the shared contract in `design-system-prompt.ts` plus the relevant
  `*-prompt.ts` skeleton.
- `SHARED_DESIGN_SYSTEM_PROMPT` is marked `cache_control` on purpose — keep
  it long enough to clear Sonnet 5's ~1024-token cache-eligible minimum on
  its own. Shrinking it carelessly silently kills caching, not an error.
- Do not add order-confirmation, shipping-notification, or refund-confirmation
  generators. Those notifications remain Shopify-owned. Nomi's five flows are
  Welcome, Still Interested?, Abandoned Cart, How Was It?, and Welcome Back.
- Before adding a GraphQL query, check whether existing lifecycle/dashboard
  data already answers the question.
- A missing field (customer name, etc.) is `null`, never a placeholder
  string like "there" — every prompt has real fallback copy for the
  no-name case. Don't hand the model a fake value and let it treat it as
  real data.
- Don't let a skeleton invent things the merchant hasn't actually offered
  — a hallucinated discount code, product URL, or review URL is a broken
  promise, not a stylistic slip. The review-request prompt omits its CTA when
  no real URL was given rather than faking one with `href="#"`.
  `Product.onlineStoreUrl` is
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

## Vocabulary
- "Wordpress era" (merchant's term) means a UI element reads as shit and
  outdated — flat grey fills, boxy default-browser chrome, no visual
  polish. Not a request for an actual WordPress-style redesign; treat it as
  "this needs real design attention," same bar as the rest of this doc's
  Brand section.

## Don't touch
- `.env` — holds `ANTHROPIC_API_KEY` and Shopify secrets. Gitignored;
  never commit it or print its contents back in full.
- `shopify.server.ts`'s `distribution` must match whatever's selected in
  the Partner/Dev Dashboard (currently Public → `AppDistribution.AppStore`
  for "Nomi Email Marketing", client id ef35bfc0…, config
  `shopify.app.public.toml`; release with `shopify app deploy --config
  public`). Changing one without the other breaks auth at process boot —
  confirmed the hard way. The retired custom "Nomi" app (90627cfe…,
  `shopify.app.fly.toml`) was SingleMerchant; Fly now holds only the public
  app's keys.
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
- For live Chrome inspection and interaction, use the project-configured
  `chrome-devtools` MCP server. It connects to the existing Chrome profile via
  `--autoConnect`, which can inspect and interact with Nomi's cross-origin
  Shopify iframe. Chrome 144+ must have remote debugging enabled once at
  `chrome://inspect/#remote-debugging`; restart the agent session after changing
  that setting. Use the Shopify session signed in as `ombarvaliya7@gmail.com`.
  Do not disable Chrome site isolation or web security. The page-level
  Claude-in-Chrome `read_page`/coordinate tools are not the right surface for
  this out-of-process iframe.
- `npm run typecheck && npm run build` — run both after touching `app/`.
  One pre-existing gap is expected, not a regression: `s-app-nav` isn't in
  `@shopify/polaris-types` yet (`app/routes/app.tsx`).
- Email sending needs `RESEND_API_KEY`, a verified `NOMI_FROM_EMAIL`,
  optional `NOMI_FROM_NAME`, and `EMAIL_JOB_SECRET`. Never generate or send
  inside the webhook route; run the worker endpoint separately.
- The Templates route (`/app/additional`, Gauge/Denizen looks) and
  `/app/template-editor` are hidden in production (nav link removed, routes
  redirect to `/app`) but kept in the code. They show in local dev, or in
  production with `NOMI_TEMPLATES=on`. Gate: `app/dashboard/reference-looks.server.ts`.
- Campaign product-photo cutouts are optional: set `REMOVE_BG_API_KEY` (a
  remove.bg key) to turn them on. Unset, campaigns generate exactly as
  before — no cutout offered, no extra call, no cost.

See SPEC.md for features and DECISIONS.md for why choices were made.
