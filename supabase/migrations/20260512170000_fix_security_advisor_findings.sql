/*
  # Fix Supabase security advisor findings

  - `player_match_history` should run as the querying user, not as the view owner.
  - `is_admin_or_super_admin()` is an internal RLS helper and should not be callable
    through `/rest/v1/rpc/is_admin_or_super_admin`.

  The helper remains SECURITY DEFINER so it can safely check the current user's role
  from RLS policies without being blocked by profile table policies.
*/

ALTER VIEW public.player_match_history SET (security_invoker = true);

REVOKE EXECUTE ON FUNCTION public.is_admin_or_super_admin() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_admin_or_super_admin() FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_admin_or_super_admin() FROM authenticated;
