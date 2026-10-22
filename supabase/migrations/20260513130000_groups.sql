/*
  # Groups for rankings and future tournaments

  Players can belong to many groups, and each session can be attached to one
  group. Tournaments can later point at a group without changing player/session
  membership rules.
*/

CREATE TABLE IF NOT EXISTS groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  environment text NOT NULL DEFAULT 'prod' CHECK (environment IN ('dev', 'prod')),
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (environment, name)
);

CREATE TABLE IF NOT EXISTS player_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'organiser')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, player_id)
);

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_groups_environment ON groups(environment);
CREATE INDEX IF NOT EXISTS idx_player_groups_group_id ON player_groups(group_id);
CREATE INDEX IF NOT EXISTS idx_player_groups_player_id ON player_groups(player_id);
CREATE INDEX IF NOT EXISTS idx_sessions_group_id ON sessions(group_id);

ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read groups" ON groups;
CREATE POLICY "Authenticated users can read groups"
  ON groups FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Admins and super admins can manage groups" ON groups;
CREATE POLICY "Admins and super admins can manage groups"
  ON groups FOR ALL
  TO authenticated
  USING (app_private.is_admin_or_super_admin())
  WITH CHECK (app_private.is_admin_or_super_admin());

DROP POLICY IF EXISTS "Users can read own group memberships" ON player_groups;
CREATE POLICY "Users can read own group memberships"
  ON player_groups FOR SELECT
  TO authenticated
  USING (player_id = auth.uid() OR app_private.is_admin_or_super_admin());

DROP POLICY IF EXISTS "Admins and super admins can manage group memberships" ON player_groups;
CREATE POLICY "Admins and super admins can manage group memberships"
  ON player_groups FOR ALL
  TO authenticated
  USING (app_private.is_admin_or_super_admin())
  WITH CHECK (app_private.is_admin_or_super_admin());
