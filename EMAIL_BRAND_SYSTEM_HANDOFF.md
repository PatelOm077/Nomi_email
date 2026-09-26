# Email brand system handoff

Last updated: 16 September 2026

## Read this first

This is the continuation file for Brand Studio and lifecycle email quality.
Read `CLAUDE.md`, `SPEC.md`, `DECISIONS.md`, this file,
`docs/onboarding-system.md`, and `docs/email-system.md` before changing the
system. Preserve merchant-owned worktree changes and assets. Never edit `.env`
or expose secrets.

## Merchant objective

Nomi must create highly brand-specific email families from Shopify and the
public storefront. The merchant explicitly prefers spending more model tokens
over forcing different brands through a small set of layouts. Claude should
decide what a brand needs: photography-led, type-led, editorial, graphic,
catalogue-like, intimate, minimal, or another defensible direction.

The system must still prevent invented claims, offers, products, images, links,
reviews, customer facts, and cross-brand/Nomi leakage. Technical email safety is
a boundary, not a creative template.

## Current authoritative architecture

### 1. Evidence and creative direction

- `app/brand-studio/shopify-evidence.server.ts` gathers store identity, public
  storefront language, theme cues, logo, and real Shopify product evidence.
- GPT-5.6 Sol creates the evidence-bound snapshot.
- Claude Sonnet 5 creates three brand-specific directions.
- The merchant chooses a direction and can add a concise refinement.

### 2. Open family planning

- `app/brand-studio/ai.server.ts` asks Claude for one Brand System and exactly
  13 lifecycle creative briefs.
- A lifecycle recipe contains semantic copy, a free-form `creativeBrief`, and
  exact real `productIds` when products strengthen the idea.
- There is no `layoutVariant`, no fixed image-strategy enum, no CTA-style enum,
  and no five-layout requirement.
- Every creative brief defines its own visual thesis, hierarchy, image role,
  pacing, CTA relationship, and difference from sibling emails.

### 3. Authoritative full-HTML generation

- Claude authors complete responsive email HTML in five flow-sized passes.
  Planning and the family-wide critique stay at high effort; HTML rendering,
  repair, and revision default to medium effort to control latency and cost.
  `ANTHROPIC_EMAIL_RENDER_EFFORT=high` remains available when explicitly
  warranted.
- Every pass receives the creative briefs for all 13 emails, so a flow is aware
  of the visual territory assigned elsewhere in the family.
- Product-led recipes carry an explicit machine-readable asset contract into
  both authoring and repair: every selected product image is required verbatim,
  and at least one supplied product/storefront destination must be used.
- A flow request now asks only for emails that are still missing. If one email
  fails its repair, valid siblings from the same paid response are checkpointed
  immediately; the next build resumes with only the failed email instead of
  buying the whole flow again.
- Claude has full control over composition, scale, alignment, product staging,
  section rhythm, colour proportion, CTA treatment, and footer silhouette.
- The only fixed format is the email-safe production envelope: complete HTML,
  centered maximum 600px table foundation, inline styles, responsive rules,
  accessible images, genuine destinations, 44px actions, and no unsafe code.
- Each validated flow is written to `renderedEmails` immediately. A failed or
  interrupted build resumes from valid saved flows instead of regenerating all
  13 emails. The approved Brand System and recipes are saved before HTML work.
- An optional expected-brand guard rejects an identity mismatch before making
  an Anthropic request. Stale or invalid checkpoints are validated and rebuilt,
  never trusted blindly.

### 4. Family-wide creative review

- After all five flow passes complete, a separate Sonnet creative-director pass
  reviews all 13 finished HTML documents together.
- It looks for repeated visual skeletons, image roles, hierarchy, section
  rhythm, CTA relationships, and footer silhouettes.
- It may request up to three targeted structural revisions.
- Claude regenerates only those emails, using the critique and the complete
  family as context. The revision must be structural, not a colour or copy swap.

### 5. Deterministic proof and persistence

- `app/brand-studio/email-quality.ts` remains deterministic and enforces truth,
  asset/link safety, mobile/email requirements, copy quality, approved palette,
  exact selected products, payload size, all 13 slots, unique creative briefs,
  and finished-HTML structural diversity.
- Missing Claude HTML fails the build. Nomi does not silently replace it with a
  local template.
- Only the validated full HTML is stored in
  `BrandStudioProfile.renderedEmails` and displayed in Templates/dashboard
  previews when its evidence fingerprint is current.
- `app/brand-studio/approved-family.ts` is the single downstream gate. It
  rejects incomplete status, fingerprint drift, invalid Brand System/recipes,
  or even one missing rendered email before Dashboard, Templates, replay
  completion, or live-delivery brand loading can use the family.

