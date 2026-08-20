import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { Liquid } from "liquidjs";
import { describe, expect, it } from "vitest";

const TEMPLATE_NAMES = [
  "broadsheet.liquid",
  "dispatch.liquid",
  "field-notes.liquid",
] as const;

const engine = new Liquid({ strictFilters: true });
engine.registerFilter("image_url", (value) => String(value ?? ""));
engine.registerFilter("money", (value) => String(value ?? ""));
engine.registerFilter("money_with_currency", (value) => String(value ?? ""));
engine.registerFilter("format_address", (value) => String(value ?? ""));

function templateSource(templateName: (typeof TEMPLATE_NAMES)[number]) {
  return readFileSync(new URL(templateName, import.meta.url), "utf8").replace(
    "{% assign email_type = 'order_confirmation' %}",
    "{% assign email_type = 'abandoned_cart' %}",
  );
}

async function renderAbandonedTemplate(
  templateName: (typeof TEMPLATE_NAMES)[number],
  abandonment: Record<string, unknown>,
) {
  return engine.parseAndRender(templateSource(templateName), {
    shop: {
      name: "Paper Boat Goods",
      url: "https://shop.example.com",
      email_logo_url: null,
    },
    unsubscribe_url: "https://shop.example.com/unsubscribe",
    open_tracking: '<img src="https://track.example.com/open" alt="">',
    ...abandonment,
  });
}

describe.each(TEMPLATE_NAMES)("%s", (templateName) => {
  it("renders Shopify's abandoned_checkout object", async () => {
    const html = await renderAbandonedTemplate(templateName, {
      abandoned_checkout: {
        url: "https://shop.example.com/checkouts/recover?key=abc&source=email",
        line_items: [
          {
            product_title: 'Tea & "Biscuits"',
            variant_title: "",
            quantity: 1,
            image_url: "https://cdn.example.com/tea.jpg?width=140&crop=center",
          },
        ],
        remaining_products_count: 2,
      },
      abandoned_visit: null,
    });

    expect(html).toMatch(
      /alt="Tea &amp; (?:&quot;|&#34;)Biscuits(?:&quot;|&#34;)"/,
    );
    expect(html).toContain("Qty 1");
    expect(html).not.toContain(" · Qty 1");
    expect(html).toContain("+2 more items");
    expect(html).toContain(
      'href="https://shop.example.com/checkouts/recover?key=abc&amp;source=email"',
    );
    expect(html).toContain("https://shop.example.com/unsubscribe");
    expect(html).toContain("https://track.example.com/open");
  });

  it("renders Shopify's abandoned_visit object", async () => {
    const html = await renderAbandonedTemplate(templateName, {
      abandoned_checkout: null,
      abandoned_visit: {
        url: "https://shop.example.com/cart/recover?key=xyz&source=email",
        products_added_to_cart: [
          {
            title: "Canvas Field Bag",
            variant_title: "Olive",
            quantity: 3,
            image_url: "https://cdn.example.com/bag.jpg",
          },
        ],
        remaining_cart_products_count: 1,
      },
    });

    expect(html).toContain("Canvas Field Bag");
    expect(html).toContain("Olive · Qty 3");
    expect(html).toContain("+1 more item");
    expect(html).not.toContain("+1 more items");
    expect(html).toContain(
      'href="https://shop.example.com/cart/recover?key=xyz&amp;source=email"',
    );
  });

  it("does not render a broken recovery link without a URL", async () => {
    const html = await renderAbandonedTemplate(templateName, {
      abandoned_checkout: null,
      abandoned_visit: { products_added_to_cart: [] },
    });

    expect(html).not.toContain('href=""');
    expect(html).not.toMatch(/href="[^"]*">(?:Return|Continue)/);
  });
});

describe("preview.html", () => {
  it("renders every email type and toggles all devices to phone width", () => {
    const preview = readFileSync(
      new URL("preview.html", import.meta.url),
      "utf8",
    );
    const script = preview.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    expect(script).toBeDefined();
    if (!script)
      throw new Error("preview.html does not contain a script block.");

    type Listener = (event: { currentTarget: unknown }) => void;
    const listeners = new Map<string, Listener>();
    const typeSelect = {
      value: "order",
      addEventListener(eventName: string, listener: Listener) {
        listeners.set(eventName, listener);
      },
    };
    const viewButton = {
      textContent: "Phone width",
      attributes: new Map([["aria-pressed", "false"]]),
      getAttribute(name: string) {
        return this.attributes.get(name) ?? null;
      },
      setAttribute(name: string, value: string) {
        this.attributes.set(name, value);
      },
      addEventListener(eventName: string, listener: Listener) {
        listeners.set(eventName, listener);
      },
    };
    const panels = {
      ".broadsheet": { innerHTML: "" },
      ".dispatch": { innerHTML: "" },
      ".field": { innerHTML: "" },
    };
    const devices = Array.from({ length: 3 }, () => {
      const device = {
        phone: false,
        classList: {
          toggle(_className: string, force: boolean) {
            device.phone = force;
          },
        },
      };
      return device;
    });

    const document = {
      querySelector(selector: string) {
        if (selector === "#type") return typeSelect;
        if (selector === ".view") return viewButton;
        return panels[selector as keyof typeof panels];
      },
      querySelectorAll(selector: string) {
        return selector === ".device" ? devices : [];
      },
    };

    runInNewContext(script, { document });

    const expectedHeadlines = {
      order: "Thank you, Maya.",
      return: "Your refund is on its way.",
      cart: "Still thinking it over?",
      newsletter: "Something worth making room for.",
    };
    for (const [emailType, headline] of Object.entries(expectedHeadlines)) {
      typeSelect.value = emailType;
      listeners.get("change")?.({ currentTarget: typeSelect });
      expect(
        Object.values(panels).every(({ innerHTML }) =>
          innerHTML.includes(headline),
        ),
      ).toBe(true);
    }

    listeners.get("click")?.({ currentTarget: viewButton });
    expect(viewButton.attributes.get("aria-pressed")).toBe("true");
    expect(viewButton.textContent).toBe("Desktop width");
    expect(devices.every(({ phone }) => phone)).toBe(true);

    listeners.get("click")?.({ currentTarget: viewButton });
    expect(viewButton.attributes.get("aria-pressed")).toBe("false");
    expect(viewButton.textContent).toBe("Phone width");
    expect(devices.every(({ phone }) => !phone)).toBe(true);
  });
});
