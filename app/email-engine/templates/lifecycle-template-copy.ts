import type { LifecycleEmailId } from "../types";

// Real, fixed copy for every lifecycle slot — the non-AI counterpart to
// lifecycle-email-prompt.ts. No copy here names a specific fact (order
// number, discount, tracking) since none of that can be relied on to exist;
// dynamic facts (products, order details, real URLs) are inserted by
// lifecycle-template.ts around this copy, never inside it. Sequence tone
// follows the same rules lifecycle-email-prompt.ts documents for the AI
// path, so template and AI-generated emails read like the same product:
// welcome progresses intro -> story -> favorites; cart goes gentle ->
// practical -> quiet, never inventing urgency or a discount; winback never
// guilt-trips or invents history.
export interface LifecycleTemplateCopy {
  headline: string;
  body: string[];
  ctaLabel: string;
}

export const LIFECYCLE_TEMPLATE_COPY: Record<LifecycleEmailId, LifecycleTemplateCopy> = {
  "welcome-1": {
    headline: "Welcome",
    body: ["Thank you for signing up. Here's a quick look at what's here, so you know where to start."],
    ctaLabel: "Start browsing",
  },
  "welcome-2": {
    headline: "A closer look",
    body: ["Every product here is chosen on purpose, not just added to fill a page. Here's a bit more about what makes this store worth a second visit."],
    ctaLabel: "See what's here",
  },
  "welcome-3": {
    headline: "A few favorites",
    body: ["A short list of pieces worth knowing about, picked out for a first visit."],
    ctaLabel: "Shop the favorites",
  },
  "interest-1": {
    headline: "Still on your mind?",
    body: ["Something recently caught your eye. If it's still worth a second thought, here's a closer look."],
    ctaLabel: "Take another look",
  },
  "interest-2": {
    headline: "The details that might help",
    body: ["A few more specifics, in case they make the decision easier."],
    ctaLabel: "See the details",
  },
  "cart-1": {
    headline: "You left something behind",
    body: ["Your checkout is still saved, exactly as you left it. Pick up where you stopped whenever you're ready."],
    ctaLabel: "Return to your cart",
  },
  "cart-2": {
    headline: "Still thinking it over?",
    body: ["Your items are still saved. No rush — here's a simple way back if you'd like to finish."],
    ctaLabel: "Complete your order",
  },
  "cart-3": {
    headline: "One last reminder",
    body: ["This is the last note about your saved cart. It's still here if you'd like it."],
    ctaLabel: "View your cart",
  },
  "thank-you": {
    headline: "Thank you",
    body: ["Thank you for your order. This note is just to say it's appreciated — nothing more needed from you."],
    ctaLabel: "Shop again",
  },
  "review-request": {
    headline: "How was it?",
    body: ["Now that your order has arrived, a short review would help other customers considering the same thing."],
    ctaLabel: "Leave a review",
  },
  "winback-1": {
    headline: "A few things worth seeing",
    body: ["It's been a while. A few new things have arrived since your last visit, in case you'd like a look."],
    ctaLabel: "See what's new",
  },
  "winback-2": {
    headline: "Something new for next time",
    body: ["A fresh edit of what's available now, whenever you're ready to look again."],
    ctaLabel: "Browse the new edit",
  },
  "winback-3": {
    headline: "The door is open",
    body: ["No pressure — just a last note to say everything's still here whenever you'd like to come back."],
    ctaLabel: "Visit the store",
  },
};
