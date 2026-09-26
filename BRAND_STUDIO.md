# Nomi Brand Studio

This file is the durable product brief for Nomi's merchant-specific email
generation experience. Read `CLAUDE.md`, `SPEC.md`, `DECISIONS.md`, and this
file before changing Brand Studio, onboarding, template generation, or the
handoff into Templates.

> **Current-flow note (2026-09-13):** The latest implemented onboarding removed
> the separate Brand Intent screen. Snapshot now continues directly to Create;
> the six-stage rail is Scan, Snapshot, Create, Choose, Build, Ready. For the
> current route, data, model, and handoff truth, read `docs/onboarding-system.md`.
> The older Brand Intent detail below remains historical design context only and
> must not be restored without an explicit product decision.

## Product promise

Nomi creates an original email identity for each merchant. Gauge and Denizen
are quality references, not reusable production themes. Technical email-safe
components may be reused invisibly, but the visible composition, typography,
palette, imagery, button treatment, voice, and storytelling must be specific
to the merchant.

## Cost ceiling

- Target one-time AI setup cost: USD $2.00-$2.70 per merchant.
- Hard ceiling: USD $3.00 per merchant setup.
- Do not rely on promotional credits or data-sharing incentives in production.
- Do not generate three complete lifecycle systems before selection.
- Generate the final family in five flow-sized Sonnet passes after approving
  the Brand System and recipes. This gives the model enough creative room
  without asking one response to carry 13 complete documents.
- AI-generated campaign imagery is outside the standard onboarding budget.

## Model roles

### GPT-5.6 Sol (`medium` reasoning)

- Analyze supplied Shopify and public storefront evidence.
- Extract factual brand signals and product/positioning patterns.
- Suggest editable answers for the two Brand Intent questions.
- Produce the evidence-backed Brand Snapshot and lifecycle objectives.
- Act as an independent factual reviewer only when deterministic checks flag
  a problem.

### Claude Sonnet 5 (`high` effort)

- Create three meaningfully different creative directions.
- Design the selected merchant-specific Brand System.
- Decide layout rhythm, typography character, palette roles, image treatment,
  component treatment, and voice.
- Plan and write the coordinated lifecycle email system.
- Art-direct and author the final responsive HTML, including product staging,
  CTA treatment, contrast, rhythm, and a brand-specific footer.
- Refine design or copy after merchant feedback.

### Nomi code

- Persist versioned Brand Profiles, directions, and the approved Brand System.
- Enforce the dollar and token budget before every request.
- Validate facts, URLs, contrast, accessibility, and uniqueness.
- Validate model-authored HTML against approved assets, links, brand tokens,
  accessibility, email safety, and family uniqueness before persistence.
- Compile structured recipes into deterministic email-safe HTML only as a
  fallback when no validated authored document exists.
- Keep sending disabled until the merchant explicitly approves it.

## Earlier onboarding concept (superseded)

Brand Studio contains six concise screens and only three merchant decisions.

1. **Welcome + store scan** — automatic. Explain what is being read and show
   real progress without pretending a timer is analysis.
2. **Brand Snapshot** — show what Nomi learned with sources; merchant confirms
   or corrects it.
3. **Brand Intent** — exactly two questions:
   - Who is your main customer?
   - What should your brand feel like?

   Each question offers an editable writing field and `Decide for me`.
   `Decide for me` reveals the suggestion already produced during the Sol
   analysis; it must not trigger another paid request or lock the answer.
   A quiet `Decide both for me` action is allowed. The primary CTA is
   `Create my directions` and becomes available when both answers are present.
4. **Creating directions** — real progress while Sonnet creates and Nomi
   validates three directions.
5. **Choose a direction** — three lightweight, genuinely different concepts
   using real merchant products. Each includes a name, rationale, palette,
   typography character, image treatment, sample headline/CTA, and one compact
   Welcome-email preview.
6. **Confirm and build** — approve immediately, add one concise refinement, or
   return to the directions. Approval creates the Brand System and lifecycle
   recipes, then continues into the existing Templates experience.

Advanced controls such as mandatory phrases, forbidden phrases, competitors,
and inspiration links belong in Brand Settings after onboarding. They are not
on the Brand Intent screen.

## Experience rules

- Calm, editorial, premium ecommerce-tool aesthetic.
- Nomi paper/ink surfaces with restrained cyan active feedback and magenta only
  as a single spot accent.
- Lora SemiBold for expressive headings and IBM Plex Sans for interface text,
  consistent with the approved Templates direction.
- The memorable motion is the storefront evidence becoming a composed brand
  direction; surrounding motion stays restrained.
- Every control needs visible hover and keyboard-focus states, and every CTA
  must be at least 44px high.
- Respect `prefers-reduced-motion`.
- Work at 375px, 768px, and 1280px+ without page-level horizontal overflow.
- Do not change the approved Page 17 composition while adding the handoff.
- Nothing sends or changes audiences, timing, offers, or flows without explicit
  merchant approval.

## Data and privacy

- Never send secrets or private customer/order PII as brand evidence.
- Prefer public storefront content and merchant-owned Shopify product data.
- Every inferred brand claim records its source and confidence.
- Store model inputs/outputs only when needed for the merchant experience;
  OpenAI requests use `store: false`.
- A missing field is `null`, never invented filler.

## Definition of done

- A merchant can complete the current six-stage flow, edit the Brand Snapshot,
  select/refine a direction, and reach Templates with the selected brand state
  preserved.
- Refreshing or changing browser/device does not lose durable progress.
- Sol and Sonnet failures produce actionable retry states without spending past
  the hard ceiling.
- Automated tests cover schemas, budget enforcement, persistence, and actions.
- The final UI is inspected in Chrome at desktop, tablet, and mobile, including
  default, focus, loading, selected, error, and success states.
- Screenshots and findings are recorded under `.design/brand-studio/` and the
  project `DESIGN_REVIEW.md` when relevant.
- `npm.cmd run build` passes after the final UI change.
