-- Level progression is calculated in the app from match history.
-- These fields/tables support login visibility for admins.

ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS last_login_at timestamptz;

CREATE TABLE IF NOT EXISTS user_login_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  logged_in_at timestamptz NOT NULL DEFAULT now(),
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_login_events_user_id_logged_in
ON user_login_events(user_id, logged_in_at DESC);

ALTER TABLE user_login_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can insert own login events" ON user_login_events;
CREATE POLICY "Users can insert own login events"
ON user_login_events
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can read own login events" ON user_login_events;
CREATE POLICY "Users can read own login events"
ON user_login_events
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Admins can read login events" ON user_login_events;
CREATE POLICY "Admins can read login events"
ON user_login_events
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM profiles p
    WHERE p.id = auth.uid()
      AND p.role IN ('admin', 'super_admin')
  )
);
