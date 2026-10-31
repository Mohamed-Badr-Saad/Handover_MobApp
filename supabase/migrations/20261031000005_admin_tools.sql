-- Plant Handover: administrator tools
--   * delete handovers - all or by filter - recoverable ("Deleted handovers") or permanent
--   * restore / list deleted handovers across both databases
--   * export pages of whole records (both databases) for the shared-folder export
--   * tombstones, so phones drop permanently deleted handovers from their saved
--     list and search (the "summary" each phone keeps), not only the database
--   * re-importing old sheets brings back entries that were moved to "Deleted"

-- ----------------------------------------------------------------------------- tombstones
create table if not exists public.handover_tombstones (
  id  uuid primary key,
  db  text not null default 'engineers',
  at  timestamptz not null default clock_timestamp()
);
create index if not exists tombstones_at_idx on public.handover_tombstones (at);
alter table public.handover_tombstones enable row level security;
drop policy if exists tombstones_read on public.handover_tombstones;
create policy tombstones_read on public.handover_tombstones for select to authenticated
  using (((select public.is_member()) and (db = 'engineers' or (select public.is_manager()))));
grant select on public.handover_tombstones to authenticated;

create or replace function public.handover_gone() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.handover_tombstones (id, db, at) values (old.id, old.db, clock_timestamp())
  on conflict (id) do update set at = excluded.at, db = excluded.db;
  return old;
end $$;
drop trigger if exists handovers_gone on public.handovers;
create trigger handovers_gone after delete on public.handovers
  for each row execute function public.handover_gone();

-- a handover that comes back (same id imported again) is no longer a tombstone
create or replace function public.handover_back() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.handover_tombstones where id = new.id;
  return new;
end $$;
drop trigger if exists handovers_back on public.handovers;
create trigger handovers_back after insert on public.handovers
  for each row execute function public.handover_back();

-- ----------------------------------------------------------------------------- filter
-- p: { db: all|engineers|managers, source: all|archive|app, state: active|deleted|any,
--      from: 'YYYY-MM-DD', to: 'YYYY-MM-DD', area, author (staff id), status, q (text),
--      legacy: [old ids], ids: [ids] }
create or replace function public.admin_match(h public.handovers, p jsonb) returns boolean
language sql stable set search_path = public as $$
  select
    (coalesce(p->>'db', 'all') = 'all' or h.db = p->>'db')
    and (coalesce(p->>'source', 'all') = 'all'
         or (p->>'source' = 'archive' and h.archived)
         or (p->>'source' = 'app' and not h.archived))
    and (case coalesce(p->>'state', 'active')
           when 'active' then h.deleted_at is null
           when 'deleted' then h.deleted_at is not null
           else true end)
    and (coalesce(p->>'from', '') = '' or (h.created_at is not null and h.created_at::date >= (p->>'from')::date))
    and (coalesce(p->>'to', '') = '' or (h.created_at is not null and h.created_at::date <= (p->>'to')::date))
    and (coalesce(p->>'area', '') = '' or h.area = p->>'area')
    and (coalesce(p->>'author', '') = '' or h.created_by = public.safe_uuid(p->>'author'))
    and (coalesce(p->>'status', '') = '' or h.status = p->>'status')
    and (coalesce(p->>'q', '') = '' or h.title ilike '%' || (p->>'q') || '%' or h.description ilike '%' || (p->>'q') || '%')
    and (p->'legacy' is null or h.legacy_id = any(array(select jsonb_array_elements_text(p->'legacy'))))
    and (p->'ids' is null or h.id = any(array(select public.safe_uuid(x) from jsonb_array_elements_text(p->'ids') x)))
$$;

create or replace function public.admin_count_handovers(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not public.is_admin() then raise exception 'administrators only'; end if;
  select jsonb_build_object(
      'total', count(*),
      'engineers', count(*) filter (where h.db = 'engineers'),
      'managers', count(*) filter (where h.db = 'managers'),
      'archive', count(*) filter (where h.archived),
      'app', count(*) filter (where not h.archived),
      'deleted', count(*) filter (where h.deleted_at is not null),
      'attachments', coalesce(sum(h.attachment_count), 0))
    into r
  from public.handovers h where public.admin_match(h, p);
  return r;
end $$;

-- One batch per call (stays under the request time limit); call until n = 0.
-- mode 'recoverable' -> moved to "Deleted handovers"; 'permanent' -> removed for good
-- (returns the storage paths of their attachments so the app can remove the files).
create or replace function public.admin_delete_handovers(p jsonb, p_mode text, p_limit int default 1000)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare ids uuid[]; n int; paths jsonb; me public.staff;
begin
  if not public.is_admin() then raise exception 'administrators only'; end if;
  if p_mode not in ('recoverable', 'permanent') then raise exception 'bad mode'; end if;
  select * into me from public.staff where auth_user_id = auth.uid();
  select array_agg(x.id) into ids from (
    select h.id from public.handovers h
    where public.admin_match(h, case when p_mode = 'recoverable'
                                     then jsonb_set(coalesce(p, '{}'), '{state}', '"active"') else p end)
    limit greatest(1, least(coalesce(p_limit, 1000), 3000))) x;
  if ids is null then return jsonb_build_object('n', 0, 'paths', '[]'::jsonb); end if;
  if p_mode = 'recoverable' then
    update public.handovers set deleted_at = now(), deleted_by = me.id, deleted_by_name = coalesce(me.name, '')
    where id = any(ids);
    get diagnostics n = row_count;
    return jsonb_build_object('n', n, 'paths', '[]'::jsonb);
  end if;
  select coalesce(jsonb_agg(a.path), '[]'::jsonb) into paths from public.handover_attachments a where a.handover_id = any(ids);
  delete from public.handovers where id = any(ids);
  get diagnostics n = row_count;
  return jsonb_build_object('n', n, 'paths', paths);
end $$;

-- ----------------------------------------------------------------------------- deleted bin (both databases)
create or replace function public.admin_deleted_list(p_limit int default 300)
returns setof public.handovers
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'administrators only'; end if;
  return query select * from public.handovers where deleted_at is not null
    order by deleted_at desc limit greatest(1, least(coalesce(p_limit, 300), 2000));
end $$;

create or replace function public.admin_restore_handovers(p_ids uuid[] default null) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_admin() then raise exception 'administrators only'; end if;
  update public.handovers set deleted_at = null, deleted_by = null, deleted_by_name = null
  where deleted_at is not null and (p_ids is null or id = any(p_ids));
  get diagnostics n = row_count;
  return n;
end $$;

-- ----------------------------------------------------------------------------- export (both databases)
-- Whole records with their actions, comments and attachment rows, ordered by id.
create or replace function public.admin_export_page(p_after uuid default null, p_limit int default 500)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not public.is_admin() then raise exception 'administrators only'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'h', to_jsonb(h) - 'snippet',
      'actions', coalesce((select jsonb_agg(to_jsonb(a) order by a.at) from public.handover_actions a where a.handover_id = h.id), '[]'::jsonb),
      'comments', coalesce((select jsonb_agg(to_jsonb(c) order by c.at) from public.handover_comments c where c.handover_id = h.id), '[]'::jsonb),
      'attachments', coalesce((select jsonb_agg(to_jsonb(f) order by f.at) from public.handover_attachments f where f.handover_id = h.id), '[]'::jsonb)
    ) order by h.id), '[]'::jsonb)
  into r
  from (select * from public.handovers where (p_after is null or id > p_after) order by id
        limit greatest(1, least(coalesce(p_limit, 500), 1000))) h;
  return r;
