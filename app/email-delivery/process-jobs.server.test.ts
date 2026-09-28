import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { processPendingEmailJobs } from "./process-jobs.server";

const mocks = vi.hoisted(() => ({
  db: {
    emailJob: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
    shopSettings: { findUnique: vi.fn() },
    brandStudioProfile: { findUnique: vi.fn() },
  },
  admin: vi.fn(),
  graphql: vi.fn(),
  generateReviewRequestEmail: vi.fn(),
  generateAbandonedCartEmail: vi.fn(),
  sendEmail: vi.fn(),
  isSuppressed: vi.fn(async () => false),
  footer: vi.fn((): { complete: boolean; line: string | null } => ({ complete: true, line: "Paper Boat · 1 Harbour St, Leith, UK" })),
}));

// Plan limits are covered by usage.server.test.ts; always allowed here.
vi.mock("../billing/usage.server", () => ({
  checkAllowance: async () => ({ allowed: true, message: null }),
  recordUsage: async () => {},
}));
vi.mock("../db.server", () => ({ default: mocks.db }));
vi.mock("../shopify.server", () => ({
  unauthenticated: { admin: mocks.admin },
}));
vi.mock("../email-engine/generate-review-request-email", () => ({
  generateReviewRequestEmail: mocks.generateReviewRequestEmail,
}));
vi.mock("../email-engine/generate-abandoned-cart-email", () => ({
  generateAbandonedCartEmail: mocks.generateAbandonedCartEmail,
}));
vi.mock("./provider.server", () => ({ sendEmail: mocks.sendEmail }));
vi.mock("./config.server", () => ({ getEmailDeliveryConfig: () => ({ fromEmail: "mail@example.com", fromName: "Paper Boat" }) }));
vi.mock("./unsubscribe.server", () => ({
  isSuppressed: mocks.isSuppressed,
  unsubscribeUrl: ({ email }: { email: string }) => `https://app.test/unsubscribe?t=${email}`,
  listUnsubscribeHeaders: (url: string) => ({ "List-Unsubscribe": `<${url}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }),
}));
vi.mock("../dashboard/sender-footer.server", () => ({
  loadShopFooterAddress: async () => null,
  resolveSenderFooter: () => mocks.footer(),
}));

const shop = "paper-boat.myshopify.com";
const fixedNow = new Date("2026-08-19T12:00:00.000Z");
const approvedSystem = {
  directionId: "editorial",
  name: "Paper Boat Editorial",
  audience: "People choosing considered objects for a calm home.",
  feeling: "Warm, tactile, quiet, and confidently useful.",
  palette: {
    paper: "#f5f0e7",
    ink: "#211f1b",
    primary: "#7a4837",
    accent: "#d6ad79",
  },
  typography: { display: "Lora", body: "Arial", fallback: "Georgia, serif" },
  voice: {
    principles: ["Write plainly", "Name useful details", "Keep the pace calm"],
    preferredWords: ["considered"],
    avoidWords: ["hurry"],
  },
  layoutRules: ["Use generous space", "Let products lead", "Keep one primary action"],
  imageTreatment: "Show real product photography without cropping.",
  buttonTreatment: "Solid warm brown with clear light text.",
  signatureMotif: "Objects for slower rooms",
};
// creativeDirectionsSchema requires exactly 3 stored directions; only the
// one matching approvedSystem.directionId needs to be realistic.
const approvedDirections = [
  {
    id: "editorial",
    name: "Paper Boat Editorial",
    rationale: "Leads with typography and real product photography for a calm, considered home-goods brand.",
    palette: ["#f5f0e7", "#211f1b", "#7a4837", "#d6ad79"],
    typography: {
      display: "Lora",
      body: "Arial",
      character: "Warm serif headlines over a plain, quiet utility body.",
    },
    imageTreatment: "Show real product photography without cropping.",
    voice: "Warm, tactile, quiet, and confidently useful.",
    layoutStyle: "editorial" as const,
    motif: "Objects for slower rooms",
    sampleHeadline: "Make room for something useful",
    sampleCta: "Continue",
  },
  { id: "product-led-alt", name: "Alt A", rationale: "A secondary direction offered but not chosen.", palette: ["#f5f0e7", "#211f1b", "#7a4837", "#d6ad79"], typography: { display: "Lora", body: "Arial", character: "Placeholder alternate direction." }, imageTreatment: "Placeholder.", voice: "Placeholder.", layoutStyle: "product-led" as const, motif: "Alt motif", sampleHeadline: "Alt headline", sampleCta: "Shop" },
  { id: "graphic-alt", name: "Alt B", rationale: "A secondary direction offered but not chosen.", palette: ["#f5f0e7", "#211f1b", "#7a4837", "#d6ad79"], typography: { display: "Lora", body: "Arial", character: "Placeholder alternate direction." }, imageTreatment: "Placeholder.", voice: "Placeholder.", layoutStyle: "graphic" as const, motif: "Alt motif", sampleHeadline: "Alt headline", sampleCta: "Shop" },
];
const approvedEvidence = {
  shopName: "Paper Boat Goods",
  storefrontUrl: "https://paper-boat.example.com",
  storefrontText: "Considered objects for slower rooms and daily rituals.",
  products: [],
  assets: { logoUrl: null, observedColors: [], fontHints: [] },
};
const lifecycleIds = [
  "welcome-1",
  "welcome-2",
  "welcome-3",
  "interest-1",
  "interest-2",
  "cart-1",
  "cart-2",
  "cart-3",
  "thank-you",
  "review-request",
  "winback-1",
  "winback-2",
  "winback-3",
];
const approvedRecipes = lifecycleIds.map((id, index) => ({
  id,
  subject: `A considered note ${index + 1}`,
  preheader: `A useful second thought for this message number ${index + 1}.`,
  eyebrow: "Paper Boat",
  headline: `Make room for something useful ${index + 1}`,
  body: "A specific and useful message written with enough detail to explain what comes next.",
  ctaLabel: "Continue",
  creativeBrief: `Create a distinct lifecycle composition ${index + 1} with a unique hierarchy, image role, pacing, CTA relationship, and rendered silhouette.`,
  productIds: [],
}));
const approvedRenderedEmails = Object.fromEntries(
  lifecycleIds.map((id) => [
    id,
    `<!doctype html><html><body><h1>${id}</h1><p>${"Approved Brand Studio email. ".repeat(5)}</p></body></html>`,
  ]),
);

const baseJob = {
  id: "job-1",
  webhookId: "webhook-1",
  shop,
  topic: "FULFILLMENTS_UPDATE",
  payload: JSON.stringify({
    order_id: 1042,
    shipment_status: "delivered",
    customer_locale: "es-MX",
  }),
  status: "pending",
  attempts: 0,
  availableAt: fixedNow,
  lastError: null,
  providerMessageId: null,
  createdAt: new Date("2026-08-19T11:00:00.000Z"),
  updatedAt: new Date("2026-08-19T11:00:00.000Z"),
  sentAt: null,
};

const orderResponse = {
  data: {
    shop: { name: "Paper Boat Goods" },
    order: {
      id: "gid://shopify/Order/1042",
      name: "#1042",
      email: "mina@example.com",
      customer: { firstName: "Mina" },
      lineItems: {
        edges: [
          {
            node: {
              title: "Linen Throw",
              quantity: 2,
              image: { url: "https://cdn.example.com/linen.jpg" },
              product: {
                onlineStoreUrl: "https://shop.example.com/products/linen-throw",
              },
            },
          },
        ],
      },
    },
  },
};

const checkoutResponse = {
  data: {
    shop: { name: "Paper Boat Goods" },
    abandonedCheckouts: {
      edges: [
        {
          node: {
            abandonedCheckoutUrl:
              "https://shop.example.com/checkouts/recover/checkout-token",
            customer: null,
            totalPriceSet: {
              shopMoney: { amount: "7500", currencyCode: "INR" },
            },
            lineItems: {
              edges: [
                {
                  node: {
                    title: null,
                    quantity: 2,
                    image: null,
                    originalTotalPriceSet: {
                      shopMoney: { amount: "6400", currencyCode: "INR" },
                    },
                  },
                },
              ],
            },
          },
        },
      ],
    },
  },
};

function setGraphqlResponse(value: unknown) {
  mocks.graphql.mockResolvedValue({ json: vi.fn().mockResolvedValue(value) });
}

describe("processPendingEmailJobs", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);
    for (const mock of [
      mocks.db.emailJob.findMany,
      mocks.db.emailJob.updateMany,
      mocks.db.emailJob.update,
      mocks.db.shopSettings.findUnique,
      mocks.db.brandStudioProfile.findUnique,
      mocks.admin,
      mocks.graphql,
      mocks.generateReviewRequestEmail,
      mocks.generateAbandonedCartEmail,
      mocks.sendEmail,
    ]) {
      mock.mockReset();
    }
    mocks.db.emailJob.findMany.mockResolvedValue([]);
    mocks.db.emailJob.updateMany.mockResolvedValue({ count: 1 });
    mocks.db.emailJob.update.mockResolvedValue({});
    mocks.db.shopSettings.findUnique.mockResolvedValue({
      sendingEnabled: true,
      language: "en",
      tone: "warm-plain",
    });
    mocks.db.brandStudioProfile.findUnique.mockResolvedValue(null);
    mocks.admin.mockResolvedValue({ admin: { graphql: mocks.graphql } });
    mocks.generateReviewRequestEmail.mockResolvedValue("<html>review</html>");
    mocks.generateAbandonedCartEmail.mockResolvedValue("<html>cart</html>");
    mocks.sendEmail.mockResolvedValue("provider-message-1");
  });

  afterEach(() => vi.useRealTimers());

  it.each([
    [0, 1],
    [-20, 1],
    [10, 10],
    [100, 25],
  ])("clamps a limit of %i to %i", async (requested, expected) => {
    await expect(processPendingEmailJobs(requested)).resolves.toEqual({
      sent: 0,
      skipped: 0,
      retried: 0,
      failed: 0,
    });
    expect(mocks.db.emailJob.findMany).toHaveBeenCalledWith({
      where: { status: "pending", availableAt: { lte: fixedNow } },
      orderBy: { createdAt: "asc" },
      take: expected,
    });
  });

  it("ignores a job another worker claimed first", async () => {
    mocks.db.emailJob.findMany.mockResolvedValue([baseJob]);
    mocks.db.emailJob.updateMany.mockResolvedValue({ count: 0 });

    await expect(processPendingEmailJobs()).resolves.toEqual({
      sent: 0,
      skipped: 0,
      retried: 0,
      failed: 0,
    });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("skips legacy jobs whose email type is no longer supported", async () => {
    mocks.db.emailJob.findMany.mockResolvedValue([
      { ...baseJob, topic: "ORDERS_CREATE" },
    ]);

    await expect(processPendingEmailJobs()).resolves.toMatchObject({ skipped: 1 });
    expect(mocks.db.emailJob.update).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: { status: "skipped", lastError: "Email type is no longer supported." },
    });
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it("re-checks sending settings after claiming", async () => {
    mocks.db.emailJob.findMany.mockResolvedValue([baseJob]);
    mocks.db.shopSettings.findUnique.mockResolvedValue({ sendingEnabled: false });

    await expect(processPendingEmailJobs()).resolves.toMatchObject({ skipped: 1 });
    expect(mocks.db.emailJob.update).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: { status: "skipped", lastError: "Sending disabled for shop." },
    });
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it("passes the approved review recipe into live generation", async () => {
    mocks.db.emailJob.findMany.mockResolvedValue([baseJob]);
    mocks.db.brandStudioProfile.findUnique.mockResolvedValue({
      status: "complete",
      evidence: JSON.stringify(approvedEvidence),
      brandSystem: JSON.stringify(approvedSystem),
      lifecycleRecipes: JSON.stringify(approvedRecipes),
      renderedEmails: JSON.stringify(approvedRenderedEmails),
      evidenceFingerprint: "evidence-v2",
      snapshotEvidenceFingerprint: "evidence-v2",
      generatedEvidenceFingerprint: "evidence-v2",
      directions: JSON.stringify(approvedDirections),
      selectedDirectionId: approvedSystem.directionId,
    });
    setGraphqlResponse(orderResponse);

    await expect(processPendingEmailJobs()).resolves.toMatchObject({ sent: 1 });
    expect(mocks.generateReviewRequestEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        brandIdentity: expect.objectContaining({
          system: approvedSystem,
          referenceRecipe: expect.objectContaining({
            headline: "Make room for something useful 10",
          }),
        }),
      }),
      { effort: "low" },
    );
  });

  it("fails closed when the approved Brand Studio profile is stale", async () => {
    mocks.db.emailJob.findMany.mockResolvedValue([baseJob]);
    mocks.db.brandStudioProfile.findUnique.mockResolvedValue({
      status: "complete",
      evidenceFingerprint: "new-evidence",
      snapshotEvidenceFingerprint: "new-evidence",
      generatedEvidenceFingerprint: "old-evidence",
    });

    await expect(processPendingEmailJobs()).resolves.toMatchObject({ skipped: 1 });
    expect(mocks.db.emailJob.update).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: {
        status: "skipped",
        lastError: expect.stringContaining("Rebuild the approved email system"),
      },
    });
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("fails closed when the brand snapshot came from different evidence", async () => {
    mocks.db.emailJob.findMany.mockResolvedValue([baseJob]);
    mocks.db.brandStudioProfile.findUnique.mockResolvedValue({
      status: "complete",
      evidenceFingerprint: "evidence-v2",
      snapshotEvidenceFingerprint: "evidence-v1",
      generatedEvidenceFingerprint: "evidence-v2",
    });

    await expect(processPendingEmailJobs()).resolves.toMatchObject({ skipped: 1 });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("skips an undelivered fulfillment update without generating", async () => {
    mocks.db.emailJob.findMany.mockResolvedValue([
      {
        ...baseJob,
        payload: JSON.stringify({ order_id: 1042, shipment_status: "in_transit" }),
      },
    ]);
    setGraphqlResponse(orderResponse);

    await expect(processPendingEmailJobs()).resolves.toMatchObject({ skipped: 1 });
    expect(mocks.generateReviewRequestEmail).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("maps a delivered update into a review request", async () => {
    mocks.db.emailJob.findMany.mockResolvedValue([baseJob]);
    setGraphqlResponse(orderResponse);

    await expect(processPendingEmailJobs()).resolves.toMatchObject({ sent: 1 });
    expect(mocks.generateReviewRequestEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        language: "es",
        reviewUrl: "https://shop.example.com/products/linen-throw",
      }),
      { effort: "low" },
    );
    expect(mocks.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "review:paper-boat.myshopify.com:gid://shopify/Order/1042",
      }),
    );
  });

  it("sends with the business address, an unsubscribe link and one-click headers", async () => {
    mocks.db.emailJob.findMany.mockResolvedValue([baseJob]);
    setGraphqlResponse(orderResponse);

    await expect(processPendingEmailJobs()).resolves.toMatchObject({ sent: 1 });
    const sent = mocks.sendEmail.mock.calls[0][0] as { to: string; html: string; headers: Record<string, string> };
    expect(sent.html).toContain("Paper Boat · 1 Harbour St, Leith, UK");
    expect(sent.html).toContain(`href="https://app.test/unsubscribe?t=${sent.to}"`);
    expect(sent.headers).toEqual({
      "List-Unsubscribe": `<https://app.test/unsubscribe?t=${sent.to}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });

  it("never generates or sends to an unsubscribed address", async () => {
    mocks.db.emailJob.findMany.mockResolvedValue([baseJob]);
    setGraphqlResponse(orderResponse);
    mocks.isSuppressed.mockResolvedValueOnce(true);

    await expect(processPendingEmailJobs()).resolves.toMatchObject({ skipped: 1, sent: 0 });
    expect(mocks.generateReviewRequestEmail).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("holds the email when the shop has no complete business address", async () => {
    mocks.db.emailJob.findMany.mockResolvedValue([baseJob]);
    setGraphqlResponse(orderResponse);
    mocks.footer.mockReturnValueOnce({ complete: false, line: null });

    await expect(processPendingEmailJobs()).resolves.toMatchObject({ skipped: 1, sent: 0 });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.db.emailJob.update).toHaveBeenLastCalledWith({
      where: { id: baseJob.id },
      data: { status: "skipped", lastError: "Add a complete business address in Sender info before sending." },
    });
  });

  it("rechecks and maps an eligible abandoned checkout", async () => {
    mocks.db.emailJob.findMany.mockResolvedValue([
      {
        ...baseJob,
        topic: "CHECKOUTS_UPDATE",
        payload: JSON.stringify({
          token: "checkout-token",
          email: "mina@example.com",
          customer_locale: "pt-BR",
          buyer_accepts_marketing: true,
        }),
      },
    ]);
    setGraphqlResponse(checkoutResponse);

    await expect(processPendingEmailJobs()).resolves.toMatchObject({ sent: 1 });
    expect(mocks.generateAbandonedCartEmail).toHaveBeenCalledWith({
      shopName: "Paper Boat Goods",
      language: "pt",
      tone: "warm-plain",
      customerFirstName: null,
      recoveryUrl: "https://shop.example.com/checkouts/recover/checkout-token",
      total: expect.stringContaining("7"),
      lineItems: [
        {
          title: "Item",
          quantity: 2,
          price: expect.stringContaining("6"),
          imageUrl: null,
        },
      ],
    }, { effort: "low" });
    expect(mocks.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "mina@example.com",
        idempotencyKey: "cart:paper-boat.myshopify.com:checkout-token",
      }),
    );
  });

  describe("pre-generated Brand Studio emails", () => {
    const slottedEmail = (id: string) =>
      `<!doctype html><html><body><h1>${id}</h1>` +
      `<table data-nomi-slot="items"><tr data-nomi-item data-nomi-product-id="p1"><td>` +
      `<a data-nomi-field="item-url" href="https://paper-boat.example.com/products/vase"><img data-nomi-field="image" src="https://cdn.example.com/vase.jpg" alt="Vase" width="120" height="120"></a>` +
      `<p data-nomi-field="title">Stoneware Vase</p><p data-nomi-field="quantity"></p><p data-nomi-field="price">$40.00</p>` +
      `</td></tr></table>` +
      `<a data-nomi-field="action-url" href="https://paper-boat.example.com">Continue</a></body></html>`;
    const slottedProfile = () => ({
      status: "complete",
      evidence: JSON.stringify(approvedEvidence),
      brandSystem: JSON.stringify(approvedSystem),
      lifecycleRecipes: JSON.stringify(approvedRecipes),
      renderedEmails: JSON.stringify({
        ...approvedRenderedEmails,
        "cart-1": slottedEmail("cart-1"),
        "review-request": slottedEmail("review-request"),
      }),
      evidenceFingerprint: "evidence-v2",
      snapshotEvidenceFingerprint: "evidence-v2",
      generatedEvidenceFingerprint: "evidence-v2",
      directions: JSON.stringify(approvedDirections),
      selectedDirectionId: approvedSystem.directionId,
    });
    const cartJob = (locale: string) => ({
      ...baseJob,
      topic: "CHECKOUTS_UPDATE",
      payload: JSON.stringify({
        token: "checkout-token",
        email: "mina@example.com",
        customer_locale: locale,
        buyer_accepts_marketing: true,
      }),
    });
    const multiItemCheckout = structuredClone(checkoutResponse);
    multiItemCheckout.data.abandonedCheckouts.edges[0].node.lineItems.edges = [
      { node: { title: "Linen Throw", quantity: 2, image: { url: "https://cdn.example.com/linen.jpg" } as never, originalTotalPriceSet: { shopMoney: { amount: "6400", currencyCode: "INR" } } } },
      { node: { title: "Oak Tray", quantity: 1, image: null, originalTotalPriceSet: { shopMoney: { amount: "1100", currencyCode: "INR" } } } },
    ] as never;

    it("sends the approved cart email with the customer's items and checkout link, without calling Claude", async () => {
      mocks.db.emailJob.findMany.mockResolvedValue([cartJob("en-US")]);
      mocks.db.brandStudioProfile.findUnique.mockResolvedValue(slottedProfile());
      setGraphqlResponse(multiItemCheckout);

      await expect(processPendingEmailJobs()).resolves.toMatchObject({ sent: 1 });
      expect(mocks.generateAbandonedCartEmail).not.toHaveBeenCalled();
      const sent = mocks.sendEmail.mock.calls[0][0] as { subject: string; html: string };
      expect(sent.subject).toBe("A considered note 6");
      expect(sent.html.match(/data-nomi-item/g)).toHaveLength(2);
      expect(sent.html).toContain("Linen Throw");
      expect(sent.html).toContain("Oak Tray");
      expect(sent.html).toContain("&times; 2");
      expect(sent.html).not.toContain("Stoneware Vase");
      expect(sent.html).toContain('href="https://shop.example.com/checkouts/recover/checkout-token"');
      expect(sent.html).not.toContain('href="https://paper-boat.example.com"');
      expect(sent.html).toContain("Paper Boat · 1 Harbour St, Leith, UK");
    });

    it("generates at low effort when the customer reads another language", async () => {
      mocks.db.emailJob.findMany.mockResolvedValue([cartJob("pt-BR")]);
      mocks.db.brandStudioProfile.findUnique.mockResolvedValue(slottedProfile());
      setGraphqlResponse(multiItemCheckout);

      await expect(processPendingEmailJobs()).resolves.toMatchObject({ sent: 1 });
      expect(mocks.generateAbandonedCartEmail).toHaveBeenCalledWith(
        expect.objectContaining({ language: "pt" }),
        { effort: "low" },
      );
    });

    it("sends the approved review email pointing at the purchased product", async () => {
      mocks.db.emailJob.findMany.mockResolvedValue([
        { ...baseJob, payload: JSON.stringify({ order_id: 1042, shipment_status: "delivered", customer_locale: "en" }) },
      ]);
      mocks.db.brandStudioProfile.findUnique.mockResolvedValue(slottedProfile());
      setGraphqlResponse(orderResponse);

      await expect(processPendingEmailJobs()).resolves.toMatchObject({ sent: 1 });
      expect(mocks.generateReviewRequestEmail).not.toHaveBeenCalled();
      const sent = mocks.sendEmail.mock.calls[0][0] as { subject: string; html: string };
      expect(sent.subject).toBe("A considered note 10");
      expect(sent.html).toContain("Linen Throw");
      expect(sent.html).toContain('href="https://shop.example.com/products/linen-throw"');
      expect(sent.html).not.toContain("$40.00");
    });
  });

  it("retries a transient provider failure with exponential backoff", async () => {
    mocks.db.emailJob.findMany.mockResolvedValue([baseJob]);
    setGraphqlResponse(orderResponse);
    mocks.sendEmail.mockRejectedValue(new Error("provider unavailable"));

    await expect(processPendingEmailJobs()).resolves.toEqual({
      sent: 0,
      skipped: 0,
      retried: 1,
      failed: 0,
    });
    expect(mocks.db.emailJob.updateMany).toHaveBeenLastCalledWith({
      where: { id: "job-1", status: "processing" },
      data: {
        status: "pending",
        availableAt: new Date("2026-08-19T12:02:00.000Z"),
        lastError: "provider unavailable",
      },
    });
  });

  it("marks the fifth failed attempt as exhausted", async () => {
    mocks.db.emailJob.findMany.mockResolvedValue([{ ...baseJob, attempts: 4 }]);
    setGraphqlResponse(orderResponse);
    mocks.sendEmail.mockRejectedValue(new Error("provider unavailable"));

    await expect(processPendingEmailJobs()).resolves.toMatchObject({ failed: 1 });
    expect(mocks.db.emailJob.updateMany).toHaveBeenLastCalledWith({
      where: { id: "job-1", status: "processing" },
      data: {
        status: "failed",
        availableAt: new Date("2026-08-19T12:32:00.000Z"),
        lastError: "provider unavailable",
      },
    });
  });

  it("truncates stored errors to the database safety limit", async () => {
    mocks.db.emailJob.findMany.mockResolvedValue([baseJob]);
    setGraphqlResponse(orderResponse);
    mocks.sendEmail.mockRejectedValue(new Error("x".repeat(2_500)));

    await processPendingEmailJobs();
    expect(mocks.db.emailJob.updateMany).toHaveBeenLastCalledWith({
      where: { id: "job-1", status: "processing" },
      data: expect.objectContaining({ lastError: "x".repeat(2_000) }),
    });
  });
});
