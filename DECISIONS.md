# Nomi — Decisions log
Dated one-liners. Newest at top. Reasoning survives, not just conclusion.

2026-09-26 - Campaigns can include AI-generated photography (OpenAI
  `gpt-image-2.5-sunburst`, high quality, JPEG), complementing Claude's
  HTML rather than replacing it. Claude first plans 0–3 photos per
  campaign (zero is a normal answer) after seeing the real product photos,
  product type, description, and the approved Brand Studio identity — a
  bare title like "Loam" had it inventing a "throw" for a skincare jar.
  Photos never contain text (all words stay live HTML for translation,
  seams, and image-blocked inboxes). A photo may show a real product only
  when generated from that product's real photo as a reference; campaigns
  are drafts the merchant reviews, so product scenes are allowed there but
  not yet in lifecycle flows. Campaigns now also wear the approved Brand
  Studio identity instead of inventing a skin, named from
  `evidence.shopName` — `brandSystem.name` is the creative direction's
  label and must never reach an email. Best-effort throughout: no key, a
  planning error, or a failed photo only means fewer photos.
  Roughly 5–8¢ per photo; `NOMI_CAMPAIGN_IMAGES=off` disables it.

2026-09-23 - Campaign product photos can optionally be shown as a
  background-removed cutout instead of the real in-context photo, chosen by
  the model per composition (never both for the same product). Background
  removal is a paid third-party API (remove.bg), so it's fully opt-in via
  `REMOVE_BG_API_KEY` — unset, campaigns behave exactly as before — and every
  cutout is cached (`ProductImageCutout`) so the same product photo is never
  billed twice across campaigns. The one-prompt newsletter skeleton was also
  rewritten for real editorial ambition (hero-scale headline treatment, scale
  contrast in product staging, invented ticket-stub/badge motifs for
  discount codes) — still strictly table-based/inline-styled/real-photos-only,
  same Outlook/Gmail constraints as every other Nomi email.

2026-09-22 - Subject line and preview text edits are scoped recipe-metadata
  updates, not email regeneration. The Flow Editor persists only the selected
  recipe's `subject` and `preheader`, preserves the approved HTML and brand
  evidence, and applies the saved values to its inbox preview immediately.
  Server validation retains the 64-character subject quality limit, the
  140-character preview limit, and family-wide subject uniqueness.

2026-09-22 - Full-family regeneration is an explicit background action on the
  Brand Studio Ready screen, independent of evidence fingerprint changes. It
  reuses the approved evidence, Brand System, direction, and recipes, treats
  each previous HTML document only as a negative reference for structural
  variation, and atomically replaces all 13 rendered emails only after the new
  family passes individual and family-wide quality gates.

2026-09-16 - Brand Studio treats selected product IDs as an exact render
  contract: authoring and repair receive the required image URLs and real
  destinations explicitly. Valid emails are checkpointed even when a sibling
  in the same flow fails repair, and resume requests only missing email IDs.
  The A1 asset gate stays strict without repeatedly charging for valid work.

2026-09-16 - Nomi remains the app/platform identity while Brand Studio evidence
  owns each merchant's name, logo, palette, typography, imagery, previews, and
  generated email HTML. The development shop alone is normalized to the Lumen
  demo merchant. Every other store uses its own Shopify identity, including the
  logo already configured in its published theme or uploaded to Shopify Files;
  Lumen assets are never a cross-merchant fallback.

2026-09-16 - Brand Studio has one shared downstream acceptance boundary. A
  profile is usable by Dashboard, Flow Editor, Templates, replay completion,
  or live-delivery brand loading only when its status is complete, all three
  evidence fingerprints match, the Brand System and 13 recipes validate, and
  all 13 rendered HTML documents exist. Partial checkpoints remain resumable
  build data and can never appear as an approved email family.

