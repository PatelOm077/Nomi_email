import { useEffect, useMemo, useRef, useState } from "react";
import type { ActionFunctionArgs, LinksFunction, LoaderFunctionArgs } from "react-router";
import { Link, useFetcher, useLoaderData, useSearchParams } from "react-router";
import v8EditorStyles from "../styles/v8-email-editor.css?url";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getApprovedBrandStudioFamily } from "../brand-studio/approved-family";
import { BRAND_STUDIO_LIFECYCLE_IDS } from "../brand-studio/types";
import { buildLifecycleSlots, LIFECYCLE_FLOWS } from "../dashboard/lifecycle-flow-catalog";
import {
  annotateSeamKeys,
  applyImageSeamEdit,
  applyTextSeamEdit,
  findSeams,
  isButtonSeamId,
  isKnownTextSeamId,
  validateSeamEditedHtml,
  type Seam,
} from "../brand-studio/seam-editor.server";
import { checkShopifyImageStatus, uploadImageToShopifyFiles } from "../brand-studio/shopify-media.server";

// Hand-editing surface for one already-approved Brand Studio email. Unlike
// the Templates block editor (app.template-editor.tsx), this never touches
// layout, composition, or copy Claude didn't explicitly mark as a seam —
// see BRAND_STUDIO_REGENERATE.md's "tagged editable seams" section for why.
// Styled to match that other editor (same stylesheet, same v9-* classes)
// per explicit merchant direction, but it is a separate route because the
// data underneath — one freeform HTML document, not a Block[] list — is
// fundamentally different.

export const links: LinksFunction = () => [{ rel: "stylesheet", href: v8EditorStyles }];

type MediaAsset = {
  id: string;
  name: string;
  url: string;
  alt: string;
  width: number | null;
  height: number | null;
};
type CatalogProduct = {
  id: string;
  name: string;
  price: string | null;
  url: string | null;
  imageSrc: string | null;
  imageAlt: string;
  imageWidth: number | null;
  imageHeight: number | null;
};

function isValidRecipeId(
  value: string | null,
): value is (typeof BRAND_STUDIO_LIFECYCLE_IDS)[number] {
  return Boolean(value) && (BRAND_STUDIO_LIFECYCLE_IDS as readonly string[]).includes(value!);
}

const SHOPIFY_MEDIA_QUERY = `#graphql
  query NomiSeamEditorMedia {
    files(first: 24, query: "media_type:IMAGE") {
      nodes { ... on MediaImage { id alt image { url altText width height } } }
    }
    products(first: 24) {
      nodes {
        id
        title
        onlineStoreUrl
        featuredMedia { ... on MediaImage { id image { url altText width height } } }
      }
    }
  }
`;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const params = new URL(request.url).searchParams;
  const recipeIdParam = params.get("recipeId");
  if (!isValidRecipeId(recipeIdParam))
    return { ok: false as const, error: "Choose a valid lifecycle email to edit." };
  const recipeId = recipeIdParam;

  const profile = await db.brandStudioProfile.findUnique({ where: { shop: session.shop } });
  const approved = getApprovedBrandStudioFamily(profile);
  if (!approved)
    return {
      ok: false as const,
      error: "Build the full email family in Brand Studio before editing a single email.",
    };
  const html = approved.renderedEmails[recipeId];
  if (!html)
    return { ok: false as const, error: "This email has not been generated yet." };

  const slot = buildLifecycleSlots(approved.evidence.shopName).find((s) => s.id === recipeId);
  const flowName = slot ? LIFECYCLE_FLOWS.find((f) => f.id === slot.flowId)?.name ?? "" : "";

  let shopifyFiles: MediaAsset[] = [];
  let catalogProducts: CatalogProduct[] = [];
  let mediaError: string | undefined;
  try {
    const response = await admin.graphql(SHOPIFY_MEDIA_QUERY);
    const result = (await response.json()) as {
      data?: {
        files?: {
          nodes?: Array<{
            id: string;
            alt?: string | null;
            image?: { url: string; altText?: string | null; width?: number | null; height?: number | null } | null;
          }>;
        };
        products?: {
          nodes?: Array<{
            id: string;
            title: string;
            onlineStoreUrl?: string | null;
            featuredMedia?: {
              id: string;
              image?: { url: string; altText?: string | null; width?: number | null; height?: number | null } | null;
            } | null;
          }>;
        };
      };
      errors?: Array<{ message?: string }>;
    };
    mediaError = result.errors?.[0]?.message;
    shopifyFiles = (result.data?.files?.nodes ?? []).flatMap((file) =>
      file.image
        ? [
            {
              id: file.id,
              name: file.alt || "Shopify image",
              url: file.image.url,
              alt: file.image.altText || file.alt || "",
              width: file.image.width ?? null,
              height: file.image.height ?? null,
            },
          ]
        : [],
    );
    catalogProducts = (result.data?.products?.nodes ?? []).map((product) => ({
      id: product.id,
      name: product.title,
      price: null,
      url: product.onlineStoreUrl ?? null,
      imageSrc: product.featuredMedia?.image?.url ?? null,
      imageAlt: product.featuredMedia?.image?.altText || product.title,
      imageWidth: product.featuredMedia?.image?.width ?? null,
      imageHeight: product.featuredMedia?.image?.height ?? null,
    }));
  } catch (error) {
    mediaError = error instanceof Error ? error.message : "Shopify media is temporarily unavailable.";
  }

  return {
    ok: true as const,
    recipeId,
    emailName: slot?.name ?? recipeId,
    flowName,
    html: annotateSeamKeys(html),
    seams: findSeams(html),
    shopifyFiles,
    catalogProducts,
    logoUrl: approved.evidence.assets?.logoUrl ?? null,
    mediaError,
  };
};

