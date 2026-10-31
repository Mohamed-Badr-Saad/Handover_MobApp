-- Plant Handover: daily "wake-up" so the free Supabase project is never paused
-- for inactivity. The Cloudflare Worker calls keepalive() once a day; it does a
-- real read and a small write, and records when it last ran.

create or replace function public.keepalive() returns jsonb
language plpgsql security definer set search_path = public as $$
declare n bigint; t timestamptz := now();
begin
  select count(*) into n from public.staff;
  insert into public.settings (key, value) values ('keepalive', jsonb_build_object('at', t, 'staff', n))
  on conflict (key) do update set value = excluded.value;
  return jsonb_build_object('ok', true, 'at', t);
end $$;

revoke all on function public.keepalive() from public;
grant execute on function public.keepalive() to anon, authenticated;
