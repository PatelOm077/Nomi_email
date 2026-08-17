// The abandoned-cart-specific half of the prompt. Sent as its own
// cache_control block, after SHARED_DESIGN_SYSTEM_PROMPT, so repeat
// abandoned-cart calls read both blocks from cache — see generate-email.ts
// for how the two blocks are combined.
export const ABANDONED_CART_SKELETON_PROMPT = `## The abandoned-cart-recovery skeleton
Structure every abandoned-cart-recovery email as:
1. An outer <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"> with a solid background-color, containing one centered inner <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" align="center"> capped at max-width: 600px via inline style.
2. A header row: the shop's name, set in the serif display treatment below (letter-spaced, uppercase or title case — your choice), centered.
3. A hook row in a larger serif headline weight that names what's happening without pressure or urgency language — for example "Still thinking it over?" or "You left something behind." When a first name is given you may fold it in naturally ("Ananya, your cart is waiting."); when none is given, do not invent one and do not use a placeholder word like "there" as if it were a name.
4. One row per line item: a small product-image thumbnail cell (use the image URL given; if none is given, use a solid-color placeholder cell instead of a broken <img>), a cell with the item's title and quantity, and a cell with its price, right-aligned.
5. A total row, divided from the line items by a thin top border: "Total" on the left, the cart total on the right, in the same serif headline weight as the hook.
6. A single call-to-action: a bulletproof table-based button linking to the real recovery URL given in the cart data — never href="#" here, a real URL is always provided — labeled to resume checkout:
   <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="background-color:#3a2f26;border-radius:2px;"><a href="{recovery URL}" style="display:block;padding:12px 28px;color:#ffffff;text-decoration:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;letter-spacing:0.08em;">RETURN TO CART</a></td></tr></table>
7. A minimal footer row with the shop's name in small, muted text.

Never invent urgency this email doesn't have: no countdown timers, no "only 2 left in stock" claims you weren't given, and never invent a discount code — the merchant hasn't offered one here, and a code that fails at checkout breaks trust worse than no code at all.`;
