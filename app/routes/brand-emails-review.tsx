import type { LinksFunction, LoaderFunctionArgs } from "react-router";
import { data, useLoaderData } from "react-router";
import {
  auditCompiledEmail,
  auditEmailFamily,
} from "../brand-studio/email-quality";
import {
  brandEvidenceSchema,
  brandSystemSchema,
  lifecycleRecipesSchema,
  renderedEmailsSchema,
  safeJson,
} from "../brand-studio/types";
import db from "../db.server";
import { GeneratedBrandEmailSelection } from "./app.additional";
import nomiStyles from "../styles/nomi.css?url";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: `${nomiStyles}?v=brand-email-proof-20260915-2` },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  if (!["localhost", "127.0.0.1"].includes(url.hostname))
    throw data("Not found", { status: 404 });
  const stored = await db.brandStudioProfile.findFirst({
    where: { status: "complete" },
    orderBy: { completedAt: "desc" },
    select: {
      evidence: true,
      brandSystem: true,
      lifecycleRecipes: true,
      renderedEmails: true,
    },
  });
  if (!stored) throw data("Build a Brand Studio email family first.", { status: 404 });
  const evidence = brandEvidenceSchema.parse(JSON.parse(stored.evidence));
  const brand = brandSystemSchema.parse(JSON.parse(stored.brandSystem));
  const recipes = lifecycleRecipesSchema.parse(JSON.parse(stored.lifecycleRecipes));
  const rendered = safeJson(stored.renderedEmails, renderedEmailsSchema, {});
  const emails = recipes.flatMap((recipe) => {
    const html = rendered[recipe.id];
    if (!html) return [];
    return [{
      recipe,
      html,
      quality: auditCompiledEmail({
        html,
        recipe,
        brandSystem: brand,
        products: evidence.products,
        storefrontUrl: evidence.storefrontUrl,
      }),
    }];
  });
  if (emails.length !== recipes.length)
    throw data("The latest family is incomplete. Rebuild it in Brand Studio.", { status: 409 });
  return {
    brand,
    emails,
    familyQuality: auditEmailFamily({ brandSystem: brand, emails }),
  };
};

export default function BrandEmailsReviewPage() {
  const page = useLoaderData<typeof loader>();
  return (
    <GeneratedBrandEmailSelection
      brand={page.brand}
      emails={page.emails}
      familyQuality={page.familyQuality}
    />
  );
}
