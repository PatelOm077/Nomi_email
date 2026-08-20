---
name: Nomi Newsprint Plain
colors:
  ink: "#201e1d"
  ink-strong: "#181716"
  paper: "#f3f2f2"
  canvas: "#f7f6f5"
  surface: "#ffffff"
  surface-warm: "#fbfaf9"
  neutral-100: "#f8f4f4"
  neutral-200: "#eae7e7"
  neutral-300: "#d7d3d3"
  neutral-600: "#7d7979"
  neutral-700: "#605d5d"
  neutral-800: "#444141"
  neutral-900: "#2d2b2b"
  cyan: "#0088b0"
  cyan-soft: "#e9f8ff"
  cyan-mid: "#99e0ff"
  cyan-hover: "#1186ac"
  cyan-deep: "#006786"
  cyan-ink: "#004961"
  magenta: "#d6006c"
  success: "#168257"
  success-ink: "#116340"
  success-soft: "#e7f6ed"
  warning-ink: "#8a5a00"
  warning-soft: "#fff2c7"
  error-ink: "#9f1239"
typography:
  display:
    fontFamily: "Source Serif 4, Georgia, serif"
    fontSize: 34px
    fontWeight: "700"
    lineHeight: "1.08"
    letterSpacing: "-0.035em"
  page-heading:
    fontFamily: "Source Serif 4, Georgia, serif"
    fontSize: 30px
    fontWeight: "600"
    lineHeight: "1.2"
    letterSpacing: "-0.02em"
  section-heading:
    fontFamily: "Source Serif 4, Georgia, serif"
    fontSize: 22px
    fontWeight: "600"
    lineHeight: "1.2"
    letterSpacing: "-0.02em"
  body:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: 14px
    fontWeight: "400"
    lineHeight: "1.5"
    letterSpacing: "0"
  body-small:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: 12px
    fontWeight: "400"
    lineHeight: "1.45"
    letterSpacing: "0"
  label-caps:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: 10px
    fontWeight: "700"
    lineHeight: "1.2"
    letterSpacing: "0.14em"
rounded:
  hairline: 1px
  DEFAULT: 2px
  soft: 4px
  illustrative: 10px
  pill: 999px
spacing:
  unit: 5px
  xs: 5px
  sm: 10px
  md: 15px
  lg: 20px
  xl: 30px
  xxl: 40px
  section: 72px
  page-gutter: 40px
shadows:
  subtle: "0 1px 2px rgba(45, 43, 43, 0.14)"
  proof: "0 5px 18px rgba(32, 30, 29, 0.10)"
---

# Design System: Nomi Dashboard

## 1. Visual Theme & Atmosphere

Nomi is a quiet, editorial email-operations product embedded inside Shopify admin. Its visual language is "newsprint plain": warm paper-colored canvases, near-black ink, crisp white working surfaces, compact type, hairline rules, and very restrained elevation. It should feel deliberate and literate rather than decorative—closer to a well-edited broadsheet or studio proof than a generic blue SaaS dashboard.

The interface removes visual effort without hiding operational truth. Generous page margins and serif headings create calm; dense sans-serif controls, status rows, tables, and metadata make the work legible. Cyan is the interaction signal. Magenta is a single spot accent for a warning, gate, or exceptional active moment and must never become a co-equal brand color. Avoid glassmorphism, dark dashboards, large gradients, heavy shadows, cartoon illustrations, oversized pill controls, and broad corner radii.

### Brand boundary

- This system governs Nomi's dashboard UI only.
- Shopify's global navigation and admin chrome remain Shopify-native; Stitch should design the Nomi content region, not replace the surrounding shell.
- Merchant email previews are intentionally not skinned with Nomi colors. They represent each merchant's generated brand and may use a completely different palette inside a neutral Nomi preview frame.
- The separate `Shopify email marketing app (1)/` directory is a non-shipping mockup archive. The shipped stylesheet and current routes are the source of truth.

