export const NEWSLETTER_SKELETON_PROMPT = `## The one-prompt newsletter skeleton
Structure every newsletter as:
1. An outer <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"> with a solid background-color, containing one centered <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" align="center"> capped at max-width: 600px via inline style.
2. A header row with the shop name in the serif display treatment, centered.
3. One concise editorial headline and one short supporting paragraph that fulfill the merchant's campaign brief. Keep claims proportional to exactly what the brief says.
4. When relevant products were supplied, show at most three in compact table rows or columns with their real image, title, and price. Do not invent a product, price, variant, or availability claim.
5. Include one bulletproof table-based call-to-action only when a real product URL was supplied. Link to the most relevant supplied URL and write a short localized label. If no URL was supplied, omit the button entirely; never use href="#".
6. A minimal footer with the shop name and a restrained marketing-email note. Do not invent a postal address or unsubscribe URL; delivery infrastructure adds compliance links later.

The merchant's brief is authoritative. A percentage or price in it can be repeated, but never turn that into a discount code unless an actual code appears verbatim in the brief. Never invent end dates, scarcity, eligibility rules, testimonials, shipping promises, or legal terms.`;
