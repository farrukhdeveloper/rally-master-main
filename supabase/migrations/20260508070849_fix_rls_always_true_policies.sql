/*
  # Fix RLS policies that were always-true

  ## Changes

  ### matches
  - UPDATE: restrict to admins only (matches are only modified by admins recording results)

  ### match_teams
  - INSERT: restrict to admins only (teams are created as part of match creation by admins)
  - UPDATE: restrict to admins only (team names updated by admins)

  ### match_team_players
  - INSERT: restrict to admins only (players added to teams by admins)
  - DELETE: restrict to admins only (players removed from teams by admins)

  ### player_stats
  - INSERT: restrict to admins only (stats written when admin records a match result)
  - UPDATE: restrict to admins only (stats updated when admin records a match result)

  ## Security notes
  All write operations on match-related tables are admin-only actions triggered by the
  match management UI. Regular players only need SELECT access to view results.
  The admin check uses a subquery on profiles.role to avoid trusting JWT app_metadata.
*/

-- ── matches ───────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Authenticated users can update matches" ON matches;

CREATE POLICY "Admins can update matches"
  ON matches FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ── match_teams ───────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Authenticated users can insert match teams" ON match_teams;
DROP POLICY IF EXISTS "Authenticated users can update match teams" ON match_teams;

CREATE POLICY "Admins can insert match teams"
  ON match_teams FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Admins can update match teams"
  ON match_teams FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ── match_team_players ────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Authenticated users can insert match team players" ON match_team_players;
DROP POLICY IF EXISTS "Authenticated users can delete match team players" ON match_team_players;

CREATE POLICY "Admins can insert match team players"
  ON match_team_players FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Admins can delete match team players"
  ON match_team_players FOR DELETE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ── player_stats ──────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "System can insert player stats" ON player_stats;
DROP POLICY IF EXISTS "System can update player stats" ON player_stats;

CREATE POLICY "Admins can insert player stats"
  ON player_stats FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Admins can update player stats"
  ON player_stats FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );
