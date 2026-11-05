-- Profile photos are cropped and compressed by the client before upload.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('player-photos', 'player-photos', true, 2097152, ARRAY['image/jpeg'])
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Players and admins upload profile photos" ON storage.objects;
CREATE POLICY "Players and admins upload profile photos"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'player-photos'
    AND name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}[.]jpg$'
    AND ((storage.foldername(name))[1] = auth.uid()::text
         OR app_private.is_admin_or_super_admin())
  );

DROP POLICY IF EXISTS "Authenticated users can read profile photos" ON storage.objects;
CREATE POLICY "Authenticated users can read profile photos"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'player-photos');

DROP POLICY IF EXISTS "Players and admins delete profile photos" ON storage.objects;
CREATE POLICY "Players and admins delete profile photos"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'player-photos'
    AND ((storage.foldername(name))[1] = auth.uid()::text
         OR app_private.is_admin_or_super_admin())
  );

-- Keep player name, email, role, and other managed fields protected while
-- allowing the player to set or remove a photo in their own folder.
CREATE OR REPLACE FUNCTION app_private.guard_player_profile_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor_role text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.avatar_url, '') <> ''
     AND NEW.avatar_url !~ ('^' || NEW.id::text || '/[0-9a-f-]{36}[.]jpg$') THEN
    RAISE EXCEPTION 'Invalid profile photo path';
  END IF;

  SELECT role INTO actor_role FROM public.profiles WHERE id = auth.uid();
  IF actor_role IN ('admin', 'super_admin') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.id IS DISTINCT FROM auth.uid()
       OR NEW.role IS DISTINCT FROM 'player'
       OR NEW.skill_level IS DISTINCT FROM 'level_5'
       OR NEW.environment IS DISTINCT FROM 'prod' THEN
      RAISE EXCEPTION 'Player profile fields are restricted';
    END IF;
  ELSIF (to_jsonb(NEW) - 'phone' - 'last_login_at' - 'avatar_url')
       IS DISTINCT FROM (to_jsonb(OLD) - 'phone' - 'last_login_at' - 'avatar_url') THEN
    RAISE EXCEPTION 'Only your phone number and profile photo can be changed';
  END IF;
  RETURN NEW;
END;
$$;