type SeamEditActionResult =
  | { ok: true; html: string; seams: Seam[] }
  | { ok: false; error: string };

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  // Same upload flow as app.template-editor.tsx (same 5MB logo / 20MB image
  // limits, same permitted types), shared via shopify-media.server.ts.
  if (intent === "upload-media")
    return uploadImageToShopifyFiles(admin, formData.get("file"), formData.get("target") === "logo" ? "logo" : "image");

  if (intent === "media-status") return checkShopifyImageStatus(admin, formData.get("id"));

  const recipeIdValue = formData.get("recipeId");
  if (!isValidRecipeId(typeof recipeIdValue === "string" ? recipeIdValue : null))
    return { ok: false as const, error: "Choose a valid lifecycle email to edit." } satisfies SeamEditActionResult;
  const recipeId = recipeIdValue as (typeof BRAND_STUDIO_LIFECYCLE_IDS)[number];

  const profile = await db.brandStudioProfile.findUnique({ where: { shop: session.shop } });
  const approved = getApprovedBrandStudioFamily(profile);
  if (!approved)
    return { ok: false as const, error: "This shop's Brand Studio family is no longer approved." } satisfies SeamEditActionResult;
  const currentHtml = approved.renderedEmails[recipeId];
  if (!currentHtml)
    return { ok: false as const, error: "This email has not been generated yet." } satisfies SeamEditActionResult;
  const recipe = approved.recipes.find(({ id }) => id === recipeId);
  if (!recipe)
    return { ok: false as const, error: "This lifecycle email no longer exists." } satisfies SeamEditActionResult;

  try {
    let updatedHtml: string;
    if (intent === "save-text") {
      const seamId = formData.get("seamId");
      const text = formData.get("text");
      const urlRaw = formData.get("url");
      if (typeof seamId !== "string" || !isKnownTextSeamId(seamId) || typeof text !== "string")
        return { ok: false as const, error: "Nothing to save." } satisfies SeamEditActionResult;
      const trimmed = text.trim();
      if (!trimmed) return { ok: false as const, error: "This can't be left empty." } satisfies SeamEditActionResult;
      let href: string | undefined;
      if (isButtonSeamId(seamId) && typeof urlRaw === "string" && urlRaw.trim()) {
        const candidateHref = urlRaw.trim();
        if (!candidateHref.startsWith("https://"))
          return { ok: false as const, error: "The button link must be a full https:// address." } satisfies SeamEditActionResult;
        href = candidateHref;
      }
      const withEdit = applyTextSeamEdit(currentHtml, seamId, trimmed, href);
      updatedHtml = validateSeamEditedHtml({ html: withEdit });
    } else if (intent === "save-image") {
      const seamId = formData.get("seamId");
      const src = formData.get("src");
      const alt = formData.get("alt");
      const width = Number.parseInt(String(formData.get("width") ?? ""), 10);
      const height = Number.parseInt(String(formData.get("height") ?? ""), 10);
      const href = formData.get("href");
      if (
        typeof seamId !== "string" ||
        typeof src !== "string" ||
        typeof alt !== "string" ||
        !Number.isFinite(width) ||
        !Number.isFinite(height)
      )
        return { ok: false as const, error: "Nothing to save." } satisfies SeamEditActionResult;
      const withEdit = applyImageSeamEdit(currentHtml, seamId, {
        src,
        alt,
        width,
        height,
        href: typeof href === "string" && href ? href : undefined,
      });
      updatedHtml = validateSeamEditedHtml({ html: withEdit });
    } else {
      return { ok: false as const, error: "Unknown action." } satisfies SeamEditActionResult;
    }

    await db.brandStudioProfile.update({
      where: { shop: session.shop },
      data: { renderedEmails: JSON.stringify({ ...approved.renderedEmails, [recipeId]: updatedHtml }) },
    });

    return {
      ok: true as const,
      html: annotateSeamKeys(updatedHtml),
      seams: findSeams(updatedHtml),
    } satisfies SeamEditActionResult;
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Nomi could not save that edit.",
    } satisfies SeamEditActionResult;
  }
};

