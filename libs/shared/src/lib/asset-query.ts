import { z } from 'zod';
import { LocalizedText } from './localized-text';
import { AssetStatus, Origin } from './asset-file';

/**
 * The one search query (0005). The web overview parses its URL into this schema, `GET
 * /api/assets` parses its query string into it, and the MCP tool `search_assets` will take it as
 * its input — so an agent and a human with the same filter see the same result.
 *
 * Semantics: values within one facet are OR, facets with each other are AND, tags and author are
 * AND with everything else. `style:editorial + style:swiss + theme:dark` is
 * *(editorial or swiss) and dark*.
 */

export const DEFAULT_PAGE_SIZE = 60;
export const MAX_PAGE_SIZE = 100;

/** A query string key given once arrives as a string, given twice as an array. */
const many = <T extends z.ZodType>(item: T, max: number) =>
  z.preprocess(
    (value) => (value === undefined ? [] : Array.isArray(value) ? value : [value]),
    z.array(item).max(max),
  );

/** An empty `?q=` is no search, not a search for nothing. */
const optionalText = (max: number) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().trim().max(max).optional(),
  );

export interface FacetFilter {
  readonly facet: string;
  readonly value: string;
}

/** `style:editorial` → `{ facet: 'style', value: 'editorial' }`. Keys, never labels (§13.3). */
export const FacetFilterSchema = z
  .string()
  .regex(/^[a-z_]{1,64}:[^:\s]{1,64}$/, 'Expected <facet>:<value>, e.g. style:editorial')
  .transform((raw): FacetFilter => {
    const [facet, value] = raw.split(':');
    return { facet, value };
  });

/**
 * Keyset position: the creation time in microseconds since the epoch, and the id as tie-breaker.
 * Microseconds rather than an ISO string, because Postgres stores microseconds and a `Date` only
 * milliseconds — a cursor rounded to milliseconds skips or repeats assets created in the same one.
 */
export const CURSOR_PATTERN = /^\d{1,20}~[0-9a-f-]{36}$/;

export const AssetQuerySchema = z
  .object({
    facet: many(FacetFilterSchema, 50),
    q: optionalText(200),
    tag: many(z.string().trim().min(1).max(100), 20),
    author: z.uuid().optional(),
    cursor: z.string().regex(CURSOR_PATTERN, 'Invalid cursor').optional(),
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  })
  .strict();

export type AssetQuery = z.infer<typeof AssetQuerySchema>;

/** The URL form of a query, for links and for the web client. Omits what is empty. */
export function assetQueryParams(
  query: Partial<AssetQuery>,
): Record<string, string | string[]> {
  const params: Record<string, string | string[]> = {};
  if (query.facet?.length) {
    params['facet'] = query.facet.map((f) => `${f.facet}:${f.value}`);
  }
  if (query.q) {
    params['q'] = query.q;
  }
  if (query.tag?.length) {
    params['tag'] = [...query.tag];
  }
  if (query.author) {
    params['author'] = query.author;
  }
  if (query.cursor) {
    params['cursor'] = query.cursor;
  }
  if (query.limit !== undefined && query.limit !== DEFAULT_PAGE_SIZE) {
    params['limit'] = String(query.limit);
  }
  return params;
}

// ---------------------------------------------------------------------------------------------
// Result shapes. `search_assets` and `get_asset` return these unchanged (0005, MCP impact).
// Labels are deliberately absent: they come from the vocabulary, keyed by facet and value.
// ---------------------------------------------------------------------------------------------

export interface AssetAuthor {
  readonly id: string;
  readonly displayName: string;
}

export interface AssetCard {
  readonly id: string;
  readonly title: string | null;
  readonly type: string;
  readonly status: AssetStatus;
  /** A succeeded classification run exists. Unclassified assets have no facets yet. */
  readonly classified: boolean;
  readonly createdAt: string;
  readonly author: AssetAuthor;
  /** `thumb-md`; `null` until the `thumbnails` step has run. */
  readonly thumbnail: {
    readonly url: string;
    readonly width: number | null;
    readonly height: number | null;
  } | null;
  readonly facets: readonly FacetFilter[];
  readonly tags: readonly string[];
}

export interface FacetValueCount {
  readonly facet: string;
  readonly value: string;
  /**
   * How many matching assets carry this value, counted without this facet's own selection. For a
   * facet with nothing selected that is the result after selecting the value; within a facet that
   * already has a selection, it is how many assets the value would add at most (values are OR).
   */
  readonly count: number;
}

export interface AuthorCount extends AssetAuthor {
  readonly count: number;
}

export interface AssetSearchResult {
  readonly items: readonly AssetCard[];
  readonly nextCursor: string | null;
  /** Size of the whole result, not of this page. */
  readonly total: number;
  readonly counts: {
    readonly facets: readonly FacetValueCount[];
    readonly authors: readonly AuthorCount[];
  };
}

export interface AssetDetail {
  readonly id: string;
  readonly title: string | null;
  readonly type: string;
  readonly status: AssetStatus;
  readonly description: string | null;
  readonly descriptionOrigin: Origin;
  readonly sourceUrl: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly author: AssetAuthor;
  readonly files: readonly {
    readonly kind: string;
    readonly url: string;
    readonly mime: string;
    readonly width: number | null;
    readonly height: number | null;
    readonly bytes: number;
  }[];
  readonly facets: readonly (FacetFilter & {
    readonly origin: Origin;
    readonly confidence: number | null;
  })[];
  readonly tags: readonly { readonly name: string; readonly origin: Origin }[];
  readonly colors: readonly { readonly hex: string; readonly ratio: number }[];
  /** The latest succeeded run — how this classification came about. */
  readonly classification: {
    readonly provider: string;
    readonly model: string;
    readonly promptVersion: number;
    readonly createdAt: string;
  } | null;
}

/** `GET /api/vocabulary`, and later `list_vocabulary`. Ordered by `sort_order`. */
export interface VocabularyFacet {
  readonly key: string;
  readonly isMultiValue: boolean;
  readonly label: LocalizedText;
  readonly description: LocalizedText | null;
  readonly values: readonly {
    readonly value: string;
    readonly label: LocalizedText;
    readonly description: LocalizedText | null;
  }[];
}
