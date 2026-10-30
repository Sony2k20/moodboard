-- The central invariant (concept §5.6) for asset.design_notes (0009).
--
-- The same rule as for the description (0003) and the title (0008): an ai write over notes a
-- person wrote is DISCARDED, not raised, so a re-analysis completes and every other column it
-- changes still lands. A person handing the notes back to the model does so in a transaction
-- that declared moodboard.actor (0006); the classify step never declares one.
--
-- No backfill: the column is new, and nothing has written notes yet.
--
-- Forward compatible per §4.11: the previous application version never touches these columns.

CREATE OR REPLACE FUNCTION asset_design_notes_origin_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.design_notes_origin = 'human' AND NEW.design_notes_origin = 'ai'
     AND NOT moodboard_actor_may_delete_human() THEN
    NEW.design_notes := OLD.design_notes;
    NEW.design_notes_origin := 'human';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER asset_design_notes_origin_guard
BEFORE UPDATE OF design_notes, design_notes_origin ON asset
FOR EACH ROW
EXECUTE FUNCTION asset_design_notes_origin_guard();
