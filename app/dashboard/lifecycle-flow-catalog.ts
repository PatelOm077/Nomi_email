// Display metadata (names, subjects, preview text, timing, flow grouping)
// for the 13 lifecycle slots across the 5 flows — shared by the Flow
// Editor (AI generation, app._index.tsx) and the Templates page
// (app.additional.tsx), so both pages describe the same 13 emails the same
// way instead of drifting apart.
import type { LifecycleEmailId } from "../email-engine/types";

export type LifecycleFlowId = "welcome" | "interest" | "cart" | "care" | "winback";

export interface LifecycleSlotInfo {
  id: LifecycleEmailId;
  flowId: LifecycleFlowId;
  name: string;
  subject: string;
  previewText: string;
  timing: string;
}

export interface LifecycleFlowInfo {
  id: LifecycleFlowId;
  name: string;
  trigger: string;
  stop: string;
  templateIds: LifecycleEmailId[];
}

export function buildLifecycleSlots(shopName: string): LifecycleSlotInfo[] {
  return [
    { id: "welcome-1", flowId: "welcome", name: "1st Welcome Email", subject: `Welcome to ${shopName}`, previewText: "Your welcome gift awaits", timing: "On trigger" },
    { id: "welcome-2", flowId: "welcome", name: "2nd Welcome Email", subject: `A little more about ${shopName}`, previewText: "What makes this store different", timing: "48 hour(s) from previous" },
    { id: "welcome-3", flowId: "welcome", name: "3rd Welcome Email", subject: "A few customer favorites", previewText: "Real products, chosen for you", timing: "2 day(s) from previous" },
    { id: "interest-1", flowId: "interest", name: "1st Follow-Up Email", subject: "A closer look", previewText: "A useful follow-up from the store", timing: "4 hour(s) after product interest" },
    { id: "interest-2", flowId: "interest", name: "2nd Follow-Up Email", subject: "Still considering it?", previewText: "The details that might help", timing: "2 day(s) from previous" },
    { id: "cart-1", flowId: "cart", name: "1st Cart Email", subject: "You left something behind", previewText: "Your checkout is still saved", timing: "1 hour after checkout activity" },
    { id: "cart-2", flowId: "cart", name: "2nd Cart Email", subject: "Still thinking it over?", previewText: "A simple way back to your cart", timing: "24 hour(s) from previous" },
    { id: "cart-3", flowId: "cart", name: "3rd Cart Email", subject: "One last quiet reminder", previewText: "Your saved items are here", timing: "48 hour(s) from previous" },
    { id: "thank-you", flowId: "care", name: "Thank You Email", subject: `Thank you from ${shopName}`, previewText: "A note of appreciation", timing: "After purchase" },
    { id: "review-request", flowId: "care", name: "Review Request", subject: "How did it wear?", previewText: "Tell us what you think", timing: "7 day(s) after delivery" },
    { id: "winback-1", flowId: "winback", name: "1st Winback Email", subject: "A few things worth seeing", previewText: `What is new at ${shopName}`, timing: "30 day(s) after last order" },
    { id: "winback-2", flowId: "winback", name: "2nd Winback Email", subject: "Something new for your next visit", previewText: "A fresh product edit", timing: "14 day(s) from previous" },
    { id: "winback-3", flowId: "winback", name: "3rd Winback Email", subject: "The door is open", previewText: "A final note from the store", timing: "30 day(s) from previous" },
  ];
}

export const LIFECYCLE_FLOWS: LifecycleFlowInfo[] = [
  {
    id: "welcome",
    name: "Welcome Journey",
    trigger: "Valid email is entered in a pop-up or email field.",
    stop: "User places an order · User was in flow in the last 7 days.",
    templateIds: ["welcome-1", "welcome-2", "welcome-3"],
  },
  {
    id: "interest",
    name: "Product Interest Follow-Up",
    trigger: "A consented customer shows product interest without purchasing.",
    stop: "User places an order · User enters Abandoned Cart.",
    templateIds: ["interest-1", "interest-2"],
  },
  {
    id: "cart",
    name: "Abandoned Cart",
    trigger: "A consented checkout is left with products in it.",
    stop: "User places an order · Checkout is no longer abandoned.",
    templateIds: ["cart-1", "cart-2", "cart-3"],
  },
  {
    id: "care",
    name: "Customer Care & Reviews",
    trigger: "A customer places an order or a fulfilled order is delivered.",
    stop: "The thank-you and review steps have completed.",
    templateIds: ["thank-you", "review-request"],
  },
  {
    id: "winback",
    name: "Winback Journey",
    trigger: "A past customer has not ordered again within the winback window.",
    stop: "User places an order · User was in flow in the last 90 days.",
    templateIds: ["winback-1", "winback-2", "winback-3"],
  },
];
