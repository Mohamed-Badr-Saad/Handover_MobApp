-- =============================================================================
-- Plant Handover (PWA) - database schema, security rules and functions.
-- Run once on the Supabase project (supabase db push, or paste into SQL Editor).
-- Every rule about who may see or change what lives here (Row Level Security),
-- so the managers' database is protected by the database, not only the app.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

-- ----------------------------------------------------------------------------- tables

create table if not exists public.staff (
  id              uuid primary key default gen_random_uuid(),
  employee_id     text unique,
  name            text not null,
  job_title       text not null default '',
  department      text not null default '',
  role            text not null default 'technician'
                  check (role in ('engineer','manager','supervisor','technician','administrator')),
  active          boolean not null default true,
  is_admin        boolean not null default false,
  auth_user_id    uuid unique references auth.users(id) on delete set null,
  password_set_at timestamptz,
  read_all_at     timestamptz,
  created_at      timestamptz not null default now()
);

create table if not exists public.areas (
  id    text primary key,
  name  text not null,
  sort  int  not null default 0
);

create table if not exists public.equipment_tags (
  tag_no          text primary key,
  type            text not null default 'OT',
  upper_equipment text not null default '',
  lrv             text not null default '',
  urv             text not null default '',
  unit            text not null default '',
  valve_size      text not null default '',
  description     text not null default '',
  area            text not null default '',
  active          boolean not null default true,
  updated_at      timestamptz not null default now()
);

create table if not exists public.handovers (
  id                  uuid primary key default gen_random_uuid(),
  legacy_id           text unique,                     -- id in the shared-folder app / old sheets
  db                  text not null default 'engineers' check (db in ('engineers','managers')),
  title               text not null default '',
  description         text not null default '',
  snippet             text generated always as (left(description, 240)) stored,
  status              text not null default 'info',    -- draft | info | info_followup
  kind                text,
  area                text not null default '',
  location            text not null default '',
  tags                text[] not null default '{}',
  team                jsonb not null default '[]',      -- [{id,name,role,jobTitle}]
  team_ids            uuid[] not null default '{}',     -- kept from team by trigger
  due_date            date,
  created_by          uuid references public.staff(id) on delete set null,
  created_by_name     text not null default '',
  created_by_original text,
  created_at          timestamptz,                      -- null = date unknown (old sheets)
  updated_at          timestamptz not null default now(),
  changed_at          timestamptz not null default now(),  -- any change, for syncing phones
  version             int not null default 1,
  history             jsonb not null default '[]',
  archived            boolean not null default false,   -- from the old Excel sheets: read-only
  legacy_status       text,
  date_unknown        boolean not null default false,
  source              text,
  imported_from       text,
  imported_at         timestamptz,
  imported_by         uuid references public.staff(id) on delete set null,
  comment_count       int not null default 0,
  attachment_count    int not null default 0,
  open_actions        int not null default 0,
  deleted_at          timestamptz,
  deleted_by          uuid references public.staff(id) on delete set null,
  deleted_by_name     text
);
create index if not exists handovers_changed_idx on public.handovers (changed_at, id);
create index if not exists handovers_created_idx on public.handovers (created_at desc);
create index if not exists handovers_db_idx      on public.handovers (db);
create index if not exists handovers_tags_idx    on public.handovers using gin (tags);

create table if not exists public.handover_actions (
  id           uuid primary key default gen_random_uuid(),
  handover_id  uuid not null references public.handovers(id) on delete cascade,
  legacy_id    text unique,
  text         text not null,
  status       text not null default 'open' check (status in ('open','done','old')),
  by_id        uuid references public.staff(id) on delete set null,
  by_name      text not null default '',
  at           timestamptz default now(),
  done_by_id   uuid references public.staff(id) on delete set null,
  done_by_name text,
  done_at      timestamptz,
  done_comment uuid
);
create index if not exists actions_handover_idx on public.handover_actions (handover_id);

create table if not exists public.handover_comments (
  id          uuid primary key default gen_random_uuid(),
  handover_id uuid not null references public.handovers(id) on delete cascade,
  legacy_id   text unique,
  text        text not null,
  by_id       uuid references public.staff(id) on delete set null,
  by_name     text not null default '',
  at          timestamptz not null default now(),
  action_id   uuid,
  imported    boolean not null default false
);
create index if not exists comments_handover_idx on public.handover_comments (handover_id);

