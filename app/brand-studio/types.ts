import { z } from "zod";
import { LIFECYCLE_FLOWS } from "../dashboard/lifecycle-flow-catalog";

const hexColor = z.string().regex(/^#[0-9a-f]{6}$/i);

export const brandEvidenceSchema = z.object({
  shopName: z.string().trim().min(1).max(120),
  storefrontUrl: z.string().url().nullable(),
  storefrontText: z.string().max(40_000),
  products: z
    .array(
      z.object({
        id: z.string(),
        title: z.string().trim().min(1).max(200),
        description: z.string().max(2_000),
        productType: z.string().max(120),
        vendor: z.string().max(120),
        tags: z.array(z.string().max(80)).max(20),
        imageUrl: z.string().url().nullable(),
        productUrl: z.string().url().nullable(),
        price: z.string().trim().max(40).nullable().optional(),
      }),
    )
    .max(12),
  assets: z
    .object({
      logoUrl: z.string().url().nullable(),
      observedColors: z.array(hexColor).max(8),
      fontHints: z.array(z.string().trim().min(2).max(100)).max(6),
      palette: z
        .object({
          paper: hexColor,
          ink: hexColor,
          primary: hexColor,
          accent: hexColor,
        })
        .optional(),
      theme: z
        .object({
          id: z.string().max(120),
          name: z.string().trim().min(1).max(120),
          updatedAt: z.string().datetime().nullable(),
          checksum: z.string().max(80).nullable(),
        })
        .optional(),
      buttonRadiusPx: z.number().int().min(0).max(100).nullable().optional(),
    })
    .optional(),
});

export const brandSnapshotSchema = z.object({
  summary: z.string().trim().min(20).max(420),
  positioning: z.string().trim().min(12).max(260),
  audienceSuggestion: z.string().trim().min(8).max(300),
  feelingSuggestion: z.string().trim().min(8).max(300),
  evidence: z
    .array(
      z.object({
        label: z.string().trim().min(2).max(60),
        value: z.string().trim().min(2).max(180),
        source: z.enum(["storefront", "product", "merchant", "shopify"]),
        confidence: z.enum(["high", "medium", "low"]),
      }),
    )
    .min(3)
    .max(8),
});

export const creativeDirectionSchema = z.object({
  id: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]+$/)
    .max(48),
  name: z.string().trim().min(3).max(60),
  rationale: z.string().trim().min(20).max(300),
  palette: z.array(hexColor).length(4),
  typography: z.object({
    display: z.string().trim().min(2).max(80),
    body: z.string().trim().min(2).max(80),
    character: z.string().trim().min(8).max(180),
  }),
  imageTreatment: z.string().trim().min(8).max(220),
  voice: z.string().trim().min(8).max(220),
  layoutStyle: z.enum([
    "editorial",
    "product-led",
    "graphic",
    "catalogue",
    "narrative",
  ]),
  motif: z.string().trim().min(3).max(120),
  sampleHeadline: z.string().trim().min(3).max(100),
  sampleCta: z.string().trim().min(2).max(40),
});

export const creativeDirectionsSchema = z
  .array(creativeDirectionSchema)
  .length(3);

export const brandSystemSchema = z.object({
  directionId: z.string().min(1).max(48),
  name: z.string().trim().min(3).max(60),
  audience: z.string().trim().min(8).max(300),
  feeling: z.string().trim().min(8).max(300),
  palette: z.object({
    paper: hexColor,
    ink: hexColor,
    primary: hexColor,
    accent: hexColor,
  }),
  typography: z.object({
    display: z.string().trim().min(2).max(80),
    body: z.string().trim().min(2).max(80),
    fallback: z.string().trim().min(2).max(100),
  }),
  voice: z.object({
    principles: z.array(z.string().min(3).max(120)).min(3).max(6),
    preferredWords: z.array(z.string().min(1).max(40)).max(10),
    avoidWords: z.array(z.string().min(1).max(40)).max(10),
  }),
  layoutRules: z.array(z.string().min(5).max(180)).min(3).max(8),
  imageTreatment: z.string().trim().min(8).max(240),
  buttonTreatment: z.string().trim().min(8).max(180),
  signatureMotif: z.string().trim().min(3).max(140),
});

export const BRAND_STUDIO_LIFECYCLE_IDS = [
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

export const lifecycleRecipeSchema = z.object({
  id: z.enum(BRAND_STUDIO_LIFECYCLE_IDS),
  subject: z.string().trim().min(3).max(80),
  preheader: z.string().trim().min(3).max(140),
  eyebrow: z.string().trim().max(50),
  headline: z.string().trim().min(3).max(120),
  body: z.string().trim().min(10).max(700),
  ctaLabel: z.string().trim().min(2).max(40),
  creativeBrief: z.string().trim().min(40).max(1_200),
  productIds: z.array(z.string()).max(4),
});

export const lifecycleRecipesSchema = z
  .array(lifecycleRecipeSchema)
  .length(13)
  .superRefine((recipes, context) => {
    const expected = new Set<string>(BRAND_STUDIO_LIFECYCLE_IDS);
    const actual = new Set<string>(recipes.map(({ id }) => id));
    for (const id of expected) {
      if (!actual.has(id))
        context.addIssue({
          code: "custom",
          message: `Missing lifecycle recipe: ${id}`,
        });
    }
    for (const flow of LIFECYCLE_FLOWS) {
      const headlines = flow.templateIds
        .map((id) =>
          recipes.find((recipe) => recipe.id === id)?.headline.toLowerCase(),
        )
        .filter(Boolean);
      if (new Set(headlines).size !== headlines.length) {
        context.addIssue({
          code: "custom",
          message: `${flow.name} repeats a headline.`,
        });
      }
    }
  });

export type BrandEvidence = z.infer<typeof brandEvidenceSchema>;
export type BrandSnapshot = z.infer<typeof brandSnapshotSchema>;
export type CreativeDirection = z.infer<typeof creativeDirectionSchema>;
export type BrandSystem = z.infer<typeof brandSystemSchema>;
export type LifecycleRecipe = z.infer<typeof lifecycleRecipeSchema>;

export const renderedEmailsSchema = z
  .record(z.string(), z.string().trim().min(100))
  .superRefine((emails, context) => {
    const allowed = new Set<string>(BRAND_STUDIO_LIFECYCLE_IDS);
    for (const id of Object.keys(emails)) {
      if (!allowed.has(id))
        context.addIssue({
          code: "custom",
          message: `Unknown rendered lifecycle email: ${id}`,
        });
    }
  });
export type RenderedEmails = z.infer<typeof renderedEmailsSchema>;

export function safeJson<T>(
  value: string,
  schema: z.ZodType<T>,
  fallback: T,
): T {
  try {
    return schema.parse(JSON.parse(value));
  } catch {
    return fallback;
  }
}
