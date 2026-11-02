import { z } from 'zod';
import { AssetAuthor, AssetDetail, AssetQuerySchema, FacetFilter } from './asset-query';

/**
 * Boards (0019, §5.4): a curated combination of assets for a purpose — the package handed to an
 * AI to work from. Facets say what an asset is; a board item's role says which aspect of it is
 * meant here, and its weight whether it is wanted or a counter-example.
 *
 * Kinds, roles and weights are machine-readable keys, never translated (§13.3).
 */

export const BOARD_KINDS = ['manual', 'smart'] as const;
export type BoardKind = (typeof BOARD_KINDS)[number];

export const BOARD_ROLES = [
  'overall',
  'color',
  'layout',
  'typography',
  'motion',
  'imagery',
  'copy',
] as const;
export const BoardRoleSchema = z.enum(BOARD_ROLES);
export type BoardRole = z.infer<typeof BoardRoleSchema>;

export const BOARD_WEIGHTS = ['primary', 'secondary', 'avoid'] as const;
export const BoardWeightSchema = z.enum(BOARD_WEIGHTS);
export type BoardWeight = z.infer<typeof BoardWeightSchema>;

/** Beyond this a board no longer briefs anyone. */
export const MAX_BOARD_ITEMS = 100;
/** A smart board shows the newest of its filter's result, at most this many. */
export const SMART_BOARD_LIMIT = 60;

const title = z.string().trim().min(1).max(200);
const briefing = z.string().trim().max(8000);

/**
 * A smart board's filter in its URL form (`assetQueryParams`), the same contract as the overview's
 * URL. Paging and the review queue are not part of a filter.
 */
export const BoardFilterSchema = z
  .record(z.string(), z.union([z.string(), z.array(z.string())]))
  .transform((params, ctx) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { cursor, limit, review, ...rest } = params;
    const parsed = AssetQuerySchema.safeParse(rest);
    if (!parsed.success) {
      ctx.addIssue({ code: 'custom', message: z.prettifyError(parsed.error) });
      return z.NEVER;
    }
    const q = parsed.data;
    if (q.facet.length === 0 && q.tag.length === 0 && !q.q && !q.author) {
      ctx.addIssue({ code: 'custom', message: 'A smart board needs at least one filter' });
      return z.NEVER;
    }
    return q;
  });

/** `POST /api/boards`. With a filter the board is smart, without one manual. */
export const BoardCreateSchema = z
  .object({
    title,
    briefing: briefing.default(''),
    filter: BoardFilterSchema.optional(),
  })
  .strict();
export type BoardCreate = z.input<typeof BoardCreateSchema>;

/** `PATCH /api/boards/:id`. */
export const BoardPatchSchema = z
  .object({ title: title.optional(), briefing: briefing.optional() })
  .strict()
  .refine((patch) => patch.title !== undefined || patch.briefing !== undefined, {
    message: 'Nothing to change: send title and/or briefing',
  });
export type BoardPatch = z.infer<typeof BoardPatchSchema>;

/** `POST /api/boards/:id/items`: appended in the given order; ones already there are skipped. */
export const BoardItemsAddSchema = z
  .object({
    assetIds: z.array(z.uuid()).min(1).max(MAX_BOARD_ITEMS),
    role: BoardRoleSchema.default('overall'),
    weight: BoardWeightSchema.default('primary'),
  })
  .strict();
export type BoardItemsAdd = z.input<typeof BoardItemsAddSchema>;

