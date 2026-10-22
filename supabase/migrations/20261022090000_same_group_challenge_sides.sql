-- Allow two separately seeded sides from the same source group.
-- Existing competitions and results are preserved.
BEGIN;

ALTER TABLE public.competition_groups
  ADD COLUMN IF NOT EXISTS team_name text;

ALTER TABLE public.competition_groups
  DROP CONSTRAINT IF EXISTS competition_groups_competition_id_group_id_key;

-- UNIQUE (competition_id, side), UNIQUE (competition_id, player_id), and
-- UNIQUE (competition_group_id, seed_number) still keep sides and players distinct.

-- Carry the challenge side names into newly recorded match history.
CREATE OR REPLACE FUNCTION app_private.sync_competition_fixture_match()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  competition_row competitions%ROWTYPE;
  selected_court_id uuid;
  new_match_id uuid;
  team_a_id uuid;
  team_b_id uuid;
  group_a_name text;
  group_b_name text;
BEGIN
  NEW.updated_at := now();

  IF NEW.status = 'completed' THEN
    IF NEW.score_a IS NULL OR NEW.score_b IS NULL OR NEW.score_a < 0 OR NEW.score_b < 0 OR NEW.score_a = NEW.score_b THEN
      RAISE EXCEPTION 'Completed fixtures require non-negative, unequal scores';
    END IF;
    NEW.winner_side := CASE WHEN NEW.score_a > NEW.score_b THEN 'A' ELSE 'B' END;
    NEW.completed_at := COALESCE(NEW.completed_at, now());
    NEW.recorded_by := COALESCE(NEW.recorded_by, auth.uid());

    SELECT * INTO competition_row FROM competitions WHERE id = NEW.competition_id;
    SELECT c.id INTO selected_court_id
    FROM courts c WHERE c.session_id = competition_row.session_id
    ORDER BY c.created_at, c.id OFFSET NEW.court_number - 1 LIMIT 1;

    IF NEW.match_id IS NULL THEN
      INSERT INTO matches (session_id, court_id, status, winner_team, score_a, score_b, started_at, ended_at, created_by)
      VALUES (
        competition_row.session_id, selected_court_id, 'completed', NEW.winner_side,
        NEW.score_a, NEW.score_b, NEW.scheduled_at, NEW.completed_at,
        COALESCE(NEW.recorded_by, competition_row.created_by)
      ) RETURNING id INTO new_match_id;

      SELECT COALESCE(NULLIF(btrim(cg.team_name), ''), g.name) INTO group_a_name
      FROM competition_groups cg JOIN groups g ON g.id = cg.group_id
      WHERE cg.competition_id = NEW.competition_id AND cg.side = 'A';
      SELECT COALESCE(NULLIF(btrim(cg.team_name), ''), g.name) INTO group_b_name
      FROM competition_groups cg JOIN groups g ON g.id = cg.group_id
      WHERE cg.competition_id = NEW.competition_id AND cg.side = 'B';

      INSERT INTO match_teams (match_id, team_label, team_name)
      VALUES (new_match_id, 'A', COALESCE(group_a_name, 'Group A')) RETURNING id INTO team_a_id;
      INSERT INTO match_teams (match_id, team_label, team_name)
      VALUES (new_match_id, 'B', COALESCE(group_b_name, 'Group B')) RETURNING id INTO team_b_id;

      INSERT INTO match_team_players (match_team_id, player_id)
      SELECT CASE WHEN cfp.side = 'A' THEN team_a_id ELSE team_b_id END, cfp.player_id
      FROM competition_fixture_players cfp WHERE cfp.fixture_id = NEW.id;

      NEW.match_id := new_match_id;
    ELSE
      UPDATE matches SET winner_team = NEW.winner_side, score_a = NEW.score_a,
        score_b = NEW.score_b, ended_at = NEW.completed_at
      WHERE id = NEW.match_id;
    END IF;
  ELSIF OLD.status = 'completed' AND NEW.status = 'scheduled' THEN
    IF OLD.match_id IS NOT NULL THEN
      UPDATE matches
      SET status = 'abandoned', ended_at = now()
      WHERE id = OLD.match_id;
    END IF;
    NEW.match_id := NULL;
    NEW.score_a := NULL;
    NEW.score_b := NULL;
    NEW.winner_side := NULL;
    NEW.completed_at := NULL;
    NEW.recorded_by := NULL;
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;
