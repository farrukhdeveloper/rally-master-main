/*
  # Move admin RLS helper out of public RPC surface

  `public.is_admin_or_super_admin()` had EXECUTE revoked to avoid exposing a
  SECURITY DEFINER function through PostgREST RPC. RLS policies still need an
  executable helper, so this migration creates the helper in a private schema
  and points admin policies at it.
*/

CREATE SCHEMA IF NOT EXISTS app_private;

CREATE OR REPLACE FUNCTION app_private.is_admin_or_super_admin()
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

REVOKE EXECUTE ON FUNCTION app_private.is_admin_or_super_admin() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION app_private.is_admin_or_super_admin() FROM anon;
GRANT EXECUTE ON FUNCTION app_private.is_admin_or_super_admin() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.is_admin_or_super_admin() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_admin_or_super_admin() FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_admin_or_super_admin() FROM authenticated;

DROP POLICY IF EXISTS "Admins and super admins can manage profiles" ON profiles;
CREATE POLICY "Admins and super admins can manage profiles"
  ON profiles FOR ALL
  TO authenticated
  USING (app_private.is_admin_or_super_admin())
  WITH CHECK (app_private.is_admin_or_super_admin());

DROP POLICY IF EXISTS "Admins and super admins can manage sessions" ON sessions;
CREATE POLICY "Admins and super admins can manage sessions"
  ON sessions FOR ALL
  TO authenticated
  USING (app_private.is_admin_or_super_admin())
  WITH CHECK (app_private.is_admin_or_super_admin());

DROP POLICY IF EXISTS "Admins and super admins can manage session availability" ON session_availability;
CREATE POLICY "Admins and super admins can manage session availability"
  ON session_availability FOR ALL
  TO authenticated
  USING (app_private.is_admin_or_super_admin())
  WITH CHECK (app_private.is_admin_or_super_admin());

DROP POLICY IF EXISTS "Admins and super admins can manage courts" ON courts;
CREATE POLICY "Admins and super admins can manage courts"
  ON courts FOR ALL
  TO authenticated
  USING (app_private.is_admin_or_super_admin())
  WITH CHECK (app_private.is_admin_or_super_admin());

DROP POLICY IF EXISTS "Admins and super admins can manage court queues" ON court_queues;
CREATE POLICY "Admins and super admins can manage court queues"
  ON court_queues FOR ALL
  TO authenticated
  USING (app_private.is_admin_or_super_admin())
  WITH CHECK (app_private.is_admin_or_super_admin());

DROP POLICY IF EXISTS "Admins and super admins can manage matches" ON matches;
CREATE POLICY "Admins and super admins can manage matches"
  ON matches FOR ALL
  TO authenticated
  USING (app_private.is_admin_or_super_admin())
  WITH CHECK (app_private.is_admin_or_super_admin());

DROP POLICY IF EXISTS "Admins and super admins can manage match teams" ON match_teams;
CREATE POLICY "Admins and super admins can manage match teams"
  ON match_teams FOR ALL
  TO authenticated
  USING (app_private.is_admin_or_super_admin())
  WITH CHECK (app_private.is_admin_or_super_admin());

DROP POLICY IF EXISTS "Admins and super admins can manage match team players" ON match_team_players;
CREATE POLICY "Admins and super admins can manage match team players"
  ON match_team_players FOR ALL
  TO authenticated
  USING (app_private.is_admin_or_super_admin())
  WITH CHECK (app_private.is_admin_or_super_admin());

DROP POLICY IF EXISTS "Admins and super admins can manage player stats" ON player_stats;
CREATE POLICY "Admins and super admins can manage player stats"
  ON player_stats FOR ALL
  TO authenticated
  USING (app_private.is_admin_or_super_admin())
  WITH CHECK (app_private.is_admin_or_super_admin());

DROP POLICY IF EXISTS "Admins and super admins can manage app settings" ON app_settings;
CREATE POLICY "Admins and super admins can manage app settings"
  ON app_settings FOR ALL
  TO authenticated
  USING (app_private.is_admin_or_super_admin())
  WITH CHECK (app_private.is_admin_or_super_admin());

DROP POLICY IF EXISTS "Admins and super admins can manage availability poll tokens" ON availability_poll_tokens;
CREATE POLICY "Admins and super admins can manage availability poll tokens"
  ON availability_poll_tokens FOR ALL
  TO authenticated
  USING (app_private.is_admin_or_super_admin())
  WITH CHECK (app_private.is_admin_or_super_admin());

DROP POLICY IF EXISTS "Admins and super admins can manage session invites" ON session_invites;
CREATE POLICY "Admins and super admins can manage session invites"
  ON session_invites FOR ALL
  TO authenticated
  USING (app_private.is_admin_or_super_admin())
  WITH CHECK (app_private.is_admin_or_super_admin());
