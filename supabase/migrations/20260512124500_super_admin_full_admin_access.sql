/*
  # Super admin full admin access

  The app treats super_admin as an admin everywhere. This migration adds a safe
  role-check helper and broad admin-management policies so super_admin users can
  perform the same database operations as admins across the admin screens.
*/

CREATE OR REPLACE FUNCTION public.is_admin_or_super_admin()
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

REVOKE EXECUTE ON FUNCTION public.is_admin_or_super_admin() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_admin_or_super_admin() FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_admin_or_super_admin() FROM authenticated;

DROP POLICY IF EXISTS "Admins and super admins can manage profiles" ON profiles;
CREATE POLICY "Admins and super admins can manage profiles"
  ON profiles FOR ALL
  TO authenticated
  USING (public.is_admin_or_super_admin())
  WITH CHECK (public.is_admin_or_super_admin());

DROP POLICY IF EXISTS "Admins and super admins can manage sessions" ON sessions;
CREATE POLICY "Admins and super admins can manage sessions"
  ON sessions FOR ALL
  TO authenticated
  USING (public.is_admin_or_super_admin())
  WITH CHECK (public.is_admin_or_super_admin());

DROP POLICY IF EXISTS "Admins and super admins can manage session availability" ON session_availability;
CREATE POLICY "Admins and super admins can manage session availability"
  ON session_availability FOR ALL
  TO authenticated
  USING (public.is_admin_or_super_admin())
  WITH CHECK (public.is_admin_or_super_admin());

DROP POLICY IF EXISTS "Admins and super admins can manage courts" ON courts;
CREATE POLICY "Admins and super admins can manage courts"
  ON courts FOR ALL
  TO authenticated
  USING (public.is_admin_or_super_admin())
  WITH CHECK (public.is_admin_or_super_admin());

DROP POLICY IF EXISTS "Admins and super admins can manage court queues" ON court_queues;
CREATE POLICY "Admins and super admins can manage court queues"
  ON court_queues FOR ALL
  TO authenticated
  USING (public.is_admin_or_super_admin())
  WITH CHECK (public.is_admin_or_super_admin());

DROP POLICY IF EXISTS "Admins and super admins can manage matches" ON matches;
CREATE POLICY "Admins and super admins can manage matches"
  ON matches FOR ALL
  TO authenticated
  USING (public.is_admin_or_super_admin())
  WITH CHECK (public.is_admin_or_super_admin());

DROP POLICY IF EXISTS "Admins and super admins can manage match teams" ON match_teams;
CREATE POLICY "Admins and super admins can manage match teams"
  ON match_teams FOR ALL
  TO authenticated
  USING (public.is_admin_or_super_admin())
  WITH CHECK (public.is_admin_or_super_admin());

DROP POLICY IF EXISTS "Admins and super admins can manage match team players" ON match_team_players;
CREATE POLICY "Admins and super admins can manage match team players"
  ON match_team_players FOR ALL
  TO authenticated
  USING (public.is_admin_or_super_admin())
  WITH CHECK (public.is_admin_or_super_admin());

DROP POLICY IF EXISTS "Admins and super admins can manage player stats" ON player_stats;
CREATE POLICY "Admins and super admins can manage player stats"
  ON player_stats FOR ALL
  TO authenticated
  USING (public.is_admin_or_super_admin())
  WITH CHECK (public.is_admin_or_super_admin());

DROP POLICY IF EXISTS "Admins and super admins can manage app settings" ON app_settings;
CREATE POLICY "Admins and super admins can manage app settings"
  ON app_settings FOR ALL
  TO authenticated
  USING (public.is_admin_or_super_admin())
  WITH CHECK (public.is_admin_or_super_admin());

DROP POLICY IF EXISTS "Admins and super admins can manage availability poll tokens" ON availability_poll_tokens;
CREATE POLICY "Admins and super admins can manage availability poll tokens"
  ON availability_poll_tokens FOR ALL
  TO authenticated
  USING (public.is_admin_or_super_admin())
  WITH CHECK (public.is_admin_or_super_admin());

DROP POLICY IF EXISTS "Admins and super admins can manage session invites" ON session_invites;
CREATE POLICY "Admins and super admins can manage session invites"
  ON session_invites FOR ALL
  TO authenticated
  USING (public.is_admin_or_super_admin())
  WITH CHECK (public.is_admin_or_super_admin());
