/*
  # Seeded group challenges

  Adds a reusable competition foundation. Group challenges use challenge-only
  seeds and mirrored doubles fixtures while completed results are copied into
  the existing session/match tables for history and recap compatibility.
*/

-- Bolt-managed databases do not always apply every historical migration in
-- filename order. Keep the role helpers used by this migration available here
-- as well, so the challenge schema can be installed independently.
CREATE SCHEMA IF NOT EXISTS app_private;

CREATE OR REPLACE FUNCTION app_private.is_super_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM profiles
    WHERE id = auth.uid()
      AND role = 'super_admin'
  );
$$;

CREATE OR REPLACE FUNCTION app_private.is_admin_user()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM profiles
    WHERE id = auth.uid()
      AND role IN ('admin', 'super_admin')
  );
$$;

REVOKE ALL ON SCHEMA app_private FROM PUBLIC;
GRANT USAGE ON SCHEMA app_private TO authenticated;
REVOKE EXECUTE ON FUNCTION app_private.is_super_admin() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION app_private.is_admin_user() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.is_super_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.is_admin_user() TO authenticated;

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS session_type text NOT NULL DEFAULT 'standard'
    CHECK (session_type IN ('standard', 'group_challenge', 'tournament')),
  ADD COLUMN IF NOT EXISTS counts_for_rankings boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS competitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_type text NOT NULL DEFAULT 'group_challenge'
    CHECK (competition_type IN ('group_challenge', 'tournament')),
  title text NOT NULL,
  environment text NOT NULL DEFAULT 'prod' CHECK (environment IN ('dev', 'prod')),
  event_date date NOT NULL,
  start_time time NOT NULL,
  venue text NOT NULL DEFAULT '',
  court_count integer NOT NULL DEFAULT 1 CHECK (court_count > 0),
  fixture_minutes integer NOT NULL DEFAULT 10 CHECK (fixture_minutes > 0),
  status text NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('draft', 'scheduled', 'in_progress', 'completed', 'cancelled')),
  counts_for_rankings boolean NOT NULL DEFAULT false,
  session_id uuid UNIQUE REFERENCES sessions(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS competition_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
  side text NOT NULL CHECK (side IN ('A', 'B')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (competition_id, side),
  UNIQUE (competition_id, group_id)
);

CREATE TABLE IF NOT EXISTS competition_rosters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  competition_group_id uuid NOT NULL REFERENCES competition_groups(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  seed_number integer NOT NULL CHECK (seed_number > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (competition_id, player_id),
  UNIQUE (competition_group_id, seed_number)
);

CREATE TABLE IF NOT EXISTS competition_fixtures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  round_number integer NOT NULL CHECK (round_number > 0),
  wave_number integer NOT NULL DEFAULT 1 CHECK (wave_number > 0),
  court_number integer NOT NULL CHECK (court_number > 0),
  scheduled_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed')),
  score_a integer CHECK (score_a >= 0),
  score_b integer CHECK (score_b >= 0),
  winner_side text CHECK (winner_side IN ('A', 'B')),
  match_id uuid UNIQUE REFERENCES matches(id) ON DELETE SET NULL,
  recorded_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS competition_fixture_players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fixture_id uuid NOT NULL REFERENCES competition_fixtures(id) ON DELETE CASCADE,
  side text NOT NULL CHECK (side IN ('A', 'B')),
  player_id uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  seed_number integer NOT NULL CHECK (seed_number > 0),
  team_position integer NOT NULL CHECK (team_position IN (1, 2)),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fixture_id, player_id),
  UNIQUE (fixture_id, side, team_position)
);

CREATE INDEX IF NOT EXISTS idx_competitions_environment ON competitions(environment);
CREATE INDEX IF NOT EXISTS idx_competition_groups_competition ON competition_groups(competition_id);
CREATE INDEX IF NOT EXISTS idx_competition_rosters_competition ON competition_rosters(competition_id);
CREATE INDEX IF NOT EXISTS idx_competition_fixtures_competition ON competition_fixtures(competition_id, round_number, wave_number);
CREATE INDEX IF NOT EXISTS idx_competition_fixture_players_fixture ON competition_fixture_players(fixture_id);
CREATE INDEX IF NOT EXISTS idx_competition_fixture_players_player ON competition_fixture_players(player_id);

ALTER TABLE competitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE competition_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE competition_rosters ENABLE ROW LEVEL SECURITY;
ALTER TABLE competition_fixtures ENABLE ROW LEVEL SECURITY;
ALTER TABLE competition_fixture_players ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view group memberships" ON player_groups;
CREATE POLICY "Authenticated users can view group memberships"
  ON player_groups FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION app_private.can_manage_competition(target_competition_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT app_private.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM competitions c
      WHERE c.id = target_competition_id AND c.created_by = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM competition_groups cg
      JOIN groups g ON g.id = cg.group_id
      WHERE cg.competition_id = target_competition_id
        AND g.created_by = auth.uid()
    );
$$;

