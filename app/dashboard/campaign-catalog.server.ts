// Live product/collection search and lookup for the Campaigns picker UI.
// Separate from dashboard-data.server.ts's full-catalogue loader: these are
// small, query-filtered requests driven by what the merchant types (or a
// specific id/collection the merchant picked), not a paginated mirror of
// the whole catalogue.

// Structural typing on purpose — see dashboard-data.server.ts for why.
export interface GraphqlAdmin {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
}

export interface CampaignCatalogProduct {
  id: string;
  title: string;
  imageUrl: string | null;
  price: string;
  productUrl: string | null;
  // Only loaded for generation (loadCampaignProductsByIds /
  // loadCampaignCollectionProducts), never for picker search: what the
  // product actually is, so the model doesn't guess from a bare title like
  // "Canopy" or "Loam".
  productType?: string | null;
  description?: string | null;
}

export interface CampaignCatalogCollection {
  id: string;
  title: string;
}

export interface ShopifyMediaFile {
  id: string;
  name: string;
  url: string;
  alt: string;
  width: number | null;
  height: number | null;
}

// Shopify's search syntax treats quotes, asterisks, and colons specially —
// strip them so a merchant's search term can't break out of the
// `title:*term*` wrapper or accidentally target another field.
function sanitizeSearchTerm(term: string): string {
  return term.replace(/["*:\\]/g, "").trim().slice(0, 60);
}

type ProductNode = {
  id: string;
  title: string;
  onlineStoreUrl: string | null;
  featuredMedia: {
    preview: { image: { url: string; altText: string | null } | null } | null;
  } | null;
  priceRangeV2: {
    minVariantPrice: { amount: string; currencyCode: string };
  } | null;
  productType?: string | null;
  description?: string | null;
};

// Enough of the merchant's own description to know what the product is and
// what it does, without flooding the prompt.
const DESCRIPTION_LIMIT = 400;

function mapProductNode(node: ProductNode): CampaignCatalogProduct {
  return {
    id: node.id,
    title: node.title,
    imageUrl: node.featuredMedia?.preview?.image?.url ?? null,
    price: node.priceRangeV2?.minVariantPrice
      ? formatPrice(node.priceRangeV2.minVariantPrice.amount, node.priceRangeV2.minVariantPrice.currencyCode)
      : "",
    productUrl: node.onlineStoreUrl ?? null,
    ...(node.productType !== undefined ? { productType: node.productType?.trim() || null } : {}),
    ...(node.description !== undefined
      ? { description: node.description?.trim().slice(0, DESCRIPTION_LIMIT) || null }
      : {}),
  };
}

const PRODUCT_FIELDS = `
  id
  title
  onlineStoreUrl
  featuredMedia { preview { image { url altText } } }
  priceRangeV2 { minVariantPrice { amount currencyCode } }
`;

const GENERATION_PRODUCT_FIELDS = `
  ${PRODUCT_FIELDS}
  productType
  description
`;

const SEARCH_PRODUCTS_QUERY = `#graphql
  query CampaignSearchProducts($query: String, $sortKey: ProductSortKeys, $reverse: Boolean) {
    products(first: 8, query: $query, sortKey: $sortKey, reverse: $reverse) {
      nodes { ${PRODUCT_FIELDS} }
    }
  }
`;

/** Live product search for the campaign picker, real store data only. An
 * empty term returns a default browse list (most recently updated first)
 * so the picker has something to show before the merchant types. */
export async function searchCampaignProducts(
  admin: GraphqlAdmin,
  term: string,
): Promise<CampaignCatalogProduct[]> {
  const clean = sanitizeSearchTerm(term);
  const response = await admin.graphql(SEARCH_PRODUCTS_QUERY, {
    variables: clean
      ? { query: `title:*${clean}* status:active`, sortKey: "RELEVANCE", reverse: false }
      : { query: "status:active", sortKey: "UPDATED_AT", reverse: true },
  });
  const { data } = (await response.json()) as {
    data?: { products?: { nodes?: ProductNode[] } };
  };
  return (data?.products?.nodes ?? []).map(mapProductNode);
}

const SEARCH_COLLECTIONS_QUERY = `#graphql
  query CampaignSearchCollections($query: String, $sortKey: CollectionSortKeys, $reverse: Boolean) {
    collections(first: 8, query: $query, sortKey: $sortKey, reverse: $reverse) {
      nodes { id title }
    }
  }
`;

/** Live collection search for the campaign picker, real store data only. */
export async function searchCampaignCollections(
  admin: GraphqlAdmin,
  term: string,
): Promise<CampaignCatalogCollection[]> {
  const clean = sanitizeSearchTerm(term);
  const response = await admin.graphql(SEARCH_COLLECTIONS_QUERY, {
    variables: clean
      ? { query: `title:*${clean}*`, sortKey: "RELEVANCE", reverse: false }
      : { query: null, sortKey: "TITLE", reverse: false },
  });
  const { data } = (await response.json()) as {
    data?: { collections?: { nodes?: CampaignCatalogCollection[] } };
  };
  return data?.collections?.nodes ?? [];
}

const PRODUCTS_BY_ID_QUERY = `#graphql
  query CampaignProductsByIds($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product { ${GENERATION_PRODUCT_FIELDS} }
    }
  }
`;

/** Re-fetches the merchant's picked products by id at generation time, so
 * the email is built from the store's current title/price/image rather
 * than trusting whatever the client last had in memory. */
export async function loadCampaignProductsByIds(
  admin: GraphqlAdmin,
  ids: string[],
): Promise<CampaignCatalogProduct[]> {
  if (!ids.length) return [];
  const response = await admin.graphql(PRODUCTS_BY_ID_QUERY, { variables: { ids } });
  const { data } = (await response.json()) as {
    data?: { nodes?: (ProductNode | null)[] };
  };
  return (data?.nodes ?? [])
    .filter((node): node is ProductNode => Boolean(node))
    .map(mapProductNode);
}

const COLLECTION_PRODUCTS_QUERY = `#graphql
  query CampaignCollectionProducts($id: ID!) {
    collection(id: $id) {
      title
      products(first: 3) { nodes { ${GENERATION_PRODUCT_FIELDS} } }
    }
  }
`;

/** A merchant-picked collection isn't itself something to feature in an
 * email — its real products are. Pulls up to three real products from the
 * chosen collection to hand the generator as supporting material. */
export async function loadCampaignCollectionProducts(
  admin: GraphqlAdmin,
  collectionId: string,
): Promise<{ title: string; products: CampaignCatalogProduct[] } | null> {
  const response = await admin.graphql(COLLECTION_PRODUCTS_QUERY, {
    variables: { id: collectionId },
  });
  const { data } = (await response.json()) as {
    data?: { collection?: { title: string; products?: { nodes?: ProductNode[] } } | null };
  };
  if (!data?.collection) return null;
  return {
    title: data.collection.title,
    products: (data.collection.products?.nodes ?? []).map(mapProductNode),
  };
}

const STORE_LINKS_QUERY = `#graphql
  query CampaignNavCollections {
    collections(first: 6, sortKey: UPDATED_AT, reverse: true, query: "published_status:published") {
      nodes { id title handle productsCount { count } }
    }
    shop { primaryDomain { url } }
  }
`;

/** Real destinations for campaign buttons beyond product pages: the
 * storefront homepage and up to four published, non-empty collections.
 * Collection has no onlineStoreUrl field, so its page URL is the primary
 * domain plus /collections/<handle> — Shopify's fixed storefront route.
 * Best-effort: any failure returns no links and the email omits buttons
 * that would need them. */
export async function loadCampaignStoreLinks(
  admin: GraphqlAdmin,
): Promise<{ storefrontUrl: string | null; collections: Array<{ title: string; url: string }> }> {
  try {
    const response = await admin.graphql(STORE_LINKS_QUERY);
    const { data } = (await response.json()) as {
      data?: {
        collections?: {
          nodes?: Array<{ title: string; handle: string; productsCount?: { count: number } | null }>;
        };
        shop?: { primaryDomain?: { url: string } | null };
      };
    };
    const base = data?.shop?.primaryDomain?.url?.replace(/\/+$/, "") ?? null;
    if (!base) return { storefrontUrl: null, collections: [] };
    const collections = (data?.collections?.nodes ?? [])
      .filter((node) => node.handle && (node.productsCount?.count ?? 0) > 0)
      .slice(0, 4)
      .map((node) => ({ title: node.title, url: `${base}/collections/${node.handle}` }));
    return { storefrontUrl: base, collections };
  } catch (error) {
    console.error("Campaign store links lookup failed:", error);
    return { storefrontUrl: null, collections: [] };
  }
}

const SHOPIFY_MEDIA_FILES_QUERY = `#graphql
  query CampaignShopifyMediaFiles {
    files(first: 24, query: "media_type:IMAGE") {
      nodes { ... on MediaImage { id alt image { url altText width height } } }
    }
  }
`;

/** Browses the shop's uploaded Shopify Files (images only) for the Campaigns
 * seam editor's "Shopify files" tab — the same source app.brand-studio_.edit.tsx
 * offers, so a merchant swapping a campaign's photo isn't limited to the
 * catalogue's product images. */
export async function searchCampaignShopifyFiles(
  admin: GraphqlAdmin,
): Promise<ShopifyMediaFile[]> {
  const response = await admin.graphql(SHOPIFY_MEDIA_FILES_QUERY);
  const { data } = (await response.json()) as {
    data?: {
      files?: {
        nodes?: Array<{
          id: string;
          alt?: string | null;
          image?: { url: string; altText?: string | null; width?: number | null; height?: number | null } | null;
        }>;
      };
    };
  };
  return (data?.files?.nodes ?? []).flatMap((file) =>
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
}

// Hosts a raw image buffer (a background-removal cutout — see
// app/email-engine/background-removal.ts) on the shop's own Shopify CDN, so
// it has a real public URL an email client can load. Same
// stagedUploadsCreate → upload → fileCreate flow app.brand-studio_.edit.tsx
// and app.template-editor.tsx use for a merchant's uploaded File, adapted for
// server-generated bytes instead of a browser file. Best-effort: returns
// null on any failure so the caller can fall back to the product's real
// photo rather than fail campaign generation over a missing cutout.
export async function uploadImageBufferToShopify(
  admin: GraphqlAdmin,
  input: {
    bytes: Buffer;
    contentType: string;
    filename: string;
    alt: string;
    // How long to poll for the CDN URL when fileCreate returns before
    // Shopify has finished processing. 0 keeps the original behavior of
    // treating a not-yet-ready file as a failure.
    waitForReadyMs?: number;
  },
): Promise<string | null> {
  try {
    const stagedResponse = await admin.graphql(
      `#graphql
      mutation NomiStageCutoutImage($input: [StagedUploadInput!]!) {
        stagedUploadsCreate(input: $input) {
          stagedTargets { url resourceUrl parameters { name value } }
          userErrors { message }
        }
      }`,
      {
        variables: {
          input: [
            {
              filename: input.filename,
              mimeType: input.contentType,
              resource: "FILE",
              httpMethod: "POST",
              fileSize: String(input.bytes.byteLength),
            },
          ],
        },
      },
    );
    const staged = (await stagedResponse.json()) as {
      data?: {
        stagedUploadsCreate?: {
          stagedTargets?: Array<{
            url: string;
            resourceUrl: string;
            parameters: Array<{ name: string; value: string }>;
          }>;
        };
      };
    };
    const stagedTarget = staged.data?.stagedUploadsCreate?.stagedTargets?.[0];
    if (!stagedTarget) return null;

    const uploadBody = new FormData();
    stagedTarget.parameters.forEach((parameter) =>
      uploadBody.append(parameter.name, parameter.value),
    );
    uploadBody.append(
      "file",
      new Blob([new Uint8Array(input.bytes)], { type: input.contentType }),
      input.filename,
    );
    const uploaded = await fetch(stagedTarget.url, {
      method: "POST",
      body: uploadBody,
    });
    if (!uploaded.ok) return null;

    const createdResponse = await admin.graphql(
      `#graphql
      mutation NomiCreateCutoutImage($files: [FileCreateInput!]!) {
        fileCreate(files: $files) {
          files { ... on MediaImage { id fileStatus image { url } } }
          userErrors { message }
        }
      }`,
      {
        variables: {
          files: [
            { contentType: "IMAGE", originalSource: stagedTarget.resourceUrl, alt: input.alt },
          ],
        },
      },
    );
    const created = (await createdResponse.json()) as {
      data?: {
        fileCreate?: {
          files?: Array<{ id?: string; fileStatus?: string | null; image?: { url: string } | null }>;
        };
      };
    };
    const file = created.data?.fileCreate?.files?.[0];
    if (!file || file.fileStatus === "FAILED") return null;
    // fileCreate can return before Shopify's CDN has finished processing —
    // no image.url yet. By default a not-yet-ready image is treated the same
    // as a failed one (a cutout's caller falls back to the real photo). A
    // generated photo has no fallback, so its caller passes waitForReadyMs
    // and this polls until the file is READY or the wait runs out.
    if (file.image?.url) return file.image.url;
    const waitMs = input.waitForReadyMs ?? 0;
    if (!file.id || waitMs <= 0) return null;
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const polled = await admin.graphql(
        `#graphql
        query NomiUploadedImageStatus($id: ID!) {
          node(id: $id) { ... on MediaImage { fileStatus image { url } } }
        }`,
        { variables: { id: file.id } },
      );
      const node = ((await polled.json()) as {
        data?: { node?: { fileStatus?: string | null; image?: { url: string } | null } | null };
      }).data?.node;
      if (node?.fileStatus === "FAILED") return null;
      if (node?.image?.url) return node.image.url;
    }
    return null;
  } catch {
    return null;
  }
}

// "$52.00" / "€52.00", not the raw "USD 52.0" Shopify's amount string gives.
export function formatPrice(amount: string, currencyCode: string): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) return `${currencyCode} ${amount}`;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currencyCode }).format(value);
  } catch {
    return `${currencyCode} ${value.toFixed(2)}`;
  }
}
