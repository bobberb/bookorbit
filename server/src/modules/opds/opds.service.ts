import { Injectable } from '@nestjs/common';

import { encodeText, esc, fileMimeType, OPDS_MIME_ACQ, OPDS_MIME_NAV, OPDS_MIME_SEARCH, xmlEl, xmlFacetLink, xmlLink } from './opds-xml.helpers';
import type { OpdsBookEntry, OpdsSortOrder } from './opds-book.service';
import { OPDS_FACET_SORTS } from './opds-sort.helpers';

const BASE = '/api/v1/opds';

@Injectable()
export class OpdsService {
  generateRootNavigation(): string {
    const now = new Date().toISOString();
    return this.wrapFeed(
      'bookorbit OPDS Catalog',
      'urn:bookorbit:root',
      now,
      [xmlLink('self', BASE, OPDS_MIME_NAV), xmlLink('start', BASE, OPDS_MIME_NAV), xmlLink('search', `${BASE}/search.opds`, OPDS_MIME_SEARCH)],
      [
        this.navEntry('urn:bookorbit:all', 'All Books', 'Browse the full catalog', `${BASE}/catalog`, now),
        this.navEntry('urn:bookorbit:recent', 'Recent Books', 'Recently added books', `${BASE}/recent`, now),
        this.navEntry('urn:bookorbit:surprise', 'Random Books', '25 random picks', `${BASE}/surprise`, now),
        this.navEntry('urn:bookorbit:libraries', 'Libraries', 'Browse by library', `${BASE}/libraries`, now),
        this.navEntry('urn:bookorbit:collections', 'Collections', 'Browse your collections', `${BASE}/collections`, now),
        this.navEntry('urn:bookorbit:smartScopes', 'SmartScopes', 'Browse your smartScopes', `${BASE}/smart-scopes`, now),
        this.navEntry('urn:bookorbit:authors', 'Authors', 'Browse by author', `${BASE}/authors`, now),
        this.navEntry('urn:bookorbit:series', 'Series', 'Browse by series', `${BASE}/series`, now),
      ],
    );
  }

  generateLibrariesNavigation(libs: { id: number; name: string; bookCount: number }[]): string {
    const now = new Date().toISOString();
    const entries = libs.map((lib) =>
      this.navEntry(`urn:bookorbit:library:${lib.id}`, lib.name, `${lib.bookCount} books`, `${BASE}/catalog?libraryId=${lib.id}`, now),
    );
    return this.wrapFeed('Libraries', 'urn:bookorbit:libraries', now, [xmlLink('self', `${BASE}/libraries`, OPDS_MIME_NAV)], entries);
  }

  generateCollectionsNavigation(cols: { id: number; name: string; bookCount: number }[]): string {
    const now = new Date().toISOString();
    const entries = cols.map((col) =>
      this.navEntry(`urn:bookorbit:collection:${col.id}`, col.name, `${col.bookCount} books`, `${BASE}/catalog?collectionId=${col.id}`, now),
    );
    return this.wrapFeed('Collections', 'urn:bookorbit:collections', now, [xmlLink('self', `${BASE}/collections`, OPDS_MIME_NAV)], entries);
  }

  generateSmartScopesNavigation(items: { id: number; name: string; icon: string | null }[]): string {
    const now = new Date().toISOString();
    const entries = items.map((smartScope) =>
      this.navEntry(
        `urn:bookorbit:smartScope:${smartScope.id}`,
        smartScope.name,
        'Dynamic smartScope',
        `${BASE}/catalog?smartScopeId=${smartScope.id}`,
        now,
      ),
    );
    return this.wrapFeed('SmartScopes', 'urn:bookorbit:smartScopes', now, [xmlLink('self', `${BASE}/smart-scopes`, OPDS_MIME_NAV)], entries);
  }

