/*
  # Scope admin access by group ownership

  Super admins can manage everything. Normal admins can manage groups they own
  and sessions that either they created directly or that belong to one of their
  groups.
*/

CREATE OR REPLACE FUNCTION app_private.is_super_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM profiles
    WHERE id = auth.uid()
    AND role = 'super_admin'
  );
$$;

CREATE OR REPLACE FUNCTION app_private.is_admin_user()
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

CREATE OR REPLACE FUNCTION app_private.can_manage_group(target_group_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT app_private.is_super_admin()
    OR EXISTS (
      SELECT 1
      FROM groups
      WHERE id = target_group_id
      AND created_by = auth.uid()
    );
$$;

CREATE OR REPLACE FUNCTION app_private.can_manage_session(target_session_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT app_private.is_super_admin()
    OR EXISTS (
      SELECT 1
      FROM sessions s
      LEFT JOIN groups g ON g.id = s.group_id
      WHERE s.id = target_session_id
      AND (
        s.created_by = auth.uid()
        OR g.created_by = auth.uid()
      )
    );
$$;

REVOKE EXECUTE ON FUNCTION app_private.is_super_admin() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION app_private.is_super_admin() FROM anon;
GRANT EXECUTE ON FUNCTION app_private.is_super_admin() TO authenticated;

REVOKE EXECUTE ON FUNCTION app_private.is_admin_user() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION app_private.is_admin_user() FROM anon;
GRANT EXECUTE ON FUNCTION app_private.is_admin_user() TO authenticated;

REVOKE EXECUTE ON FUNCTION app_private.can_manage_group(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION app_private.can_manage_group(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION app_private.can_manage_group(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION app_private.can_manage_session(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION app_private.can_manage_session(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION app_private.can_manage_session(uuid) TO authenticated;

DROP POLICY IF EXISTS "Admins and super admins can manage groups" ON groups;
CREATE POLICY "Group owners and super admins can manage groups"
  ON groups FOR ALL
  TO authenticated
  USING (app_private.is_super_admin() OR created_by = auth.uid())
  WITH CHECK (app_private.is_super_admin() OR created_by = auth.uid());

DROP POLICY IF EXISTS "Admins and super admins can manage group memberships" ON player_groups;
CREATE POLICY "Group owners and super admins can manage group memberships"
  ON player_groups FOR ALL
  TO authenticated
  USING (app_private.can_manage_group(group_id))
  WITH CHECK (app_private.can_manage_group(group_id));

DROP POLICY IF EXISTS "Admins can insert sessions" ON sessions;
DROP POLICY IF EXISTS "Admins can update sessions" ON sessions;
DROP POLICY IF EXISTS "Admins and super admins can manage sessions" ON sessions;
CREATE POLICY "Group owners and super admins can manage sessions"
  ON sessions FOR ALL
  TO authenticated
  USING (
    app_private.is_super_admin()
    OR created_by = auth.uid()
    OR app_private.can_manage_group(group_id)
  )
  WITH CHECK (
    app_private.is_super_admin()
    OR (
      app_private.is_admin_user()
      AND created_by = auth.uid()
      AND (group_id IS NULL OR app_private.can_manage_group(group_id))
    )
  );

DROP POLICY IF EXISTS "Admins can insert courts" ON courts;
DROP POLICY IF EXISTS "Admins can update courts" ON courts;
DROP POLICY IF EXISTS "Admins can delete courts" ON courts;
DROP POLICY IF EXISTS "Admins and super admins can manage courts" ON courts;
CREATE POLICY "Session owners and super admins can manage courts"
  ON courts FOR ALL
  TO authenticated
  USING (app_private.can_manage_session(session_id))
  WITH CHECK (app_private.can_manage_session(session_id));

DROP POLICY IF EXISTS "Admins can insert any player availability" ON session_availability;
DROP POLICY IF EXISTS "Admins can update any player availability" ON session_availability;
DROP POLICY IF EXISTS "Admins and super admins can manage session availability" ON session_availability;
CREATE POLICY "Session owners and super admins can manage session availability"
  ON session_availability FOR ALL
  TO authenticated
  USING (app_private.can_manage_session(session_id))
  WITH CHECK (app_private.can_manage_session(session_id));

DROP POLICY IF EXISTS "Admins can select poll tokens" ON availability_poll_tokens;
DROP POLICY IF EXISTS "Admins can insert poll tokens" ON availability_poll_tokens;
DROP POLICY IF EXISTS "Admins can delete poll tokens" ON availability_poll_tokens;
DROP POLICY IF EXISTS "Admins and super admins can manage availability poll tokens" ON availability_poll_tokens;
CREATE POLICY "Session owners and super admins can manage availability poll tokens"
  ON availability_poll_tokens FOR ALL
  TO authenticated
  USING (app_private.can_manage_session(session_id))
  WITH CHECK (app_private.can_manage_session(session_id));

DROP POLICY IF EXISTS "Admins can view invites they sent" ON session_invites;
DROP POLICY IF EXISTS "Admins can create session invites" ON session_invites;
DROP POLICY IF EXISTS "Admins can delete their own invites" ON session_invites;
DROP POLICY IF EXISTS "Admins can view session invite requests" ON session_invites;
DROP POLICY IF EXISTS "Admins can update session invite requests" ON session_invites;
DROP POLICY IF EXISTS "Admins and super admins can manage session invites" ON session_invites;
CREATE POLICY "Session owners and super admins can manage session invites"
  ON session_invites FOR ALL
  TO authenticated
  USING (app_private.can_manage_session(session_id))
  WITH CHECK (app_private.can_manage_session(session_id));
