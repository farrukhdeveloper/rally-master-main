/*
  # Safe challenge deletion

  These RPCs remove linked normal-match history while enforcing the existing
  challenge organiser permissions in one database transaction.
*/

CREATE OR REPLACE FUNCTION public.delete_challenge_fixture(target_fixture_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_private
AS $$
DECLARE
  target_competition_id uuid;
  linked_match_id uuid;
BEGIN
  SELECT competition_id, match_id
  INTO target_competition_id, linked_match_id
  FROM competition_fixtures
  WHERE id = target_fixture_id;

  IF target_competition_id IS NULL THEN
    RAISE EXCEPTION 'Challenge match not found';
  END IF;

  IF NOT app_private.can_manage_competition(target_competition_id) THEN
    RAISE EXCEPTION 'Only a challenge organiser can delete this match'
      USING ERRCODE = '42501';
  END IF;

  IF linked_match_id IS NOT NULL THEN
    DELETE FROM matches WHERE id = linked_match_id;
  END IF;

  DELETE FROM competition_fixtures WHERE id = target_fixture_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_group_challenge(target_competition_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_private
AS $$
DECLARE
  linked_session_id uuid;
BEGIN
  SELECT session_id
  INTO linked_session_id
  FROM competitions
  WHERE id = target_competition_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Challenge not found';
  END IF;

  IF NOT app_private.can_manage_competition(target_competition_id) THEN
    RAISE EXCEPTION 'Only a challenge organiser can delete this challenge'
      USING ERRCODE = '42501';
  END IF;

  IF linked_session_id IS NOT NULL THEN
    DELETE FROM matches WHERE session_id = linked_session_id;
    DELETE FROM sessions WHERE id = linked_session_id;
  END IF;

  DELETE FROM competitions WHERE id = target_competition_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_challenge_fixture(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_group_challenge(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_challenge_fixture(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_group_challenge(uuid) TO authenticated;
