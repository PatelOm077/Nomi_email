# Claude Design prompt — Nomi Brand Studio onboarding redesign

You are redesigning the complete first-run onboarding for **Nomi**, an AI email app embedded in Shopify admin. The current design may be replaced completely. Do not preserve weak layout decisions merely because they exist in the current implementation.

## Inputs I am giving you

1. **Nomi brand guidelines** — treat these as the source of truth for brand character, voice, typography, and core colors.
2. **`Nomi Brand Studio — current onboarding baseline.html`** — the current six-stage onboarding. Use it to understand the required information architecture, content, controls, and states. It is a functional baseline, not a visual direction to protect.
3. **`Nomi Onboarding (standalone) (1).html`** — an earlier Nomi onboarding exploration. Use this as inspiration for energy, color, playful composition, and motion. Do not copy its layout literally and do not regress to its old five-step product logic.

## What is wrong today

The current opening screen feels sparse, rigid, and unfinished. The thin vertical step rail dominates without creating excitement or clarity. The experience looks like a generic setup wizard instead of the moment Nomi discovers and composes a merchant's brand. It needs more personality, more color, stronger visual hierarchy, and a memorable motion idea. The first 10 seconds should make the merchant feel that Nomi is actively finding the identity already inside their store.

This criticism applies to the entire flow, not just the opening screen. Several stages currently resemble an old WordPress settings page: pale boxed fields, rigid document sections, generic white cards, weak hierarchy, and little visual continuity between steps. Do not solve this by merely recoloring the existing components. Redesign the composition, interaction model, visual storytelling, and transitions at every stage.

## Stage-by-stage redesign requirements

### 1. Scan — make the wait worth watching

After the merchant presses `Read my store`, the scan must enter a rich animated loading sequence that lasts naturally until the real scan result is ready. Do not jump directly to Snapshot, show a fake percentage, or loop one generic spinner.

Show meaningful evidence arriving from the store: storefront sections, product cutouts, color samples, typography clues, short phrases, image textures, and source labels. Let these pieces move through clear scan phases such as `Reading storefront`, `Looking at products`, `Finding visual signals`, and `Composing your snapshot`. Transitions should acknowledge real stage changes while remaining safe for an unknown API duration. Include a graceful long-wait state, error/retry state, and reduced-motion equivalent. The animation should make the merchant curious about what Nomi is finding.

### 2. Snapshot — colorful discovery, not a settings form

The current Snapshot feels like a 1990s WordPress editing screen. Replace the two large plain text boxes and generic evidence cards with a fun, visual reveal of what Nomi discovered. Use color, composition, merchant imagery, animated annotations, evidence trails, movable or expandable findings, or another expressive editorial mechanism.

The merchant must still be able to correct the summary and positioning, but editing should be a secondary, elegant interaction—not the whole visual identity of the screen. Consider inline editing, an edit mode, expandable notes, or a visual canvas that becomes editable when requested. Clearly connect every insight to its source. Make confirmation feel like approving a living brand portrait, not submitting a form.

### 3. Intent — turn two questions into a guided creative moment

The current Intent step also feels like an old WordPress form because it is dominated by two rectangular textareas. Redesign it as a focused, playful conversation with exactly two questions. Give each question its own visual personality and enough space to feel important without becoming a long wizard.

Explore expressive prompts, example fragments, animated suggestion reveals, word or mood constellations, responsive color fields, or cards that react to the merchant's answer. `Decide for me` should visibly use the evidence already collected and reveal its reasoning in a light, delightful way. Manual writing must remain easy, editable, and accessible. Do not add extra questions, generic tag clouds, or a cluttered multi-select UI.

### 4. Create — push beyond “average”

The current Create/loading step is acceptable but average. Elevate it into the central transformation scene of the onboarding. Show the approved Snapshot and Intent being recomposed into three distinct creative worlds. The merchant should understand what is happening without reading a technical explanation.