type LoaderData = Awaited<ReturnType<typeof loader>>;

export default function BrandStudioSeamEditor() {
  const data = useLoaderData<LoaderData>();
  const [searchParams] = useSearchParams();

  if (!data.ok) {
    return (
      <main className="v9-editor">
        <div className="v9-topbar">
          <Link to="/app/flow-editor" className="v9-topbar-back">← Back</Link>
        </div>
        <div style={{ padding: 32 }}>
          <p>{data.error}</p>
        </div>
      </main>
    );
  }

  return <SeamEditorWorkspace initial={data} recipeIdFromUrl={searchParams.get("recipeId")} />;
}

type OkLoaderData = Extract<LoaderData, { ok: true }>;

function SeamEditorWorkspace({ initial }: { initial: OkLoaderData; recipeIdFromUrl: string | null }) {
  const fetcher = useFetcher<SeamEditActionResult>();
  const uploadFetcher = useFetcher<{ ok: boolean; asset?: MediaAsset; processing?: boolean; fileId?: string; error?: string }>();

  const [html, setHtml] = useState(initial.html);
  const [seams, setSeams] = useState(initial.seams);
  const [selectedSeamId, setSelectedSeamId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "save-failed">("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) {
      if (fetcher.data.ok) {
        setHtml(fetcher.data.html);
        setSeams(fetcher.data.seams);
        setSaveState("saved");
        setSaveError(null);
      } else {
        setSaveState("save-failed");
        setSaveError(fetcher.data.error);
      }
    }
  }, [fetcher.state, fetcher.data]);

  const selectedSeam = useMemo(
    () => seams.find((seam) => seam.id === selectedSeamId) ?? null,
    [seams, selectedSeamId],
  );

  // dangerouslySetInnerHTML content is opaque to React, so selection
  // highlighting is applied imperatively rather than through JSX className.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    for (const el of canvas.querySelectorAll(".is-nomi-seam-selected"))
      el.classList.remove("is-nomi-seam-selected");
    if (!selectedSeamId) return;
    for (const el of canvas.querySelectorAll(`[data-nomi-seam-key="${selectedSeamId}"]`))
      el.classList.add("is-nomi-seam-selected");
  }, [selectedSeamId, html]);

  const handleCanvasClick = (event: React.MouseEvent<HTMLDivElement>) => {
    // Stop the click from also reaching .v9-canvas-scroll's own onClick
    // below, which deselects on background clicks — without this, every
    // in-canvas click (including a real seam) would bubble up and
    // immediately clear the selection this handler just set.
    event.stopPropagation();
    // The rendered HTML is the real, live email markup — a CTA or product
    // seam is a genuine <a href> pointing at the storefront. Without this,
    // clicking one navigates the embedded iframe to that live URL, which
    // then refuses to render inside another site's frame (clickjacking
    // protection) and shows a broken/"refused to connect" page in its
    // place. This canvas is select-only; no click here should ever navigate.
    event.preventDefault();
    const target = event.target as HTMLElement;
    const seamEl = target.closest<HTMLElement>("[data-nomi-seam-key]");
    setSelectedSeamId(seamEl?.getAttribute("data-nomi-seam-key") ?? null);
  };

  const saveText = (text: string, url?: string) => {
    if (!selectedSeam || selectedSeam.kind !== "text") return;
    setSaveState("saving");
    fetcher.submit(
      { intent: "save-text", recipeId: initial.recipeId, seamId: selectedSeam.id, text, ...(url ? { url } : {}) },
      { method: "post" },
    );
  };

  const saveImage = (update: { src: string; alt: string; width: number; height: number; href?: string; newProductId?: string }) => {
    if (!selectedSeam || selectedSeam.kind === "text") return;
    setSaveState("saving");
    fetcher.submit(
      {
        intent: "save-image",
        recipeId: initial.recipeId,
        seamId: selectedSeam.id,
        src: update.src,
        alt: update.alt,
        width: String(update.width),
        height: String(update.height),
        ...(update.href ? { href: update.href } : {}),
        ...(update.newProductId ? { newProductId: update.newProductId } : {}),
      },
      { method: "post" },
    );
  };

  return (
    <main className="v9-editor">
      <div className="v9-topbar">
        <Link to="/app/flow-editor" className="v9-topbar-back">← Back</Link>
        <div className="v9-topbar-divider" />
        <div className="v9-topbar-context">
          <span>{initial.flowName}</span>
          <span className="v9-topbar-slash">/</span>
          <strong>{initial.emailName}</strong>
        </div>
        <div className="v9-topbar-actions">
          <span className={`v9-save-state is-${saveState}`}>
            <i />
            {saveState === "saved" ? "Saved" : saveState === "saving" ? "Saving…" : "Not saved"}
          </span>
        </div>
      </div>
      {saveError ? <p className="nomi-flow-generate-error">{saveError}</p> : null}
      <div className="v9-workspace" style={{ gridTemplateColumns: "minmax(0, 1fr) 340px" }}>
        <div className="v9-workbench">
          <div className="v9-workbench-head">
            <p>{initial.emailName}</p>
          </div>
          <div className="v9-canvas-scroll" onClick={() => setSelectedSeamId(null)}>
            <div className="v9-canvas-viewport" style={{ width: 600 }}>
              <div
                ref={canvasRef}
                className="nomi-seam-canvas"
                onClick={handleCanvasClick}
                dangerouslySetInnerHTML={{ __html: html }}
              />
            </div>
          </div>
        </div>
        <SeamPanel
          seam={selectedSeam}
          shopifyFiles={initial.shopifyFiles}
          catalogProducts={initial.catalogProducts}
          logoUrl={initial.logoUrl}
          uploadFetcher={uploadFetcher}
          onSaveText={saveText}
          onSaveImage={saveImage}
        />
      </div>
    </main>
  );
}