  generateAuthorsNavigation(items: { name: string; bookCount: number }[]): string {
    const now = new Date().toISOString();
    const entries = items.map((a) =>
      this.navEntry(
        `urn:bookorbit:author:${encodeURIComponent(a.name)}`,
        a.name,
        `${a.bookCount} books`,
        `${BASE}/catalog?author=${encodeURIComponent(a.name)}`,
        now,
      ),
    );
    return this.wrapFeed('Authors', 'urn:bookorbit:authors', now, [xmlLink('self', `${BASE}/authors`, OPDS_MIME_NAV)], entries);
  }

  generateSeriesNavigation(items: { id?: number; name: string; bookCount: number }[]): string {
    const now = new Date().toISOString();
    const entries = items.map((s) =>
      this.navEntry(
        `urn:bookorbit:series:${s.id ?? encodeURIComponent(s.name)}`,
        s.name,
        `${s.bookCount} books`,
        s.id != null ? `${BASE}/catalog?seriesId=${s.id}` : `${BASE}/catalog?series=${encodeURIComponent(s.name)}`,
        now,
      ),
    );
    return this.wrapFeed('Series', 'urn:bookorbit:series', now, [xmlLink('self', `${BASE}/series`, OPDS_MIME_NAV)], entries);
  }

  generateAcquisitionFeed(
    title: string,
    feedId: string,
    books: OpdsBookEntry[],
    total: number,
    page: number,
    size: number,
    selfPath: string,
    coverToken: string,
    activeSort?: OpdsSortOrder,
    asciiByLibrary: Map<number, boolean> = new Map(),
  ): string {
    const now = new Date().toISOString();
    const totalPages = Math.max(1, Math.ceil(total / size));
    const links = [
      xmlLink('self', selfPath, OPDS_MIME_ACQ),
      xmlLink('start', BASE, OPDS_MIME_NAV),
      xmlLink('search', `${BASE}/search.opds`, OPDS_MIME_SEARCH),
    ];

    const url = new URL(selfPath, 'http://localhost');
    const pageUrl = (p: number) => {
      url.searchParams.set('page', String(p));
      return `${url.pathname}?${url.searchParams.toString()}`;
    };

    if (page > 1) {
      links.push(xmlLink('first', pageUrl(1), OPDS_MIME_ACQ));
      links.push(xmlLink('previous', pageUrl(page - 1), OPDS_MIME_ACQ));
    }
    if (page < totalPages) {
      links.push(xmlLink('next', pageUrl(page + 1), OPDS_MIME_ACQ));
      links.push(xmlLink('last', pageUrl(totalPages), OPDS_MIME_ACQ));
    }

    // Facet URLs change sort and reset to page 1, so build a fresh URL per link
    // from selfPath (which preserves existing filters) rather than mutating the
    // shared `url` above, whose sort/page must stay intact for next/prev/first/last.
    if (activeSort !== undefined) {
      for (const facet of OPDS_FACET_SORTS) {
        const facetUrl = new URL(selfPath, 'http://localhost');
        facetUrl.searchParams.set('sort', facet.value);
        facetUrl.searchParams.set('page', '1');
        const href = `${facetUrl.pathname}?${facetUrl.searchParams.toString()}`;
        links.push(xmlFacetLink(href, facet.label, 'Sort', facet.sort === activeSort));
      }
    }

    const entries = books.map((book) => this.bookEntry(book, coverToken, asciiByLibrary.get(book.libraryId) ?? false));

    return this.wrapFeed(title, feedId, now, links, entries, total);
  }

