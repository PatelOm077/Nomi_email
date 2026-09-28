import { describe, expect, it } from "vitest";
import { generatedPhotoPlaceholder, resolveGeneratedPhotoPlaceholders } from "./generated-photo-slots";

describe("resolveGeneratedPhotoPlaceholders", () => {
  const hero = generatedPhotoPlaceholder("hero-window");
  const scene = generatedPhotoPlaceholder("scene-linen");
  const html = `<table><tr><td><img src="${hero}" width="600" alt="Hero" data-nomi-seam="image"></td></tr><tr><td><img src="${scene}" width="600" alt="Scene"></td></tr><tr><td><img src="https://cdn.shopify.com/real.jpg" width="200" alt="Product"></td></tr></table>`;

  it("swaps a hosted photo in and removes a failed one", () => {
    const result = resolveGeneratedPhotoPlaceholders(
      html,
      new Map([
        ["hero-window", "https://cdn.shopify.com/hero.jpg"],
        ["scene-linen", null],
      ]),
    );
    expect(result.html).toContain('src="https://cdn.shopify.com/hero.jpg"');
    expect(result.html).not.toContain("nomi.invalid");
    expect(result.html).not.toContain('alt="Scene"');
    expect(result.html).toContain("https://cdn.shopify.com/real.jpg");
    expect(result.placed).toEqual(["hero-window"]);
    expect(result.removed).toEqual(["scene-linen"]);
  });

  it("adds the image seam tag when the designer left it off", () => {
    const untagged = `<img src="${hero}" width="600" alt="Hero">`;
    const result = resolveGeneratedPhotoPlaceholders(untagged, new Map([["hero-window", "https://cdn/h.jpg"]]));
    expect(result.html).toBe('<img data-nomi-seam="image" src="https://cdn/h.jpg" width="600" alt="Hero">');
  });

  it("drops a placeholder the designer altered instead of shipping it", () => {
    const altered = `<img src="https://pending-photo.nomi.invalid/made-up.jpg" alt="x">`;
    const result = resolveGeneratedPhotoPlaceholders(altered, new Map([["hero-window", "https://cdn/x.jpg"]]));
    expect(result.html).toBe("");
    expect(result.removed).toEqual(["unknown"]);
  });
});
