# Brand Studio single-email regenerate + Edit menu — handoff

Last updated: 2026-09-22

## 2026-09-22 update: subject line and preview text editor

The Flow Editor's `Edit Subject Line & Preview Text` menu item is active for
every approved Brand Studio email. It opens a focused inbox-details editor
with a live inbox-row preview, explicit character counts, keyboard dismissal,
and responsive desktop/mobile presentation.

- New action-only route: `app/routes/app.brand-studio.metadata.tsx`.
- A save updates only the selected recipe's `subject` and `preheader` fields.
  It does not call AI and does not mutate `renderedEmails`, the email body,
  layout, seams, brand system, or evidence fingerprints.
- The server requires a current approved 13-email family, trims both values,
  keeps subjects to the existing 64-character inbox-quality limit, keeps
  preview text to 140 characters, rejects identical subject/preview copy, and
  prevents duplicate subjects within the family.
- A successful save is applied to the Flow Editor immediately, so the Subject
  and Preview rows update without depending on a loader revalidation or cache.
- Regression coverage proves rejected edits do not persist and successful
  edits preserve all 12 sibling recipes plus every rendered HTML document.

## 2026-09-22 update: full-family regenerate no longer depends on evidence changes

Brand Studio's Ready screen now has a dedicated `Regenerate all 13 emails`
action. It is separate from `Rescan store evidence`: an unchanged logo,
palette, catalogue, theme, or brand name no longer turns a requested rebuild
into a no-op.

- New action-only route: `app/routes/app.brand-studio.regenerate-all.tsx`.
  Like the single-email route, it starts a background job and is polled by the
  UI, so five flow-sized Sonnet passes plus the family critique do not sit
  behind one tunnel-sensitive request.
- The approved evidence, Brand System, direction, and 13 lifecycle recipes are
  reused. Only `renderedEmails` is replaced, and only after all 13 new documents
  pass their individual audits plus the family-wide diversity gate. The current
  approved family remains intact on any failure.
- `generateCreativeEmailFamilyWithSonnet` gained `regenerateAll`. It forces
  every recipe to be pending and sends each current HTML document back only as
  a negative reference, with an explicit instruction to change the silhouette,
  section order/rhythm, image role, headline treatment, CTA relationship, and
  footer treatment rather than cosmetically reskinning the old layout.
- Because all 13 documents are authored through the current shared prompt,
  the regenerated family receives the current `eyebrow`, `headline`, `body`,
  `cta-label`, `footer`, logo, image, and product seam markers wherever those
  elements exist. This is the supported upgrade path for stored emails that
  predate eyebrow/footer editing.
- The Ready screen reports completed flows, success, and errors through an
  `aria-live` status. `Rescan store evidence` remains available as a quieter
  secondary action for real store changes.
- Tests cover the negative-reference prompt contract and an unchanged-evidence
  13-email replacement. Chrome verification is recorded in `DESIGN_REVIEW.md`
  at desktop, tablet, and mobile widths.

## 2026-09-22 update (later session): seam editor gained eyebrow/footer/CTA-link
## editing, and the A1 audit was removed from seam saves per merchant decision

