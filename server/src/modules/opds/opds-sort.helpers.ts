import type { OpdsSortOrder } from './opds-book.service';

export interface OpdsFacetSort {
  label: string;
  value: string;
  sort: OpdsSortOrder;
}

// Exposed sort facets for the acquisition feed, ordered by dimension then direction.
// `value` is what goes in ?sort= and is kept equal to the OpdsSortOrder key to stay stable/url-safe.
export const OPDS_FACET_SORTS: OpdsFacetSort[] = [
  { label: 'Title A-Z', value: 'title_asc', sort: 'title_asc' },
  { label: 'Title Z-A', value: 'title_desc', sort: 'title_desc' },
  { label: 'Date added (newest)', value: 'recent', sort: 'recent' },
  { label: 'Date added (oldest)', value: 'recent_asc', sort: 'recent_asc' },
  { label: 'Published (newest)', value: 'published_desc', sort: 'published_desc' },
  { label: 'Published (oldest)', value: 'published_asc', sort: 'published_asc' },
  { label: 'Author A-Z', value: 'author_asc', sort: 'author_asc' },
  { label: 'Author Z-A', value: 'author_desc', sort: 'author_desc' },
  { label: 'Series', value: 'series_asc', sort: 'series_asc' },
  { label: 'Series (reverse)', value: 'series_desc', sort: 'series_desc' },
];

export function parseSortParam(raw: string | undefined, fallback: OpdsSortOrder): OpdsSortOrder {
  if (!raw) return fallback;
  const match = OPDS_FACET_SORTS.find((f) => f.value === raw);
  return match ? match.sort : fallback;
}
