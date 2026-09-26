import { describe, expect, it, vi } from "vitest";
import { emailImageUrl, mayHaveTransparency, optimizeEmailImageUrl } from "./email-image-url.server";

const CDN = "https://cdn.shopify.com/s/files/1/0677/7680/6975/files/lumen-canopy-01-hd.png?v=1788971353";

function pngHeader(colorType: number): Uint8Array {
  const bytes = new Uint8Array(64);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes[25] = colorType;
  return bytes;
}
const respond = (bytes: Uint8Array) => vi.fn(async () => new Response(bytes as BodyInit, { status: 206 })) as unknown as typeof fetch;

describe("emailImageUrl", () => {
  it("resizes Shopify CDN images to 1200px JPEG, keeping the version param", () => {
    const url = new URL(emailImageUrl(CDN, { keepFormat: false }));
    expect(url.searchParams.get("width")).toBe("1200");
    expect(url.searchParams.get("format")).toBe("jpg");
    expect(url.searchParams.get("v")).toBe("1788971353");
  });

  it("only resizes when the format must be kept", () => {
    const url = new URL(emailImageUrl(`${CDN}&format=jpg`, { keepFormat: true }));
    expect(url.searchParams.get("width")).toBe("1200");
    expect(url.searchParams.has("format")).toBe(false);
  });

  it("covers store-domain CDN paths and leaves other hosts alone", () => {
    expect(emailImageUrl("https://shop.example/cdn/shop/files/a.jpg", { keepFormat: false })).toContain("width=1200");
    expect(emailImageUrl("https://images.example/a.jpg", { keepFormat: false })).toBe("https://images.example/a.jpg");
    expect(emailImageUrl("/template-looks/a.png", { keepFormat: false })).toBe("/template-looks/a.png");
  });
});

describe("mayHaveTransparency", () => {
  it("reads PNG color type", async () => {
    expect(await mayHaveTransparency(CDN, respond(pngHeader(2)))).toBe(false); // RGB
    expect(await mayHaveTransparency(CDN, respond(pngHeader(6)))).toBe(true); // RGBA
    expect(await mayHaveTransparency(CDN, respond(pngHeader(3)))).toBe(true); // palette
  });

  it("treats JPEG as opaque and failures as possibly transparent", async () => {
    expect(await mayHaveTransparency(CDN, respond(new Uint8Array([0xff, 0xd8, 0xff])))).toBe(false);
    const failing = vi.fn(async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    expect(await mayHaveTransparency(CDN, failing)).toBe(true);
  });
});

describe("optimizeEmailImageUrl", () => {
  it("converts opaque photos to JPEG and keeps cutouts as PNG without probing", async () => {
    const opaque = respond(pngHeader(2));
    expect(await optimizeEmailImageUrl(`${CDN}&a=1`, { fetchImpl: opaque })).toContain("format=jpg");
    const probe = vi.fn() as unknown as typeof fetch;
    const cutout = await optimizeEmailImageUrl(`${CDN}&a=2`, { transparent: true, fetchImpl: probe });
    expect(cutout).toContain("width=1200");
    expect(cutout).not.toContain("format=");
    expect(probe).not.toHaveBeenCalled();
  });

  it("passes null and non-Shopify URLs through", async () => {
    expect(await optimizeEmailImageUrl(null)).toBeNull();
    expect(await optimizeEmailImageUrl("https://images.example/a.jpg")).toBe("https://images.example/a.jpg");
  });
});
