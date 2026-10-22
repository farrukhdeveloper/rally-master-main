-- Group challenge fixtures already create completed matches in their linked session.
-- The overall leaderboard includes those matches when the session is ranked.
UPDATE public.competitions
SET counts_for_rankings = true
WHERE competition_type = 'group_challenge' AND counts_for_rankings = false;

UPDATE public.sessions AS session
SET counts_for_rankings = true
FROM public.competitions AS competition
WHERE competition.session_id = session.id
  AND competition.competition_type = 'group_challenge'
  AND session.counts_for_rankings = false;

ALTER TABLE public.competitions
  ALTER COLUMN counts_for_rankings SET DEFAULT true;
