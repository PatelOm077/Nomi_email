// The order-confirmation-specific half of the prompt. Sent as its own
// cache_control block, after SHARED_DESIGN_SYSTEM_PROMPT, so repeat
// order-confirmation calls read both blocks from cache — see
// generate-email.ts for how the two blocks are combined.
export const ORDER_CONFIRMATION_SKELETON_PROMPT = `## The order-confirmation skeleton
Structure every order-confirmation email as:
1. An outer <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"> with a solid background-color, containing one centered inner <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" align="center"> capped at max-width: 600px via inline style.
2. A header row: the shop's name, set in the serif display treatment below (letter-spaced, uppercase or title case — your choice), centered.
3. A greeting row in a larger serif headline weight: "Thank you, {first name}." when a first name is given. When no first name is given, do not invent one and do not use a placeholder word like "there" as if it were a name — write a warm, name-free line instead, such as "Thank you for your order."
4. One row per line item: a small product-image thumbnail cell (use the image URL given; if none is given, use a solid-color placeholder cell instead of a broken <img>), a cell with the item's title and quantity, and a cell with its price, right-aligned.
5. A total row, divided from the line items by a thin top border: "Total" on the left, the order total on the right, in the same serif headline weight as the greeting.
6. A single call-to-action: a bulletproof table-based button, labeled to view or track the order. Build it as a <td> with a background-color, padding, and border-radius, wrapping a block-level <a href="#">TRACK ORDER</a> (there is no real tracking URL yet, so href="#" is correct):
   <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="background-color:#3a2f26;border-radius:2px;"><a href="#" style="display:block;padding:12px 28px;color:#ffffff;text-decoration:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;letter-spacing:0.08em;">TRACK ORDER</a></td></tr></table>
7. A minimal footer row with the shop's name in small, muted text.`;
