-- Store contact messages even when the email provider is unavailable.
CREATE TABLE IF NOT EXISTS public.contact_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  email text NOT NULL,
  phone text NOT NULL DEFAULT '',
  message text NOT NULL,
  email_status text NOT NULL DEFAULT 'pending'
    CHECK (email_status IN ('pending', 'sent', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contact_requests_created_at_idx
  ON public.contact_requests (created_at DESC);

ALTER TABLE public.contact_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contact_requests FROM anon, authenticated;
GRANT SELECT ON public.contact_requests TO authenticated;

DROP POLICY IF EXISTS "Admins can read contact requests" ON public.contact_requests;
CREATE POLICY "Admins can read contact requests"
  ON public.contact_requests FOR SELECT TO authenticated
  USING (app_private.is_admin_or_super_admin());

-- Only the Edge Function's service role may reserve a send slot.
CREATE TABLE IF NOT EXISTS public.contact_request_limits (
  fingerprint text NOT NULL,
  window_start timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 1,
  PRIMARY KEY (fingerprint, window_start)
);
ALTER TABLE public.contact_request_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contact_request_limits FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.reserve_contact_request(p_fingerprint text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  allowed boolean;
BEGIN
  IF current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_fingerprint !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid fingerprint';
  END IF;

  INSERT INTO public.contact_request_limits (fingerprint, window_start, attempts)
  VALUES (p_fingerprint, date_trunc('hour', now()), 1)
  ON CONFLICT (fingerprint, window_start)
  DO UPDATE SET attempts = contact_request_limits.attempts + 1
    WHERE contact_request_limits.attempts < 3
  RETURNING true INTO allowed;

  RETURN COALESCE(allowed, false);
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_contact_request(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_contact_request(text) TO service_role;

-- A player may create a normal profile and subsequently change only their
-- phone and login timestamp. This protects role and name outside the UI too.
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
  ELSIF (to_jsonb(NEW) - 'phone' - 'last_login_at')
       IS DISTINCT FROM (to_jsonb(OLD) - 'phone' - 'last_login_at') THEN
    RAISE EXCEPTION 'Only your phone number can be changed';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_player_profile_write_trigger ON public.profiles;
CREATE TRIGGER guard_player_profile_write_trigger
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_player_profile_write();