## 2. Color Palette & Roles

### Primary Foundation

- **Warm Newsprint Paper — `#f3f2f2`:** the primary dashboard and onboarding background. It should read warm and tactile, never blue-gray.
- **Working Canvas — `#f7f6f5`:** the larger flow-editor canvas, one step lighter and quieter than paper.
- **Proofing Paper — `#fbfaf9`:** the exact-reference flow surface and subtle warm alternation.
- **Crisp White — `#ffffff`:** cards, tables, forms, preview frames, and operational panels.
- **Soft Blush Neutral — `#f8f4f4`:** low-emphasis rows, empty states, and selected checklist backgrounds.
- **Rule Gray — `#eae7e7`:** dividers, tracks, table rules, and passive fills.
- **Border Gray — `#d7d3d3`:** one-pixel container and control borders.

### Accent & Interactive

- **Nomi Cyan — `#0088b0`:** focus rings, progress, primary generation actions, selected borders, active rails, and interaction markers.
- **Cyan Wash — `#e9f8ff`:** selected rows, badges, icon wells, and low-intensity interactive surfaces.
- **Cyan Hover — `#1186ac`:** filled-button hover state.
- **Deep Cyan — `#006786`:** links, text actions, and accessible cyan text on light surfaces.
- **Ink CTA — `#201e1d`:** the compact page-level action in the flow editor and campaigns shell. This keeps the hierarchy editorial; cyan remains the interaction/status signal around it.
- **Spot Magenta — `#d6006c`:** one deliberate warning, upgrade gate, duplicate-receipt risk, recovery category, or active onboarding progress marker per composition. Do not scatter it across ordinary controls.

### Typography & Text Hierarchy

- **Primary Ink — `#201e1d`:** default text, primary buttons, logo block, and strong rules.
- **Display Ink — `#181716`:** the strongest large editorial headings.
- **Secondary Ink — `#605d5d`:** explanations, metadata, helper copy, and inactive controls.
- **Muted Ink — `#7d7979`:** tertiary labels and quiet statuses. Do not use it for essential small text without checking contrast.
- **Dense Ink — `#444141`:** stronger secondary text and dark hover fills.

### Functional States

- **Success — `#168257` / `#116340` on `#e7f6ed`:** live delivery, ready state, and confirmed completion. Always include a label or icon, not color alone.
- **Warning — `#8a5a00` on `#fff2c7`:** waiting, trial, or action-needed status that is not an error.
- **Error — `#9f1239`:** inline validation text. For high-visibility delivery risks, use the brand magenta with a pale mixed background and explicit warning copy.
- Lifecycle categories may use supporting green (`#2f7d50`) and ochre (`#b48213`) only to organize complex flow groups. They are semantic category colors, not general brand accents.

## 3. Typography Rules

### Families and character

- **Editorial family:** Source Serif 4, falling back to Georgia and then serif. Use for the Nomi wordmark, page and section headings, onboarding narrative, proof titles, and short expressive phrases. Its role is calm authority and newsprint character.
- **Interface family:** the Shopify/operating-system sans stack (`ui-sans-serif`, `system-ui`, `-apple-system`, Segoe UI, Roboto). Shopify currently loads Inter for compatible chrome. Use sans for buttons, inputs, navigation, tables, labels, statuses, counts, and dense operational copy.
- Do not turn the entire dashboard into a serif interface. The contrast between editorial headings and practical sans-serif chrome is essential.

### Hierarchy & weights