  generateOpenSearchDescription(): string {
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">',
      `  ${xmlEl('ShortName', 'bookorbit OPDS')}`,
      `  ${xmlEl('Description', 'Search the bookorbit book catalog')}`,
      `  <Url type="${esc(OPDS_MIME_ACQ)}" template="${esc(BASE)}/catalog?q={searchTerms}"/>`,
      '  <InputEncoding>UTF-8</InputEncoding>',
      '  <OutputEncoding>UTF-8</OutputEncoding>',
      '</OpenSearchDescription>',
    ].join('\n');
  }

  private bookEntry(book: OpdsBookEntry, coverToken: string, asciiOnly: boolean): string {
    const lines: string[] = [];
    lines.push('<entry>');
    lines.push(`  ${xmlEl('title', encodeText(book.title, asciiOnly))}`);
    lines.push(`  ${xmlEl('id', `urn:bookorbit:book:${book.id}`)}`);
    lines.push(`  ${xmlEl('updated', book.updatedAt.toISOString())}`);

    for (const author of book.authors) {
      lines.push(`  <author>${xmlEl('name', encodeText(author, asciiOnly))}</author>`);
    }

    if (book.description) {
      lines.push(`  <content type="text">${esc(encodeText(book.description, asciiOnly))}</content>`);
    } else {
      lines.push('  <content type="text"/>');
    }

    if (book.seriesName) {
      const seriesHref =
        book.seriesId != null ? `${BASE}/catalog?seriesId=${book.seriesId}` : `${BASE}/catalog?series=${encodeURIComponent(book.seriesName)}`;
      lines.push(
        `  <link rel="http://opds-spec.org/sort/series" href="${esc(seriesHref)}" title="${esc(encodeText(book.seriesName, asciiOnly))}${book.seriesIndex != null ? ` #${book.seriesIndex}` : ''}"/>`,
      );
    }

    if (book.language) {
      lines.push(`  ${xmlEl('dc:language', book.language)}`);
    }
    if (book.publisher) {
      lines.push(`  ${xmlEl('dc:publisher', encodeText(book.publisher, asciiOnly))}`);
    }
    if (book.isbn13) {
      lines.push(`  ${xmlEl('dc:identifier', `urn:isbn:${esc(book.isbn13)}`)}`);
    }

    if (book.hasCover) {
      lines.push(`  ${xmlLink('http://opds-spec.org/image', `${BASE}/${book.id}/cover?t=${encodeURIComponent(coverToken)}`, 'image/jpeg')}`);
      lines.push(
        `  ${xmlLink('http://opds-spec.org/image/thumbnail', `${BASE}/${book.id}/thumbnail?t=${encodeURIComponent(coverToken)}`, 'image/jpeg')}`,
      );
    }

    for (const file of book.files) {
      const mime = fileMimeType(file.format);
      lines.push(
        `  ${xmlLink('http://opds-spec.org/acquisition', `${BASE}/${book.id}/download?fileId=${file.id}`, mime, file.format.toUpperCase())}`,
      );
    }

    lines.push('</entry>');
    return lines.join('\n');
  }

  private navEntry(id: string, title: string, content: string, href: string, updated: string): string {
    return [
      '<entry>',
      `  ${xmlEl('title', title)}`,
      `  ${xmlEl('id', id)}`,
      `  ${xmlEl('updated', updated)}`,
      `  <content type="text">${esc(content)}</content>`,
      `  ${xmlLink('subsection', href, OPDS_MIME_NAV)}`,
      '</entry>',
    ].join('\n');
  }

  private wrapFeed(title: string, id: string, updated: string, links: string[], entries: string[], totalResults?: number): string {
    const lines = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<feed xmlns="http://www.w3.org/2005/Atom"',
      '      xmlns:dc="http://purl.org/dc/terms/"',
      '      xmlns:opds="http://opds-spec.org/2010/catalog"',
      '      xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">',
      `  ${xmlEl('title', title)}`,
      `  ${xmlEl('id', id)}`,
      `  ${xmlEl('updated', updated)}`,
    ];

    if (totalResults !== undefined) {
      lines.push(`  ${xmlEl('opensearch:totalResults', String(totalResults))}`);
    }

    for (const link of links) {
      lines.push(`  ${link}`);
    }

    for (const entry of entries) {
      lines.push(entry);
    }

    lines.push('</feed>');
    return lines.join('\n');
  }
}