2026-09-16 - Nomi owns five lifecycle flows only: Welcome, Still Interested?,
  Abandoned Cart, How Was It?, and Welcome Back. Shopify remains responsible
  for order confirmations, shipping notifications, and refund confirmations.
  Nomi does not generate or send those three types. `orders/create` remains
  subscribed only as the cancellation signal for pending cart recovery, while
  delivered `fulfillments/update` events can trigger How Was It?. This
  supersedes the 2026-08-17 transactional-send scope and receipt-toggle design.

2026-09-16 - Brand Studio persists every validated lifecycle flow immediately
  and resumes from safety-revalidated checkpoints. The Brand System and recipes
  are saved before HTML generation, and an expected-brand preflight can stop an
  identity mismatch before any paid request. HTML authoring/repair defaults to
  medium effort while planning and family critique remain high effort. This
  prevents one late failure from discarding four paid flows.

2026-09-16 - Brand Studio no longer selects from five layout variants or falls
  back to a local creative compiler. Claude plans each lifecycle message with a
  free-form creative brief, authors the complete email HTML with awareness of
  all 13 briefs, then reviews the finished family and structurally regenerates
  up to three repetitive emails. Nomi retains only truth, asset, link,
  accessibility, email-client, and finished-family diversity gates. This
  supersedes the 2026-09-15 deterministic-compiler fallback decision.

2026-09-16 — Shopify Admin is the authoritative product-catalogue image source
  across authenticated Nomi surfaces. Dashboard, Flow Editor, and Brand
  Settings load every active product through cursor-paginated Admin GraphQL and
  use its featured media; local Lumen product files remain fallback/test design
  assets, not the live catalogue. The email identity remains Lumen for the
  controlled Lumen presentation rather than inheriting the development shop's
  account name.

2026-09-15 — Approved Brand Studio evidence is fingerprinted. Existing
  pre-fingerprint profiles are treated as unverified, stale/mismatched systems
  are excluded from Templates and blocked at the delivery worker, and an
  explicit Shopify/storefront rescan returns the merchant to Snapshot before
  rebuilding. Live lifecycle generation receives the current approved Brand
  System, logo, and matching lifecycle recipe instead of inventing a new skin;
  supplied cart, delivered-order, product, and customer facts stay authoritative.

2026-09-15 — Brand Studio now gives Claude Sonnet 5 authorship of the final
  email HTML in five flow-sized, high-effort passes after the Brand System and
  recipes are approved. Nomi validates every asset, destination, brand token,
  mobile/email-safety rule, and family-level uniqueness constraint before
  persisting the 13 documents. The deterministic compiler remains the safe
  fallback and preview fixture, not the creative ceiling. Live delivery is
  still unchanged.

2026-09-15 — Brand Studio completion is fail-closed behind a deterministic A1
proof: all 13 emails and all five compositions must be present; safe HTML,
distinct useful copy, Brand System rules, and real public product assets/links
must pass. Below-A1 output is not persisted as complete. This remains a
preview/approval gate and does not connect Brand Studio to live delivery.

2026-09-14 — Brand evidence = one persisted, merchant-confirmable record that
  combines Shopify's authoritative product catalogue with the published main
  theme and public storefront. Creative direction generation uses that approved
  record; it does not rescan or silently replace merchant corrections.

2026-09-14 — A1 email rendering = model-authored structured Brand System and
  lifecycle recipes compiled through five deterministic, email-safe layouts
  (hero, product-focus, letter, split, status). Live delivery remains on the
  existing generator until the generated family passes the visual benchmark.

2026-09-11 — Nomi UI never uses loose checkmarks or ticks as decorative
  completion indicators, especially isolated blue marks above labels.
  Completion is communicated through the component itself: a labeled state,
  filled progress segment, restrained color change, or compact status treatment.
  Checkmarks remain acceptable only when their literal semantic role is
  unavoidable, such as a native selected checkbox.

2026-09-10 — Replay setup restarts Brand Studio at the welcome screen and
  reuses the saved snapshot, directions, Brand System, and lifecycle recipes.
  Replay is a read-through of the completed setup: it makes no AI calls,
  spends no additional generation budget, and does not replace the approved
  Brand System.

