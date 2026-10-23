-- PostgREST already enforces EXECUTE permissions on this RPC. The legacy
-- request.jwt.claim.role setting is absent for some service-role requests,
-- so checking it inside the function incorrectly rejects the Edge Function.
CREATE OR REPLACE FUNCTION public.reserve_contact_request(p_fingerprint text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  allowed boolean;
BEGIN
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
