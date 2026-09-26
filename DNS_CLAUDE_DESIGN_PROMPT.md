# Claude Design prompt — Sending domain, step 2

Redesign the second page of Nomi's sending-domain setup: the DNS records screen. I have already provided the Nomi brand guidelines PDF in this project. Read it first and use it as the visual source of truth. Do not invent a new brand or reuse a merchant email's brand. The attached screenshots are evidence of the current UI and its problems, not a layout to reproduce.

Nomi is an AI email app embedded in Shopify Admin. Its promise is “Install it, and your store's email is done.” This screen is for a busy ecommerce merchant who may never have edited DNS before. Their job is to open their domain provider, add the supplied records, return to Nomi, and check verification. Design a calm, premium, clear working surface that makes that task feel manageable.

Scope: redesign step 2 only, retaining continuity with steps 1 (Domain) and 3 (Verified). Produce a responsive interactive design prototype, not a backend integration. Keep Shopify's surrounding admin chrome separate from the Nomi canvas. Do not redesign the whole app.

Current problems to solve:
- Oversized title, repeated step labels, a replay banner, domain summary, and three instruction blocks push the actual records below the fold. On mobile no record appears in the first screenful.
- Two numbered sequences compete: the setup progress and the instructions inside step 2.
- The screenshot is a replay of an already-verified domain. “Verified”, “Add records”, a checked checkbox, “Verify again”, and “Finish replay” coexist and create contradictory expectations.
- Long DNS values overwhelm the layout. Generic repeated “Copy” buttons make it hard to know which field was copied.
- DMARC competes with the required sending records and the next action is too far away.

Design direction:
- Follow the existing Nomi PDF's typography, spacing, colors, and component language. Project context is editorial/newsprint: ink #201e1d, paper #f3f2f2, restrained cyan #0088b0 for interactions, Source Serif 4 for headings and readable sans-serif for controls. If the PDF differs, follow the PDF and explain the difference.
- Use a compact header and restrained three-step progress. One clear heading such as “Add your DNS records”, the selected domain, and one plain sentence explaining where the action happens.
- Make the records the main working surface. Show the first record in the initial desktop viewport. Use a well-aligned table or compact record groups on desktop and clearly labeled stacked records on mobile. Keep help secondary and expandable.
- Avoid oversized cards nested inside cards, gradients, decorative illustrations, excessive pills, decorative checkmarks, and a generic three-column dashboard.

Required information and interactions:
1. Selected domain: trynomi.email. Domain switching is a secondary action in normal setup.
2. A short instruction: “Add these records in your domain provider's DNS settings, then return here to verify.” Include secondary “Where do I find DNS settings?” help. Do not invent the merchant's provider or claim a working provider connection.
3. Records are supplied by the email provider and vary by domain. The current example has four: TXT / resend._domainkey / a long DKIM public key; MX / send / feedback-smtp.us-east-1.amazonses.com / priority 10; TXT / send / v=spf1 include:amazonses.com ~all; CNAME / rsend / send.forge.rmta.net. Use the attached screenshot's DKIM value or explicitly marked demo data. Never imply demo records are valid for a real domain.
4. Every record shows Type, Host / Name, Value / Points to, optional Priority, and verification status. Explain record purpose only as secondary information. Keep technical labels compatible with DNS provider forms.
5. Separate field copy controls with clear accessible names, e.g. “Copy host” and “Copy value”. Show local “Copied” feedback. Copy the full underlying value exactly, even when the display is shortened. Long values must not force horizontal page scrolling; support inspecting the full value without making it the dominant visual element.
6. Contextual host guidance: “If your provider adds trynomi.email automatically, enter send, not send.trynomi.email.” Place this near the Host field or in concise help, not a giant warning above all records.
7. Preserve the current confirmation “I've added these records” before enabling “Verify records”. Make it plain that this checkbox is merchant confirmation, not proof of DNS verification. Keep the main action easy to find and at least 44px high. A sticky action area may be used if it never obscures records or mobile content.
8. Show accurate verification progress, such as “2 of 4 records verified”, driven by record state rather than copied-field count. Include last checked time in secondary text. State that changes can take time and that Nomi continues checking after verification starts. Avoid guaranteed timing or success claims.
9. DMARC is a separate recommended section. If found: “DMARC policy found. Keep your existing record.” If missing, reveal the suggested TXT record only in expanded help. Never tell a merchant to overwrite an existing policy or add a duplicate. Show duplicate-policy and lookup-error states distinctly when applicable.

Prototype these distinct states:
- Initial setup: records await checking, confirmation unchecked, verify disabled.
- Copy feedback and keyboard focus.
- Checking: busy action and clear checking status.
- Partial result: verified records stay calm; missing/mismatched records show a short, specific fix beside the affected record. Distinguish “not found” from “doesn't match”.
- Temporary check failure: preserve records and progress, explain the failed check, offer retry.
- All verified: success summary and a clear continuation to step 3; stop instructing the merchant to add records again.
- Replay: a compact “Viewing completed setup” notice and “Finish replay” action; make records read-only reference material and do not offer live verification or changes.

Deliver desktop (1440px), tablet (768px), and mobile (375px) designs. Make mobile a deliberate stacked layout, with readable text, 44px touch targets, visible focus, no clipped values or overlapping action areas. Use text with status color so state is understandable without color alone.

Start with one strong design direction and implement it. Explain the information hierarchy briefly, then provide the interactive prototype with a clearly separate demo-state switcher so we can inspect the states without pretending to change real DNS. The design succeeds when a first-time merchant immediately understands where to go, what to copy, what to do next, and whether any action is still required.

## Screenshot attachments

Attach these current Chrome captures with the brand PDF:
- screenshots/dns-design-current-desktop.png — header and first viewport.
- screenshots/dns-design-current-records-desktop.png — records, DMARC, and verification footer.
- screenshots/dns-design-current-tablet-768.png — tablet first viewport.
- screenshots/dns-design-current-mobile-375.png — mobile first viewport.

These captures show the current verified/replay state, not a fresh pending setup. They are viewport captures of the embedded Shopify page; the iframe's internal content is not all visible in one full-page image.