2026-09-10 — Brand Studio constrains both Claude stages with Anthropic structured
  outputs. The longer 13-email lifecycle build uses the SDK streaming path;
  non-streaming long requests are rejected by the SDK before reaching Claude.
  Schema validation and the USD $3 budget guard remain server-side.

2026-09-09 — Brand Studio uses the existing `public/nomi-mark.svg` mark, never
  an invented square glyph. Completed progress steps use uncontained line
  checks in distinct restrained colors; the current step gets the stronger numbered emphasis, Lora display
  label, and a restrained animated rule. Screens enter with editorial motion,
  creative directions reveal in sequence, and all motion respects reduced
  motion preferences.

2026-09-09 — Brand Studio is the durable onboarding-to-generation system; its
  full brief lives in `BRAND_STUDIO.md`. Setup has a hard USD $3 AI ceiling.
  GPT-5.6 Sol at medium reasoning analyzes storefront evidence and suggests the
  two editable Brand Intent answers; Claude Sonnet 5 at high effort creates the
  three directions, selected Brand System, and coordinated lifecycle designs
  and copy. Nomi validates and compiles structured recipes into safe HTML.

2026-09-09 — Brand Intent asks exactly two questions: who the main customer is
  and what the brand should feel like. Each supports merchant-written input or
  an editable `Decide for me` suggestion produced by the existing storefront
  analysis, with no additional model call. Advanced guardrails stay in Brand
  Settings after onboarding.

2026-09-02 — Remix falls back to two separate Claude passes when no OpenAI
  key is configured: campaign route drafting first, then editorial review.
  Plans persist their actual generator so merchant-facing provenance stays
  accurate. When both keys exist, the approved GPT-draft/Claude-review path
  remains preferred.

2026-09-02 — Remix uses GPT to draft campaign routes, Claude to review and
  refine the direction, and Nomi's controlled components to compile
  email-safe HTML only after merchant approval. Approval saves drafts; it
  does not send, change timing, or alter audiences automatically.

