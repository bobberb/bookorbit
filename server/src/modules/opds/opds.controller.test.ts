vi.mock('fs', () => ({
  createReadStream: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  stat: vi.fn(),
}));

import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { MockedFunction } from 'vitest';

import { OpdsController } from './opds.controller';

const mockCreateReadStream = createReadStream as MockedFunction<typeof createReadStream>;
const mockStat = stat as MockedFunction<typeof stat>;

function makeController() {
  const opdsService = {
    generateRootNavigation: vi.fn().mockReturnValue('<root />'),
    generateLibrariesNavigation: vi.fn().mockReturnValue('<libraries />'),
    generateCollectionsNavigation: vi.fn().mockReturnValue('<collections />'),
    generateSmartScopesNavigation: vi.fn().mockReturnValue('<smartScopes />'),
    generateAuthorsNavigation: vi.fn().mockReturnValue('<authors />'),
    generateSeriesNavigation: vi.fn().mockReturnValue('<series />'),
    generateAcquisitionFeed: vi.fn().mockReturnValue('<feed />'),
    generateOpenSearchDescription: vi.fn().mockReturnValue('<search />'),
  } as never;
  const opdsBookService = {
    getAccessibleLibraries: vi.fn().mockResolvedValue([{ id: 1, name: 'Main', bookCount: 10 }]),
    getUserCollections: vi.fn().mockResolvedValue([{ id: 4, name: 'Favorites', bookCount: 2 }]),
    getUserSmartScopes: vi.fn().mockResolvedValue([{ id: 7, name: 'Unread', icon: 'sparkles' }]),
    getDistinctAuthors: vi.fn().mockResolvedValue([{ name: 'Frank Herbert', bookCount: 3 }]),
    getDistinctAuthorsPage: vi.fn().mockResolvedValue({ items: [{ name: 'Frank Herbert', bookCount: 3 }], hasNext: false }),
    getDistinctAuthorsCount: vi.fn().mockResolvedValue(1),
    getDistinctSeries: vi.fn().mockResolvedValue([
      { name: null, bookCount: 1 },
      { name: 'Dune', bookCount: 2 },
    ]),
    getBooksPage: vi.fn().mockResolvedValue({ entries: [{ id: 1 }], total: 1 }),
    getRecentBooksPage: vi.fn().mockResolvedValue({ entries: [{ id: 2 }], total: 1 }),
    getRandomBooks: vi.fn().mockResolvedValue([{ id: 3 }]),
    validateBookAccess: vi.fn().mockResolvedValue(undefined),
    getBookFiles: vi.fn().mockResolvedValue({
      absolutePath: '/books/library/book.epub',
      format: 'epub',
      title: 'Book Title',
      authorName: 'Author Name',
    }),
  } as never;
  const bookService = {
    resolveDownloadFilename: vi.fn().mockResolvedValue('BadTitle - Author.epub'),
  } as never;
  const coverStore = {
    resolve: vi.fn().mockResolvedValue(null),
  };

  return {
    controller: new OpdsController(opdsService, opdsBookService, bookService, coverStore as never),
    opdsService,
    opdsBookService,
    bookService,
    coverStore,
  };
}

function makeReply() {
  const reply = {
    header: vi.fn(),
    type: vi.fn(),
    status: vi.fn(),
    send: vi.fn(),
  };

  reply.header.mockReturnValue(reply);
  reply.type.mockReturnValue(reply);
  reply.status.mockReturnValue(reply);

  return reply as never;
}

