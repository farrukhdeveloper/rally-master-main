-- Challenge participation is defined by competition_rosters, not by the
-- ordinary session invitation and availability workflow.
UPDATE public.session_invites AS invite
SET status = 'declined'
FROM public.sessions AS session
WHERE invite.session_id = session.id
  AND session.session_type = 'group_challenge'
  AND invite.status = 'pending';

CREATE OR REPLACE FUNCTION app_private.guard_challenge_session_invite()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'pending' AND EXISTS (
    SELECT 1 FROM public.sessions
    WHERE id = NEW.session_id AND session_type = 'group_challenge'
  ) THEN
    RAISE EXCEPTION 'Group challenge rosters are managed from Group Challenges';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_challenge_session_invite_trigger ON public.session_invites;
CREATE TRIGGER guard_challenge_session_invite_trigger
  BEFORE INSERT OR UPDATE ON public.session_invites
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_challenge_session_invite();
