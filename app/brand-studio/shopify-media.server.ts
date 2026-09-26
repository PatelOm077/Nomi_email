// Shopify Files access shared by every "choose an image" surface: the seam
// editor (app.brand-studio_.edit.tsx) and the logo pickers in Brand Studio's
// snapshot step and Brand & Settings (via app.brand-media.tsx). One copy of
// the stagedUploadsCreate → upload → fileCreate flow, so the size limits,
// permitted types, and error copy can't drift between them.

interface GraphqlAdmin {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
}

export type ShopifyMediaAsset = {
  id: string;
  name: string;
  url: string;
  alt: string;
  width: number | null;
  height: number | null;
};

export type ShopifyMediaUploadResult =
  | { ok: true; asset: ShopifyMediaAsset }
  | { ok: true; processing: true; fileId: string }
  | { ok: false; error: string };

type MediaImageNode = {
  id: string;
  alt?: string | null;
  fileStatus?: string | null;
  image?: { url: string; altText?: string | null; width?: number | null; height?: number | null } | null;
};

const PERMITTED_TYPES = new Set(["image/jpeg", "image/png", "image/gif"]);

export function isUploadFile(value: FormDataEntryValue | null): value is File {
  return Boolean(
    value &&
      typeof value === "object" &&
      "name" in value &&
      "type" in value &&
      "size" in value &&
      typeof (value as File).name === "string" &&
      typeof (value as File).type === "string" &&
      typeof (value as File).size === "number" &&
      typeof (value as Blob).arrayBuffer === "function",
  );
}

function toAsset(image: MediaImageNode, fallbackName: string): ShopifyMediaAsset | null {
  if (!image.image?.url) return null;
  return {
    id: image.id,
    name: image.alt || fallbackName,
    url: image.image.url,
    alt: image.image.altText || image.alt || fallbackName,
    width: image.image.width ?? null,
    height: image.image.height ?? null,
  };
}

export async function listShopifyImageFiles(admin: GraphqlAdmin): Promise<ShopifyMediaAsset[]> {
  const response = await admin.graphql(`#graphql
    query NomiShopifyImageFiles {
      files(first: 36, sortKey: CREATED_AT, reverse: true, query: "media_type:IMAGE") {
        nodes { ... on MediaImage { id alt image { url altText width height } } }
      }
    }`);
  const result = (await response.json()) as {
    data?: { files?: { nodes?: MediaImageNode[] } };
    errors?: Array<{ message?: string }>;
  };
  if (result.errors?.length) throw new Error(result.errors[0]?.message || "Shopify Files could not be loaded.");
  return (result.data?.files?.nodes ?? []).flatMap((node) => {
    const asset = node?.image ? toAsset(node, "Shopify image") : null;
    return asset ? [asset] : [];
  });
}

export async function uploadImageToShopifyFiles(
  admin: GraphqlAdmin,
  file: FormDataEntryValue | null,
  target: "logo" | "image",
): Promise<ShopifyMediaUploadResult> {
  const isLogo = target === "logo";
  const maximumBytes = isLogo ? 5 * 1024 * 1024 : 20 * 1024 * 1024;
  if (!isUploadFile(file)) return { ok: false, error: "Choose a JPG, PNG, or GIF image to upload." };
  if (!PERMITTED_TYPES.has(file.type))
    return { ok: false, error: "This file type is not supported. Choose a JPG, PNG, or GIF image." };
  if (file.size > maximumBytes)
    return {
      ok: false,
      error: `This ${isLogo ? "logo" : "image"} is bigger than the ${isLogo ? "5" : "20"} MB limit, so it was not uploaded.`,
    };
  try {
    const stagedResponse = await admin.graphql(
      `#graphql
      mutation StageNomiImage($input: [StagedUploadInput!]!) {
        stagedUploadsCreate(input: $input) { stagedTargets { url resourceUrl parameters { name value } } userErrors { message } }
      }`,
      { variables: { input: [{ filename: file.name, mimeType: file.type, resource: "FILE", httpMethod: "POST", fileSize: String(file.size) }] } },
    );
    const staged = (await stagedResponse.json()) as {
      data?: { stagedUploadsCreate?: { stagedTargets?: Array<{ url: string; resourceUrl: string; parameters: Array<{ name: string; value: string }> }>; userErrors?: Array<{ message: string }> } };
    };
    const stagedTarget = staged.data?.stagedUploadsCreate?.stagedTargets?.[0];
    const stageError = staged.data?.stagedUploadsCreate?.userErrors?.[0]?.message;
    if (!stagedTarget) return { ok: false, error: stageError || "Shopify could not prepare that upload." };
    const uploadBody = new FormData();
    stagedTarget.parameters.forEach((parameter) => uploadBody.append(parameter.name, parameter.value));
    uploadBody.append("file", file, file.name);
    const uploaded = await fetch(stagedTarget.url, { method: "POST", body: uploadBody });
    if (!uploaded.ok) return { ok: false, error: "The file could not be sent to Shopify. Please try again." };
    const createdResponse = await admin.graphql(
      `#graphql
      mutation CreateNomiImage($files: [FileCreateInput!]!) {
        fileCreate(files: $files) { files { ... on MediaImage { id alt fileStatus image { url altText width height } } } userErrors { message } }
      }`,
      { variables: { files: [{ contentType: "IMAGE", originalSource: stagedTarget.resourceUrl, alt: file.name.replace(/\.[^.]+$/, "") }] } },
    );
    const created = (await createdResponse.json()) as {
      data?: { fileCreate?: { files?: MediaImageNode[]; userErrors?: Array<{ message: string }> } };
    };
    const image = created.data?.fileCreate?.files?.[0];
    const createError = created.data?.fileCreate?.userErrors?.[0]?.message;
    if (!image) return { ok: false, error: createError || "Shopify could not create that image file." };
    if (image.fileStatus === "FAILED")
      return { ok: false, error: "Shopify could not process that image. Try a different JPG, PNG, or GIF." };
    const asset = toAsset(image, file.name);
    if (!asset) return { ok: true, processing: true, fileId: image.id };
    return { ok: true, asset: { ...asset, name: file.name } };
  } catch {
    return { ok: false, error: "The image could not be uploaded to Shopify. Please try again." };
  }
}

export async function checkShopifyImageStatus(
  admin: GraphqlAdmin,
  id: FormDataEntryValue | null,
): Promise<ShopifyMediaUploadResult> {
  if (typeof id !== "string" || !id.startsWith("gid://"))
    return { ok: false, error: "That upload could not be checked." };
  try {
    const response = await admin.graphql(
      `#graphql
      query NomiUploadedImage($id: ID!) {
        node(id: $id) { ... on MediaImage { id alt fileStatus image { url altText width height } } }
      }`,
      { variables: { id } },
    );
    const result = (await response.json()) as { data?: { node?: MediaImageNode | null } };
    const image = result.data?.node;
    if (!image) return { ok: false, error: "Shopify could not find that uploaded image." };
    if (image.fileStatus === "FAILED")
      return { ok: false, error: "Shopify could not process that image. Try a different JPG, PNG, or GIF." };
    const asset = toAsset(image, "Uploaded image");
    return asset ? { ok: true, asset } : { ok: true, processing: true, fileId: image.id };
  } catch {
    return { ok: false, error: "Shopify could not check the upload status. Please try again." };
  }
}
