import { XMLParser } from 'fast-xml-parser';

import { OpdsService } from '../opds.service';
import type { OpdsBookEntry } from '../opds-book.service';
import { OPDS_MIME_ACQ, OPDS_MIME_NAV } from '../opds-xml.helpers';

// Holistic OPDS 1.2 + Atom conformance checks that PARSE each generated feed and
// assert the structural rules (required feed/entry elements, link rels + MIME
// types, namespaces, well-formedness). This locks conformance across all feed
// types going forward, independent of the string-level assertions elsewhere.

const BASE = '/api/v1/opds';

const ATOM_NS = 'http://www.w3.org/2005/Atom';
const DC_NS = 'http://purl.org/dc/terms/';
const OPDS_NS = 'http://opds-spec.org/2010/catalog';
const OPENSEARCH_NS = 'http://a9.com/-/spec/opensearch/1.1/';

const ACQ_REL = 'http://opds-spec.org/acquisition';
const IMAGE_REL = 'http://opds-spec.org/image';
const THUMBNAIL_REL = 'http://opds-spec.org/image/thumbnail';
const FACET_REL = 'http://opds-spec.org/facet';

// Parse with attributes and never coerce values, so ids/titles stay strings and
// single-vs-array shapes are predictable via alwaysCreateTextNode/isArray.
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseAttributeValue: false,
  parseTagValue: false,
  isArray: (name) => name === 'entry' || name === 'link' || name === 'author',
});

function makeService() {
  return new OpdsService();
}

function parseFeed(xml: string): Record<string, any> {
  const root = parser.parse(xml);
  expect(root.feed).toBeDefined();
  return root.feed;
}

function links(node: Record<string, any>): Array<Record<string, string>> {
  return (node.link ?? []) as Array<Record<string, string>>;
}

function linkByRel(node: Record<string, any>, rel: string): Record<string, string> | undefined {
  return links(node).find((l) => l['@_rel'] === rel);
}

function entries(feed: Record<string, any>): Array<Record<string, any>> {
  return (feed.entry ?? []) as Array<Record<string, any>>;
}

function sampleBook(overrides?: Partial<OpdsBookEntry>): OpdsBookEntry {
  return {
    id: 1,
    libraryId: 1,
    title: 'Mistborn: The Final Empire',
    folderPath: '/books/mistborn',
    addedAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-02'),
    description: 'A fantasy novel by Brandon Sanderson',
    seriesId: 1,
    seriesName: 'Mistborn',
    seriesIndex: 1,
    language: 'en',
    publisher: 'Tor Books',
    isbn13: '9780765311788',
    hasCover: true,
    authors: ['Brandon Sanderson'],
    files: [{ id: 10, format: 'epub' }],
    ...overrides,
  };
}

// Assertions shared by EVERY feed: the Atom-required feed-level elements plus the
// OPDS-recommended feed author, and the four declared namespaces.
function assertFeedEssentials(xml: string, feed: Record<string, any>) {
  expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);

  expect(feed['@_xmlns']).toBe(ATOM_NS);
  expect(feed['@_xmlns:dc']).toBe(DC_NS);
  expect(feed['@_xmlns:opds']).toBe(OPDS_NS);
  expect(feed['@_xmlns:opensearch']).toBe(OPENSEARCH_NS);
  // thr is only legal to reference if thr:count is emitted; we never emit it.
  expect(feed['@_xmlns:thr']).toBeUndefined();
  expect(xml).not.toContain('thr:');

  expect(typeof feed.id).toBe('string');
  expect(feed.id.length).toBeGreaterThan(0);
  expect(typeof feed.title).toBe('string');
  expect(feed.title.length).toBeGreaterThan(0);
  expect(typeof feed.updated).toBe('string');
  expect(() => new Date(feed.updated).toISOString()).not.toThrow();

  const feedAuthors = (feed.author ?? []) as Array<Record<string, string>>;
  expect(feedAuthors.length).toBeGreaterThanOrEqual(1);
  expect(feedAuthors[0].name).toBe('bookorbit');
}

// Every acquisition/navigation entry must carry the Atom-required id/title/updated.
function assertEntryEssentials(entry: Record<string, any>) {
  expect(typeof entry.id).toBe('string');
  expect(entry.id.length).toBeGreaterThan(0);
  expect(typeof entry.title).toBe('string');
  expect(entry.title.length).toBeGreaterThan(0);
  expect(typeof entry.updated).toBe('string');
  expect(() => new Date(entry.updated).toISOString()).not.toThrow();
}

