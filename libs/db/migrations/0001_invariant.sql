-- The central invariant (concept §5.6) and the search vector (§5.3, §13.4).
--
-- Both are enforced in the database rather than in application logic. For the invariant that is
-- not a matter of taste: no test catches its absence, and the first re-analysis after a mistake
-- silently destroys every human correction. For the search vector it means the value cannot drift
-- from title and description, because no code is responsible for writing it.
--
-- Forward compatible per §4.11: this migration only adds. Between the PreSync job and the
-- completed rollout the previous application version briefly runs against this schema, and it
-- notices nothing.

-- ---------------------------------------------------------------------------------------------
-- §5.6  origin = 'human' always wins over origin = 'ai'
-- ---------------------------------------------------------------------------------------------
--
-- Two different reactions, deliberately:
--
--   * A write with origin = 'ai' that touches a facet a human has already decided is DISCARDED
--     (RETURN NULL). This is normal operation: a re-analysis (§7.5) runs over the whole corpus
--     and must complete, it simply has no effect where a human has spoken.
--   * An UPDATE or DELETE of an existing origin = 'human' row performed as 'ai' RAISES. There is
--     no legitimate caller for that, and discarding it would hide the bug.
--
-- Both rules live in ONE function per table on purpose. Split across two triggers, Postgres would
-- fire them in alphabetical order by trigger name, and whichever discarded first would swallow
-- the other's exception.
--
-- Precedence is per asset and per FACET, not per facet value: a human who sets style = editorial
-- has decided the style facet, so the model must not add style = brutalist alongside it.

CREATE OR REPLACE FUNCTION asset_facet_value_origin_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_facet_id uuid;
BEGIN
  -- 1. A human assignment is never overwritten or removed by an ai write.
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.origin = 'human' THEN
    IF TG_OP = 'DELETE' OR NEW.origin = 'ai' THEN
      RAISE EXCEPTION
        'asset_facet_value: human assignment (asset %, facet value %) must not be % by an ai write',
        OLD.asset_id, OLD.facet_value_id, lower(TG_OP)
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  -- 2. An ai write into a facet a human has already decided is discarded, not raised.
  IF NEW.origin = 'ai' THEN
    SELECT facet_id INTO target_facet_id
    FROM facet_value
    WHERE id = NEW.facet_value_id;

    IF EXISTS (
      SELECT 1
      FROM asset_facet_value existing
      JOIN facet_value existing_value ON existing_value.id = existing.facet_value_id
      WHERE existing.asset_id = NEW.asset_id
        AND existing.origin = 'human'
        AND existing_value.facet_id = target_facet_id
    ) THEN
      RETURN NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER asset_facet_value_origin_guard
BEFORE INSERT OR UPDATE OR DELETE ON asset_facet_value
FOR EACH ROW
EXECUTE FUNCTION asset_facet_value_origin_guard();--> statement-breakpoint

-- The same two rules for free-form tags, scoped per (asset, tag): tags are flat, so there is no
-- facet to scope the precedence to.

CREATE OR REPLACE FUNCTION asset_tag_origin_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.origin = 'human' THEN
    IF TG_OP = 'DELETE' OR NEW.origin = 'ai' THEN
      RAISE EXCEPTION
        'asset_tag: human assignment (asset %, tag %) must not be % by an ai write',
        OLD.asset_id, OLD.tag_id, lower(TG_OP)
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF NEW.origin = 'ai' AND EXISTS (
    SELECT 1 FROM asset_tag
    WHERE asset_id = NEW.asset_id
      AND tag_id = NEW.tag_id
      AND origin = 'human'
  ) THEN
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER asset_tag_origin_guard
BEFORE INSERT OR UPDATE OR DELETE ON asset_tag
FOR EACH ROW
EXECUTE FUNCTION asset_tag_origin_guard();--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- §5.3 / §13.4  asset_search.tsv
-- ---------------------------------------------------------------------------------------------
--
-- The concept describes this as a generated column. A generated column can only reference
-- columns of its own row, and title and description live on `asset`, so the separate table from
-- §5.3 is kept and filled by a trigger instead. The property that matters is unchanged: no
-- application code writes this value.
--
-- 'english' is one fixed stemming configuration, correct because descriptions are English by
-- decision (§13.3). Free-form tags stay out of the vector — they may be German, and English
-- stemming would mangle them. They are matched separately and exactly.

CREATE OR REPLACE FUNCTION refresh_asset_search()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO asset_search (asset_id, tsv)
  VALUES (
    NEW.id,
    to_tsvector(
      'english',
      coalesce(NEW.title, '') || ' ' || coalesce(NEW.description, '')
    )
  )
  ON CONFLICT (asset_id) DO UPDATE SET tsv = EXCLUDED.tsv;

  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER asset_refresh_search
AFTER INSERT OR UPDATE OF title, description ON asset
FOR EACH ROW
EXECUTE FUNCTION refresh_asset_search();