Avoid three floating blank cards, a standard progress checklist, or decorative orbiting shapes with no meaning. Make every animated element trace back to merchant evidence, intent, or a validation action. The sequence must support unpredictable generation time and transition seamlessly into Choose when results arrive.

### 5. Choose — make comparison exciting and unmistakable

The current Choose step is another average three-card grid. Replace the generic equal-card layout with a more cinematic, tactile, and useful way to explore three genuinely different directions. Each direction should feel like entering a distinct world, not seeing the same template with different colors.

Explore a stage, carousel, layered deck, split comparison, expanding editorial spreads, or another interaction that gives the selected direction room to come alive. Use real merchant products and demonstrate differences in composition, typography, image treatment, motif, voice, headline, CTA, and palette. Comparison still needs to be easy and accessible, especially on mobile. The selected direction should transform continuously into Confirm rather than disappearing between pages.

### 6. Build — a rewarding creative finale, not a WordPress confirmation page

The current Build step returns to a WordPress-era layout: preview on one side, form field on the other, followed by a generic success summary. Redesign the whole finale. The selected direction should expand into a convincing preview of the emerging system while the optional refinement feels like directing a creative partner, not completing a settings field.

During `Build my email system`, show the chosen direction propagating across the 13 lifecycle emails through meaningful, coordinated animation. Show visible progress without fake precision. Completion should feel rewarding and colorful: reveal the finished Brand System, its palette, typography, voice, and email family as one coherent system. Keep the reassurance that nothing has been sent or activated. The finale should create confidence and momentum toward `Review my emails`, not resemble an admin receipt page.

## Design goal

Create a **colorful, playful, premium, highly polished onboarding experience** that still feels credible inside Shopify admin. Make it feel like a small creative studio is waking up around the merchant's store: product imagery, words, colors, and evidence are gathered, sorted, and composed into a brand system. Use motion to explain that transformation, not as random decoration.

The experience should be joyful and surprising without becoming childish, noisy, “AI gradient” generic, or game-like. Aim for editorial craft plus kinetic collage: tactile layers, color blocking, expressive type, intelligent transitions, and small moments of delight. Spend the boldest visual move on the transformation of storefront evidence into creative directions; keep controls clear and disciplined.

## Product promise and audience

- Nomi's promise: **“Install it, and your store's email is done.”**
- Audience: busy Shopify merchants who care about their brand but do not want to become email designers.
- The merchant should feel: “It understands my store,” then “I still have control,” then “This system is genuinely mine.”

## Non-negotiable six-stage flow

Keep these stages and their jobs, though you may rename the short progress labels if the meaning stays obvious:

1. **Welcome + store scan** — automatic. Explain that Nomi reads the public storefront and Shopify products. Explicitly say customer and order information stays out. Show real-feeling progress; do not use a fake countdown.
2. **Brand Snapshot** — show what Nomi learned and where the evidence came from. The merchant can edit the summary and positioning, then confirm.
3. **Brand Intent** — exactly two questions: “Who is your main customer?” and “What should your brand feel like?” Both accept writing and have an editable `Decide for me` suggestion. Include a quiet `Decide both for me` action. Primary CTA: `Create my directions`.
4. **Creating directions** — show real progress while three distinct directions are created and validated.
5. **Choose a direction** — show three genuinely different concepts using real merchant products. Each needs a name, rationale, four-color palette, typography character, image treatment, sample headline/CTA, and one compact Welcome-email preview.
6. **Confirm and build** — show the selected direction, allow one optional focused refinement, allow returning to all directions, and use the CTA `Build my email system`. Completion states that 13 coordinated emails are ready for review and nothing has been sent or activated.

Only three merchant decisions exist: confirm/correct Snapshot, answer Intent, and choose/refine a direction. Do not add advanced settings, competitor fields, inspiration links, audience controls, sending controls, or new setup questions.

## Visual direction

