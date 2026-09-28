import { useEffect, useMemo, useRef, useState } from "react";
import type { ActionFunctionArgs, LinksFunction, LoaderFunctionArgs } from "react-router";
import { Link, useFetcher, useLoaderData, useSearchParams } from "react-router";
import v8EditorStyles from "../styles/v8-email-editor.css?url";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  searchCampaignProducts,
  searchCampaignShopifyFiles,
  uploadImageBufferToShopify,
} from "../dashboard/campaign-catalog.server";
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

// Hand-editing surface for one already-generated campaign email — the
// Campaigns-table counterpart of app.brand-studio_.edit.tsx. Same seam
// philosophy (see BRAND_STUDIO_REGENERATE.md's "tagged editable seams"
// section): this never touches layout, composition, or the invented
// decorative graphics newsletter-prompt.ts rule 8/8a/8b builds — only the
// handful of elements that prompt's rule 9 explicitly marks as seams.
// Deliberately its own route rather than a shared one with Brand Studio's
// editor: the data underneath is a `Campaign` row keyed by id, not a
// `BrandStudioProfile` keyed by shop, so ownership has to be checked
// explicitly on every load and save (see campaignOwnedByShop below) — a
// `BrandStudioProfile` lookup is inherently shop-scoped and never needs this.

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

// A Campaign is keyed by its own id (a cuid), not by shop the way
// BrandStudioProfile is — so unlike that editor, every load and save here
// must explicitly check the row's `shop` matches the authenticated session
// before touching it. Skipping this would let one shop read or overwrite
// another shop's campaign just by knowing (or guessing) its id.
async function loadOwnedCampaign(id: string, shop: string) {
  const campaign = await db.campaign.findUnique({ where: { id } });
  if (!campaign || campaign.shop !== shop) return null;
  return campaign;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const params = new URL(request.url).searchParams;
  const id = params.get("id");
  if (!id) return { ok: false as const, error: "Choose a campaign to edit." };

  const campaign = await loadOwnedCampaign(id, session.shop);
  if (!campaign)
    return { ok: false as const, error: "This campaign could not be found." };
  const html = campaign.html;
  if (!html)
    return { ok: false as const, error: "This campaign has not been generated yet." };

  let shopifyFiles: MediaAsset[] = [];
  let catalogProducts: CatalogProduct[] = [];
  let mediaError: string | undefined;
  try {
    const [files, products] = await Promise.all([
      searchCampaignShopifyFiles(admin),
      searchCampaignProducts(admin, ""),
    ]);
    shopifyFiles = files;
    catalogProducts = products.map((product) => ({
      id: product.id,
      name: product.title,
      price: product.price || null,
      url: product.productUrl,
      imageSrc: product.imageUrl,
      imageAlt: product.title,
      imageWidth: null,
      imageHeight: null,
    }));
  } catch (error) {
    mediaError = error instanceof Error ? error.message : "Shopify media is temporarily unavailable.";
  }

  return {
    ok: true as const,
    campaignId: campaign.id,
    campaignName: campaign.name,
    subject: campaign.subject ?? "",
    html: annotateSeamKeys(html),
    seams: findSeams(html),
    shopifyFiles,
    catalogProducts,
    mediaError,
  };
};

type SeamEditActionResult =
  | { ok: true; html: string; seams: Seam[] }
  | { ok: false; error: string };