This session picked up exactly where the entry below ("Merchant decision, not
yet implemented") left off, plus extended the seam set. All of it lives in
`app/brand-studio/seam-editor.server.ts` and `app/routes/app.brand-studio_.edit.tsx`
unless noted otherwise.

1. **Two new text seams: `eyebrow` and `footer`.** `TEXT_SEAM_IDS` in
   `seam-editor.server.ts` is now `["eyebrow", "headline", "body", "cta-label",
   "footer"]`. `SEAM_TAGGING_INSTRUCTION` in `ai.server.ts` (shared verbatim
   across initial generation, repair, and family-revision prompts) now
   instructs Claude to wrap the eyebrow/kicker line and the footer/compliance
   copy the same way it already wrapped headline/body/cta-label.
   **Important caveat:** these two seams only appear on emails generated or
   regenerated *after* this change — an already-stored email's HTML simply
   has no `data-nomi-seam="eyebrow"` marker to find, so eyebrow/footer stay
   uneditable in the seam editor until that email goes through "Regenerate
   email" (or a fresh Brand Studio build). There is no retrofit for existing
   HTML; retagging old markup heuristically was judged too fragile.
2. **CTA destination URL is now editable**, and — unlike eyebrow/footer —
   this works retroactively on every already-stored email, no regeneration
   needed. `findSeams` locates the CTA's enclosing `<a>` via
   `el.closest("a")` (works whether the `data-nomi-seam="cta-label"` marker
   sits on the `<a>` itself or on an inner label span) and reads its `href`
   directly off the live HTML, so no new prompt marker was required.
   `applyTextSeamEdit` gained an optional 4th `href` param that updates that
   same anchor. The seam editor's text panel shows a "Destination URL" field
   for the CTA seam only, validated server-side (`https://` only, blank
   means "leave the current link alone").
3. **The A1 (and every other) save-time safety audit was removed from seam
   saves**, per the merchant decision already recorded below — implemented,
   not just decided, as of this session. `validateSeamEditedHtml` no longer
   calls `validateCreativeEmail`/`auditCompiledEmail`; it's a passthrough
   now. The ~60 lines of evidence/recipe-override plumbing in
   `app.brand-studio_.edit.tsx`'s `save-image` action branch (the
   `originalProductId`/`effectiveProductId`/`validationEvidence` dance) are
   gone — they only existed to keep that audit from false-flagging a
   deliberate product-photo swap. A seam save is now just: apply the edit,
   write it to the DB. Confirmed live against `winback-1` (the exact email
   from the reported bug): swapping the Loam slot's product photo, which
   previously failed with `"winback-1 failed email safety: An A1
   product-led email needs the requested real, public product imagery."`,
   now saves cleanly.
4. **Two related bugs fixed in the same pass, found while testing the
   above:**
   - The seam editor's image Upload tab never handled Shopify's
     `processing: true` response (the CDN hasn't finished when
     `fileCreate` returns) — no polling, so a slower upload just showed
     nothing: no thumbnail, no error, no way forward. Ported the same
     poll-with-timeout pattern `app/routes/app.template-editor.tsx`'s
     `ImageEditor`/`LogoEditor` already use.
   - Swapping in a Shopify-file/Products/Upload photo always reused the
     *original* seam's width/height instead of the new photo's real
     dimensions — a swap to a differently-shaped image would render
     stretched in the actual sent email. `pending` now carries the picked
     asset's real width/height (added `imageWidth`/`imageHeight` to the
     loader's `CatalogProduct` type for the Products tab) and falls back to
     the seam's existing size only when the new source has none.
5. **Navigation continuity fixes**, unrelated to seams but reported in the
   same session: Brand Studio's "Review my emails" link went to
   `/app/additional?brand=selected` (the old Templates gallery) instead of
   the Flow Editor; now `/app/flow-editor`. The seam editor's "← Back" link
   went to `/app`, which — because `app._index.tsx` renders a different
   (onboarding/home) view unless the pathname is `/app/flow-editor` or
   `?view=flows` is set — landed on the wrong page instead of back on the
   Flow Editor; now also `/app/flow-editor`.
6. Tests: `app/email-engine/seam-editor.test.ts` updated — new coverage for
   eyebrow/footer seam discovery and editing, CTA href read/write in both
   marker placements, and a passthrough test replacing the old
   audit-integration tests (which tested behavior that no longer exists).
   140 → still all passing; `npm run typecheck` and `npm run build` clean.

**Not done in this session:** existing already-generated emails do not
retroactively gain eyebrow/footer seams — only regeneration grants them (see
point 1). If you want the whole 13-email family to have eyebrow/footer
seams available, the mechanical path is "Regenerate email" per email (or a
full Brand Studio rebuild), not a code change.

## 2026-09-22 update: Feature 2 (seam editor) has shipped — and it exposed a real A1 audit trap

Everything under "Feature 2 (not started): tagged editable seams" below is
**out of date** — that feature shipped in a session between 2026-09-20 and
this one. It's real and live at `app/routes/app.brand-studio_.edit.tsx`
(note the trailing underscore — not the plain `app.brand-studio.edit.tsx`
the original plan named) + `app/brand-studio/seam-editor.server.ts`
(`findSeams`, `applyTextSeamEdit`, `applyImageSeamEdit`,
`validateSeamEditedHtml`, `annotateSeamKeys`), reachable from the dashboard's
"Edit email template" `Edit ▾` menu item via
`/app/brand-studio/edit?recipeId=<id>`. It has its own picker UI (Shopify
files / Products / Upload tabs, shared `.v9-asset-list` CSS with
`app.template-editor.tsx`) and its own save-time safety re-check
(`validateSeamEditedHtml` → `validateCreativeEmail` → `auditCompiledEmail`).
The plan's "text seams only for v1" note was exceeded — image/logo/product
photo seams are live too, not deferred.