- Start from Nomi's brand colors: ink `#201e1d`, paper `#f3f2f2`, cyan `#0088b0`, magenta `#d6006c`.
- You may expand the palette with a small set of supporting colors—such as a process yellow, leaf green, violet, or warm coral—if they harmonize with the brand and have named roles. Cyan remains the main interactive signal; magenta remains a deliberate accent, not a second default CTA color.
- Use **Lora SemiBold** for expressive display moments and **IBM Plex Sans** for interface text unless the supplied brand guidelines specify a newer approved pairing.
- Avoid a generic left-sidebar wizard, tiny grey labels, excessive empty white space, repetitive cards, pill-shaped everything, glassmorphism, neon gradients, and standard SaaS dashboard visuals.
- Progress should feel integrated into the story. Explore a horizontal journey, animated studio desk, stacked scene index, evolving collage, or another fresh model. On mobile, progress must remain understandable without turning into six unexplained dots.
- Use the merchant's actual store name, product imagery, palette evidence, and words as visual material. Never force-crop product images; preserve aspect ratio.
- Keep Nomi's voice plain and specific. No exclamation marks, hype, fake magic claims, or vague AI language.

## Motion direction

Create one coherent motion system with these moments:

- On entry, storefront evidence arrives as separate fragments—product cutouts, color chips, short copy excerpts, typography samples—and assembles into a living composition.
- Scan progress visibly moves through meaningful sources such as storefront, products, imagery, and copy.
- Snapshot evidence can settle into organized findings with staggered but restrained timing.
- `Decide for me` should feel helpful and reversible: reveal/type the suggestion smoothly, then leave the field editable.
- During creation, the approved evidence and intent should transform into three visibly different direction “worlds,” not three cards that simply fade in.
- Direction selection should have a satisfying continuity transition into Confirm; the selected concept should expand or recompose rather than disappear and reload.
- Use micro-interactions for hover, focus, selection, success, and disabled states.
- Respect `prefers-reduced-motion`; all content and progress must remain understandable with motion removed.

## Interaction and responsive requirements

- Design and prototype desktop at 1280px+, tablet at 768px, and mobile at 375px.
- No clipped text, overlapping controls, horizontal page scrolling, or important UI below an artificial fixed viewport.
- Every CTA must be fully visible, at least 44px high, and separated from nearby text.
- Provide visible keyboard focus, hover, selected, disabled, loading, error, retry, and success states.
- Textareas remain editable and comfortably sized. `Decide for me` cannot lock or replace manual input permanently.
- Direction comparison must still work on mobile; do not shrink three desktop cards into unreadable miniatures.
- Nothing sends, activates, changes audiences, changes timing, or publishes without explicit merchant approval.

## Content to preserve

Preserve the existing baseline's meaning and primary action names. You may improve headings and supporting copy only if they remain plain, short, and accurate. Keep explicit privacy language, source attribution in Brand Snapshot, the `$3.00` setup budget ceiling where relevant, and the “nothing is sending” reassurance.

## What I want you to produce

Create a complete, high-fidelity, clickable onboarding prototype covering all six stages plus:

- Scan default/loading/retry
- Snapshot default/focus/error
- Intent empty/suggested/edited/disabled-ready
- Creating progress and reduced-motion equivalent
- Directions default/hover/focus/selected
- Confirm default/refinement entered/building/error
- Complete/success
- Desktop, tablet, and mobile responsive behavior

Deliver the redesigned experience as a **single standalone HTML file** with embedded CSS and JavaScript so it opens locally without a build step. It may completely replace the visual design of the current baseline. Add a short design rationale at the top of the file as an HTML comment describing the visual thesis, palette roles, typography, progress model, and signature motion. Do not return only static mockups; the prototype must be clickable and demonstrate transitions and interactive states.

Before finalizing, critique the result against this brief. Remove anything that looks like a generic onboarding template, confirm the first screen feels substantially more alive than the current baseline, verify every stage is present, and test at 1280px, 768px, and 375px.
