/*
  # Session invite/request policies

  Supports two pending invite types in session_invites:
  - Admin invite: invited_by = admin id, player_id = invited player id
  - Player request: invited_by = player_id = requesting player id
*/

DROP POLICY IF EXISTS "Players can request session invites" ON session_invites;
CREATE POLICY "Players can request session invites"
  ON session_invites FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = player_id
    AND invited_by = auth.uid()
    AND status = 'pending'
  );

DROP POLICY IF EXISTS "Admins can view session invite requests" ON session_invites;
CREATE POLICY "Admins can view session invite requests"
  ON session_invites FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('admin', 'super_admin')
    )
  );

DROP POLICY IF EXISTS "Admins can update session invite requests" ON session_invites;
CREATE POLICY "Admins can update session invite requests"
  ON session_invites FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('admin', 'super_admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('admin', 'super_admin')
    )
  );
