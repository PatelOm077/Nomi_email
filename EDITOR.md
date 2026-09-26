# Nomi email editor handoff

Last updated: 2026-09-18 (second pass — production implementation)

This is the durable context file for the Nomi drag-and-drop email editor. Read
this file before continuing editor work in a new chat. Also follow `CLAUDE.md`,
`SPEC.md`, `DECISIONS.md`, and `AGENTS.md`.

## Current outcome (this session)

The live editor at `app/routes/app.template-editor.tsx` was rebuilt from
scratch to match the approved Figma Make prototype ("Nomi Safe Block Editor
Prototype", Version 8) — not just visually, but architecturally. The prior
implementation (still referred to in git history/PR descriptions as "the GPT
version") used a **fixed set of six sections** (header/hero/discount/routine/
product/footer) per email; clicking an Elements tile just jump-selected one
of those existing sections instead of inserting anything. That file has been
fully replaced in place (same path, no leftover duplicate) with a **generic,
ordered block list** — the same model the Figma prototype uses — so blocks can
actually be added, duplicated, reordered, hidden, and deleted.

Verified working end-to-end in the real embedded Shopify admin (not just
`localhost`) against the `nomi-mmkgcryy` dev store:
- Selecting any block (image, text, discount, button) opens the matching
  contextual editor and shows a cyan selection tag + outline on the canvas.
- The Image/Logo editors are wired to **real Shopify data** — actual store
  product photos and uploaded files, not the old static
  `template-looks/gauge-welcome-01.png`-style mockup images. (Those specific
  PNGs are full composite email mockups used by the Templates gallery, not
  plain hero photography — reusing them as a swappable "Image" block was a
  bug; see "Known-fixed bugs" below.)
- The Discount code editor (content, treatment, alignment, colors, corner
  radius, linked/unlinked padding) works exactly per the Version 8 spec.
- **"Rewrite with Nomi"** is real now — it calls Claude (`claude-sonnet-5`)
  via a new `app/email-engine/rewrite-copy.ts` helper (Shorter / Warmer / More
  direct), shows a preview, and Apply/Discard both participate in undo.
- The Style tab (Brand System / Colors / Fonts / Buttons / Layout) matches the
  prototype's real controls: heading/body font *dropdowns* (not a two-way
  toggle), separate button padding-H/padding-V sliders, content-width as a
  number input + slider.
- Undo/redo, Save (persists to Prisma), and full-screen Preview mode (replaces
  the old modal `FlowPreviewDialog`) all verified working via real clicks in
  the embedded app.
- The canvas uses genuine internal scrolling in a fixed-height viewport (was
  previously growing the whole page — see below).

## Data model change (breaking, intentional)

`TemplateCustomization` in `prisma/schema.prisma` no longer stores
`eyebrow`/`headline`/`bodyCopy`/`buttonLabel`/`sectionContent`/`sectionOrder`/
`hiddenSections`/`palette`/`typography`/`spacing`/`buttonStyle`. It now stores:

```
blocks      String  @default("[]")   // JSON Block[]
style       String  @default("{}")   // JSON EmailStyle
applySeries Boolean @default(false)
```

Migration: `prisma/migrations/20260918140000_generic_email_blocks/migration.sql`
drops and recreates the table (old drafts are not migratable 1:1 into the new
block shape — this was judged acceptable since the table only held local dev
test data, not real merchant history). If you ever need to do this again on a
DB with real data, do NOT drop the table — write a real transform instead.

The `Block`/`BlockData`/`EmailStyle` TypeScript shapes live at the top of
`app/routes/app.template-editor.tsx` and are intentionally close to the
Figma prototype's `App.tsx` field names, with a few Nomi-specific additions:
`imageSource`/`logoSource` (provenance so the asset panel knows which source
tab is active), `productId`/real catalog wiring for the Product block.

## Known-fixed bugs from this session (read before assuming something is broken)