/** `PATCH /api/boards/:id/items/:itemId`. An empty note clears it. */
export const BoardItemPatchSchema = z
  .object({
    role: BoardRoleSchema.optional(),
    weight: BoardWeightSchema.optional(),
    note: z
      .preprocess(
        (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
        z.string().trim().max(1000).nullable(),
      )
      .optional(),
  })
  .strict()
  .refine((p) => p.role !== undefined || p.weight !== undefined || p.note !== undefined, {
    message: 'Nothing to change: send role, weight and/or note',
  });
export type BoardItemPatch = z.input<typeof BoardItemPatchSchema>;

/** `PUT /api/boards/:id/order`: every item id of the board, in the new order. */
export const BoardOrderSchema = z
  .object({ itemIds: z.array(z.uuid()).max(MAX_BOARD_ITEMS) })
  .strict();

// ---------------------------------------------------------------------------------------------
// Result shapes
// ---------------------------------------------------------------------------------------------

/** `GET /api/boards` and `list_boards`. */
export interface BoardSummary {
  readonly id: string;
  readonly title: string;
  readonly kind: BoardKind;
  readonly briefing: string;
  /** Visible items; a smart board's is its filter's result size, at most `SMART_BOARD_LIMIT`. */
  readonly itemCount: number;
  readonly author: AssetAuthor;
  readonly updatedAt: string;
  /** `thumb-md` of the first few items. */
  readonly thumbnails: readonly string[];
}

export interface BoardItem {
  /** `null` on a smart board, whose items are a filter's result, not rows. */
  readonly id: string | null;
  readonly role: BoardRole;
  readonly weight: BoardWeight;
  readonly note: string | null;
  readonly asset: AssetDetail;
}

/** A colour of a board's consolidated palette and the assets it came from. */
export interface DerivedColor {
  readonly hex: string;
  /** Share of the consolidated palette, 0..1. */
  readonly share: number;
  readonly assetIds: readonly string[];
}

export interface TypePairing {
  readonly assetId: string;
  readonly heading: string | null;
  readonly body: string | null;
  /** The family of a font asset (0017). */
  readonly family: string | null;
  /** The item's `typography` facet values. */
  readonly styles: readonly string[];
}

/** Contradictory signals, named rather than averaged (§10.1). */
export type BoardConflict =
  | {
      /** Primary items disagree on a single-value facet. */
      readonly kind: 'split';
      readonly facet: string;
      readonly values: readonly { readonly value: string; readonly assetIds: readonly string[] }[];
    }
  | {
      /** A value a primary item carries is carried by an avoid item too. */
      readonly kind: 'avoided';
      readonly facet: string;
      readonly value: string;
      readonly primary: readonly string[];
      readonly avoid: readonly string[];
    };

/** Which items a derived value was taken from: the role's own, or `overall` in their absence. */
export type DerivedSource = 'role' | 'overall' | null;

export interface BoardDerived {
  readonly palette: {
    readonly source: DerivedSource;
    readonly colors: readonly DerivedColor[];
    readonly avoid: readonly DerivedColor[];
  };
  readonly typePairings: {
    readonly source: DerivedSource;
    readonly pairings: readonly TypePairing[];
  };
  readonly motionSummary: {
    readonly source: DerivedSource;
    readonly values: readonly { readonly value: string; readonly count: number }[];
    readonly libraries: readonly string[];
    readonly transitions: readonly string[];
    readonly keyframes: readonly string[];
  };
  /** What every primary item carries — the actual direction. */
  readonly commonFacets: readonly FacetFilter[];
  readonly conflicts: readonly BoardConflict[];
}

/** The four token formats (§10.1). */
export interface BoardTokens {
  readonly json: Record<string, Record<string, string>>;
  readonly w3c: Record<string, unknown>;
  readonly css: string;
  readonly tailwind: string;
}

export const TOKEN_FORMATS = ['json', 'w3c', 'css', 'tailwind'] as const;
export type TokenFormat = (typeof TOKEN_FORMATS)[number];

/** `GET /api/boards/:id` — and, reshaped, `get_board`. */
export interface BoardDetail {
  readonly id: string;
  readonly title: string;
  readonly kind: BoardKind;
  readonly briefing: string;
  /** A smart board's filter in URL form, for links into the overview; `null` for a manual one. */
  readonly filter: Record<string, string | string[]> | null;
  readonly author: AssetAuthor;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly items: readonly BoardItem[];
  readonly derived: BoardDerived;
  readonly tokens: BoardTokens;
  /** The briefing for a model, assembled from the board (English, §13.3). */
  readonly prompt: string;
}