CREATE OR REPLACE FUNCTION app_private.is_competition_roster_player(target_competition_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM competition_rosters cr
    WHERE cr.competition_id = target_competition_id
      AND cr.player_id = auth.uid()
  );
$$;

REVOKE EXECUTE ON FUNCTION app_private.can_manage_competition(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION app_private.is_competition_roster_player(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.can_manage_competition(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.is_competition_roster_player(uuid) TO authenticated;

DROP POLICY IF EXISTS "Authenticated users can view competitions" ON competitions;
CREATE POLICY "Authenticated users can view competitions"
  ON competitions FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Admins can create competitions" ON competitions;
CREATE POLICY "Admins can create competitions"
  ON competitions FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND app_private.is_admin_user());
DROP POLICY IF EXISTS "Challenge organisers can update competitions" ON competitions;
CREATE POLICY "Challenge organisers can update competitions"
  ON competitions FOR UPDATE TO authenticated
  USING (app_private.can_manage_competition(id))
  WITH CHECK (app_private.can_manage_competition(id));
DROP POLICY IF EXISTS "Challenge organisers can delete competitions" ON competitions;
CREATE POLICY "Challenge organisers can delete competitions"
  ON competitions FOR DELETE TO authenticated
  USING (app_private.can_manage_competition(id));

DROP POLICY IF EXISTS "Authenticated users can view competition groups" ON competition_groups;
CREATE POLICY "Authenticated users can view competition groups"
  ON competition_groups FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Challenge creators can add competition groups" ON competition_groups;
CREATE POLICY "Challenge creators can add competition groups"
  ON competition_groups FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM competitions c WHERE c.id = competition_id AND c.created_by = auth.uid()));
DROP POLICY IF EXISTS "Challenge organisers can manage competition groups" ON competition_groups;
CREATE POLICY "Challenge organisers can manage competition groups"
  ON competition_groups FOR ALL TO authenticated
  USING (app_private.can_manage_competition(competition_id))
  WITH CHECK (app_private.can_manage_competition(competition_id));

DROP POLICY IF EXISTS "Authenticated users can view competition rosters" ON competition_rosters;
CREATE POLICY "Authenticated users can view competition rosters"
  ON competition_rosters FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Challenge organisers can manage competition rosters" ON competition_rosters;
CREATE POLICY "Challenge organisers can manage competition rosters"
  ON competition_rosters FOR ALL TO authenticated
  USING (app_private.can_manage_competition(competition_id))
  WITH CHECK (app_private.can_manage_competition(competition_id));

DROP POLICY IF EXISTS "Authenticated users can view competition fixtures" ON competition_fixtures;
CREATE POLICY "Authenticated users can view competition fixtures"
  ON competition_fixtures FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Challenge organisers can create competition fixtures" ON competition_fixtures;
CREATE POLICY "Challenge organisers can create competition fixtures"
  ON competition_fixtures FOR INSERT TO authenticated
  WITH CHECK (app_private.can_manage_competition(competition_id));
DROP POLICY IF EXISTS "Challenge organisers can update competition fixtures" ON competition_fixtures;
CREATE POLICY "Challenge organisers can update competition fixtures"
  ON competition_fixtures FOR UPDATE TO authenticated
  USING (app_private.can_manage_competition(competition_id))
  WITH CHECK (app_private.can_manage_competition(competition_id));
DROP POLICY IF EXISTS "Roster players can submit pending fixture results" ON competition_fixtures;
CREATE POLICY "Roster players can submit pending fixture results"
  ON competition_fixtures FOR UPDATE TO authenticated
  USING (status = 'scheduled' AND app_private.is_competition_roster_player(competition_id))
  WITH CHECK (status = 'completed' AND app_private.is_competition_roster_player(competition_id));
DROP POLICY IF EXISTS "Challenge organisers can delete competition fixtures" ON competition_fixtures;
CREATE POLICY "Challenge organisers can delete competition fixtures"
  ON competition_fixtures FOR DELETE TO authenticated
  USING (app_private.can_manage_competition(competition_id));

DROP POLICY IF EXISTS "Authenticated users can view fixture players" ON competition_fixture_players;
CREATE POLICY "Authenticated users can view fixture players"
  ON competition_fixture_players FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Challenge organisers can manage fixture players" ON competition_fixture_players;
CREATE POLICY "Challenge organisers can manage fixture players"
  ON competition_fixture_players FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM competition_fixtures cf
    WHERE cf.id = fixture_id AND app_private.can_manage_competition(cf.competition_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM competition_fixtures cf
    WHERE cf.id = fixture_id AND app_private.can_manage_competition(cf.competition_id)
  ));

