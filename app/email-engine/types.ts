// Platform-neutral shapes. Nothing here should ever import from a Shopify
// module — adapters (Shopify today, WooCommerce/Wix/BigCommerce later) map
// their own data into these before calling the engine.

export interface OrderConfirmationLineItem {
  title: string;
  quantity: number;
  price: string;
  imageUrl?: string | null;
}

export interface OrderConfirmationOrder {
  shopName: string;
  // null when the order has no attached customer name (guest checkout,
  // or the name genuinely wasn't captured) — not a placeholder string.
  // The engine writes a name-free greeting in that case instead of
  // treating a fallback word as if it were the customer's name.
  customerFirstName: string | null;
  orderNumber: string;
  lineItems: OrderConfirmationLineItem[];
  total: string;
}