## Removed old process

The following process was deleted on 16 September 2026:

- five `layoutVariant` categories (`hero`, `product-focus`, `letter`, `split`,
  and `status`);
- constrained composition enums such as `full-bleed`, `framed`, `split`, and
  `catalogue`;
- the requirement that a family merely use all five layout names;
- automatic creative fallback from missing Claude output;
- `app/brand-studio/email-compiler.ts` and its compiler test suite;
- dashboard, Templates, Brand Studio, and local review-route calls to that
  compiler;
- the dashboard-only `generate-lifecycle-email.ts` Claude path and its tests;
- the unused fixed `templates/lifecycle-template.ts` HTML renderer, its tests,
  and customization type;
- the dashboard lifecycle-input adapter and the hard-coded blue/pink fallback
  preview that displayed “Recommended for you” and “BUY NOW”.

Existing profiles containing the old recipe schema are not treated as current
creative output. Rebuild them through Brand Studio. Replay detects the schema
change and performs the paid rebuild rather than trusting the old family.

## Lumen and Shopify products

- Lumen remains the current controlled brand identity in the dashboard.
- Product titles, prices, links, and featured photography come from every
  active product in the connected Shopify catalogue.
- Dashboard previews use current persisted Claude HTML only. If a current
  family is unavailable, the interface shows a neutral Brand Studio rebuild
  state; it does not synthesize an email or call Claude from the dashboard.
- `app/dashboard/lumen-demo.ts` retains semantic Lumen copy and 13 free-form
  creative briefs for lifecycle UI context. It is not an HTML renderer.

## Live automatic delivery

- `app/email-delivery/approved-brand.server.ts` loads the current approved Brand
  System, logo, and closest lifecycle creative brief for webhook generation.
- Shopify runtime order, cart, shipping, refund, and review facts remain
  authoritative.
- A stale, legacy, incomplete, or fingerprint-mismatched Brand Studio profile
  fails closed before customer data is fetched or a provider send occurs.
- Order/refund duplicate safeguards remain unchanged.

## Verification for this change

- Final Lumen build: 13 of 13 emails passed the A1 gate with 13 distinct
  rendered structures. Five flow checkpoints were persisted successfully.
- Persisted successful build cost: 866,756 microdollars (about USD $0.87).
- Brand/product preflight: identity `Lumen`; Shopify-hosted photography for
  Canopy, Loam, Peat, Rime, and Rind only. The rejected Nomi/Alpine family was
  replaced and is no longer current.
- Full test suite: 26 files, 136 tests passed.
- Typecheck: no new errors; the existing two `s-app-nav` custom-element errors
  remain in `app/routes/app.tsx`.
- Production build passed.
- Chrome checks passed at 1280px, 768px, and 375px: no page-level horizontal
  overflow; every control/CTA measured at least 44px high; Welcome, Cart, and
  Care previews were inspected and use clearly different compositions.
- Verification screenshots:
  `screenshots/lumen-final-emails-desktop-1280.png`,
  `screenshots/lumen-final-emails-cart-desktop-1280.png`,
  `screenshots/lumen-final-emails-tablet-768.png`, and
  `screenshots/lumen-final-emails-mobile-375.png`.

## Next proof required

1. Run the cross-brand benchmark across fashion, beauty, jewellery, food,
   home, outdoor, colourful, minimal, one-product, weak-evidence, and
   non-English stores.
2. Require every email to pass factual/safety checks and reach the agreed visual
   quality threshold before claiming universal quality.

## Complete change ledger for this conversation

This section records the implementation work performed during the conversation
that produced the open-art-direction Lumen email system. It is intentionally
more mechanical than the architecture sections above so a future agent can see
what was added, changed, removed, generated, and verified.

### Added

- Free-form `creativeBrief` and exact `productIds` lifecycle recipe fields.
- Complete Claude-authored HTML generation for each lifecycle flow.
- Family-wide creative critique covering all 13 rendered emails.
- Targeted structural revision of up to three repetitive emails.
- A targeted repair pass for deterministic HTML/safety failures.
- Structured-output retry handling and streaming for long Anthropic responses.
- Configurable Anthropic output ceiling through
  `ANTHROPIC_BRAND_MAX_TOKENS` (24,000–128,000; default 128,000).
- Configurable HTML-rendering effort through
  `ANTHROPIC_EMAIL_RENDER_EFFORT` (`medium` by default; `high` when explicitly
  configured). Planning and final family critique remain high effort.
- Flow-level persistence: Welcome, Interest, Cart, Care, and Win-back are saved
  as soon as each flow passes validation.
