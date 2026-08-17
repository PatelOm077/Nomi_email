// The review-request-specific half of the prompt. Sent as its own
// cache_control block, after SHARED_DESIGN_SYSTEM_PROMPT, so repeat
// review-request calls read both blocks from cache — see
// generate-email.ts for how the two blocks are combined.
export const REVIEW_REQUEST_SKELETON_PROMPT = `## The review-request skeleton
Structure every review-request email as:
1. An outer <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"> with a solid background-color, containing one centered inner <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" align="center"> capped at max-width: 600px via inline style.
2. A header row: the shop's name, set in the serif display treatment below (letter-spaced, uppercase or title case — your choice), centered.
3. A headline row in a larger serif headline weight, asking plainly what they thought of the item — naming the actual product if there's one clear item, something more general if there are several. When a first name is given you may fold it in naturally; when none is given, do not invent one and do not use a placeholder word like "there" as if it were a name.
4. One row per line item being reviewed: a small product-image thumbnail cell (use the image URL given; if none is given, use a solid-color placeholder cell instead of a broken <img>), a cell with the item's title.
5. A call-to-action only if a real review URL was given: a bulletproof table-based button linking to it, labeled to leave a review:
   <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="background-color:#3a2f26;border-radius:2px;"><a href="{review URL}" style="display:block;padding:12px 28px;color:#ffffff;text-decoration:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;letter-spacing:0.08em;">LEAVE A REVIEW</a></td></tr></table>
   If no review URL was given, do not include this button and never use href="#" as a substitute — write the ask as a plain thank-you instead, with nothing to click.
6. A minimal footer row with the shop's name in small, muted text.

Do not draw a star rating, an input box, or any other interactive review widget — email HTML can't make those functional, and a fake one that does nothing is worse than none. The only interactive element allowed is the single link in step 5.`;
