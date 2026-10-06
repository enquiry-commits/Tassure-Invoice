// Text in HTTP headers. Header values must be Latin-1 (WebIDL ByteString):
// `new Response()` throws a TypeError for any character above U+00FF, so a
// name built from a client's name — "SOA - 思店科技(杭州)有限公司 -
// 2026-10-05.pdf" — crashed the route at its very last line, after all the
// work, and staff just saw a red download badge. That is how the SOA PDF for
// Chinese-named clients failed from the day it shipped until 2026-10-05
// (docs/INVARIANTS.md INV-DOC-022). Every Content-Disposition goes through
// attachmentDisposition(): an ASCII `filename` for old clients plus the
// RFC 6266 / RFC 5987 `filename*` carrying the real UTF-8 name, which every
// current browser prefers. Free text in a custom X-* header (error details)
// goes through headerDetail(). Pure — also used by client components.

// Lone UTF-16 surrogates (half of an emoji or of a rare Chinese character,
// e.g. from cutting a string at a fixed length) make encodeURIComponent throw
// URIError — the same "crash on the last line" as the ByteString TypeError.
export function wellFormed(s: string): string {
  return Array.from(s, ch => (ch.length === 1 && ch >= '\uD800' && ch <= '\uDFFF' ? '\uFFFD' : ch)).join('');
}

export function attachmentDisposition(fileName: string): string {
  const name = wellFormed(fileName);
  const ascii = name
    .normalize('NFKD') // full-width （） → (); é → e + a combining accent, which becomes _ below ("Café" → "Cafe_")
    .replace(/[^\x20-\x7e]+/g, '_')
    .replace(/["\\]/g, "'")
    .trim() || 'download';
  // encodeURIComponent leaves ' ( ) * unescaped; RFC 5987 doesn't allow them.
  const utf8 = encodeURIComponent(name).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

// Free text for a custom X-* response header (failure details staff are
// shown): URI-encoded, cut by whole characters — never through a surrogate
// pair — and bounded in encoded size (a Chinese character encodes to 9).
// Read it back with decodeURIComponent.
export function headerDetail(text: string, maxChars = 1500, maxEncoded = 6000): string {
  let chars = Array.from(wellFormed(text)).slice(0, maxChars);
  let encoded = encodeURIComponent(chars.join(''));
  while (encoded.length > maxEncoded && chars.length > 1) {
    chars = chars.slice(0, Math.floor(chars.length * 0.8));
    encoded = encodeURIComponent(chars.join(''));
  }
  return encoded;
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
