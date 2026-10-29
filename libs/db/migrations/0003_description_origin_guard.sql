-- The central invariant (concept §5.6) for asset.description (0004).
--
-- Same rule as for facets and tags in 0001, adapted to a column: an ai write over a description
-- a human has written is DISCARDED, not raised — a re-analysis runs over the whole corpus and
-- must complete. Only the description is kept; every other column the same UPDATE changes still
-- lands, so a re-classification still updates status, type and the rest.
--
-- The writer states who it is: the classify step always sets description_origin = 'ai'. An
-- UPDATE that changes the description without naming an origin keeps the old one, which for a
-- human-owned description is 'human' — that is a human edit, and it lands.
--
-- Forward compatible per §4.11: this migration only adds.

CREATE OR REPLACE FUNCTION asset_description_origin_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.description_origin = 'human' AND NEW.description_origin = 'ai' THEN
    NEW.description := OLD.description;
    NEW.description_origin := 'human';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER asset_description_origin_guard
BEFORE UPDATE OF description, description_origin ON asset
FOR EACH ROW
EXECUTE FUNCTION asset_description_origin_guard();