1. **CSS wasn't loading at all.** The route originally injected the whole
   stylesheet as `<style>{cssString}</style>` via a `?raw` Vite import. That
   silently rendered nothing (root cause not fully diagnosed — possibly a
   dev-server/Vite raw-import quirk specific to this embed). Fixed by
   switching to the same pattern `app.tsx` already uses for `nomi.css`:
   `import v8EditorStyles from "../styles/v8-email-editor.css?url"` +
   `export const links: LinksFunction = () => [{ rel: "stylesheet", href: v8EditorStyles }]`.
   If you ever see completely unstyled HTML in this route again, check `links`
   is still exported and wired — don't reach for inline `<style>` again.
2. **Canvas wasn't internally scrolling.** `.v9-editor` used `min-height:
   100vh`, which doesn't cap growth — so once the discount/routine/CTA blocks
   pushed content past one screen, the *whole Shopify admin page* scrolled
   instead of the canvas. Fixed by using `height: 100vh; max-height: 100vh;
   overflow: hidden` on `.v9-editor` (desktop/tablet only — the mobile
   breakpoint intentionally stacks rail/canvas/panel and needs page-level
   scroll, so don't blindly apply this cap below 640px).
3. **Default hero image was a full email mockup, not a photo.** The old and
   new code both defaulted the "Image" block to
   `/template-looks/gauge-welcome-01.png` — but that file (like
   `gauge-education.png`, `gauge-samples.png`) is a *composite rendered email
   screenshot* used by the Templates gallery, not plain product photography.
   Using it as a swappable single-image block produced a bizarre
   nested-email-inside-the-email look. Fixed two ways: (a) swapped the local
   fallback samples to `gauge-portrait-*.jpg` (actual photos), and (b) the
   loader now prefers a **real product photo from the store's own catalog**
   (`productMedia[0]`) as the default hero whenever one exists, which is both
   correct and matches CLAUDE.md's "don't hand the model/UI a fake value"
   rule. Denizen's existing hero assets were already plain photos and were
   left alone.

## Browser automation gotcha (not a code bug — for whoever verifies this next)

While testing in the Claude-in-Chrome extension against the embedded iframe,
click coordinates computed from one screenshot sometimes silently missed
buttons in a *later* screenshot, because the reported viewport width flickered
between ~1536/1564/1568px across calls in the same tab. Always take a
screenshot immediately before clicking and use *that* screenshot's exact
pixel positions — don't reuse coordinates from an earlier call, even a few
seconds earlier. The accessibility-tree tools (`read_page`, `find`,
`get_page_text`, `read_console_messages`, `read_network_requests`) cannot see
inside the cross-origin embedded-app iframe at all — only pixel screenshots
can. `Page.captureScreenshot` also occasionally times out (30s) on a tab
that's otherwise responsive; retry once or switch tabs rather than assuming
the page crashed.

## Not done / explicitly deferred this session

- **Product-row block** (multiple products in one row) is a stub — the
  contextual editor just shows an explanatory message. The single **Product**
  block *is* fully wired to real catalog data (real name/price/image, and the
  CTA link is omitted — not faked with `href="#"` — when the product isn't
  published to Online Store, matching the existing review-request-prompt
  convention).
- **Mobile "bottom sheet" panels** from the original EDITOR.md spec were
  simplified to a stacked-and-scrollable layout instead of true sticky-header
  bottom sheets with a "Done" action. It's usable (no horizontal scroll, 44px
  targets) but not pixel-identical to the spec's bottom-sheet description.
- **Responsive breakpoints (768px tablet, 375px mobile) were implemented in
  CSS but not pixel-verified in the browser this session** — the automation
  tooling's `resize_window` call did not visibly change the embedded app's
  rendered viewport width no matter what was tried (see gotcha above). The
  desktop (1280px+) experience was thoroughly verified by hand. Whoever picks
  this up next should actually load the two smaller breakpoints and look.
- The compiled block content does **not** yet feed the real send-time email
  HTML pipeline (`app/email-engine/generate-*.ts`). This editor is a
  merchant-facing content/preview surface on top of `TemplateCustomization`;
  wiring its output into an actual outbound-email compiler is a separate,
  not-yet-scoped piece of work.

## Old editor CSS removed from `app/styles/nomi.css`

`nomi.css` (the global app-shell stylesheet, ~7200 lines) had roughly 550
leftover CSS rules (`.nomi-editor-*`, `.nomi-v8-*`, `.nomi-live-email-*`,
`.nomi-structure-*`, `.nomi-flow-preview-*`, `.nomi-template-editor*`, `.v8-*`,
plus a few `.nomi-theme-*` rules specific to the old `ThemePanel`) from the
previous template-editor implementation, dead since the rewrite uses its own
`v9-*`-prefixed classes in a dedicated stylesheet. These were removed with a
one-off PostCSS script (paren-aware comma splitting, so `:is(a, b)`-style
selectors weren't corrupted) — verified the result still parses as valid CSS
and that unrelated features sharing the same file (`.nomi-remix-*`,
`.nomi-theme-store*` for Shopify's own theme browsing, the Templates/Page17
CSS) were untouched. `.nomi-theme-store*` looks similar to the old editor's
theme-panel classes by name but is unrelated — don't remove it if you ever do
a similar sweep.

## Approved product direction (unchanged from the original prototype work)

The editor should feel calm, editorial, and production-grade. It borrows Wix's
directness and drag-and-drop clarity without copying Wix's density or turning
email editing into an unrestricted website builder.

The main workspace contains:

1. A top bar with flow/email context, save state, Undo, Redo, Preview, and Save.
2. A left rail with exactly **Elements** and **Style**.
3. A centered, contained email preview with genuine internal scrolling.
4. A contextual Section editor on the right for the selected block.

## Visual system

- Paper: `#f3f2f2`
- White: `#ffffff`
- Ink: `#201e1d`
- Muted: `#716d6d`
- Line: `#d7d3d3`
- Cyan: `#0088b0`, reserved for interaction and selection
- Cyan soft: `#e9f8ff`
- Magenta: `#d6006c`, destructive emphasis only
- Display/editorial headings: Lora SemiBold
- UI labels and controls: IBM Plex Sans
- Merchant email typography: inherited from Brand System
- Minimum touch target: 44 x 44 px

