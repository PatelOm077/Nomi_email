// The rules every AI photo plan follows, shared verbatim by the campaign
// creative director (campaign-creative-plan.ts) and the Brand Studio photo
// kit (lifecycle-photo-kit-plan.ts) so the two can never drift apart. The
// reviewer (campaign-image-review.ts) enforces the same rules after render.
// The merchant has rejected hands-on-product shots twice — keep the people
// and bodies rules intact whenever this is edited.
export const PHOTO_DIRECTION_RULES = `Honesty:
- A photo that shows real products lists them in productIds, and only products listed with a real photo may appear. Its prompt must say those products must be reproduced faithfully from the reference photos — same shape, colour, material, proportions, and label — and must not add variants, colours, or products the store doesn't sell.
- A photo with empty productIds must not show any identifiable product or packaging.
- Never depict a discount, price, badge, sale sign, or claim.

Writing image prompts:
- artDirection is one shared paragraph applied to every photo so they read as one shoot: lighting, palette that fits this brand, surfaces, lens, mood. Use an empty string when you plan no photos.
- Each prompt describes one photograph concretely: subject, composition, camera distance, framing, light, background. Photorealistic editorial ecommerce photography.
- Each prompt must say: no text, letters, logos, watermarks, or signage anywhere in the image, except the product's own label exactly as it appears in its reference photo.
- No hands, fingers, arms, skin, or body parts in frame, and never a product being applied, rubbed, dabbed, squeezed, held, or used on a person. Show products as styled still life in a real setting (on a shelf, a vanity, stone, linen, wood, by a window), and show texture as a clean swatch on a surface, never on a body.
- The only people allowed: when a product is something worn (clothing, accessories, jewellery), a figure wearing it, seen from behind or cropped at the shoulders — never a close-up of skin or a face.
- Nothing that reads as clinical, bodily, or unsettling.
- key is a short unique slug. alt is short, specific, customer-facing alt text.`;
