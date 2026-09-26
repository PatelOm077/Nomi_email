// Shared ErrorBoundary body for every app.* route. Tries Shopify's own
// boundary.error() first — that's what turns a thrown reauth Response into
// the redirect it needs to be, and it must keep doing that unchanged. It
// only throws back out for errors it doesn't recognize (a plain JS
// exception), which is the only case this component's own catch handles
// with a Nomi-styled recovery screen instead of a blank crash page.
import { useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

export function NomiRouteErrorBoundary() {
  const error = useRouteError();

  try {
    return boundary.error(error);
  } catch {
    return (
      <main className="nomi-route-error" role="alert">
        <div className="nomi-route-error-card">
          <span className="nomi-route-error-mark" aria-hidden="true">!</span>
          <h1>Something went wrong</h1>
          <p>This page hit an unexpected error. Reloading usually fixes it.</p>
          <button type="button" onClick={() => window.location.reload()}>
            Reload page
          </button>
        </div>
      </main>
    );
  }
}
