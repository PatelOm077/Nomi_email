import { describe, expect, it } from "vitest";
import { parse } from "node-html-parser";

import { fillPersonalSlots, personalSlotProblems } from "./personal-slots";

const email = `<table><tr><td>
<h1 data-nomi-seam="headline">Still yours</h1>
<table data-nomi-slot="items">
  <tr data-nomi-item data-nomi-product-id="gid://shopify/Product/1">
    <td><a data-nomi-field="item-url" href="https://lumen.test/products/loam"><img data-nomi-field="image" src="https://cdn.test/loam.png" alt="Loam" width="96" height="96"></a></td>
    <td><p data-nomi-field="title">Loam Cream</p><p data-nomi-field="quantity"></p><p data-nomi-field="price">$38.00</p></td>
  </tr>
</table>
<a data-nomi-field="action-url" data-nomi-seam="cta-label" href="https://lumen.test/cart">Return to cart</a>
</td></tr></table>`;

describe("personalSlotProblems", () => {
  it("accepts a complete contract", () => {
    expect(personalSlotProblems(email)).toEqual([]);
  });

  it("names every missing part", () => {
    expect(personalSlotProblems("<p>Hi</p>")[0]).toContain('data-nomi-slot="items"');
    const noCta = email.replace('data-nomi-field="action-url"', "");
    expect(personalSlotProblems(noCta)).toEqual(['the main call to action must be an <a data-nomi-field="action-url">']);
    const twoRows = email.replace("<tr data-nomi-item", "<tr data-nomi-item><td></td></tr><tr data-nomi-item");
    expect(personalSlotProblems(twoRows)[0]).toContain("exactly one data-nomi-item row (found 2)");
  });
});

describe("fillPersonalSlots", () => {
  const recoveryUrl = "https://lumen.test/checkouts/abc/recover?key=k1&locale=en";

  it("renders one row per real cart item and points the CTA at the customer's checkout", () => {
    const html = fillPersonalSlots(email, {
      actionUrl: recoveryUrl,
      items: [
        { title: "Peat & Ash Soap", quantity: 2, price: "$24.00", imageUrl: "https://cdn.shopify.com/peat.png", url: null },
        { title: "Birch Oil", quantity: 1, price: null, imageUrl: null, url: "https://lumen.test/products/birch" },
      ],
    });
    expect(html).not.toBeNull();
    const root = parse(html!);
    const rows = root.querySelectorAll("[data-nomi-item]");
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector('[data-nomi-field="title"]')!.text).toBe("Peat & Ash Soap");
    expect(rows[0].querySelector('[data-nomi-field="quantity"]')!.text).toBe("× 2");
    expect(rows[0].querySelector('[data-nomi-field="price"]')!.text).toBe("$24.00");
    expect(rows[0].querySelector("img")!.getAttribute("src")).toBe("https://cdn.shopify.com/peat.png");
    expect(rows[0].querySelector("img")!.getAttribute("height")).toBeUndefined();
    expect(rows[0].querySelector('[data-nomi-field="item-url"]')!.getAttribute("href")).toBe(recoveryUrl);
    expect(rows[1].querySelector("img")).toBeNull();
    expect(rows[1].querySelector('[data-nomi-field="quantity"]')!.text).toBe("");
    expect(rows[1].querySelector('[data-nomi-field="price"]')!.text).toBe("");
    expect(rows[1].querySelector('[data-nomi-field="item-url"]')!.getAttribute("href")).toBe("https://lumen.test/products/birch");
    expect(root.querySelector('[data-nomi-field="action-url"]')!.getAttribute("href")).toBe(recoveryUrl);
    expect(html).not.toContain("data-nomi-product-id");
    expect(html).not.toContain("Loam");
    expect(root.querySelector('[data-nomi-seam="headline"]')!.text).toBe("Still yours");
  });

  it("escapes item text and caps the rows at six", () => {
    const items = Array.from({ length: 9 }, (_, index) => ({
      title: `<b>Item ${index}</b>`,
      quantity: 1,
      price: null,
      imageUrl: null,
      url: null,
    }));
    const html = fillPersonalSlots(email, { actionUrl: recoveryUrl, items })!;
    expect(parse(html).querySelectorAll("[data-nomi-item]")).toHaveLength(6);
    expect(html).toContain("&lt;b&gt;Item 0&lt;/b&gt;");
  });

  it("returns null without items or without the contract", () => {
    expect(fillPersonalSlots(email, { actionUrl: recoveryUrl, items: [] })).toBeNull();
    expect(
      fillPersonalSlots("<p>Hi</p>", {
        actionUrl: recoveryUrl,
        items: [{ title: "A", quantity: 1, price: null, imageUrl: null, url: null }],
      }),
    ).toBeNull();
  });
});
