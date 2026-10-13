-- Child safety finding 10: who has read a child's records.
--
-- Every time someone other than the child or their parent or guardian opens
-- an under 18's injury, injury document, check-ins, game goals or member
-- record, the app records who, when and what. Verified parents and guardians
-- and admins can read the log for a child.
-- The log is kept separately from the records it describes, so it stays even
-- after a record is removed. Additive only: a new table, a trigger and new
-- functions; no existing rows are changed.

begin;

create table if not exists public.record_access_log (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.profiles (id) on delete cascade,
  viewer_id uuid references public.profiles (id) on delete set null,
  viewer_name text,
  viewer_role text,
  kind text not null check (
    kind in ('injury', 'injury_document', 'injury_document_shared', 'check_ins', 'goals', 'member_record')
  ),
  record_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists record_access_log_subject
  on public.record_access_log (subject_id, created_at desc);
create index if not exists record_access_log_viewer
  on public.record_access_log (viewer_id, subject_id, kind, created_at desc);

alter table public.record_access_log enable row level security;
-- Read and written only through the functions below.
revoke all on public.record_access_log from public, anon, authenticated;

-- What the signed-in member is to a child, for the log.
create or replace function public.record_viewer_role(p_subject_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when public.coaches_athlete(p_subject_id) then 'Coach'
    when public.physio_looks_after(p_subject_id) then 'Physio'
    when public.is_admin() then 'Admin'
    when public.is_safeguarding_officer() then 'Safeguarding contact'
    when public.is_committee() then 'Committee'
    else 'Member'
  end;
$$;

revoke execute on function public.record_viewer_role(uuid) from public, anon, authenticated;

-- Whether a view of this child's record is logged: the child is under 18,
-- and the viewer is someone else who isn't their parent or guardian.
create or replace function public.record_view_is_logged(p_subject_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and p_subject_id <> auth.uid()
    and not exists (
      select 1 from public.guardianships g
      where g.guardian_id = auth.uid() and g.athlete_id = p_subject_id
    )
    and exists (
      select 1 from public.profiles p
      where p.id = p_subject_id and public.is_minor(p.date_of_birth, p.under_17)
    );
$$;

revoke execute on function public.record_view_is_logged(uuid) from public, anon, authenticated;

-- Writes one log row. Repeat opens of the same record by the same person
-- within 30 minutes count once, so a refresh doesn't flood the log.
create or replace function public.write_record_access(
  p_subject_id uuid,
  p_kind text,
  p_record_id uuid,
  p_always boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.record_view_is_logged(p_subject_id) then
    return;
  end if;
  if not coalesce(p_always, false) and exists (
    select 1 from public.record_access_log l
    where l.viewer_id = auth.uid() and l.subject_id = p_subject_id and l.kind = p_kind
      and l.record_id is not distinct from p_record_id
      and l.created_at > now() - interval '30 minutes'
  ) then
    return;
  end if;
  insert into public.record_access_log (subject_id, viewer_id, viewer_name, viewer_role, kind, record_id)
  values (
    p_subject_id, auth.uid(),
    coalesce(public.member_display_name(auth.uid()), 'Member'),
    public.record_viewer_role(p_subject_id), p_kind, p_record_id
  );
end;
$$;

revoke execute on function public.write_record_access(uuid, text, uuid, boolean) from public, anon, authenticated;

-- Called by the app when a screen shows a child's record. Only logs what the
-- signed-in member can actually see; anything else is ignored.
create or replace function public.log_record_view(p_subject_id uuid, p_kind text, p_record_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_approved() or p_subject_id is null then
    return;
  end if;
  if p_kind = 'injury' then
    if not public.can_view_athlete_injuries(p_subject_id)
       or (p_record_id is not null and not exists (
         select 1 from public.injuries where id = p_record_id and athlete_id = p_subject_id
       )) then
      return;
    end if;
  elsif p_kind = 'check_ins' then
    if not public.can_view_check_ins(p_subject_id) then
      return;
    end if;
  elsif p_kind = 'goals' then
    if not public.can_view_game_goals(p_subject_id) then
      return;
    end if;
  elsif p_kind = 'member_record' then
    if not public.is_admin() then
      return;
    end if;
  else
    raise exception 'Unknown record kind';
  end if;
  perform public.write_record_access(p_subject_id, p_kind, p_record_id);
end;
$$;

revoke execute on function public.log_record_view(uuid, text, uuid) from public, anon;
grant execute on function public.log_record_view(uuid, text, uuid) to authenticated;

-- Opening or sharing an injury document is already recorded against the
-- document; it goes in the child's log too, every time.
create or replace function public.log_injury_document_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_athlete uuid;
begin
  select athlete_id into v_athlete from public.injuries where id = new.injury_id;
  if v_athlete is not null then
    perform public.write_record_access(
      v_athlete,
      case when new.kind = 'shared' then 'injury_document_shared' else 'injury_document' end,
      new.injury_id,
      true
    );
  end if;
  return new;
end;
$$;

revoke execute on function public.log_injury_document_access() from public, anon, authenticated;

drop trigger if exists injury_document_events_access_log on public.injury_document_events;
create trigger injury_document_events_access_log
  after insert on public.injury_document_events
  for each row execute function public.log_injury_document_access();

-- Who can read a child's log: their verified parents and guardians (until
-- the child turns 18) and admins.
create or replace function public.can_see_record_access(p_subject_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_approved()
    and (
      public.is_verified_guardian_of(p_subject_id)
      or public.is_admin()
    );
$$;

revoke execute on function public.can_see_record_access(uuid) from public, anon;
grant execute on function public.can_see_record_access(uuid) to authenticated;

-- A child's log, newest first. Empty for anyone who can't see it.
create or replace function public.record_access_history(p_subject_id uuid, p_limit integer default 200)
returns table (
  id uuid,
  viewer_name text,
  viewer_role text,
  kind text,
  record_id uuid,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select l.id, coalesce(l.viewer_name, 'Former member'), l.viewer_role, l.kind, l.record_id, l.created_at
  from public.record_access_log l
  where l.subject_id = p_subject_id and public.can_see_record_access(p_subject_id)
  order by l.created_at desc
  limit least(greatest(coalesce(p_limit, 200), 1), 1000);
$$;

revoke execute on function public.record_access_history(uuid, integer) from public, anon;
grant execute on function public.record_access_history(uuid, integer) to authenticated;

-- For the under 18s report: views of each child's records in the last 12
-- months, and by how many people. Admins only.
create or replace function public.admin_record_access_summary()
returns table (subject_id uuid, views bigint, viewers bigint, last_viewed_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select l.subject_id, count(*), count(distinct l.viewer_id), max(l.created_at)
  from public.record_access_log l
  where public.is_admin() and l.created_at > now() - interval '12 months'
  group by l.subject_id;
$$;

revoke execute on function public.admin_record_access_summary() from public, anon;
grant execute on function public.admin_record_access_summary() to authenticated;

commit;
