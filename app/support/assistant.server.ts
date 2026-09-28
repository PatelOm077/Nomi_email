import type Anthropic from "@anthropic-ai/sdk";
import type { PrismaClient } from "@prisma/client";
import { getAnthropicClient } from "../email-engine/anthropic-client";
import {
  EXTRA_EMAILS_BLOCK,
  EXTRA_EMAILS_PRICE_USD,
  METRIC_LABELS,
  PLANS,
  planFor,
  usagePeriod,
  USAGE_METRICS,
} from "../billing/plans";
import { findSupportGuide, supportGuides } from "./guides";

export type SupportTurn = { role: string; body: string };
export type SupportAnswer = (input: {
  shop: string;
  history: SupportTurn[];
  client: PrismaClient;
}) => Promise<string>;

const FALLBACK =
  "I couldn’t find a clear answer in Nomi’s guides.\n\nTry the Help library for setup, branding, flows, and sending. Or choose Talk to the team below and we’ll share this conversation with them.";

// A merchant can't run up an unbounded bill by chatting; past this the
// guide lookup answers instead.
const DAILY_AI_ANSWERS = 60;

export function guideAnswer(question: string) {
  return findSupportGuide(question)?.body ?? FALLBACK;
}

function plansText() {
  const plans = Object.values(PLANS)
    .map((plan) => {
      const limits = USAGE_METRICS.map((metric) => {
        const limit = plan.limits[metric];
        const label = METRIC_LABELS[metric].many;
        return limit === null ? `unlimited ${label}` : `${limit.toLocaleString("en-US")} ${label}`;
      }).join(", ");
      const period = plan.lifetimeAllowances
        ? "one-time allowances, except emails which are monthly"
        : "monthly allowances";
      return `- ${plan.name}: $${plan.priceUsd}/month. Up to ${plan.contacts.toLocaleString("en-US")} subscribed contacts; ${limits} (${period}). ${plan.blurb}`;
    })
    .join("\n");
  return `${plans}\nContacts means customers subscribed to email marketing. Paid plans keep working past their included contacts and emails at $${EXTRA_EMAILS_PRICE_USD} per extra ${EXTRA_EMAILS_BLOCK} contacts or emails a month; Free pauses sending when it has more subscribed contacts or sent emails than it includes. When an allowance runs out, the merchant can move up a plan; one-off add-ons can't be bought. Plans are chosen on the Plan & billing page (/app/pricing). Charging runs through Shopify once Nomi is listed on the Shopify App Store; until then paid plans can't be bought on a live store.`;
}

const SYSTEM_PROMPT = `You are Nomi's in-app help assistant. Nomi is a Shopify app that designs a store's lifecycle emails with AI: "Install it, and your store's email is done." You talk to the merchant who owns the store, inside the Nomi app in their Shopify admin.

How to answer:
- Answer only from the product facts and store facts below. If they don't answer the question, say so plainly and suggest "Talk to the team" (the button under the chat). Never invent features, settings, prices, dates, or steps.
- You can't change settings, send emails, issue refunds, change plans, or see delivery logs. Say so when asked, and point to where the merchant can do it themselves or to the team.
- Use the store facts to make the answer specific ("Sending is off for your store, so..."). Don't recite them unprompted.
- Write plain text only: no markdown, no bold, no headings, no tables. Numbered steps as "1." lines are fine. Keep it short: usually 2 to 5 sentences, never more than about 150 words.
- Voice: calm, plain sentences, no exclamation marks, name the action and the screen (for example "Open Brand Studio"). Refer to screens by name only; never write URL paths like /app/pricing.
- Campaigns never send today, so don't suggest a campaign draft will go out once sending is on. Answer in the language the merchant writes in.
- Questions unrelated to Nomi, email marketing, or running their Shopify store: decline in one sentence and offer to help with Nomi.
- Never claim a person is reading the chat. Messages go to the team only after the merchant chooses Talk to the team.

Product facts:
- Screens in the app nav: Home (the lifecycle dashboard, /app), Flow Editor (/app/flow-editor), Contacts (/app/contacts), Campaigns (/app/campaigns), Brand & Settings (/app/brand-settings). Plan & billing is at /app/pricing. Brand Studio is at /app/brand-studio.
- First install: the "Nomi Script" app embed must be switched on in the live theme (setup screen, /app/setup). Every page stays on setup until it is on.
- Brand Studio reads the store and catalogue, proposes creative directions, and after the merchant approves one it builds 13 lifecycle emails with AI, including AI product photography. It takes several minutes.
- The five flows: Welcome (3 emails), Still Interested? (2), Abandoned Cart (3), How Was It? (2), Welcome Back (3). Shopify keeps sending order, shipping, and refund confirmations; Nomi never replaces those.
- In the Flow Editor each email can be regenerated: "Regenerate email" opens a brief (optional prompt, a featured product, collection, or products, an optional discount), generates a new version, and the merchant chooses Save to flow or Discard. Regenerate all rebuilds every email.
- Live sending today covers abandoned cart recovery (the checkout must be unfinished and the customer must have email marketing consent) and review requests after an order is delivered. Abandoned cart and review emails are filled with the customer's real items and links. Other flows are designed but their live scheduling is still being built.
- Sending must be switched on in Brand & Settings, and the brand must be approved in Brand Studio. A custom sending domain can be verified in Brand & Settings; until then emails send from Nomi's address.
- Campaigns: describe the campaign; Nomi designs a one-off email from the approved brand and real products, with optional AI photos and an optional discount. It creates a draft; audience selection, scheduling, and bulk sending are not available yet.
- Contacts shows the store's customers and their email marketing consent. A customer record is not permission to send marketing.
- Language and tone for emails are set in Brand & Settings.

Plans:
${plansText()}

Guides (the Help library the merchant also sees):
${supportGuides.map((guide) => `- ${guide.title}: ${guide.body}`).join("\n")}`;

