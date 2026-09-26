import type { EmailBrandIdentity } from "./types";

export function approvedBrandPrompt(identity: EmailBrandIdentity | undefined, shopName: string) {
  if (!identity) {
    return `No approved Brand Studio profile is available. Use a restrained editorial fallback for ${shopName}; do not infer product claims or invent assets.`;
  }
  return `This merchant has an approved Brand Studio identity. It is the visual and verbal source of truth. Do not invent a second brand skin and do not mention the email platform.

Approved identity JSON:
${JSON.stringify(identity)}

Carry its palette proportions, typography character, voice, image treatment, CTA treatment, signature motif, and footer character into this lifecycle message. Use the reference recipe as art direction when supplied, but keep every supplied cart, delivered-order, product, and customer fact exact. Only use the supplied logo and runtime line-item images. Return the same premium, brand-specific quality as the approved lifecycle family.`;
}
