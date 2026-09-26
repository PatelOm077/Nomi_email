# Onboarding and Brand Studio system

Read this with `NOMI_CONTEXT.md`, `BRAND_STUDIO.md`, and the newest relevant
entries in `DECISIONS.md` before changing onboarding, Brand Studio, lifecycle
recipes, or the Templates handoff.

## What it is for

Brand Studio creates a merchant-specific email identity from public storefront
and Shopify product evidence. It does not select a reusable Gauge or Denizen
theme. Those are quality references only; the approved result must be specific
to the merchant's voice, palette, layout rhythm, image treatment, and products.

It ends by saving one approved Brand System, 13 coordinated free-form creative
briefs, and 13 complete Claude-authored email documents. Templates displays the
validated documents directly. It does not send any email as part of onboarding.

## Current implemented flow (source of truth)

The route is `app/routes/app.brand-studio.tsx`. The user-visible rail always
has six stages:

1. **Scan** — `welcome`: load Shopify evidence and start the Sol analysis.
2. **Snapshot** — `snapshot`: show the concise summary and positioning with
   evidence; the merchant may edit either statement.
3. **Create** — `creating`: a real pending state while three creative directions
   are generated.
4. **Choose** — `directions`: select one of exactly three different directions.
5. **Build** — `confirm`: optionally add one concise refinement, then approve.
6. **Ready** — `complete`: review the saved Brand System and open Templates.

`Snapshot → Create` is deliberately direct. The previous separate **Brand
Intent** screen (two questions and “Decide for me”) was removed in the latest
pinned onboarding work. Do not reintroduce it unless the merchant explicitly
asks for that product change. For now, the stored snapshot suggestions become
the `audience` and `feeling` inputs to direction generation.

The progress line during Create is tied to the actual pending generation state:
it advances linearly over roughly 5.2 seconds toward 99%, then completes after
navigation. It is not a fake instant loader. Replay restarts at Scan but reads
the already-saved snapshot, directions, Brand System, and recipes; it performs
no model call and spends no more budget.

## Evidence, models, and budget

`app/brand-studio/shopify-evidence.server.ts` reads the shop name, primary
domain, up to 12 recently updated products, product metadata, product images,
and Online Store URLs. It fetches only public storefront HTML, strips markup,
limits text, and never uses secrets or customer/order PII as brand evidence.

The model split is deliberate:

| Stage | Owner | Output |
| --- | --- | --- |
| Store analysis | GPT-5.6 Sol, medium reasoning | Structured Brand Snapshot with evidence, audience suggestion, and feeling suggestion |
| Directions | Claude Sonnet 5, high effort + strict structured output | Exactly three creative directions |
| Approval/build | Claude Sonnet 5, high effort + strict structured output | One Brand System and 13 open creative briefs with exact real product IDs |
| Final art direction | Claude Sonnet 5, five flow-sized high-effort passes | Thirteen complete responsive email documents with awareness of the whole family plan |
| Family critique | Claude Sonnet 5, high effort | Cross-family repetition review and up to three targeted structural regenerations |
| Validation | Nomi code | Asset/link/brand/email-safety proof plus finished-HTML structural diversity checks |

The hard setup ceiling is **USD $3.00**. It is server-enforced in
`app/brand-studio/budget.server.ts` using provider token usage recorded on the
profile. Never make a new paid call before reserving its stage budget. Sol calls
use `store: false`. The final 13-email Sonnet call must use the Anthropic
streaming API; the SDK rejects the long structured response in the non-streaming
path before it reaches the model.

## What is stored

`BrandStudioProfile` in `prisma/schema.prisma` is the durable per-shop record.
It stores status, snapshot, selected audience/feeling, three directions,
selected direction, refinement, approved Brand System, 13 recipes, validated
rendered emails, provider token counts, estimated cost, and completion time.
JSON values are parsed and validated with Zod schemas in
`app/brand-studio/types.ts`; never trust stored JSON blindly.

The profile also stores an evidence fingerprint, the fingerprint used for the
completed generation, and the last refresh time. The two fingerprints must
match before Templates or live delivery may use the generated identity.
Profiles created before this contract are deliberately marked unverified.

## Rescan and rebuild

The Ready screen provides `Rescan store & rebuild`. Nomi reads Shopify and the
public storefront again for shop name, products, published URLs and imagery,
logo, theme colors, typography cues, button shape, and theme checksum. Merchant
edits remain a correction layer; Shopify/storefront evidence is the default.
When evidence changed or predates verification, Nomi creates a fresh Snapshot,
clears downstream generated artifacts, resets only the active-build budget,
and requires confirmation and a complete A1 rebuild. Historical cumulative
cost remains recorded. Nothing is activated or sent by the rescan action.

The exact lifecycle IDs are fixed:

`welcome-1..3`, `interest-1..2`, `cart-1..3`, `thank-you`,
`review-request`, and `winback-1..3`.

They map to the five lifecycle flows in
`app/dashboard/lifecycle-flow-catalog.ts`. Do not alter an ID or add a recipe
without updating the catalog, schemas, templates/flow UI, tests, and any
delivery strategy together.

## Compilation and Templates handoff

### Current product presentation

The controlled Lumen Brand System and lifecycle copy remain the presentation
direction in the dashboard and Flow Editor, but their product titles, prices,
links, and featured photography come from every active product in the connected
Shopify catalogue. The catalogue is cursor-paginated and briefly cached for
navigation. Local files in `public/template-looks/` are fixture/test assets,
not the authenticated merchant catalogue. Brand Studio and
`/app/additional?brand=selected` continue to use confirmed, persisted Shopify
evidence and the approved Brand System.

Claude authors the final responsive documents in five flow-sized passes. Every
pass receives all 13 creative briefs, not a list of permitted layouts. A final
Claude critic then reviews the complete family together and can request up to
three targeted structural regenerations. Nomi accepts a document only when its
imagery and destinations come from approved store evidence and its HTML,
contrast, mobile behavior, brand foundation, copy, and cross-family structure
pass the A1 proof. Missing output fails the build; there is no creative fallback
compiler. The selected brand handoff is `/app/additional?brand=selected`.

## Change checklist

- Preserve the six-stage rail and the direct Snapshot → Create transition.
- Keep only three directions; ensure they differ beyond colour.
- Use real evidence and real product assets without forced image cropping.
- Retain the replay guarantee: saved data only, no spend, no replacement of the
  approved Brand System.
- Preserve progress across refresh/device using `BrandStudioProfile`.
- No sending, activation, audience, timing, or offer change during setup.
- For UI changes, complete the Chrome checks at 1280px, 768px, and 375px and
  save screenshots under `screenshots/` per `AGENTS.md`.

## Important current boundary

Brand Studio produces the durable brand-aware preview data. The webhook worker
loads the current fingerprint-matched Brand System and closest lifecycle
creative brief as authoritative identity while current Shopify event facts
remain authoritative. See `docs/email-system.md` before changing that boundary.
