import type { LinksFunction, LoaderFunctionArgs } from "react-router";
import { data, useLoaderData } from "react-router";
import nomiStyles from "../styles/nomi.css?url";
import { getBrandStudioReviewPage } from "../brand-studio/review-fixture.server";
import { BrandStudioView } from "./app.brand-studio";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: `${nomiStyles}?v=brand-studio-20260916-23` }];

export const loader = ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const localHost =
    ["localhost", "127.0.0.1", "::1"].includes(url.hostname) ||
    /^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(url.hostname);
  if (process.env.NODE_ENV === "production" || !localHost) {
    throw data("Not found", { status: 404 });
  }
  return getBrandStudioReviewPage(
    url.searchParams.get("step") ?? "intent",
    url.searchParams.get("replay") === "1",
    url.searchParams.get("state") === "building",
    url.searchParams.get("evidence") === "stale"
      ? "refresh-needed"
      : "current",
  );
};

export default function BrandStudioReviewPage() {
  const page = useLoaderData<typeof loader>();
  return <BrandStudioView page={page} />;
}
