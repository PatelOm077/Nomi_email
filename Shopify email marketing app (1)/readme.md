<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="omelette-print-source" content="v1786779470043298 readme.md">
<title>Nomi design system</title>
<link rel="stylesheet" href="styles.css">
<style>
doc-page:not(:defined){visibility:hidden}
* { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
* { animation-delay: -99s !important; animation-duration: .001s !important;
    animation-iteration-count: 1 !important; animation-fill-mode: both !important;
    animation-play-state: running !important; transition-duration: 0s !important; }
h1 { font: 600 40px/1.1 var(--font-display); letter-spacing: -0.03em; margin: 0 0 16px; }
h2 { font: 600 24px/1.2 var(--font-display); letter-spacing: -0.02em; margin: 34px 0 10px; }
p, li { font: 400 14.5px/1.6 var(--font-body); color: var(--text-body); }
li { margin-bottom: 5px; }
ul { padding-left: 20px; }
strong { font-weight: 600; }
code { font: 13px ui-monospace, Menlo, monospace; background: var(--nomi-neutral-200); padding: 1px 4px; border-radius: 2px; }
a { color: var(--text-link); }
.lede { font: italic 400 17px/1.55 var(--font-body); color: var(--text-muted); }
.swatches { display: flex; gap: 10px; margin: 14px 0 4px; break-inside: avoid; }
.sw { flex: 1; }
.sw div { height: 46px; border-radius: 2px; }
.sw p { font: 12px var(--font-ui); color: var(--text-muted); margin: 5px 0 0; }
.brandhead { display: flex; align-items: center; gap: 16px; margin-bottom: 20px; break-inside: avoid; }
</style>
</head>
<body>
<doc-page margin="0.75in">

<div class="brandhead">
<img src="assets/app-icon.svg" width="64" height="64" alt="Nomi">
<h1 style="margin:0">Nomi design system</h1>
</div>

<p class="lede">Email marketing that lives inside Shopify admin.</p>

<p>Nomi is an email marketing app for Shopify merchants: merchants write personalized emails and send them from inside Shopify admin, alongside Shopify's own email tooling. The audience is small and indie shops, so the product's promise is that it stays quiet, native and quick to learn.</p>

<p>The identity is newsprint-plain — black ink on paper ground, one cyan for anything actionable, and a magenta used as sparingly as a wax seal. It derives from the Broadsheet visual system (Source Serif 4, process cyan/magenta, whitespace instead of boxes), with one deliberate departure: interface chrome inside Shopify admin sets in the system sans, not the serif.</p>

<h2>Sources</h2>
<ul>
<li>Broadsheet design system (bound to the originating project) — type, color ramps, spacing, elevation.</li>
<li><code>Brand Concepts.dc.html</code> — the naming and mark exploration that produced "Nomi" and the paper-plane mark.</li>
<li><code>Nomi Logo.dc.html</code>, <code>Nomi Brand Kit.dc.html</code> — the approved logo set and brand kit.</li>
<li>No external codebase or Figma file was provided.</li>
</ul>

<h2>Content fundamentals</h2>
<p>Say what the app does, not what it unlocks. Address the merchant as "you"; Nomi refers to itself by name, not "we". Sentence case everywhere, including buttons and headings. Short sentences, no exclamation marks, no emoji. Name the action: send, schedule, preview, duplicate. Numbers are given plainly, with no adjectives around them.</p>
<ul>
<li>Good: "Scheduled for Thursday, 9:00. Personalized with first name and last order."</li>
<li>Good: "2,140 subscribers"</li>
<li>Avoid: "Supercharge your revenue with hyper-personalized campaigns!"</li>
</ul>
<p>Errors state what happened and the next step, in one sentence: "The send failed — your Shopify session expired. Reconnect to try again."</p>

<h2>Visual foundations</h2>
<div class="swatches">
<div class="sw"><div style="background:var(--nomi-ink)"></div><p>Ink #201e1d</p></div>
<div class="sw"><div style="background:var(--nomi-paper);box-shadow:inset 0 0 0 1px var(--nomi-neutral-300)"></div><p>Paper #f3f2f2</p></div>
<div class="sw"><div style="background:var(--nomi-cyan)"></div><p>Cyan #0088b0</p></div>
<div class="sw"><div style="background:var(--nomi-cyan-text)"></div><p>Cyan text #00789e</p></div>
<div class="sw"><div style="background:var(--nomi-magenta)"></div><p>Magenta #d6006c</p></div>
</div>
<p><strong>Color.</strong> Ink #201e1d on paper #f3f2f2; white for card surfaces. Cyan #0088b0 carries interaction (fills, large elements, icons); the darker #00789e is used for body-size text and links so contrast clears on white. Magenta #d6006c is a spot color for one thing at a time and is never a second UI color. Each role carries a 100–900 ramp on a shared perceptual lightness scale; use 100–300 for tints and hovers, 500 as the base, 700–900 for text on tinted fills and pressed states.</p>
<p><strong>Type.</strong> Source Serif 4 owns the brand voice: wordmark (semibold 600, tracking −0.03em), headings, marketing pages, long-form. The system sans runs admin chrome — labels, buttons, fields, tables — so Nomi sits next to Polaris rather than against it, and small labels stay legible. In email, always set "Source Serif 4", Georgia, serif; Gmail and Outlook strip webfonts and Georgia holds the newsprint tone.</p>
<p><strong>Layout.</strong> Left-aligned and asymmetric. Sections are separated by whitespace, not rules, borders or boxes. Content hugs the left edge with air on the right. Spacing scale 5/10/15/20/30/40; do not tighten it.</p>
<p><strong>Surfaces.</strong> Radii are near-square: 1px, 2px, 4px. The single exception is the app icon tile at 12px. Cards are white with <code>--shadow-sm</code>, no border. Elevation only via the three shadow tokens.</p>
<p><strong>Motion.</strong> Restrained: 120ms color and background transitions on interactive elements, no bounces, no entrance animations on lists. Nothing moves that the merchant did not touch.</p>
<p><strong>States.</strong> Hover tints one step of the cyan ramp; pressed goes one step darker (<code>--nomi-cyan-600</code>). Keyboard focus is <code>outline: 2px solid var(--accent-action); outline-offset: 2px</code> — never the browser default. Disabled drops to 45% opacity.</p>
<p><strong>Imagery.</strong> Photography, where used in marketing, takes the newsprint treatments (halftone dot screen for interface imagery, misregistered process plates for showcase photographs). No stock gradients, no illustration of interfaces.</p>

<h2>Iconography</h2>
<p>The mark is a paper plane, drawn as a 2.8px monoline stroke on a 64px grid, reversed out of a black 12px-radius tile (<code>assets/app-icon.svg</code>). For interface icons, use Phosphor (phosphoricons.com) in the duotone weight, from CDN — no icon assets were provided with this brand, so Phosphor is a documented substitution inherited from Broadsheet. Emoji are never used. Do not draw one-off SVG icons; take them from Phosphor.</p>

<h2>Components</h2>
<p>Authored from scratch (no source component library was provided), sized to what an email app needs: <code>components/core/</code> — Button, Tag, Input, Card. All set in the interface sans and styled from the tokens.</p>

<h2>Index</h2>
<ul>
<li><code>styles.css</code> — the entry point; imports everything below.</li>
<li><code>tokens/</code> — <code>fonts.css</code>, <code>colors.css</code>, <code>typography.css</code>, <code>spacing.css</code>, <code>elevation.css</code>, <code>base.css</code>.</li>
<li><code>assets/</code> — <code>app-icon.svg</code>, <code>mark-plane.svg</code>, <code>mark-plane-reverse.svg</code>.</li>
<li><code>guidelines/</code> — specimen cards for colors, ramps, type, spacing, logo and clear space.</li>
<li><code>components/core/</code> — Button, Tag, Input, Card (each with <code>.d.ts</code> and <code>.prompt.md</code>).</li>
<li><code>SKILL.md</code> — Agent Skills entry point.</li>
<li><code>Nomi Brand Kit.dc.html</code>, <code>Nomi Logo.dc.html</code>, <code>Brand Concepts.dc.html</code> — the source design files.</li>
</ul>

</doc-page>
<script src="./doc-page.js"></script>
</body>
</html>