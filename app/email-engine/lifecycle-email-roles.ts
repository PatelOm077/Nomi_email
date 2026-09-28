import type { LifecycleEmailId } from "./types";

// What each of the 13 lifecycle emails is for — its job within its flow.
// Flow-level purposes alone ("bring them back to the cart") left sibling
// emails with the same intent and, in practice, the same structure. These
// roles are given to the Brand Studio brief writer (brand-studio/ai.server.ts)
// and the family creative director (lifecycle-photo-kit-plan.ts). They fix
// what an email is for, never its layout.
export const LIFECYCLE_EMAIL_ROLES: Record<LifecycleEmailId, string> = {
  "welcome-1": "Hello: who the brand is, introduced through its hero product.",
  "welcome-2": "The brand story: how and why the products are made — materials, craft, values the store actually states.",
  "welcome-3": "Where to start: the best products for a new customer, and why each one.",
  "interest-1": "A closer look at the product the customer viewed: what it is and what makes it worth having.",
  "interest-2": "Answer the doubts: how to use it, who it's for, and the details that help someone decide.",
  "cart-1": "A gentle reminder: the items are saved and one click away.",
  "cart-2": "Reassurance: why the cart products are worth it, using only benefits the store states.",
  "cart-3": "A last quiet note: short and simple, one clear return-to-cart action.",
  "thank-you": "Thanks for the order, and how to get the most from what they bought.",
  "review-request": "A gentle review ask for what they bought, with a decorative star row.",
  "winback-1": "We miss you: warm and personal, a reason to come back.",
  "winback-2": "What's new or what they've missed since their last visit.",
  "winback-3": "A last warm invitation back.",
};

export function lifecycleEmailRole(id: string): string {
  return LIFECYCLE_EMAIL_ROLES[id as LifecycleEmailId] ?? "";
}
