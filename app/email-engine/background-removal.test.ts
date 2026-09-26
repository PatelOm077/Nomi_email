import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isBackgroundRemovalConfigured,
  removeImageBackground,
} from "./background-removal";

describe("background removal configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("reports unconfigured without an API key", () => {
    vi.stubEnv("REMOVE_BG_API_KEY", "");
    expect(isBackgroundRemovalConfigured()).toBe(false);
  });

  it("reports configured once an API key is present", () => {
    vi.stubEnv("REMOVE_BG_API_KEY", "test-key");
    expect(isBackgroundRemovalConfigured()).toBe(true);
  });

  it("returns null without making a request when unconfigured", async () => {
    vi.stubEnv("REMOVE_BG_API_KEY", "");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      removeImageBackground("https://cdn.example.com/product.jpg"),
    ).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns the cutout bytes on a successful call", async () => {
    vi.stubEnv("REMOVE_BG_API_KEY", "test-key");
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => bytes,
    });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await removeImageBackground(
      "https://cdn.example.com/product.jpg",
    );

    expect(result).toEqual({
      bytes: Buffer.from(bytes),
      contentType: "image/png",
    });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.remove.bg/v1.0/removebg");
    expect(init.headers["X-Api-Key"]).toBe("test-key");
    expect(JSON.parse(init.body)).toEqual({
      image_url: "https://cdn.example.com/product.jpg",
      size: "auto",
      format: "png",
    });
  });

  it("returns null on a non-2xx response instead of throwing", async () => {
    vi.stubEnv("REMOVE_BG_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));

    await expect(
      removeImageBackground("https://cdn.example.com/product.jpg"),
    ).resolves.toBeNull();
  });

  it("returns null when the request throws", async () => {
    vi.stubEnv("REMOVE_BG_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down")),
    );

    await expect(
      removeImageBackground("https://cdn.example.com/product.jpg"),
    ).resolves.toBeNull();
  });
});