function SeamPanel({
  seam,
  shopifyFiles,
  catalogProducts,
  logoUrl,
  uploadFetcher,
  onSaveText,
  onSaveImage,
}: {
  seam: Seam | null;
  shopifyFiles: MediaAsset[];
  catalogProducts: CatalogProduct[];
  logoUrl: string | null;
  uploadFetcher: ReturnType<typeof useFetcher<{ ok: boolean; asset?: MediaAsset; processing?: boolean; fileId?: string; error?: string }>>;
  onSaveText: (text: string, url?: string) => void;
  onSaveImage: (update: { src: string; alt: string; width: number; height: number; href?: string }) => void;
}) {
  if (!seam) {
    return (
      <aside className="v9-right-panel" aria-label="Seam editor">
        <div className="v9-empty-state">
          <div className="v9-empty-icon" aria-hidden="true">↖</div>
          <p>Select something to edit</p>
          <span>Click any text, button, logo, or photo in the email.</span>
        </div>
      </aside>
    );
  }

  if (seam.kind === "text") {
    return <TextSeamPanel key={seam.id} seam={seam} onSave={onSaveText} />;
  }
  return (
    <ImageSeamPanel
      key={seam.id}
      seam={seam}
      shopifyFiles={shopifyFiles}
      catalogProducts={catalogProducts}
      logoUrl={logoUrl}
      uploadFetcher={uploadFetcher}
      onSave={onSaveImage}
    />
  );
}

