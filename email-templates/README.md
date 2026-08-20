# Nomi Shopify email templates

Three email-safe design directions for Shopify's native notification and
marketing-email editors. Each `.liquid` file can render four lifecycle email
types while keeping the visual system consistent:

- `order_confirmation`
- `return_refund`
- `abandoned_cart`
- `newsletter`

## Designs

1. **Broadsheet** — editorial masthead, generous white space, hairline rules.
2. **Dispatch** — dark header, compact modules, clear status-driven hierarchy.
3. **Field notes** — warm paper, numbered moments, softer personal tone.

The default skin uses Nomi's ink, paper, cyan, and single magenta accent. The
logo and store name come from Shopify, so the same skeleton can be re-skinned
for any merchant.

## Install

Open the chosen file and change the first assignment:

```liquid
{% assign email_type = 'order_confirmation' %}
```

Then paste the complete file into the matching Shopify editor:

| `email_type`         | Shopify destination                                                                |
| -------------------- | ---------------------------------------------------------------------------------- |
| `order_confirmation` | Settings → Notifications → Customer notifications → Order confirmation → Edit code |
| `return_refund`      | Settings → Notifications → Customer notifications → Order refund → Edit code       |
| `abandoned_cart`     | Marketing → Automations → Abandoned checkout/cart → Edit email → Code your own     |
| `newsletter`         | Marketing → Campaigns → Shopify Messaging → Code your own                          |

For transactional notifications, set the email subject separately in Shopify.
Suggested subjects:

- Order confirmation: `Order {{ name }} is confirmed`
- Return/refund: `Your refund for {{ name }}`

For marketing emails, Shopify requires an unsubscribe URL. Both marketing
branches include `unsubscribe_url` and the open-tracking block.

## Preview

Open `preview.html` in a browser. Use the email-type picker to compare all three
directions at desktop and phone widths.

Run `npm test` from the repository root to render every design with both
Shopify abandonment object shapes and exercise all preview picker and width
states. This automated check complements, but does not replace, Shopify's test
email rendering.

## Before publishing

- Replace the newsletter campaign headline, body, and destination link.
- Send a Shopify test email for every notification type.
- Test both a checkout automation and a cart automation; the templates support
  `abandoned_checkout` and `abandoned_visit`.
- Keep the Shopify default template available so duties, subscriptions,
  exchanges, bundles, and multi-delivery logic can be merged when a store uses
  those features.