async function storeFacts(shop: string, client: PrismaClient) {
  const [settings, profile, recentFailures] = await Promise.all([
    client.shopSettings.findUnique({ where: { shop } }),
    client.brandStudioProfile.findUnique({
      where: { shop },
      select: { status: true },
    }),
    client.emailJob.findMany({
      where: { shop, status: { in: ["failed", "skipped"] }, lastError: { not: null } },
      orderBy: { updatedAt: "desc" },
      take: 3,
      select: { topic: true, status: true, lastError: true },
    }),
  ]);
  const plan = planFor(settings?.plan);
  const usage = await Promise.all(
    USAGE_METRICS.map(async (metric) => {
      const row = await client.usageCounter.findUnique({
        where: { shop_period_metric: { shop, period: usagePeriod(plan, metric), metric } },
      });
      const limit = plan.limits[metric];
      return `${METRIC_LABELS[metric].many} ${row?.count ?? 0} of ${limit === null ? "unlimited" : limit}`;
    }),
  );
  return [
    `Store: ${shop}`,
    `Subscribed contacts: ${settings?.subscribedContacts ?? "not counted yet"} of ${plan.contacts.toLocaleString("en-US")} included.`,
    `Plan: ${plan.name}. Used ${plan.lifetimeAllowances ? "in total (Free allowances are one-time and never reset; only emails reset monthly)" : "this month"}: ${usage.join("; ")}.`,
    `Theme app embed: ${settings?.appEmbedVerifiedAt ? "on" : "not confirmed"}.`,
    `Sending: ${settings?.sendingEnabled ? "on" : "off"}.`,
    `Brand Studio: ${profile?.status === "complete" ? "emails built and approved" : profile ? `in progress (step: ${profile.status})` : "not started"}.`,
    `Email language: ${settings?.language ?? "en"}.`,
    recentFailures.length
      ? `Recent emails not sent: ${recentFailures.map((job) => `${job.topic} ${job.status}: ${job.lastError}`).join(" | ")}`
      : "Recent emails not sent: none.",
  ].join("\n");
}

async function answersToday(shop: string, client: PrismaClient) {
  return client.supportMessage.count({
    where: {
      role: "assistant",
      conversation: { shop },
      createdAt: { gte: new Date(Date.now() - 86_400_000) },
    },
  });
}

/** Claude, grounded on the guides and this store's state; guides if that fails. */
export const aiSupportAnswer: SupportAnswer = async ({ shop, history, client }) => {
  const question = history.filter((turn) => turn.role === "merchant").at(-1)?.body ?? "";
  if (!process.env.ANTHROPIC_API_KEY) return guideAnswer(question);
  try {
    if ((await answersToday(shop, client)) >= DAILY_AI_ANSWERS) return guideAnswer(question);
    const messages: Anthropic.MessageParam[] = [];
    for (const turn of history.slice(-12)) {
      const role = turn.role === "merchant" ? "user" : "assistant";
      if (turn.role !== "merchant" && turn.role !== "assistant" && turn.role !== "agent") continue;
      const last = messages.at(-1);
      if (last?.role === role) last.content = `${last.content}\n\n${turn.body}`;
      else messages.push({ role, content: turn.body });
    }
    while (messages[0]?.role === "assistant") messages.shift();
    if (messages.at(-1)?.role !== "user") return guideAnswer(question);

    const response = await getAnthropicClient().messages.create(
      {
        model: "claude-sonnet-5",
        max_tokens: 1_200,
        output_config: { effort: "low" },
        system: [
          { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
          { type: "text", text: `Store facts (live):\n${await storeFacts(shop, client)}` },
        ],
        messages,
      },
      { timeout: 30_000, maxRetries: 1 },
    );
    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("")
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/^#+\s*/gm, "")
      .trim();
    if (response.stop_reason === "refusal" || !text) return guideAnswer(question);
    return text.slice(0, 4_000);
  } catch (error) {
    console.error("Support assistant failed; answering from guides", error);
    return guideAnswer(question);
  }
};
