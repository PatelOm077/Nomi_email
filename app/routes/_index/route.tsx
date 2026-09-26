import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  // Shopify can open an embedded app through its configured root URL. The
  // template's old public login page was still mounted there, which made the
  // app appear to lose its navigation. Nomi has one entry point: /app.
  throw redirect(`/app${url.search}`);
};

export default function AppEntry() {
  return null;
}