create table if not exists public.handover_attachments (
  id          uuid primary key default gen_random_uuid(),
  handover_id uuid not null references public.handovers(id) on delete cascade,
  name        text not null,
  size        bigint not null default 0,
  mime        text not null default '',
  path        text not null unique,          -- <handover id>/<file id>-<name> in bucket "attachments"
  by_id       uuid references public.staff(id) on delete set null,
  by_name     text not null default '',
  at          timestamptz not null default now()
);
create index if not exists attachments_handover_idx on public.handover_attachments (handover_id);

create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  type        text not null,
  db          text not null default 'engineers' check (db in ('engineers','managers')),
  actor_id    uuid references public.staff(id) on delete set null,
  actor_name  text not null default '',
  handover_id uuid references public.handovers(id) on delete set null,
  title       text not null default '',
  text        text,
  status      text,
  count       int,
  at          timestamptz not null default now()
);
create index if not exists notifications_at_idx on public.notifications (at desc);

create table if not exists public.notification_reads (
  staff_id        uuid not null references public.staff(id) on delete cascade,
  notification_id uuid not null references public.notifications(id) on delete cascade,
  primary key (staff_id, notification_id)
);

create table if not exists public.settings (
  key   text primary key,
  value jsonb not null default '{}'
);

-- ----------------------------------------------------------------------------- who am I

create or replace function public.my_staff_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.staff where auth_user_id = auth.uid() and active limit 1
$$;

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff where auth_user_id = auth.uid() and active)
$$;

create or replace function public.is_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff where auth_user_id = auth.uid() and active and role = 'manager')
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff where auth_user_id = auth.uid() and active and is_admin)
$$;