describe('OpdsController', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('renders root navigation feed', () => {
    const { controller, opdsService } = makeController();
    const reply = makeReply();

    controller.root({} as never, reply);

    expect(opdsService.generateRootNavigation).toHaveBeenCalledOnce();
    expect(reply.type).toHaveBeenCalledWith('application/atom+xml;profile=opds-catalog;kind=navigation; charset=utf-8');
    expect(reply.send).toHaveBeenCalledWith('<root />');
  });

  it('renders navigation endpoints with OPDS navigation mime type', async () => {
    const { controller, opdsBookService, opdsService } = makeController();
    const user = { userId: 8, isSuperuser: false } as never;

    await controller.libraries(user, makeReply());
    await controller.collections(user, makeReply());
    await controller.smartScopes(user, makeReply());
    await controller.authors(user, 1, 50, makeReply());
    await controller.series(user, makeReply());

    expect(opdsBookService.getAccessibleLibraries).toHaveBeenCalledWith(8, false);
    expect(opdsBookService.getUserCollections).toHaveBeenCalledWith(8);
    expect(opdsBookService.getUserSmartScopes).toHaveBeenCalledWith(8);
    expect(opdsBookService.getDistinctAuthorsPage).toHaveBeenCalledWith(8, { limit: 50, offset: 0 }, false, undefined);
    expect(opdsBookService.getDistinctAuthorsCount).toHaveBeenCalledWith(8, {}, false, undefined);
    expect(opdsBookService.getDistinctSeries).toHaveBeenCalledWith(8, false, undefined);
    expect(opdsService.generateSeriesNavigation).toHaveBeenCalledWith([{ name: 'Dune', bookCount: 2 }]);
  });

  it('authors nav paginates: clamps window, threads page/size, and enforces the deep-pagination guard', async () => {
    const { controller, opdsBookService, opdsService } = makeController();
    const user = { userId: 8, isSuperuser: false } as never;

    opdsBookService.getDistinctAuthorsPage.mockResolvedValue({
      items: [{ name: 'Frank Herbert', bookCount: 3 }],
      hasNext: true,
    });

    await controller.authors(user, 2, 10, makeReply());

    expect(opdsBookService.getDistinctAuthorsPage).toHaveBeenCalledWith(8, { limit: 10, offset: 10 }, false, undefined);
    expect(opdsService.generateAuthorsNavigation).toHaveBeenCalledWith([{ name: 'Frank Herbert', bookCount: 3 }], 2, 10, true, 1);

    await expect(controller.authors(user, 1_000_000, 100, makeReply())).rejects.toThrow(BadRequestException);
  });

  it('per-author catalog carries the sort facet group and an up link back to /authors', async () => {
    const { controller, opdsBookService, opdsService } = makeController();
    const user = { userId: 7, isSuperuser: false, sortOrder: 'recent', coverToken: 'token' } as never;

    await controller.catalog(
      user,
      1,
      50,
      undefined,
      undefined,
      undefined,
      'Frank Herbert',
      undefined,
      undefined,
      makeReply(),
      undefined,
      'author_asc',
    );

    expect(opdsBookService.getBooksPage).toHaveBeenCalledWith(7, 'author_asc', 1, 50, { author: 'Frank Herbert' }, false, undefined);
    expect(opdsService.generateAcquisitionFeed).toHaveBeenCalledWith(
      expect.anything(),
      'urn:bookorbit:catalog:author:Frank%20Herbert',
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.stringContaining('author=Frank+Herbert'),
      'token',
      'author_asc',
      '/api/v1/opds/authors',
    );
  });

  it('all-books catalog links up to the root navigation feed', async () => {
    const { controller, opdsService } = makeController();
    const user = { userId: 7, isSuperuser: false, sortOrder: 'recent', coverToken: 'token' } as never;

    await controller.catalog(user, 1, 50, undefined, undefined, undefined, undefined, undefined, undefined, makeReply());

    const upArg = opdsService.generateAcquisitionFeed.mock.calls[0][9];
    expect(upArg).toBe('/api/v1/opds');
  });

  it('each filtered catalog links up to its parent navigation feed', async () => {
    const user = { userId: 7, isSuperuser: false, sortOrder: 'recent', coverToken: 'token' } as never;
    const upArgFor = async (args: Parameters<OpdsController['catalog']>): Promise<unknown> => {
      const { controller, opdsService } = makeController();
      await controller.catalog(...args);
      return opdsService.generateAcquisitionFeed.mock.calls[0][9];
    };

    // [user, page, size, libraryId, collectionId, smartScopeId, author, series, q, reply, seriesId]
    expect(await upArgFor([user, 1, 50, undefined, undefined, undefined, 'Frank Herbert', undefined, undefined, makeReply()])).toBe(
      '/api/v1/opds/authors',
    );
    expect(await upArgFor([user, 1, 50, undefined, '8', undefined, undefined, undefined, undefined, makeReply()])).toBe('/api/v1/opds/collections');
    expect(await upArgFor([user, 1, 50, '3', undefined, undefined, undefined, undefined, undefined, makeReply()])).toBe('/api/v1/opds/libraries');
    expect(await upArgFor([user, 1, 50, undefined, undefined, undefined, undefined, 'Dune', undefined, makeReply()])).toBe('/api/v1/opds/series');
    expect(await upArgFor([user, 1, 50, undefined, undefined, undefined, undefined, undefined, undefined, makeReply(), '5'])).toBe(
      '/api/v1/opds/series',
    );
    expect(await upArgFor([user, 1, 50, undefined, undefined, '9', undefined, undefined, undefined, makeReply()])).toBe('/api/v1/opds/smart-scopes');
  });

  it('catalog clamps pagination and passes parsed filters to the book service', async () => {
    const { controller, opdsBookService, opdsService } = makeController();
    const reply = makeReply();
    const user = { userId: 7, isSuperuser: true, sortOrder: 'author_desc', coverToken: 'token' } as never;

    await controller.catalog(user, -4, 500, '2', '11', '15', 'Frank Herbert', 'Dune', 'arrakis', reply);

    expect(opdsBookService.getBooksPage).toHaveBeenCalledWith(
      7,
      'author_desc',
      1,
      100,
      {
        libraryId: 2,
        collectionId: 11,
        smartScopeId: 15,
        author: 'Frank Herbert',
        series: 'Dune',
        q: 'arrakis',
      },
      true,
      undefined,
    );
    expect(opdsService.generateAcquisitionFeed).toHaveBeenCalledWith(
      'Search: arrakis',
      'urn:bookorbit:catalog:author:Frank%20Herbert:collectionId:11:libraryId:2:q:arrakis:series:Dune:smartScopeId:15',
      [{ id: 1 }],
      1,
      1,
      100,
      expect.not.stringContaining('sort='),
      'token',
      'author_desc',
      '/api/v1/opds/authors',
    );
  });

  it('catalog applies ?sort= override and falls back to stored sort when absent or unknown', async () => {
    const override = makeController();
    const user = { userId: 7, isSuperuser: false, sortOrder: 'recent', coverToken: 'token' } as never;

    await override.controller.catalog(
      user,
      1,
      50,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      makeReply(),
      undefined,
      'published_desc',
    );
    expect(override.opdsBookService.getBooksPage).toHaveBeenCalledWith(7, 'published_desc', 1, 50, {}, false, undefined);
    expect(override.opdsService.generateAcquisitionFeed).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.stringContaining('sort=published_desc'),
      expect.anything(),
      'published_desc',
      '/api/v1/opds',
    );

    const unknown = makeController();
    await unknown.controller.catalog(
      user,
      1,
      50,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      makeReply(),
      undefined,
      'nonsense',
    );
    expect(unknown.opdsBookService.getBooksPage).toHaveBeenCalledWith(7, 'recent', 1, 50, {}, false, undefined);
    expect(unknown.opdsService.generateAcquisitionFeed.mock.calls[0][6]).toBe('/api/v1/opds/catalog?page=1&size=50');
    expect(unknown.opdsService.generateAcquisitionFeed.mock.calls[0][8]).toBe('recent');
  });

  it('catalog keeps the pre-facet self URL when no ?sort= is passed', async () => {
    const { controller, opdsBookService, opdsService } = makeController();
    const user = { userId: 7, isSuperuser: false, sortOrder: 'title_desc', coverToken: 'token' } as never;

    await controller.catalog(user, 2, 25, '3', undefined, undefined, undefined, undefined, undefined, makeReply());

    expect(opdsBookService.getBooksPage).toHaveBeenCalledWith(7, 'title_desc', 2, 25, { libraryId: 3 }, false, undefined);
    expect(opdsService.generateAcquisitionFeed.mock.calls[0][6]).toBe('/api/v1/opds/catalog?libraryId=3&page=2&size=25');
  });

  it('per-collection catalog threads collectionId and sort into the self path', async () => {
    const { controller, opdsBookService, opdsService } = makeController();
    const user = { userId: 7, isSuperuser: false, sortOrder: 'recent', coverToken: 'token' } as never;

    await controller.catalog(user, 1, 50, undefined, '8', undefined, undefined, undefined, undefined, makeReply(), undefined, 'published_desc');

    expect(opdsBookService.getBooksPage).toHaveBeenCalledWith(7, 'published_desc', 1, 50, { collectionId: 8 }, false, undefined);
    const selfPath = opdsService.generateAcquisitionFeed.mock.calls[0][6] as string;
    expect(selfPath).toContain('collectionId=8');
    expect(selfPath).toContain('sort=published_desc');
    expect(opdsService.generateAcquisitionFeed).toHaveBeenCalledWith(
      expect.anything(),
      'urn:bookorbit:catalog:collectionId:8',
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.stringContaining('collectionId=8'),
      'token',
      'published_desc',
      '/api/v1/opds/collections',
    );
  });

  it('catalog generates unique feed ids per filter context', async () => {
    const user = { userId: 5, isSuperuser: false, sortOrder: 'recent', coverToken: 'tok' } as never;

    const noFilters = makeController();
    await noFilters.controller.catalog(user, 1, 50, undefined, undefined, undefined, undefined, undefined, undefined, makeReply());
    expect(noFilters.opdsService.generateAcquisitionFeed).toHaveBeenCalledWith(
      expect.anything(),
      'urn:bookorbit:catalog',
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      '/api/v1/opds',
    );

    const libraryOnly = makeController();
    await libraryOnly.controller.catalog(user, 1, 50, '1', undefined, undefined, undefined, undefined, undefined, makeReply());
    expect(libraryOnly.opdsService.generateAcquisitionFeed).toHaveBeenCalledWith(
      expect.anything(),
      'urn:bookorbit:catalog:libraryId:1',
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      '/api/v1/opds/libraries',
    );

    const searchOnly = makeController();
    await searchOnly.controller.catalog(user, 1, 50, undefined, undefined, undefined, undefined, undefined, 'dune', makeReply());
    expect(searchOnly.opdsService.generateAcquisitionFeed).toHaveBeenCalledWith(
      expect.anything(),
      'urn:bookorbit:catalog:q:dune',
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      '/api/v1/opds',
    );

    const multiFilter = makeController();
    await multiFilter.controller.catalog(user, 1, 50, '2', undefined, undefined, 'Frank Herbert', undefined, undefined, makeReply());
    expect(multiFilter.opdsService.generateAcquisitionFeed).toHaveBeenCalledWith(
      expect.anything(),
      'urn:bookorbit:catalog:author:Frank%20Herbert:libraryId:2',
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      '/api/v1/opds/authors',
    );
  });

  it('rejects invalid catalog filter ids and deep pagination windows', async () => {
    const { controller } = makeController();
    const user = { userId: 7, isSuperuser: false, sortOrder: 'recent', coverToken: 'token' } as never;
    const reply = makeReply();

    await expect(controller.catalog(user, 1, 50, 'abc', undefined, undefined, undefined, undefined, undefined, reply)).rejects.toThrow(
      BadRequestException,
    );
    await expect(controller.catalog(user, 1_000_000, 100, undefined, undefined, undefined, undefined, undefined, undefined, reply)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('renders recent and surprise acquisition feeds', async () => {
    const { controller, opdsBookService, opdsService } = makeController();
    const user = { userId: 12, isSuperuser: false, coverToken: 'cover-token' } as never;

    await controller.recent(user, 0, 1000, makeReply());
    await controller.surprise(user, makeReply());

    expect(opdsBookService.getRecentBooksPage).toHaveBeenCalledWith(12, 1, 100, false, undefined);
    expect(opdsBookService.getRandomBooks).toHaveBeenCalledWith(12, 25, false, undefined);
    expect(opdsService.generateAcquisitionFeed).toHaveBeenCalledWith(
      'Random Books',
      'urn:bookorbit:surprise',
      [{ id: 3 }],
      1,
      1,
      25,
      '/api/v1/opds/surprise',
      'cover-token',
    );
  });

  it('returns OpenSearch description with OPDS search mime type', () => {
    const { controller } = makeController();
    const reply = makeReply();

    controller.searchDescription({} as never, reply);

    expect(reply.type).toHaveBeenCalledWith('application/opensearchdescription+xml; charset=utf-8');
    expect(reply.send).toHaveBeenCalledWith('<search />');
  });

  it('serves the ebook cover the slot store resolves for OPDS clients', async () => {
    const { controller, opdsBookService, coverStore } = makeController();
    const reply = makeReply();
    const stream = { kind: 'stream' };

    coverStore.resolve.mockResolvedValue('/books/covers/42/ebook/cover_custom.png');
    mockStat.mockResolvedValue({ mtimeMs: 1234 } as never);
    mockCreateReadStream.mockReturnValue(stream as never);

    await controller.cover(42, { userId: 7, isSuperuser: false } as never, reply);

    expect(opdsBookService.validateBookAccess).toHaveBeenCalledWith(42, 7, false, undefined);
    expect(coverStore.resolve).toHaveBeenCalledWith(42, { medium: 'ebook', variant: 'cover' });
    expect(reply.header).toHaveBeenCalledWith('Cross-Origin-Resource-Policy', 'cross-origin');
    expect(mockCreateReadStream).toHaveBeenCalledWith('/books/covers/42/ebook/cover_custom.png');
    expect(reply.header).toHaveBeenCalledWith('ETag', '"1234"');
    expect(reply.type).toHaveBeenCalledWith('image/png');
    expect(reply.send).toHaveBeenCalledWith(stream);
  });

  it('returns 304 when cover ETag matches If-None-Match', async () => {
    const { controller, coverStore } = makeController();
    const reply = makeReply();

    coverStore.resolve.mockResolvedValue('/books/covers/42/ebook/cover_custom.jpg');
    mockStat.mockResolvedValue({ mtimeMs: 5000 } as never);

    await controller.cover(42, { userId: 7, isSuperuser: false } as never, reply, '"5000"');

    expect(reply.header).toHaveBeenCalledWith('Cross-Origin-Resource-Policy', 'cross-origin');
    expect(reply.status).toHaveBeenCalledWith(304);
    expect(reply.send).toHaveBeenCalledWith();
    expect(mockCreateReadStream).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when no cover exists', async () => {
    const { controller } = makeController();

    await expect(controller.cover(42, { userId: 7, isSuperuser: false } as never, makeReply())).rejects.toThrow(NotFoundException);
    expect(mockStat).not.toHaveBeenCalled();
  });

  it('serves thumbnail image when available', async () => {
    const { controller, coverStore } = makeController();
    const reply = makeReply();
    const stream = { kind: 'thumbnail-stream' };

    coverStore.resolve.mockResolvedValue('/books/covers/12/ebook/thumbnail.jpg');
    mockStat.mockResolvedValue({ mtimeMs: 2222 } as never);
    mockCreateReadStream.mockReturnValue(stream as never);

    await controller.thumbnail(12, { userId: 1, isSuperuser: false } as never, reply);

    expect(coverStore.resolve).toHaveBeenCalledWith(12, { medium: 'ebook', variant: 'thumbnail' });
    expect(reply.header).toHaveBeenCalledWith('Cross-Origin-Resource-Policy', 'cross-origin');
    expect(reply.type).toHaveBeenCalledWith('image/jpeg');
    expect(reply.header).toHaveBeenCalledWith('ETag', '"2222"');
    expect(mockCreateReadStream).toHaveBeenCalledWith('/books/covers/12/ebook/thumbnail.jpg');
    expect(reply.send).toHaveBeenCalledWith(stream);
  });

  it('returns 304 for thumbnail when ETag matches', async () => {
    const { controller, coverStore } = makeController();
    const reply = makeReply();

    coverStore.resolve.mockResolvedValue('/books/covers/12/ebook/thumbnail.jpg');
    mockStat.mockResolvedValue({ mtimeMs: 3333 } as never);

    await controller.thumbnail(12, { userId: 1, isSuperuser: false } as never, reply, '"3333"');

    expect(reply.header).toHaveBeenCalledWith('Cross-Origin-Resource-Policy', 'cross-origin');
    expect(reply.status).toHaveBeenCalledWith(304);
    expect(reply.send).toHaveBeenCalledWith();
    expect(mockCreateReadStream).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when the book has no thumbnail to serve', async () => {
    const { controller } = makeController();

    await expect(controller.thumbnail(12, { userId: 1, isSuperuser: false } as never, makeReply())).rejects.toThrow(NotFoundException);
    expect(mockStat).not.toHaveBeenCalled();
  });

  it('serves a thumbnail rebuilt on demand when the file is missing beside an intact cover', async () => {
    const { controller, coverStore } = makeController();
    const reply = makeReply();
    const stream = { kind: 'repaired-thumbnail-stream' };
    coverStore.resolve.mockResolvedValue('/books/covers/12/ebook/thumbnail.jpg');
    mockStat.mockRejectedValueOnce(Object.assign(new Error('missing thumbnail'), { code: 'ENOENT' })).mockResolvedValueOnce({ mtimeMs: 7777 });
    mockCreateReadStream.mockReturnValue(stream);

    await controller.thumbnail(12, { userId: 1, isSuperuser: false } as never, reply);

    expect(coverStore.resolve).toHaveBeenCalledTimes(2);
    expect(reply.header).toHaveBeenCalledWith('ETag', '"7777"');
    expect(reply.send).toHaveBeenCalledWith(stream);
  });

  it('does not attempt a repair when the thumbnail stat fails for a reason other than a missing file', async () => {
    const { controller, coverStore } = makeController();
    coverStore.resolve.mockResolvedValue('/books/covers/42/ebook/thumbnail.jpg');
    mockStat.mockRejectedValue(Object.assign(new Error('permission denied'), { code: 'EACCES' }));

    await expect(controller.thumbnail(42, { userId: 7, isSuperuser: false } as never, makeReply())).rejects.toThrow(NotFoundException);
    expect(coverStore.resolve).toHaveBeenCalledTimes(1);
  });

  it('throws NotFoundException when thumbnail file is missing and no cover can rebuild it', async () => {
    const { controller, coverStore } = makeController();
    coverStore.resolve.mockResolvedValueOnce('/books/covers/42/ebook/thumbnail.jpg').mockResolvedValueOnce(null);
    mockStat.mockRejectedValue(Object.assign(new Error('missing thumbnail'), { code: 'ENOENT' }));

    await expect(controller.thumbnail(42, { userId: 7, isSuperuser: false } as never, makeReply())).rejects.toThrow(NotFoundException);
    expect(coverStore.resolve).toHaveBeenCalledTimes(2);
    expect(mockCreateReadStream).not.toHaveBeenCalled();
  });

  it('downloads file with sanitized attachment name', async () => {
    const { controller, opdsBookService } = makeController();
    const reply = makeReply();
    const stream = { kind: 'download-stream' };

    opdsBookService.getBookFiles.mockResolvedValue({
      absolutePath: '/books/library/book.epub',
      format: 'epub',
      title: 'Bad:/Title*',
      authorName: 'Au<th>or',
    });
    mockStat.mockResolvedValue({ size: 12345 } as never);
    mockCreateReadStream.mockReturnValue(stream as never);

    await controller.download(99, 0, { userId: 2, isSuperuser: false } as never, reply);

    expect(reply.header).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="BadTitle - Author.epub"; filename*=UTF-8\'\'BadTitle%20-%20Author.epub',
    );
    expect(reply.header).toHaveBeenCalledWith('Content-Length', 12345);
    expect(reply.type).toHaveBeenCalledWith('application/epub+zip');
    expect(reply.send).toHaveBeenCalledWith(stream);
  });

  it('throws NotFoundException when requested download file is unavailable', async () => {
    const { controller, opdsBookService } = makeController();
    opdsBookService.getBookFiles.mockResolvedValue(null);

    await expect(controller.download(88, 77, { userId: 2, isSuperuser: false } as never, makeReply())).rejects.toThrow(NotFoundException);
  });
});