describe('OPDS 1.2 conformance', () => {
  describe('root navigation feed', () => {
    it('has required feed elements, self/start/search links, and navigation entries', () => {
      const xml = makeService().generateRootNavigation();
      const feed = parseFeed(xml);

      assertFeedEssentials(xml, feed);

      const self = linkByRel(feed, 'self');
      const start = linkByRel(feed, 'start');
      const search = linkByRel(feed, 'search');
      expect(self?.['@_type']).toBe(OPDS_MIME_NAV);
      expect(start?.['@_type']).toBe(OPDS_MIME_NAV);
      expect(search?.['@_href']).toBe(`${BASE}/search.opds`);
      expect(search?.['@_type']).toBe('application/opensearchdescription+xml');

      const navEntries = entries(feed);
      expect(navEntries.length).toBeGreaterThan(0);
      for (const entry of navEntries) {
        assertEntryEssentials(entry);
        const sub = linkByRel(entry, 'subsection');
        expect(sub?.['@_type']).toBe(OPDS_MIME_NAV);
        expect(typeof sub?.['@_href']).toBe('string');
      }
    });
  });

  describe('libraries navigation feed', () => {
    it('is a navigation feed with self + start links and per-library nav entries', () => {
      const xml = makeService().generateLibrariesNavigation([
        { id: 1, name: 'Fiction', bookCount: 42 },
        { id: 2, name: 'Non-Fiction', bookCount: 13 },
      ]);
      const feed = parseFeed(xml);

      assertFeedEssentials(xml, feed);
      expect(linkByRel(feed, 'self')?.['@_type']).toBe(OPDS_MIME_NAV);
      expect(linkByRel(feed, 'start')?.['@_href']).toBe(BASE);

      const navEntries = entries(feed);
      expect(navEntries).toHaveLength(2);
      for (const entry of navEntries) {
        assertEntryEssentials(entry);
        expect(linkByRel(entry, 'subsection')?.['@_type']).toBe(OPDS_MIME_NAV);
      }
    });
  });

  describe('collections / smart-scopes / series navigation feeds', () => {
    it('collections feed carries feed essentials + start link', () => {
      const xml = makeService().generateCollectionsNavigation([{ id: 5, name: 'Favorites', bookCount: 7 }]);
      const feed = parseFeed(xml);
      assertFeedEssentials(xml, feed);
      expect(linkByRel(feed, 'start')?.['@_href']).toBe(BASE);
    });

    it('smart-scopes feed carries feed essentials + start link', () => {
      const xml = makeService().generateSmartScopesNavigation([{ id: 3, name: 'Unread', icon: null }]);
      const feed = parseFeed(xml);
      assertFeedEssentials(xml, feed);
      expect(linkByRel(feed, 'start')?.['@_href']).toBe(BASE);
    });

    it('series feed carries feed essentials + start link', () => {
      const xml = makeService().generateSeriesNavigation([{ id: 42, name: 'The Lord of the Rings', bookCount: 3 }]);
      const feed = parseFeed(xml);
      assertFeedEssentials(xml, feed);
      expect(linkByRel(feed, 'start')?.['@_href']).toBe(BASE);
    });
  });

  describe('authors navigation feed (paginated)', () => {
    it('emits valid first/previous/next pagination rels for a middle page', () => {
      const xml = makeService().generateAuthorsNavigation([{ name: 'Frank Herbert', bookCount: 3 }], 2, 10, true);
      const feed = parseFeed(xml);

      assertFeedEssentials(xml, feed);
      expect(linkByRel(feed, 'self')?.['@_href']).toBe(`${BASE}/authors?page=2&size=10`);
      expect(linkByRel(feed, 'start')?.['@_href']).toBe(BASE);
      expect(linkByRel(feed, 'first')?.['@_href']).toBe(`${BASE}/authors?page=1&size=10`);
      expect(linkByRel(feed, 'previous')?.['@_href']).toBe(`${BASE}/authors?page=1&size=10`);
      expect(linkByRel(feed, 'next')?.['@_href']).toBe(`${BASE}/authors?page=3&size=10`);
      // All pagination links must stay navigation-typed.
      for (const rel of ['self', 'first', 'previous', 'next']) {
        expect(linkByRel(feed, rel)?.['@_type']).toBe(OPDS_MIME_NAV);
      }
    });

    it('omits first/previous on page 1 and omits next when there is no next page', () => {
      const xml = makeService().generateAuthorsNavigation([{ name: 'Frank Herbert', bookCount: 3 }], 1, 10, false);
      const feed = parseFeed(xml);

      expect(linkByRel(feed, 'first')).toBeUndefined();
      expect(linkByRel(feed, 'previous')).toBeUndefined();
      expect(linkByRel(feed, 'next')).toBeUndefined();
      // No `last` rel by design: author paging has no total count (bo-pc2.3), so
      // the final page is unknown and a `last` link would be fabricated.
      expect(linkByRel(feed, 'last')).toBeUndefined();
    });
  });

  describe('faceted acquisition feed', () => {
    it('has acquisition self/start links, valid pagination, facet links, and a conformant entry', () => {
      const book = sampleBook();
      const xml = makeService().generateAcquisitionFeed(
        'Catalog',
        'urn:bookorbit:catalog',
        [book],
        100,
        2,
        10,
        `${BASE}/catalog?page=2&size=10&sort=title_asc`,
        'test-token',
        'title_asc',
      );
      const feed = parseFeed(xml);

      assertFeedEssentials(xml, feed);
      expect(feed['opensearch:totalResults']).toBe('100');

      expect(linkByRel(feed, 'self')?.['@_type']).toBe(OPDS_MIME_ACQ);
      expect(linkByRel(feed, 'start')?.['@_type']).toBe(OPDS_MIME_NAV);
      expect(linkByRel(feed, 'search')?.['@_type']).toBe('application/opensearchdescription+xml');

      // Middle page => all four pagination rels present, acquisition-typed.
      for (const rel of ['first', 'previous', 'next', 'last']) {
        const link = linkByRel(feed, rel);
        expect(link, `expected pagination rel ${rel}`).toBeDefined();
        expect(link?.['@_type']).toBe(OPDS_MIME_ACQ);
      }

      const facetLinks = links(feed).filter((l) => l['@_rel'] === FACET_REL);
      expect(facetLinks.length).toBeGreaterThan(0);
      for (const facet of facetLinks) {
        expect(facet['@_type']).toBe(OPDS_MIME_ACQ);
        expect(facet['@_title']).toBeTruthy();
        expect(facet['@_opds:facetGroup']).toBe('Sort');
      }
      // Exactly the active sort is flagged.
      const active = facetLinks.filter((l) => l['@_opds:activeFacet'] === 'true');
      expect(active).toHaveLength(1);

      const entry = entries(feed)[0];
      assertEntryEssentials(entry);

      const acqLink = links(entry).find((l) => l['@_rel'] === ACQ_REL || l['@_rel'] === 'http://opds-spec.org/acquisition/open-access');
      expect(acqLink, 'entry must carry an acquisition link').toBeDefined();
      expect(acqLink?.['@_type']).toBe('application/epub+zip');

      expect(linkByRel(entry, IMAGE_REL)?.['@_type']).toBe('image/jpeg');
      expect(linkByRel(entry, THUMBNAIL_REL)?.['@_type']).toBe('image/jpeg');

      // author is emitted as a nested <author><name/></author>; the book author
      // must be present alongside any feed-level author.
      const authorNames = ((entry.author ?? []) as Array<Record<string, string>>).map((a) => a.name);
      expect(authorNames).toContain('Brandon Sanderson');
    });
  });

  describe('per-author acquisition feed (with up link)', () => {
    it('carries an up link back to the authors navigation feed', () => {
      const book = sampleBook({ id: 7, authors: ['Frank Herbert'], seriesId: null, seriesName: null, seriesIndex: null });
      const xml = makeService().generateAcquisitionFeed(
        'Catalog',
        'urn:bookorbit:catalog:author:Frank%20Herbert',
        [book],
        3,
        1,
        50,
        `${BASE}/catalog?author=Frank+Herbert&page=1&size=50&sort=author_asc`,
        'test-token',
        'author_asc',
        new Map(),
        `${BASE}/authors`,
      );
      const feed = parseFeed(xml);

      assertFeedEssentials(xml, feed);
      const up = linkByRel(feed, 'up');
      expect(up?.['@_href']).toBe(`${BASE}/authors`);
      expect(up?.['@_type']).toBe(OPDS_MIME_NAV);
    });
  });

  describe('ASCII-library entry', () => {
    it('transliterates non-ASCII entry text to pure ASCII while staying well-formed', () => {
      const book = sampleBook({
        id: 9,
        libraryId: 5,
        title: 'Cien años de soledad',
        authors: ['Gabriel García Márquez'],
        publisher: 'Éditions Gallimard',
        description: 'Café society — a saga',
        seriesId: null,
        seriesName: null,
        seriesIndex: null,
      });
      const xml = makeService().generateAcquisitionFeed(
        'Catalog',
        'urn:bookorbit:catalog:library:5',
        [book],
        1,
        1,
        50,
        `${BASE}/catalog?libraryId=5&page=1&size=50`,
        'test-token',
        undefined,
        new Map([[5, true]]),
      );
      const feed = parseFeed(xml);
      const entry = entries(feed)[0];
      assertEntryEssentials(entry);

      // eslint-disable-next-line no-control-regex -- verify no non-ASCII survived transliteration
      expect(/[^\x00-\x7F]/.test(xml)).toBe(false);
      expect(entry.title).toBe('Cien anos de soledad');
      const authorNames = ((entry.author ?? []) as Array<Record<string, string>>).map((a) => a.name);
      expect(authorNames).toContain('Gabriel Garcia Marquez');
    });
  });

  describe('OpenSearch descriptor', () => {
    it('is well-formed and advertises the acquisition-typed catalog search template', () => {
      const xml = makeService().generateOpenSearchDescription();
      const root = parser.parse(xml);
      const desc = root.OpenSearchDescription;
      expect(desc).toBeDefined();
      expect(desc['@_xmlns']).toBe(OPENSEARCH_NS);
      expect(desc.ShortName).toBeTruthy();

      const urls = Array.isArray(desc.Url) ? desc.Url : [desc.Url];
      const acqUrl = urls.find((u: Record<string, string>) => u['@_type'] === OPDS_MIME_ACQ);
      expect(acqUrl).toBeDefined();
      expect(acqUrl['@_template']).toContain('{searchTerms}');
    });
  });
});
