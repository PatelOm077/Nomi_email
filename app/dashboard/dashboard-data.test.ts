import { describe, expect, it, vi } from "vitest";
import { loadDashboardCatalog } from "./dashboard-data.server";

function catalogResponse(
  nodes: Array<{
    id: string;
    title: string;
    imageUrl?: string | null;
    altText?: string | null;
  }>,
  pageInfo: { hasNextPage: boolean; endCursor: string | null },
) {
  return new Response(
    JSON.stringify({
      data: {
        shop: { name: "Nomi development store" },
        products: {
          nodes: nodes.map((node) => ({
            id: node.id,
            title: node.title,
            onlineStoreUrl: `https://example.test/products/${node.title.toLowerCase()}`,
            featuredMedia: node.imageUrl === null
              ? null
              : {
                  preview: {
                    image: {
                      url: node.imageUrl,
                      altText: node.altText ?? null,
                    },
                  },
                },
            priceRangeV2: {
              minVariantPrice: { amount: "42.00", currencyCode: "USD" },
            },
          })),
          pageInfo,
        },
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("loadDashboardCatalog", () => {
  it("loads every active product page and preserves Shopify featured images", async () => {
    const graphql = vi
      .fn()
      .mockResolvedValueOnce(
        catalogResponse(
          [
            {
              id: "gid://shopify/Product/1",
              title: "Loam",
              imageUrl: "https://cdn.shopify.com/loam.png",
              altText: "Loam comfort cream",
            },
          ],
          { hasNextPage: true, endCursor: "page-2" },
        ),
      )
      .mockResolvedValueOnce(
        catalogResponse(
          [
            {
              id: "gid://shopify/Product/2",
              title: "Peat",
              imageUrl: "https://cdn.shopify.com/peat.png",
            },
            {
              id: "gid://shopify/Product/3",
              title: "Image-free product",
              imageUrl: null,
            },
          ],
          { hasNextPage: false, endCursor: null },
        ),
      );

    const result = await loadDashboardCatalog({ graphql });

    expect(graphql).toHaveBeenNthCalledWith(1, expect.any(String), {
      variables: { after: null },
    });
    expect(graphql).toHaveBeenNthCalledWith(2, expect.any(String), {
      variables: { after: "page-2" },
    });
    expect(result.products).toHaveLength(3);
    expect(result.products[0]).toMatchObject({
      title: "Loam",
      imageUrl: "https://cdn.shopify.com/loam.png",
      imageAlt: "Loam comfort cream",
    });
    expect(result.products[1]).toMatchObject({
      title: "Peat",
      imageUrl: "https://cdn.shopify.com/peat.png",
      imageAlt: "Peat",
    });
    expect(result.products[2]).toMatchObject({
      title: "Image-free product",
      imageUrl: null,
      imageAlt: "Image-free product",
    });
  });
});
