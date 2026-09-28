import { parse, type HTMLElement } from "node-html-parser";

// Pre-generated lifecycle emails with per-customer slots, filled by code at
// send time (no AI call). Brand Studio writes the approved cart and review
// emails with this markup contract:
//
//   <... data-nomi-slot="items">            exactly one, wraps the item rows
//     <... data-nomi-item>                  exactly one template row
//       <img data-nomi-field="image">       product photo
//       <... data-nomi-field="title">       product name
//       <... data-nomi-field="quantity">    optional, "× 2"
//       <... data-nomi-field="price">       optional
//       <a data-nomi-field="item-url">      optional, links the row
//   <a data-nomi-field="action-url">        the main CTA (checkout / review)
//
// The template row is cloned once per real item. The preview row Brand Studio
// renders it with is a real product, so the approved email reads correctly in
// the editor too.
export const PERSONAL_SLOT_EMAIL_IDS = ["cart-1", "cart-2", "cart-3", "review-request"] as const;

export function needsPersonalSlots(emailId: string): boolean {
  return (PERSONAL_SLOT_EMAIL_IDS as readonly string[]).includes(emailId);
}

export type PersonalItem = {
  title: string;
  quantity: number;
  price: string | null;
  imageUrl: string | null;
  url: string | null;
};

const MAX_ITEMS = 6;

function fields(root: HTMLElement, name: string): HTMLElement[] {
  return root.querySelectorAll(`[data-nomi-field="${name}"]`);
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}


export function personalSlotProblems(html: string): string[] {
  const root = parse(html);
  const problems: string[] = [];
  const slots = root.querySelectorAll("[data-nomi-slot=\"items\"]");
  if (slots.length !== 1) {
    problems.push(`needs exactly one element with data-nomi-slot="items" (found ${slots.length})`);
    return problems;
  }
  const rows = slots[0].querySelectorAll("[data-nomi-item]");
  if (rows.length !== 1) {
    problems.push(`data-nomi-slot="items" must hold exactly one data-nomi-item row (found ${rows.length})`);
  } else {
    const images = fields(rows[0], "image");
    if (images.length !== 1 || images[0].tagName !== "IMG") {
      problems.push('the data-nomi-item row needs exactly one <img data-nomi-field="image">');
    }
    if (fields(rows[0], "title").length !== 1) {
      problems.push('the data-nomi-item row needs exactly one data-nomi-field="title"');
    }
  }
  const actions = fields(root, "action-url");
  if (actions.length === 0 || actions.some((element) => element.tagName !== "A")) {
    problems.push('the main call to action must be an <a data-nomi-field="action-url">');
  }
  return problems;
}

function fillRow(template: HTMLElement, item: PersonalItem, fallbackUrl: string): string {
  const row = parse(template.toString());
  for (const image of fields(row, "image")) {
    if (!item.imageUrl) {
      image.remove();
      continue;
    }
    image.setAttribute("src", item.imageUrl);
    image.setAttribute("alt", item.title);
    image.removeAttribute("height");
  }
  for (const element of fields(row, "title")) element.set_content(escapeText(item.title));
  for (const element of fields(row, "quantity")) {
    element.set_content(item.quantity > 1 ? `&times; ${item.quantity}` : "");
  }
  for (const element of fields(row, "price")) element.set_content(item.price ? escapeText(item.price) : "");
  for (const link of fields(row, "item-url")) link.setAttribute("href", item.url ?? fallbackUrl);
  for (const element of row.querySelectorAll("[data-nomi-product-id]")) {
    element.removeAttribute("data-nomi-product-id");
  }
  return row.toString();
}

// Returns null when the email doesn't carry a usable slot contract or there
// are no items, so the caller falls back to generating the email.
export function fillPersonalSlots(
  html: string,
  input: { items: PersonalItem[]; actionUrl: string },
): string | null {
  if (input.items.length === 0 || personalSlotProblems(html).length > 0) return null;
  const root = parse(html);
  const template = root.querySelector("[data-nomi-slot=\"items\"] [data-nomi-item]");
  if (!template) return null;
  const rows = input.items.slice(0, MAX_ITEMS).map((item) => fillRow(template, item, input.actionUrl));
  template.replaceWith(rows.join(""));
  for (const link of fields(root, "action-url")) link.setAttribute("href", input.actionUrl);
  return root.toString();
}