CREATE OR REPLACE FUNCTION app_private.guard_competition_fixture_submission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF app_private.can_manage_competition(OLD.competition_id) THEN
    RETURN NEW;
  END IF;

  IF NOT app_private.is_competition_roster_player(OLD.competition_id) THEN
    RAISE EXCEPTION 'Only challenge organisers or selected roster players can update fixtures';
  END IF;

  IF OLD.status <> 'scheduled' OR NEW.status <> 'completed' THEN
    RAISE EXCEPTION 'Roster players can only submit a pending fixture result';
  END IF;

  IF NEW.competition_id IS DISTINCT FROM OLD.competition_id
    OR NEW.round_number IS DISTINCT FROM OLD.round_number
    OR NEW.wave_number IS DISTINCT FROM OLD.wave_number
    OR NEW.court_number IS DISTINCT FROM OLD.court_number
    OR NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at
    OR NEW.match_id IS DISTINCT FROM OLD.match_id THEN
    RAISE EXCEPTION 'Roster players cannot change fixture scheduling or linked match data';
  END IF;

  NEW.recorded_by := auth.uid();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS a_guard_competition_fixture_submission_trigger ON competition_fixtures;
CREATE TRIGGER a_guard_competition_fixture_submission_trigger
BEFORE UPDATE ON competition_fixtures
FOR EACH ROW EXECUTE FUNCTION app_private.guard_competition_fixture_submission();

CREATE OR REPLACE FUNCTION app_private.create_competition_session()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_session_id uuid;
  court_index integer;
BEGIN
  IF NEW.session_id IS NOT NULL THEN RETURN NEW; END IF;

  INSERT INTO sessions (
    title, session_date, start_time, end_time, venue, status, created_by,
    environment, group_id, session_type, counts_for_rankings
  ) VALUES (
    NEW.title, NEW.event_date, NEW.start_time,
    (NEW.start_time + interval '4 hours')::time,
    NEW.venue, 'open', NEW.created_by, NEW.environment, NULL,
    'group_challenge', NEW.counts_for_rankings
  ) RETURNING id INTO new_session_id;

  FOR court_index IN 1..NEW.court_count LOOP
    INSERT INTO courts (session_id, name, status)
    VALUES (new_session_id, 'Court ' || court_index, 'available');
  END LOOP;

  NEW.session_id := new_session_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS create_competition_session_trigger ON competitions;
CREATE TRIGGER create_competition_session_trigger
BEFORE INSERT ON competitions
FOR EACH ROW EXECUTE FUNCTION app_private.create_competition_session();

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

      SELECT g.name INTO group_a_name
      FROM competition_groups cg JOIN groups g ON g.id = cg.group_id
      WHERE cg.competition_id = NEW.competition_id AND cg.side = 'A';
      SELECT g.name INTO group_b_name
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

DROP TRIGGER IF EXISTS sync_competition_fixture_match_trigger ON competition_fixtures;
CREATE TRIGGER sync_competition_fixture_match_trigger
BEFORE UPDATE ON competition_fixtures
FOR EACH ROW EXECUTE FUNCTION app_private.sync_competition_fixture_match();

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
BEGIN
  SELECT
    count(*) FILTER (WHERE status = 'scheduled'),
    count(*) FILTER (WHERE status = 'completed')
  INTO pending_count, completed_count
  FROM competition_fixtures WHERE competition_id = NEW.competition_id;

  UPDATE competitions SET
    status = CASE WHEN pending_count = 0 AND completed_count > 0 THEN 'completed'
                  WHEN completed_count > 0 THEN 'in_progress' ELSE 'scheduled' END,
    updated_at = now()
  WHERE id = NEW.competition_id
  RETURNING session_id INTO linked_session;

  UPDATE sessions SET status = CASE WHEN pending_count = 0 AND completed_count > 0 THEN 'completed'
                                    WHEN completed_count > 0 THEN 'in_progress' ELSE 'open' END
  WHERE id = linked_session;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS refresh_competition_status_trigger ON competition_fixtures;
CREATE TRIGGER refresh_competition_status_trigger
AFTER UPDATE OF status ON competition_fixtures
FOR EACH ROW EXECUTE FUNCTION app_private.refresh_competition_status();

CREATE OR REPLACE VIEW player_match_history
WITH (security_invoker = true) AS
SELECT
  mtp.player_id,
  m.id AS match_id,
  m.session_id,
  s.title AS session_title,
  s.session_date,
  s.venue,
  s.environment,
  p_organiser.full_name AS organiser_name,
  p_organiser.id AS organiser_id,
  mt.team_label AS my_team,
  m.winner_team,
  m.score_a,
  m.score_b,
  m.status AS match_status,
  m.started_at,
  m.ended_at,
  CASE WHEN m.winner_team IS NULL THEN 'draw'
       WHEN m.winner_team = mt.team_label THEN 'win' ELSE 'loss' END AS result,
  -- New view columns must be appended after the existing column list. PostgreSQL
  -- does not allow CREATE OR REPLACE VIEW to insert columns in the middle.
  s.session_type,
  s.counts_for_rankings,
  c.id AS competition_id,
  c.title AS competition_title
FROM match_team_players mtp
JOIN match_teams mt ON mt.id = mtp.match_team_id
JOIN matches m ON m.id = mt.match_id
JOIN sessions s ON s.id = m.session_id
LEFT JOIN competitions c ON c.session_id = s.id
LEFT JOIN profiles p_organiser ON p_organiser.id = s.created_by
WHERE m.status = 'completed';
