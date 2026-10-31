import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  analysisRuns,
  assetColors,
  assetFacetDecisions,
  assetFacetValues,
  assetFiles,
  assets,
  assetSearch,
  assetTags,
  captureTech,
  Database,
  facets,
  facetValues,
  tags,
  users,
} from '@moodboard/db';
import {
  AssetCard,
  AssetDetail,
  AssetQuery,
  AssetSearchResult,
  AuthorCount,
  EMPTY_CSS_TECHNIQUE,
  FacetFilter,
  FacetValueCount,
  STORAGE_SERVICE,
  StorageService,
  TrashItem,
  unconfirmedFacetKeys,
  VocabularyFacet,
} from '@moodboard/shared';
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  ne,
  notInArray,
  or,
  SQL,
  sql,
} from 'drizzle-orm';
import { DATABASE } from '../database.module';

/** A condition that one facet's selection contributes; dropped when counting that facet. */
interface FacetGroup {
  readonly facet: string;
  readonly valueIds: readonly string[];
}

/** What a count leaves out of the query: a facet's own selection, or the author filter. */
type Except = { facet: string } | 'author' | null;

/**
 * The one search (0005). The overview and the MCP tools `search_assets` / `get_asset` call this
 * service, never their own queries, so they cannot drift apart.
 */
