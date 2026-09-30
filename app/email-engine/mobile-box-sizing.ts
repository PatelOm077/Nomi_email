// Mobile media queries often set a padded cell to width:100%, which in the
// default content-box model overflows the screen by its padding (seen as a
// horizontal scroll on phones and in the Flow Editor preview). Inside the
// mobile query only, border-box keeps every cell within the viewport;
// desktop layout is untouched. Idempotent, so it is safe to apply both when
// an email is generated and again whenever a stored email is read.
const RULE = "table,td,th,div{box-sizing:border-box !important;}";

export function hardenMobileBoxSizing(html: string): string {
  const fluid = fluidFixedWidthTables(html);
  if (fluid.includes(RULE)) return fluid;
  return fluid.replace(/@media[^{]*max-width\s*:\s*\d+px[^{]*\{/i, (block) => `${block}${RULE}`);
}

// A container written as <table width="600" style="max-width:600px"> stays
// 600px wide on a phone: max-width can't shrink below a fixed width
// attribute. Giving it width:100% in its style (max-width still caps it at
// 600) lets it fit the screen, the same as the rest of the family.
function fluidFixedWidthTables(html: string): string {
  return html.replace(/<table\b[^>]*>/gi, (tag) => {
    const width = Number(tag.match(/\swidth=["']?(\d+)(?=["'\s>])/i)?.[1] ?? 0);
    if (width < 320) return tag;
    const style = tag.match(/\sstyle=(["'])(.*?)\1/i);
    if (style && /(^|;)\s*width\s*:/i.test(style[2])) return tag;
    if (style) return tag.replace(style[0], ` style=${style[1]}width:100%;${style[2]}${style[1]}`);
    return tag.replace(/<table\b/i, `<table style="width:100%;max-width:${width}px;"`);
  });
}
