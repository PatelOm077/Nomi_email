import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { getApprovedBrandStudioFamily } from "../brand-studio/approved-family";
import {
  BRAND_STUDIO_LIFECYCLE_IDS,
  lifecycleRecipesSchema,
} from "../brand-studio/types";
import db from "../db.server";
import { authenticate } from "../shopify.server";

const SUBJECT_MAX_LENGTH = 64;
const PREVIEW_MAX_LENGTH = 140;

export type BrandStudioMetadataActionResult =
  | {
      ok: true;
      recipeId: (typeof BRAND_STUDIO_LIFECYCLE_IDS)[number];
      subject: string;
      previewText: string;
    }
  | { ok: false; error: string };

function actionError(error: string) {
  return data<BrandStudioMetadataActionResult>(
    { ok: false, error },
    { status: 400 },
  );
}

function normalizeForComparison(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

// Subject and preview text are semantic recipe metadata. Editing them must
// never invoke AI or rewrite the approved, hand-editable email HTML.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const recipeIdValue = formData.get("recipeId");
  const subjectValue = formData.get("subject");
  const previewTextValue = formData.get("previewText");

  if (
    typeof recipeIdValue !== "string" ||
    !(BRAND_STUDIO_LIFECYCLE_IDS as readonly string[]).includes(recipeIdValue)
  )
    return actionError("Choose a valid lifecycle email.");
  if (typeof subjectValue !== "string" || typeof previewTextValue !== "string")
    return actionError("Enter both a subject line and preview text.");

  const recipeId = recipeIdValue as (typeof BRAND_STUDIO_LIFECYCLE_IDS)[number];
  const subject = subjectValue.trim();
  const previewText = previewTextValue.trim();

  if (subject.length < 3)
    return actionError("The subject line must be at least 3 characters.");
  if (subject.length > SUBJECT_MAX_LENGTH)
    return actionError(`Keep the subject line to ${SUBJECT_MAX_LENGTH} characters or fewer.`);
  if (previewText.length < 3)
    return actionError("The preview text must be at least 3 characters.");
  if (previewText.length > PREVIEW_MAX_LENGTH)
    return actionError(`Keep the preview text to ${PREVIEW_MAX_LENGTH} characters or fewer.`);
  if (normalizeForComparison(subject) === normalizeForComparison(previewText))
    return actionError("Preview text should add a different thought from the subject line.");

  const profile = await db.brandStudioProfile.findUnique({
    where: { shop: session.shop },
  });
  const approved = getApprovedBrandStudioFamily(profile);
  if (!approved)
    return actionError(
      "Build the full email family in Brand Studio before editing inbox details.",
    );

  const duplicateSubject = approved.recipes.some(
    (recipe) =>
      recipe.id !== recipeId &&
      normalizeForComparison(recipe.subject) === normalizeForComparison(subject),
  );
  if (duplicateSubject)
    return actionError("Use a different subject line for each email in the family.");

  const updatedRecipes = approved.recipes.map((recipe) =>
    recipe.id === recipeId ? { ...recipe, subject, preheader: previewText } : recipe,
  );
  const parsedRecipes = lifecycleRecipesSchema.safeParse(updatedRecipes);
  if (!parsedRecipes.success)
    return actionError("Those inbox details do not fit the approved email family.");

  await db.brandStudioProfile.update({
    where: { shop: session.shop },
    data: { lifecycleRecipes: JSON.stringify(parsedRecipes.data) },
  });

  return data<BrandStudioMetadataActionResult>({
    ok: true,
    recipeId,
    subject,
    previewText,
  });
};
