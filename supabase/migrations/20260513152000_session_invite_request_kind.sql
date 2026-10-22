-- Separate player requests from admin/group-owner invites.
-- Player requests are addressed to the session's group owner when there is one,
-- otherwise to the session creator.

ALTER TABLE public.session_invites
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'invite'
  CHECK (kind IN ('invite', 'request'));

UPDATE public.session_invites
SET kind = 'request'
WHERE kind = 'invite'
  AND status = 'pending'
  AND invited_by = player_id;

DROP POLICY IF EXISTS "Players can request session invites" ON public.session_invites;
CREATE POLICY "Players can request session invites"
  ON public.session_invites
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = player_id
    AND status = 'pending'
    AND kind = 'request'
    AND invited_by = (
      SELECT COALESCE(g.created_by, s.created_by)
      FROM public.sessions s
      LEFT JOIN public.groups g ON g.id = s.group_id
      WHERE s.id = session_id
    )
  );

DROP POLICY IF EXISTS "Players can update own session requests" ON public.session_invites;
CREATE POLICY "Players can update own session requests"
  ON public.session_invites
  FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = player_id
    AND kind = 'request'
  )
  WITH CHECK (
    auth.uid() = player_id
    AND status = 'pending'
    AND kind = 'request'
    AND invited_by = (
      SELECT COALESCE(g.created_by, s.created_by)
      FROM public.sessions s
      LEFT JOIN public.groups g ON g.id = s.group_id
      WHERE s.id = session_id
    )
  );
