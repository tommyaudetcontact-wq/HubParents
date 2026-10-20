-- Keep the automatic-RLS event trigger, but do not expose it as an API function.
revoke execute on function public.rls_auto_enable() from public,anon,authenticated;
