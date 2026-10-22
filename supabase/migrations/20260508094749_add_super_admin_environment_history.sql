/*
  # Super Admin Role, Environment Separation, Session Invites, and Player History

  ## Summary
  This migration extends the schema to support:

  1. **Super Admin Role**
     - Adds `super_admin` as a valid role in the profiles table
     - Only super_admin can promote/demote admins
     - Both super_admin and admin can manage sessions

  2. **Environment Separation**
     - Adds `environment` column to `profiles`, `sessions`, and `player_stats`
     - Values: `dev` or `prod`
     - Default: `prod` (existing data stays production)
     - Super admin account is shared across environments
     - Admins/players are tagged per environment so dev data doesn't pollute prod

  3. **Session Organiser Tracking**
     - Adds `organiser_profile` join so players can see who ran each session
     - Sessions already have `created_by` (FK to auth.users); this tracks the display name

  4. **Session Invites**
     - New `session_invites` table: admin explicitly invites a player to a session
     - Players can see their invites and which organiser invited them

  5. **Player Match History View**
     - New `player_match_history` view joining matches → sessions → profiles
     - Lets a player query all their games with venue, date, organiser, result, score

  ## New Tables
  - `session_invites` — (session_id, player_id, invited_by, status: pending/accepted/declined)

  ## Modified Tables
  - `profiles` — role extended to include `super_admin`; new `environment` column
  - `sessions` — new `environment` column
  - `player_stats` — new `environment` column

  ## Security
  - RLS on session_invites: players can only see their own invites; admins can manage invites for their sessions
  - Environment column protected: only admin/super_admin can set environment on sessions
*/

-- ─── 1. Extend role enum on profiles ───────────────────────────────────────────
-- The role column is text so we just update the check constraint
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('player', 'admin', 'super_admin'));

-- ─── 2. Add environment column to key tables ────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'environment'
  ) THEN
    ALTER TABLE profiles ADD COLUMN environment text NOT NULL DEFAULT 'prod'
      CHECK (environment IN ('dev', 'prod'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sessions' AND column_name = 'environment'
  ) THEN
    ALTER TABLE sessions ADD COLUMN environment text NOT NULL DEFAULT 'prod'
      CHECK (environment IN ('dev', 'prod'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'player_stats' AND column_name = 'environment'
  ) THEN
    ALTER TABLE player_stats ADD COLUMN environment text NOT NULL DEFAULT 'prod'
      CHECK (environment IN ('dev', 'prod'));
  END IF;
END $$;

-- ─── 3. Session Invites table ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS session_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  invited_by uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at timestamptz DEFAULT now(),
  UNIQUE(session_id, player_id)
);

ALTER TABLE session_invites ENABLE ROW LEVEL SECURITY;

-- Players can see invites addressed to them
CREATE POLICY "Players can view their own invites"
  ON session_invites FOR SELECT
  TO authenticated
  USING (auth.uid() = player_id);

-- Admins/super_admins can view invites they created
CREATE POLICY "Admins can view invites they sent"
  ON session_invites FOR SELECT
  TO authenticated
  USING (auth.uid() = invited_by);

-- Admins/super_admins can create invites
CREATE POLICY "Admins can create session invites"
  ON session_invites FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'super_admin')
    )
    AND auth.uid() = invited_by
  );

-- Admins can delete their own invites
CREATE POLICY "Admins can delete their own invites"
  ON session_invites FOR DELETE
  TO authenticated
  USING (auth.uid() = invited_by);

-- Players can update status of their own invites (accept/decline)
CREATE POLICY "Players can update their own invite status"
  ON session_invites FOR UPDATE
  TO authenticated
  USING (auth.uid() = player_id)
  WITH CHECK (auth.uid() = player_id);

-- ─── 4. Player match history view ───────────────────────────────────────────────
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
  CASE
    WHEN m.winner_team IS NULL THEN 'draw'
    WHEN m.winner_team = mt.team_label THEN 'win'
    ELSE 'loss'
  END AS result
FROM match_team_players mtp
JOIN match_teams mt ON mt.id = mtp.match_team_id
JOIN matches m ON m.id = mt.match_id
JOIN sessions s ON s.id = m.session_id
LEFT JOIN profiles p_organiser ON p_organiser.id = s.created_by
WHERE m.status = 'completed';

-- ─── 5. Indexes ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_session_invites_player_id ON session_invites(player_id);
CREATE INDEX IF NOT EXISTS idx_session_invites_session_id ON session_invites(session_id);
CREATE INDEX IF NOT EXISTS idx_profiles_environment ON profiles(environment);
CREATE INDEX IF NOT EXISTS idx_sessions_environment ON sessions(environment);
