-- Replace both seeded rosters and all pending fixtures in one transaction.
-- Once any result exists, its players and match history must remain unchanged.
CREATE OR REPLACE FUNCTION public.replace_challenge_rosters(
  target_competition_id uuid,
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
  side_a_id uuid;
  side_b_id uuid;
  chosen_count integer;
  schedule_item jsonb;
  pair_seeds jsonb;
  first_seed integer;
  second_seed integer;
  new_fixture_id uuid;
  latest_time timestamptz;
BEGIN
  SELECT * INTO challenge FROM public.competitions
  WHERE id = target_competition_id AND competition_type = 'group_challenge'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Challenge not found'; END IF;
  IF NOT app_private.can_manage_competition(target_competition_id) THEN
    RAISE EXCEPTION 'Only the organiser can edit challenge rosters';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.competition_fixtures
    WHERE competition_id = target_competition_id AND (status <> 'scheduled' OR match_id IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'Player changes are locked after a match result has been recorded';
  END IF;

  IF player_ids_a IS NULL OR player_ids_b IS NULL
    OR cardinality(player_ids_a) < 2 OR cardinality(player_ids_a) <> cardinality(player_ids_b) THEN
    RAISE EXCEPTION 'Both teams need equal rosters of at least two players';
  END IF;
  SELECT count(DISTINCT chosen.id) INTO chosen_count
  FROM unnest(player_ids_a || player_ids_b) AS chosen(id);
  IF chosen_count <> cardinality(player_ids_a) + cardinality(player_ids_b) THEN
    RAISE EXCEPTION 'A player can appear only once in a challenge';
  END IF;
  IF (SELECT count(*) FROM public.profiles
      WHERE id = ANY(player_ids_a || player_ids_b) AND environment = challenge.environment) <> chosen_count THEN
    RAISE EXCEPTION 'All players must belong to the challenge environment';
  END IF;
  IF jsonb_typeof(fixture_schedule) IS DISTINCT FROM 'array'
    OR jsonb_array_length(fixture_schedule) < 1
    OR jsonb_array_length(fixture_schedule) > 1000 THEN
    RAISE EXCEPTION 'A valid replacement schedule is required';
  END IF;

  SELECT id INTO side_a_id FROM public.competition_groups WHERE competition_id = target_competition_id AND side = 'A';
  SELECT id INTO side_b_id FROM public.competition_groups WHERE competition_id = target_competition_id AND side = 'B';
  IF side_a_id IS NULL OR side_b_id IS NULL THEN RAISE EXCEPTION 'Challenge teams are missing'; END IF;

  DELETE FROM public.competition_fixtures WHERE competition_id = target_competition_id;
  DELETE FROM public.competition_rosters WHERE competition_id = target_competition_id;
  INSERT INTO public.competition_rosters (competition_id, competition_group_id, player_id, seed_number)
  SELECT target_competition_id, side_a_id, seeded.id, seeded.seed::integer
  FROM unnest(player_ids_a) WITH ORDINALITY AS seeded(id, seed);
  INSERT INTO public.competition_rosters (competition_id, competition_group_id, player_id, seed_number)
  SELECT target_competition_id, side_b_id, seeded.id, seeded.seed::integer
  FROM unnest(player_ids_b) WITH ORDINALITY AS seeded(id, seed);

  FOR schedule_item IN SELECT value FROM jsonb_array_elements(fixture_schedule) LOOP
    pair_seeds := schedule_item->'seeds';
    IF jsonb_typeof(pair_seeds) IS DISTINCT FROM 'array' OR jsonb_array_length(pair_seeds) <> 2 THEN
      RAISE EXCEPTION 'Each fixture needs two seeds';
    END IF;
    first_seed := (pair_seeds->>0)::integer;
    second_seed := (pair_seeds->>1)::integer;
    IF first_seed IS NULL OR second_seed IS NULL OR first_seed = second_seed
      OR first_seed < 1 OR second_seed < 1
      OR first_seed > cardinality(player_ids_a) OR second_seed > cardinality(player_ids_a) THEN
      RAISE EXCEPTION 'Fixture seed is outside the roster';
    END IF;
    INSERT INTO public.competition_fixtures (
      competition_id, round_number, wave_number, court_number, scheduled_at, status
    ) VALUES (
      target_competition_id,
      (schedule_item->>'round_number')::integer,
      (schedule_item->>'wave_number')::integer,
      (schedule_item->>'court_number')::integer,
      (schedule_item->>'scheduled_at')::timestamptz,
      'scheduled'
    ) RETURNING id INTO new_fixture_id;
    INSERT INTO public.competition_fixture_players (fixture_id, side, player_id, seed_number, team_position)
    VALUES
      (new_fixture_id, 'A', player_ids_a[first_seed], first_seed, 1),
      (new_fixture_id, 'A', player_ids_a[second_seed], second_seed, 2),
      (new_fixture_id, 'B', player_ids_b[first_seed], first_seed, 1),
      (new_fixture_id, 'B', player_ids_b[second_seed], second_seed, 2);
    latest_time := GREATEST(latest_time, (schedule_item->>'scheduled_at')::timestamptz);
  END LOOP;

  UPDATE public.competitions SET status = 'scheduled', updated_at = now() WHERE id = target_competition_id;
  UPDATE public.sessions SET status = 'open',
    end_time = (latest_time + make_interval(mins => challenge.fixture_minutes))::time
  WHERE id = challenge.session_id;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_challenge_rosters(uuid, uuid[], uuid[], jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_challenge_rosters(uuid, uuid[], uuid[], jsonb) TO authenticated;
