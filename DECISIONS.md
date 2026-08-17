# Nomi — Decisions log
Dated one-liners. Newest at top. Reasoning survives, not just conclusion.

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
