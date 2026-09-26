import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  checkShopifyImageStatus,
  listShopifyImageFiles,
  uploadImageToShopifyFiles,
} from "../brand-studio/shopify-media.server";

// Resource route behind the shared LogoPicker (app/components/brand-inputs.tsx):
// GET lists the shop's image Files, POST uploads a new one or polls a fresh
// upload Shopify is still processing. No UI of its own.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  try {
    return { ok: true as const, files: await listShopifyImageFiles(admin) };
  } catch (error) {
    return {
      ok: false as const,
      files: [],
      error: error instanceof Error ? error.message : "Shopify Files could not be loaded.",
    };
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");
  if (intent === "upload-media")
    return uploadImageToShopifyFiles(admin, formData.get("file"), formData.get("target") === "image" ? "image" : "logo");
  if (intent === "media-status") return checkShopifyImageStatus(admin, formData.get("id"));
  return { ok: false as const, error: "That media action is not supported." };
};
