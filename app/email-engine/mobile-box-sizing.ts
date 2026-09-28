// Mobile media queries often set a padded cell to width:100%, which in the
// default content-box model overflows the screen by its padding (seen as a
// horizontal scroll on phones and in the Flow Editor preview). Inside the
// mobile query only, border-box keeps every cell within the viewport;
// desktop layout is untouched. Idempotent, so it is safe to apply both when
// an email is generated and again whenever a stored email is read.
const RULE = "table,td,th,div{box-sizing:border-box !important;}";

export function hardenMobileBoxSizing(html: string): string {
  if (html.includes(RULE)) return html;
  return html.replace(/@media[^{]*max-width\s*:\s*\d+px[^{]*\{/i, (block) => `${block}${RULE}`);
}
