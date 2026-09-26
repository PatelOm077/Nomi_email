# Nomi Campaigns

The Campaigns page (`/app/campaigns`) is the merchant-facing UI for the
one-prompt campaign feature described in SPEC.md ("5. One-prompt
campaigns"). This doc covers how the backend and picker UI are actually
built, since that's not obvious from reading SPEC.md alone. Everything
below lives in `app/routes/app.campaigns.tsx` unless noted.

## What it does

A merchant clicks **Create Campaign**, writes a free-text brief ("flash
sale", "holiday gift guide"), picks what the email should feature (a single
product, a collection, or up to three products), optionally sets a discount
code, and clicks **Generate**. Nomi calls Claude to write a real,
brand-skinned marketing email using real store data, saves it as a
`Campaign` row, and shows it in the campaigns list as a draft.

Audience selection, unsubscribe handling, scheduling, and bulk delivery are
**not** built — see "What's not done" below. A campaign here is a reviewed
draft, nothing more.

## Backend

### Data model

`Campaign` in `prisma/schema.prisma` (migration
`20260921180000_add_campaigns`) is the durable record: shop, status
(`draft` today), method (`ai` | `template`), the merchant's prompt, which
feature mode was used, the featured product IDs / collection ID (JSON),
discount fields, and the final `subject` / `previewText` / `html`. This
replaced the old fully-fake flow — before this, every "Create Campaign"
click just ran client-side `setTimeout`s and never persisted anything (see
git history: `d241400`, `19f2027`).

### Real catalogue search

`app/dashboard/campaign-catalog.server.ts` has the GraphQL helpers the
picker UI and the generate action both use:

- `searchCampaignProducts(admin, term)` — live product search (`title:*term*`,
  falls back to a recently-updated browse list when `term` is empty).
- `searchCampaignCollections(admin, term)` — same, for collections.
- `loadCampaignProductsByIds(admin, ids)` — re-fetches the merchant's picked
  product(s) by ID at generation time, so the email is built from the
  store's *current* title/price/image rather than trusting whatever the
  client had cached.
- `loadCampaignCollectionProducts(admin, collectionId)` — a picked
  collection isn't itself featurable in an email; this pulls up to three
  real products from it to hand the generator.

### Route loader/action (`app.campaigns.tsx`)

The **loader** does double duty: with `?kind=products` or
`?kind=collections` in the query string it returns picker search JSON
(called via `useFetcher().load()`); otherwise it returns the paginated
campaign list from the `Campaign` table. `useLoaderData()` on the page
component has to be cast rather than typed from `typeof loader`, because
that type is a union of both response shapes — see the comment at the
`useLoaderData` call site.

The **action** handles `POST` (the real "Generate" submission):
1. Validates the prompt (1–1000 chars) and that `EMAIL_GENERATION_PAUSED`
   is off.
2. Resolves the shop's language/tone from `ShopSettings`.
3. Depending on `feature`, re-fetches real product/collection data
   server-side (never trusts client-supplied product details).
4. Builds the discount context (`withDiscountContext`) and appends it to
   the prompt verbatim — the model is told the real code/amount/dates so it
   never has to invent one (this leans on the "brief is authoritative" rule
   already in the newsletter skeleton prompt).
5. Calls `generateNewsletterEmail` (existing `app/email-engine` generator —
   no new generator was added, per the "don't add new email types" rule in
   CLAUDE.md).
6. Persists a `Campaign` row and returns `{ campaign: {...} }` for the
   client to show as a reveal card.

### Generation quality

- `app/email-engine/generate-email.ts`: `output_config.effort` is `"high"`
  for **all** email generation (campaigns and lifecycle both) — a
  deliberate, requested change, not scoped to campaigns only.
- `app/email-engine/newsletter-prompt.ts`: explicitly allows the model to
  invent seasonal/thematic decoration (color, typography, dividers, ✦❆🎄🔔
  glyphs) for a themed brief, while still forbidding invented product
  photography — decoration must come from color/shape/typography only,
  never a fabricated image.

### AI-generated photography

Between loading products and calling Claude for the HTML, the action runs
`resolveGeneratedImages`:

1. `planCampaignImages` (`app/email-engine/campaign-image-plan.ts`) — a
   Claude call that sees the real product photos, product type, merchant
   description, and approved Brand Studio identity, and returns 0–3 photo
   briefs (hero / editorial / material / scene) plus one shared art
   direction. Zero photos is a normal outcome. A photo that shows a
   product must name a supplied product with a real photo; anything else
   is dropped.
2. `generateImage` (`image-generation.ts`) — OpenAI Image API, in parallel.
   Product photos go to `/v1/images/edits` with the real product photo as
   the reference; the rest to `/v1/images/generations`.
3. `uploadImageBufferToShopify(..., { waitForReadyMs: 30_000 })` hosts each
   one on the shop's CDN.
4. The newsletter prompt's rule 4b places each photo once, as a large
   block, never with text over it, tagged `data-nomi-seam="image"` so the
   seam editor can swap it.

Every step returns fewer photos on failure rather than failing the
campaign. A full generation with 3 photos takes about 3 minutes.

The action also loads the approved Brand Studio identity, so campaigns
wear the merchant's real palette, voice, and logo. The brand name comes
from `evidence.shopName`, never `brandSystem.name` (that's the creative
direction's label).

## Frontend: the picker UI

Three feature modes, each a real combobox backed by the search helpers
above — not the old hardcoded `<select>` options:

- **Product** (`SingleProductPicker`) — single-select, auto-picks a default
  product on first load, searchable.
- **Collection** (`CollectionPicker`) — single-select, real collection
  names (text only, no photos — collections don't carry one in Shopify).
- **All Products** (`MultiProductPicker`) — checkbox multi-select, max 3,
  with a numbered chip list (thumbnail + name + remove button) below the
  search box.

`ProductThumb` is the shared thumbnail renderer used by all three.

### The inline-style thing — read this before touching picker CSS

**Every layout-critical style on the picker (width, height, position,
overflow, object-fit, flex properties, padding, box-sizing) is set via
inline `style={}` props in the JSX, not just CSS classes in `nomi.css`.**
This looks redundant — the same rules are duplicated in both places — but
it's deliberate. While building this, product photos were rendering at
full/broken size (hundreds of px instead of 40px) inside the picker
trigger/rows, and this reproduced even after:

- Confirming via `curl` that the exact correct CSS was being served fresh
  from the dev server.
- A full hard reload (Ctrl+Shift+R).
- Fully restarting `shopify app dev` with a clean tunnel.
- Tagging every layer of the component (wrapper, trigger, panel) with
  unmissable diagnostic colors (`background: red !important` etc.) — none
  of them ever showed up, despite the broken rendering being clearly
  present in the same spot.

The root cause was never conclusively identified (this app's embedded
Shopify admin iframe makes it impossible to inspect the live DOM directly —
see the note below), but moving the layout math to inline styles fixed it
immediately and reliably. Inline styles are part of the JS bundle itself,
not a separately-loaded/cached resource, so they render correctly
regardless of whatever was going on with the external stylesheet in this
environment. **If you add a new element to the picker UI, give its sizing
an inline `style`, not just a class.**

**Update:** "colors/borders are fine to leave CSS-only" turned out to be
wrong for `.nomi-cc-picker-row` specifically — it silently fell back to
unstyled native `<button>` chrome (grey background, outset border) in the
live embedded iframe, even though `.nomi-cc-picker-panel` and
`.nomi-cc-picker-trigger` right next to it rendered their CSS-only colors
correctly. `ROW_STYLE` (plus `ROW_SELECTED_STYLE`/`ROW_DISABLED_STYLE`) now
inlines `background`/`border`/`borderRadius`/`color`/`font` too. Don't
assume a class is safe just because a sibling class on the same panel is —
verify each one's actual live rendering.

### Debugging note: use Chrome DevTools MCP for the embedded iframe

Claude in Chrome's page-level `read_page` / `find` / coordinate tools cannot
reliably inspect or click inside the app's cross-origin Shopify iframe. They
only operate on the outer `admin.shopify.com` renderer. This is an OOPIF tool
boundary, not a Nomi layout or `pointer-events` bug.

Use the project-configured `chrome-devtools` MCP server instead. It connects to
the existing Chrome session with `--autoConnect` and is the supported surface
for inspecting the iframe DOM, console, network requests, and interactive
states. Chrome 144+ must have remote debugging enabled at
`chrome://inspect/#remote-debugging`, and the agent session must be restarted
after enabling it. Use the Shopify session signed in as
`ombarvaliya7@gmail.com`. Do not work around this by disabling site isolation
or web security. Screenshots remain useful visual evidence, but they are no
longer the only available signal.

## What's not done

- Audience selection, unsubscribe handling, scheduling, and bulk delivery
  (explicitly out of scope per SPEC.md's "Done means" note).
- The "Start from template" method is still the original client-side-only
  preview (fake `setTimeout` progression, nothing persisted) — it was
  intentionally left alone since the rebuild only covered the AI/picker
  path.
- Subject line and preview text are computed with a local heuristic
  (`${discount}% Off — ${title}` / `Featuring ${products}`), not
  model-authored — the shared `generateEmailHtml` contract only returns a
  full HTML document, and extending it to also return structured
  subject/preview metadata would touch every other generator (abandoned
  cart, review request), which was out of scope here.
- Currency in the discount UI is hardcoded to `USD`/`%`, not the shop's
  actual currency.
