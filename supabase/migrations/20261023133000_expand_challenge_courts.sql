-- Expand a scheduled challenge's courts and replace its pending fixtures atomically.
-- The existing roster replacement function protects any recorded result.
CREATE OR REPLACE FUNCTION public.replace_challenge_schedule(
  target_competition_id uuid,
  target_court_count integer,
  player_ids_a uuid[],
  player_ids_b uuid[],
  fixture_schedule jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  challenge public.competitions%ROWTYPE;
  existing_courts integer;
  court_index integer;
BEGIN
  SELECT * INTO challenge FROM public.competitions
  WHERE id = target_competition_id AND competition_type = 'group_challenge'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Challenge not found'; END IF;
  IF NOT app_private.can_manage_competition(target_competition_id) THEN
    RAISE EXCEPTION 'Only the organiser can edit this challenge';
  END IF;
  IF target_court_count IS NULL OR target_court_count < challenge.court_count OR target_court_count > 32 THEN
    RAISE EXCEPTION 'Court count must be between % and 32', challenge.court_count;
  END IF;
  IF challenge.session_id IS NULL THEN RAISE EXCEPTION 'Challenge session is missing'; END IF;

  -- Hold fixture rows while the old function verifies that none has a result.
  PERFORM 1 FROM public.competition_fixtures
  WHERE competition_id = target_competition_id FOR UPDATE;

  SELECT count(*) INTO existing_courts FROM public.courts WHERE session_id = challenge.session_id;
  IF existing_courts > target_court_count THEN
    RAISE EXCEPTION 'The linked session already has % courts', existing_courts;
  END IF;
  IF jsonb_typeof(fixture_schedule) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'A valid replacement schedule is required';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(fixture_schedule) AS item(value)
    WHERE COALESCE((item.value->>'court_number')::integer, 0) NOT BETWEEN 1 AND target_court_count
  ) THEN
    RAISE EXCEPTION 'A fixture references a court outside the selected court count';
  END IF;

  PERFORM public.replace_challenge_rosters(
    target_competition_id, player_ids_a, player_ids_b, fixture_schedule
  );

  FOR court_index IN (existing_courts + 1)..target_court_count LOOP
    INSERT INTO public.courts (session_id, name, status)
    VALUES (challenge.session_id, 'Court ' || court_index, 'available');
  END LOOP;
  UPDATE public.competitions
  SET court_count = target_court_count, updated_at = now()
  WHERE id = target_competition_id;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_challenge_schedule(uuid, integer, uuid[], uuid[], jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_challenge_schedule(uuid, integer, uuid[], uuid[], jsonb) TO authenticated;