- **Hero or flow title:** 30–34px Source Serif 4, weight 600–700, tight line-height 1.08–1.2, tracking between `-0.02em` and `-0.035em`.
- **Section heading:** 20–22px Source Serif 4, weight 600, line-height 1.15–1.2.
- **Card or group heading:** 15–17px, usually weight 600–700. Use serif when the title carries editorial hierarchy; use sans when it labels an operational panel.
- **Body and controls:** 13–14px sans, weight 400; important labels and actions use 600–700.
- **Helper copy:** 11–12px sans at line-height 1.4–1.5.
- **Kickers and metadata labels:** 9–11px uppercase sans, weight 700–800, tracking `0.08em`–`0.22em`.
- **Onboarding body:** 15–16px Source Serif 4, including italic brand-voice samples.

### Copy and spacing principles

- Use plain sentences, no exclamation marks, and no hype. Name the action and state numbers plainly.
- Prefer sentence case for actions and headings; reserve uppercase for compact metadata labels and kickers.
- Headings sit close to their supporting sentence, while major sections are separated generously.
- Truncate dense single-line metadata with an ellipsis; allow explanatory copy to wrap at a readable 1.45–1.5 line-height.

## 4. Component Stylings

### Buttons

- **Page-level primary:** compact ink fill, warm-paper or white text, 2px corners, 38–40px minimum height, 12–14px bold sans text, and 14–18px horizontal padding.
- **Generation/activation primary:** Nomi cyan fill with white or paper text. Hover shifts to `#1186ac`; active shifts to `#006786`.
- **Secondary:** white surface, 1px neutral border, ink text, 2px corners. Hover darkens the border without adding elevation.
- **Text action:** deep cyan, no fill or border, weight 600–700. Underline on hover when it behaves like a link.
- **Icon action:** 28–32px square with a thin gray border, flat background, and a 1.6–1.8px line icon.
- Disabled controls use approximately 42–50% opacity and retain an explicit disabled cursor/state.
- Do not default to fully rounded pills. Pills belong to small status badges, not primary actions.

### Cards & operational containers

- Standard cards are crisp white with 1–2px corners, either a hairline gray border or the subtle one-pixel shadow—not both at high intensity.
- Internal padding is compact: usually 14–20px. Major cards can reach 28–30px when they contain onboarding narrative or an email proof.
- Selected cards replace generic elevation with a cyan border, cyan wash, or a 2px inset cyan rail.
- A warning container uses a pale magenta mix, thin magenta-tinted border, and 3px magenta left rail. Use once per screen.
- Onboarding is the deliberate soft-shape exception: its central white card uses a 10px radius, and illustrative choice cards may use 8–12px radii.

### Navigation

- The outer app navigation stays in Shopify's native app shell.
- Internal workflow pages use a strong 2px ink rule beneath a compact title row. The title may pair a small square Nomi mark or simple back arrow with a serif heading.
- Secondary section navigation can use a numbered left rail: compact sans labels, thin icons, neutral inactive state, and cyan for the active marker. Hover may reveal a simple directional arrow.
- Active/current state must be expressed in text or semantics as well as color.

### Inputs & forms

- Inputs and selects use white backgrounds, 1px ink-at-16% or neutral-300 borders, 2px corners, 13–14px sans text, and 36–40px minimum height.
- Textareas use the same treatment with roughly 92px minimum height and vertical resize.
- Hover darkens the border. Focus uses a solid cyan border plus a visible 2px cyan outline with 2px offset; never remove focus without replacing it.
- Labels should be visible whenever the field has durable meaning. Compact flow controls may use a 9–10px uppercase kicker.
- Checkboxes are square, 15px, with a cyan checked fill and white check mark. Do not use color alone to communicate selection.

### Lifecycle flow groups

- Organize email moments as stacked white groups with a circular count badge, strong title, slim gray progress rail, and compact expand/collapse control.
- Expanded email rows are 58–62px high. Selected rows use a tinted surface and semantic border color; readiness appears as a small labeled status badge.
- The left side is the editable system map; the right side is a sticky proof panel on wide screens. This operational two-pane relationship is a signature Nomi pattern.

### Email proof panel