function isUploadFile(value: FormDataEntryValue | null): value is File {
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

const PERMITTED_UPLOAD_TYPES = new Set(["image/jpeg", "image/png", "image/gif"]);
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  // Campaigns have no logo concept (see generate-newsletter-email.ts — no
  // logoUrl is ever sent to the model), so unlike the Brand Studio and
  // Template editors' identical upload flow, there's only one size/type
  // limit here, not a logo-vs-image branch. This also uses
  // uploadImageBufferToShopify (built for the background-removal pipeline)
  // rather than that flow's own inline staged-upload code, which means no
  // "still processing" polling: a fresh upload Shopify hasn't finished
  // processing yet is treated the same as a failed one, asking the merchant
  // to retry. Acceptable here since a retry is cheap and this intentionally
  // reuses existing, tested code rather than adding a third copy of the
  // polling dance Brand Studio's and the Template editor's routes each have.
  if (intent === "upload-media") {
    const file = formData.get("file");
    if (!isUploadFile(file))
      return { ok: false as const, error: "Choose a JPG, PNG, or GIF image to upload." };
    if (!PERMITTED_UPLOAD_TYPES.has(file.type))
      return { ok: false as const, error: "This file type is not supported. Choose a JPG, PNG, or GIF image." };
    if (file.size > MAX_UPLOAD_BYTES)
      return { ok: false as const, error: "This image is bigger than the 20 MB limit, so it was not uploaded." };
    try {
      const bytes = Buffer.from(await file.arrayBuffer());
      const url = await uploadImageBufferToShopify(admin, {
        bytes,
        contentType: file.type,
        filename: file.name,
        alt: file.name.replace(/\.[^.]+$/, ""),
      });
      if (!url)
        return {
          ok: false as const,
          error: "The image could not be uploaded to Shopify. Please try again.",
        };
      return {
        ok: true as const,
        asset: { id: url, name: file.name, url, alt: file.name.replace(/\.[^.]+$/, ""), width: null, height: null },
      };
    } catch {
      return { ok: false as const, error: "The image could not be uploaded to Shopify. Please try again." };
    }
  }

  const campaignId = formData.get("campaignId");
  if (typeof campaignId !== "string" || !campaignId)
    return { ok: false as const, error: "Choose a valid campaign to edit." } satisfies SeamEditActionResult;

  const campaign = await loadOwnedCampaign(campaignId, session.shop);
  if (!campaign)
    return { ok: false as const, error: "This campaign could not be found." } satisfies SeamEditActionResult;
  const currentHtml = campaign.html;
  if (!currentHtml)
    return { ok: false as const, error: "This campaign has not been generated yet." } satisfies SeamEditActionResult;

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

    await db.campaign.update({
      where: { id: campaignId },
      data: { html: updatedHtml },
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

export default function CampaignSeamEditor() {
  const data = useLoaderData<LoaderData>();
  const [searchParams] = useSearchParams();

  if (!data.ok) {
    return (
      <main className="v9-editor">
        <div className="v9-topbar">
          <Link to="/app/campaigns" className="v9-topbar-back">← Back</Link>
        </div>
        <div style={{ padding: 32 }}>
          <p>{data.error}</p>
        </div>
      </main>
    );
  }

  return <SeamEditorWorkspace initial={data} campaignIdFromUrl={searchParams.get("id")} />;
}

type OkLoaderData = Extract<LoaderData, { ok: true }>;

function SeamEditorWorkspace({ initial }: { initial: OkLoaderData; campaignIdFromUrl: string | null }) {
  const fetcher = useFetcher<SeamEditActionResult>();
  const uploadFetcher = useFetcher<{ ok: boolean; asset?: MediaAsset; error?: string }>();

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
    // See app.brand-studio_.edit.tsx's identical handler: this canvas is
    // select-only, and preventDefault stops a real <a href> (a CTA or
    // product seam) from navigating the embedded iframe to a live URL,
    // which the destination site's clickjacking protection would then
    // refuse to render.
    event.stopPropagation();
    event.preventDefault();
    const target = event.target as HTMLElement;
    const seamEl = target.closest<HTMLElement>("[data-nomi-seam-key]");
    setSelectedSeamId(seamEl?.getAttribute("data-nomi-seam-key") ?? null);
  };

  const saveText = (text: string, url?: string) => {
    if (!selectedSeam || selectedSeam.kind !== "text") return;
    setSaveState("saving");
    fetcher.submit(
      { intent: "save-text", campaignId: initial.campaignId, seamId: selectedSeam.id, text, ...(url ? { url } : {}) },
      { method: "post" },
    );
  };

  const saveImage = (update: { src: string; alt: string; width: number; height: number; href?: string }) => {
    if (!selectedSeam || selectedSeam.kind === "text") return;
    setSaveState("saving");
    fetcher.submit(
      {
        intent: "save-image",
        campaignId: initial.campaignId,
        seamId: selectedSeam.id,
        src: update.src,
        alt: update.alt,
        width: String(update.width),
        height: String(update.height),
        ...(update.href ? { href: update.href } : {}),
      },
      { method: "post" },
    );
  };

  return (
    <main className="v9-editor">
      <div className="v9-topbar">
        <Link to="/app/campaigns" className="v9-topbar-back">← Back</Link>
        <div className="v9-topbar-divider" />
        <div className="v9-topbar-context">
          <span>Campaign</span>
          <span className="v9-topbar-slash">/</span>
          <strong>{initial.campaignName}</strong>
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
            <p>{initial.campaignName}</p>
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
  uploadFetcher,
  onSaveText,
  onSaveImage,
}: {
  seam: Seam | null;
  shopifyFiles: MediaAsset[];
  catalogProducts: CatalogProduct[];
  uploadFetcher: ReturnType<typeof useFetcher<{ ok: boolean; asset?: MediaAsset; error?: string }>>;
  onSaveText: (text: string, url?: string) => void;
  onSaveImage: (update: { src: string; alt: string; width: number; height: number; href?: string }) => void;
}) {
  if (!seam) {
    return (
      <aside className="v9-right-panel" aria-label="Seam editor">
        <div className="v9-empty-state">
          <div className="v9-empty-icon" aria-hidden="true">↖</div>
          <p>Select something to edit</p>
          <span>Click any text, button, or photo in the email.</span>
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
  uploadFetcher,
  onSave,
}: {
  seam: Extract<Seam, { kind: "logo" | "image" | "product" }>;
  shopifyFiles: MediaAsset[];
  catalogProducts: CatalogProduct[];
  uploadFetcher: ReturnType<typeof useFetcher<{ ok: boolean; asset?: MediaAsset; error?: string }>>;
  onSave: (update: { src: string; alt: string; width: number; height: number; href?: string }) => void;
}) {
  const showProductsTab = seam.kind === "product";
  type Tab = "shopify" | "products" | "upload";
  const [tab, setTab] = useState<Tab>(showProductsTab ? "products" : "shopify");
  const [pending, setPending] = useState<{
    src: string;
    alt: string;
    href?: string;
    width?: number | null;
    height?: number | null;
  } | null>(null);
  const uploading = uploadFetcher.state !== "idle";

  // Falls back to the seam's existing dimensions only when the newly picked
  // photo didn't come with its own — reusing the OLD photo's width/height
  // for a differently-shaped NEW photo would silently stretch or squash it
  // in the sent email.
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
    });
  };

  return (
    <aside className="v9-right-panel" aria-label="Seam editor">
      <div className="v9-panel">
      <div className="v9-panel-head">
        <div>
          <p className="v9-kicker">{seam.kind === "product" ? "Product" : "Image"}</p>
          <h3>Edit image</h3>
        </div>
      </div>
      <div className="v9-left-tabs">
        <button aria-selected={tab === "shopify"} onClick={() => setTab("shopify")}>Shopify files</button>
        {showProductsTab && (
          <button aria-selected={tab === "products"} onClick={() => setTab("products")}>Products</button>
        )}
        <button aria-selected={tab === "upload"} onClick={() => setTab("upload")}>Upload</button>
      </div>
      <div className="v9-panel-body">
        {tab === "shopify" && (
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
              {uploading ? "Uploading…" : "Choose image from computer"}
              <input
                type="file"
                accept="image/jpeg,image/png,image/gif"
                disabled={uploading}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const body = new FormData();
                  body.set("intent", "upload-media");
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
            {uploadFetcher.data && !uploadFetcher.data.ok && (
              <p className="v9-hint">{uploadFetcher.data.error}</p>
            )}
            <p className="v9-hint">JPG, PNG, or GIF, up to 20 MB.</p>
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
