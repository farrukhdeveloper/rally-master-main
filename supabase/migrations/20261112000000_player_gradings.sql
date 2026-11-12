-- Admin assessments are an audit trail. Inserting one assigns its final level
-- in the same transaction; match ratings remain advisory only.
CREATE TABLE IF NOT EXISTS public.player_gradings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  assessed_by uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id),
  technique smallint NOT NULL CHECK (technique BETWEEN 1 AND 9),
  movement smallint NOT NULL CHECK (movement BETWEEN 1 AND 9),
  consistency smallint NOT NULL CHECK (consistency BETWEEN 1 AND 9),
  match_play smallint NOT NULL CHECK (match_play BETWEEN 1 AND 9),
  assigned_level text NOT NULL CHECK (assigned_level IN (
    'level_1', 'level_2', 'level_3', 'level_4', 'level_5',
    'level_6', 'level_7', 'level_8', 'level_9'
  )),
  notes text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS player_gradings_player_created_idx
  ON public.player_gradings (player_id, created_at DESC);

ALTER TABLE public.player_gradings ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.player_gradings TO authenticated;

DROP POLICY IF EXISTS "Players and admins can read player gradings" ON public.player_gradings;
CREATE POLICY "Players and admins can read player gradings"
  ON public.player_gradings FOR SELECT TO authenticated
  USING (player_id = auth.uid() OR app_private.is_admin_or_super_admin());

DROP POLICY IF EXISTS "Admins can assess players" ON public.player_gradings;
CREATE POLICY "Admins can assess players"
  ON public.player_gradings FOR INSERT TO authenticated
  WITH CHECK (
    app_private.is_admin_or_super_admin()
    AND assessed_by = auth.uid()
  );

CREATE OR REPLACE FUNCTION app_private.apply_player_grading()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE public.profiles
  SET skill_level = NEW.assigned_level
  WHERE id = NEW.player_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS apply_player_grading_after_insert ON public.player_gradings;
CREATE TRIGGER apply_player_grading_after_insert
  AFTER INSERT ON public.player_gradings
  FOR EACH ROW EXECUTE FUNCTION app_private.apply_player_grading();