- Frame generated HTML inside a neutral white proof card on a gray canvas, with a compact metadata header (`From`, `Subject`) above it.
- The proof can have stronger but still soft depth (`0 5px 18px` at about 10% ink opacity).
- Merchant-brand colors live only inside the proof content. The surrounding frame remains Nomi-neutral.

### Status strips, badges, and tables

- Delivery strips are white with a 3px semantic left rail, 13px copy, and a text action aligned opposite.
- Badges use 9–11px sans text and soft fills. Pills are acceptable here because they encode compact state.
- Tables use 10px uppercase headers on neutral-100, 13px data rows, 1px row rules, restrained hover wash, and no zebra striping.
- Use text labels and accessible names for every status and icon-only action.

### Onboarding

- Center one white card up to 760px wide on the paper background. Keep a quiet Source Serif narrative and small playful visuals rather than a full illustration scene.
- Progress tabs use thin 3px tracks; completed progress is cyan and the single active moment may be magenta.
- Motion uses short fades, small vertical moves, and gentle scale overshoot. Decorative orbit motion may run continuously only when reduced-motion preferences are honored.

### Icons and mark

- Use simple custom line icons at 1.6–2px stroke with rounded caps and joins. Keep them small and functional.
- The Nomi mark is a white paper-plane outline inside a near-black or cyan square. Standard dashboard marks are 30–40px; avoid embellishing the mark with gradients or shadows.

## 5. Layout Principles

### Grid & structure

- Standard dashboard shell: maximum width 1040px, centered, with 40px page gutters and approximately 72px between major sections.
- Flow/editor shell: maximum width 1240px, centered, with 34–40px page gutters.
- Primary flow workspace: two columns around `minmax(520px, 1.04fr)` and `minmax(430px, 0.96fr)`, with an 18px gap. The right proof remains sticky on wide screens.
- Dashboard card grids use `auto-fit` with a 226px minimum column and 30px gaps.
- Focused campaign forms cap at about 640px. Onboarding caps at 760px, narrative copy at 460px, and choice stacks at 520px.

### Whitespace strategy

- The base rhythm is 5px, expressed most often as 5, 10, 15, 20, 30, and 40px.
- Keep operational internals compact—8–16px gaps and 12–20px padding—inside generous page-level breathing room.
- Use hairline rules, alignment, and whitespace before adding boxes. A strong ink divider can establish hierarchy more effectively than another card.

### Alignment & visual balance

- Default to left-aligned text and controls. Center alignment is reserved for onboarding narrative, loading states, and the inside of email previews.
- Page headers balance a title at left with language, progress, or one primary action at right.
- Do not fill empty regions with decorative charts or gradients. Calm negative space is part of the brand.

### Responsive behavior & touch

- At 1060px and below, collapse the flow workspace to one column and make the proof non-sticky.
- At 720px and below, notices and rule grids become one column; proof actions stack; dense rows wrap their status beneath the title.
- At 560px and below, form rows and title/action rows stack vertically and use 12–20px side padding.
- At 480px and below, language controls and primary actions become full width; email rows become a single column.
- Preserve visible focus, meaningful source order, and reduced-motion behavior at every breakpoint. New mobile controls should target at least 44px where layout permits, even though some legacy compact desktop controls are 30–40px.

### Motion

- Functional transitions are quick and quiet: roughly 120–260ms for borders, progress, and chevrons.
- Onboarding entrance motion is 300–600ms with small opacity, translate, or scale changes. Longer illustrative sequences may run for 1.2–2.4s.
- Under `prefers-reduced-motion: reduce`, animations and transitions collapse to approximately 1ms with no delayed sequence.

## 6. Design System Notes for Stitch Generation

### Language to use

Use phrases such as:

- "embedded Shopify admin app with a premium editorial newsprint interface"
- "warm off-white paper canvas, crisp white working cards, and near-black ink"
- "Source Serif 4 headings with compact system-sans operational controls"
- "restrained cyan interaction signal and one deliberate magenta warning accent"
- "hairline rules, square two-pixel corners, subtle proof-sheet shadows, calm negative space"
- "dense but readable email operations, lifecycle maps, and proofing panels"

