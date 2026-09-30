// The From line on every Nomi email — what the Sending domain page previews:
// the merchant's sender name at hello@ their verified domain. Until a domain
// is verified, Nomi's own address sends it, still under the store's name so
// customers recognize who it's from.
export function fromHeader({
  senderName,
  verifiedDomain,
  fallbackName,
  fallbackEmail,
}: {
  senderName: string | null | undefined;
  verifiedDomain: string | null | undefined;
  fallbackName: string;
  fallbackEmail: string;
}): string {
  const name = (senderName ?? "").replace(/["<>\\\r\n]/g, "").replace(/\s+/g, " ").trim() || fallbackName;
  const address = verifiedDomain ? `hello@${verifiedDomain}` : fallbackEmail;
  // Names with commas, dots, ampersands etc. must be quoted (RFC 5322).
  return `${/^[\w '-]+$/.test(name) ? name : `"${name}"`} <${address}>`;
}