**What this session actually did, prompted by a real merchant report ("image
swapping from Shopify files/Upload doesn't work, only Products does, and the
picker photos look cut off"):**

1. **Root-caused the save failure.** The merchant's premise ("Products tab
   works, Shopify files/Upload don't") was wrong — verified live that
   swapping via **Products** fails identically. The real cause: every seam
   save re-runs `auditCompiledEmail` over the **entire** email, not just the
   touched seam. Four of the shop's 13 stored `renderedEmails` already had a
   pre-existing generation-time defect — one product's `<img>` slot pointing
   to a *different* product's photo (e.g. Loam's seam showed Peat's photo).
   That's an A1-rule violation (`a1-product-image`: "An A1 product-led email
   needs the requested real, public product imagery") baked into the stored
   HTML itself, unrelated to whatever the merchant was actually editing — so
   *any* save on those four emails failed with the same generic error,
   regardless of tab or which seam was touched. Confirmed by direct DB
   inspection (see debugging note below), not just by reading the code.
   Affected recipes found this session: `winback-1`, `winback-2`,
   `welcome-3`, `cart-2`. The other 9 were clean.
2. **Fixed the picker crop bug** — `app/styles/v8-email-editor.css`,
   `.v9-asset-list img`: `object-fit: cover` → `object-fit: contain`. The
   fixed 56px-tall tiles were cropping every thumbnail (Shopify files,
   Products, Upload) to fill the box regardless of aspect ratio, which is
   exactly the thing `CLAUDE.md`/`AGENTS.md` say never to do to product
   imagery. Now every thumbnail shows in full, letterboxed on `#e8edea`.
   Verified live: previously-cropped banner/text images (e.g. one showing
   upside-down "KIEN" text) now render whole.
3. **Regenerated `winback-1`** using the existing single-email "Regenerate
   email" feature documented below — no code change needed for this part,
   the mechanism already worked correctly. Verified via direct DB query that
   all four of its product photos now match their evidence entries.
   **`winback-2`, `welcome-3`, and `cart-2` were *not* regenerated this
   session** — re-checked directly against the DB while writing this update
   and all three still carry the same defect (`winback-2`: Canopy,
   `welcome-3`: Rime, `cart-2`: Rind).
4. **Merchant decision, not yet implemented:** after walking through the
   tradeoff (the audit is a real guardrail against fake/mismatched product
   imagery reaching a live email, but it re-checks the whole document on
   every save and gives a generic error that doesn't name the broken
   product), the merchant chose to **remove the save-time safety audit from
   the seam editor entirely** rather than scope it down to just the touched
   seam. **This was decided but not coded before the session ended** — next
   session should either implement it (drop the `validateCreativeEmail` call
   out of `validateSeamEditedHtml` in `seam-editor.server.ts`, and the
   now-dead evidence/recipe-override plumbing in
   `app.brand-studio_.edit.tsx`'s action around the `save-image` intent that
   only existed to satisfy that audit) or re-confirm the merchant still
   wants full removal rather than the narrower per-seam-only check that was
   also offered.

**Debugging note — Claude-in-Chrome cannot see inside this app's own
iframe.** The embedded app runs cross-origin (the dev tunnel domain) inside
`admin.shopify.com`. `read_page`/`find`/`read_console_messages`/
`read_network_requests` only ever see the outer Shopify admin frame — they
report zero matches for anything inside the Nomi app itself, even though
pixel `computer` clicks/screenshots work fine (synthetic input isn't
frame-scoped the same way). Don't trust "no network requests found" or "text
not found in accessibility tree" as evidence something isn't happening
inside the app — it may just mean the tooling can't see in there. To get
ground truth this session, we queried the dev SQLite DB directly instead:
```
DATABASE_URL="file:C:/Users/ombar/Desktop/nomi/prisma/dev.sqlite" node -e "..."
```
using `@prisma/client` directly (the schema's datasource url is relative to
`prisma/schema.prisma`, so a bare `file:dev.sqlite` from the repo root
fails with "Unable to open the database file" — pass an absolute path).
This is also written up as a standalone memory (`chrome_iframe_debugging_limits`).

## 2026-09-20 update: regenerate no longer blocks on unrelated siblings

The original version of this feature (below) refused to regenerate a single
email if *any other* stored email in the family failed today's safety audit,
with the message `"X" no longer passes today's safety checks ... Rebuild the
full family from Brand Studio instead.` In practice this made the button
useless the moment any one of the 13 stored emails drifted out of spec (a
common, unrelated occurrence) — the merchant just wanted the one email they
clicked "Regenerate" on to change, not a lecture about a different email.

Fixed by making the regenerate path genuinely single-email end to end:
- `generateCreativeEmailFamilyWithSonnet` (`app/brand-studio/ai.server.ts`)
  gained `regenerateOnlyId`. When set, every sibling in `existingRendered` is
  trusted **verbatim** — no re-validation, no repair, no regeneration — and
  only the target id is ever sent to Claude. The target's previous HTML is
  passed back as `previousHtml` with a `regenerateInstruction` telling Claude
  to produce a materially different composition, so repeated clicks don't
  just re-roll a near-identical layout.
- `app/routes/app.brand-studio.regenerate.tsx` dropped the pre-flight
  "stale sibling" scan entirely (it duplicated the same safety audit against
  all 12 other recipes before doing any work) and now passes the full
  `approved.renderedEmails` map straight through with `regenerateOnlyId`.
- The post-generation quality gate now audits **only the regenerated email**
  (`auditCompiledEmail` on the one target) instead of also running
  `auditEmailFamily` across all 13 — the family-wide audit compares emails
  against each other for variety/repetition, which is correct for a full
  build's checkpoint/resume path but was wrongly failing a single-email
  regenerate over an untouched sibling's pre-existing issues.
- Net effect: clicking regenerate on one email now only ever touches that
  one `renderedEmails` key, regardless of what shape the other 12 are in,
  and the AI is explicitly nudged to vary from what's there today.

This is the durable context file for the "fix one Brand Studio email without
rebuilding the whole family" work. Read this file before continuing this
work in a new chat. Also follow `CLAUDE.md`, `SPEC.md`, `DECISIONS.md`,
`AGENTS.md`, and `EDITOR.md` (a separate, unrelated handoff for the
drag-and-drop block editor on the fixed Looks — do not confuse the two).

## The problem this solves

Brand Studio generates 13 bespoke, freeform HTML lifecycle emails per shop
via `generateCreativeEmailFamilyWithSonnet` (`app/brand-studio/ai.server.ts`),
stored as raw HTML strings in `BrandStudioProfile.renderedEmails`. Before this
work, the only way to change anything was a "refinement note" that reruns the
**whole 13-email family** (`intent === "finalize"` in
`app/routes/app.brand-studio.tsx`). A merchant who disliked one email had to
re-roll all 13 and hope the rest didn't get worse.

This session shipped **Feature 1: per-email regenerate**, plus a merchant-facing
"Edit" menu to trigger it. **Feature 2 ("tagged editable seams" — hand-editing
specific fields inside the real bespoke HTML without an AI call) was scoped
and planned but not started** — see "Feature 2 (not started)" below.

## What shipped this session

### 1. Prerequisite fix — `app/brand-studio/approved-family.ts`

`generateCreativeEmailFamilyWithSonnet` needs a full `direction: CreativeDirection`
object, but `getApprovedBrandStudioFamily` never resolved one. Fixed:
- `BrandStudioFamilyRecord` now includes `directions: string; selectedDirectionId: string | null`.
- `ApprovedBrandStudioFamily` now includes `direction: CreativeDirection`.
- `getApprovedBrandStudioFamily` parses `profile.directions`, finds the entry
  matching `brandSystem.directionId`, fails closed if missing.
- New exported helper `applyEvidencePalette(direction, evidence)` — the
  palette-override logic that used to be duplicated inline in
  `app.brand-studio.tsx`'s finalize action; now shared.
- Callers' Prisma `select` clauses updated to include `directions`/
  `selectedDirectionId`: `app/routes/app._index.tsx`, `app/routes/app.additional.tsx`.
  (`app/routes/app.brand-studio.tsx` already selects the full row, no change needed there.)
- Test fixtures updated: `app/dashboard/lumen-demo.ts` gained
  `LUMEN_DEMO_DIRECTION`; `app/email-engine/approved-brand-studio-family.test.ts`
  and `app/email-delivery/process-jobs.server.test.ts` updated to include a
  matching `directions` array (must be **exactly 3 entries** —
  `creativeDirectionsSchema` enforces `.length(3)`, a real gotcha that broke
  tests the first time).

### 2. `skipCritique` — `app/brand-studio/ai.server.ts`

`generateCreativeEmailFamilyWithSonnet` gained an optional `skipCritique?: boolean`.
After the per-flow generation loop, the function normally runs a family-wide
critique + revision pass that sends **all** rendered emails to Claude and can
silently rewrite up to 3 emails it judges too similar — fine for a full build,
wrong for a scoped single-email regenerate, which must guarantee the other 12
stay untouched. The whole critique/revision block is now wrapped in
`if (!input.skipCritique) { ... }`. A single-email regenerate always passes
`skipCritique: true`.

### 3. New route — `app/routes/app.brand-studio.regenerate.tsx`

Action-only (no loader, no default export), POST-only, fetcher-driven (never
redirects — this matters, see below). Reads `recipeId` (+ optional
`refinement`) from form data, validates the family is approved, calls
`generateCreativeEmailFamilyWithSonnet` with `existingRendered` = all
`renderedEmails` minus the target key and `skipCritique: true`, defensively
diffs the result (rejects if the target didn't change or if *any other* key
changed — belt-and-suspenders against the generation loop's own pre-validation
silently regenerating a stale sibling), runs `auditCompiledEmail`/
`auditEmailFamily` as a quality gate, and on success merges **only the one
`renderedEmails` key** back into the DB (never touches `brandSystem`,
`lifecycleRecipes`, `status`, or fingerprints — `getApprovedBrandStudioFamily`
doesn't hash rendered content, so the family stays "approved").

Returns `data({ ok, recipeId, html? , error? })` — react-router's `data()`
helper, which is **not a plain `Response`**. In tests, `action(...)` returns a
`DataWithResponseInit` object: read `response.data` and `response.init?.status`,
not `response.json()`/`response.status`. This bit the test suite once
(TypeScript couldn't narrow the discriminated union through sequential
`expect()` calls either — see `assertOk`/`assertError` type-guard helpers at
the top of `app/email-engine/brand-studio-regenerate-action.test.ts`).

Why a **new route** instead of a new `intent` on `app.brand-studio.tsx`'s
action: every existing branch there ends in a full-page `redirect` (it's
built around the multi-step wizard). A dashboard-row action must never
navigate away, so it needed its own fetcher-shaped, always-JSON-return route.

### 4. Dashboard UI — `app/routes/app._index.tsx`

**Where the "Edit" control lives — this went through several iterations
before landing:**
- ~~Per-row "Rebuild" button~~ → ~~per-row "Edit ▾" dropdown~~ → **removed
  entirely from rows** per explicit merchant/user direction. Rows now show
  only the state pill (`BRAND SYSTEM` / `BUILD REQUIRED`); clicking a row
  still just selects it for preview (`setSelectedTemplateId`).
- The **only** entry point is now in the preview panel header
  (`.nomi-flow-proof-topline`, the `"{name} — preview"` bar), where it
  **replaced the old "Review system" link entirely** (not alongside it).

**`EditActionsMenu` component** (defined above `RuleAddedIcon` in this file):
a self-contained dropdown — trigger button + absolutely-positioned panel,
click-outside-to-close via a `mousedown` listener on `document`, mirroring
the existing `OverflowMenu` pattern in `app/routes/app.template-editor.tsx`.
Four items:
1. **"Edit Subject Line & Preview Text"** — disabled, `<small>Soon</small>` badge. Not built.
2. **"Edit email template"** — a real `<Link to="/app/additional?brand=selected">`.
   This is the *old* "Review system" destination, just moved under the menu.
3. **"Regenerate email"** — the actually-wired action. Calls `requestRegenerate(recipeId)`,
   which submits to `/app/brand-studio/regenerate` via `regenerateFetcher`.
4. **"Send Test Email"** — disabled, `<small>Soon</small>` badge. Not built.

**Important naming decision:** the trigger button uses a **new** class
(`.nomi-edit-menu-trigger`), deliberately *not* the old `.nomi-flow-generate`
class. Reason: `app/styles/nomi.css` has a pre-existing rule —
```css
.nomi-flow-page-reference .nomi-flow-generate { display: none; }
```
— and `<main className="nomi-flow-page nomi-flow-page-reference">` wraps the
*entire* Flow Editor page (`app._index.tsx:433`). This rule predates this
session's work and silently hid the original "Rebuild"/"Build" button too
(it was never actually visible before this session, regardless of what the
route logic did — this was a real, pre-existing bug, not something this
session introduced). Rather than touch that rule (unclear if something else
relies on it), the new trigger just uses a fresh class name that isn't
targeted by it. **If you add any new button inside the Flow Editor page and
it mysteriously doesn't render, check for this rule first.**

State added near the top of the component: `previewMenuOpen` (bool),
`requestRegenerate(recipeId)` helper, plus the existing `regenerateFetcher`/
`submittingRecipeId`/`isRegenerating`/`regenerateErrorId`/`regenerateError`
derived from it. The inline error (`.nomi-flow-generate-error`) renders right
below the preview panel's topline when `regenerateErrorId === selectedTemplate.id`.

### 5. CSS — `app/styles/nomi.css`

New rules: `.nomi-flow-proof-actions`, `.nomi-edit-menu*` (trigger, list,
items, the `Soon` badge, a small fade/slide-in keyframe). Kept to the existing
token system (`--nomi-ink`, `--nomi-cyan*`, `--nomi-radius-*`, `--nomi-font-ui`) —
sharp/minimal radii throughout, not rounded pills, to match the app's
existing "calm, editorial" brand voice.

## Known-fixed bugs from this session (read before assuming something is broken)

1. **CSS changes not showing up in dev, even after a hard reload / full
   process restart.** `app/routes/app.tsx` hardcodes a cache-busting query
   string on the `nomi.css` link tag:
   ```ts
   { rel: "stylesheet", href: `${nomiStyles}?v=brand-studio-20260916-10` },
   ```
   This string is **static** — it does not update automatically when
   `nomi.css` changes, unlike Vite's own `?url` hash. Something upstream
   (browser cache and/or the dev tunnel/CDN) was aggressively caching this
   exact URL indefinitely. Bumped to `?v=flow-editor-edit-menu-20260919-1`
   this session. **If you edit `nomi.css` and don't see the change reflected,
   bump this string again** (and check `app/routes/brand-emails-review.tsx`
   and `app/routes/brand-studio-review.tsx`, which have their own independent
   hardcoded version strings on the same file — last touched 2026-09-15/16,
   not updated this session since they weren't in the affected code path).
   Someone should eventually replace this whole pattern with something that
   can't go stale (e.g. derive the query param from a build/content hash),
   but that wasn't in scope here.

2. **Dev server appeared to be running but served stale code.** A leftover
   `shopify app dev` process (started earlier, possibly crashed/zombied
   without dying) kept responding on port 3000 with pre-session code. Fixed
   by killing it via the exact recovery procedure already documented in
   `AGENTS.md`'s Troubleshooting section, then restarting `npm run dev`.

3. **Restarting via plain `npm run dev` doesn't necessarily use the project's
   normal tunnel.** This project's real dev setup runs
   `shopify app dev --tunnel-url=https://dev.trynomi.email:3000` — a **fixed,
   persistent** Cloudflare tunnel domain bound specifically to **port 3000**.
   A plain `npm run dev` restart (no `--tunnel-url` flag) falls back to
   spinning up a **new, ephemeral** `trycloudflare.com` quick tunnel instead,
   which is a different, unstable URL each time and was flaky (returned edge
   404s during this session, possibly a quick-tunnel propagation/rate-limit
   issue). **Port 3000 must be free** for the real fixed-tunnel dev command
   to bind correctly — watch for unrelated processes on this machine (seen
   this session: a stray `.codex-tools` node process grabbing port 3000 in
   the gap right after killing the old dev server). If `dev.trynomi.email`
   stops responding, check what's actually listening on port 3000 before
   assuming the app is broken.

## A real, not-yet-fixed risk (found during live verification)

**A single-email regenerate can take longer than the dev tunnel's ~100-second
timeout.** Verified live against the real Lumen demo store: clicking
"Regenerate email" triggered a real Sonnet call that took **over 100 seconds**
to finish. The Cloudflare free-tier tunnel returned a client-facing
**524 "A timeout occurred"** error to the browser well before the server
finished — but the server kept working in the background regardless of the
disconnected client, and the regenerate **did complete and persist correctly**
(verified directly against `prisma/dev.sqlite`: `currentBuildCostMicros` went
from 0 to 107,814 micros, and `renderedEmails["welcome-1"]` contained a fresh,
valid 4.3KB HTML document).

This means: in production, a merchant clicking "Regenerate email" could see a
network error / stuck spinner in their browser even though the email actually
gets rebuilt successfully a bit later. The UI has no way to recover from that
today (no polling, no "check back" messaging, no toast when it finishes if the
original request errored out client-side). **Worth fixing before this ships**
— options include: a background job + polling/webhook pattern instead of a
synchronous request, a paid Cloudflare tunnel plan with a longer timeout for
local dev (doesn't fix production), or at minimum an optimistic "this can take
a minute, we'll let you know" message plus a way to re-check status without
losing the fact that a regenerate is already in flight.

## Fixed in a later session: stale preview after regenerate

**Preview panel showed stale HTML after a successful regenerate**, even after
a full page reload. Root-caused and fixed — it was a real application bug,
not (only) a caching artifact:

`app/routes/app._index.tsx`'s preview panel rendered
`brand.previewHtmlById[template.id]`, which comes **only** from the route
`loader` (`useLoaderData`). The regenerate action lives on a separate
fetcher-driven route (`app/routes/app.brand-studio.regenerate.tsx`) and
never touches that state directly — after a successful regenerate, the UI
was depending entirely on React Router's automatic loader revalidation to
re-fetch `app._index`'s loader and pick up the new `renderedEmails` value.
That revalidation is a plain GET request that passes through whatever sits
in front of this app (the dev tunnel documented in bug #1/#3 above, and in
production whatever CDN/proxy fronts it, plus ordinary browser caching) —
nothing in the app ever told any of those layers not to cache it. So even
though the DB write was correct, the merchant could see stale HTML
indefinitely if that GET got served from a cache instead of hitting the
loader again.

Two changes fixed it:
1. **`app/routes/app._index.tsx`** — the preview panel no longer depends
   solely on loader revalidation. A new `regeneratedHtmlById` piece of state
   is populated straight from `regenerateFetcher.data.html` (the action's
   own response, from the same request that already got a real answer back)
   the moment a regenerate succeeds, and takes priority over
   `brand.previewHtmlById` when building `referenceTemplates`. This makes
   the preview correct regardless of what any intermediate cache does with
   the follow-up revalidation GET.
2. **`app/routes/app._index.tsx`**'s `headers` export now sets
   `Cache-Control: no-store` on this route's responses — defense in depth,
   so the loader's own GET (used for revalidation and full reloads) isn't
   eligible for caching by a tunnel/CDN/browser in the first place.

If a similar "the DB is right but the UI won't show it" symptom shows up
elsewhere, check whether that surface is also relying purely on loader
revalidation after a fetcher-driven mutation, rather than using the
mutation's own response.

## Verification done

- `npm run typecheck`, `npx vitest run` (125 tests, all passing — includes 9
  new/updated tests across `brand-studio-ai.test.ts`,
  `brand-studio-regenerate-action.test.ts` (new file, 4 tests),
  `approved-brand-studio-family.test.ts`, and a fixture fix in
  `process-jobs.server.test.ts`), and `npm run build` are all clean.
- Live-verified in Chrome against the real `nomi-mmkgcryy.myshopify.com` dev
  store: the Edit menu renders and opens correctly, "Edit email template"
  navigates to `/app/additional?brand=selected`, "Regenerate email" hit the
  real `$3` Brand Studio budget cap correctly on the first attempt (inline
  error, no navigation), and — after resetting the shop's
  `currentBuildCostMicros` counter to allow a real test call — a real
  regenerate completed successfully end-to-end (see risk section above for
  the timeout caveat encountered along the way).
- **Not done**: Chrome checks at 768px/375px breakpoints for the new Edit
  menu (only desktop/1280px+ was verified). `AGENTS.md`'s mandatory UI gate
  calls for this before calling any merchant-visible change fully done.

## Feature 2 (shipped — see the 2026-09-22 update at the top): tagged editable seams

**Status update: this shipped in a later session, and the 2026-09-22 section
at the top of this file documents real bugs found in the live feature.** The
plan below is kept for historical reference (it explains *why* things are
shaped the way they are) but treat anything phrased as future/undone here as
superseded by the top of this file.

Originally scoped and planned in detail before Feature 1 work began, with no
code written for it in that session. The idea: let a merchant hand-edit
specific safe fields (headline, body, CTA label, discount code) inside an
already-generated Brand Studio email's real HTML — no AI call — without
disturbing the surrounding bespoke layout. (Image/logo/product-photo seams
were meant to be a fast-follow beyond text-only — in the shipped version they
were not deferred; the picker UI described in the "not started" plan below is
live too.)

Key points from the plan, for whoever picks this up:
- Add `node-html-parser` as a new dependency (no DOM parser exists in this
  repo today; regex-splice mutation of arbitrary bespoke AI HTML was judged
  too fragile).
- Marker convention: `data-nomi-edit="headline|body|cta-label|discount-code"`
  for text-content seams, `data-nomi-edit-href`/`data-nomi-edit-src` for
  attribute seams (so one `<a>` can carry both a label and href marker
  without collision). **v1 scope should be text seams only** — defer
  image/href attribute seams (need an evidence-backed picker UI + carry real
  layout/aspect-ratio risk) to a fast-follow.
- Prompt changes needed in three places in `app/brand-studio/ai.server.ts`:
  initial generation (`requestFlowEmails`), the repair pass
  (`requestRepairs`), and the family-wide revision pass (`requestRevisions`)
  — all three can produce/touch final HTML, so all three need the marker
  instruction or regenerated/repaired emails will lose their seams.
- New file `app/brand-studio/seam-editor.server.ts`: `findSeams`,
  `applySeamEdit`, `validateAndPersistSeamEdit` (re-runs the same safety
  checks `validateCreativeEmail` already does — export it from `ai.server.ts`
  or add a thin wrapper, it's currently unexported).
- New route `app/routes/app.brand-studio.edit.tsx` — **not** grafted onto
  `app.additional.tsx`'s preview (that's a sandboxed `srcDoc` iframe with no
  `allow-scripts`/`allow-same-origin`, so the parent page can't attach
  click-to-select handlers inside it without loosening a sandbox around
  Claude-authored HTML) and **not** grafted onto `app.brand-studio.tsx` (a
  2000+ line sequential-redirect wizard, wrong shape for a persistent
  selection/right-rail UI). Render the tagged HTML same-DOM via
  `dangerouslySetInnerHTML` in a dedicated view instead, reusing the
  *interaction pattern* (not the data model) from `app.template-editor.tsx`'s
  `ContextualEditor`/`TextEditor`.
- Given the "Edit email template" menu item now exists and links out to
  `/app/additional?brand=selected`, **this would be the natural place to
  eventually swap that Link for a real seam-editor route** once it exists —
  it's already sitting in the menu, just not wired to anything real yet
  beyond that stand-in.

## Supporting files touched this session

- `app/brand-studio/approved-family.ts` — direction resolution + `applyEvidencePalette`
- `app/brand-studio/ai.server.ts` — `skipCritique`
- `app/routes/app.brand-studio.regenerate.tsx` — new route
- `app/routes/app._index.tsx` — `EditActionsMenu`, menu wiring, state
- `app/routes/app.tsx` — bumped the `nomi.css` cache-busting version string
- `app/styles/nomi.css` — new menu/action CSS
- `app/dashboard/lumen-demo.ts` — added `LUMEN_DEMO_DIRECTION`
- `app/email-engine/approved-brand-studio-family.test.ts`,
  `app/email-engine/brand-studio-ai.test.ts`,
  `app/email-engine/brand-studio-regenerate-action.test.ts` (new),
  `app/email-delivery/process-jobs.server.test.ts` — tests/fixtures

## Next milestone

1. Implement (or re-confirm) the merchant's decision from 2026-09-22: remove
   `validateSeamEditedHtml`'s call into `validateCreativeEmail`/
   `auditCompiledEmail` so seam-editor saves no longer re-audit the whole
   email — plus clean up the now-dead evidence/recipe-override plumbing in
   `app.brand-studio_.edit.tsx`'s `save-image` action branch that existed
   only to satisfy that audit.
2. Regenerate the three remaining broken emails found 2026-09-22
   (`winback-2`: Canopy, `welcome-3`: Rime, `cart-2`: Rind — `winback-1` is
   already fixed) via the existing single-email regenerate button, the same
   way `winback-1` was fixed.
3. Decide how to handle the >100s regenerate-timeout risk before this ships
   to a real merchant (see risk section above).
4. Pixel-verify the Edit menu at 768px/375px.