- Resume behavior that validates saved HTML and skips already completed flows.
- Pre-render persistence for the Brand System and lifecycle recipes so a retry
  does not repeat the planning pass.
- An optional expected-brand guard that rejects identity mismatches before an
  AI request is made.
- Visible-copy brand-leak detection that ignores permitted URLs and markup. This
  fixed the false match caused by the development domain containing `nomi-`.
- `app/email-engine/brand-studio-ai.test.ts`, covering the no-cost identity
  mismatch guard.
- Four final Chrome verification screenshots under `screenshots/`.
- Decision-log and design-review entries for the new architecture and final
  Lumen proof.

### Changed

- `app/brand-studio/types.ts`: replaced fixed layout/composition recipe fields
  with open creative direction and exact product selection.
- `app/brand-studio/ai.server.ts`: made Claude's full HTML authoritative; added
  open art direction, flow differentiation, email-native creative material,
  repair/retry/review/revision passes, identity checking, checkpoint resume,
  and the new token/effort configuration.
- `app/brand-studio/email-quality.ts`: validates exact products, unique creative
  briefs, and rendered structural fingerprints; removed fixed-layout counting;
  converted arbitrary short-copy rules into warnings where appropriate.
- `app/brand-studio/review-fixture.server.ts`: migrated the fixture to the new
  recipe schema.
- `app/dashboard/lumen-demo.ts`: added 13 individual Lumen creative briefs and
  retained Lumen as the controlled demonstration identity.
- `app/email-engine/types.ts`: migrated reference recipe typing to
  `creativeBrief` and `productIds`.
- `app/email-delivery/approved-brand.server.ts`: passes the approved creative
  brief into delivery generation.
- `app/email-lab/ai.server.ts`: updated lifecycle-schema guidance.
- `app/routes/app.brand-studio.tsx`: removed compiler fallback, saves the plan
  before rendering, checkpoints validated flows, resumes incomplete builds, and
  accounts for checkpointed usage without double-counting it.
- `app/routes/app.additional.tsx`, `app/routes/app._index.tsx`, and
  `app/routes/brand-emails-review.tsx`: use only current, fingerprint-matched,
  persisted Claude HTML instead of rebuilding through a local compiler.
- `app/email-engine/brand-studio-email-quality.test.ts` and
  `app/email-delivery/process-jobs.server.test.ts`: updated expectations for the
  open recipe schema and current persisted HTML.
- `docs/email-system.md`, `docs/onboarding-system.md`, and `DECISIONS.md`:
  documented the open creative system and superseded fallback behavior.
- `DESIGN_REVIEW.md`: recorded the rejected wrong-brand proof and the accepted
  responsive Lumen review.

### Removed

- `app/brand-studio/email-compiler.ts`.
- `app/email-engine/brand-studio-email-compiler.test.ts`.
- `layoutVariant`, `productSlots`, and fixed composition enums from active
  Brand Studio recipes.
- The five-layout completeness requirement.
- Automatic deterministic HTML fallback when Claude output is missing.
- Active route calls that reconstructed Brand Studio emails with the deleted
  compiler.
- The persisted wrong-brand Nomi/Alpine/snowboard email family; it was replaced
  by the validated Lumen family.
- Temporary inspection and one-off generation scripts used during the final
  migration. They were deleted after the successful build.

### Persisted local data

- The current Brand Studio profile identity is Lumen.
- The current evidence contains the five Lumen products: Canopy, Loam, Peat,
  Rime, and Rind, with their Shopify-hosted product photography.
- `BrandStudioProfile.renderedEmails` contains all 13 validated Lumen HTML
  documents.
- The current evidence and generated-evidence fingerprints match.
- The completed build records five successful flow checkpoints and a persisted
  metered cost of 866,756 microdollars (approximately USD $0.87).

### Verification performed

- `npm.cmd test`: 26 files and 136 tests passed.
- `npm.cmd run build`: passed after the final code change.
- `npm.cmd run typecheck`: no new errors; only the two pre-existing
  `s-app-nav` JSX typing errors in `app/routes/app.tsx` remain.
- `git diff --check`: passed; only Windows line-ending notices were printed.
- Chrome at 1280px, 768px, and 375px: no page-level horizontal overflow and
  every application link/button measured at least 44px high.
- Welcome, Cart, and Care were opened in the real review route. Their image
  roles, hierarchy, pacing, CTA relationship, and silhouettes were visibly
  different while retaining the Lumen palette and voice.

### Explicitly not changed

- `.env` and its secrets were not edited or exposed.
- Shopify delivery safeguards, including order/refund duplicate protection,
  were not relaxed.
- No Figma frame was modified.
- No email was sent to customers; the generated family remains previewed and
  persisted only.
