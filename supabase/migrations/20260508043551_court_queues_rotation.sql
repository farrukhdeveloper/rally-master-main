/*
  # Court Queues & Player Rotation

  ## Purpose
  Track which players are assigned to each court for a session,
  including their rotation state: playing, waiting, or resting.

  ## New Tables
  - `court_queues`
    - `id` - primary key
    - `session_id` - the session this queue belongs to
    - `court_id` - the court this queue belongs to
    - `player_id` - the player
    - `position` - queue position (lower = plays first, 0-3 = currently playing, 4-5 = next up waiting)
    - `consecutive_games` - how many games this player has played consecutively on this court
    - `status` - 'playing' | 'waiting' | 'resting'
    - `updated_at`

  ## Security
  - RLS enabled; authenticated users can read, admins can write
*/

CREATE TABLE IF NOT EXISTS court_queues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  court_id uuid NOT NULL REFERENCES courts(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  consecutive_games integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('playing', 'waiting', 'resting')),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(court_id, player_id)
);

ALTER TABLE court_queues ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Court queues viewable by authenticated users"
  ON court_queues FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can insert court queues"
  ON court_queues FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Admins can update court queues"
  ON court_queues FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Admins can delete court queues"
  ON court_queues FOR DELETE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE INDEX IF NOT EXISTS idx_court_queues_session ON court_queues(session_id);
CREATE INDEX IF NOT EXISTS idx_court_queues_court ON court_queues(court_id);
