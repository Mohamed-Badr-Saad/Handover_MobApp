-- Plant Handover: administrator can remove all old-sheet (archive) entries of one
-- database, e.g. to import the old sheets again from scratch.
-- Deletes in batches (each call stays well under the request time limit) and
-- records a "list reset" so every phone reloads its saved handover list.

create or replace function public.admin_clear_archive(p_db text, p_limit int default 2000) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_admin() then raise exception 'administrators only'; end if;
  if p_db not in ('engineers', 'managers') then raise exception 'bad database'; end if;
  delete from public.handovers
  where id in (select id from public.handovers where archived and db = p_db limit greatest(1, least(p_limit, 5000)));
  get diagnostics n = row_count;
  insert into public.settings (key, value) values ('list_reset', jsonb_build_object('at', clock_timestamp()))
  on conflict (key) do update set value = excluded.value;
  return n;
end $$;

grant execute on function public.admin_clear_archive(text, int) to authenticated;
