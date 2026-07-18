import {
  BadRequestException,
  Controller,
  DefaultValuePipe,
  Get,
  Headers,
  NotFoundException,
  Param,
  ParseIntPipe,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { createReadStream } from 'fs';
import { readdir, stat } from 'fs/promises';
import { join } from 'path';
import { ConfigService } from '@nestjs/config';
import type { FastifyReply } from 'fastify';

import { bookCoverDirPath, bookThumbnailPath, findPreferredBookCoverFileName } from '../../common/book-cover-storage';
import { MAX_OFFSET_ROWS, isOffsetWithinLimit } from '../../common/constants/pagination.constants';
import { Public } from '../../common/decorators/public.decorator';
import { imageContentTypeFromPath } from '../../common/image-content-type';
import { contentDispositionHeader } from '../../common/utils/content-disposition.utils';
import { OPDS_MIME_ACQ, OPDS_MIME_NAV, OPDS_MIME_SEARCH, fileMimeType } from './opds-xml.helpers';
import { OpdsAuthGuard } from './opds-auth.guard';
import type { OpdsRequestUser } from './opds-auth.guard';
import { OpdsEnabledGuard } from './opds-enabled.guard';
import { OpdsUser } from './opds-user.decorator';
import { OpdsBookService } from './opds-book.service';
import type { OpdsBookEntry } from './opds-book.service';
import { OpdsService } from './opds.service';
import { parseSortParam } from './opds-sort.helpers';
import { BookService } from '../book/book.service';

@Controller('opds')
@Public()
@UseGuards(OpdsEnabledGuard, OpdsAuthGuard)
export class OpdsController {
  private readonly appDataPath: string;

  constructor(
    private readonly opdsService: OpdsService,
    private readonly opdsBookService: OpdsBookService,
    private readonly config: ConfigService,
    private readonly bookService: BookService,
  ) {
    this.appDataPath = this.config.get<string>('storage.appDataPath')!;
  }

  private assertPaginationWindow(page: number, size: number): void {
    if (!isOffsetWithinLimit((page - 1) * size)) {
      throw new BadRequestException(`pagination window is too deep; (page - 1) * size must be <= ${MAX_OFFSET_ROWS}`);
    }
  }

  @Get()
  root(@OpdsUser() _user: OpdsRequestUser, @Res() reply: FastifyReply) {
    const xml = this.opdsService.generateRootNavigation();
    this.sendXml(reply, xml, OPDS_MIME_NAV);
  }

  @Get('libraries')
  async libraries(@OpdsUser() user: OpdsRequestUser, @Res() reply: FastifyReply) {
    const libs = await this.opdsBookService.getAccessibleLibraries(user.userId, user.isSuperuser);
    const xml = this.opdsService.generateLibrariesNavigation(libs);
    this.sendXml(reply, xml, OPDS_MIME_NAV);
  }

  @Get('collections')
  async collections(@OpdsUser() user: OpdsRequestUser, @Res() reply: FastifyReply) {
    const cols = await this.opdsBookService.getUserCollections(user.userId);
    const xml = this.opdsService.generateCollectionsNavigation(cols);
    this.sendXml(reply, xml, OPDS_MIME_NAV);
  }

  @Get('smart-scopes')
  async smartScopes(@OpdsUser() user: OpdsRequestUser, @Res() reply: FastifyReply) {
    const items = await this.opdsBookService.getUserSmartScopes(user.userId);
    const xml = this.opdsService.generateSmartScopesNavigation(items);
    this.sendXml(reply, xml, OPDS_MIME_NAV);
  }

  @Get('authors')
  async authors(
    @OpdsUser() user: OpdsRequestUser,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('size', new DefaultValuePipe(50), ParseIntPipe) size: number,
    @Res() reply?: FastifyReply,
  ) {
    const clampedSize = Math.min(Math.max(size, 1), 100);
    const clampedPage = Math.max(page, 1);
    this.assertPaginationWindow(clampedPage, clampedSize);

    const { items, hasNext } = await this.opdsBookService.getDistinctAuthorsPage(
      user.userId,
      { limit: clampedSize, offset: (clampedPage - 1) * clampedSize },
      user.isSuperuser,
      user.contentFilters,
    );
    const xml = this.opdsService.generateAuthorsNavigation(items, clampedPage, clampedSize, hasNext);
    this.sendXml(reply!, xml, OPDS_MIME_NAV);
  }

  @Get('series')
  async series(@OpdsUser() user: OpdsRequestUser, @Res() reply: FastifyReply) {
    const items = await this.opdsBookService.getDistinctSeries(user.userId, user.isSuperuser, user.contentFilters);
    const xml = this.opdsService.generateSeriesNavigation(items.filter((s): s is { id: number; name: string; bookCount: number } => s.name !== null));
    this.sendXml(reply, xml, OPDS_MIME_NAV);
  }

  @Get('catalog')
  async catalog(
    @OpdsUser() user: OpdsRequestUser,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('size', new DefaultValuePipe(50), ParseIntPipe) size: number,
    @Query('libraryId') libraryIdStr?: string,
    @Query('collectionId') collectionIdStr?: string,
    @Query('smartScopeId') smartScopeIdStr?: string,
    @Query('author') author?: string,
    @Query('series') series?: string,
    @Query('q') q?: string,
    @Res() reply?: FastifyReply,
    @Query('seriesId') seriesIdStr?: string,
    @Query('sort') sortStr?: string,
  ) {
    const clampedSize = Math.min(Math.max(size, 1), 100);
    const clampedPage = Math.max(page, 1);
    this.assertPaginationWindow(clampedPage, clampedSize);

    const sortOrder = parseSortParam(sortStr, user.sortOrder);

    const filters: Record<string, string | number> = {};
    const libraryId = this.parseOptionalPositiveInt('libraryId', libraryIdStr);
    const collectionId = this.parseOptionalPositiveInt('collectionId', collectionIdStr);
    const smartScopeId = this.parseOptionalPositiveInt('smartScopeId', smartScopeIdStr);
    const seriesId = this.parseOptionalPositiveInt('seriesId', seriesIdStr);

    if (libraryId !== undefined) filters.libraryId = libraryId;
    if (collectionId !== undefined) filters.collectionId = collectionId;
    if (smartScopeId !== undefined) filters.smartScopeId = smartScopeId;
    if (seriesId !== undefined) filters.seriesId = seriesId;
    if (author) filters.author = author;
    if (series) filters.series = series;
    if (q) filters.q = q;

    const { entries, total } = await this.opdsBookService.getBooksPage(
      user.userId,
      sortOrder,
      clampedPage,
      clampedSize,
      filters,
      user.isSuperuser,
      user.contentFilters,
    );

    const selfParams = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) selfParams.set(k, String(v));
    selfParams.set('page', String(clampedPage));
    selfParams.set('size', String(clampedSize));
    selfParams.set('sort', sortOrder);
    const selfPath = `/api/v1/opds/catalog?${selfParams.toString()}`;

    const filterSuffix = Object.entries(filters)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${encodeURIComponent(String(v))}`)
      .join(':');
    const feedId = filterSuffix ? `urn:bookorbit:catalog:${filterSuffix}` : 'urn:bookorbit:catalog';

    const feedTitle = q ? `Search: ${q}` : 'Catalog';
    const upPath = author ? '/api/v1/opds/authors' : undefined;
    const asciiByLibrary = await this.buildAsciiByLibrary(entries);
    const xml = this.opdsService.generateAcquisitionFeed(
      feedTitle,
      feedId,
      entries,
      total,
      clampedPage,
      clampedSize,
      selfPath,
      user.coverToken,
      sortOrder,
      asciiByLibrary,
      upPath,
    );
    this.sendXml(reply!, xml, OPDS_MIME_ACQ);
  }

  @Get('recent')
  async recent(
    @OpdsUser() user: OpdsRequestUser,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('size', new DefaultValuePipe(50), ParseIntPipe) size: number,
    @Res() reply?: FastifyReply,
  ) {
    const clampedSize = Math.min(Math.max(size, 1), 100);
    const clampedPage = Math.max(page, 1);
    this.assertPaginationWindow(clampedPage, clampedSize);

    const { entries, total } = await this.opdsBookService.getRecentBooksPage(
      user.userId,
      clampedPage,
      clampedSize,
      user.isSuperuser,
      user.contentFilters,
    );
    const selfPath = `/api/v1/opds/recent?page=${clampedPage}&size=${clampedSize}`;
    const asciiByLibrary = await this.buildAsciiByLibrary(entries);
    const xml = this.opdsService.generateAcquisitionFeed(
      'Recent Books',
      'urn:bookorbit:recent',
      entries,
      total,
      clampedPage,
      clampedSize,
      selfPath,
      user.coverToken,
      undefined,
      asciiByLibrary,
    );
    this.sendXml(reply!, xml, OPDS_MIME_ACQ);
  }

  @Get('surprise')
  async surprise(@OpdsUser() user: OpdsRequestUser, @Res() reply: FastifyReply) {
    const entries = await this.opdsBookService.getRandomBooks(user.userId, 25, user.isSuperuser, user.contentFilters);
    const asciiByLibrary = await this.buildAsciiByLibrary(entries);
    const xml = this.opdsService.generateAcquisitionFeed(
      'Random Books',
      'urn:bookorbit:surprise',
      entries,
      entries.length,
      1,
      25,
      '/api/v1/opds/surprise',
      user.coverToken,
      undefined,
      asciiByLibrary,
    );
    this.sendXml(reply, xml, OPDS_MIME_ACQ);
  }

  @Get('search.opds')
  searchDescription(@OpdsUser() _user: OpdsRequestUser, @Res() reply: FastifyReply) {
    const xml = this.opdsService.generateOpenSearchDescription();
    reply.type(`${OPDS_MIME_SEARCH}; charset=utf-8`).send(xml);
  }

  @Get(':bookId/cover')
  async cover(
    @Param('bookId', ParseIntPipe) bookId: number,
    @OpdsUser() user: OpdsRequestUser,
    @Res() reply: FastifyReply,
    @Headers('if-none-match') ifNoneMatch?: string,
  ) {
    await this.opdsBookService.validateBookAccess(bookId, user.userId, user.isSuperuser, user.contentFilters);
    reply.header('Cross-Origin-Resource-Policy', 'cross-origin');
    const dir = bookCoverDirPath(this.appDataPath, bookId);
    try {
      const files = await readdir(dir);
      const cover = findPreferredBookCoverFileName(files);
      if (!cover) throw new NotFoundException('No cover');
      const coverPath = join(dir, cover);
      const { mtimeMs } = await stat(coverPath);
      const etag = `"${Math.floor(mtimeMs)}"`;
      if (ifNoneMatch === etag) {
        reply.status(304).send();
        return;
      }
      reply.header('Cache-Control', 'no-cache');
      reply.header('ETag', etag);
      reply.type(imageContentTypeFromPath(coverPath));
      reply.send(createReadStream(coverPath));
    } catch {
      throw new NotFoundException('No cover');
    }
  }

  @Get(':bookId/thumbnail')
  async thumbnail(
    @Param('bookId', ParseIntPipe) bookId: number,
    @OpdsUser() user: OpdsRequestUser,
    @Res() reply: FastifyReply,
    @Headers('if-none-match') ifNoneMatch?: string,
  ) {
    await this.opdsBookService.validateBookAccess(bookId, user.userId, user.isSuperuser, user.contentFilters);
    reply.header('Cross-Origin-Resource-Policy', 'cross-origin');
    const thumbnailPath = bookThumbnailPath(this.appDataPath, bookId);
    try {
      const { mtimeMs } = await stat(thumbnailPath);
      const etag = `"${Math.floor(mtimeMs)}"`;
      if (ifNoneMatch === etag) {
        reply.status(304).send();
        return;
      }
      reply.header('Cache-Control', 'no-cache');
      reply.header('ETag', etag);
      reply.type('image/jpeg');
      reply.send(createReadStream(thumbnailPath));
    } catch {
      throw new NotFoundException('No thumbnail');
    }
  }

  @Get(':bookId/download')
  async download(
    @Param('bookId', ParseIntPipe) bookId: number,
    @Query('fileId', new DefaultValuePipe(0), ParseIntPipe) fileId: number,
    @OpdsUser() user: OpdsRequestUser,
    @Res() reply: FastifyReply,
  ) {
    await this.opdsBookService.validateBookAccess(bookId, user.userId, user.isSuperuser, user.contentFilters);

    const bookFiles = await this.opdsBookService.getBookFiles(bookId, fileId);
    if (!bookFiles) throw new NotFoundException('File not found');

    const { absolutePath, format } = bookFiles;
    const { size: fileSize } = await stat(absolutePath);
    const mime = fileMimeType(format);

    const filename = await this.bookService.resolveDownloadFilename({
      bookId,
      absolutePath,
      format: format === 'unknown' ? null : format,
    });

    reply.header('Content-Disposition', contentDispositionHeader('attachment', filename, 'download'));
    reply.header('Content-Length', fileSize);
    reply.type(mime);
    reply.send(createReadStream(absolutePath));
  }

  private sendXml(reply: FastifyReply, xml: string, mimeType: string) {
    reply.type(`${mimeType}; charset=utf-8`).send(xml);
  }

  // A single feed spans multiple libraries, so resolve the ASCII-only flag per entry.
  // One query over the distinct library IDs already present in the page avoids N+1.
  private async buildAsciiByLibrary(entries: OpdsBookEntry[]): Promise<Map<number, boolean>> {
    const libraryIds = [...new Set(entries.map((e) => e.libraryId))];
    return this.opdsBookService.getOpdsAsciiOnlyByLibrary(libraryIds);
  }

  private parseOptionalPositiveInt(name: string, value?: string): number | undefined {
    if (value === undefined) return undefined;
    if (!/^\d+$/.test(value)) {
      throw new BadRequestException(`${name} must be a positive integer`);
    }

    const parsed = Number.parseInt(value, 10);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      throw new BadRequestException(`${name} must be a positive integer`);
    }
    return parsed;
  }
}