2026-08-17 — Order confirmation and refund confirmation cannot be Nomi's
  own automatic send on a live store, on any plan: Shopify has no setting
  or API to globally disable its native order-confirmation email (no
  toggle exists at all — it's the legal purchase receipt) or its native
  refund email (suppressible only one refund at a time, via a checkbox a
  human clicks during a manual refund, not programmatically). Confirmed
  by research, not assumption. Shipping is different: "out for delivery"
  and "delivered" notifications have a real Settings > Notifications
  toggle, and the initial shipping-confirmation email can be suppressed
  per-fulfillment. Net effect: enabling Nomi's webhook sends for
  order-confirmation or refund-confirmation on a real store guarantees
  the customer gets two receipts for the same event, with no fix
  available. Needs a product decision — see conversation.

2026-08-17 — Real storefront brand extraction (actual logo/colors, not
  AI-invented) is not just unfinished, it's blocked: `Shop.brand` is not
  a field on the Admin GraphQL `Shop` type (confirmed against the live
  2026-07 schema — "Cannot query field 'brand' on type 'Shop'"). The only
  way to read a merchant's real logo/colors is the legacy REST Asset
  resource against a theme's `settings_data.json`, which sits behind the
  protected `themes` access scope — same class of blocker as
  `read_all_orders`: requires Shopify's app-review approval, not
  something the CLI can self-grant on a dev store. AI-invented brand skin
  per shop stays the design until that scope is worth pursuing.

2026-08-17 — Sending = Nomi-owned delivery through Resend, triggered by
  Shopify webhooks and processed from a durable job queue. Webhooks never
  wait on Claude or the provider. This is the only architecture that also
  covers abandoned checkout recovery.

2026-08-17 — Abandoned recovery = one hour after the last checkout update,
  only for a checkout with an email and marketing consent. An order event
  cancels the pending job; the worker rechecks Shopify before sending.

2026-08-17 — Billing = Shopify App Pricing, one flat monthly plan. The
  legacy Billing API is not new work: price configuration belongs in the
  Partner Dashboard when the app moves from single-merchant beta to public.

2026-08-17 — Launch languages = English, Spanish, French, German, Italian,
  Portuguese, Hindi, Japanese, Korean, and Simplified Chinese. Customer
  locale wins for event-driven sends; the shop setting is the fallback.

2026-09-23 — Dropped Hindi, added Dutch, and reordered the launch language
  list to roughly track Shopify market share: English, Spanish, German,
  French, Portuguese (Brazil), Italian, Japanese, Dutch, Simplified
  Chinese, Korean. English alone covers the large majority of Shopify
  storefronts (W3Techs/StackScan estimate ~71-79%), and India's ecommerce
  buyers are overwhelmingly served in English, whereas Dutch-language
  copy is commonly expected in the Netherlands/Belgium market. Relabeled
  "Portuguese" to "Portuguese (Brazil)" since Brazilian and European
  Portuguese read differently; the stored language code stays "pt" so no
  data migration is needed. The `EMAIL_LANGUAGES` array order is what
  the dashboard and brand-settings dropdowns render, so reordering it
  changes both automatically.

2026-08-17 — Generation model = Claude Sonnet 5 (claude-sonnet-5), NOT Opus.
  Output quality is merchant-grade at ~4¢/email; Opus multiplies cost for a
  bump customers won't notice. Unit economics are the whole game for a sub.

2026-08-17 — Prompt caching ON: static design-system prompt goes in the
  system block with cache_control. Verified cache hits (creation→read).
  This is the lever that keeps per-email cost near 1¢ at scale.

2026-08-17 — Email HTML = small set of bulletproof, email-safe table
  skeletons (inline styles), AI generates the "skin" (copy/colors/layout
  choices) poured in. Never freeform HTML per send — breaks in Outlook/Gmail.

2026-08-17 — Font stack in emails: Source Serif 4 → Georgia → serif.
  Gmail/Outlook strip webfonts; Georgia keeps the newsprint feel everywhere.

2026-08-17 — Generation engine lives in its own platform-independent module.
  Shopify is one data adapter; WooCommerce/Wix/BigCommerce come later.

2026-08-17 — Brand: newsprint-plain. Ink #201e1d, Paper #f3f2f2,
  Cyan #0088b0 (interaction only), Magenta #d6006c (one spot at a time).
  Source Serif 4 for headings/wordmark; system sans for admin UI chrome
  (serif in Shopify admin chrome looks foreign — decided against it).

2026-08-17 — Distribution = Custom (single merchant) for now. Public App
  Store listing is launch-day (~2–3 months out), not needed for dev/beta.

2026-08-17 — Positioning vs incumbents: Orderly/Seguno/Omnisend put your
  logo on a template; Nomi WRITES your emails. Preview-your-brand is table
  stakes (Orderly does it free via static vars); AI copy + personalization
  + endless fresh looks is the moat that justifies recurring pricing.

2026-08-17 — Pricing model = flat monthly, not per-contact. Direct contrast
  to Klaviyo/Omnisend/Seguno whose bill climbs with list size.
  SUPERSEDED 2026-09-24, see below.

2026-09-24 — Pricing model = contact-based tiers (replaces flat monthly).
  Reason: Wiz (closest competitor) charges by active contacts ($15 at 500 →
  $20 at 1k → $30 at 2k → $75 at 4.5k), and Nomi's Resend sending cost grows
  with list size and send frequency, which a flat price can't absorb.
  Provisional ladder, same features on every tier: ≤500 $15, ≤1k $20,
  ≤5k $69, ≤10k $129, ≤20k $249 per month. Each tier needs a stated monthly
  send allowance: the worked example assumes 6× contacts, because a price per
  contact that falls from 3¢ to 1.25¢ can't cover daily sends on large
  lists. Prices stay provisional until (1) Resend confirms how it bills
  multi-merchant marketing sends from one account, and (2) there is a
  written rule for who counts as an active subscribed contact and when a
  tier change takes effect. Billing is still Shopify App Pricing.
