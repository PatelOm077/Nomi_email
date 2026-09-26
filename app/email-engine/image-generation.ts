// Optional AI photography for one-prompt campaigns (see
// app/routes/app.campaigns.tsx and campaign-image-plan.ts). Platform-neutral
// — no Shopify imports, same boundary as background-removal.ts — this module
// only takes a prompt (plus optional public reference-image URLs) and hands
// back raw image bytes. Hosting those bytes is Shopify-shape work and lives
// in the route.
//
// Calls OpenAI's Image API, which is paid per token. Entirely optional:
// without OPENAI_API_KEY (or with NOMI_CAMPAIGN_IMAGES=off) every call site
// skips generated photography and campaigns generate exactly as before.

export type GeneratedImageAspect = "portrait" | "landscape" | "square";

const SIZE_BY_ASPECT: Record<GeneratedImageAspect, { size: string; width: number; height: number }> = {
  portrait: { size: "1024x1536", width: 1024, height: 1536 },
  landscape: { size: "1536x1024", width: 1536, height: 1024 },
  square: { size: "1024x1024", width: 1024, height: 1024 },
};

export function imageDimensions(aspect: GeneratedImageAspect): { width: number; height: number } {
  const { width, height } = SIZE_BY_ASPECT[aspect];
  return { width, height };
}

export function isImageGenerationConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY) && process.env.NOMI_CAMPAIGN_IMAGES !== "off";
}

export type GeneratedImage = {
  bytes: Buffer;
  contentType: "image/jpeg";
  usage: { inputTokens: number; outputTokens: number } | null;
};

type ImageApiResponse = {
  data?: Array<{ b64_json?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string };
};

// Complex prompts can take up to ~2 minutes on the Image API.
const REQUEST_TIMEOUT_MS = 180_000;

async function fetchReference(url: string): Promise<Blob | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return null;
    const type = response.headers.get("content-type")?.split(";")[0] ?? "image/jpeg";
    if (!type.startsWith("image/")) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    return new Blob([bytes], { type });
  } catch {
    return null;
  }
}

function extensionFor(type: string): string {
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  return "jpg";
}

// Best-effort by design, like removeImageBackground: every failure mode
// returns null rather than throwing, because a missing generated photo must
// never block or fail campaign generation.
export async function generateImage(input: {
  prompt: string;
  aspect: GeneratedImageAspect;
  // Real product photos the model must stay faithful to. When present the
  // edits endpoint is used so the generated scene shows the actual product.
  referenceImageUrls?: string[];
}): Promise<GeneratedImage | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || process.env.NOMI_CAMPAIGN_IMAGES === "off") return null;

  const model = process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-2.5-sunburst";
  const { size } = SIZE_BY_ASPECT[input.aspect];
  const common = {
    model,
    prompt: input.prompt,
    size,
    quality: process.env.OPENAI_IMAGE_QUALITY ?? "high",
    output_format: "jpeg",
    output_compression: 85,
    n: 1,
  };

  try {
    let response: Response;
    const references = (
      await Promise.all((input.referenceImageUrls ?? []).map((url) => fetchReference(url)))
    ).filter((blob): blob is Blob => blob !== null);

    if (references.length > 0) {
      const body = new FormData();
      for (const [key, value] of Object.entries(common)) body.append(key, String(value));
      references.forEach((blob, index) =>
        body.append("image[]", blob, `reference-${index}.${extensionFor(blob.type)}`),
      );
      response = await fetch("https://api.openai.com/v1/images/edits", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } else {
      response = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(common),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    }

    const body = (await response.json().catch(() => ({}))) as ImageApiResponse;
    if (!response.ok) {
      console.error(`Image generation failed (${response.status}):`, body.error?.message ?? "unknown error");
      return null;
    }
    const b64 = body.data?.[0]?.b64_json;
    if (!b64) return null;
    return {
      bytes: Buffer.from(b64, "base64"),
      contentType: "image/jpeg",
      usage: body.usage
        ? { inputTokens: body.usage.input_tokens ?? 0, outputTokens: body.usage.output_tokens ?? 0 }
        : null,
    };
  } catch (error) {
    console.error("Image generation failed:", error);
    return null;
  }
}
