# Nomi — Decisions log
Dated one-liners. Newest at top. Reasoning survives, not just conclusion.

2026-08-21 — Reliability sweep: installed dependencies fresh and confirmed
  `npm run build`, `npm run typecheck`, `npm test`, and `npm run lint` all
  pass clean (typecheck's one error is the pre-existing documented
  `s-app-nav` gap in CLAUDE.md, not a regression). No runtime bug found in
  the delivery pipeline, webhook routes, or generation engine on this pass.

2026-08-21 — Removed ~470 lines of dead CSS from `app/styles/nomi.css`: an
  entire pre-Flow-Editor dashboard stylesheet (`.nomi-page`, `.nomi-shell`,
  `.nomi-card`, `.nomi-badge*`, `.nomi-button`, `.nomi-form*`, etc.) plus a
  `.nomi-flow-notice`/`.nomi-flow-receipt-warning`/`.nomi-flow-campaign-form`
  sub-family inside the current Flow Editor section, none of it referenced
  by any route's JSX (verified with a recursive grep across every `.tsx`,
  cross-checked against every dynamic `className={\`...\`}` construction
  site so a template-literal-built class like `is-${hue}` wasn't mistaken
  for dead — `.nomi-cursor-nib` was flagged unused too but is explicitly
  documented in-file as reserved for a future page, so it stayed). Gzipped
  CSS bundle: 61.35 KB → 52.86 KB. Build/typecheck/test/lint all still
  clean after the cut.

2026-08-21 — The onboarding orbit/found-card animation (`app._index.tsx`)
  uses two accent hues beyond CLAUDE.md's ink/cyan/magenta dashboard-UI
  rule: gold (`#edbb00`) and a deeper cyan (`#0088b0` at `-700`). Left as
  is rather than recolored: the surrounding code comment ties this build to
  "the approved mockup, pixel-for-pixel" (2026-08-19), so the extra hues
  read as a deliberate design call that predates this note, not a slip.
  Recording it here as the actual exception, since the CLAUDE.md rule as
  written doesn't carve it out. If that's wrong, the fix is to either
  amend CLAUDE.md to note the onboarding exception explicitly, or drop
  gold/cyan-deep from `ONBOARDING_FOUND_CARDS`/`ONBOARDING_ORBIT_CHIPS`
  and their CSS in `nomi.css` back to the three-color rule.

2026-08-21 — Deduplicated the onboarding reveal-chain closures in
  `app._index.tsx` (`revealCheck`, `revealDay`, `revealFound` — each was a
  copy-pasted "set n, wait, recurse until length, then run onDone" state
  machine) into one shared `revealSequence(setN, length, stepMs, onDone)`
  helper. Same control flow, same timing, verified with typecheck/build/
  test/lint (no test exercises the onboarding animation directly, so this
  is a mechanical, behavior-preserving extraction, not something rerun
  against a golden output).

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
