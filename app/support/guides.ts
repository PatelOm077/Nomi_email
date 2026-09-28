export const supportGuides = [
  {
    id: "setup",
    title: "Set up your store",
    category: "Getting started",
    keywords: "setup install theme embed script start connect",
    body: "Open the Nomi setup screen and enable Nomi Script in your live theme. Save the theme, then return to Nomi to check the connection. Brand Studio is the next step: review your store details, choose a direction, and approve your brand before generating emails.",
    href: "/app/setup",
    action: "Open setup",
  },
  {
    id: "brand",
    title: "Make the emails feel like you",
    category: "Brand Studio",
    keywords: "brand studio logo color colour font direction regenerate design",
    body: "Brand Studio uses your store and catalogue to create a coordinated email family. Review the store snapshot, describe your audience and the feeling you want, then choose a creative direction. Review the generated emails before approving. If your store identity changes, rescan your store in Brand Studio and review the new direction.",
    href: "/app/brand-studio",
    action: "Open Brand Studio",
  },
  {
    id: "flows",
    title: "Understand your email flows",
    category: "Flow Editor",
    keywords:
      "flow welcome abandoned cart checkout review interested winback back thirteen 13",
    body: "Nomi designs five flows and 13 emails: Welcome (3), Still Interested? (2), Abandoned Cart (3), How Was It? (2), and Welcome Back (3). Open Flow Editor to review each email and its subject line. Live event delivery currently covers abandoned-cart recovery and delivered-order review requests. Scheduling for the other flows is still being built. Shopify continues to send order, shipping, and refund confirmations.",
    href: "/app/flow-editor",
    action: "Open Flow Editor",
  },
  {
    id: "delivery",
    title: "Why hasn’t an email sent?",
    category: "Sending",
    keywords:
      "send sending sent delivery deliver email disabled paused not working failed",
    body: "Start with these checks:\n\n1. In Brand & Settings, check that sending is enabled.\n2. Make sure your email family is approved in Brand Studio.\n3. For cart recovery, the checkout must be incomplete and the customer must have marketing consent. Review requests wait for delivery.\n\nStill stuck? Choose Talk to the team. They can check the sender and delivery service; this guide assistant cannot inspect your logs.",
    href: "/app/brand-settings",
    action: "Open Brand & Settings",
  },
  {
    id: "campaigns",
    title: "Create a campaign draft",
    category: "Campaigns",
    keywords: "campaign newsletter promotion draft bulk schedule audience",
    body: "Open Campaigns and describe the message you want to send. Nomi creates a draft using your approved brand and real products. Review the copy, product links, and any offer before using it. Campaign audience selection, scheduling, and bulk sending are not available yet; creating a draft does not send it.",
    href: "/app/campaigns",
    action: "Open Campaigns",
  },
  {
    id: "contacts",
    title: "Contacts and marketing consent",
    category: "Contacts",
    keywords: "contact customer subscriber consent unsubscribe list import",
    body: "Open Contacts to review your store’s customers and subscription status. A customer record is not permission to send marketing. Nomi’s abandoned-cart recovery requires marketing consent. Do not send marketing to unsubscribed customers.",
    href: "/app/contacts",
    action: "Open Contacts",
  },
  {
    id: "pricing",
    title: "Plans and billing",
    category: "Account",
    keywords:
      "price pricing billing plan cost charge subscription payment refund",
    body: "Nomi has four plans:\n\n1. Free, $0: one Brand Studio build, 3 email regenerates and 3 campaigns in total, and 500 emails a month.\n2. Starter, $29 a month: 15 regenerates, 10 campaigns, and 3,000 emails a month.\n3. Growth, $79 a month: 30 regenerates, 1 Regenerate all, 20 campaigns, and 15,000 emails a month.\n4. Pro, $199 a month: 75 regenerates, 3 Regenerate alls, 40 campaigns, and 50,000 emails a month.\n\nPaid plans keep sending past their emails at $5 per extra 500. Open Plan & billing to see what you’ve used. For a refund or a billing question, choose Talk to the team.",
    href: "/app/pricing",
    action: "Open Plan & billing",
  },
] as const;

export function findSupportGuide(message: string) {
  const stem = (word: string) =>
    word.length > 4 ? word.replace(/s$/, "") : word;
  const words = [
    ...new Set(
      (
        message
          .toLowerCase()
          .replace(/set up/g, "setup")
          .match(/[a-z0-9]+/g) ?? []
      ).map(stem),
    ),
  ];
  const ranked = supportGuides
    .map((guide) => ({
      guide,
      score: words.reduce(
        (score, word) =>
          score +
          (guide.keywords.split(/\s+/).map(stem).includes(word)
            ? ["email", "send", "sending"].includes(word)
              ? 0.25
              : 1
            : 0),
        0,
      ),
    }))
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.score ? ranked[0].guide : null;
}

export type SupportMessage = {
  id: string;
  role: string;
  body: string;
  createdAt: string;
};
export type SupportConversation = {
  id: string;
  status: string;
  email: string | null;
  messages: SupportMessage[];
};
export type SupportResult = {
  conversation: SupportConversation | null;
  error?: string;
};
