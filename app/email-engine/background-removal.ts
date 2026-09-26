// Optional background removal for real product photography used in
// one-prompt campaigns (see app/routes/app.campaigns.tsx). Platform-neutral
// — no Shopify imports, same boundary as the rest of this folder — this
// module only ever takes a real, already-public image URL and hands back
// raw cutout bytes. Hosting those bytes at a public URL is Shopify-shape
// work and belongs in the route, not here.
//
// This calls a paid third-party API (remove.bg) and is entirely optional:
// unset REMOVE_BG_API_KEY and every call site falls back to the product's
// real photo, exactly as campaigns behaved before this existed.

export function isBackgroundRemovalConfigured(): boolean {
  return Boolean(process.env.REMOVE_BG_API_KEY);
}

export type RemovedBackgroundImage = { bytes: Buffer; contentType: "image/png" };

// Best-effort by design: every failure mode (not configured, network error,
// non-2xx response) returns null rather than throwing, because a missing
// cutout should never block or fail campaign generation — the caller always
// has the real photo to fall back to.
export async function removeImageBackground(
  imageUrl: string,
): Promise<RemovedBackgroundImage | null> {
  const apiKey = process.env.REMOVE_BG_API_KEY;
  if (!apiKey) return null;
  try {
    const response = await fetch("https://api.remove.bg/v1.0/removebg", {
      method: "POST",
      headers: {
        "X-Api-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ image_url: imageUrl, size: "auto", format: "png" }),
    });
    if (!response.ok) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    return { bytes, contentType: "image/png" };
  } catch {
    return null;
  }
}
