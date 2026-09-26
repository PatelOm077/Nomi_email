import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import db from "../db.server";
import { authenticate } from "../shopify.server";

const SUBJECT_MAX_LENGTH = 64;
const PREVIEW_MAX_LENGTH = 140;

export type CampaignMetadataActionResult =
  | { ok: true; campaignId: string; subject: string; previewText: string }
  | { ok: false; error: string };

function actionError(error: string) {
  return data<CampaignMetadataActionResult>({ ok: false, error }, { status: 400 });
}

// Subject and preview text are the only editable fields here — same
// division of responsibility as app.brand-studio.metadata.tsx: this never
// touches the generated campaign HTML (see app.campaigns_.edit.tsx for
// that, the tagged-seam editor).
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const campaignIdValue = formData.get("campaignId");
  const subjectValue = formData.get("subject");
  const previewTextValue = formData.get("previewText");

  if (typeof campaignIdValue !== "string" || !campaignIdValue)
    return actionError("Choose a valid campaign.");
  if (typeof subjectValue !== "string" || typeof previewTextValue !== "string")
    return actionError("Enter both a subject line and preview text.");

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

  const campaign = await db.campaign.findUnique({ where: { id: campaignIdValue } });
  if (!campaign || campaign.shop !== session.shop)
    return actionError("This campaign could not be found.");

  await db.campaign.update({
    where: { id: campaignIdValue },
    data: { subject, previewText },
  });

  return data<CampaignMetadataActionResult>({
    ok: true,
    campaignId: campaignIdValue,
    subject,
    previewText,
  });
};
