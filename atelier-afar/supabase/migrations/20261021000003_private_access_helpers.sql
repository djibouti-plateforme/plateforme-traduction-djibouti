-- Les fonctions d'appartenance ne doivent pas être appelables via l'API REST.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

alter function public.is_member() set schema private;
alter function public.is_admin() set schema private;

revoke execute on function private.is_member() from public, anon;
revoke execute on function private.is_admin() from public, anon;
grant execute on function private.is_member() to authenticated;
grant execute on function private.is_admin() to authenticated;

revoke execute on function public.touch_updated() from public, anon, authenticated;
