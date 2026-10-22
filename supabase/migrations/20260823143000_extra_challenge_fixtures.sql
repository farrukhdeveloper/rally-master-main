/*
  # Extra challenge fixtures

  Extra fixtures stay separate from the generated seeded schedule while still
  contributing to challenge standings and following the challenge ranking flag.
*/

ALTER TABLE competition_fixtures
  ADD COLUMN IF NOT EXISTS is_extra boolean NOT NULL DEFAULT false;

-- Keep competition and linked-session statuses accurate when an extra fixture is
-- added or removed as well as when any fixture result changes.
CREATE OR REPLACE FUNCTION app_private.refresh_competition_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pending_count integer;
  completed_count integer;
  linked_session uuid;
  target_competition uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_competition := OLD.competition_id;
  ELSE
    target_competition := NEW.competition_id;
  END IF;

  SELECT
    count(*) FILTER (WHERE status = 'scheduled'),
    count(*) FILTER (WHERE status = 'completed')
  INTO pending_count, completed_count
  FROM competition_fixtures
  WHERE competition_id = target_competition;

  UPDATE competitions SET
    status = CASE WHEN pending_count = 0 AND completed_count > 0 THEN 'completed'
                  WHEN completed_count > 0 THEN 'in_progress' ELSE 'scheduled' END,
    updated_at = now()
  WHERE id = target_competition
  RETURNING session_id INTO linked_session;

  UPDATE sessions SET status = CASE WHEN pending_count = 0 AND completed_count > 0 THEN 'completed'
                                    WHEN completed_count > 0 THEN 'in_progress' ELSE 'open' END
  WHERE id = linked_session;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS refresh_competition_status_trigger ON competition_fixtures;
DROP TRIGGER IF EXISTS refresh_competition_status_insert_trigger ON competition_fixtures;
DROP TRIGGER IF EXISTS refresh_competition_status_update_trigger ON competition_fixtures;
DROP TRIGGER IF EXISTS refresh_competition_status_delete_trigger ON competition_fixtures;

CREATE TRIGGER refresh_competition_status_insert_trigger
AFTER INSERT ON competition_fixtures
FOR EACH ROW EXECUTE FUNCTION app_private.refresh_competition_status();

CREATE TRIGGER refresh_competition_status_update_trigger
AFTER UPDATE OF status ON competition_fixtures
FOR EACH ROW EXECUTE FUNCTION app_private.refresh_competition_status();

CREATE TRIGGER refresh_competition_status_delete_trigger
AFTER DELETE ON competition_fixtures
FOR EACH ROW EXECUTE FUNCTION app_private.refresh_competition_status();
