// Lets the campaign designer write the email while its photos are still
// rendering. Each planned photo gets a placeholder src the designer uses
// verbatim; once the photo has been generated, reviewed, and hosted, the
// placeholder is swapped for the real URL. A photo that didn't survive has
// its <img> removed, so a failed render costs one picture, never the email.
// Platform-neutral: plain string work, no Shopify imports.

// The .invalid TLD is reserved (RFC 2606) and can never resolve, so a
// placeholder that somehow survives is inert rather than a live request.
const PLACEHOLDER_HOST = "pending-photo.nomi.invalid";

export function generatedPhotoPlaceholder(key: string): string {
  return `https://${PLACEHOLDER_HOST}/${encodeURIComponent(key)}.jpg`;
}

const IMG_TAG = /<img\b[^>]*>/gi;

export function resolveGeneratedPhotoPlaceholders(
  html: string,
  // key → hosted URL, or null when the photo failed generation or review.
  resolved: Map<string, string | null>,
): { html: string; placed: string[]; removed: string[] } {
  const placed: string[] = [];
  const removed: string[] = [];
  const output = html.replace(IMG_TAG, (tag) => {
    if (!tag.includes(PLACEHOLDER_HOST)) return tag;
    const key = [...resolved.keys()].find((candidate) => tag.includes(generatedPhotoPlaceholder(candidate)));
    const url = key ? resolved.get(key) : null;
    if (key && url) {
      placed.push(key);
      const swapped = tag.split(generatedPhotoPlaceholder(key)).join(url);
      // Every generated photo must stay swappable in the seam editor, even
      // if the designer forgot its seam tag.
      return /\bdata-nomi-seam=/i.test(swapped)
        ? swapped
        : swapped.replace(/^<img\b/i, '<img data-nomi-seam="image"');
    }
    // Unknown key (the designer altered the placeholder) or a failed photo:
    // drop the tag rather than ship a broken image.
    removed.push(key ?? "unknown");
    return "";
  });
  return { html: output, placed, removed };
}
