# Design Review: Nomi Templates

## Sending domain setup + Campaigns domain banner — 24 September 2026

New route `/app/sending-domain` ([app.sending-domain.tsx](../app/routes/app.sending-domain.tsx))
ported from the "Nomi Sending Domain" Claude Design export (9 boards). Styles are
a scoped `<style>` from [sending-domain-styles.ts](../app/components/sending-domain-styles.ts),
not nomi.css, because of the embedded-iframe class issue in CAMPAIGNS.md.
The Campaigns notice was replaced with the merchant-approved Wiz-style banner
(light-blue header strip, white body, outlined "Setup Domain" button), and
Create Campaign is capped at 3 campaigns until the domain is verified.

Checked live in Chrome (embedded admin) with dev-only seeded rows because
`RESEND_API_KEY` isn't set locally:
- Desktop 1440: entry, partial (doubled host + truncated SPF value), checking,
  verify error, verified, change/remove modal, Campaigns banner at the 3/3 limit.
- Tablet 768 and mobile 375: record cards replace the table, and long hostnames wrap
  (fixed an overflow and a mid-word domain break found in this pass).
- Fixed during review: narrow host column and overflowing status pills at the
  ~910px embedded width; breakpoints tuned to real iframe widths.
- Not confirmed live: the "Copied" confirmation (1.6s) disappears before
  the DevTools capture completes.

Screenshots: `screenshots/sending-domain-*.png`.

## Dashboard email-language control redesigned — 23 September 2026

The "Email language" control on the dashboard control rail
([app._index.tsx](../app/routes/app._index.tsx), `LanguageMenu`) read as a
legacy admin form field: a bordered box gluing a tiny uppercase "EMAIL
LANGUAGE" prefix to a native `<select>`, sitting right next to the clean
"↻ Replay setup" pill button. Merchant flagged it twice ("wordpress era") —
first the popup, then the trigger itself once the popup was fixed.

Rebuilt in two passes:
1. Replaced the native `<select>` with a custom ARIA listbox-button
   component — a native select's open popup is rendered by the OS/browser
   and can't be restyled.