const SEAM_LABELS: Record<string, string> = {
  eyebrow: "Eyebrow",
  headline: "Headline",
  body: "Body copy",
  "cta-label": "Button text",
  footer: "Footer copy",
};

// Repeatable seams (`text:N`, `button:N`) share one label per kind.
function seamLabel(id: string): string {
  if (id.startsWith("text:")) return "Text";
  if (id.startsWith("button:")) return "Button text";
  return SEAM_LABELS[id] ?? id;
}

function TextSeamPanel({
  seam,
  onSave,
}: {
  seam: Extract<Seam, { kind: "text" }>;
  onSave: (text: string, url?: string) => void;
}) {
  const [value, setValue] = useState(seam.text);
  const isCta = seam.id === "cta-label" || seam.id.startsWith("button:");
  const [url, setUrl] = useState(seam.url ?? "");
  const isLong = seam.id === "body" || seam.id === "footer" || seam.id.startsWith("text:");
  const isEmpty = !value.trim();
  const urlDirty = isCta && url.trim() !== (seam.url ?? "").trim();
  const dirty = value.trim() !== seam.text.trim() || urlDirty;
  const urlInvalid = isCta && url.trim().length > 0 && !url.trim().startsWith("https://");
  return (
    <aside className="v9-right-panel" aria-label="Seam editor">
      <div className="v9-panel">
        <div className="v9-panel-head">
          <div>
            <p className="v9-kicker">{seamLabel(seam.id)}</p>
            <h3>Edit text</h3>
          </div>
        </div>
        <div className="v9-panel-body">
          {isLong ? (
            <textarea rows={6} value={value} onChange={(e) => setValue(e.target.value)} maxLength={700} />
          ) : (
            <input value={value} onChange={(e) => setValue(e.target.value)} maxLength={isCta ? 40 : 120} />
          )}
          {isEmpty ? <p className="v9-error" role="alert">This can't be left empty — Save stays off until there's text here.</p> : null}
          {isCta ? (
            <div className="v9-field">
              <label htmlFor="seam-cta-url">Destination URL</label>
              <input id="seam-cta-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
              {urlInvalid ? <p className="v9-error" role="alert">Enter a full https:// address, or clear it to keep the current link.</p> : null}
            </div>
          ) : null}
          <button
            className="v9-save-button"
            disabled={!dirty || isEmpty || urlInvalid}
            onClick={() => onSave(value, isCta ? url.trim() || undefined : undefined)}
          >
            Save changes
          </button>
        </div>
      </div>
    </aside>
  );
}

function ImageSeamPanel({
  seam,
  shopifyFiles,
  catalogProducts,
  logoUrl,
  uploadFetcher,
  onSave,
}: {
  seam: Extract<Seam, { kind: "logo" | "image" | "product" }>;
  shopifyFiles: MediaAsset[];
  catalogProducts: CatalogProduct[];
  logoUrl: string | null;
  uploadFetcher: ReturnType<typeof useFetcher<{ ok: boolean; asset?: MediaAsset; processing?: boolean; fileId?: string; error?: string }>>;
  onSave: (update: { src: string; alt: string; width: number; height: number; href?: string; newProductId?: string }) => void;
}) {
  const showProductsTab = seam.kind === "product";
  type Tab = "shopify" | "products" | "upload";
  const [tab, setTab] = useState<Tab>(showProductsTab ? "products" : "shopify");
  const [pending, setPending] = useState<{
    src: string;
    alt: string;
    href?: string;
    productId?: string;
    width?: number | null;
    height?: number | null;
  } | null>(null);
  const uploading = uploadFetcher.state !== "idle";

  // Falls back to the seam's existing dimensions only when the newly picked
  // photo didn't come with its own (e.g. a source that never reported size) —
  // reusing the OLD photo's width/height for a differently-shaped NEW photo
  // would silently stretch or squash it in the sent email.
  const displayWidth = pending?.width ?? seam.width ?? 600;
  const displayHeight = pending?.height ?? seam.height ?? 600;
  const aspect = displayWidth && displayHeight ? displayWidth / displayHeight : null;

  const commit = () => {
    if (!pending) return;
    onSave({
      src: pending.src,
      alt: pending.alt,
      width: pending.width ?? seam.width ?? 600,
      height: pending.height ?? seam.height ?? 600,
      href: pending.href,
      newProductId: pending.productId,
    });
  };

  // Shopify's fileCreate can return before the CDN has finished processing a
  // fresh upload — no image.url yet, just a processing fileId to poll. Without
  // this, the panel simply showed nothing after a slower upload: no thumbnail,
  // no error, no way to proceed. Mirrors app.template-editor.tsx's ImageEditor.
  const uploadPollAttempts = useRef(0);
  const [uploadStatus, setUploadStatus] = useState<string | undefined>();
  const [uploadTimedOut, setUploadTimedOut] = useState(false);
  useEffect(() => {
    const result = uploadFetcher.data;
    if (!result) return;
    if (!result.ok || result.asset) {
      uploadPollAttempts.current = 0;
      setUploadStatus(undefined);
      return;
    }
    if (result.processing && result.fileId) {
      if (uploadPollAttempts.current >= 15) {
        setUploadStatus(undefined);
        setUploadTimedOut(true);
        return;
      }
      uploadPollAttempts.current += 1;
      setUploadStatus("Shopify is preparing the image…");
      const fileId = result.fileId;
      const timer = window.setTimeout(() => {
        uploadFetcher.submit({ intent: "media-status", id: fileId }, { method: "post" });
      }, 1000);
      return () => window.clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadFetcher.data]);

  return (
    <aside className="v9-right-panel" aria-label="Seam editor">
      <div className="v9-panel">
      <div className="v9-panel-head">
        <div>
          <p className="v9-kicker">{seam.kind === "logo" ? "Logo" : seam.kind === "product" ? "Product" : "Image"}</p>
          <h3>Edit image</h3>
        </div>
      </div>
      <div className="v9-left-tabs">
        {seam.kind !== "logo" && (
          <button aria-selected={tab === "shopify"} onClick={() => setTab("shopify")}>Shopify files</button>
        )}
        {showProductsTab && (
          <button aria-selected={tab === "products"} onClick={() => setTab("products")}>Products</button>
        )}
        <button aria-selected={tab === "upload"} onClick={() => setTab("upload")}>Upload</button>
      </div>
      <div className="v9-panel-body">
        {tab === "shopify" && seam.kind !== "logo" && (
          <div className="v9-asset-list" style={{ gridAutoRows: "max-content" }}>
            {shopifyFiles.length === 0 && <p className="v9-hint">No Shopify files found.</p>}
            {shopifyFiles.map((file) => (
              <button
                key={file.id}
                className={pending?.src === file.url ? "is-selected" : ""}
                onClick={() => setPending({ src: file.url, alt: file.alt || file.name, width: file.width, height: file.height })}
              >
                <img src={file.url} alt={file.alt || file.name} />
                <span>{file.name}</span>
              </button>
            ))}
          </div>
        )}
        {tab === "shopify" && seam.kind === "logo" && logoUrl && (
          <div className="v9-asset-list" style={{ gridAutoRows: "max-content" }}>
            <button className={pending?.src === logoUrl ? "is-selected" : ""} onClick={() => setPending({ src: logoUrl, alt: "Logo" })}>
              <img src={logoUrl} alt="Current logo" />
              <span>Current logo</span>
            </button>
          </div>
        )}
        {tab === "products" && (
          <div className="v9-asset-list" style={{ gridAutoRows: "max-content" }}>
            {catalogProducts.length === 0 && <p className="v9-hint">No products found.</p>}
            {catalogProducts
              .filter((product) => product.imageSrc)
              .map((product) => (
                <button
                  key={product.id}
                  className={pending?.src === product.imageSrc ? "is-selected" : ""}
                  onClick={() =>
                    setPending({
                      src: product.imageSrc as string,
                      alt: product.imageAlt,
                      href: product.url ?? undefined,
                      productId: product.id,
                      width: product.imageWidth,
                      height: product.imageHeight,
                    })
                  }
                >
                  <img src={product.imageSrc as string} alt={product.imageAlt} />
                  <span>{product.name}</span>
                </button>
              ))}
          </div>
        )}
        {tab === "upload" && (
          <div>
            <label className="v9-upload-control">
              {uploading ? "Uploading…" : uploadStatus ? "Processing…" : "Choose image from computer"}
              <input
                type="file"
                accept="image/jpeg,image/png,image/gif"
                disabled={uploading || Boolean(uploadStatus)}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  uploadPollAttempts.current = 0;
                  setUploadStatus(undefined);
                  setUploadTimedOut(false);
                  const body = new FormData();
                  body.set("intent", "upload-media");
                  body.set("target", seam.kind === "logo" ? "logo" : "image");
                  body.set("file", file);
                  uploadFetcher.submit(body, { method: "post", encType: "multipart/form-data" });
                  e.currentTarget.value = "";
                }}
              />
            </label>
            {uploadFetcher.data?.ok && uploadFetcher.data.asset && (
              <div className="v9-asset-list" style={{ gridAutoRows: "max-content" }}>
                <button
                  className={pending?.src === uploadFetcher.data.asset.url ? "is-selected" : ""}
                  onClick={() =>
                    uploadFetcher.data?.asset &&
                    setPending({
                      src: uploadFetcher.data.asset.url,
                      alt: uploadFetcher.data.asset.alt,
                      width: uploadFetcher.data.asset.width,
                      height: uploadFetcher.data.asset.height,
                    })
                  }
                >
                  <img src={uploadFetcher.data.asset.url} alt={uploadFetcher.data.asset.alt} />
                  <span>Just uploaded</span>
                </button>
              </div>
            )}
            {uploadStatus ? <p className="v9-hint" role="status">{uploadStatus}</p> : null}
            {uploadTimedOut ? (
              <p className="v9-error" role="alert">
                Shopify is taking longer than expected to process this image. Try again in a moment.
              </p>
            ) : null}
            {uploadFetcher.data && !uploadFetcher.data.ok && (
              <p className="v9-hint">{uploadFetcher.data.error}</p>
            )}
            <p className="v9-hint">
              {seam.kind === "logo" ? "JPG, PNG, or GIF, up to 5 MB." : "JPG, PNG, or GIF, up to 20 MB."}
            </p>
          </div>
        )}

        {pending && (
          <div className="v9-current-asset">
            <img src={pending.src} alt="" />
            <span>
              {aspect ? `Selected — will be fit to this photo's original ${displayWidth}×${displayHeight} shape` : "Selected"}
            </span>
          </div>
        )}
        <label className="v9-hint" htmlFor="seam-alt-text">Alt text</label>
        <input
          id="seam-alt-text"
          value={pending?.alt ?? seam.alt}
          onChange={(e) => setPending((p) => (p ? { ...p, alt: e.target.value } : p))}
          disabled={!pending}
        />
        <button className="v9-save-button" disabled={!pending} onClick={commit}>
          Save changes
        </button>
      </div>
      </div>
    </aside>
  );
}
