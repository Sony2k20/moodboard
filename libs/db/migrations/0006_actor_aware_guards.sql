-- The facet and tag guards from 0001, extended for editing (0006).
--
-- Two additions to each, both keeping §5.6 where it was put — in the database:
--
--   * A person's decision without a value row. asset_facet_decision marks a facet a person has
--     decided, also when they left it empty; asset_tag_rejection a tag they removed. An ai write
--     into either is DISCARDED, exactly like an ai write into a facet that has a human value.
--
--   * Who is writing, declared per transaction. Deleting a human row used to RAISE always —
--     also for a person removing their own correction, and also in the cascade of a purge. Now
--     it is allowed when the transaction has run `SET LOCAL moodboard.actor = 'human'` (the api)
--     or `'purge'` (the trash purge in the worker). The classify step never sets it, so a
--     re-analysis still cannot delete or downgrade a person's value. This guards against
--     application bugs, not against someone with database access — as before.
--
-- Forward compatible per §4.11: the previous application version never sets the actor, and for
-- it every rule behaves exactly as in 0001.

CREATE OR REPLACE FUNCTION moodboard_actor_may_delete_human()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(current_setting('moodboard.actor', true), '') IN ('human', 'purge');
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION asset_facet_value_origin_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_facet_id uuid;
BEGIN
  -- 1. A human assignment is never downgraded to ai, and deleted only by a declared actor.
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.origin = 'human' THEN
    IF (TG_OP = 'DELETE' AND NOT moodboard_actor_may_delete_human())
       OR (TG_OP = 'UPDATE' AND NEW.origin = 'ai') THEN
      RAISE EXCEPTION
        'asset_facet_value: human assignment (asset %, facet value %) must not be % by an ai write',
        OLD.asset_id, OLD.facet_value_id, lower(TG_OP)
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  -- 2. An ai write into a facet a human has decided — by a value or by a decision row — is
  --    discarded, not raised.
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
    ) OR EXISTS (
      SELECT 1
      FROM asset_facet_decision decision
      WHERE decision.asset_id = NEW.asset_id
        AND decision.facet_id = target_facet_id
    ) THEN
      RETURN NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION asset_tag_origin_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.origin = 'human' THEN
    IF (TG_OP = 'DELETE' AND NOT moodboard_actor_may_delete_human())
       OR (TG_OP = 'UPDATE' AND NEW.origin = 'ai') THEN
      RAISE EXCEPTION
        'asset_tag: human assignment (asset %, tag %) must not be % by an ai write',
        OLD.asset_id, OLD.tag_id, lower(TG_OP)
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF NEW.origin = 'ai' AND (
    EXISTS (
      SELECT 1 FROM asset_tag
      WHERE asset_id = NEW.asset_id
        AND tag_id = NEW.tag_id
        AND origin = 'human'
    ) OR EXISTS (
      SELECT 1 FROM asset_tag_rejection
      WHERE asset_id = NEW.asset_id
        AND tag_id = NEW.tag_id
    )
  ) THEN
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$;
