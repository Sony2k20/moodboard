-- The central invariant (concept §5.6) for asset.title (0007).
--
-- Backfill first: until now the model never wrote a title, so every title that exists was chosen
-- by a person — a file name they picked, or an edit (0006). A missing title is the model's to
-- fill.
--
-- Then the same rule as for the description (0003): an ai write over a title a person chose is
-- DISCARDED, not raised, so a re-analysis completes. Every other column the same UPDATE changes
-- still lands. An UPDATE that changes the title without naming an origin keeps the old one.
--
-- One exception, declared like the deletes in 0006: a person who clears their title hands it
-- back to the model. The api does that in a transaction with moodboard.actor = 'human'; the
-- classify step never declares an actor, so it still cannot take a title away from a person.
--
-- Forward compatible per §4.11: the previous application version never writes title_origin, and
-- the backfill only touches the column this release added.

UPDATE asset SET title_origin = 'human' WHERE title IS NOT NULL;--> statement-breakpoint

CREATE OR REPLACE FUNCTION asset_title_origin_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.title_origin = 'human' AND NEW.title_origin = 'ai'
     AND NOT moodboard_actor_may_delete_human() THEN
    NEW.title := OLD.title;
    NEW.title_origin := 'human';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER asset_title_origin_guard
BEFORE UPDATE OF title, title_origin ON asset
FOR EACH ROW
EXECUTE FUNCTION asset_title_origin_guard();
