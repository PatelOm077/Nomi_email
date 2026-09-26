import { describe, expect, it } from "vitest";
import {
  auditCompiledEmail,
  auditEmailFamily,
} from "../brand-studio/email-quality";
import type { BrandSystem, LifecycleRecipe } from "../brand-studio/types";

const system: BrandSystem = {
  directionId: "field-notes",
  name: "Field Notes",
  audience: "Thoughtful customers",
  feeling: "Calm and useful",
  palette: {
    paper: "#f4f0e7",
    ink: "#22201d",
    primary: "#536454",
    accent: "#c56f4e",
  },
  typography: {
    display: "Literary serif",
    body: "Quiet grotesk",
    fallback: "Georgia, serif",
  },
  voice: {
    principles: ["Be clear", "Be calm", "Be useful"],
    preferredWords: [],
    avoidWords: [],
  },
  layoutRules: ["Keep one action", "Use natural images", "Leave calm spacing"],
  imageTreatment: "Natural product images",
  buttonTreatment: "Sharp solid buttons",
  signatureMotif: "Fine rules",
};

function recipe(index: number): LifecycleRecipe {
  const ids = [
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
  ] as const;
  return {
    id: ids[index],
    subject: `Subject ${index}`,
    preheader: `Preview thought ${index}`,
    eyebrow: "Field Notes",
    headline: `Headline ${index}`,
    body: `A specific and useful lifecycle message written for the distinct customer moment numbered ${index}.`,
    ctaLabel: "Explore",
    creativeBrief: `Create a distinct art-directed email ${index} with its own hierarchy, image role, pacing, action relationship, and unmistakable rendered silhouette.`,
    productIds: [],
  };
}

describe("Brand Studio email quality gate", () => {
  it("accepts a small, email-safe document", () => {
    const report = auditCompiledEmail({
      recipe: recipe(0),
      html: '<!doctype html><html><head><meta name="viewport" content="width=device-width"></head><body><table style="max-width:600px"><tr><td><h1>Welcome</h1><a href="https://example.com">Explore</a><img src="https://cdn.example.com/a.jpg" alt="Product" width="600"></td></tr></table></body></html>',
    });
    expect(report.status).toBe("ready");
    expect(report.issues).toEqual([]);
  });

  it("blocks unsafe elements, links, and missing image alternatives", () => {
    const report = auditCompiledEmail({
      recipe: { ...recipe(0), productIds: ["product-1"] },
      html: '<html><body><script>alert(1)</script><h1>One</h1><h1>Two</h1><a href="javascript:alert(1)">Go</a><img src="x"></body></html>',
    });
    expect(report.status).toBe("needs-attention");
    expect(report.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "document",
        "viewport",
        "width",
        "unsafe-element",
        "image-alt",
        "unsafe-link",
        "heading",
      ]),
    );
  });

  it("rejects technically safe HTML when its creative recipe is still generic", () => {
    const generic = {
      ...recipe(0),
      subject: "A considered note",
      preheader: "The same quiet details are waiting for you.",
      headline: "Made for the days you keep - 1",
      body: "A quiet, useful message shaped around the product and the moment it belongs to for your everyday routine.",
      productIds: ["product-1"],
    };
    const report = auditCompiledEmail({
      recipe: generic,
      brandSystem: system,
      products: [],
      html: '<!doctype html><html><head><meta name="viewport" content="width=device-width"></head><body style="color:#22201d;background:#f4f0e7;border-color:#c56f4e"><table style="max-width:600px;color:#536454"><tr><td><h1>Made for the days you keep</h1></td></tr></table></body></html>',
    });
    expect(report.status).toBe("needs-attention");
    expect(report.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining(["generic-copy", "a1-product-link"]),
    );
  });

  it("treats duplicate requested product ids as one exact image requirement", () => {
    const imageUrl = "https://cdn.shopify.com/product.png?v=1&width=1200";
    const report = auditCompiledEmail({
      recipe: { ...recipe(0), productIds: ["product-1", "product-1"] },
      brandSystem: system,
      products: [
        {
          id: "product-1",
          title: "Product",
          description: "A real product.",
          productType: "Care",
          vendor: "Field Notes",
          tags: [],
          imageUrl,
          productUrl: "https://example.com/products/product",
        },
      ],
      storefrontUrl: "https://example.com",
      html: `<!doctype html><html><head><meta name="viewport" content="width=device-width"></head><body style="color:#22201d;background:#f4f0e7;border-color:#c56f4e"><table style="max-width:600px;color:#536454"><tr><td><h1>Welcome</h1><a href="https://example.com/products/product">Explore</a><img src="${imageUrl.replace("&", "&amp;")}" alt="Product" width="600"></td></tr></table></body></html>`,
    });

    expect(report.issues.map(({ code }) => code)).not.toContain(
      "a1-product-image",
    );
  });

  it("requires a complete and structurally varied family", () => {
    const emails = Array.from({ length: 13 }, (_, index) => ({
      recipe: recipe(index),
      html: `<!doctype html><table width="${500 + index}"><tr><td bgcolor="#00000${index % 10}"><h1>Email</h1></td></tr></table>`,
      quality: { status: "ready" as const, issues: [], byteSize: 4_000 },
    }));
    const ready = auditEmailFamily({ brandSystem: system, emails });
    expect(ready).toMatchObject({
      status: "ready",
      readyCount: 13,
      totalCount: 13,
      creativeBriefCount: 13,
      structureCount: 13,
    });
    const repeated = auditEmailFamily({
      brandSystem: system,
      emails: emails.map((email) => ({
        ...email,
        html: emails[0].html,
        recipe: {
          ...email.recipe,
          subject: "Same",
          creativeBrief: emails[0].recipe.creativeBrief,
        },
      })),
    });
    expect(repeated.status).toBe("needs-attention");
    expect(repeated.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "creative-brief-repeat",
        "structure-repeat",
        "subject-repeat",
      ]),
    );
  });
});
