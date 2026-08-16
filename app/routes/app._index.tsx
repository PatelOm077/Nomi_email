import { useEffect, useRef, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { generateOrderConfirmationEmail } from "../email-engine/generate-order-confirmation-email";
import type { OrderConfirmationOrder } from "../email-engine/types";

// One round trip: shop identity, the active theme's name (the closest thing
// to a "brand asset" the Admin API exposes — there's no logo/colors field,
// see explanation below), a handful of products, and the most recent order.
const DASHBOARD_QUERY = `#graphql
  query DashboardData {
    shop {
      name
    }
    themes(first: 1, roles: [MAIN]) {
      nodes {
        name
      }
    }
    products(first: 4, sortKey: UPDATED_AT, reverse: true) {
      edges {
        node {
          id
          title
          featuredMedia {
            preview {
              image {
                url
                altText
              }
            }
          }
          priceRangeV2 {
            minVariantPrice {
              amount
              currencyCode
            }
          }
        }
      }
    }
    orders(first: 1, sortKey: CREATED_AT, reverse: true) {
      edges {
        node {
          name
          customer {
            firstName
          }
          currentTotalPriceSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          lineItems(first: 5) {
            edges {
              node {
                title
                quantity
                image {
                  url
                  altText
                }
                originalTotalSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

type DashboardQueryResponse = {
  data: {
    shop: { name: string };
    themes: { nodes: { name: string }[] };
    products: {
      edges: {
        node: {
          id: string;
          title: string;
          featuredMedia: { preview: { image: { url: string; altText: string | null } | null } | null } | null;
          priceRangeV2: { minVariantPrice: { amount: string; currencyCode: string } };
        };
      }[];
    };
    orders: {
      edges: {
        node: {
          name: string;
          customer: { firstName: string | null } | null;
          currentTotalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
          lineItems: {
            edges: {
              node: {
                title: string;
                quantity: number;
                image: { url: string; altText: string | null } | null;
                originalTotalSet: { shopMoney: { amount: string; currencyCode: string } };
              };
            }[];
          };
        };
      }[];
    };
  };
};

function formatMoney(amount: string, currencyCode: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currencyCode,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number(amount));
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const response = await admin.graphql(DASHBOARD_QUERY);
  const { data } = (await response.json()) as DashboardQueryResponse;

  const products = data.products.edges.map(({ node }) => ({
    id: node.id,
    title: node.title,
    imageUrl: node.featuredMedia?.preview?.image?.url ?? null,
    imageAlt: node.featuredMedia?.preview?.image?.altText ?? node.title,
    price: formatMoney(
      node.priceRangeV2.minVariantPrice.amount,
      node.priceRangeV2.minVariantPrice.currencyCode,
    ),
  }));

  const orderNode = data.orders.edges[0]?.node ?? null;
  const order = orderNode
    ? {
        name: orderNode.name,
        customerFirstName: orderNode.customer?.firstName ?? null,
        total: formatMoney(
          orderNode.currentTotalPriceSet.shopMoney.amount,
          orderNode.currentTotalPriceSet.shopMoney.currencyCode,
        ),
        lineItems: orderNode.lineItems.edges.map(({ node }) => ({
          title: node.title,
          quantity: node.quantity,
          imageUrl: node.image?.url ?? null,
          imageAlt: node.image?.altText ?? node.title,
          total: formatMoney(
            node.originalTotalSet.shopMoney.amount,
            node.originalTotalSet.shopMoney.currencyCode,
          ),
        })),
      }
    : null;

  return {
    shopName: data.shop.name,
    themeName: data.themes.nodes[0]?.name ?? null,
    products,
    order,
  };
};

type DashboardOrder = Awaited<ReturnType<typeof loader>>["order"];

// Maps the Shopify-shaped order the loader already fetched onto the
// engine's platform-neutral input. This mapping — not the engine itself —
// is where Shopify-specific knowledge is allowed to live.
function toEngineOrder(
  shopName: string,
  order: NonNullable<DashboardOrder>,
): OrderConfirmationOrder {
  return {
    shopName,
    customerFirstName: order.customerFirstName,
    orderNumber: order.name,
    total: order.total,
    lineItems: order.lineItems.map((item) => ({
      title: item.title,
      quantity: item.quantity,
      price: item.total,
      imageUrl: item.imageUrl,
    })),
  };
}

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);

  const formData = await request.formData();
  const payload = formData.get("payload");
  if (typeof payload !== "string") {
    return { error: "Missing order data." };
  }

  const { shopName, order } = JSON.parse(payload) as {
    shopName: string;
    order: NonNullable<DashboardOrder>;
  };

  try {
    const html = await generateOrderConfirmationEmail(
      toEngineOrder(shopName, order),
    );
    return { html };
  } catch (error) {
    console.error("Order confirmation generation failed:", error);
    return { error: "Couldn't generate that email — try again." };
  }
};

// Revenue headline stays dummy until we're actually attributing sales to
// sent emails — that's a later milestone, not a data-fetching one.
const REVENUE = "$1,284";

type TemplateStatus = "Live" | "Draft";

export default function Index() {
  const { shopName, themeName, products, order } = useLoaderData<typeof loader>();
  const [campaign, setCampaign] = useState("");

  // Kick off the real generation the moment the dashboard has a real order
  // to work with. useRef (not fetcher state) guards against the double
  // effect invocation React can trigger in dev, so we never submit twice.
  const emailFetcher = useFetcher<typeof action>();
  const hasRequestedGeneration = useRef(false);
  useEffect(() => {
    if (!order || hasRequestedGeneration.current) return;
    hasRequestedGeneration.current = true;
    emailFetcher.submit(
      { payload: JSON.stringify({ shopName, order }) },
      { method: "POST" },
    );
    // emailFetcher is stable across renders; including it would re-run this
    // effect on every fetcher state change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order, shopName]);

  const generatedHtml: string | null =
    emailFetcher.data && "html" in emailFetcher.data
      ? emailFetcher.data.html ?? null
      : null;
  const generationFailed = Boolean(
    emailFetcher.data && "error" in emailFetcher.data,
  );

  const templates: {
    id: string;
    name: string;
    status: TemplateStatus;
    preview: React.ReactNode;
  }[] = [
    {
      id: "order-confirmation",
      name: "Order confirmation",
      status: "Live",
      preview: (
        <OrderConfirmationPreview
          shopName={shopName}
          order={order}
          generatedHtml={generatedHtml}
          isGenerating={Boolean(order) && !generatedHtml && !generationFailed}
        />
      ),
    },
    {
      id: "shipping-update",
      name: "Shipping update",
      status: "Live",
      preview: <ShippingUpdatePreview />,
    },
    {
      id: "abandoned-cart",
      name: "Abandoned cart",
      status: "Draft",
      preview: <AbandonedCartPreview />,
    },
    {
      id: "review-request",
      name: "Review request",
      status: "Draft",
      preview: <ReviewRequestPreview />,
    },
  ];

  return (
    <div className="nomi-page">
      <div className="nomi-shell">
        <header className="nomi-header">
          <div className="nomi-brand">
            <div className="nomi-mark">
              <svg
                width="22"
                height="22"
                viewBox="0 0 64 64"
                fill="none"
                stroke="var(--nomi-paper)"
                strokeWidth="3.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M50 16 L14 30 L29 36 L50 16 Z" />
                <path d="M29 36 L33 50 L50 16" />
              </svg>
            </div>
            <span className="nomi-wordmark">Nomi</span>
            <span className="nomi-brand-divider" />
            <span className="nomi-shop">
              {shopName}
              {themeName ? ` · ${themeName}` : ""}
            </span>
          </div>
          <h1 className="nomi-headline">
            Your emails made {REVENUE} this month.
          </h1>
        </header>

        <section className="nomi-section">
          <h2 className="nomi-section-heading">Templates</h2>
          <div className="nomi-grid">
            {templates.map(({ id, name, status, preview }) => (
              <article className="nomi-card" key={id}>
                {preview}
                <div className="nomi-card-footer">
                  <span className="nomi-card-name">{name}</span>
                  <span
                    className={`nomi-badge ${
                      status === "Live" ? "nomi-badge-live" : "nomi-badge-draft"
                    }`}
                  >
                    {status}
                  </span>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="nomi-section">
          <h2 className="nomi-section-heading">Products</h2>
          {products.length > 0 ? (
            <div className="nomi-products-row">
              {products.map((product) => (
                <div className="nomi-product-tile" key={product.id}>
                  {product.imageUrl ? (
                    <img
                      className="nomi-product-thumb"
                      src={product.imageUrl}
                      alt={product.imageAlt}
                    />
                  ) : (
                    <div className="nomi-product-thumb nomi-thumb" />
                  )}
                  <span className="nomi-product-title">{product.title}</span>
                  <span className="nomi-product-price">{product.price}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="nomi-hint">
              No products yet — add one in this dev store to see it here.
            </p>
          )}
        </section>

        <section className="nomi-section nomi-campaign-section">
          <h2 className="nomi-section-heading">Campaigns</h2>
          <form
            className="nomi-form"
            onSubmit={(event) => event.preventDefault()}
          >
            <label className="nomi-visually-hidden" htmlFor="campaign-prompt">
              Describe a campaign
            </label>
            <input
              id="campaign-prompt"
              className="nomi-input"
              type="text"
              value={campaign}
              onChange={(event) => setCampaign(event.target.value)}
              placeholder="Describe a campaign — 'Diwali sale, 15% off'"
            />
            <button
              className="nomi-button"
              type="submit"
              disabled={campaign.trim() === ""}
            >
              Generate
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}

/* ── Email previews ───────────────────────────────────────────────────────
   Static thumbnails of what each template sends. The order confirmation is
   the Moon & Mango archetype from the design folder — it wears the
   merchant's palette, not Nomi's, which is the whole point of the app. */

// Four states, in order of preference: a real Claude-generated email for
// the real order; a "writing…" placeholder while that call is in flight;
// a hand-built preview using the same real order data if generation
// failed; and the static Moon & Mango archetype when the store has no
// orders at all yet. The dashboard never shows an empty card.
function OrderConfirmationPreview({
  shopName,
  order,
  generatedHtml,
  isGenerating,
}: {
  shopName: string;
  order: DashboardOrder;
  generatedHtml: string | null;
  isGenerating: boolean;
}) {
  if (!order) {
    return <StaticOrderConfirmationPreview />;
  }
  if (generatedHtml) {
    return <GeneratedEmailPreview html={generatedHtml} />;
  }
  if (isGenerating) {
    return <GeneratingEmailPreview />;
  }
  return <RealDataOrderConfirmationPreview shopName={shopName} order={order} />;
}

// The sandboxed frame for a real, Claude-generated email. `sandbox=""` (no
// value) is deliberate: it blocks scripts and same-origin access entirely,
// so arbitrary model output can never touch the parent page. The email is
// built at a fixed 640px design width like any other email; we render it
// at that size and scale the whole frame down to fit the card.
function GeneratedEmailPreview({ html }: { html: string }) {
  const SOURCE_WIDTH = 640;
  const SOURCE_HEIGHT = 900;
  const SCALE = 0.37;
  return (
    <div className="nomi-preview" style={{ padding: 0 }} aria-hidden="true">
      <div
        style={{
          width: SOURCE_WIDTH,
          height: SOURCE_HEIGHT,
          transform: `scale(${SCALE})`,
          transformOrigin: "top left",
          flex: "none",
        }}
      >
        <iframe
          srcDoc={html}
          title="Order confirmation email preview"
          sandbox=""
          scrolling="no"
          style={{ width: SOURCE_WIDTH, height: SOURCE_HEIGHT, border: "none" }}
        />
      </div>
    </div>
  );
}

function GeneratingEmailPreview() {
  return (
    <div
      className="nomi-preview"
      style={{ alignItems: "center", justifyContent: "center", textAlign: "center" }}
      aria-hidden="true"
    >
      <div
        style={{
          font: "italic 400 12px var(--nomi-font-heading)",
          color: "var(--nomi-neutral-600)",
        }}
      >
        Writing your order confirmation email
      </div>
    </div>
  );
}

// The hand-built, real-data-but-not-AI preview from before Claude was wired
// in. Kept as the fallback when generation fails, so a bad API call still
// shows real order data instead of reverting all the way to the mockup.
function RealDataOrderConfirmationPreview({
  shopName,
  order,
}: {
  shopName: string;
  order: NonNullable<DashboardOrder>;
}) {
  const greeting = order.customerFirstName
    ? `Thank you, ${order.customerFirstName}.`
    : "Thank you for your order.";
  const items = order.lineItems.slice(0, 2);

  return (
    <div
      className="nomi-preview nomi-preview-editorial"
      style={{ gap: "8px" }}
      aria-hidden="true"
    >
      <div
        style={{
          textAlign: "center",
          font: "600 9px var(--nomi-font-heading)",
          letterSpacing: "0.24em",
          color: "#7a5a3c",
        }}
      >
        {shopName.toUpperCase()}
      </div>
      <div
        style={{
          font: "600 11px var(--nomi-font-heading)",
          color: "#3a2f26",
          paddingTop: "2px",
        }}
      >
        {greeting}
      </div>
      {items.map((item) => (
        <div
          key={item.title}
          style={{ display: "flex", gap: "8px", alignItems: "center" }}
        >
          {item.imageUrl ? (
            <img
              src={item.imageUrl}
              alt={item.imageAlt}
              style={{
                width: "26px",
                height: "32px",
                objectFit: "cover",
                borderRadius: "1px",
                flex: "none",
              }}
            />
          ) : (
            <div
              style={{
                width: "26px",
                height: "32px",
                background: "#e6d3bd",
                borderRadius: "1px",
                flex: "none",
              }}
            />
          )}
          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              gap: "3px",
            }}
          >
            <div
              style={{
                fontSize: "8px",
                color: "#3a2f26",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {item.title}
            </div>
            {item.quantity > 1 && (
              <div style={{ fontSize: "7px", color: "#7a6a5a" }}>
                Qty {item.quantity}
              </div>
            )}
          </div>
          <div style={{ fontSize: "8px", color: "#7a6a5a" }}>{item.total}</div>
        </div>
      ))}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderTop: "1px solid #e6ddd2",
          paddingTop: "6px",
          marginTop: "2px",
        }}
      >
        <span style={{ fontSize: "8px", color: "#7a6a5a" }}>Total</span>
        <span
          style={{ font: "600 9px var(--nomi-font-heading)", color: "#3a2f26" }}
        >
          {order.total}
        </span>
      </div>
      <div
        style={{
          alignSelf: "center",
          background: "#3a2f26",
          color: "#f7f1e8",
          fontSize: "7px",
          letterSpacing: "0.1em",
          padding: "5px 12px",
          borderRadius: "1px",
          marginTop: "2px",
        }}
      >
        TRACK ORDER
      </div>
    </div>
  );
}

function StaticOrderConfirmationPreview() {
  return (
    <div
      className="nomi-preview nomi-preview-editorial"
      style={{ gap: "8px" }}
      aria-hidden="true"
    >
      <div
        style={{
          textAlign: "center",
          font: "600 9px var(--nomi-font-heading)",
          letterSpacing: "0.24em",
          color: "#7a5a3c",
        }}
      >
        MOON &amp; MANGO
      </div>
      <div
        style={{
          font: "600 11px var(--nomi-font-heading)",
          color: "#3a2f26",
          paddingTop: "2px",
        }}
      >
        Thank you, Ananya.
      </div>
      {[
        { swatch: "#e6d3bd", widths: ["80%", "45%"], price: "$180" },
        { swatch: "#dfd6c4", widths: ["70%", "40%"], price: "$96" },
      ].map(({ swatch, widths, price }) => (
        <div
          key={price}
          style={{ display: "flex", gap: "8px", alignItems: "center" }}
        >
          <div
            style={{
              width: "26px",
              height: "32px",
              background: swatch,
              borderRadius: "1px",
              flex: "none",
            }}
          />
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              gap: "3px",
            }}
          >
            <div
              style={{ height: "4px", width: widths[0], background: "#d9cdbe" }}
            />
            <div
              style={{ height: "4px", width: widths[1], background: "#e6ddd2" }}
            />
          </div>
          <div style={{ fontSize: "8px", color: "#7a6a5a" }}>{price}</div>
        </div>
      ))}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderTop: "1px solid #e6ddd2",
          paddingTop: "6px",
          marginTop: "2px",
        }}
      >
        <span style={{ fontSize: "8px", color: "#7a6a5a" }}>Total</span>
        <span
          style={{ font: "600 9px var(--nomi-font-heading)", color: "#3a2f26" }}
        >
          $276
        </span>
      </div>
      <div
        style={{
          alignSelf: "center",
          background: "#3a2f26",
          color: "#f7f1e8",
          fontSize: "7px",
          letterSpacing: "0.1em",
          padding: "5px 12px",
          borderRadius: "1px",
          marginTop: "2px",
        }}
      >
        TRACK ORDER
      </div>
    </div>
  );
}

function ShippingUpdatePreview() {
  return (
    <div className="nomi-preview" style={{ gap: "10px" }} aria-hidden="true">
      <div className="nomi-preview-title">Your order is on its way</div>
      <div style={{ display: "flex", alignItems: "center", padding: "6px 0" }}>
        <Dot filled />
        <Rail filled />
        <Dot filled />
        <Rail />
        <Dot />
      </div>
      <div
        className="nomi-micro"
        style={{ display: "flex", justifyContent: "space-between" }}
      >
        <span>Packed</span>
        <span>Shipped</span>
        <span>Delivered</span>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "4px",
          paddingTop: "6px",
        }}
      >
        {["90%", "76%", "52%"].map((width) => (
          <div className="nomi-line" key={width} style={{ width }} />
        ))}
      </div>
      <div
        style={{
          background: "var(--nomi-neutral-100)",
          borderRadius: "1px",
          padding: "8px 10px",
          display: "flex",
          flexDirection: "column",
          gap: "4px",
          marginTop: "auto",
        }}
      >
        <div className="nomi-micro" style={{ letterSpacing: "0.12em" }}>
          TRACKING
        </div>
        <div
          style={{
            fontSize: "9px",
            fontWeight: 600,
            color: "var(--nomi-neutral-900)",
          }}
        >
          1Z 998 AA1 012
        </div>
      </div>
    </div>
  );
}

function AbandonedCartPreview() {
  return (
    <div className="nomi-preview" style={{ gap: "10px" }} aria-hidden="true">
      <div className="nomi-preview-title">Still thinking it over?</div>
      {[
        { tone: "var(--nomi-neutral-200)", widths: ["85%", "60%"], price: "$142" },
        { tone: "var(--nomi-neutral-100)", widths: ["72%", "52%"], price: "$88" },
      ].map(({ tone, widths, price }) => (
        <div
          key={price}
          style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}
        >
          <div
            className="nomi-thumb"
            style={{ width: "38px", height: "46px", background: tone }}
          />
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              gap: "4px",
              paddingTop: "2px",
            }}
          >
            <div className="nomi-line" style={{ width: widths[0] }} />
            <div className="nomi-line" style={{ width: widths[1] }} />
            <div
              style={{
                fontSize: "9px",
                fontWeight: 600,
                color: "var(--nomi-neutral-900)",
                paddingTop: "2px",
              }}
            >
              {price}
            </div>
          </div>
        </div>
      ))}
      <div className="nomi-micro">Held in your cart for 24 hours</div>
      <div className="nomi-preview-cta">RETURN TO CART</div>
    </div>
  );
}

function ReviewRequestPreview() {
  return (
    <div className="nomi-preview" style={{ gap: "10px" }} aria-hidden="true">
      <div className="nomi-preview-title">How did it wear?</div>
      <div style={{ display: "flex", gap: "5px", padding: "2px 0" }}>
        {[true, true, true, false, false].map((filled, index) => (
          <div
            key={index}
            style={{
              width: "11px",
              height: "11px",
              borderRadius: "50%",
              border: `1.4px solid ${
                filled ? "var(--nomi-cyan-600)" : "var(--nomi-neutral-300)"
              }`,
            }}
          />
        ))}
      </div>
      <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
        <div className="nomi-thumb" style={{ width: "36px", height: "44px" }} />
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            gap: "4px",
          }}
        >
          <div className="nomi-line" style={{ width: "78%" }} />
          <div className="nomi-line" style={{ width: "50%" }} />
        </div>
      </div>
      <div
        style={{
          border: "1px solid var(--nomi-neutral-200)",
          borderRadius: "1px",
          flex: 1,
          minHeight: "26px",
        }}
      />
      <div className="nomi-preview-cta">LEAVE A REVIEW</div>
    </div>
  );
}

function Dot({ filled = false }: { filled?: boolean }) {
  return (
    <div
      style={{
        width: "8px",
        height: "8px",
        borderRadius: "50%",
        flex: "none",
        background: filled ? "var(--nomi-cyan)" : "var(--nomi-neutral-300)",
      }}
    />
  );
}

function Rail({ filled = false }: { filled?: boolean }) {
  return (
    <div
      style={{
        flex: 1,
        height: "2px",
        background: filled
          ? "var(--nomi-cyan-300)"
          : "var(--nomi-neutral-300)",
      }}
    />
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
