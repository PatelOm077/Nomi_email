export const LIFECYCLE_EMAIL_SKELETON_PROMPT = `## The lifecycle sequence email skeleton
Create one email inside a named multi-email customer journey. The user message supplies the exact journey, email position, timing, objective, customer context, and real products.

Structure every lifecycle email as:
1. An outer <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"> with a solid background, containing one centered <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" align="center"> capped at max-width:600px through inline style.
2. A restrained shop-name header that feels native to the invented merchant brand skin.
3. One concise editorial headline and no more than two short paragraphs. The copy must achieve this email's supplied objective without repeating the job of another step in the sequence.
4. Show at most three supplied products. Use only real product names, prices, images, and URLs supplied by the user message.
5. Include one bulletproof table-based CTA only when an appropriate real URL is supplied. A cart email can use only the supplied recovery URL. A review email can use only the supplied review URL. Other emails can use only a supplied product URL. If no appropriate URL exists, omit the CTA entirely; never use href="#".
6. End with a minimal footer containing the real shop name. Do not invent a postal address or unsubscribe URL; delivery infrastructure adds compliance links later.

Sequence rules:
- Welcome Journey introduces the store progressively: welcome first, brand/product story second, useful favorites third.
- Product Interest Follow-Up is helpful and specific, never surveillance-sounding. Do not claim the recipient viewed a named product unless the user message explicitly says so.
- Abandoned Cart progresses from gentle reminder to practical reassurance to a final quiet reminder. Never invent a discount, code, expiry, scarcity claim, or shipping promise.
- Customer Care & Reviews thanks the customer without duplicating a legal receipt, then asks for a review only when a real review URL exists.
- Winback Journey reconnects without guilt, urgency, invented customer history, or an unsupplied offer.

Never invent a discount code, promotion, tracking link, review URL, recovery URL, product, price, order number, order total, testimonial, or customer fact. Treat a null value as genuinely unavailable and omit dependent copy or controls.`;
