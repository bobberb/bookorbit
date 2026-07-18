import anyAscii from 'any-ascii';

// Transliterate non-ASCII text to the nearest readable ASCII for legacy e-readers
// that cannot render Unicode (e.g. "Cortazar", "Emile", CJK -> romaji). any-ascii
// leaves ASCII input untouched; the trailing strip removes anything it could not map
// so the XML never carries surviving non-ASCII. Must run BEFORE esc() so the raw
// (un-escaped) string is transliterated.
export function encodeText(s: string | null | undefined, asciiOnly: boolean): string {
  if (!s || !asciiOnly) return s ?? '';
  // eslint-disable-next-line no-control-regex -- strip any residual non-ASCII any-ascii left unmapped
  return anyAscii(s).replace(/[^\x00-\x7F]/g, '');
}

// Code points the XML 1.0 Char production forbids: C0 controls except tab/LF/CR
// and the noncharacters U+FFFE/U+FFFF. Ebook metadata extracted from EPUB/PDF/MOBI
// often carries these; leaving them in produces a not-well-formed feed that lenient
// OPDS clients mis-parse, shifting entry boundaries onto the wrong acquisition link.
// eslint-disable-next-line no-control-regex -- matching these control characters is the intent
const XML_INVALID_CHARS = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\uFFFE\\uFFFF]', 'g');

// Unpaired surrogates are also illegal in XML 1.0 (the surrogate range is excluded
// from the Char production) and appear in metadata mis-decoded from UTF-16. Valid
// surrogate pairs (astral characters such as emoji) must be left intact.
const LONE_SURROGATES = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function esc(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .replace(XML_INVALID_CHARS, '')
    .replace(LONE_SURROGATES, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function xmlEl(tag: string, text: string | null | undefined): string {
  return `<${tag}>${esc(text)}</${tag}>`;
}

export function xmlLink(rel: string, href: string, type: string, title?: string): string {
  const t = title ? ` title="${esc(title)}"` : '';
  return `<link rel="${esc(rel)}" href="${esc(href)}" type="${esc(type)}"${t}/>`;
}

export function xmlFacetLink(href: string, title: string, group: string, active: boolean): string {
  const activeAttr = active ? ' opds:activeFacet="true"' : '';
  return `<link rel="http://opds-spec.org/facet" href="${esc(href)}" type="${esc(OPDS_MIME_ACQ)}" title="${esc(title)}" opds:facetGroup="${esc(group)}"${activeAttr}/>`;
}

export function fileMimeType(format: string): string {
  switch (format.toLowerCase()) {
    case 'epub':
      return 'application/epub+zip';
    case 'pdf':
      return 'application/pdf';
    case 'mobi':
      return 'application/x-mobipocket-ebook';
    case 'azw3':
      return 'application/vnd.amazon.ebook';
    case 'fb2':
      return 'application/x-fictionbook+xml';
    case 'cbz':
      return 'application/vnd.comicbook+zip';
    case 'cbr':
      return 'application/vnd.comicbook-rar';
    default:
      return 'application/octet-stream';
  }
}

export const OPDS_MIME_NAV = 'application/atom+xml;profile=opds-catalog;kind=navigation';
export const OPDS_MIME_ACQ = 'application/atom+xml;profile=opds-catalog;kind=acquisition';
export const OPDS_MIME_SEARCH = 'application/opensearchdescription+xml';