@Injectable()
export class AssetSearchService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
  ) {}

  async vocabulary(): Promise<VocabularyFacet[]> {
    const rows = await this.db
      .select({
        key: facets.key,
        isMultiValue: facets.isMultiValue,
        facetLabel: facets.label,
        facetDescription: facets.description,
        value: facetValues.value,
        label: facetValues.label,
        description: facetValues.description,
      })
      .from(facets)
      .leftJoin(facetValues, eq(facetValues.facetId, facets.id))
      .orderBy(asc(facets.sortOrder), asc(facets.key), asc(facetValues.sortOrder));

    const byKey = new Map<string, VocabularyFacet & { values: VocabularyFacet['values'][number][] }>();
    for (const row of rows) {
      let facet = byKey.get(row.key);
      if (!facet) {
        facet = {
          key: row.key,
          isMultiValue: row.isMultiValue,
          label: row.facetLabel,
          description: row.facetDescription,
          values: [],
        };
        byKey.set(row.key, facet);
      }
      if (row.value !== null && row.label !== null) {
        facet.values.push({ value: row.value, label: row.label, description: row.description });
      }
    }
    return [...byKey.values()];
  }

  async search(query: AssetQuery): Promise<AssetSearchResult> {
    const groups = await this.resolveFacets(query.facet);
    const where = (except: Except = null) => this.conditions(query, groups, except);

    const cursor = query.cursor?.split('~');
    const page = await this.db
      .select({
        id: assets.id,
        title: assets.title,
        type: assets.type,
        status: assets.status,
        statusReason: assets.statusReason,
        sourceUrl: assets.sourceUrl,
        createdAt: assets.createdAt,
        micros: sql<string>`(extract(epoch from ${assets.createdAt}) * 1000000)::bigint::text`,
        authorId: users.id,
        authorName: users.displayName,
      })
      .from(assets)
      .innerJoin(users, eq(users.id, assets.createdBy))
      .where(
        and(
          ...where(),
          cursor
            ? sql`(${assets.createdAt}, ${assets.id}) < ('epoch'::timestamptz + ${cursor[0]}::bigint * interval '1 microsecond', ${cursor[1]}::uuid)`
            : undefined,
        ),
      )
      .orderBy(desc(assets.createdAt), desc(assets.id))
      .limit(query.limit + 1);

    const hasMore = page.length > query.limit;
    const rows = hasMore ? page.slice(0, query.limit) : page;
    const last = rows.at(-1);

    const [items, [{ total }], facetCounts, authors] = await Promise.all([
      this.cards(rows),
      this.db.select({ total: count() }).from(assets).where(and(...where())),
      this.facetCounts(groups, where),
      this.authorCounts(where('author')),
    ]);

    return {
      items,
      nextCursor: hasMore && last ? `${last.micros}~${last.id}` : null,
      total,
      counts: { facets: facetCounts, authors },
    };
  }

  async detail(id: string): Promise<AssetDetail | null> {
    const [asset] = await this.db
      .select({
        id: assets.id,
        title: assets.title,
        type: assets.type,
        status: assets.status,
        statusReason: assets.statusReason,
        description: assets.description,
        descriptionOrigin: assets.descriptionOrigin,
        titleOrigin: assets.titleOrigin,
        designNotes: assets.designNotes,
        designNotesOrigin: assets.designNotesOrigin,
        sourceUrl: assets.sourceUrl,
        createdAt: assets.createdAt,
        updatedAt: assets.updatedAt,
        authorId: users.id,
        authorName: users.displayName,
      })
      .from(assets)
      .innerJoin(users, eq(users.id, assets.createdBy))
      .where(and(eq(assets.id, id), isNull(assets.deletedAt)));
    if (!asset) {
      return null;
    }

    const [files, facetRows, tagRows, colors, [run], decisions, [tech]] = await Promise.all([
      this.db
        .select({
          kind: assetFiles.kind,
          path: assetFiles.path,
          mime: assetFiles.mime,
          width: assetFiles.width,
          height: assetFiles.height,
          bytes: assetFiles.bytes,
        })
        .from(assetFiles)
        .where(eq(assetFiles.assetId, id)),
      this.db
        .select({
          facet: facets.key,
          value: facetValues.value,
          origin: assetFacetValues.origin,
          confidence: assetFacetValues.confidence,
        })
        .from(assetFacetValues)
        .innerJoin(facetValues, eq(facetValues.id, assetFacetValues.facetValueId))
        .innerJoin(facets, eq(facets.id, facetValues.facetId))
        .where(eq(assetFacetValues.assetId, id))
        .orderBy(asc(facets.sortOrder), asc(facetValues.sortOrder)),
      this.db
        .select({ name: tags.name, origin: assetTags.origin })
        .from(assetTags)
        .innerJoin(tags, eq(tags.id, assetTags.tagId))
        .where(eq(assetTags.assetId, id))
        .orderBy(asc(tags.name)),
      this.db
        .select({ hex: assetColors.hex, ratio: assetColors.ratio })
        .from(assetColors)
        .where(eq(assetColors.assetId, id))
        .orderBy(asc(assetColors.position)),
      this.db
        .select({
          provider: analysisRuns.provider,
          model: analysisRuns.model,
          promptVersion: analysisRuns.promptVersion,
          createdAt: analysisRuns.createdAt,
        })
        .from(analysisRuns)
        .where(and(eq(analysisRuns.assetId, id), eq(analysisRuns.status, 'succeeded')))
        .orderBy(desc(analysisRuns.createdAt))
        .limit(1),
      this.db
        .select({ facet: facets.key })
        .from(assetFacetDecisions)
        .innerJoin(facets, eq(facets.id, assetFacetDecisions.facetId))
        .where(eq(assetFacetDecisions.assetId, id))
        .orderBy(asc(facets.sortOrder)),
      this.db.select().from(captureTech).where(eq(captureTech.assetId, id)).limit(1),
    ]);

    return {
      id: asset.id,
      title: asset.title,
      type: asset.type,
      status: asset.status,
      statusReason: asset.statusReason,
      description: asset.description,
      descriptionOrigin: asset.descriptionOrigin,
      titleOrigin: asset.titleOrigin,
      designNotes: asset.designNotes,
      designNotesOrigin: asset.designNotesOrigin,
      sourceUrl: asset.sourceUrl,
      createdAt: asset.createdAt.toISOString(),
      updatedAt: asset.updatedAt.toISOString(),
      author: { id: asset.authorId, displayName: asset.authorName },
      files: files.map(({ path, ...file }) => ({ ...file, url: this.storage.url(path) })),
      facets: facetRows,
      tags: tagRows,
      colors,
      classification: run
        ? { ...run, createdAt: run.createdAt.toISOString() }
        : null,
      decidedFacets: decisions.map((d) => d.facet),
      captureTech: tech
        ? {
            fonts: tech.fonts,
            libraries: tech.libraries,
            css: { ...EMPTY_CSS_TECHNIQUE, ...tech.cssProperties },
            tokens: tech.tokens,
            elements: tech.elements,
            pageTitle: tech.pageTitle,
            viewport: tech.viewport,
            capturedAt: tech.capturedAt.toISOString(),
          }
        : null,
    };
  }

  /** The trash (0006): own assets for members, everyone's for admins (§9), newest deletion first. */
  async trash(
    user: { id: string; role: string },
    retentionDays: number,
  ): Promise<TrashItem[]> {
    const rows = await this.db
      .select({
        id: assets.id,
        title: assets.title,
        type: assets.type,
        status: assets.status,
        statusReason: assets.statusReason,
        sourceUrl: assets.sourceUrl,
        createdAt: assets.createdAt,
        deletedAt: assets.deletedAt,
        authorId: users.id,
        authorName: users.displayName,
      })
      .from(assets)
      .innerJoin(users, eq(users.id, assets.createdBy))
      .where(
        and(
          isNotNull(assets.deletedAt),
          user.role === 'admin' ? undefined : eq(assets.createdBy, user.id),
        ),
      )
      .orderBy(desc(assets.deletedAt))
      .limit(500);

    const cards = new Map((await this.cards(rows)).map((c) => [c.id, c]));
    return rows.map((row) => {
      const deletedAt = row.deletedAt as Date;
      return {
        ...(cards.get(row.id) as AssetCard),
        deletedAt: deletedAt.toISOString(),
        purgeAt: new Date(deletedAt.getTime() + retentionDays * 86_400_000).toISOString(),
      };
    });
  }

  /**
   * Turns `style:editorial` into value ids, grouped by facet. An unknown facet or value is a
   * `400`, not an empty result: otherwise an agent cannot tell a bad filter from an empty one.
   */
  private async resolveFacets(filters: readonly FacetFilter[]): Promise<FacetGroup[]> {
    if (filters.length === 0) {
      return [];
    }
    const known = await this.db
      .select({ id: facetValues.id, facet: facets.key, value: facetValues.value })
      .from(facetValues)
      .innerJoin(facets, eq(facets.id, facetValues.facetId))
      .where(inArray(facets.key, [...new Set(filters.map((f) => f.facet))]));
    const ids = new Map(known.map((row) => [`${row.facet}:${row.value}`, row.id]));

    const groups = new Map<string, string[]>();
    for (const { facet, value } of filters) {
      const id = ids.get(`${facet}:${value}`);
      if (!id) {
        throw new BadRequestException(
          `Unknown facet value "${facet}:${value}" — see GET /api/vocabulary`,
        );
      }
      groups.set(facet, [...(groups.get(facet) ?? []), id]);
    }
    return [...groups].map(([facet, valueIds]) => ({ facet, valueIds }));
  }

  /**
   * Values within one facet are OR (one `exists` per facet over all its selected values), facets
   * with each other AND. Pending assets are listed, failed uploads are not (0005) — a broken file
   * is nothing to look at. A failed website is: its capture can be retried, and it is the only
   * place the person learns why it failed (0011).
   */
  private conditions(query: AssetQuery, groups: readonly FacetGroup[], except: Except): SQL[] {
    const conditions: SQL[] = [
      isNull(assets.deletedAt),
      or(ne(assets.status, 'failed'), eq(assets.type, 'website')) as SQL,
    ];

    for (const group of groups) {
      if (except !== null && except !== 'author' && except.facet === group.facet) {
        continue;
      }
      conditions.push(sql`exists (
        select 1 from ${assetFacetValues}
        where ${assetFacetValues.assetId} = ${assets.id}
          and ${inArray(assetFacetValues.facetValueId, [...group.valueIds])})`);
    }

    for (const tag of query.tag) {
      conditions.push(this.hasTag(tag));
    }

    // Tags stay out of the English tsvector (§13.4), so a search also matches a tag exactly.
    if (query.q) {
      conditions.push(sql`(exists (
        select 1 from ${assetSearch}
        where ${assetSearch.assetId} = ${assets.id}
          and ${assetSearch.tsv} @@ websearch_to_tsquery('english', ${query.q}))
        or ${this.hasTag(query.q)})`);
    }

    if (query.author && except !== 'author') {
      conditions.push(eq(assets.createdBy, query.author));
    }
    return conditions;
  }

  private hasTag(name: string): SQL {
    return sql`exists (
      select 1 from ${assetTags} inner join ${tags} on ${tags.id} = ${assetTags.tagId}
      where ${assetTags.assetId} = ${assets.id} and lower(${tags.name}) = lower(${name}))`;
  }

  /**
   * For every value: how many matching assets carry it. Facets without a selection share one
   * query; a facet with a selection is counted without it, so selecting `editorial` does not drop
   * the count on `swiss` to zero.
   */
  private async facetCounts(
    groups: readonly FacetGroup[],
    where: (except?: Except) => SQL[],
  ): Promise<FacetValueCount[]> {
    const countFor = (facetCondition: SQL, conditions: SQL[]) =>
      this.db
        .select({ facet: facets.key, value: facetValues.value, count: count() })
        .from(assetFacetValues)
        .innerJoin(assets, eq(assets.id, assetFacetValues.assetId))
        .innerJoin(facetValues, eq(facetValues.id, assetFacetValues.facetValueId))
        .innerJoin(facets, eq(facets.id, facetValues.facetId))
        .where(and(facetCondition, ...conditions))
        .groupBy(facets.key, facetValues.value);

    const selected = groups.map((group) => group.facet);
    const results = await Promise.all([
      countFor(
        selected.length > 0 ? notInArray(facets.key, selected) : sql`true`,
        where(),
      ),
      ...groups.map((group) =>
        countFor(eq(facets.key, group.facet), where({ facet: group.facet })),
      ),
    ]);
    return results.flat();
  }

  private authorCounts(conditions: SQL[]): Promise<AuthorCount[]> {
    return this.db
      .select({ id: users.id, displayName: users.displayName, count: count() })
      .from(assets)
      .innerJoin(users, eq(users.id, assets.createdBy))
      .where(and(...conditions))
      .groupBy(users.id, users.displayName)
      .orderBy(asc(users.displayName));
  }

  private async cards(
    rows: ReadonlyArray<{
      id: string;
      title: string | null;
      type: string;
      status: AssetCard['status'];
      statusReason: AssetCard['statusReason'];
      sourceUrl: string | null;
      createdAt: Date;
      authorId: string;
      authorName: string;
    }>,
  ): Promise<AssetCard[]> {
    if (rows.length === 0) {
      return [];
    }
    const ids = rows.map((row) => row.id);

    const [thumbs, facetRows, tagRows, classified, decisions] = await Promise.all([
      this.db
        .select({
          assetId: assetFiles.assetId,
          path: assetFiles.path,
          width: assetFiles.width,
          height: assetFiles.height,
        })
        .from(assetFiles)
        .where(and(inArray(assetFiles.assetId, ids), eq(assetFiles.kind, 'thumb_md'))),
      this.db
        .select({
          assetId: assetFacetValues.assetId,
          facet: facets.key,
          value: facetValues.value,
          origin: assetFacetValues.origin,
        })
        .from(assetFacetValues)
        .innerJoin(facetValues, eq(facetValues.id, assetFacetValues.facetValueId))
        .innerJoin(facets, eq(facets.id, facetValues.facetId))
        .where(inArray(assetFacetValues.assetId, ids))
        .orderBy(asc(facets.sortOrder), asc(facetValues.sortOrder)),
      this.db
        .select({ assetId: assetTags.assetId, name: tags.name })
        .from(assetTags)
        .innerJoin(tags, eq(tags.id, assetTags.tagId))
        .where(inArray(assetTags.assetId, ids))
        .orderBy(asc(tags.name)),
      this.db
        .selectDistinct({ assetId: analysisRuns.assetId })
        .from(analysisRuns)
        .where(and(inArray(analysisRuns.assetId, ids), eq(analysisRuns.status, 'succeeded'))),
      this.db
        .select({ assetId: assetFacetDecisions.assetId, facet: facets.key })
        .from(assetFacetDecisions)
        .innerJoin(facets, eq(facets.id, assetFacetDecisions.facetId))
        .where(inArray(assetFacetDecisions.assetId, ids)),
    ]);

    const thumbBy = new Map(thumbs.map((t) => [t.assetId, t]));
    const classifiedIds = new Set(classified.map((c) => c.assetId));
    const group = <T extends { assetId: string }>(list: T[]) => {
      const map = new Map<string, T[]>();
      for (const item of list) {
        map.set(item.assetId, [...(map.get(item.assetId) ?? []), item]);
      }
      return map;
    };
    const facetsBy = group(facetRows);
    const tagsBy = group(tagRows);
    const decidedBy = group(decisions);

    return rows.map((row) => {
      const thumb = thumbBy.get(row.id);
      const values = (facetsBy.get(row.id) ?? []).map(({ facet, value, origin }) => ({
        facet,
        value,
        origin,
      }));
      return {
        id: row.id,
        title: row.title,
        type: row.type,
        status: row.status,
        statusReason: row.statusReason,
        sourceUrl: row.sourceUrl,
        classified: classifiedIds.has(row.id),
        createdAt: row.createdAt.toISOString(),
        author: { id: row.authorId, displayName: row.authorName },
        thumbnail: thumb
          ? { url: this.storage.url(thumb.path), width: thumb.width, height: thumb.height }
          : null,
        facets: values,
        tags: (tagsBy.get(row.id) ?? []).map((t) => t.name),
        unconfirmedFacets: unconfirmedFacetKeys(
          values,
          (decidedBy.get(row.id) ?? []).map((d) => d.facet),
        ).length,
      };
    });
  }
}
