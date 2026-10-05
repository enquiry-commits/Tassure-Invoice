// Download names in HTTP headers. Header values must be Latin-1 (WebIDL
// ByteString): `new Response()` throws a TypeError for any character above
// U+00FF, so a name built from a client's name — "SOA - 思店科技(杭州)有限公司
// - 2026-10-05.pdf" — crashed the route at its very last line, after all the
// work, and staff just saw a red download badge. That is how the SOA PDF for
// Chinese-named clients failed from the day it shipped until 2026-10-05
// (docs/INVARIANTS.md INV-DOC-022). Every Content-Disposition goes through
// attachmentDisposition(): an ASCII `filename` for old clients plus the
// RFC 6266 / RFC 5987 `filename*` carrying the real UTF-8 name, which every
// current browser prefers. Pure — also used by client components.

export function attachmentDisposition(fileName: string): string {
  const ascii = fileName
    .normalize('NFKD') // full-width （） → (), é → e + accent (dropped below)
    .replace(/[^\x20-\x7e]+/g, '_')
    .replace(/["\\]/g, "'")
    .trim() || 'download';
  // encodeURIComponent leaves ' ( ) * unescaped; RFC 5987 doesn't allow them.
  const utf8 = encodeURIComponent(fileName).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

// The download name a Content-Disposition carries — the UTF-8 `filename*`
// when present, else the plain `filename`.
export function filenameFromDisposition(disposition: string | null | undefined): string | null {
  if (!disposition) return null;
  const star = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(disposition);
  if (star) {
    try { return decodeURIComponent(star[1].trim()); } catch { /* malformed — use the plain name */ }
  }
  const plain = /filename\s*=\s*"([^"]*)"/i.exec(disposition) ?? /filename\s*=\s*([^;]+)/i.exec(disposition);
  return plain ? plain[1].trim() || null : null;
}