-- Engineers' database: every signed-in person. Managers' database: managers only.
create or replace function public.can_see_db(p_db text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_member() and (p_db = 'engineers' or public.is_manager())
$$;

create or replace function public.can_see_handover(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.handovers h where h.id = p_id and public.can_see_db(h.db))
$$;

create or replace function public.safe_uuid(p text) returns uuid
language plpgsql immutable as $$
begin
  return p::uuid;
exception when others then
  return null;
end $$;

-- ----------------------------------------------------------------------------- triggers

create or replace function public.handovers_before_write() returns trigger
language plpgsql as $$
begin
  new.team_ids := coalesce((
    select array_agg(public.safe_uuid(e->>'id'))
    from jsonb_array_elements(coalesce(new.team, '[]'::jsonb)) e
    where public.safe_uuid(e->>'id') is not null), '{}');
  new.changed_at := clock_timestamp();
  return new;
end $$;
drop trigger if exists handovers_before_write on public.handovers;
create trigger handovers_before_write before insert or update on public.handovers
  for each row execute function public.handovers_before_write();

-- Counters on the handover row, kept by the database whoever adds the comment.
create or replace function public.refresh_handover_counts(p_id uuid) returns void
language sql security definer set search_path = public as $$
  update public.handovers h set
    comment_count    = (select count(*) from public.handover_comments c where c.handover_id = p_id),
    attachment_count = (select count(*) from public.handover_attachments a where a.handover_id = p_id),
    open_actions     = (select count(*) from public.handover_actions x where x.handover_id = p_id and x.status = 'open')
  where h.id = p_id
$$;

create or replace function public.child_changed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    perform public.refresh_handover_counts(old.handover_id);
    return old;
  end if;
  perform public.refresh_handover_counts(new.handover_id);
  -- a new comment brings the handover to the top (not for comments from old sheets)
  if tg_op = 'INSERT' and tg_table_name = 'handover_comments' then
    if not coalesce((to_jsonb(new) ->> 'imported')::boolean, false) then
      update public.handovers set updated_at = now() where id = new.handover_id;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists comments_changed on public.handover_comments;
create trigger comments_changed after insert or update or delete on public.handover_comments
  for each row execute function public.child_changed();
drop trigger if exists actions_changed on public.handover_actions;
create trigger actions_changed after insert or update or delete on public.handover_actions
  for each row execute function public.child_changed();
drop trigger if exists attachments_changed on public.handover_attachments;
create trigger attachments_changed after insert or update or delete on public.handover_attachments
  for each row execute function public.child_changed();

-- A notification about a handover always belongs to that handover's database.
create or replace function public.notifications_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.handover_id is not null then
    select h.db into new.db from public.handovers h where h.id = new.handover_id;
  end if;
  new.at := coalesce(new.at, now());
  return new;
end $$;
drop trigger if exists notifications_before_insert on public.notifications;
create trigger notifications_before_insert before insert on public.notifications
  for each row execute function public.notifications_before_insert();

-- ----------------------------------------------------------------------------- row level security

alter table public.staff                enable row level security;
alter table public.areas                enable row level security;
alter table public.equipment_tags       enable row level security;
alter table public.handovers            enable row level security;
alter table public.handover_actions     enable row level security;
alter table public.handover_comments    enable row level security;
alter table public.handover_attachments enable row level security;
alter table public.notifications        enable row level security;
alter table public.notification_reads   enable row level security;
alter table public.settings             enable row level security;

-- staff: everyone signed in reads the roster; administrators change it.
drop policy if exists staff_read on public.staff;
create policy staff_read on public.staff for select to authenticated using (public.is_member());
drop policy if exists staff_admin on public.staff;
create policy staff_admin on public.staff for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- areas and tags: read by all; anyone may add one from the form; admins change/remove.
drop policy if exists areas_read on public.areas;
create policy areas_read on public.areas for select to authenticated using (public.is_member());
drop policy if exists areas_add on public.areas;
create policy areas_add on public.areas for insert to authenticated with check (public.is_member());
drop policy if exists areas_admin_upd on public.areas;
create policy areas_admin_upd on public.areas for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists areas_admin_del on public.areas;
create policy areas_admin_del on public.areas for delete to authenticated using (public.is_admin());

drop policy if exists tags_read on public.equipment_tags;
create policy tags_read on public.equipment_tags for select to authenticated using (public.is_member());
drop policy if exists tags_add on public.equipment_tags;
create policy tags_add on public.equipment_tags for insert to authenticated with check (public.is_member());
drop policy if exists tags_admin_upd on public.equipment_tags;
create policy tags_admin_upd on public.equipment_tags for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists tags_admin_del on public.equipment_tags;
create policy tags_admin_del on public.equipment_tags for delete to authenticated using (public.is_admin());

-- handovers
drop policy if exists handovers_read on public.handovers;
create policy handovers_read on public.handovers for select to authenticated
  using (((select public.is_member()) and (db = 'engineers' or (select public.is_manager()))));
drop policy if exists handovers_insert on public.handovers;
create policy handovers_insert on public.handovers for insert to authenticated
  with check (
    public.is_member()
    and (created_by = public.my_staff_id() or public.is_admin())
    and (db = 'engineers' or public.is_manager() or public.is_admin()));
drop policy if exists handovers_update on public.handovers;
create policy handovers_update on public.handovers for update to authenticated
  using (((select public.is_member()) and (db = 'engineers' or (select public.is_manager())))
         and ((created_by = (select public.my_staff_id()) and not archived) or (select public.is_admin())))
  with check (((select public.is_member()) and (db = 'engineers' or (select public.is_manager())))
         and ((created_by = (select public.my_staff_id()) and not archived) or (select public.is_admin())));

-- actions required: seen with the handover; anyone who sees it may add one;
-- the author (or an admin) rewords or removes; "done" goes through add_comment().
drop policy if exists actions_read on public.handover_actions;
create policy actions_read on public.handover_actions for select to authenticated
  using (public.can_see_handover(handover_id));
drop policy if exists actions_add on public.handover_actions;
create policy actions_add on public.handover_actions for insert to authenticated
  with check (public.can_see_handover(handover_id) and (by_id = public.my_staff_id() or public.is_admin()));
drop policy if exists actions_author_upd on public.handover_actions;
create policy actions_author_upd on public.handover_actions for update to authenticated
  using (public.is_admin() or exists (select 1 from public.handovers h where h.id = handover_id
         and h.created_by = public.my_staff_id() and not h.archived))
  with check (public.can_see_handover(handover_id));
drop policy if exists actions_author_del on public.handover_actions;
create policy actions_author_del on public.handover_actions for delete to authenticated
  using (public.is_admin() or exists (select 1 from public.handovers h where h.id = handover_id
         and h.created_by = public.my_staff_id() and not h.archived));

drop policy if exists comments_read on public.handover_comments;
create policy comments_read on public.handover_comments for select to authenticated
  using (public.can_see_handover(handover_id));
drop policy if exists comments_add on public.handover_comments;
create policy comments_add on public.handover_comments for insert to authenticated
  with check (public.can_see_handover(handover_id) and (by_id = public.my_staff_id() or public.is_admin()));

drop policy if exists attachments_read on public.handover_attachments;
create policy attachments_read on public.handover_attachments for select to authenticated
  using (public.can_see_handover(handover_id));
drop policy if exists attachments_add on public.handover_attachments;
create policy attachments_add on public.handover_attachments for insert to authenticated
  with check (public.can_see_handover(handover_id) and (by_id = public.my_staff_id() or public.is_admin()));
drop policy if exists attachments_del on public.handover_attachments;
create policy attachments_del on public.handover_attachments for delete to authenticated
  using (public.is_admin() or by_id = public.my_staff_id());

drop policy if exists notifications_read on public.notifications;
create policy notifications_read on public.notifications for select to authenticated
  using (((select public.is_member()) and (db = 'engineers' or (select public.is_manager()))));
drop policy if exists notifications_add on public.notifications;
create policy notifications_add on public.notifications for insert to authenticated
  with check (public.is_member() and (actor_id = public.my_staff_id() or public.is_admin()));

drop policy if exists reads_own on public.notification_reads;
create policy reads_own on public.notification_reads for all to authenticated
  using (staff_id = public.my_staff_id()) with check (staff_id = public.my_staff_id());

drop policy if exists settings_read on public.settings;
create policy settings_read on public.settings for select to authenticated using (public.is_member());
drop policy if exists settings_admin on public.settings;
create policy settings_admin on public.settings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke all on all tables in schema public from anon;

-- ----------------------------------------------------------------------------- functions the app calls

-- Names on the sign-in screen (before signing in): only people who may sign in.
create or replace function public.sign_in_roster()
returns table (id uuid, name text, job_title text, role text, has_account boolean)
language sql stable security definer set search_path = public as $$
  select s.id, s.name, s.job_title, s.role, s.auth_user_id is not null
  from public.staff s
  where s.active and (s.role in ('engineer','manager','administrator') or s.is_admin)
  order by s.name
$$;

-- First sign-in: the new login (address "staff-<staff id>@...") claims its roster entry.
-- The very first account becomes administrator.
create or replace function public.claim_account(p_staff uuid)
returns public.staff
language plpgsql security definer set search_path = public as $$
declare
  me_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  rec public.staff;
  no_admin boolean;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if split_part(me_email, '@', 1) <> 'staff-' || p_staff::text then
    raise exception 'this login does not belong to that person';
  end if;
  select not exists (select 1 from public.staff where is_admin and auth_user_id is not null) into no_admin;
  update public.staff s set auth_user_id = auth.uid(), password_set_at = now(),
         is_admin = s.is_admin or no_admin
   where s.id = p_staff and s.active and s.auth_user_id is null
     and (s.role in ('engineer','manager','administrator') or s.is_admin)
  returning * into rec;
  if rec.id is null then
    -- already linked to this same login (e.g. second call) is fine
    select * into rec from public.staff where id = p_staff and auth_user_id = auth.uid();
    if rec.id is null then raise exception 'this person already has an account or cannot sign in'; end if;
  end if;
  return rec;
end $$;

create or replace function public.me() returns public.staff
language sql stable security definer set search_path = public as $$
  select * from public.staff where auth_user_id = auth.uid() and active limit 1
$$;

-- Administrator: clear someone's login so they choose a new password next time.
create or replace function public.admin_reset_login(p_staff uuid) returns void
language plpgsql security definer set search_path = public, auth as $$
declare uid uuid;
begin
  if not public.is_admin() then raise exception 'administrators only'; end if;
  select auth_user_id into uid from public.staff where id = p_staff;
  update public.staff set auth_user_id = null, password_set_at = null where id = p_staff;
  if uid is not null then delete from auth.users where id = uid; end if;
end $$;

-- A comment, optionally completing an action required - one call, so the two never disagree.
create or replace function public.add_comment(p_handover uuid, p_text text, p_action uuid default null)
returns public.handover_comments
language plpgsql security definer set search_path = public as $$
declare me public.staff; c public.handover_comments;
begin
  select * into me from public.staff where auth_user_id = auth.uid() and active;
  if me.id is null or not public.can_see_handover(p_handover) then raise exception 'not allowed'; end if;
  if coalesce(btrim(p_text), '') = '' then raise exception 'empty comment'; end if;
  insert into public.handover_comments (handover_id, text, by_id, by_name, action_id)
  values (p_handover, p_text, me.id, me.name, p_action) returning * into c;
  if p_action is not null then
    update public.handover_actions set status = 'done', done_by_id = me.id, done_by_name = me.name,
           done_at = c.at, done_comment = c.id
     where id = p_action and handover_id = p_handover and status <> 'done';
  end if;
  return c;
end $$;

-- Mark everything read for me (on every device).
create or replace function public.mark_all_read() returns void
language sql security definer set search_path = public as $$
  update public.staff set read_all_at = now() where id = public.my_staff_id();
  delete from public.notification_reads where staff_id = public.my_staff_id();
$$;

-- Full-text-ish search over everything I may see (old entries included).
create or replace function public.search_handovers(q text, lim int default 200)
returns setof uuid
language sql stable security invoker set search_path = public as $$
  select h.id from public.handovers h
  where h.deleted_at is null
    and (h.title ilike '%' || q || '%' or h.description ilike '%' || q || '%'
         or h.created_by_name ilike '%' || q || '%' or array_to_string(h.tags, ' ') ilike '%' || q || '%')
  order by coalesce(h.created_at, h.updated_at) desc nulls last
  limit lim
$$;

-- Administrator: write a batch of old-sheet (archive) handovers into one database.
-- Rows are matched on legacy_id, so importing the same sheet again updates them
-- and keeps comments people added since.
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
        legacy_status = excluded.legacy_status, date_unknown = excluded.date_unknown, source = excluded.source
    returning id into hid;
    for a in select * from jsonb_array_elements(coalesce(r->'actions','[]')) loop
      insert into public.handover_actions (handover_id, legacy_id, text, status, by_id, by_name, at,
          done_by_id, done_by_name, done_at)
      values (hid, a->>'legacy_id', a->>'text', coalesce(a->>'status','old'), public.safe_uuid(a->>'by_id'),
          coalesce(a->>'by_name',''), (a->>'at')::timestamptz, public.safe_uuid(a->>'done_by_id'),
          a->>'done_by_name', (a->>'done_at')::timestamptz)
      on conflict (legacy_id) do update set text = excluded.text, status = excluded.status;
    end loop;
    for c in select * from jsonb_array_elements(coalesce(r->'comments','[]')) loop
      insert into public.handover_comments (handover_id, legacy_id, text, by_id, by_name, at, imported)
      values (hid, c->>'legacy_id', c->>'text', public.safe_uuid(c->>'by_id'), coalesce(c->>'by_name',''),
          coalesce((c->>'at')::timestamptz, now()), true)
      on conflict (legacy_id) do update set text = excluded.text;
    end loop;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Administrator: move whole records from the shared-folder app (both databases).
-- Handovers already moved are updated; actions, comments and attachment rows
-- already moved are left as they are. Runs as the database owner so an
-- administrator who is not a manager can still move the managers' records.
create or replace function public.admin_move_handovers(p_handovers jsonb, p_actions jsonb default '[]',
    p_comments jsonb default '[]', p_attachments jsonb default '[]') returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_admin() then raise exception 'administrators only'; end if;
  insert into public.handovers as h (id, db, title, description, status, kind, area, location, tags, team, due_date,
      created_by, created_by_name, created_at, updated_at, history, version, imported_from, imported_at, imported_by,
      deleted_at, deleted_by, deleted_by_name)
  select r.id, coalesce(r.db, 'engineers'), coalesce(r.title, ''), coalesce(r.description, ''), coalesce(r.status, 'info'),
      r.kind, coalesce(r.area, ''), coalesce(r.location, ''), coalesce(r.tags, '{}'), coalesce(r.team, '[]'), r.due_date,
      r.created_by, coalesce(r.created_by_name, ''), r.created_at, coalesce(r.updated_at, r.created_at, now()),
      coalesce(r.history, '[]'), coalesce(r.version, 1), r.imported_from, r.imported_at, r.imported_by,
      r.deleted_at, r.deleted_by, r.deleted_by_name
  from jsonb_populate_recordset(null::public.handovers, p_handovers) r
  on conflict (id) do update set db = excluded.db, title = excluded.title, description = excluded.description,
      status = excluded.status, kind = excluded.kind, area = excluded.area, location = excluded.location,
      tags = excluded.tags, team = excluded.team, due_date = excluded.due_date, created_by = excluded.created_by,
      created_by_name = excluded.created_by_name, created_at = excluded.created_at, updated_at = excluded.updated_at,
      history = excluded.history, version = excluded.version, deleted_at = excluded.deleted_at,
      deleted_by = excluded.deleted_by, deleted_by_name = excluded.deleted_by_name;
  get diagnostics n = row_count;
  insert into public.handover_actions (id, handover_id, text, status, by_id, by_name, at, done_by_id, done_by_name, done_at, done_comment)
  select a.id, a.handover_id, a.text, coalesce(a.status, 'open'), a.by_id, coalesce(a.by_name, ''), coalesce(a.at, now()),
      a.done_by_id, a.done_by_name, a.done_at, a.done_comment
  from jsonb_populate_recordset(null::public.handover_actions, p_actions) a
  on conflict (id) do nothing;
  insert into public.handover_comments (id, handover_id, text, by_id, by_name, at, action_id, imported)
  select c.id, c.handover_id, c.text, c.by_id, coalesce(c.by_name, ''), coalesce(c.at, now()), c.action_id, true
  from jsonb_populate_recordset(null::public.handover_comments, p_comments) c
  on conflict (id) do nothing;
  insert into public.handover_attachments (id, handover_id, name, size, mime, path, by_id, by_name, at)
  select f.id, f.handover_id, f.name, coalesce(f.size, 0), coalesce(f.mime, ''), f.path, f.by_id, coalesce(f.by_name, ''), coalesce(f.at, now())
  from jsonb_populate_recordset(null::public.handover_attachments, p_attachments) f
  on conflict (id) do nothing;
  return n;
end $$;

-- Administrator: archive counts per database (for the Administration page).
create or replace function public.archive_info()
returns table (db text, count bigint, last_import timestamptz)
language sql stable security definer set search_path = public as $$
  select h.db, count(*), max(h.imported_at) from public.handovers h
  where h.archived and public.is_admin() group by h.db
$$;

grant execute on function public.sign_in_roster() to anon, authenticated;
grant execute on all functions in schema public to authenticated;

-- ----------------------------------------------------------------------------- storage (attachments)

insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;

drop policy if exists attachments_obj_read on storage.objects;
create policy attachments_obj_read on storage.objects for select to authenticated
  using (bucket_id = 'attachments'
         and (public.can_see_handover(public.safe_uuid((storage.foldername(name))[1])) or public.is_admin()));
drop policy if exists attachments_obj_add on storage.objects;
create policy attachments_obj_add on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments'
         and (public.can_see_handover(public.safe_uuid((storage.foldername(name))[1])) or public.is_admin()));
drop policy if exists attachments_obj_upd on storage.objects;
create policy attachments_obj_upd on storage.objects for update to authenticated
  using (bucket_id = 'attachments' and public.is_admin())
  with check (bucket_id = 'attachments' and public.is_admin());
drop policy if exists attachments_obj_del on storage.objects;
create policy attachments_obj_del on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and public.is_admin());