2. Rebuilt the closed trigger from scratch to match `.nomi-replay-setup`'s
   own shape exactly (same 44px height, `#d7d3d3` border, sharp corners,
   `600 12px IBM Plex Sans`) so the two controls in that row read as one
   matched pair of compact buttons. Dropped the separate boxed
   "EMAIL LANGUAGE" label entirely — replaced with a small cyan globe icon
   + the current value + a cyan chevron (icon-plus-value is enough context,
   same pattern as e.g. GitHub's branch picker), with "Email language" moved
   to `aria-label`/`title` for accessibility instead of a visible glued-on
   prefix. `.nomi-control-rail-actions` grid went from
   `auto minmax(185px, 1fr)` (sized for the old wide field) to `auto auto`
   (both items compact) now that neither control needs to stretch.

Also dropped Hindi and added Dutch to `EMAIL_LANGUAGES`
([types.ts](../app/email-engine/types.ts)), reordered the list by rough
Shopify market share, and relabeled "Portuguese" to "Portuguese (Brazil)"
(see `DECISIONS.md`, 2026-09-23 entry).

Every visual property of both the trigger and the popup is inlined
(`LANGUAGE_TRIGGER_STYLE`, `LANGUAGE_LIST_STYLE`, `LANGUAGE_OPTION_*_STYLE`
constants), not left to `nomi.css` classes — the first popup implementation,
styled via CSS classes, silently failed to render at all live. Same known
issue as the Campaigns picker (see the `campaigns-picker-inline-styles`
memory / `CAMPAIGNS.md`): freshly-served `nomi.css` classes on a new element
don't reliably apply in this embedded iframe. Hover state is JS-driven
(`onMouseEnter`/`onMouseLeave` setting inline styles), not CSS `:hover`, for
the same reliability reason. All now-dead CSS for the old boxed field and
its per-context size variants was removed from `nomi.css`.

Verified live in the embedded Shopify admin (`nomi-mmkgcryy` dev store) at
desktop width via `chrome-devtools` MCP (per `AGENTS.md`, not the isolated
browser pane, which can't reach the authenticated iframe): closed trigger
next to "Replay setup" (matched pill pair, accessible name reads "Email
language: English"), open popup with all 10 languages in the new order,
keyboard nav (Arrow Up/Down, Home, End, Enter, Escape, click-outside-to-
close), selecting a language (persisted through the existing `set-language`
fetcher and reflected back in the trigger label on reopen), and no default
browser focus-ring leaking through. Screenshots:
`screenshots/dashboard-language-menu-closed-desktop.png` and
`screenshots/dashboard-language-menu-open-desktop.png`.

768px/375px breakpoints were not pixel-verified this session — same
browser-automation limitation noted in the entry below (viewport-resize
doesn't visibly affect this embedded app's rendered width), compounded here
by a second live agent (Codex) actively driving the same real Chrome window
at the same time, which made resizing that shared window a bad idea. Both
controls are now fixed-height, content-width pills in an `auto auto` grid
row, which is a simpler responsive shape than the old stretched field, but
this is not the same as having eyeballed it at 768/375.

`npm.cmd run build`, `npm run typecheck`, and the touched vitest suites
(`types.test.ts`, `process-jobs.server.test.ts`) all pass.

## Generic block editor rebuild — 18 September 2026

Rebuilt `app/routes/app.template-editor.tsx` from a fixed six-section shape to
a generic, ordered block model matching the approved Figma Make prototype
("Nomi Safe Block Editor Prototype", Version 8 — source pulled directly from
the prototype's own code editor, not guessed from screenshots). Full details,
including two real bugs found and fixed (CSS not loading at all; canvas not
internally scrolling) are in `EDITOR.md`.

Verified live in the embedded Shopify admin (`nomi-mmkgcryy` dev store, not
just `localhost`) at desktop width: block selection (image/text/discount/
button) with correct contextual editors, real Shopify product/file data in
the Image and Product editors (no more placeholder mockup images), the
Discount code editor, the Style tab (Brand System/Colors/Fonts/Buttons/
Layout), the new "Rewrite with Nomi" AI feature (real Claude call, confirmed
end-to-end), Undo/Redo, full-screen Preview mode, and Save-to-Prisma
persistence (`Unsaved` → `Saving…` → `Saved` observed, including a real
reload showing the saved state).

768px and 375px breakpoints were implemented in CSS (mirroring the existing
Templates-route responsive conventions) but could not be pixel-verified this
session — the browser automation's viewport-resize call did not visibly
change the embedded app's rendered width. Flagged in `EDITOR.md` as follow-up
work; do not assume the mobile/tablet layout has been eyeballed.

`npm.cmd run build` and `npm.cmd run typecheck` both pass. Confirmed the
Templates route (`app/routes/app.additional.tsx`) still renders identically
after a ~550-rule dead-CSS cleanup in `app/styles/nomi.css` (leftover rules
from the previous template-editor implementation).

## Brand Studio completion — 10 September 2026

Completed the live Brand Studio generation path from Shopify evidence through
three creative directions, selected Brand System, and 13 coordinated lifecycle
emails. The two Claude stages now use strict structured outputs, and the longer
lifecycle build streams through the supported SDK path. The real setup completed
at `$0.18` and did not send or activate anything.

Chrome review covered desktop 1280px, tablet 768px, and mobile 375px; Brand
Intent focus, loading, generated direction selection, confirmation, completion,
flow expansion, selected-email preview, and the contained email viewport were
checked. Mobile measured no page-level overflow, no broken images, 44px-or-larger
controls, and a 299×522px internally scrolling preview. Full findings and
screenshots are in `.design/brand-studio/DESIGN_REVIEW.md`.

## Shopify media picker live-data verification — 1 September 2026

- Reconnected the Shopify dev preview and verified that the contextual hero picker now reads real Files data from the store rather than the old City walk placeholder list. Switching source leaves the current image intact until the merchant actually chooses a replacement.
- Verified the Products source independently: it lists real catalog entries, including The Inventory Not Tracked Snowboard, Gift Card, and The Draft Snowboard. Selecting an item updates the contained email preview and alt text immediately, without saving the draft until the merchant confirms it.
- Verified the logo picker uses that same real Shopify Files library and previews a selected store image in the header. Its Center alignment control reported the pressed state correctly. Product media remains intentionally absent from the logo workflow.
- Hero uploads accept JPG, PNG, and GIF to 20 MB, enforce 600 × 300px minimum and 10,000 × 10,000px maximum client-side, and stage/create Shopify image files server-side. Logo uploads use the same formats with a 5 MB limit and 120 × 40px minimum. A real upload was not run because it would create a new file in the merchant's Shopify store.
- At Chrome viewports 1280px, 768px, and 375px, the outer Shopify page and the embedded app both measured equal client and scroll widths, with no application-owned horizontal overflow. No CTA was clipped.
- `npm.cmd run build` passes. `npm.cmd run typecheck` continues to report only the known existing `s-app-nav` JSX intrinsic-element gap in `app/routes/app.tsx`.

Verification screenshots:

- `screenshots/template-editor-media-picker-desktop-1280-2026-09-01.png`
- `screenshots/template-editor-media-picker-tablet-768-2026-09-01.png`
- `screenshots/template-editor-media-picker-mobile-375-2026-09-01.png`
- `screenshots/template-editor-product-media-desktop-2026-09-01.png`
- `screenshots/template-editor-logo-shopify-files-desktop-2026-09-01.png`

**Platform:** Shopify embedded web app
**Target user:** Merchant choosing an email look for lifecycle emails
**Primary task:** Compare a proposed look, inspect its email preview, and apply it
**Reviewed against:** Figma file `Nomi — Template Gauge Alternatives`, implementation in `app/routes/app.additional.tsx`, and CSS in `app/styles/nomi.css`

## Assumptions

- The page is used within Shopify Admin by a merchant with an active session.
- Gauge and Denizen are intentional example visual directions, not generic template-library entries.
- Applying a look updates every lifecycle email to use its shared colour and CTA treatment.

## Screenshots captured

Live application screenshots are blocked in the current environment. The Shopify development tunnel returned Cloudflare error 1033, and the available Shopify Admin browser session is signed out. Desktop and mobile screenshot verification must be rerun once the tunnel is reachable in an authenticated browser.

## Findings and fixes applied

### P1 — Look application had weak confirmation

**Diagnosis:** Feedback gap / Gulf of Evaluation

**Evidence:** Applying a look returned only small inline copy, while the main control continued to look actionable.

**Fix:** The primary action now changes to a disabled “{Look} is active” state and the status heading changes to “Active for your emails.” The inline message uses a polite live region.

### P1 — Some controls were undersized or lacked keyboard feedback

**Diagnosis:** Accessibility failure / Slip

**Evidence:** View links and device-selection buttons were shorter than a 44px touch target, with no scoped visible focus treatment.

**Fix:** Added 44px minimum touch targets, `aria-pressed` to preview selectors, and a high-contrast `:focus-visible` outline for all new controls.

### P1 — Low-contrast small labels

**Diagnosis:** Accessibility failure

**Evidence:** Cyan and muted green labels used at 11px on pale surfaces did not reliably meet AA contrast.

**Fix:** Small labels now use darker cyan and green text tokens, preserving the visual hierarchy while improving legibility.

### P2 — Preview CTA could inherit the wrong look’s label

**Diagnosis:** Consistency break / Mistake

**Evidence:** When previewing a different look from the saved selection, the existing saved CTA label could appear in the new look.

**Fix:** A custom saved label is now used only for the currently selected look; all other previews retain their own default CTA copy.

## Summary

**Total findings:** 4 (0 P0 / 3 P1 / 1 P2)

**Primary issue pattern:** State and accessibility cues needed to be more explicit than the Figma reference alone provided.

**Strongest aspect:** The visual grouping makes the merchant’s decision clear: compare the directions first, inspect a real email second, then apply one system-wide.

## Follow-up visual verification — 27 August 2026

Chrome review was run against the current development tunnel on an isolated render of the Templates route. The normal embedded Admin route could not be opened in this Chrome profile because its Shopify account lacks access to the dev store; the rendered route and stylesheet are the same production components used by `/app/additional`.

Screenshots captured:

- `screenshots/templates-desktop.png` — 1440 × 900
- `screenshots/templates-tablet.png` — 768 × 1024
- `screenshots/templates-mobile.png` — 375 × 812

The initial review exposed a P1 layout defect: fixed-width colour-chip and text columns needed more space than an embedded Shopify viewport could provide, so showcase content was clipped. The showcase now uses shrinkable grid columns and fluid chips. Re-checks found no internal overflow at desktop or tablet and no horizontal page overflow at 375px. Mobile labels also remain on one line.

## CTA verification — 27 August 2026

Chrome screenshots saved at `screenshots/templates-cta-desktop.png` and `screenshots/templates-cta-mobile.png` verified the CTA resize. The CTA now occupies its own final grid row rather than being absolutely positioned over the content: Gauge retains 28px of copy-to-button clearance, Denizen retains 10px, and mobile retains 84px with no horizontal overflow.

## Palette-label verification — 27 August 2026

Chrome mobile verification saved at `screenshots/templates-palette-label-mobile.png` confirms the full “YOUR STOREFRONT PALETTE” label is visible at 375px, with 20px space on both sides and no clipped text.

## Verification checklist

- [x] Primary task has one clear action per preview screen.
- [x] Applied state is visible and announced.
- [x] New controls expose keyboard focus and pressed state.
- [x] New touch targets meet the 44px minimum.
- [x] Decorative preview images use empty alt text.
- [x] Reduced-motion preference is respected.
- [x] Production build passes.
- [x] Capture and inspect desktop (1280px), tablet (768px), and mobile (375px) screenshots once the live Shopify preview is reachable.

## Page 17 email-preview correction — 29 August 2026

Chrome was checked against the authenticated embedded Shopify app after the final code change. The review covered Gauge and Denizen, all three selected-email states, the internal scroll interaction, and responsive layouts.

Screenshots captured:

- `screenshots/page17-fixed-gauge-desktop-1280.png`
- `screenshots/page17-fixed-gauge-scroll.png`
- `screenshots/page17-fixed-gauge-email-02.png`
- `screenshots/page17-fixed-gauge-email-03.png`
- `screenshots/page17-fixed-denizen-email-01.png`
- `screenshots/page17-fixed-denizen-email-02.png`
- `screenshots/page17-fixed-denizen-email-03.png`
- `screenshots/page17-fixed-tablet-768.png`
- `screenshots/page17-fixed-mobile-375.png`
- `screenshots/page17-fixed-mobile-preview-375.png`

Findings and fixes:

- Removed the black page surround; Page 17 now fills its route with the approved off-white surface.
- Replaced the reused, cropped hero shell with three complete Gauge email renders and three distinct Denizen 390px email compositions based on the Figma mobile frames.
- Preserved each source image's natural aspect ratio. The Gauge product set and Denizen shoe are fully visible rather than clipped by a fixed image height.
- Replaced the decorative fixed thumb with a visible rail whose thumb is calculated from the viewport's real `scrollTop`, `scrollHeight`, and `clientHeight`.
- Confirmed selection resets the email viewport to the top and that every second/third email renders after its image finishes loading.
- Fixed tablet overflow by reducing only the contained email presentation scale below 900px. Chrome measured equal document `scrollWidth` and `clientWidth` at 768px and 375px.
- Confirmed the Start customizing CTA remains 172px wide, has a 44px touch target, and does not overlap the mobile preview or helper copy.

Final status: no clipped product imagery, no page-level horizontal overflow, and no missing email state found in the Chrome pass.

## Page 17 remaining-flow implementation — 29 August 2026

The authenticated Shopify Admin route was reviewed in Chrome after wiring the
three previously collapsed flow cards. The selector now behaves as a
single-open accordion for all four flows, selects the first email when a flow
opens, and resets the contained preview scroll position on every flow or email
change.

Screenshots captured:

- `screenshots/page17-all-flows-gauge-interest-desktop-1280.png`
- `screenshots/page17-all-flows-gauge-interest-scroll.png`
- `screenshots/page17-all-flows-gauge-cart-desktop-1280.png`
- `screenshots/page17-all-flows-gauge-review-desktop-1280.png`
- `screenshots/page17-all-flows-denizen-interest-desktop-1280.png`
- `screenshots/page17-all-flows-denizen-cart-desktop-1280.png`
- `screenshots/page17-all-flows-denizen-review-desktop-1280.png`
- `screenshots/page17-all-flows-tablet-768.png`
- `screenshots/page17-all-flows-mobile-375.png`
- `screenshots/page17-all-flows-mobile-preview-375.png`

Findings and verification:

- Mapped Gauge Flow 02, Flow 03, and Flow 04 to seven complete 600px email
  exports cropped from the existing Figma boards; no hero-only crop is reused
  as an email.
- Matched Denizen's corresponding 2/3/2 mobile flow content, imagery, light and
  dark treatments, editorial type, and restrained brick CTA treatment.
- Confirmed only the selected nested row displays `PREVIEWING` and that the
  Live Preview title and artwork update for every selection.
- Confirmed the internal viewport reaches its real maximum scroll position and
  the visible thumb moves with it. Flow and email changes return `scrollTop` to
  zero.
- Chrome measured no horizontal overflow: at 768px the embedded document had
  `scrollWidth === clientWidth === 513px`; at 375px it had
  `scrollWidth === clientWidth === 360px`.
- The Start customizing CTA remains 172×44px. Flow headers are 60px tall and
  nested email rows remain above the 44px touch-target minimum.
- The production build passes. Typecheck continues to report only the known
  pre-existing `s-app-nav` intrinsic-element typing gap in `app/routes/app.tsx`.

Final status: all four flows are functional for Gauge and Denizen, complete
email artwork scrolls inside the contained preview, and the desktop, tablet,
and mobile checks are clean.

## Page 17 flow-control colour treatment — 29 August 2026

The Templates flow controls now use the same per-flow colour language as the
approved Flow Selector reference: blue for Welcome, warm neutral for Still
interested?, magenta for Abandoned cart, and green for How was it?. Each
control's count bubble, text, border, hover surface, and expanded border share
the same flow token; the selected nested email intentionally retains the
restrained cyan active state.

Screenshots captured:

- `screenshots/page17-flow-controls-desktop-1280.png`
- `screenshots/page17-flow-controls-tablet-768.png`
- `screenshots/page17-flow-controls-mobile-375.png`
- `screenshots/page17-flow-controls-cart-expanded-desktop-1280.png`

Verification:

- Confirmed the colour treatment is visible for every collapsed flow at all
  three required breakpoints, with no clipped labels or horizontal overflow.
- Opened Abandoned cart in Chrome and confirmed it collapses Welcome, expands
  its three email rows, changes the live preview to Cart reminder, and applies
  the magenta expanded control treatment.
- Confirmed the production build passes.

## Page 17 flow-control toggle — 29 August 2026

Flow expansion is now independent from the currently selected preview. Pressing
an open flow's control closes its email rows and changes its chevron back to
downward, while the selected email remains in the Live Preview. Pressing a
different flow continues to open that flow, select its first email, and close
the previous flow.

Screenshots captured:

- `screenshots/page17-flow-toggle-closed-desktop-1280.png`
- `screenshots/page17-flow-toggle-closed-tablet-768.png`
- `screenshots/page17-flow-toggle-closed-mobile-375.png`

Verification:

- In Chrome, pressed the open Welcome control once and confirmed that all three
  nested rows disappeared, its chevron changed from up to down, and the Live
  Preview remained on `01 / Welcome`.
- Checked the fully collapsed selector at desktop, tablet, and mobile with no
  clipping or horizontal overflow.
- The production build passes.

## Page 17 campaign asset correction — 29 August 2026

Completed the unfinished campaign-image pass recovered from the pinned
customization task. Gauge now uses three distinct portrait subjects across the
affected lifecycle emails, while Denizen uses distinct city, transit, and steps
scenes. The approved Page 17 Figma composition was not changed.

Figma evidence:

- Added the editable `Gauge / Campaign Portrait Library` board to Page 1 of
  `Nomi Design Templates`, alongside the existing Denizen brand assets.
- Documented the calm, freckle, and shadow portrait roles, email-safe 3:2 crop
  guidance, palette, and usage rule.
- `screenshots/figma-gauge-campaign-portrait-library.png`

Chrome screenshots captured after the final code change:

- `screenshots/page17-campaign-assets-gauge-desktop-1280.png`
- `screenshots/page17-campaign-assets-gauge-calm.png`
- `screenshots/page17-campaign-assets-gauge-freckle.png`
- `screenshots/page17-campaign-assets-gauge-shadow.png`
- `screenshots/page17-campaign-assets-gauge-review.png`
- `screenshots/page17-campaign-assets-denizen-desktop-1280.png`
- `screenshots/page17-campaign-assets-denizen-transit.png`
- `screenshots/page17-campaign-assets-denizen-steps.png`
- `screenshots/page17-campaign-assets-denizen-scroll-end.png`
- `screenshots/page17-campaign-assets-tablet-768.png`
- `screenshots/page17-campaign-assets-mobile-375.png`

Verification:

- Confirmed all remapped Gauge composites load at 600px natural width and the
  Denizen campaign images load at 1200×800 without broken or delayed final
  states.
- Confirmed every tested nested selection updates the Live Preview and only the
  selected row displays `PREVIEWING`.
- Confirmed the fixed-height email viewport scrolls from `0` to its real
  628px maximum for the tested Denizen Route email; the synchronized visible
  rail reaches the end state.
- Chrome measured no document-level horizontal overflow at desktop, tablet, or
  mobile. The embedded document measured `1025/1025`, `513/513`, and `360/360`
  for `clientWidth/scrollWidth` respectively.
- Corrected the 375px footer layout discovered during the final pass: helper
  copy now wraps above the CTA, the 390px email scales to fit the panel, and
  `Start customizing` remains fully contained at 172×44px.
- The production build passes. Typecheck continues to report only the known
  pre-existing `s-app-nav` intrinsic-element typing gap in `app/routes/app.tsx`.

Final status: the campaign imagery is distinct and uncropped at its source,
the Figma asset library records the Gauge portrait system, and Page 17 remains
clean at all required breakpoints.

## Page 17 split-meter selector — 30 August 2026

Replaced the circular-count Flow Selector treatment with the approved Split
Meter direction while preserving Page 17's two-panel composition and all
existing flow, email-selection, preview-scroll, and customization behavior.
The expanded flow now uses a divided `0 / N` meter; collapsed flows use slim
per-flow colour rails, concise lifecycle-purpose labels, and a 44px chevron
target inside a fully clickable 64px row.

Screenshots captured after the final code change:

- `screenshots/page17-split-meter-desktop-1280.png`
- `screenshots/page17-split-meter-tablet-768.png`
- `screenshots/page17-split-meter-mobile-375.png`
- `screenshots/page17-split-meter-cart-open-desktop-1280.png`
- `screenshots/page17-split-meter-hover-desktop-1280.png`
- `screenshots/page17-split-meter-focus-mobile-375.png`
- `screenshots/page17-split-meter-denizen-desktop-1280.png`

Review findings:

- **Must fix:** None. The selector, preview, CTA, and responsive layout remain
  functional and visually contained.
- **Should fix:** None found during the final Chrome pass.
- **Could improve:** If real completion data is introduced later, connect the
  meter and `0 / N` text to that data rather than changing the visual system.
- **What works well:** The split meter makes the open flow immediately
  recognizable, while the restrained rails let all four lifecycle types retain
  their colour identity without turning the selector into a dashboard.

Verification:

- Opened Abandoned cart and confirmed Welcome collapsed, the three cart email
  rows appeared, the first row alone showed `PREVIEWING`, and the Gauge live
  preview updated to `01 / Cart reminder`.
- Confirmed the keyboard focus ring is clearly visible around nested email
  rows and the hover treatment remains restrained but perceptible.
- Confirmed the selector renders correctly with both Gauge and Denizen.
- Measured no document-level horizontal overflow in the embedded app:
  `1025/1025` at desktop, `513/513` at tablet, and `360/360` at mobile for
  `clientWidth/scrollWidth`.
- Measured flow rows at 64px, nested email rows at 62px, chevron controls at
  44×44px, and `Start customizing` at 172×44px.
- `npm.cmd run build` passes. `npm.cmd run typecheck` continues to report only
  the documented pre-existing `s-app-nav` JSX intrinsic-element gap in
  `app/routes/app.tsx`.

Final status: the Split Meter is production-ready on the Templates route at
all required breakpoints, with no unresolved design-review findings.

## Page 17 expanded-meter removal — 30 August 2026

Removed the stacked `0 / N` meter and divider from expanded flow headers at
the merchant's request. Expanded and collapsed headers now share the same slim
per-flow colour rail; the open state is communicated by its border, soft
surface, upward chevron, and visible nested email rows.

Screenshots captured after the final change:

- `screenshots/page17-no-expanded-meter-desktop-1280.png`
- `screenshots/page17-no-expanded-meter-tablet-768.png`
- `screenshots/page17-no-expanded-meter-mobile-375.png`

Verification:

- Confirmed the expanded Welcome header contains no meter numbers or divider.
- Confirmed all four flow headers remain 64px tall and the nested email states,
  44px chevron target, and preview behavior are unchanged.
- Measured no embedded-document horizontal overflow at desktop (`1025/1025`),
  tablet (`513/513`), or mobile (`360/360`) for `clientWidth/scrollWidth`.
- Confirmed `Start customizing` remains 172×44px.
- `npm.cmd run build` passes. Typecheck continues to report only the documented
  pre-existing `s-app-nav` JSX intrinsic-element gap in `app/routes/app.tsx`.

## Page 22 final template editor — 31 August 2026

Reviewed the Page 22 Figma editor concepts in authenticated Chrome after the
merchant reported alignment and legibility issues in Theme mode. Pages 1–21
were not changed.

Screenshots captured after the final Figma corrections:

- `screenshots/page22-editor-figma-chrome-desktop-1280.png`
- `screenshots/page22-theme-figma-chrome-desktop-1280.png`
- `screenshots/page22-editor-figma-chrome-tablet-768.png`
- `screenshots/page22-editor-figma-chrome-mobile-375.png`

Review findings and corrections:

- **Must fix — resolved:** The three mode-introduction frames had no fill, so
  their white editorial headings disappeared against Figma's white canvas.
  All three now use the intended ink surface with visible paper and cyan type.
- **Must fix — resolved:** The selected Theme preview block used dark copy on
  a dark surface. Its heading, description, and CTA now have accessible visual
  contrast and match the selected Gauge theme.
- **Must fix — resolved:** The Theme action footer retained content-width auto
  sizing, pulling `Apply theme` inward and crowding the scope note. The footer
  now spans the right-panel content width, keeps the note on the left, and
  aligns the 168×44px CTA to the right edge.
- **Must fix — resolved:** The preview identifier wrapped `GAUGE / WELCOME 01`
  into the divider. It is now a single 160px-wide line with clear separation
  from the rule below it.
- **Must fix — resolved:** The Solid and Outline samples were cramped into
  narrow cards. Both choices now share the full 470px control width as equal
  231×64px cards with readable 84×36px sample buttons.
- **Merchant preference — resolved:** Removed every decorative cyan dot from
  Page 22's saved-state and control-row components. Functional slider and
  toggle controls were preserved.
- **Should fix:** None remain in the reviewed desktop composition.
- **Could improve:** Page 22 is currently a desktop Figma concept, not a
  responsive implementation. The 768px and 375px captures verify the Figma
  canvas remains reachable in Chrome; Figma's own side panels obscure the
  canvas at narrow widths, so they are not evidence of application-level
  responsive behavior.
- **What works well:** Content, Structure, and Theme are clearly separated;
  the contained email preview preserves continuity from template selection;
  Lora and IBM Plex Sans establish a calm editorial hierarchy; cyan remains
  restrained to active feedback and selections.

Verification:

- Inspected the complete Page 22 board and the corrected Theme frame in the
  merchant's authenticated Chrome session.
- Confirmed the mode header, selected preview block, scope note, and primary
  action are visible and no longer overlap in the rendered Figma canvas.
- Confirmed the Theme control panel preserves consistent left/right alignment
  through palette, typography, spacing, button style, series toggle, and
  `Apply theme` rows.
- Re-opened the final Theme frame in authenticated Chrome after the title,
  button-card, and dot-removal refinements and replaced the desktop evidence
  screenshot with the corrected state.
- No application code changed, so an application build was not required for
  this Figma-only correction.

Final status: the reported Page 22 alignment and contrast issues are corrected
in Figma, the Chrome review is complete, and no unresolved desktop design
findings remain.

## Template editor interaction correction — 31 August 2026

Corrected the post-`Start customizing` editor after merchant testing exposed
dead controls and a manual-scroll conflict.

Screenshots captured after the final implementation:

- `screenshots/template-editor-final-desktop-1280.png`
- `screenshots/template-editor-final-tablet-768.png`
- `screenshots/template-editor-final-mobile-375.png`
- `screenshots/template-editor-preview-flow-desktop-1280.png`

Findings and corrections:

- **Must fix — resolved:** `Preview flow` had no handler. It now opens a real
  contained flow preview with email navigation, natural internal scrolling,
  close/Escape behavior, and the merchant's current unsaved draft.
- **Must fix — resolved:** Structure displayed Position, width, remove, add,
  and apply controls that did not change the saved template. Structure now
  states its real purpose and exposes only working order and visibility
  behavior. Required header/footer protection is explicit.
- **Must fix — resolved:** Selecting a Structure row no longer forces the
  preview away from a merchant's manual scroll position. `Show in preview` is
  now the deliberate navigation action; Footer reaches the real scroll end.
- **Must fix — resolved:** The custom rail fought native pointer/trackpad
  behavior. The contained email now uses a visible native scrollbar with a
  44px minimum thumb and grab/grabbing cursor feedback.
- **Must fix — resolved:** Routine steps and the other email sections had no
  complete editing path. Every section is keyboard- and pointer-selectable in
  Content mode, and Routine exposes three persisted title/detail pairs.
- **Merchant preference — resolved:** Removed the temporary Header / Hero /
  Routine / Product / Footer button cluster from the Content rail and restored
  the earlier `How to edit` guidance.
- **Should fix — resolved:** Shopify's tablet iframe is narrower than the outer
  768px viewport. The editor now switches to its stacked layout at 800px, so
  the preview and right-side fields are no longer clipped.

Verification:

- Desktop header mode control measured exactly centered (`0px` offset).
- Desktop, tablet, and mobile measured `0px` document-level horizontal
  overflow. The Save action remains 44px high at all breakpoints.
- Tablet and mobile use the stacked workspace; measured preview widths were
  479px and 326px respectively inside the Shopify iframe.
- Clicking the Routine section in the real preview opens its six editing
  fields. A test change saved successfully through the real action and was
  removed after verification.
- `npm.cmd run build` passes. Typecheck continues to report only the documented
  pre-existing `s-app-nav` JSX intrinsic-element gap in `app/routes/app.tsx`.

Final status: the editor keeps manual scrolling under merchant control, every
visible Structure control is truthful, the complete flow preview works, and
the Content rail is back to the approved quiet guidance treatment.

### Scrollable real-email preview refinement

Replaced Theme mode's schematic email blocks with the approved Gauge Welcome
01 email from Page 17. The reused composition includes the real Gauge product
photograph and the complete 1,045px email rather than invented placeholder
content.

- The editor preview remains a contained 356×532px viewport inside the existing
  404×620px preview shell.
- Native Figma overflow is set to vertical, while the email content remains
  approximately 867px tall after proportional scaling.
- The visible top-state rail uses a 326px thumb calculated from the viewport to
  content-height ratio, communicating the available scroll range without
  stretching the editor page.
- A restrained `SCROLL INSIDE EMAIL` helper makes the interaction discoverable.
- The photograph preserves the source email composition and natural aspect
  ratio; it is not replaced with a decorative placeholder crop.
- Final authenticated-Chrome evidence is saved at
  `screenshots/page22-scrollable-real-email-chrome-desktop-1280.png`.

This Figma refinement changes only Page 22. Pages 1–21 and application code
remain unchanged, so no application build was required.

The same real-email treatment was then carried into the other two Page 22
editor modes for continuity:

- **Content:** 390×588px viewport with 950px of real Gauge email content. The
  cyan editable-text outline and `EDITING TEXT` tag are children of the email
  content, so they move with the selected copy while scrolling.
- **Structure:** 356×532px viewport with approximately 867px of real email
  content. The selected Hero intro outline and section tag are likewise nested
  inside the email, so section feedback stays attached to the content.
- **Theme:** retains its 356×532px viewport and approximately 867px content
  height, giving all three modes the same contained long-email behavior.
- All three frames are clipped and use native Figma vertical overflow. The
  outer editor compositions remain fixed-height rather than growing with the
  email.
- Final all-mode Chrome evidence is saved at
  `screenshots/page22-all-modes-real-email-chrome-desktop-1280.png`.

### Structure selection auto-scroll

The five Structure rows now contain real Figma prototype interactions. Each
row uses `ON_CLICK` → `SCROLL_TO` with a 320ms ease-out scroll animation and
targets the corresponding node inside the real Gauge email viewport:

- Header → email header
- Hero intro → welcome eyebrow/intro region
- Routine steps → routine label and step group
- Product note → lower commerce/CTA region
- Footer → email footer

The preview remains the only scrolling surface. UI copy now states that the
email auto-scrolls to the selection, and the detail drawer explains that
selecting a row brings its section into view.

Production behavior should use smooth, clamped centering: center normal
sections when space allows, align Header to the top and Footer to the bottom,
respect reduced-motion preferences, and avoid retriggering auto-scroll while
the merchant is typing. Manual preview scrolling should not silently change
the selected Structure row.

Chrome evidence is saved at
`screenshots/page22-structure-auto-scroll-chrome-desktop-1280.png`.

### Theme control auto-scroll

The five Theme controls now use the same 320ms ease-out prototype `SCROLL_TO`
behavior as Structure mode, targeting representative nodes in the real Gauge
email:

- Palette → product photograph and its surrounding palette
- Typography → primary email headline
- Spacing → routine-section transition
- Buttons → primary email CTA
- Logo & footer → footer by default

The preview guidance now reads `SELECT CONTROL → AUTO-SCROLL`, and the Theme
drawer explains that selecting a category brings its clearest example into
view. If Logo and footer become separate sub-controls in implementation, Logo
should target the header while Footer retains the bottom target.

Chrome evidence is saved at
`screenshots/page22-theme-auto-scroll-chrome-desktop-1280.png`.

## Template editor implementation review — 31 August 2026

Reviewed the implemented post-`Start customizing` editor in the merchant's
authenticated Shopify Chrome session after the final header and scroll
interaction changes.

- Refined the editor header into clear context, mode, and action zones. At the
  desktop breakpoint, the Content / Structure / Theme control is anchored to
  the true horizontal center of the complete header; the measured center
  offset is `0px`.
- Kept the mode control in normal responsive flow below 960px so it remains
  fully visible and usable without colliding with the context or save action.
- Replaced the decorative email rail with a real synchronized scrollbar. The
  thumb can be dragged directly with pointer or touch input and supports
  Arrow, Page Up/Down, Home, and End keyboard controls.
- Verified Structure and Theme selection auto-scroll against the real email.
  Selecting Footer reached the exact bottom of the contained viewport
  (`scrollTop 549` of `549`), and dragging the rail moved the viewport from
  `549` to `209`.
- Verified Prisma-backed content persistence through the real Shopify UI:
  edited the headline, saved, reloaded, confirmed the edit persisted, then
  restored and saved the original copy. The final UI state is `Saved`.
- Desktop review used the real 1280px Shopify viewport. Tablet at 768px and
  mobile at 375px both measured `0px` page-level horizontal overflow. The
  mobile Templates link remains visible and the Save changes action measures
  44px high.
- Checked the rendered editor for clipped copy, overlapping controls, broken
  assets, preview containment, and delayed image behavior. No unresolved
  application-owned visual issues remain. The small `dev previews` bar is
  Shopify's development console, outside the app UI.
- The production build passes. Type checking reports only the known existing
  `s-app-nav` JSX intrinsic-element gap in `app/routes/app.tsx`.

Verification screenshots:

- `screenshots/template-editor-review-desktop-1280-centered-header.png`
- `screenshots/template-editor-review-tablet-768.png`
- `screenshots/template-editor-review-mobile-375.png`

## Template editor section navigator refinement — 31 August 2026

Restored the five Content-mode section controls after the temporary
instructional treatment and refined them into an intentional Nomi-native
navigator instead of browser-default buttons.

- All five targets remain visible: Header, Hero intro, Routine steps, Product
  note, and Footer.
- Desktop uses one restrained continuous list with a cyan selection edge,
  clear hover feedback, a visible keyboard focus treatment, and directional
  arrows.
- Tablet and mobile use a wrapping grid rather than a swipe-only row, keeping
  every section discoverable without horizontal scrolling.
- Each control measures 46px high at mobile, clearing the 44px minimum touch
  target. The 375px editor root measured `344px` for both `clientWidth` and
  `scrollWidth`, confirming no application-owned horizontal overflow.
- Clicking Routine steps selected the matching preview section and opened the
  `Edit routine steps` panel in the live Shopify editor.
- The global Nomi arrow cursor was reduced to a final 19×23px canvas with a
  tighter white edge and softer blue halo; scrollbar interaction retains the
  native grab/grabbing feedback.

Verification screenshots:

- `screenshots/template-editor-section-nav-desktop-1280.png`
- `screenshots/template-editor-section-nav-tablet-768.png`
- `screenshots/template-editor-section-nav-mobile-375.png`

## Flow Editor selector alignment — 31 August 2026

Aligned the post-onboarding Flow Editor selector with the approved Templates
flow-card treatment in the authenticated Shopify Chrome session.

- Replaced the editor's circular count bubbles, divider rules, bordered count
  controls, and card shadows with the Templates selector's slim colored rails,
  two-line Lora/IBM Plex hierarchy, compact progress counts, and chevrons.
- Preserved the editor's real generated-email progress, expand/collapse logic,
  selected email state, and pending/generated status rows.
- Added concise flow-purpose metadata for all five editor flows, including the
  existing Welcome Back flow that is not present in the four-flow template
  selector.
- Verified collapsed and expanded states in Chrome. The selected card returns
  to the neutral border when collapsed; the active accent border is reserved
  for the expanded state.
- At the embedded app's effective widths, desktop (1025px), tablet (513px),
  and mobile (360px) all measured equal `clientWidth` and `scrollWidth`, with
  no application-owned horizontal overflow.
- Flow headers measure 64px high and chevron controls measure 44×44px on
  mobile. Tablet subtitles remain on their own line beneath the flow name.
- The production build passes. Type checking continues to report only the
  known existing `s-app-nav` JSX intrinsic-element gap in `app/routes/app.tsx`.

Verification screenshots:

- `screenshots/flow-editor-template-cards-desktop-1280.png`
- `screenshots/flow-editor-template-cards-tablet-768.png`
- `screenshots/flow-editor-template-cards-mobile-375.png`

## Page 24 Page 22 contextual asset states — 1 September 2026

Added two focused Figma interaction states derived from the approved Page 22
Content editor without changing the Page 22 source frame.

- Preserved the existing three-column editor, contained 390px email preview,
  top bar, section list, and right-side editing model. No centered modal is
  introduced.
- Clicking the hero image opens an aligned contextual drawer with exactly
  three sources: Shopify Files, Products, and Upload. The selected image stays
  outlined in the email until Continue is used.
- Clicking the logo opens the matching logo drawer with exactly three sources:
  Brand Logo, Shopify Files, and Upload, plus restrained treatment and
  alignment controls.
- Removed URL as a source throughout the active Page 24 proposal. Superseded
  explorations were archived and hidden from the rendered page.
- Kept all actions in a separate, right-aligned footer and retained 44px CTA
  heights. Typography is limited to the existing IBM Plex Sans, Lora, and
  Fjalla One families.
- Audited the active Figma section for accidental URL copy, collapsed text,
  layout consistency, and correct current-asset content. The two zero-height
  vector results are intentional divider lines; no collapsed text remains.

Verification screenshots:

- `screenshots/page24-page22-contextual-states-final.png`
- `screenshots/page24-page22-hero-state.png`
- `screenshots/page24-page22-logo-state.png`
- `screenshots/page24-hero-drawer-final.png`
- `screenshots/page24-logo-drawer-final.png`

## Contextual asset drawer interaction pass — 1 September 2026

- The editor now renders a reversible, live asset preview: changing a hero source or image, logo treatment, alignment, or brand name updates the contained email immediately. `Cancel`/`Restore` returns the preview to its saved state; `Use this image`/`Use logo` commits the chosen state to the draft and enables the existing Save changes action.
- Replaced the misleading brand-source glyph with a compact typographic `Aa` mark so it reads as a brand identity choice rather than a document or building.
- Added accessible names to the hero-image and logo click targets, keeping the new contextual interaction keyboard-discoverable.
- `npm.cmd run build` passes. `npm.cmd run typecheck` still reports only the known pre-existing `s-app-nav` JSX intrinsic-element gap in `app/routes/app.tsx`.
- Chrome visual verification is blocked by Shopify Admin serving the expired `ordinance-recorded-brilliant-beans.trycloudflare.com` dev-preview iframe while the active local Shopify CLI session is registered at `southwest-nightlife-poly-pale.trycloudflare.com`. The iframe visibly returns “refused to connect,” so no application screenshot can honestly be captured until the dev preview is refreshed. No destructive Dev Console action was taken.

## Template computer-upload correction — 1 September 2026

- Corrected the editor's programmatic file submission to use
  `multipart/form-data`. React Router's URL-encoded default had converted the
  selected `File` to text before the template-editor action received it, so
  valid JPG, PNG, and GIF files were rejected regardless of their size.
- A completed hero or logo upload is now selected automatically and appears in
  the live email immediately. The existing confirmation action commits that
  visible preview to the draft; merchants no longer need to find and select
  the same file a second time.
- Kept the existing client and server limits aligned: 5 MB and 120 × 40px
  minimum for logos; 20 MB and 600 × 300px minimum for hero images.
- Removed a duplicated dimension branch and added a visible focus treatment to
  the computer-upload control.
- Chrome verification covered desktop 1440px, tablet 768px, and mobile 375px.
  The embedded route measured equal `clientWidth` and `scrollWidth` at every
  breakpoint. On mobile, the upload control measured 45.6px high and the
  confirmation CTA measured 44px high, with neither clipped nor overlapped.
- The production build passes. Type checking continues to report only the
  known existing `s-app-nav` JSX intrinsic-element gap in `app/routes/app.tsx`.
- The compiled client bundle contains the corrected multipart encoding. Direct
  file injection from the Chrome automation session remains unavailable until
  the ChatGPT browser extension is allowed to access local file URLs, so this
  review does not claim a browser-driven transfer of the test asset.

Verification screenshots:

- `screenshots/template-upload-multipart-desktop-1440.png`
- `screenshots/template-upload-multipart-tablet-768.png`
- `screenshots/template-upload-multipart-tablet-768-panel.png`
- `screenshots/template-upload-multipart-mobile-375.png`
- `screenshots/template-upload-multipart-mobile-375-panel.png`

## Page 27 Structure editor — 1 September 2026

- Added `Page 27 — Structure editor` to the `Nomi Design Templates` Figma
  file. The page contains an editable 1440 × 900 layered frame with named
  groups for the top bar, Structure rail, live email, and section inspector.
  It uses the real Gauge email asset and documents the implemented pointer,
  keyboard, touch, and persistence behaviour.
- Rebuilt the production Structure rail around an explicit 44px grab handle,
  high-contrast selected state, live row movement, a cyan insertion guide,
  and a synchronized moving state in the contained email preview.
- Added keyboard reordering with Arrow keys, Home, and End. A polite live
  status announces the resulting position and clears after 3.5 seconds.
- Added visible 44px up/down controls on tablet and mobile so merchants are
  not required to perform touch drag-and-drop. The inspector also shows the
  selected section's exact position and provides move controls on desktop.
- Simplified the right-side actions to `Show in preview` and `Edit copy`, while
  preserving the existing visibility control and protected header/footer
  behaviour.
- Chrome verification covered real pointer dragging, keyboard reordering,
  mobile move controls, visibility off/on, save persistence, and restoration
  of the original order. The embedded route reported equal `clientWidth` and
  `scrollWidth` at desktop (1040px), tablet (528px), and mobile (360px).
- `npm.cmd run build` passes. `npm.cmd run typecheck` continues to report only
  the known pre-existing `s-app-nav` JSX intrinsic-element gap in
  `app/routes/app.tsx`.

Verification screenshots:

- `screenshots/page27-structure-figma.png`
- `screenshots/page27-structure-desktop-1280.png`
- `screenshots/page27-structure-tablet-768.png`
- `screenshots/page27-structure-mobile-375.png`

## Template editor integrity audit — 1 September 2026

Reviewed Content, Structure, and Theme as one continuous editing workflow against the active Nomi brief and the calm editorial design direction.

### Corrections completed

- Content now renders each email's real saved headline in both the editor heading and the contained email; email 02/03 no longer receive generic substitute copy.
- Required content fields use the same length limits as server validation, invalid drafts cannot be saved, and pending edits are counted across emails with a leave-page warning.
- Structure uses the complete row as its pointer/touch drag target with a movement threshold. Keyboard Arrow/Home/End reordering and inspector movement controls remain available.
- Mobile Structure rows no longer expose redundant arrow-button clutter now that direct touch drag works.
- Theme uses the selected look and flow names instead of hard-coded Gauge/Welcome labels. The non-functional preset and Apply-theme controls were removed; every remaining control changes the live email and the top-level Save changes action persists it.
- Paper and Mineral palettes now affect the hero, routine, and product surfaces visibly, not only the article background.
- Preview-only content no longer presents dead buttons or links outside Content mode.
- Theme categories and email selection reflow into complete grids at tablet/mobile sizes; no category or email is hidden behind an undiscoverable horizontal scroll.
- The complete-flow dialog focuses its close control, locks background scrolling, supports Escape, and exposes selected-email state.

### Interaction verification

- Content input → live email copy: passed on Denizen Welcome email 02.
- Whole-row pointer drag → rail order and email order: passed (Hero intro moved below Routine steps during the test).
- Keyboard reorder: passed.
- Palette selection → computed email surface colors: passed for Paper and Accent.
- Complete-flow preview open, focus, navigation content, and close: passed.
- Page-level horizontal overflow: none at desktop, tablet, or mobile in all three modes.
- Browser console: no Nomi application errors; only Shopify-host warnings were present.

### Screenshots captured

- `screenshots/editor-audit-content-desktop-1280.png`
- `screenshots/editor-audit-structure-desktop-1280.png`
- `screenshots/editor-audit-theme-desktop-1280.png`
- `screenshots/editor-audit-content-tablet-768.png`
- `screenshots/editor-audit-structure-tablet-768.png`
- `screenshots/editor-audit-theme-tablet-768.png`
- `screenshots/editor-audit-content-mobile-375.png`
- `screenshots/editor-audit-structure-mobile-375.png`
- `screenshots/editor-audit-theme-mobile-375.png`

### Result

The three modes now share one understandable contract: choose or arrange something, see it in the contained email immediately, then use Save changes to persist it. The remaining known typecheck output is the pre-existing `s-app-nav` JSX typing gap in `app/routes/app.tsx`.

## Remix relationship intelligence concepts — 1 September 2026

Reviewed the new Figma Page 32 and Page 33 concepts against Page 30, the active Nomi visual direction, and the requirement that a non-marketer understand the agent behavior.

### Screenshots captured

- `screenshots/page32-relationship-opportunities.png`
- `screenshots/page33-relationship-agent-flow.png`

### Review findings

- Page 32 preserves the approved Opportunity Inbox pattern while shifting the opportunity model from static segments to relationship moments: first purchase, repeat purchase, quiet customer, and returned customer.
- The continuous relationship thread is the strongest visual signature. It establishes why the selected second-purchase message differs from a first-purchase message without exposing filters or query logic.
- Page 33 explains the system with one example customer, Maya Shah. The timeline, plain-language memory card, four-step agent flow, and senior-marketer guardrails form a clear reading order.
- Cyan consistently represents the current or constructive relationship state; magenta is reserved for the quiet period that requires attention. Both retain adequate contrast at the concept's rendered size.
- Major calls to action exceed a 44px target in the desktop concepts, labels remain visible, and the rendered Figma frames show no clipping or overlap.
- The concepts make cancellation behavior explicit: a new purchase retires an obsolete win-back message. Consent, frequency limits, factual grounding, and merchant approval are visible rather than hidden system rules.

### Result

The two pages work as a connected product story: Page 32 helps the merchant choose the right relationship opportunity, and Page 33 explains how the agent reached that decision. No visual corrections were required after the final screenshot review.

## Remix Outcome Brief UX correction and reviewed-plan continuation — 2 September 2026

Reviewed the revised Figma Outcome Brief at node `9:3` and the new post-brief review screen against the merchant feedback, the approved two-panel direction, and Nomi's approval safeguards.

### Screenshots captured

- `screenshots/remix-outcome-brief-reworked-01.png`
- `screenshots/remix-outcome-brief-ux-final.png`
- `screenshots/remix-reviewed-plan-review-01.png`
- `screenshots/remix-reviewed-plan-final.png`

### Review findings

- Removed the cyan tick marks, black checkbox marks, and the broken cross-panel connector. Selection is now communicated with explicit text labels and actions.
- Rebuilt the left panel around a visibly focused, labeled campaign brief field with a text caret, useful placeholder, starter directions, and one primary `Build reviewed plan` action.
- Replaced generic constraints with campaign-specific optional guardrails: `Discount up to 20%` and `Winter collection`. Product availability remains an automatic safeguard and is not exposed as merchant setup.
- Added removable guardrails and an explicit `Add boundary` button. All first-screen interactive targets are at least 44px high.
- Replaced the diagram-like proposal with a readable plan preview containing two concrete flow changes, an `Adjust flows` action, explicit inclusion labels, and quiet GPT/Claude/Nomi provenance.
- Added `Page 4 — Reviewed Remix Plan` as the next state after the brief. It preserves the original brief, distinguishes changed and untouched flows, provides `Preview email` and `Edit direction` actions for each proposal, and ends with a clear approval decision.
- Approval saves the direction only. Both frames explicitly state that nothing sends and timing remains unchanged.
- Page 2 still contains only `Remix / Concept 04 — Outcome Brief`. Both 1440×900 frames use Lora SemiBold and IBM Plex Sans, contain no clipped text, and contain no tick characters or legacy connector layers.

### Result

The flow now has an obvious execution path: write the outcome, generate a reviewed plan, inspect or edit each proposed flow change, then approve the direction. Automatic lifecycle and product-availability rules remain quiet system behavior rather than merchant configuration.

## Remix guided-goal entry and editable directions — 2 September 2026

Reviewed the goal-first refinement of Figma node `9:3` and the corresponding campaign-directions language on the reviewed-plan screen.

### Screenshots captured

- `screenshots/remix-guided-goals-review-01.png`
- `screenshots/remix-guided-goals-final.png`
- `screenshots/remix-directions-review-final.png`

### Review findings

- Added three plain-language merchant goals: `Increase repeat purchases`, `Launch a collection`, and `Bring customers back`. The selected goal uses a labeled state rather than a decorative tick.
- Preserved free-form intent through an attached custom writing field and a visible `Write my own` action. Merchants can add detail to a starter or replace it with a completely different goal.
- Kept campaign-specific guardrails progressive and optional. Product availability remains automatic rather than becoming merchant configuration.
- Reframed generated output as `Campaign directions`. Every direction names the affected flow and email, provides an explicit `Edit` action, and can be supplemented through `Add direction`.
- Aligned the subsequent review screen to the same direction-based language and added `Add direction` alongside the existing preview and edit controls.
- Final validation found no clipped text, no tick characters, and no interactive target below 44px. Page 2 continues to contain only Concept 04.

### Result

The entry screen now supports both novice and confident merchants: choose a recognizable goal for speed or write a custom goal for control. The output remains understandable and editable from the first draft through final approval.

## Remix Outcome Brief visual redesign — 2 September 2026

Reviewed Figma node `9:3`, `Remix / Concept 04 — Outcome Brief`, against the approved writing-first Remix brief and Nomi's calm editorial direction.

### Screenshots captured

- `screenshots/remix-outcome-brief-before.png`
- `screenshots/remix-outcome-brief-review-01.png`
- `screenshots/remix-outcome-brief-final.png`

### Review findings

- The merchant's written campaign outcome is now the dominant action. Starter suggestions remain subordinate text links inside the writing surface instead of competing controls.
- The approved two-panel composition is preserved. A restrained cyan campaign route connects the written brief to GPT's route drafting and continues through the two affected flow moments.
- The result remains outcome-led: `Build one Black Friday story across the right moments.` is followed by concrete Welcome and Welcome Back changes, not a model-selection interface.
- GPT and Claude are explained quietly as drafting and review stages. Nomi's email-safe component step is explicit without exposing unnecessary implementation controls.
- Automatic lifecycle routing and merchant approval remain visible: previous buyers leave Welcome automatically, and nothing changes until the merchant approves the plan.
- The frame uses Lora SemiBold for editorial headings and IBM Plex Sans for interface text. Cyan is limited to active state, route continuity, and assurance details.
- Final structural validation found no overflowing text nodes, no discarded concept/model names, and no additional frames on Page 2. Primary and secondary CTAs are 44px high.

### Result

The frame now reads as an editorial campaign desk rather than a generic dashboard: write the intended outcome, see the coordinated lifecycle route, then build a reviewed plan. The final 1440×900 Figma render is clean, unclipped, and visually consistent with the approved Nomi direction.

## Remix three-step campaign flow — 2 September 2026

Reviewed the complete Figma journey after separating Remix into three focused full-page tasks.

### Screenshots captured

- `screenshots/remix-step1-outcome.png`
- `screenshots/remix-step2-directions.png`
- `screenshots/remix-step3-approval.png`

### Review findings

- Step 1 is a calm goal-selection page with one clearly selected outcome, two optional starters, a full-width custom-goal action, an optional discount guardrail, and one primary `Create directions` CTA.
- Step 2 turns the chosen outcome into two concrete campaign directions mapped to existing flows. Each direction can be edited or removed, a new direction can be added, and the merchant explicitly advances to review.
- Step 3 presents the campaign brief, campaign-specific guardrails, unchanged flows, automatic safeguards, email previews, direction editing, and the final approval action in one inspectable view.
- Navigation language now follows the sequence: `Back to outcome` from Step 2 and `Back to directions` from Step 3.
- GPT drafting, Claude review, and Nomi's controlled email-safe build remain quiet explanatory copy rather than model-selection controls.
- Each page contains exactly one 1440×900 frame. Final structural validation found no clipped text, only Lora and IBM Plex Sans typography, and no named control target below 44px.

### Result

Remix now teaches itself through progressive disclosure: choose or write the goal, shape Nomi's proposed directions, then inspect and approve the exact coordinated changes. The merchant never has to configure automatic lifecycle suppression or product availability manually.

## Remix production implementation — 2 September 2026

Reviewed the implemented `/app/remix` Shopify route against the approved three-step Figma direction and the merchant-safety requirements.

### Screenshots captured

- `screenshots/remix-implementation-step1-desktop-1280.png`
- `screenshots/remix-implementation-step2-desktop-1280.png`
- `screenshots/remix-implementation-step3-desktop-1280.png`
- `screenshots/remix-implementation-step1-tablet-768.png`
- `screenshots/remix-implementation-step2-tablet-768.png`
- `screenshots/remix-implementation-step3-tablet-768.png`
- `screenshots/remix-implementation-step1-mobile-375.png`
- `screenshots/remix-implementation-step2-mobile-375.png`
- `screenshots/remix-implementation-step3-mobile-375.png`
- `screenshots/remix-implementation-email-preview.png`
- `screenshots/remix-implementation-gpt-config-error.png`

### Review findings

- Remix appears directly after Templates in Shopify app navigation and maintains the calm paper, ink, restrained-cyan, Lora/IBM Plex Sans direction.
- Step 1 makes both starter goals and an unmistakable campaign brief available. Discount ceilings are optional and product availability remains an automatic safeguard, not a redundant merchant choice.
- Step 2 exposes edit, remove, and add-direction controls. The generated routes are not silently accepted; the merchant explicitly advances to review.
- Step 3 exposes the campaign brief, only the genuinely unchanged lifecycle flows, previews of controlled email-safe HTML, and an explicit final approval action.
- Preview, edit, add, remove, validation-error, approved, and disabled states were exercised in Chrome. Approval persisted two compiled drafts and created zero email jobs.
- Desktop 1280px, tablet 768px, and mobile 375px renders have no page-level horizontal overflow. At 375px the Remix main surface measured `clientWidth: 344` and `scrollWidth: 344`; all visible controls met the 44px minimum target after the wordmark adjustment.
- The local missing-GPT configuration state produces a clear inline server error and preserves the merchant's inputs.

### Validation

- `npm.cmd test`: 21 files and 122 tests passed.
- `npm.cmd run build`: passed for client and SSR bundles.
- `npm.cmd run typecheck`: the only failures are the documented pre-existing `s-app-nav` JSX intrinsic-element typings in `app/routes/app.tsx`.

### Result

The approved Figma concept is now a working, persisted Remix workflow. GPT drafts routes, Claude reviews them, and Nomi compiles controlled HTML only after approval. Approval never sends email and does not change timing, audiences, offers, or lifecycle routing.

## Contacts, campaigns, brand settings, and cursor pass — 3 September 2026

### Screenshots captured

- `screenshots/backend-brand-settings-desktop-1280.png`
- `screenshots/backend-brand-settings-tablet-768.png`
- `screenshots/backend-brand-settings-mobile-375.png`

### Review findings

- The Brand & Settings page rendered correctly at 1280px, 768px, and 375px. Its branding controls remain legible and vertically reachable on mobile, with no horizontal overflow.
- Contacts loaded four real Shopify customers, with real totals, search, subscription/suppression filtering, pagination controls, and a functional Add contact dialog. The dialog exposes the expected identity, email, phone, and consent controls without creating a test customer during review.
- Campaigns loaded persisted Remix drafts with their actual updated dates, email counts, status, search field, pagination controls, and links back into the relevant Remix plan.
- The Nomi hand cursor is the default across the embedded app. Text fields retain a text cursor; disabled controls use not-allowed; draggable controls and scrollbars use grab/grabbing. Chrome computed-style checks confirmed the hand cursor for buttons/links and text cursor for inputs.
- Desktop, tablet, and mobile embedded app widths showed no page-level horizontal overflow: Contacts measured 1025/1025, 513/513, and 360/360 client/scroll widths; Campaigns measured the same at the corresponding breakpoints.

## Lumen storefront overhaul — 8 September 2026

The Tarn development storefront was rebuilt around the supplied Lumen ecosystem identity. Chrome verification covered the homepage at 1280px, 768px, and 375px; the live collection; desktop and mobile product pages; a successful add-to-bag path; the populated desktop and mobile bag; the mobile menu; all scroll reveals; image loading; control sizing; and page-level overflow. Final screenshots and detailed findings are recorded in `.design/lumen-storefront/DESIGN_REVIEW.md`.

## Lumen standalone HTML export — 8 September 2026

Exported the Lumen storefront concept as a single portable HTML file with embedded product artwork, responsive styles, scroll reveals, living-field pointer motion, mobile navigation, a demo bag interaction, and a local newsletter confirmation. Chrome verification covered 1280px, 768px, and 375px. The 768px pass identified and corrected hero CTA/artwork overlap; the final passes measured no page-level horizontal overflow, no broken images, no visible controls below 44px, and a functioning scroll-locked mobile menu. Screenshots are `screenshots/lumen-html-desktop-1280.png`, `screenshots/lumen-html-tablet-768.png`, `screenshots/lumen-html-mobile-375.png`, and `screenshots/lumen-html-mobile-menu-375.png`.

## Lumen multi-page skincare storefront — 8 September 2026

Expanded the Claude concept into a nine-page skincare-first prototype with restrained typography, animated ecosystem fields, collection filtering, product-detail structure, Skin Finder, ingredient library, FAQ, contact, and cart. Product photography remains intentionally empty with named 4:5 Firefly slots. Chrome verification passed at 1280px, 768px, and 375px with no final overflow, broken assets, or sub-44px visible controls. Full notes and screenshots are in `.design/lumen-storefront-v2/`.

## Lumen five-product catalog and photography — 8 September 2026

Replaced the six-product Tarn catalog with five active Lumen formulas: Canopy, Loam, Peat, Rime, and Rind. The former sixth product is archived. Each active product has three supplied photographs in a consistent primary, alternate, and detail sequence; the former Tarn media is removed.

### Screenshots captured

- `screenshots/lumen-storefront-desktop-1280.png`
- `screenshots/lumen-storefront-tablet-768.png`
- `screenshots/lumen-storefront-mobile-375.png`
- `screenshots/lumen-storefront-mobile-menu-375.png`
- `screenshots/lumen-products-desktop-1536.png`
- `screenshots/lumen-rind-product-desktop-1280.png`
- `screenshots/lumen-rind-product-mobile-375.png`

### Review findings

- The homepage shows exactly five product cards with the correct names, prices, formula types, and supplied primary photographs.
- Desktop 1280px, tablet 768px, and mobile 375px have no page-level horizontal overflow or broken loaded images.
- The mobile hero specimen was repositioned after the first review so it no longer overlaps the hero caption.
- Header actions and the primary hero/product CTAs meet the 44px minimum target; the main buttons render at 48px.
- The mobile menu opens with scroll lock, reports its expanded state, and closes cleanly.
- Rind's desktop and mobile product pages load all three supplied gallery images in order, preserve their aspect ratio, and keep the add-to-bag button fully visible.

## Lumen high-resolution photography replacement — 8 September 2026

Reconstructed all 15 product images as high-resolution ecommerce photography after the supplied 206×256px files appeared soft when enlarged. The new files preserve the five packaging systems, Lumen labels, warm studio palette, primary/alternate/detail sequence, and natural aspect ratios.

### Screenshots captured

- `screenshots/lumen-hd-home-desktop-1280.png`
- `screenshots/lumen-hd-home-tablet-768.png`
- `screenshots/lumen-hd-home-mobile-375.png`
- `screenshots/lumen-hd-products-desktop-1280.png`
- `screenshots/lumen-hd-rind-desktop-1280.png`
- `screenshots/lumen-hd-rind-mobile-375.png`

### Review findings

- Each active product now has exactly three ready high-resolution Shopify media items; all 15 low-resolution product-media records were removed.
- Source dimensions increased to approximately 1125×1400px for portrait photographs, with Loam's wide detail at 2170×725px.
- Live product cards request clean 320×400px responsive derivatives, the desktop Rind gallery receives approximately 742×922px images, and the mobile gallery receives full-width 375px derivatives.
- Chrome checks at 1280px, 768px, and 375px found no broken images or page-level horizontal overflow. Hero/product buttons remain 48px high, and the mobile hero specimen does not overlap its caption.

## Lumen warm editorial hero correction — 8 September 2026

Replaced the rejected dark blue-grey/purple hero with a product-derived palette of warm limestone, milk, charcoal, muted clay, and restrained olive. Removed the three framed product cards and rebuilt the hero artwork as one continuous studio still life using Canopy, Rime, and Loam together.

### Screenshots captured

- `screenshots/lumen-warm-hero-desktop-1280.png`
- `screenshots/lumen-warm-frameless-hero-desktop-1280.png`
- `screenshots/lumen-unified-hero-desktop-1280.png`

### Review findings

- The final desktop hero has no separate white product squares, borders, or pasted-card treatment.
- The generated still life keeps all three Lumen pack forms and labels legible while unifying light direction, surface, and shadows.
- The final WebP is 1122×1402px and approximately 42KB, avoiding the previous low-resolution enlargement and minimizing hero payload.
- Navigation, body copy, and both hero CTAs remain fully visible in the 1280px Chrome render; primary controls retain 44px-or-larger targets.
- Shopify Theme Check passes for the updated section and hero image asset.

## Lumen transparent animated-product hero — 8 September 2026

Replaced the static Canopy/Rime studio photograph with two independent transparent product cutouts. The products now sit directly on the warm Lumen page surface with no photographic rectangle, card, frame, or image-backed hero panel. Motion is intentionally concentrated in the product composition: opposing vertical float cycles, subtle rotational drift, a slow orbit line, a breathing contact shadow, and pointer-responsive depth movement. Reduced-motion preferences stop all of these effects.

### Screenshots captured

- `screenshots/lumen-transparent-animated-hero-desktop-1280.png`
- `screenshots/lumen-transparent-animated-hero-tablet-768.png`
- `screenshots/lumen-transparent-animated-hero-mobile-375.png`
- `screenshots/lumen-transparent-animated-hero-mobile-menu-375.png`

### Review findings

- Chrome confirmed that the hero-art container has no background image and both cutouts load without broken assets.
- Computed animation states confirmed separate Canopy and Rime movement plus the rotating orbit; the product transforms changed over time rather than remaining static.
- Desktop 1280px, tablet 768px, and mobile 375px measured equal document scroll and client widths, with no page-level horizontal overflow.
- On mobile, both animated products remain visible in the first viewport instead of being pushed below the hero copy.
- Tablet removes the small product caption and vertical batch note to avoid crowding the larger packaging.
- All visible hero/header controls remain at least 44px high. The mobile menu opens with `aria-expanded="true"`, locks body scrolling, and introduces no overflow.
- `npm.cmd run build` passes. Shopify Theme Check passes with the same eight existing warnings in unrelated/shared theme files and no errors.

## Lumen ecosystem and editorial motion refinement — 8 September 2026

Extended the transparent-product art direction beyond the hero. The Our Approach field now uses separate Rime, Canopy, and newly isolated Loam cutouts with scroll-linked entrances, three offset float cycles, a rotating orbital path, and moving markers. The Field Note panel now uses the isolated Rime bottle with independent float, orbit, and breathing-shadow motion. The default desktop navigation is complete with Shop, Our story, Ingredients, Journal, FAQ, and Contact.

### Screenshots captured

- `screenshots/lumen-motion-full-header-desktop-1280.png`
- `screenshots/lumen-ecosystem-motion-desktop-1280.png`
- `screenshots/lumen-editorial-motion-desktop-1280.png`
- `screenshots/lumen-motion-tablet-768.png`
- `screenshots/lumen-motion-tablet-menu-768.png`
- `screenshots/lumen-motion-mobile-375.png`
- `screenshots/lumen-ecosystem-motion-mobile-375.png`
- `screenshots/lumen-editorial-motion-mobile-375.png`

### Review findings

- Chrome computed styles confirmed that every ecosystem product, the editorial bottle, and both orbit systems have active animation names and changing transforms over time.
- The editorial Rime bottle remains fully contained inside its visual panel at desktop and mobile instead of being cropped.
- All three transparent ecosystem assets and the editorial asset loaded successfully with no broken images.
- Desktop 1280px, tablet 768px, and mobile 375px measured zero page-level horizontal overflow.
- The six-link desktop navigation fits cleanly at 1280px and switches to the complete responsive menu at 960px and below. The menu opens with `aria-expanded="true"` and exposes all six destinations.
- Primary buttons render at 48px high at every tested breakpoint.
- Shopify Liquid validation and `npm.cmd run build` pass. Theme Check reports only the same eight pre-existing advisory warnings.

## Lumen system/footer visual separation — 8 September 2026

Redesigned the final formula system as a warm mineral-and-clay ledger so it no longer blends into the charcoal footer. The section now uses a ghosted oversized `05`, a ruled translucent formula panel, stronger editorial numbering, and a soft horizontal sweep with title movement on row hover. The footer remains the quiet dark closing layer.

### Screenshots captured

- `screenshots/lumen-system-footer-contrast-desktop-1280.png`
- `screenshots/lumen-system-hover-desktop-1280.png`
- `screenshots/lumen-system-footer-contrast-tablet-768.png`
- `screenshots/lumen-system-footer-contrast-mobile-375.png`

### Review findings

- Desktop and tablet renders show an unmistakable light-to-charcoal boundary between the formula system and footer.
- The formula-row hover sweep and 5.6px title shift were confirmed from computed styles.
- Desktop 1280px, tablet 768px, and mobile 375px have no page-level horizontal overflow or broken images.
- Formula rows remain 88px high on desktop and tablet and 72px high on mobile.
- Shopify Liquid validation, Theme Check, and the production build pass; Theme Check retains only the same eight pre-existing advisory warnings.

## Lumen hero annotation cleanup — 8 September 2026

Removed the vertical `Batch 026 · Filled by hand` annotation and the `Canopy · Rime / two formulas in orbit` caption from the animated hero, including their unused responsive CSS. Chrome confirmed both strings and elements are absent at 1280px, 768px, and 375px while the two animated product assets remain intact. All three sizes have zero horizontal overflow; the final build and Liquid validation pass.

Screenshots: `screenshots/lumen-hero-cleanup-desktop-1280.png`, `screenshots/lumen-hero-cleanup-tablet-768.png`, and `screenshots/lumen-hero-cleanup-mobile-375.png`.

## Lumen scroll-driven product entrance — 9 September 2026

Changed the Our Approach product composition so Rind and Loam enter only in response to page scroll, ease into their final positions early enough to be read, and remain fully contained once settled. The previous looping product floats were removed; the background ribbons retain restrained ambient movement.

### Screenshots captured

- `screenshots/lumen-scroll-products-desktop-1280.png`
- `screenshots/lumen-scroll-products-tablet-768.png`
- `screenshots/lumen-scroll-products-mobile-375.png`
- `screenshots/lumen-scroll-products-mobile-375-settled.png`

### Review findings

- Both products are fully visible at the settled state on desktop, tablet, and mobile.
- The entrance is driven by a clamped, eased scroll progress value and uses only compositor-friendly transform and opacity changes.
- Mobile increases the field height to 34rem so the complete cleanser bottle and balm jar have sufficient room.
- The composition has no page-level horizontal overflow in the tested states, and reduced-motion visitors receive a fully visible static arrangement.

## Lumen content pages and varied motion — 9 September 2026

Published real Shopify resources for Our Story, Ingredients, Journal, and FAQ, then reviewed the custom page template on the development theme. Motion is intentionally page-specific: Our Story uses a product curtain and sequential principle copy, Ingredients uses a scaled index reveal with a mineral hover state, Journal uses alternating editorial entrances and scroll-linked product drift, and FAQ uses line-draw rows with animated answer expansion and plus-to-close rotation.

### Screenshots captured

- `screenshots/lumen-pages-our-story-motion-desktop-1280.png`
- `screenshots/lumen-pages-our-story-tablet-768.png`
- `screenshots/lumen-pages-our-story-mobile-375.png`
- `screenshots/lumen-pages-ingredients-desktop-1280.png`
- `screenshots/lumen-pages-ingredients-tablet-768.png`
- `screenshots/lumen-pages-ingredients-mobile-375.png`
- `screenshots/lumen-pages-journal-desktop-1280.png`
- `screenshots/lumen-pages-journal-tablet-768.png`
- `screenshots/lumen-pages-journal-mobile-375.png`
- `screenshots/lumen-pages-faq-desktop-1280.png`
- `screenshots/lumen-pages-faq-tablet-768.png`
- `screenshots/lumen-pages-faq-mobile-375.png`
- `screenshots/lumen-pages-faq-open-desktop-1280.png`

### Review findings

- All four navigation destinations resolve to complete custom pages instead of the branded 404 state.
- Chrome confirmed the new reveal classes activate only when their sections enter the viewport; Journal's product drift value changes with scroll position.
- FAQ expansion was tested interactively: the answer opens, the icon rotates 45 degrees, and the 44px icon target remains intact.
- Desktop 1280px, tablet 768px, and mobile 375px all report zero page-level horizontal overflow across every new page.
- The mobile layouts reorganize the story, ingredient, and journal grids instead of simply shrinking the desktop compositions.
- The accessibility skip link is now exposed on keyboard focus only, and every custom motion treatment is disabled by `prefers-reduced-motion`.
- `npm.cmd run build` and Shopify Theme Check pass. Theme Check retains only the eight known advisory warnings in shared theme files.

## Embedded navigation demo-store removal — 11 September 2026

Removed the obsolete Demo Store entry from Nomi's embedded navigation, along with its iframe route, route-only styling, and the disconnected static prototype under `public/demo-store/`. The published Shopify theme in `kiln-theme/` was not changed.

### Screenshots captured

- `screenshots/navigation-without-demo-store-desktop-1280.png`
- `screenshots/navigation-without-demo-store-tablet-768.png`
- `screenshots/navigation-without-demo-store-mobile-375.png`
- `screenshots/navigation-without-demo-store-mobile-menu-375.png`
- `screenshots/navigation-without-demo-store-mobile-menu-scrolled-375.png`

### Review findings

- Chrome confirmed that Demo Store is absent from the rendered embedded navigation at 1280px and 768px, and from the opened, internally scrolled Shopify mobile menu at 375px.
- Desktop, tablet, and mobile measured equal document client and scroll widths (1280/1280, 768/768, and 375/375), with no page-level horizontal overflow.
- The remaining navigation order, selected Brand Studio state, app content, and responsive Shopify admin shell remain intact.
- `npm.cmd run build` passes. `npm.cmd run typecheck` retains the documented pre-existing `s-app-nav` intrinsic-element typing gap in `app/routes/app.tsx`.
- The only console error observed was an unrelated Shopify Admin CDN metrics XHR timeout; no Nomi application error appeared.

## Embedded app launch recovery — 9 September 2026

Fixed the authenticated Shopify launch path after the new Brand Studio onboarding redirect. The redirect now preserves Shopify's initial `shop` and `host` parameters, the document shell exposes the App Bridge API-key metadata needed for direct deep-route recovery, and Shopify response handling remains at the parent app boundary instead of being repeated by feature routes.

### Screenshots captured

- `screenshots/nomi-auth-launch-desktop-1440.png`
- `screenshots/nomi-auth-launch-tablet-768.png`
- `screenshots/nomi-auth-launch-mobile-375.png`

### Review findings

- Chrome confirmed a fresh launch and a direct deep-route reload both recover into the authenticated Nomi UI instead of the blank `$` response.
- No feature workflow, generated content, or feature styling was changed.
- Desktop, tablet, and mobile all report zero iframe-level horizontal overflow and zero broken images.
- Existing controls remain visible at all tested breakpoints; their feature-level sizing and behavior were left unchanged.

## Brand Studio replay setup — 10 September 2026

Added a no-cost walkthrough mode from the Flow Editor and completed Brand
Studio screen. Chrome verified the authenticated six-stage replay end to end;
the setup cost stayed `$0.18`, the saved `Alpine Editorial` system remained
unchanged, and the replay controls met the 44px target. Responsive screenshots
at 1280px, 768px, and 375px are recorded under
`.design/brand-studio/screenshots/replay-setup-*` with no horizontal overflow.

## Figma Make onboarding standalone export — 11 September 2026

Exported Version 26 of the Figma Make onboarding project and compiled its React,
Tailwind, and interaction code into one uploadable standalone HTML file.

### Screenshots captured

- `screenshots/figma-make-v26-html-desktop-1280.png`
- `screenshots/figma-make-v26-html-tablet-768.png`
- `screenshots/figma-make-v26-html-mobile-375.png`

### Review findings

- The single-file build renders without separate `/assets` dependencies and preserves stage navigation.
- Desktop and tablet report no page-level horizontal overflow; the mobile layout also fits its effective 360px browser viewport without overflow.
- The primary `Read my store` CTA remains 48px high.
- The exported prototype controls were moved into normal document flow below 640px and increased to 44px targets so they no longer cover onboarding copy or the primary CTA.
- The Figma Make production build passes before inlining.

## Brand Studio onboarding Steps 1-3 Figma Make port - 11 September 2026

Applied the approved Figma Make opening sequence to the live Brand Studio
onboarding while preserving the existing Shopify-backed data and form actions.
Only Steps 1-3 were restyled and restructured; Steps 4-7 remain unchanged.

### Screenshots captured

- `screenshots/brand-studio-onboarding-step1-desktop-1280.png`
- `screenshots/brand-studio-onboarding-step1-tablet-768.png`
- `screenshots/brand-studio-onboarding-step1-mobile-375.png`
- `screenshots/brand-studio-onboarding-step2-desktop-1280.png`
- `screenshots/brand-studio-onboarding-step2-tablet-768.png`
- `screenshots/brand-studio-onboarding-step2-mobile-375.png`
- `screenshots/brand-studio-onboarding-step3-desktop-1280.png`
- `screenshots/brand-studio-onboarding-step3-tablet-768.png`
- `screenshots/brand-studio-onboarding-step3-mobile-375.png`

### Review findings

- Chrome verified Steps 1-3 at 1280px, 768px, and 375px with equal document
  client and scroll widths at every breakpoint and no broken images.
- The Step 2 and Step 3 Edit states open correctly; Save and Cancel remain
  available, and the stored Shopify values continue to populate the forms.
- The opening progress treatment uses filled segments rather than loose tick
  marks. The Step 1 evidence collage and Step 3 cards retain the approved
  motion and respect the existing reduced-motion override.
- All visible CTAs, Edit controls, and Finish later targets measure at least
  44px high. Mobile primary actions expand to the available width.
- No browser console errors were observed across the nine verification runs.
- `npm.cmd run build` passes. `npm.cmd run typecheck` retains only the
  documented pre-existing `s-app-nav` intrinsic-element errors in
  `app/routes/app.tsx`.

## Brand Studio A1 evidence confirmation - 14 September 2026

Added the merchant-confirmation surface between evidence analysis and creative
direction generation. The detected logo, semantic palette, typography hints,
and published-theme provenance sit in one restrained evidence board.

### Screenshots captured

- `screenshots/brand-studio-a1-evidence-desktop-1280.png`
- `screenshots/brand-studio-a1-evidence-tablet-768.png`
- `screenshots/brand-studio-a1-evidence-mobile-375.png`
- `screenshots/brand-studio-a1-evidence-edit-mobile-375.png`

### Review findings

- Chrome checks at 1280px, 768px, and 375px showed no horizontal overflow.
- The board keeps a two-column composition on desktop/tablet, then becomes a
  single-column mark/type layout with a two-column palette on mobile.
- The approval CTA measures 46px high and expands to full width on mobile.
  `Finish later` and edit controls remain at least 44px high; evidence links
  use expanded pseudo-element hit areas.
- The summary edit state was opened and verified at 375px. Inputs have a clear
  focus treatment and no controls overlap adjacent copy.
- The only console noise was the existing local Chrome-extension hydration
  injection warning at the document root; the route remained interactive.

## Email Lab direction-card simplification - 14 September 2026

Removed the visible **Image treatment** detail from each of the three
generated direction cards. The field remains part of the generation contract,
where it continues to guide the resulting email composition.

### Screenshots captured

- `screenshots/email-lab/email-lab-nishorama-no-image-treatment-desktop-1280.png`
- `screenshots/email-lab/email-lab-nishorama-no-image-treatment-tablet-768.png`
- `screenshots/email-lab/email-lab-nishorama-no-image-treatment-mobile-375.png`

### Review findings

- Generated and inspected Calm, Bold, and Editorial from the live Nishorama
  storefront scan. Each card renders **Composition** and **Voice** only; no
  visible `Image treatment` heading remains.
- At tablet and mobile, the expanded editorial card keeps its copy and CTA
  visible without horizontal overflow. Embedded client and scroll widths
  matched (497px at tablet; 344px at mobile), and the choose CTA remained
  48px high.
- Clicking each of the two compact alternative controls was checked live:
  Calm, Bold, and Editorial each became active in turn, while exactly two
  concise alternative controls remained visible.

## Brand Studio onboarding Steps 4-7 implementation - 12 September 2026

Replaced the previous Create, Choose, Confirm/Build, and Complete experience
with the supplied Steps 4-7 standalone direction while preserving the live
Shopify evidence, saved creative directions, replay mode, refinement note,
finalization action, Brand System, and 13 lifecycle-email recipes.

### Screenshots captured

- `screenshots/brand-studio-steps-4-7-directions-desktop-1280.png`
- `screenshots/brand-studio-steps-4-7-direction-keyboard-selected-desktop.png`
- `screenshots/brand-studio-steps-4-7-confirm-desktop-1280.png`
- `screenshots/brand-studio-steps-4-7-complete-desktop-1280.png`
- `screenshots/brand-studio-steps-4-7-directions-tablet-768.png`
- `screenshots/brand-studio-steps-4-7-confirm-tablet-768.png`
- `screenshots/brand-studio-steps-4-7-complete-tablet-768.png`
- `screenshots/brand-studio-steps-4-7-directions-mobile-375.png`
- `screenshots/brand-studio-steps-4-7-confirm-mobile-375.png`
- `screenshots/brand-studio-steps-4-7-complete-mobile-375.png`

### Review findings

- Chrome checks ran in the merchant's authenticated `ombarvaliya7@gmail.com`
  Shopify session at 1280px, 768px, and 375px. The embedded app reported equal
  client and scroll widths at every checked state, with no horizontal overflow.
- The direction accordion responds to pointer and keyboard selection, exposes
  a clear focus state, and preserves the chosen direction into confirmation.
- Replay-mode submission exercised the complete confirmation -> build ->
  completion route without spending AI budget. The transient Create and Build
  states mounted successfully while the real form actions were pending.
- Confirmation-note Edit and Done controls measure 44px high. Finish later,
  direction selection, Build, Replay story, and Review my emails controls all
  meet or exceed the 44px touch-target requirement at their tested breakpoints.
- Mobile cards stack cleanly, the confirmation ticket collapses to one column,
  completion actions fill the available width, and no copy or CTA overlaps.
- `npm.cmd run build` passes after the final UI change. `git diff --check`
  reports no whitespace errors in the changed application files.

## Brand Studio animation and evidence follow-up - 12 September 2026

Aligned the scan, direction-creation, refinement-note, return-navigation, and
13-email build behavior more closely with the supplied standalone HTML. The
animations now complete before the route advances, and the storefront collage
uses a full set of non-product evidence signals.

### Screenshots captured

- `screenshots/brand-studio-scan-fix-complete-desktop-1280.png`
- `screenshots/brand-studio-scan-fix-complete-tablet-768.png`
- `screenshots/brand-studio-scan-fix-complete-mobile-375.png`
- `screenshots/brand-studio-create-fix-start-desktop-1280.png`
- `screenshots/brand-studio-create-fix-mid-desktop-1280.png`
- `screenshots/brand-studio-create-fix-complete-desktop-1280.png`
- `screenshots/brand-studio-confirm-note-fix-idle-desktop-1280.png`
- `screenshots/brand-studio-confirm-note-fix-edit-desktop-1280.png`
- `screenshots/brand-studio-confirm-note-fix-edit-mobile-375.png`
- `screenshots/brand-studio-directions-return-fix-desktop-1280.png`
- `screenshots/brand-studio-build-fix-complete-desktop-1280.png`
- `screenshots/brand-studio-build-fix-complete-tablet-768.png`
- `screenshots/brand-studio-build-fix-complete-mobile-375.png`

### Review findings

- Chrome verification used only the merchant's authenticated
  `ombarvaliya7@gmail.com` Shopify session.
- The scan now reveals storefront, homepage voice, palette, display type,
  brand signal, and voice pattern cards. No product name, product card, or
  product image appears in the collage.
- The scan holds through its final composition frame, direction creation holds
  after all three rows become Ready, and the build holds at 13 of 13 before
  the completion route opens.
- `See all directions` returns from confirmation to the chooser with all three
  direction options present.
- The note Edit control now matches the compact pencil-pill treatment in the
  standalone HTML. Edit, filled, and Done states work; Edit and Done are at
  least 44px high.
- Desktop, tablet, and mobile app surfaces report equal client and scroll
  widths, with no horizontal overflow. The mobile Build CTA remains 48px high.
- `npm.cmd run build` and `git diff --check` pass. `npm.cmd run typecheck`
  retains only the documented pre-existing `s-app-nav` intrinsic-element
  errors in `app/routes/app.tsx`.

## Brand evidence board composition follow-up - 12 September 2026

Recomposed the opening scan collage to match the supplied loose, tactile
evidence-board reference without reintroducing product cards or imagery. The
six retained signals now arrive as individually placed notes and color objects.

### Screenshots captured

- `screenshots/brand-studio-evidence-board-entrance-desktop-1280.png`
- `screenshots/brand-studio-evidence-board-desktop-1280.png`
- `screenshots/brand-studio-evidence-board-tablet-768.png`
- `screenshots/brand-studio-evidence-board-mobile-375.png`

### Review findings

- Chrome verification used only the merchant's authenticated
  `ombarvaliya7@gmail.com` Shopify session.
- The board contains six brand-only signals and zero product notes or product
  images: storefront, homepage voice, palette, display serif, brand signal,
  and voice pattern.
- Notes use varied scale, position, rotation, and shadow; the display-serif
  specimen is yellow and the palette is rendered as two complete, equally
  sized Olive and Terracotta tiles, matching the supplied reference.
- The entrance reveals all six pieces individually and applies a settle
  animation to each note. The completed state is held for roughly two seconds
  before the route advances, and reduced-motion preferences still collapse
  motion.
- The embedded app reported equal client and scroll widths at tablet and mobile
  (`513px` at the 768px Shopify viewport and `360px` at the 375px viewport),
  with all six evidence items visible and no horizontal overflow.

## See all directions navigation fix - 12 September 2026

Separated confirmation-page navigation state from the lifecycle build state so
the directions link no longer renders the build animation while its route loads.

### Screenshots captured

- `screenshots/brand-studio-see-directions-direct-desktop-1280.png`
- `screenshots/brand-studio-see-directions-direct-tablet-768.png`
- `screenshots/brand-studio-see-directions-direct-mobile-375.png`

### Review findings

- Chrome verification used only the authenticated `ombarvaliya7@gmail.com`
  Shopify session.
- Clicking `See all directions` produced zero build-state renders during the
  transition and landed directly on `?step=directions&replay=1`.
- Alpine Editorial, Slope Graphic, and Ridge Catalogue were all present on the
  destination screen.
- The directions view reported equal client and scroll widths at desktop,
  tablet, and mobile; there was no horizontal overflow.

## Completion seal alignment follow-up - 12 September 2026

Rebuilt the completion seal as a concentric 72px mark so its color rim,
dashed orbit, green medallion, and paper-plane glyph share one optical center.

### Screenshots captured

- `screenshots/brand-studio-seal-aligned-desktop-1280.png`
- `screenshots/brand-studio-seal-aligned-tablet-768.png`
- `screenshots/brand-studio-seal-aligned-mobile-375.png`

### Review findings

- Chrome verification used only the authenticated `ombarvaliya7@gmail.com`
  Shopify session.
- Browser geometry measurements report a `0px` horizontal and vertical offset
  between the paper-plane glyph and seal center at desktop and tablet. Mobile
  differs vertically only by sub-pixel rounding (`0.000015px`).
- The stacked mobile heading and side-by-side desktop/tablet headings remain
  balanced, with the complete seal visible and no clipping.
- Desktop, tablet, and mobile report equal client and scroll widths; there is
  no horizontal overflow.

## Build progress synchronization follow-up - 13 September 2026

Removed the Shopify route-level loading line specifically from the email-build
submission. The build card is now the single source of progress, advances at a
slower cadence, and is capped below completion while the server is still busy.

### Screenshots captured

- `screenshots/brand-studio-progress-authoritative-desktop-1280.png`
- `screenshots/brand-studio-progress-authoritative-tablet-768.png`
- `screenshots/brand-studio-progress-authoritative-mobile-375.png`

### Review findings

- Chrome verification used only the authenticated `ombarvaliya7@gmail.com`
  Shopify session and exercised the actual replay-build action at every
  breakpoint.
- The route-level blue line had zero rendered instances throughout the live
  build at desktop, tablet, and mobile, leaving only the in-card indicator.
- The email cadence now advances every `650ms` and cannot announce the
  thirteenth email while the server request remains pending. It proceeds from
  the pending sequence directly to the completed Brand System when the server
  confirms success.
- Desktop, tablet, and mobile reported zero horizontal overflow. The build
  card, progress label, animated press, and all thirteen status chips remained
  visible without overlap or clipping.

## Completion seal checkmark update - 12 September 2026

Updated the final Brand Studio success seal to match the approved reference:
separate pink and blue discs sit behind the centered green medallion, the
dashed orbit stays visible, and a rounded white checkmark replaces the
paper-plane glyph.

### Screenshots captured

- `screenshots/brand-studio-check-seal-exact-desktop-1280.png`
- `screenshots/brand-studio-check-seal-exact-tablet-768.png`
- `screenshots/brand-studio-check-seal-exact-mobile-375.png`

### Review findings

- Chrome verification used the authenticated `ombarvaliya7@gmail.com`
  Shopify session.
- The SVG checkmark and 72px seal share the same measured center at desktop
  and tablet. Mobile differs vertically only by sub-pixel rounding
  (`0.000015px`).
- The pink upper-left and blue lower-right rim remain visible around the green
  success medallion, matching the supplied visual direction.
- The success heading remains balanced in its side-by-side desktop/tablet and
  stacked mobile layouts, with no clipping or broken assets.
- All three responsive checks report equal client and scroll widths; there is
  no horizontal overflow.

## Brand-intent pause and Step 4 timing polish - 13 September 2026

Kept the full Step 3 card showcase visible for a 5-second reading pause and
slowed the Step 4 direction-composition sequence slightly. Step 4 now reveals
its states at 1.2s, 2.5s, and 3.8s, while the route holds for at least 5.2s so
the completed three-direction state is visible before the next page.

### Screenshots captured

- `screenshots/brand-studio-intent-auto-pause-desktop-1280.png`
- `screenshots/brand-studio-intent-edit-cta-desktop-1280.png`
- `screenshots/brand-studio-intent-slower-hold-desktop-1280.png`
- `screenshots/brand-studio-intent-screen-click-paused-desktop-1280.png`
- `screenshots/brand-studio-intent-screen-click-paused-tablet-768.png`
- `screenshots/brand-studio-intent-screen-click-paused-mobile-375.png`
- `screenshots/brand-studio-creating-slower-desktop-1280.png`
- `screenshots/brand-studio-creating-slower-tablet-768.png`
- `screenshots/brand-studio-creating-slower-mobile-375.png`

### Review findings

- Chrome verification used only the authenticated `ombarvaliya7@gmail.com`
  Shopify session.
- At 4.7 seconds after Step 3 became visible, the full assumptions screen was
  still present and the default `Create my directions` CTA count was zero. The
  untouched path advanced to Step 4 after the 5-second reading pause.
- Clicking anywhere in the Step 3 content, including either Edit control,
  cancelled automatic advancement and revealed the manual CTA. The clicked
  path remained on Step 3 beyond six seconds, and pressing the CTA opened Step
  4 successfully.
- Step 4 reported one active composition before 1.2 seconds, then one, two,
  and all three ready states across the slowed reveal. The fully-ready state
  remained on screen before the directions page appeared.
- The changed Step 3 interaction and Step 4 state completed without horizontal
  overflow at desktop, tablet, or mobile widths; all measured client and scroll
  widths matched. The revealed CTA measured at least 44px high at every tested
  breakpoint.

## Seven-stage Brand Studio rail - 13 September 2026

Extended the onboarding rail from six to seven meaningful stages. The existing
completion view is now represented by a final green `Ready` segment, while the
current-step count is derived from the rail itself instead of a hard-coded
total.

### Screenshots captured

- `screenshots/brand-studio-seven-step-rail-desktop-1280.png`
- `screenshots/brand-studio-seven-step-rail-tablet-768.png`
- `screenshots/brand-studio-seven-step-rail-mobile-375.png`
- `screenshots/brand-studio-seven-step-ready-desktop-1280.png`
- `screenshots/brand-studio-seven-step-ready-tablet-768.png`
- `screenshots/brand-studio-seven-step-ready-mobile-375.png`

### Review findings

- Chrome verification used only the authenticated `ombarvaliya7@gmail.com`
  Shopify session.
- The Choose screen reports `Step 5 / 7` and renders exactly seven rail
  segments at desktop, tablet, and mobile widths.
- The completion view reports `Step 7 / 7 — Ready`, with six completed
  segments and one active final segment.
- All tested views reported matching client and scroll widths, with no clipped
  progress label or horizontal overflow.

## Direct Snapshot-to-Create flow and progress pacing - 13 September 2026

Removed the former Brand Intent screen from the onboarding sequence. Snapshot
now carries its approved evidence and inferred audience/feeling directly into
direction creation, so the live rail contains six real stages: Scan, Snapshot,
Create, Choose, Build, and Ready.

The blue route-progress line now moves linearly over the known action duration
instead of filling in 420ms and waiting at the edge. Direction creation uses a
5.2-second track; store analysis uses 3.7 seconds; short ordinary route changes
use 1.1 seconds. The line deliberately stops at 99% until navigation resolves.

### Screenshots captured

- `screenshots/brand-studio-direct-create-slow-progress-desktop-1280.png`
- `screenshots/brand-studio-direct-create-slow-progress-tablet-768.png`
- `screenshots/brand-studio-direct-create-slow-progress-mobile-375.png`

### Review findings

- Chrome verification used only the authenticated `ombarvaliya7@gmail.com`
  Shopify session.
- Snapshot transitioned directly to `Step 3 / 6 — Create`; the removed working-
  assumptions screen had zero rendered instances throughout each test.
- The blue line reported a `5.2s` linear animation. Mid-transition measurements
  were approximately 44% at desktop and 36–37% at tablet/mobile, confirming it
  no longer races immediately to the far edge.
- Desktop, tablet, and mobile reported no horizontal overflow while the route
  progress and creating animation were both active.

## Email Lab - 13 September 2026

Added a standalone, no-send Email Lab at `/app/email-lab`. It appears in the
existing app navigation and leaves the onboarding, Brand Studio, live flows,
and store data untouched. The initial view collects a public storefront URL;
the later stages create temporary visual directions and four refinable email
previews.

### Screenshots captured

- `screenshots/email-lab/email-lab-desktop-1280.png`
- `screenshots/email-lab/email-lab-tablet-768.png`
- `screenshots/email-lab/email-lab-mobile-375.png`
- `screenshots/email-lab/email-lab-focus-1280.png`

### Review findings

- Verified inside the authenticated Shopify Admin shell at desktop, tablet,
  and mobile viewports.
- The Email Lab navigation entry is present and selected on every rendered
  state. No analysis or generation request was submitted during visual review.
- The public URL field and primary CTA both measure 54px high; focus remains
  visible and no longer moves the hero composition.
- Tested embedded widths reported matching client and scroll widths (1040px,
  528px, and 375px respectively), with no horizontal overflow or clipped CTA
  copy.

## Email Lab asset-first and two-email pass - 13 September 2026

The Lab now describes and runs a constrained two-email experiment: Welcome and
Abandoned Cart. Its storefront scan collects the official logo, real product
images, product URLs, available prices, observed colors, and font cues. The
generator rejects an output if it omits the real product image, or an available
official logo.

### Review findings

- Rechecked the updated copy in authenticated Shopify Admin at desktop, tablet,
  and mobile widths.
- The mobile embedded view reported equal client and scroll widths (375px), so
  the revised asset-first explanation does not introduce horizontal overflow.
- The primary URL CTA remains 54px high.

## Email Lab brand-token and direction-chooser correction - 14 September 2026

Reworked the live Email Lab chooser to follow the paper-led composition of the
approved Figma Make reference. Direction controls are now clear and compact;
the active state no longer overlaps them. More importantly, public storefront
palette evidence is ranked by repeated use instead of source order, preventing
an incidental widget colour from becoming the brand's visual identity.

### Screenshots captured

- `screenshots/email-lab/email-lab-nishorama-final-desktop-1280.png`
- `screenshots/email-lab/email-lab-nishorama-final-card-desktop-1280.png`
- `screenshots/email-lab/email-lab-nishorama-final-tablet-768.png`
- `screenshots/email-lab/email-lab-nishorama-final-mobile-375.png`

### Review findings

- Nishorama's visible storefront was inspected directly. Its final shared
  palette is the four most repeated public colors: warm brown `#482922`,
  black, white, and off-white; the earlier blue/green widget colors are no
  longer eligible to dominate the direction UI.
- Calm, Bold, and Editorial receive the exact same palette and detected
  Archivo / Assistant typography. Only composition, image treatment, and
  copy vary.
- The active direction has one unambiguous status label; the two alternatives
  are compact, keyboard-accessible controls. Selecting Bold correctly swaps
  the expanded card and preserves the two remaining controls.
- Chrome checks at 1280px, 768px, and 375px reported matching client and
  scroll widths (1025px, 513px, and 360px respectively). No horizontal
  overflow was observed; the primary choose CTA measured 48px at each tested
  size.
- `npm.cmd run build` passes. `npm.cmd run typecheck` retains only the
  documented pre-existing `s-app-nav` intrinsic-element errors in
  `app/routes/app.tsx`.

## Brand Studio A1 email press proof - 15 September 2026

Added a merchant-visible, fail-closed A1 proof to the generated 13-email family.
The proof is deliberately editorial rather than dashboard-like: one restrained
status strip, five flow groups, a contained 600px email preview, and per-email
readiness notes. It does not enable sending, and new Brand Studio output is not
persisted as complete unless every email and the family as a whole pass.

### Screenshots captured

- `screenshots/brand-studio-a1-proof-desktop-1280.png`
- `screenshots/brand-studio-a1-proof-tablet-768.png`
- `screenshots/brand-studio-a1-proof-mobile-375.png`
- `screenshots/brand-studio-a1-proof-cart-selected-1280.png`

### Review findings

- The deliberately generic review fixture is correctly rejected at 0 of 13
  A1-ready. The proof identifies repeated preheaders and body copy at family
  level, then identifies placeholder language, missing useful copy, and missing
  real product imagery/destinations per email. This verifies that technical HTML
  safety alone cannot produce an A1-ready result.
- The creation action now compiles and audits all 13 outputs before persistence.
  It requires all five compositions, distinct copy, Brand System constraints,
  and real public product assets/links wherever the recipe is product-led.
- Flow expansion and email selection were exercised in Chrome. Opening
  Abandoned Cart selected its first email; selecting the second cart email
  updated the preview heading, pressed state, and iframe title while keeping a
  visible focus treatment.
- Desktop, tablet, and mobile checks reported no horizontal overflow. Measured
  buttons were 49px or 68px high and both links were 44px high at every tested
  breakpoint.
- Chrome exposed a server/client `srcDoc` mismatch caused by a browser-only
  `<base>` injection. The injection was removed so the iframe HTML is identical
  during server render and hydration. A remaining generic hydration warning is
  caused by the Codex browser's `codex-browser-sidebar-comments-root` element
  being injected directly under `<html>`, not by application markup.
- Product-image and CTA omissions are blocking A1 issues for product-led
  recipes. They are never replaced with invented URLs; the merchant is sent to
  Flow Editor to supply real evidence instead.

## Full-creative lifecycle emails and branded footer - 15 September 2026

Replaced the recipe-only creative ceiling with a validated final-art-direction
stage. Claude now owns the finished composition in five flow-sized passes,
including contrast, product staging, CTA treatment, responsive rhythm, and the
closing panel. Stored authored documents are used in Templates; the improved
deterministic compiler remains the safe fallback.

### Screenshots captured

- `screenshots/generated-emails-full-creative-desktop-1280.png`
- `screenshots/generated-emails-full-creative-tablet-768.png`
- `screenshots/generated-emails-full-creative-mobile-375.png`
- `screenshots/generated-emails-footer-desktop-1280.png`

### Review findings

- The controlled Lumen press proof now passes at 13 of 13 A1-ready with five
  distinct compositions. Product-led layouts render every requested real
  product image and use the real storefront as a safe CTA fallback when the
  catalogue has no public product destination.
- The hero establishes a clear visual hierarchy: one dominant product image,
  a large specific headline, one high-contrast CTA, and a supporting product
  edit. Images retain their natural aspect ratios and scroll inside the fixed
  email viewport without cropping.
- The footer is a composed brand ending rather than an isolated disclaimer: a
  primary-color rule, confident Lumen wordmark, restrained brand motif, and
  quiet compliance copy on an ink field. Its mobile rule stacks the utility
  copy below the brand block.
- Chrome checks at 1280px, 768px, and 375px showed no visible page-level
  horizontal overflow, clipped labels, overlapping controls, or broken product
  assets. The selected row, expanded/collapsed flow behavior, live-preview
  scrolling, and footer state were exercised. Visible merchant CTAs retain the
  existing 44px-or-larger targets at all three breakpoints.

## Brand evidence refresh control - 15 September 2026

Added a restrained verification panel to the Brand Studio Ready screen. It
keeps Shopify/storefront scanning as the default while giving merchants one
clear recovery action after a logo, theme, palette, product, or name change.

### Screenshots captured

- `screenshots/brand-studio-evidence-refresh-desktop-1280.png`
- `screenshots/brand-studio-evidence-refresh-tablet-768.png`
- `screenshots/brand-studio-evidence-refresh-mobile-375.png`
- `screenshots/brand-studio-evidence-stale-desktop-1280.png`

### Review findings

- The control is visually secondary to `Review my emails`, explains exactly
  what triggers a rebuild, and states that nothing sends automatically.
- Current and refresh-needed copy states were checked in Chrome. The rescan
  target measures 48px high on mobile, expands to the available 308px width,
  and has explicit hover and keyboard-focus treatment.
- At 375px the document reported equal 360px client and scroll widths. Desktop,
  tablet, and mobile screenshots showed no clipping, overlapping controls, or
  horizontal page overflow.

## Lumen email product photography repair - 16 September 2026

Repaired the Flow Editor's Lumen email previews so the existing product
photographs render above their names. The demo had imported the photographs as
`data:` URLs, which the email-safe compiler correctly discarded; it now uses
the existing public product assets, and the compiler permits only safe
root-relative preview image paths in addition to normal HTTP(S) assets.

### Screenshots captured

- `screenshots/lumen-email-product-images-desktop-1280.png`
- `screenshots/lumen-email-product-images-tablet-768.png`
- `screenshots/lumen-email-product-images-mobile-375.png`

### Review findings

- The reported second Welcome email renders Loam and Peat photography rather
  than captions alone. Chrome reported three complete product images with real
  206×256 source dimensions and no broken asset state.
- The photographs retain their source aspect ratio inside the email's fixed,
  internally scrolling viewport; there is no forced crop or page-level
  horizontal overflow at desktop, tablet, or mobile.
- The nearby Rewrite action now retains a 44px minimum touch target on the
  compact responsive layout.
- Embedded base64/data images, protocol-relative URLs, traversal paths, and
  unsafe schemes remain rejected by the compiler.
## Shopify product photography in Lumen emails — 16 September 2026

Replaced the authenticated dashboard, Flow Editor, and Brand Settings product
fixture with the connected Shopify store's complete active catalogue. Product
titles, prices, destinations, and featured photography now come from paginated
Admin GraphQL data while the controlled email identity remains Lumen.

### Screenshots captured

- `screenshots/lumen-shopify-products-desktop-1280.png`
- `screenshots/lumen-shopify-products-tablet-768.png`
- `screenshots/lumen-shopify-products-mobile-375.png`

### Review findings

- Chrome confirmed all five active Shopify products — Canopy, Loam, Rime,
  Peat, and Rind — load complete high-resolution `cdn.shopify.com` featured
  images in Brand Settings.
- The selected Welcome email renders three complete Shopify-hosted product
  images with no broken asset state at 1280px, 768px, or 375px.
- The rendered email says Lumen in its header, subject, and footer; it does not
  inherit the development shop account name as the merchant identity.
- Email document `scrollWidth` matched `clientWidth` at every breakpoint, with
  no horizontal overflow. The internally scrolling preview remains contained.
- The nearby Rewrite CTA measures 44px high and remains fully visible at all
  three breakpoints after correcting the stale stylesheet cache key.

## Final Lumen open-art-direction family — 16 September 2026

The stale Nomi/Alpine proof was rejected and replaced with a newly generated
Lumen family using only the five real Lumen Shopify product photographs.

### Screenshots captured

- `screenshots/lumen-final-emails-desktop-1280.png`
- `screenshots/lumen-final-emails-cart-desktop-1280.png`
- `screenshots/lumen-final-emails-tablet-768.png`
- `screenshots/lumen-final-emails-mobile-375.png`

### Review findings

- Chrome reports 13 of 13 emails A1-ready and 13 distinct rendered structures.
- Welcome is an expansive catalogue thesis, Cart is a compact single-product
  recovery composition, and Care is a numbered post-purchase ritual. The flows
  retain Lumen's palette and voice without sharing one visual grammar.
- The preview contains only Lumen copy and Canopy, Loam, Peat, Rime, and Rind
  imagery. No snowboard or Alpine content remains in the current family.
- At 1280px, 768px, and 375px, document `scrollWidth` equals `clientWidth`.
  No page-level horizontal scrolling, clipped controls, overlapping copy, or
  broken assets were observed.
- Every tested link and button measured at least 44px high. Flow selection,
  expansion, selected state, and internally scrolling email preview remained
  functional across the three breakpoints.

## Lifecycle-only dashboard scope — 16 September 2026

Aligned the dashboard with the approved lifecycle-only product scope. The
visible flow names are now Welcome, Still Interested?, Abandoned Cart, How Was
It?, and Welcome Back; no order confirmation, shipping notification, refund,
or receipt controls remain on the dashboard.

### Screenshots captured

- `screenshots/lifecycle-scope-dashboard-desktop-1280.png`
- `screenshots/lifecycle-scope-dashboard-tablet-768.png`
- `screenshots/lifecycle-scope-dashboard-mobile-375.png`

### Review findings

- Chrome confirmed all five approved flow labels and the 13-of-13 lifecycle
  readiness count in the live Shopify embed.
- The dashboard was checked at 1280px, 768px, and 375px. Page-level content
  stayed within the viewport; wide data tables remain intentionally contained
  in their own horizontal scrollers at tablet and mobile widths.
- All visible dashboard buttons and links measure at least 44px high after the
  touch-target correction. The trial CTA, flow links, campaign/form links, and
  app-embed action remain visible without overlapping adjacent copy.
- No broken assets, clipped headings, or lifecycle-label regressions were
  observed. Shopify's development-console drawer is host chrome and does not
  affect the embedded app layout.

## Brand-led direction chooser and build handoff — 16 September 2026

Replaced the snowboard-specific direction cards with a responsive chooser
driven by the connected store's scanned palette. Calm, Modern, and Editorial
now share brand colours while differing through typography, hierarchy,
spacing, image treatment, and voice. Confirm and build carry the selected
direction forward, and the 13 build boxes use the supported lifecycle slots.

### Screenshots captured

- `screenshots/brand-studio-directions-desktop.png`
- `screenshots/brand-studio-directions-tablet.png`
- `screenshots/brand-studio-directions-mobile.png`
- `screenshots/brand-studio-direction-modern-desktop.png`
- `screenshots/brand-studio-direction-editorial-desktop.png`
- `screenshots/brand-studio-direction-editorial-mobile.png`
- `screenshots/brand-studio-confirm-desktop.png`
- `screenshots/brand-studio-confirm-mobile.png`
- `screenshots/brand-studio-build-desktop.png`
- `screenshots/brand-studio-build-tablet.png`
- `screenshots/brand-studio-build-mobile.png`

### Review findings

- Calm retains the warm Lora system. Modern uses a measured IBM Plex Sans
  hierarchy without poster-style all caps. Editorial uses Source Serif 4,
  italic display contrast, narrower measures, and a ruled quotation treatment.
- Selecting a desktop rail or a 44px mobile tab changes the expanded direction;
  all three retain the identical four scanned brand colours.
- The primary direction CTA is 48px high. Confirm actions remain at least 44px
  high and do not overlap adjacent copy.
- The tablet build ticket now collapses to one column, preventing the preview
  from creating a tall empty column beside the 13-email status grid.
- Chrome reported no horizontal page overflow at 1440px, 768px, or 375px.
  The build state rendered exactly 13 boxes with only Welcome, Follow-Up,
  Cart, Thank You, Review Request, and Winback lifecycle labels.

## Lumen preview and lifecycle-label polish — 16 September 2026

Removed the intersecting line motif from the confirmation preview, replaced
technical ordinal email names with merchant-readable message names, and made
Lumen the visible Brand Studio identity throughout the shell and preview.

### Screenshots captured

- `screenshots/brand-studio-lumen-labels-desktop-1280.png`
- `screenshots/brand-studio-lumen-labels-tablet-768.png`
- `screenshots/brand-studio-lumen-labels-mobile-375.png`

### Review findings

- The preview art now uses one restrained brand dot and dashed orbit; the
  intersecting cross lines are absent at every breakpoint.
- All 13 lifecycle boxes remain present and map to the same internal slots,
  but use concise customer-facing names such as `Hello & Welcome`, `Meet the
  Brand`, `A Gentle Reminder`, and `The Door Is Open`.
- The Brand Studio wordmark and preview both display Lumen. No merchant-facing
  `Nomi` text remains on this route.
- Chrome reported no horizontal overflow at 1280px, 768px, or 375px. The
  renamed boxes wrap cleanly and retain their status dots and borders.

## Brand Studio as the single lifecycle-preview source — 16 September 2026

Removed the dashboard-only lifecycle generator and its fixed blue/pink email
fallback. The Flow Editor now renders only current fingerprint-matched Brand
Studio HTML; without a current family, it shows a restrained rebuild state and
links back to Brand Studio.

### Screenshots captured

- `screenshots/flow-editor-brand-studio-only-desktop-1440.png`
- `screenshots/flow-editor-brand-studio-only-tablet-768.png`
- `screenshots/flow-editor-brand-studio-only-mobile-375.png`
- `screenshots/flow-editor-brand-studio-only-mobile-empty-375.png`

### Review findings

- The authenticated Shopify embed shows `Brand Studio build required` and no
  synthetic email, `Recommended for you`, `BUY NOW`, or per-email Generate /
  Rewrite action when a current family is unavailable.
- The neutral empty state communicates that all 13 emails are authored as one
  family and exposes `Build in Brand Studio` / `Open Brand Studio` actions.
- Chrome reported no embedded-app horizontal overflow at 1440px, 768px, or
  375px. Copy, the 13 badge, selector rows, and actions do not clip or overlap.
- All reviewed CTAs are at least 44px high. The pre-existing trial, activation,
  and support controls were raised from 30px to 44px after the rendered check
  caught the undersized targets.
- Existing selected and expanded flow styling remained visible and distinct;
  the desktop preview and the mobile empty-state composition both render with
  the refreshed stylesheet in Shopify's iframe.

## Approved Brand Studio family gate — 16 September 2026

Centralized the downstream acceptance check for Dashboard, Templates, Flow
Editor, and live delivery. A profile is now usable only when its evidence
fingerprints match and all 13 Brand Studio-authored HTML emails are present.

### Screenshots captured

- `screenshots/brand-studio-family-gate-desktop-1440.png`
- `screenshots/brand-studio-family-gate-tablet-768.png`
- `screenshots/brand-studio-family-gate-mobile-375.png`

### Review findings

- Opening Brand Studio with `?step=complete` while the saved profile is still
  incomplete correctly remains on Step 2, Snapshot; it no longer exposes a
  false Ready state.
- Flow Editor reports `Brand Studio build required`, `0 of 13 live`, and shows
  the Brand Studio build action instead of substituting legacy generated HTML.
- Chrome reported no embedded-app horizontal overflow at 1440px, 768px, or
  375px.
- The primary `Approve and create directions` action is present once at every
  breakpoint and measures 46px high, above the 44px touch-target minimum.

## Nomi platform / Lumen merchant boundary — 16 September 2026

Restored Nomi as the application identity while keeping Lumen as the scanned
development-store identity. Removed the global Lumen fallback from Flow Editor
and Brand Settings so other merchants inherit only their own evidence.

### Screenshots captured

- `screenshots/nomi-app-lumen-store-header-desktop-1440.png`
- `screenshots/nomi-app-lumen-store-desktop-1440.png`
- `screenshots/nomi-app-lumen-store-tablet-768.png`
- `screenshots/nomi-app-lumen-store-mobile-375.png`

### Review findings

- The Brand Studio top bar shows the Nomi mark and wordmark; the connected
  merchant label on the opposite side shows Lumen.
- The Lumen snapshot uses `#fffaf3` paper, `#1d1a18` ink, `#b96f52` primary,
  `#d8cfc3` accent, Newsreader display type, and Manrope body type.
- Flow Editor shows `Lumen email brand`, `Lumen via Nomi`, and Nomi-owned
  platform language. No incomplete profile can substitute a prebuilt Lumen
  email family.
- The Lumen normalization is restricted to the exact development shop domain;
  regression coverage confirms another merchant keeps its own name and assets.

## Full-family regeneration control — 22 September 2026

Replaced the ambiguous evidence-only rebuild control on Brand Studio's Ready
screen with a dedicated `Regenerate all 13 emails` action. Store rescanning
remains available as a quieter secondary action, so merchants no longer need
to change a logo or colour just to request a fresh email family.

### Screenshots captured

- `screenshots/brand-studio-regenerate-all-review-desktop-1280.png`
- `screenshots/brand-studio-regenerate-all-review-tablet-768.png`
- `screenshots/brand-studio-regenerate-all-review-mobile-375.png`
- `screenshots/brand-studio-regenerate-all-actions-desktop-1280.png`

### Review findings

- The primary action clearly states that all 13 emails will be regenerated;
  the supporting copy explains that the current family remains in place until
  the replacement passes review.
- `Rescan store evidence` is visually subordinate and remains available for
  real logo, palette, product, theme, or brand-name changes.
- Chrome reported no horizontal overflow at 1280px, 768px, or 375px. The
  action group stays beside the copy where space permits and stacks cleanly on
  mobile without clipped text or overlap.
- The primary and secondary actions measured 48px and 44px high respectively
  at every checked breakpoint, meeting the touch-target requirement.
- Loading, success, and error messages use the existing calm editorial system,
  announce through `aria-live`, and do not replace the existing family while
  background generation is incomplete or unsuccessful.

## Flow Editor subject and preview editor — 23 September 2026

Activated the authenticated Flow Editor action for editing each email's inbox
subject line and preview text without regenerating or changing its HTML body.

### Screenshots captured

- `screenshots/flow-editor-subject-preview-desktop-1280.png`
- `screenshots/flow-editor-subject-preview-live-edit-desktop-1280.png`
- `screenshots/flow-editor-subject-preview-tablet-768.png`
- `screenshots/flow-editor-subject-preview-mobile-375.png`

### Review findings

- Verified inside Shopify Admin using the authenticated
  `ombarvaliya7@gmail.com` development session.
- The editor opens as a centered desktop modal and a contained bottom sheet at
  tablet/mobile widths; labels, counters, helper copy, and both actions remain
  readable with no horizontal overflow at 1280px, 768px, or 375px.
- Close, Cancel, and Save controls render at a 44px touch target (minor
  sub-pixel rounding at the 768px browser scale measured 43.88px).
- Save is disabled for unchanged values, becomes enabled after an edit, and the
  inbox sample plus both character counters update immediately while typing.
- Escape closes the dialog and restores keyboard focus to the Edit trigger.
  The focused text field has a visible cyan focus treatment.
- No live save was submitted during visual review, so the merchant's existing
  subject and preview text were left unchanged. Server validation and persistence
  remain covered by the metadata action tests.

## Centered Flow Editor preview labels — 23 September 2026

Centered the shared `{email name} — preview` eyebrow against the complete
preview-card width while preserving the Edit action at the right edge.

### Screenshots captured

- `screenshots/flow-editor-centered-preview-label-desktop-1280.png`
- `screenshots/flow-editor-centered-preview-label-tablet-768.png`
- `screenshots/flow-editor-centered-preview-label-mobile-375.png`

### Review findings

- Verified in the authenticated `ombarvaliya7@gmail.com` Shopify session.
- The shared header style covers every selected lifecycle email and does not
  depend on a particular email name or flow.
- Browser measurements place the label center at a 0px offset from the preview
  header center on desktop and mobile; the tablet capture confirms the same
  centered composition visually.
- The Edit control remains fully visible with its 44px touch target. The mobile
  label wraps to two centered lines when required, without clipping or causing
  horizontal overflow.

## 2026-09-25 — Sending domain: "ready to send" step + Sender info return

Change: the Verified step's Next card now resolves the email footer address
(Sender info override → Shopify store address → ask). Complete address shows
"You're ready to send" + Go to Campaigns; incomplete shows "Add your business
address" → Sender info, which now returns to Campaigns after saving.

### Screenshots

- `screenshots/sending-domain-ready-card-desktop.png`
- `screenshots/sending-domain-ready-card-tablet.png`
- `screenshots/sending-domain-ready-card-mobile.png`
- `screenshots/sender-info-save-redirects-to-campaigns.png`

### Review findings

- Verified in the authenticated `ombarvaliya7@gmail.com` Shopify session at
  1280, 768 and 375 px. No clipping or horizontal scroll; "Go to Campaigns"
  stays ≥44px and goes full-width on mobile.
- Edit → Save sender info landed on `/app/campaigns` with no Setup Domain
  banner (domain verified).
- The "Add your business address" variant wasn't rendered live: this store has
  a saved Sender info override, and clearing merchant data just to see it
  wasn't worth it. Covered by `sender-footer.server.test.ts`.
- The inline "Edit" text link is a secondary action below the 44px target;
  the primary CTA carries the touch target.

## 2026-09-25 — Campaigns "Replay setup" + sending-domain replay mode

Change: once the domain is verified, the Campaigns banner becomes a one-line
"Sending from hello@<domain> · Verified · Replay setup" row. Replay
(`/app/sending-domain?replay=1`) walks the real three setup pages read-only,
with Back / Next / Finish replay and clickable step tabs.

### Screenshots

- `screenshots/campaigns-replay-setup-desktop.png`
- `screenshots/campaigns-replay-setup-mobile.png`
- `screenshots/sending-domain-replay-step1-desktop.png`
- `screenshots/sending-domain-replay-step2-desktop.png`
- `screenshots/sending-domain-replay-step2-mobile.png`
- `screenshots/sending-domain-replay-finished-desktop.png`

### Review findings

- Verified in the authenticated Shopify session at 1280 and 375 px: Replay
  setup → step 1 (domain read-only, no Continue) → Next → step 2 (real records
  all Verified) → Finish replay → step 3. Step tabs switch steps directly.
- First pass showed "Use a different domain" during replay, contradicting
  "nothing here changes it"; fixed — hidden in replay and the "I've added"
  checkbox is disabled.
- All replay controls and the Replay setup link are ≥44px tall; no clipping or
  horizontal scroll from the new elements.
- Pre-existing, not from this change: the campaigns table is cramped at 375px.

## 2026-09-25 — Verified card copy, Sender info return, email compliance footer

- Verified card now reads "Your sender is set" and says Nomi *will* add the
  business address to campaign footers (it previously claimed it already did).
- Edit / Add sender info from the Verified page returns to `/app/sending-domain`
  after saving — confirmed live in Chrome (Edit → Save sender info → Verified).
- Campaign preview shows the compliance footer (address + inert "Unsubscribe");
  confirmed in the live Campaigns preview's accessibility tree, and rendered at
  600px in `screenshots/campaign-email-with-compliance-footer.png`.
- Not yet checked in Chrome: the public `/unsubscribe` page — the running dev
  server predates the `EmailSuppression` Prisma client and must be restarted.

## 2026-09-25 — Theme app embed setup gate (`/app/setup`) and live dashboard row

- `/app/setup` checked live in Chrome at 1440px, 768px and 375px
  (`screenshots/setup-embed-desktop-1440.png`, `setup-embed-tablet-768.png`,
  `setup-embed-mobile-375.png`). Reads the real live theme ("Lumen — Latest")
  and shows Inactive; Continue is disabled; sidebar nav is hidden while gated.
- Practice editor: toggle → Save → pop-up preview confirmed
  (`setup-embed-practice-saved-1440.png`). Enable Script deep link resolves to
  `…/admin/themes/current/editor?context=apps&activateAppId=<api key>/nomi-script`.
- All CTAs ≥44px; no clipping or horizontal scroll at 375px.
- Not yet checked in Chrome: the Active state, the "You're all set" dialog and
  the dashboard's live On/Off row. The theme extension is parked in
  `extensions-pending/` because `shopify app dev` needs the storefront password
  (`SHOPIFY_FLAG_STORE_PASSWORD`) before it can serve it.

## 2026-09-25 — Setup gate: "Turn on Nomi Script first" signal

- Checked live in Chrome (embedded admin, dev.trynomi.email) at 1440px, 768px
  and 375px: `screenshots/setup-embed-still-off-1440.png`,
  `setup-embed-still-off-tablet-768.png`, `setup-embed-still-off-mobile-375.png`.
- Flow tested: Enable Script → back to tab → Check again while the embed is
  still Inactive → magenta "Turn on Nomi Script first" alert, step 2 flagged,
  button relabels to "Open theme editor again". "Show me the toggle" scrolls to
  the practice panel, which pulses the toggle with "Turn this on before you
  save".
- Re-checks now go through `/app/setup-status` with a plain fetch; a network
  failure shows an inline note instead of Shopify's full-page Application Error.
- All CTAs ≥44px; no clipping or horizontal scroll at 375px.
- Not re-tested: the Active state (the theme extension is still in
  `extensions-pending/`, so Nomi Script can't be turned on in the dev store yet).
- Follow-up: the theme editor showed "App embed does not exist" for the deep
  link because the extension was parked. Moved `extensions-pending/nomi-theme`
  back to `extensions/nomi-theme`; `shopify app dev` must be restarted (with the
  storefront password) before Nomi Script appears under App embeds.

## 2026-09-25 — Setup gate: four-step order and Brand Studio handoff; pricing page

- Setup steps now follow the theme editor's real order: open editor → App
  embeds icon → turn Nomi Script on → Save. Practice panel callouts renumbered
  to match (2 on the App embeds rail icon, 3 toggle, 4 Save). The "You're all
  set" dialog is gone: when a re-check flips to Active during the visit, the
  page shows "Nomi Script is on. Opening Brand Studio…" and navigates to
  `/app/brand-studio`; an already-Active visit shows "Continue to Brand Studio".
- Checked live at 1440px with the embed Active (`setup-embed-active-1440.png`,
  `setup-embed-four-steps-1440.png`, `setup-to-brand-studio-1440.png`).
  Continue → Brand Studio confirmed. The automatic Inactive→Active redirect was
  not re-run (it needs the embed switched off on the live theme first).
- `/app/pricing`: checked at 1440px and 375px (`pricing-desktop-1440.png`,
  `pricing-desktop-1440-10500-contacts.png`, `pricing-mobile-375.png`). Keyboard
  PageUp ×2 → 10,500 contacts, $115/mo, 105,000 sends. Update plan shows the
  private-beta note. 768px not captured for pricing.

## 2026-09-25 — Setup → Brand Studio handoff, tested live

- Step 1 now holds its own numbered pill button ("1 Open theme editor"), always
  pulsing like the practice toggle. Step 4 tells the merchant to come back to
  the tab after saving.
- The theme editor is Shopify's page; an app can't redirect it on Save. Nomi's
  own tab now polls every 4s while the editor is open and the embed is off, and
  re-checks on return; either path hands off to `/app/brand-studio`.
- Tested in Chrome: (a) setup loaded Active → Open theme editor → switch back →
  tab moved to Brand Studio (`setup-return-auto-brand-studio-1440.png`);
  (b) embed switched off and saved → setup read Inactive → Open theme editor →
  Save in the editor tab → the Nomi tab moved to Brand Studio without being
  focused. Live status afterward: Active.

## 2026-09-26 — Brand & Settings: Plan & billing panel

- Replaced the loose one-row layout (label, grey sentence and a black button all
  in one line) with a framed plan card. It uses the same ink-border and offset
  shadow as the Branding "Visual identity" fieldset. Left: "Private beta" with
  an Active pill and a short explanation. Right: the after-launch price ($15/mo)
  and See pricing. Below: three facts ($0 charged, 5 of 5 flows, Shopify billing).
- Inline styles on purpose (embedded-iframe CSS issue, see CAMPAIGNS.md).
- Checked in Chrome at 1440 / 768 / 375 with no clipping or horizontal scroll.
  The card stacks to one column at tablet width and below. The See pricing
  button is 44px tall.
  Screenshots: `settings-plan-billing-{desktop,tablet,mobile}.png`.

## 2026-09-27 — Seam editor: Shopify files grid

- Bug: the Shopify files picker showed thumbnails as thin strips. The tiles
  clip (`overflow: hidden`), which drops their automatic minimum height to 0,
  so the grid's auto rows shrank to share the 220px max-height instead of
  scrolling.
- Fix: `grid-auto-rows: max-content` on `.v9-asset-list` (also inline on each
  list, per the embedded-iframe CSS note), max-height raised to 320px. Applies
  to the campaign, Brand Studio and template editors.
- Checked live in Chrome at 1920 and 768: full-height thumbnails with names,
  list scrolls, Save changes stays visible. The 375 capture came back blank
  because the Shopify admin reloads into its mobile shell under emulation, so
  mobile is not verified.
  Screenshots: `seam-editor-shopify-files-fixed-{desktop,tablet}.png`.

## 2026-09-28 — Dashboard: flow links, campaigns table, forms removed (live on Fly)

- Checked live at `nomi-email.fly.dev` in the Shopify admin (Chrome), desktop 1920px, tablet 768px, mobile 375px.
- Email collection forms card removed. Flow names link to `/app/flow-editor?flow=<id>`: clicking Abandoned Cart opens the editor on that flow. Fixed an error page caused by plain `<a>` links inside the embedded frame by switching to React Router `Link`.
- "Create your first campaign" opens the Create Campaign modal (`/app/campaigns?create=1`).
- Campaigns table lists the 5 newest real campaigns plus "View all N campaigns". Dates are kept on one line; on mobile, long names wrap and the table scrolls horizontally inside its card like the Flows table.
- Screenshots: `screenshots/dashboard-flow-link-cart-live-fixed.png`, `dashboard-create-campaign-modal-live.png`, `dashboard-campaigns-table-{desktop,tablet,mobile}.png`.

## 2026-09-28 — Required fonts in Brand Studio; Branding mirrors Visual evidence (live on Fly)

- Brand Studio snapshot: Display/Body character are now required (`FontField` in `app/components/brand-inputs.tsx`). Clearing either shows an inline red message ("Add a display character, like Playfair Display.") and blocks submit. The server also rejects blank fonts or brand name before any AI call.
- Branding (Brand & Settings) now uses Brand Studio's layout: logo + brand name, then Paper/Ink/Primary/Accent swatches and the display/body characters. Primary, logo and language stay editable. The rest are read-only with a "Change in Brand Studio" button, because editing them there rebuilds the 13 emails. A blank Primary is blocked ("Primary needs a color."), and a missing Brand Studio font shows in red.
- Colors are grouped in pairs: 4 across on desktop, 2×2 on tablet and mobile (was 3+1 at 768px, fixed).
- Checked live in Chrome at 1920 / 768 / 375. Screenshots: `screenshots/brand-studio-font-required-error.png`, `branding-primary-required-error.png`, `branding-visual-identity-{desktop,tablet,mobile,mobile-2}.png`.

## Flow Editor regenerate modal (2026-09-28)
- "Regenerate email" in the Flow Editor now opens a Create Campaign-style dialog: a brief for Nomi AI, what to feature (As designed / Product / Collection / Products, live catalogue pickers shared with Campaigns via `app/components/catalog-pickers.tsx`), and an optional discount code with value and dates. The result replaces that email in the Flow Editor.
- Checked live in Chrome at 1920 / 768 / 375: body scrolls inside the modal, Discard/Regenerate stay visible, the product picker loads the store's products. Screenshots: `screenshots/flow-regenerate-modal-{desktop,desktop-product-discount,tablet,mobile}.png`.
- Update: the regenerate dialog now shows the Campaigns "Generating Your Email" animation, then the finished email with Discard / Save to flow; only Save replaces the flow email. Create Campaign no longer offers "Start from template". Checked live at desktop: `screenshots/flow-regenerate-generating-desktop.png`, `flow-regenerate-review-desktop.png`, `campaign-create-ai-only-desktop.png`.
- Brand Studio now builds each lifecycle email with the campaign pipeline (plan, photos, designer). Live check: a regenerated 2nd Welcome email passed the quality gate with a newly generated photo (`screenshots/brand-studio-campaign-engine-welcome-2.png`, discarded, not saved).

## 2026-09-28 — Nomi help chat: AI answers and team replies (live on Fly)
- Finished the support chat Codex started. Questions are now answered by Claude, using the Help library, the plans and the shop's live state; team replies email the merchant, and a magenta dot on the launcher marks an unread team reply. The empty chat now opens at its welcome heading instead of scrolled to the bottom.
- Checked live at `nomi-email.fly.dev` in the Shopify admin (Chrome) at 1920 / 768 / 375. Asked "Why haven't any of my abandoned cart emails gone out yet?": the answer arrived in about 3 s and used Lumen's real unsent-email record. Panel, composer, Talk to the team and Close stay fully visible at every width, with no horizontal scroll.
- Screenshots: `screenshots/support-ai-desktop-open.png`, `support-ai-desktop-answer.png`, `support-ai-tablet.png`, `support-ai-mobile.png`.