end $$;

-- ----------------------------------------------------------------------------- re-import old sheets
-- Same as before, plus: an entry that was moved to "Deleted" comes back when the
-- sheet is imported again, and actions / comments already present (by id or by
-- old id) are never doubled.
create or replace function public.import_archive(p_db text, p_records jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare r jsonb; hid uuid; n int := 0; a jsonb; c jsonb;
begin
  if not public.is_admin() then raise exception 'administrators only'; end if;
  if p_db not in ('engineers','managers') then raise exception 'bad database'; end if;
  for r in select * from jsonb_array_elements(p_records) loop
    insert into public.handovers as h (legacy_id, db, title, description, status, area, location, tags, team,
        created_by, created_by_name, created_by_original, created_at, updated_at, archived, legacy_status,
        date_unknown, source, imported_from, imported_at, imported_by)
    values (r->>'legacy_id', p_db, coalesce(r->>'title',''), coalesce(r->>'description',''),
        coalesce(r->>'status','info'), coalesce(r->>'area',''), coalesce(r->>'location',''),
        coalesce(array(select jsonb_array_elements_text(r->'tags')), '{}'), coalesce(r->'team','[]'),
        public.safe_uuid(r->>'created_by'), coalesce(r->>'created_by_name',''), r->>'created_by_original',
        (r->>'created_at')::timestamptz, coalesce((r->>'created_at')::timestamptz, '1990-01-01'::timestamptz), true,
        r->>'legacy_status', coalesce((r->>'date_unknown')::boolean, false), r->>'source', 'archive', now(),
        public.my_staff_id())
    on conflict (legacy_id) do update set db = excluded.db, title = excluded.title,
        description = excluded.description, status = excluded.status, area = excluded.area,
        location = excluded.location, tags = excluded.tags, team = excluded.team,
        created_by = excluded.created_by, created_by_name = excluded.created_by_name,
        created_by_original = excluded.created_by_original, created_at = excluded.created_at,
        legacy_status = excluded.legacy_status, date_unknown = excluded.date_unknown, source = excluded.source,
        deleted_at = null, deleted_by = null, deleted_by_name = null
    returning id into hid;
    for a in select * from jsonb_array_elements(coalesce(r->'actions','[]')) loop
      insert into public.handover_actions (id, handover_id, legacy_id, text, status, by_id, by_name, at,
          done_by_id, done_by_name, done_at)
      values (coalesce(public.safe_uuid(a->>'legacy_id'), gen_random_uuid()), hid, a->>'legacy_id', a->>'text',
          coalesce(a->>'status','old'), public.safe_uuid(a->>'by_id'),
          coalesce(a->>'by_name',''), (a->>'at')::timestamptz, public.safe_uuid(a->>'done_by_id'),
          a->>'done_by_name', (a->>'done_at')::timestamptz)
      on conflict do nothing;
    end loop;
    for c in select * from jsonb_array_elements(coalesce(r->'comments','[]')) loop
      insert into public.handover_comments (id, handover_id, legacy_id, text, by_id, by_name, at, imported)
      values (coalesce(public.safe_uuid(c->>'legacy_id'), gen_random_uuid()), hid, c->>'legacy_id', c->>'text',
          public.safe_uuid(c->>'by_id'), coalesce(c->>'by_name',''),
          coalesce((c->>'at')::timestamptz, now()), true)
      on conflict do nothing;
    end loop;
    n := n + 1;
  end loop;
  return n;
end $$;

grant execute on function public.admin_count_handovers(jsonb) to authenticated;
grant execute on function public.admin_delete_handovers(jsonb, text, int) to authenticated;
grant execute on function public.admin_deleted_list(int) to authenticated;
grant execute on function public.admin_restore_handovers(uuid[]) to authenticated;
grant execute on function public.admin_export_page(uuid, int) to authenticated;
grant execute on function public.import_archive(text, jsonb) to authenticated;