Avoid phrases or treatments such as "futuristic AI," glassmorphism, neon, purple-blue gradients, dark mode by default, floating glass cards, oversized hero metrics, generic illustration packs, heavily rounded 16–24px SaaS cards, and pill-shaped primary buttons.

### Color references

- Foundation: Paper `#f3f2f2`, Canvas `#f7f6f5`, White `#ffffff`, Ink `#201e1d`.
- Interaction: Cyan `#0088b0`, Cyan Wash `#e9f8ff`, Deep Cyan `#006786`.
- Exception: Spot Magenta `#d6006c`, used once and only for an exceptional warning/gate/active moment.
- Rules: Neutral 200 `#eae7e7`, Neutral 300 `#d7d3d3`.
- Status: Success `#168257` with `#e7f6ed`; Warning `#8a5a00` with `#fff2c7`.

### Component prompts

1. **Analytics dashboard:** "Design a Nomi analytics dashboard inside Shopify admin. Use a warm paper canvas, a 1040px centered shell, Source Serif 4 page headings, compact sans metadata, thin ink rules, crisp white proof-sheet cards, and restrained cyan for selected ranges and links. Show revenue and delivery evidence plainly; do not use generic colorful chart cards or a dark dashboard."
2. **Campaign builder:** "Design a two-pane Nomi campaign builder. The left pane contains a compact prompt, audience facts, and lifecycle-safe settings; the right pane is a sticky email proof on a neutral gray canvas. Use 2px corners, hairline borders, an ink page action, cyan focus and selection states, and at most one magenta risk notice. The email inside the proof must look merchant-branded, not Nomi-branded."
3. **Lifecycle editor variant:** "Create a Nomi lifecycle map with stacked white flow groups, circular count badges, 58px email rows, explicit ready/waiting labels, and a sticky proof pane. Keep category colors semantic and quiet. Preserve the editorial heading and compact operational density."

### Incremental iteration

- Generate the information architecture and hierarchy first, then apply the Nomi tokens. Do not redesign Shopify's outer navigation.
- Review every screen for accent discipline: cyan should trace interaction; magenta should appear once or not at all.
- Compare corner radii and shadows against the source after each iteration. If a normal dashboard card looks soft, bubbly, or floating, reduce it to a 1–4px radius and a hairline/subtle shadow.
- Check serif/sans role separation, not just font presence.
- Verify keyboard focus, semantic status labels, contrast, and reduced motion before approving a visual variant.
- Create variants by changing layout and information hierarchy, not by abandoning Nomi's palette or component language.

## 7. Source Map

### Authoritative sources scanned

- `CLAUDE.md` and `DECISIONS.md` for brand intent, voice, and dashboard-versus-email boundaries.
- `app/styles/nomi.css` for tokens, shipped component styling, responsive rules, motion, and focus states.
- `app/routes/app._index.tsx` for dashboard, lifecycle editor, preview, and onboarding component usage.
- `app/routes/app.campaigns.tsx` for the campaigns table and gated pre-launch shell.
- `app/routes/app.tsx` and `app/root.tsx` for Shopify embedding, navigation, and font loading.
- `branding/nomi-app-icon-shopify.svg` and `branding/nomi-app-icon-shopify-1200.png` for the paper-plane mark.
- `output/design-reference-frames/nomi/` and the Nomi contact sheet for the approved onboarding sequence.

### Deliberately excluded from visual authority

- Merchant email templates and `app/email-engine/`: these generate per-merchant email brands and must not redefine Nomi's dashboard.
- `Shopify email marketing app (1)/`: useful historical mockups, but explicitly non-shipping according to the project brief.
- Unstyled or incomplete route markup that has no corresponding rule in `nomi.css`.
