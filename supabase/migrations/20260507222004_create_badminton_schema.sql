/*
  # Badminton App - Initial Schema

  ## Tables Created:
  1. `profiles` - Extended user data (name, skill level, role)
  2. `sessions` - Badminton sessions organised by admins
  3. `session_availability` - Player availability for a session
  4. `courts` - Courts available at a venue
  5. `matches` - Active and completed matches on courts
  6. `match_teams` - Teams within a match (team A / team B)
  7. `match_team_players` - Players in each team
  8. `player_stats` - Running win/loss stats per player

  ## Security:
  - RLS enabled on all tables
  - Authenticated users can read profiles, sessions, matches
  - Only admins can create/modify sessions and courts
  - Players can update their own availability
*/

-- Profiles table (extends auth.users)
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL DEFAULT '',
  skill_level text NOT NULL DEFAULT 'level_5' CHECK (skill_level IN ('level_1', 'level_2', 'level_3', 'level_4', 'level_5', 'level_6', 'level_7', 'level_8', 'level_9')),
  role text NOT NULL DEFAULT 'player' CHECK (role IN ('player', 'admin')),
  phone text DEFAULT '',
  avatar_url text DEFAULT '',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Profiles are viewable by authenticated users"
  ON profiles FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can insert their own profile"
  ON profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL DEFAULT '',
  session_date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  venue text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'completed', 'cancelled')),
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Sessions viewable by authenticated users"
  ON sessions FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can insert sessions"
  ON sessions FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Admins can update sessions"
  ON sessions FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Session availability
CREATE TABLE IF NOT EXISTS session_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  available boolean NOT NULL DEFAULT false,
  responded_at timestamptz DEFAULT now(),
  UNIQUE(session_id, player_id)
);

ALTER TABLE session_availability ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Availability viewable by authenticated users"
  ON session_availability FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Players can insert own availability"
  ON session_availability FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = player_id);

CREATE POLICY "Players can update own availability"
  ON session_availability FOR UPDATE
  TO authenticated
  USING (auth.uid() = player_id)
  WITH CHECK (auth.uid() = player_id);

-- Courts table
CREATE TABLE IF NOT EXISTS courts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'in_use', 'maintenance')),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE courts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Courts viewable by authenticated users"
  ON courts FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can insert courts"
  ON courts FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Admins can update courts"
  ON courts FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Matches table
CREATE TABLE IF NOT EXISTS matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  court_id uuid NOT NULL REFERENCES courts(id),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'abandoned')),
  winner_team text CHECK (winner_team IN ('A', 'B')),
  score_a integer DEFAULT 0,
  score_b integer DEFAULT 0,
  started_at timestamptz DEFAULT now(),
  ended_at timestamptz,
  created_by uuid REFERENCES profiles(id)
);

ALTER TABLE matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Matches viewable by authenticated users"
  ON matches FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert matches"
  ON matches FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Authenticated users can update matches"
  ON matches FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Match teams table
CREATE TABLE IF NOT EXISTS match_teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  team_label text NOT NULL CHECK (team_label IN ('A', 'B')),
  team_name text DEFAULT '',
  UNIQUE(match_id, team_label)
);

ALTER TABLE match_teams ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Match teams viewable by authenticated users"
  ON match_teams FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert match teams"
  ON match_teams FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update match teams"
  ON match_teams FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Match team players
CREATE TABLE IF NOT EXISTS match_team_players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_team_id uuid NOT NULL REFERENCES match_teams(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES profiles(id),
  UNIQUE(match_team_id, player_id)
);

ALTER TABLE match_team_players ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Match team players viewable by authenticated users"
  ON match_team_players FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert match team players"
  ON match_team_players FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete match team players"
  ON match_team_players FOR DELETE
  TO authenticated
  USING (true);

-- Player stats
CREATE TABLE IF NOT EXISTS player_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE UNIQUE,
  wins integer NOT NULL DEFAULT 0,
  losses integer NOT NULL DEFAULT 0,
  total_matches integer NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE player_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Player stats viewable by authenticated users"
  ON player_stats FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "System can insert player stats"
  ON player_stats FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "System can update player stats"
  ON player_stats FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_session_availability_session ON session_availability(session_id);
CREATE INDEX IF NOT EXISTS idx_session_availability_player ON session_availability(player_id);
CREATE INDEX IF NOT EXISTS idx_matches_session ON matches(session_id);
CREATE INDEX IF NOT EXISTS idx_matches_court ON matches(court_id);
CREATE INDEX IF NOT EXISTS idx_match_teams_match ON match_teams(match_id);
CREATE INDEX IF NOT EXISTS idx_match_team_players_team ON match_team_players(match_team_id);
CREATE INDEX IF NOT EXISTS idx_courts_session ON courts(session_id);
