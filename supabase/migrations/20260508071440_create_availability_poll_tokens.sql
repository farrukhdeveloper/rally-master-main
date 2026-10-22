/*
  # Create availability poll tokens

  ## Purpose
  Enables WhatsApp-based availability polling. Admin generates a unique token per
  player per session. The token is embedded in a link sent via WhatsApp. When the
  player taps the link (no login required), the edge function marks them as available
  in session_availability.

  ## New Tables

  ### `availability_poll_tokens`
  - `id` (uuid, PK)
  - `session_id` (uuid, FK → sessions) — which session this poll is for
  - `player_id` (uuid, FK → profiles) — which player this token belongs to
  - `token` (text, unique) — the secret token embedded in the link
  - `used` (boolean) — whether the player has already responded
  - `response` (text, nullable) — 'yes' or 'no'
  - `created_at` (timestamptz)
  - `responded_at` (timestamptz, nullable)

  ## Security
  - RLS enabled; only admins can insert/select tokens
  - The edge function uses the service role key to update tokens (bypasses RLS)
    so no authenticated policy needed for token updates from the public endpoint
*/

CREATE TABLE IF NOT EXISTS availability_poll_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  used boolean NOT NULL DEFAULT false,
  response text CHECK (response IN ('yes', 'no')),
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  UNIQUE (session_id, player_id)
);

ALTER TABLE availability_poll_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can select poll tokens"
  ON availability_poll_tokens FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Admins can insert poll tokens"
  ON availability_poll_tokens FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Admins can delete poll tokens"
  ON availability_poll_tokens FOR DELETE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