## Supporting files

- `app/routes/app.template-editor.tsx` — the editor route (loader, action,
  and the whole UI). Single file, ~1000 lines, organized top-to-bottom:
  types → catalog/defaults → server validation → loader/action → labels/icons
  → canvas renderers → shared UI pieces → top bar → left panel → contextual
  editor panels → workbench → full-screen preview → the default export.
- `app/styles/v8-email-editor.css` — the editor's own stylesheet, loaded via
  `links`, not inline. Keep it that way (see "Known-fixed bugs" #1).
- `app/email-engine/rewrite-copy.ts` — the AI rewrite helper (no Shopify
  imports, per `CLAUDE.md`'s platform-independence rule for this folder).
- Figma design source: `Nomi Design Templates`, key `QxU9DFP5wNTlNyFCTGoCcJ`
- The actual Figma Make prototype source was pulled directly via its
  code-editor "Download code" button (not guessed from screenshots) — see
  `Nomi Safe Block Editor Prototype.zip` in Downloads if you need to re-check
  something against the literal Version 8 source.

## Next milestone

1. Pixel-verify the 768px and 375px breakpoints by hand (see "Not done" above).
2. Decide whether Product-row deserves a real multi-product picker or should
   stay a single-Product-only recommendation.
3. Scope wiring this editor's saved block content into the actual send-time
   HTML compiler, if/when that becomes a priority — today it's preview-only.
