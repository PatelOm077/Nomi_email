# Shopify app development

This app is scaffolded from a Shopify app template. See the README for framework-specific details.

**Read these three files before doing anything else — they are the actual project brief, not this file:**
- `CLAUDE.md` — stack, folder layout, conventions, don't-touch rules, how to run it. Read this first.
- `SPEC.md` — the five v1 features and what "done" means for each, with status notes on what's already built.
- `DECISIONS.md` — dated log of why choices were made (model choice, caching approach, brand, distribution type). Don't re-litigate these without a reason.

Use the [Shopify AI Toolkit](https://shopify.dev/docs/apps/build/ai-toolkit) for all Shopify API and platform work. If missing, install it in the agent host per that page (or `npx skills add Shopify/shopify-ai-toolkit --list` for skill-compatible hosts) — do not add tooling to this repo.

## Mandatory UI quality gate

Do not hand off a Shopify UI change until it has been checked in Chrome. This
applies to every change that can affect what a merchant sees: route and
component code, CSS, app navigation, images, design tokens, and interactive
states.

1. Run the app and inspect the changed screen in Chrome after the final code
   change — never rely only on source review or an earlier screenshot.
2. Capture the actual rendered state at desktop (1280px or wider), tablet
   (768px), and mobile (375px). Check for clipped text, overlapping controls,
   horizontal scrolling, broken assets, and loading-font changes.
3. Test the changed interactive state when relevant: default, hover/focus,
   selected, disabled, success, error, or empty state.
4. For every CTA, confirm it remains fully visible, has a minimum 44px touch
   target, and does not overlap nearby copy at any tested breakpoint.
5. Save the verification screenshots under `screenshots/` using descriptive
   filenames, then record the check in `DESIGN_REVIEW.md` when one exists.
6. Run `npm.cmd run build` after the final UI change. Only report the task as
   complete when the build passes and the Chrome checks are clean.

For server-only changes with no rendered or interaction impact, run the
relevant automated checks and build; do not claim a Chrome UI check was run.

## Nomi Templates design context

Durable constraints for the Templates route and the customization flow that
follows it.

### Figma source of truth

- File `Nomi Design Templates`, key `QxU9DFP5wNTlNyFCTGoCcJ`
  (`https://www.figma.com/design/QxU9DFP5wNTlNyFCTGoCcJ/Nomi-Design-Templates`).
- The `Email selection pattern` frame (node `81:3`) is the approved
  template-selection design. Page 2 and the file root hold the Denizen mobile
  email direction; Gauge mobile exports live in `public/template-looks/`.
- Read and inspect Figma freely; never modify a Figma frame unless the merchant
  explicitly asks. If the Figma connector needs reauth, inspect the
  authenticated canvas in the merchant's Chrome rather than guessing.

### Templates route (`app/routes/app.additional.tsx`)

- `/app/additional?look=gauge` | `?look=denizen`. Styles in
  `app/styles/nomi.css` near `.nomi-page17`. `Page17LookPreview` owns selection
  and scroll math; `Page17Email` renders each email — do not revert to the old
  generic `EmailPreview` shell, which reused one hero image and cropped
  products.
- Two panels only: Flow Selector (left), Live Preview (right).
- Lora SemiBold for flow names; IBM Plex Sans for labels, counts, controls,
  and email-row text.
- ~36px round count bubbles; compact, visually light `0 of N` controls.
- Roomy email rows with mail icons and clear selected / hover / keyboard-focus
  states.
- Only the selected email row shows the restrained cyan `PREVIEWING` label;
  sibling rows have no pill. Selecting a collapsed flow expands it and collapses
  the previously open one.
- Preview is a real 390px mobile email in a fixed-height, internally scrolling
  viewport — never a page-height render. The scroll thumb is computed from real
  `scrollTop` / `scrollHeight` / `clientHeight`, never decorative. Reset scroll
  to the top on every flow or email change.
- Never crop a product image to fill the preview; preserve its aspect ratio and
  let the contained scroll reveal the rest.
- `Start customizing`: 172px wide, directly below/right of the viewport with a
  small top gap, ≥44px touch target.
- Off-white / paper surfaces across the route; no black outer frame or
  page-level gutters.
- Four flows with real email counts: `Welcome` 3, `Still interested?` 2,
  `Abandoned cart` 3, `How was it?` 2. Each email renders its own complete
  mobile composition — never one shared hero image or generic shell.
- Assets: `public/template-looks/gauge-welcome-0{1,2,3}.png`; Denizen
  compositions (`Welcome` / `Palette` / `Route`) use `denizen-vector-01.png`
  and `denizen-material-macro.png`, no fixed-height cropping.

### Visual direction and working style

- Calm, editorial, premium ecommerce-tool aesthetic. Off-white surfaces, dark
  ink, restrained cyan only for active feedback. Avoid generic dashboard
  styling, overcrowding, extra side panels, pill soup, and page-level
  empty-space previews.
- The selected look, flow, and email must feel continuous across steps, never a
  reset into an unrelated editor.
- Use the frontend-design and design-review skills for meaningful UI work;
  inspect Figma before implementing visual detail.
- The merchant strongly prefers visual evidence over source-only assurances. If
  Chrome shows something wrong, fix it and re-review before handing off.
- Don't guess on genuinely ambiguous Figma intent — ask one focused question,
  but first exhaust the file, screenshots, current code, and the authenticated
  Chrome canvas.

### Customization (after `Start customizing`)

- Build it as a new route/page or the existing Flow Editor route; never
  redesign or overwrite the Templates route for it.
- Carry the selected look, flow, and email forward. Keep the email preview
  contained with internal scrolling. No three-column generic dashboard, no
  page-height email, no reset to an empty editor.
- Review the Flow customizer Figma material before implementing or altering the
  customization experience.

### Repository hygiene

- The worktree holds many merchant-owned changes and untracked design assets.
  Preserve unrelated edits; never clean or reset the repo to shrink a diff. Do
  not edit `.env` or expose secrets. Do not delete template-look assets or
  verification screenshots without an explicit request.

## Troubleshooting

### Prisma EPERM error on Windows (`query_engine-windows.dll.node`)
If the dev server crashes or is stopped abruptly, you may see this error when trying to start it again:
`EPERM: operation not permitted, rename '...\node_modules\.prisma\client\query_engine-windows.dll.node.tmp...' -> '...\node_modules\.prisma\client\query_engine-windows.dll.node'`

**Why it happens:** A "zombie" or background Node.js process from the previous run is still alive and holding a file lock on the Prisma database engine DLL. When `shopify app dev` runs `prisma generate` on startup, Windows blocks it from overwriting the locked file.

**How to solve it:** kill the hanging dev-server processes before restarting.
Prefer the surgical version so you don't also kill MCP servers or other
projects' Node:

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match 'shopify.*app dev|react-router[\\/]dev|with-database-url' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

(`react-router[\\/]dev`, not `react-router dev` — Windows renders the
react-router CLI's own command line as `...\@react-router\dev\bin.js`, no
space and a backslash, so a plain `react-router dev` or `@react-router/dev`
pattern never matches it. A process missed by this filter keeps holding the
Prisma query_engine DLL open, so every retry hits the same EPERM.)

Fallbacks: `Get-Process node | Stop-Process -Force` (nukes *every* Node
process on the machine — MCP servers included), or Task Manager → end the
`Node.js` tasks. Once the lock is released, `npm run dev` will succeed.

**Watch for MCP-server pile-up.** Each agent session spawns `@shopify/dev-mcp`
and `chrome-devtools-mcp` child processes (~100 MB each) and they are not
always reaped when the session ends. If the machine feels slow, list them with
`Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Select ProcessId,CommandLine`
and kill the stale duplicates (keep the newest pair of each).

**How to avoid it:**
To prevent making "stale" or "zombie" background processes:
- **Always shut down gracefully:** When you are done running the dev server, go to the terminal where it is running and press `Ctrl+C` to stop it. Wait for it to cleanly exit.
- **Don't force close windows:** Closing a terminal window (or your IDE) while the server is still running will often leave the background `node.exe` process alive indefinitely. Always stop the process first.
