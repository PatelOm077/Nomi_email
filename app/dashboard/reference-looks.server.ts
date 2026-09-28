// The Templates route (app.additional.tsx, with the Gauge and Denizen
// reference looks) and the template editor are hidden from the deployed app
// but kept in the codebase. Visible in local dev; in production only when
// NOMI_TEMPLATES=on.
export function templatesEnabled(): boolean {
  // eslint-disable-next-line no-undef
  if (process.env.NOMI_TEMPLATES === "on") return true;
  // eslint-disable-next-line no-undef
  return process.env.NODE_ENV !== "production";
}
