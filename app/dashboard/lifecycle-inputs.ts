// Maps the Shopify-shaped dashboard data (already mapped once by
// dashboard-data.server.ts) onto the engine's 13 platform-neutral
// LifecycleEmail inputs, one per slot across the 5 lifecycle flows.
// Plain, pure, no Shopify or server-only imports — usable from either a
// route's loader or directly in a component's render, by both the Flow
// Editor (AI generation) and the Templates page (real templates), so this
// mapping exists exactly once.
import type { EmailLanguage, EmailTone, LifecycleEmail, LifecycleEmailId, NewsletterCampaign } from "../email-engine/types";
import type { DashboardCart, DashboardOrder, DashboardProduct, DashboardReviewRequest } from "./dashboard-data.server";

export interface LifecycleInputsParams {
  shopName: string;
  language: EmailLanguage;
  tone: EmailTone;
  products: DashboardProduct[];
  order: DashboardOrder | null;
  cart: DashboardCart | null;
  reviewRequest: DashboardReviewRequest | null;
}

export function buildLifecycleInputs({
  shopName,
  language,
  tone,
  products,
  order,
  cart,
  reviewRequest,
}: LifecycleInputsParams): Record<LifecycleEmailId, LifecycleEmail> {
  const storefrontProducts: NewsletterCampaign["products"] = products.map((product) => ({
    title: product.title,
    price: product.price,
    imageUrl: product.imageUrl,
    productUrl: product.productUrl,
  }));
  const orderProducts: NewsletterCampaign["products"] = order
    ? order.lineItems.map((item) => ({
        title: item.title,
        price: item.total,
        imageUrl: item.imageUrl,
        productUrl: null,
      }))
    : storefrontProducts;
  const cartProducts: NewsletterCampaign["products"] = cart
    ? cart.lineItems.map((item) => ({
        title: item.title,
        price: item.total,
        imageUrl: item.imageUrl,
        productUrl: null,
      }))
    : storefrontProducts;
  const reviewProducts: NewsletterCampaign["products"] = reviewRequest
    ? reviewRequest.lineItems.map((item, index) => ({
        title: item.title,
        price: "",
        imageUrl: item.imageUrl,
        productUrl: index === 0 ? reviewRequest.reviewUrl : null,
      }))
    : storefrontProducts;

  return {
    "welcome-1": {
      id: "welcome-1", shopName, language, tone, sequenceName: "Welcome Journey", emailName: "1st Welcome Email",
      position: 1, sequenceLength: 3, timing: "On trigger", objective: "Welcome a new subscriber and introduce the store in a warm, plain voice.",
      customerFirstName: null, products: storefrontProducts, orderNumber: null, orderTotal: null, recoveryUrl: null, reviewUrl: null,
    },
    "welcome-2": {
      id: "welcome-2", shopName, language, tone, sequenceName: "Welcome Journey", emailName: "2nd Welcome Email",
      position: 2, sequenceLength: 3, timing: "48 hour(s) from previous", objective: "Explain what makes the store and its products worth remembering without repeating the first welcome.",
      customerFirstName: null, products: storefrontProducts, orderNumber: null, orderTotal: null, recoveryUrl: null, reviewUrl: null,
    },
    "welcome-3": {
      id: "welcome-3", shopName, language, tone, sequenceName: "Welcome Journey", emailName: "3rd Welcome Email",
      position: 3, sequenceLength: 3, timing: "2 day(s) from previous", objective: "Close the welcome journey with a useful selection of real products and an understated invitation to shop.",
      customerFirstName: null, products: storefrontProducts, orderNumber: null, orderTotal: null, recoveryUrl: null, reviewUrl: null,
    },
    "interest-1": {
      id: "interest-1", shopName, language, tone, sequenceName: "Product Interest Follow-Up", emailName: "1st Follow-Up Email",
      position: 1, sequenceLength: 2, timing: "4 hour(s) after product interest", objective: "Offer a helpful closer look at relevant products without sounding like surveillance.",
      customerFirstName: null, products: storefrontProducts, orderNumber: null, orderTotal: null, recoveryUrl: null, reviewUrl: null,
    },
    "interest-2": {
      id: "interest-2", shopName, language, tone, sequenceName: "Product Interest Follow-Up", emailName: "2nd Follow-Up Email",
      position: 2, sequenceLength: 2, timing: "2 day(s) from previous", objective: "Give a final useful product follow-up with practical context and no invented promotion.",
      customerFirstName: null, products: storefrontProducts, orderNumber: null, orderTotal: null, recoveryUrl: null, reviewUrl: null,
    },
    "cart-1": {
      id: "cart-1", shopName, language, tone, sequenceName: "Abandoned Cart", emailName: "1st Cart Email",
      position: 1, sequenceLength: 3, timing: "1 hour after checkout activity", objective: "Send a gentle reminder that the checkout is saved.",
      customerFirstName: cart?.customerFirstName ?? null, products: cartProducts, orderNumber: null, orderTotal: cart?.total ?? null, recoveryUrl: cart?.recoveryUrl ?? null, reviewUrl: null,
    },
    "cart-2": {
      id: "cart-2", shopName, language, tone, sequenceName: "Abandoned Cart", emailName: "2nd Cart Email",
      position: 2, sequenceLength: 3, timing: "24 hour(s) from previous", objective: "Follow up with practical reassurance and the real saved products, without inventing an offer.",
      customerFirstName: cart?.customerFirstName ?? null, products: cartProducts, orderNumber: null, orderTotal: cart?.total ?? null, recoveryUrl: cart?.recoveryUrl ?? null, reviewUrl: null,
    },
    "cart-3": {
      id: "cart-3", shopName, language, tone, sequenceName: "Abandoned Cart", emailName: "3rd Cart Email",
      position: 3, sequenceLength: 3, timing: "48 hour(s) from previous", objective: "Send one final quiet reminder, with no false urgency, discount, or expiry.",
      customerFirstName: cart?.customerFirstName ?? null, products: cartProducts, orderNumber: null, orderTotal: cart?.total ?? null, recoveryUrl: cart?.recoveryUrl ?? null, reviewUrl: null,
    },
    "thank-you": {
      id: "thank-you", shopName, language, tone, sequenceName: "Customer Care & Reviews", emailName: "Thank You Email",
      position: 1, sequenceLength: 2, timing: "After purchase", objective: "Thank the customer warmly without duplicating the legal order receipt or inventing delivery details.",
      customerFirstName: order?.customerFirstName ?? null, products: orderProducts, orderNumber: order?.name ?? null, orderTotal: order?.total ?? null, recoveryUrl: null, reviewUrl: null,
    },
    "review-request": {
      id: "review-request", shopName, language, tone, sequenceName: "Customer Care & Reviews", emailName: "Review Request",
      position: 2, sequenceLength: 2, timing: "7 day(s) after delivery", objective: "Ask for a product review in a brief, considerate way, only linking when a real review URL exists.",
      customerFirstName: reviewRequest?.customerFirstName ?? order?.customerFirstName ?? null, products: reviewProducts, orderNumber: reviewRequest?.orderNumber ?? order?.name ?? null, orderTotal: null, recoveryUrl: null, reviewUrl: reviewRequest?.reviewUrl ?? null,
    },
    "winback-1": {
      id: "winback-1", shopName, language, tone, sequenceName: "Winback Journey", emailName: "1st Winback Email",
      position: 1, sequenceLength: 3, timing: "30 day(s) after last order", objective: "Reconnect with a past customer by showing what is current, without guilt or an invented offer.",
      customerFirstName: order?.customerFirstName ?? null, products: storefrontProducts, orderNumber: order?.name ?? null, orderTotal: null, recoveryUrl: null, reviewUrl: null,
    },
    "winback-2": {
      id: "winback-2", shopName, language, tone, sequenceName: "Winback Journey", emailName: "2nd Winback Email",
      position: 2, sequenceLength: 3, timing: "14 day(s) from previous", objective: "Share a fresh, product-led reason to return without repeating the first winback email.",
      customerFirstName: order?.customerFirstName ?? null, products: storefrontProducts, orderNumber: order?.name ?? null, orderTotal: null, recoveryUrl: null, reviewUrl: null,
    },
    "winback-3": {
      id: "winback-3", shopName, language, tone, sequenceName: "Winback Journey", emailName: "3rd Winback Email",
      position: 3, sequenceLength: 3, timing: "30 day(s) from previous", objective: "Close the winback journey with a quiet final invitation and no false urgency.",
      customerFirstName: order?.customerFirstName ?? null, products: storefrontProducts, orderNumber: order?.name ?? null, orderTotal: null, recoveryUrl: null, reviewUrl: null,
    },
  };
}
