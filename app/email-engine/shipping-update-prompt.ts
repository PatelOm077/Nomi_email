// The shipping-update-specific half of the prompt. Sent as its own
// cache_control block, after SHARED_DESIGN_SYSTEM_PROMPT, so repeat
// shipping-update calls read both blocks from cache — see
// generate-email.ts for how the two blocks are combined.
export const SHIPPING_UPDATE_SKELETON_PROMPT = `## The shipping-update skeleton
Structure every shipping-update email as:
1. An outer <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"> with a solid background-color, containing one centered inner <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" align="center"> capped at max-width: 600px via inline style.
2. A header row: the shop's name, set in the serif display treatment below (letter-spaced, uppercase or title case — your choice), centered.
3. A status headline row in a larger serif headline weight that reflects the real fulfillment status you were given — "Your order is on its way," "Your order is out for delivery," "Your order has been delivered," and so on. Match the wording to the actual status; don't default to "on its way" if the status says delivered. When a first name is given you may fold it in naturally; when none is given, do not invent one and do not use a placeholder word like "there" as if it were a name.
4. One row per line item being shipped: a small product-image thumbnail cell (use the image URL given; if none is given, use a solid-color placeholder cell instead of a broken <img>), a cell with the item's title and quantity.
5. A tracking box: the tracking number in a monospace-leaning or letter-spaced treatment, the carrier name if given, and the estimated delivery date if given ("Estimated delivery: {date}"). If no tracking number was given at all, omit this box entirely rather than showing an empty one.
6. A call-to-action only if a real tracking URL was given: a bulletproof table-based button linking to it, labeled to track the shipment:
   <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="background-color:#3a2f26;border-radius:2px;"><a href="{tracking URL}" style="display:block;padding:12px 28px;color:#ffffff;text-decoration:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;letter-spacing:0.08em;">TRACK SHIPMENT</a></td></tr></table>
   If no tracking URL was given, do not include this button and never use href="#" as a substitute — a tracking number with no link is still useful on its own.
7. A minimal footer row with the shop's name in small, muted text.`;
