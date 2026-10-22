/*
  # Allow selected session players to manage matches

  Players selected in a session need to start matches, create teams, add team
  players, maintain court queues, and record results from Match Management.
  Admins and super admins keep unrestricted admin access through the private
  helper.
*/

CREATE SCHEMA IF NOT EXISTS app_private;

CREATE OR REPLACE FUNCTION app_private.can_manage_session(target_session_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    app_private.is_admin_or_super_admin()
    OR EXISTS (
      SELECT 1
      FROM session_availability sa
      JOIN sessions s ON s.id = sa.session_id
      WHERE sa.session_id = target_session_id
        AND sa.player_id = auth.uid()
        AND sa.available = true
        AND s.status IN ('open', 'in_progress')
    );
$$;

REVOKE EXECUTE ON FUNCTION app_private.can_manage_session(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION app_private.can_manage_session(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION app_private.can_manage_session(uuid) TO authenticated;

DROP POLICY IF EXISTS "Selected players can insert matches" ON matches;
CREATE POLICY "Selected players can insert matches"
  ON matches FOR INSERT
  TO authenticated
  WITH CHECK (app_private.can_manage_session(session_id));

DROP POLICY IF EXISTS "Selected players can update matches" ON matches;
CREATE POLICY "Selected players can update matches"
  ON matches FOR UPDATE
  TO authenticated
  USING (app_private.can_manage_session(session_id))
  WITH CHECK (app_private.can_manage_session(session_id));

DROP POLICY IF EXISTS "Selected players can delete matches" ON matches;
CREATE POLICY "Selected players can delete matches"
  ON matches FOR DELETE
  TO authenticated
  USING (app_private.can_manage_session(session_id));

DROP POLICY IF EXISTS "Selected players can insert match teams" ON match_teams;
CREATE POLICY "Selected players can insert match teams"
  ON match_teams FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM matches m
      WHERE m.id = match_id
        AND app_private.can_manage_session(m.session_id)
    )
  );

DROP POLICY IF EXISTS "Selected players can update match teams" ON match_teams;
CREATE POLICY "Selected players can update match teams"
  ON match_teams FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM matches m
      WHERE m.id = match_id
        AND app_private.can_manage_session(m.session_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM matches m
      WHERE m.id = match_id
        AND app_private.can_manage_session(m.session_id)
    )
  );

DROP POLICY IF EXISTS "Selected players can delete match teams" ON match_teams;
CREATE POLICY "Selected players can delete match teams"
  ON match_teams FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM matches m
      WHERE m.id = match_id
        AND app_private.can_manage_session(m.session_id)
    )
  );

DROP POLICY IF EXISTS "Selected players can insert match team players" ON match_team_players;
CREATE POLICY "Selected players can insert match team players"
  ON match_team_players FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM match_teams mt
      JOIN matches m ON m.id = mt.match_id
      WHERE mt.id = match_team_id
        AND app_private.can_manage_session(m.session_id)
    )
  );

DROP POLICY IF EXISTS "Selected players can delete match team players" ON match_team_players;
CREATE POLICY "Selected players can delete match team players"
  ON match_team_players FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM match_teams mt
      JOIN matches m ON m.id = mt.match_id
      WHERE mt.id = match_team_id
        AND app_private.can_manage_session(m.session_id)
    )
  );

DROP POLICY IF EXISTS "Selected players can manage court queues" ON court_queues;
CREATE POLICY "Selected players can manage court queues"
  ON court_queues FOR ALL
  TO authenticated
  USING (app_private.can_manage_session(session_id))
  WITH CHECK (app_private.can_manage_session(session_id));

DROP POLICY IF EXISTS "Selected players can update courts" ON courts;
CREATE POLICY "Selected players can update courts"
  ON courts FOR UPDATE
  TO authenticated
  USING (app_private.can_manage_session(session_id))
  WITH CHECK (app_private.can_manage_session(session_id));

DROP POLICY IF EXISTS "Selected players can insert player stats" ON player_stats;
CREATE POLICY "Selected players can insert player stats"
  ON player_stats FOR INSERT
  TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Selected players can update player stats" ON player_stats;
CREATE POLICY "Selected players can update player stats"
  ON player_stats FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);
