import { reviewGeneratedImage } from "../email-engine/campaign-image-review";
import { generateImage, type GeneratedImageAspect } from "../email-engine/image-generation";
import type { NewsletterProduct } from "../email-engine/types";
import { uploadImageBufferToShopify, type GraphqlAdmin } from "./campaign-catalog.server";
import { optimizeEmailImageUrl } from "./email-image-url.server";

// Shared by campaigns (app.campaigns.tsx) and the Brand Studio photo kit
// (brand-studio/photo-kit.server.ts): generate one planned photo, have Claude
// review it against the real product photos (campaign-image-review.ts),
// regenerate once with the reviewer's issues if it fails, and host it on the
// shop's own CDN. Never throws — any failure resolves to a null url.

// Rough per-render cost of the Image API at high quality, for budgets that
// must count photos (Brand Studio's $3 cap). The API bills by tokens; this is
// a deliberately high-side estimate, overridable without a code change.
export const IMAGE_RENDER_MICROS = (() => {
  const usd = Number(process.env.NOMI_IMAGE_RENDER_USD);
  return Math.round((Number.isFinite(usd) && usd > 0 ? usd : 0.09) * 1_000_000);
})();

export type ReviewedPhotoResult = {
  url: string | null;
  renders: number;
  reviewUsage: { inputTokens: number; outputTokens: number };
};

export async function renderReviewedPhoto(
  admin: GraphqlAdmin,
  input: {
    brief: { key: string; prompt: string; aspect: GeneratedImageAspect; productIds: string[]; alt: string };
    shopName: string;
    products: NewsletterProduct[];
    filename: string;
  },
): Promise<ReviewedPhotoResult> {
  const { brief } = input;
  const result: ReviewedPhotoResult = { url: null, renders: 0, reviewUsage: { inputTokens: 0, outputTokens: 0 } };
  try {
    const references = brief.productIds
      .map((id) => input.products.find((product) => product.id === id)?.imageUrl)
      .filter((url): url is string => Boolean(url));
    let prompt = brief.prompt;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const generated = await generateImage({ prompt, aspect: brief.aspect, referenceImageUrls: references });
      result.renders += 1;
      if (!generated) return result;
      const review = await reviewGeneratedImage({
        imageBytes: generated.bytes,
        contentType: generated.contentType,
        brief: brief.prompt,
        shopName: input.shopName,
        products: input.products,
        productIds: brief.productIds,
      });
      result.reviewUsage.inputTokens += review.usage.inputTokens;
      result.reviewUsage.outputTokens += review.usage.outputTokens;
      console.info(
        `Generated photo ${brief.key} attempt ${attempt}: ${review.pass ? "passed" : `rejected — ${review.issues.join(" ")}`}`,
      );
      if (!review.pass) {
        prompt = `${brief.prompt}\n\nA previous attempt was rejected. Correct these problems: ${review.issues.join(" ")}`;
        continue;
      }
      const hostedUrl = await uploadImageBufferToShopify(admin, {
        bytes: generated.bytes,
        contentType: generated.contentType,
        filename: input.filename,
        alt: brief.alt,
        waitForReadyMs: 30_000,
      });
      if (!hostedUrl) return result;
      result.url = (await optimizeEmailImageUrl(hostedUrl)) ?? hostedUrl;
      return result;
    }
    return result;
  } catch (error) {
    // Includes a failed review: no verdict means no evidence the photo is
    // safe, so it's dropped.
    console.error(`Generated photo ${brief.key} failed:`, error);
    return result;
  }
}
