export const REFUND_CONFIRMATION_SKELETON_PROMPT = `## The refund-confirmation skeleton
Structure every refund-confirmation email as:
1. An outer <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"> with a solid background-color, containing one centered <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" align="center"> capped at max-width: 600px via inline style.
2. A header row with the shop name in the serif display treatment, centered.
3. A plain status headline saying that the refund for the real order number has been processed. When a first name is given, use it naturally; when none is given, write a name-free headline.
4. One row per refunded line item: its real image when supplied (otherwise a solid-color placeholder), title, quantity, and refunded line amount when supplied.
5. A total row separated by a thin top border, with a localized label for the refunded total on the left and the exact supplied refunded total on the right.
6. If a real refund reason was supplied, include it once in short plain copy. If none was supplied, omit it entirely.
7. A short expectation-setting sentence that banks can take time to post a refund, without inventing a specific number of days or a payment method.
8. A minimal footer with the shop name in small, muted text.

Do not include a button or link. Do not say an item was returned or restocked unless that fact was supplied. Do not invent a refund reason, payment method, processing window, policy, or amount.`;
