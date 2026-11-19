-- Members send in their own Working With Children Check (Matt, 19 November
-- 2026).
--
-- A coach, manager, physio, committee member or anyone else whose role is
-- paused for want of a check used to be told to "send a club admin the card
-- number and expiry date", outside the app. Now they enter the card in the
-- app themselves:
--
-- 1. The member sends the card number, expiry date and name on the card
--    (submit_my_wwcc). It is kept apart from their record, so it counts for
--    nothing yet: their role stays paused.
-- 2. An admin checks the card with the Screening Unit (online, card sighted
--    or a letter) and accepts it (admin_accept_wwcc_submission). That records
--    the card and its validation in one step, so the role starts again only
--    once the card has been validated. Nobody accepts their own card.
-- 3. Or the admin sends it back with a note the member reads
--    (admin_return_wwcc_submission), and the member can send it again.
--
-- A card an admin records by hand on the member's page closes a waiting
-- submission too, so nobody is asked to check it twice.
--
-- Additive: one new table reached only through functions, new functions and
-- one new trigger. No existing rows are changed or removed.

begin;

create table if not exists public.wwcc_submissions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  card_number text not null check (length(card_number) between 1 and 30),
  expires_on date not null,
  card_name text not null check (length(card_name) between 1 and 120),
  submitted_at timestamptz not null default now(),
  -- waiting for an admin; accepted (recorded and validated); returned with a
  -- note; replaced by a newer one; recorded (an admin recorded a card by hand).
  status text not null default 'waiting'
    check (status in ('waiting', 'accepted', 'returned', 'replaced', 'recorded')),
  decided_at timestamptz,
  decided_by uuid references public.profiles (id) on delete set null,
  decided_by_name text,
  return_note text check (length(return_note) <= 500)
);

create index if not exists wwcc_submissions_profile_idx
  on public.wwcc_submissions (profile_id, submitted_at desc);
create unique index if not exists wwcc_submissions_one_waiting
  on public.wwcc_submissions (profile_id) where status = 'waiting';

-- Reached only through the functions below.
alter table public.wwcc_submissions enable row level security;
revoke all on public.wwcc_submissions from public, anon, authenticated;
grant all on public.wwcc_submissions to service_role;

-- ---------------------------------------------------------------------------
-- The member
-- ---------------------------------------------------------------------------

-- Sends the member's own card for an admin to check, replacing any card they
-- sent before that is still waiting.
create or replace function public.submit_my_wwcc(
  p_card_number text,
  p_expires_on date,
  p_card_name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles;
  v_number text := nullif(upper(trim(p_card_number)), '');
  v_name text := nullif(trim(p_card_name), '');
  v_id uuid;
begin
  select * into v_me from public.profiles where id = auth.uid();
  if not found or v_me.status <> 'approved' then
    raise exception 'Only approved members can send in a Working With Children Check';
  end if;
  if not public.needs_wwcc(public.roles_of(v_me.role, v_me.extra_roles), v_me.wwcc_exempt_reason) then
    raise exception 'Your roles don''t need a Working With Children Check';
  end if;
  if v_me.stood_down_at is not null then
    raise exception 'A club admin has paused your roles. Talk to a club admin about it.';
  end if;
  if v_number is null then
    raise exception 'Enter the card number';
  end if;
  if length(v_number) > 30 then
    raise exception 'That card number is too long';
  end if;
  if p_expires_on is null then
    raise exception 'Enter the expiry date on the card';
  end if;
  if p_expires_on < current_date then
    raise exception 'That card has expired. Renew it, then send the new card';
  end if;
  -- Cards last three years, so a later expiry is a typing mistake.
  if p_expires_on > (current_date + interval '3 years')::date then
    raise exception 'A Working With Children Check lasts three years. Check the expiry date on the card';
  end if;
  if v_name is null then
    raise exception 'Enter your name as it appears on the card';
  end if;
  if length(v_name) > 120 then
    raise exception 'Keep the name on the card to 120 characters';
  end if;
  if v_me.wwcc_number = v_number and v_me.wwcc_expires_on = p_expires_on
     and v_me.wwcc_validated_at is not null then
    raise exception 'The club already has that card recorded';
  end if;

  update public.wwcc_submissions
  set status = 'replaced', decided_at = now()
  where profile_id = v_me.id and status = 'waiting';

  insert into public.wwcc_submissions (profile_id, card_number, expires_on, card_name)
  values (v_me.id, v_number, p_expires_on, v_name)
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.submit_my_wwcc(text, date, text) from public, anon;
grant execute on function public.submit_my_wwcc(text, date, text) to authenticated;

-- The member's latest card sent in, while it is waiting or was sent back.
-- Nothing once it's accepted or the club recorded a card.
create or replace function public.my_wwcc_submission()
returns table (
  id uuid,
  card_number text,
  expires_on date,
  card_name text,
  submitted_at timestamptz,
  status text,
  decided_at timestamptz,
  return_note text
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.card_number, s.expires_on, s.card_name, s.submitted_at, s.status,
    s.decided_at, s.return_note
  from (
    select * from public.wwcc_submissions
    where profile_id = auth.uid() and status <> 'replaced'
    order by submitted_at desc
    limit 1
  ) s
  where s.status in ('waiting', 'returned');
$$;

revoke execute on function public.my_wwcc_submission() from public, anon;
grant execute on function public.my_wwcc_submission() to authenticated;

-- ---------------------------------------------------------------------------
-- Admins
-- ---------------------------------------------------------------------------

-- Cards members have sent in that are waiting for an admin, oldest first.
create or replace function public.admin_wwcc_submissions()
returns table (
  id uuid,
  profile_id uuid,
  member_name text,
  card_number text,
  expires_on date,
  card_name text,
  submitted_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.profile_id,
    coalesce(public.member_display_name(p.id), nullif(p.full_name, ''), p.email, 'Unnamed member'),
    s.card_number, s.expires_on, s.card_name, s.submitted_at
  from public.wwcc_submissions s
  join public.profiles p on p.id = s.profile_id
  where s.status = 'waiting' and public.is_admin()
  order by s.submitted_at;
$$;

revoke execute on function public.admin_wwcc_submissions() from public, anon;
grant execute on function public.admin_wwcc_submissions() to authenticated;

-- An admin who has checked the card accepts it: the card and its validation
-- are recorded together, so the member's role starts again only now. Same
-- rules as admin_validate_wwcc.
create or replace function public.admin_accept_wwcc_submission(
  p_submission_id uuid,
  p_card_name text,
  p_method text,
  p_unit_linked boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_submission public.wwcc_submissions;
  v_card_name text := nullif(trim(p_card_name), '');
begin
  if not public.is_admin() then
    raise exception 'Only admins can accept a Working With Children Check';
  end if;
  select * into v_submission from public.wwcc_submissions where id = p_submission_id;
  if not found then
    raise exception 'That card isn''t waiting to be checked';
  end if;
  if v_submission.profile_id = auth.uid() then
    raise exception 'Ask another admin to check your card';
  end if;
  if v_submission.status <> 'waiting' then
    raise exception 'That card isn''t waiting to be checked';
  end if;
  if v_submission.expires_on < current_date then
    raise exception 'That card has expired. Send it back and ask for the new one';
  end if;
  if v_card_name is null then
    raise exception 'Enter the name as it appears on the card';
  end if;
  if length(v_card_name) > 120 then
    raise exception 'Keep the name on the card to 120 characters';
  end if;
  if p_method is null or p_method not in ('online', 'card_sighted', 'unit_letter') then
    raise exception 'Choose how you checked the card';
  end if;

  update public.profiles
  set wwcc_number = v_submission.card_number,
      wwcc_expires_on = v_submission.expires_on,
      wwcc_card_name = v_card_name,
      wwcc_validated_at = now(),
      wwcc_validated_by = auth.uid(),
      wwcc_validation_method = p_method,
      wwcc_unit_linked_at = case
        when coalesce(p_unit_linked, false) then
          case when wwcc_number is not distinct from v_submission.card_number
            then coalesce(wwcc_unit_linked_at, now()) else now() end
      end
  where id = v_submission.profile_id;

  -- The trigger below marks it recorded; this one was accepted.
  update public.wwcc_submissions
  set status = 'accepted', decided_at = now(), decided_by = auth.uid(),
      decided_by_name = public.my_display_name()
  where id = p_submission_id;
end;
$$;

revoke execute on function public.admin_accept_wwcc_submission(uuid, text, text, boolean) from public, anon;
grant execute on function public.admin_accept_wwcc_submission(uuid, text, text, boolean) to authenticated;

-- Sends a card back with a note the member reads, such as a number that
-- doesn't match the Screening Unit's records.
create or replace function public.admin_return_wwcc_submission(p_submission_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note text := nullif(trim(p_note), '');
  v_submission public.wwcc_submissions;
begin
  if not public.is_admin() then
    raise exception 'Only admins can send a Working With Children Check back';
  end if;
  select * into v_submission from public.wwcc_submissions where id = p_submission_id;
  if not found or v_submission.status <> 'waiting' then
    raise exception 'That card isn''t waiting to be checked';
  end if;
  if v_submission.profile_id = auth.uid() then
    raise exception 'Ask another admin to check your card';
  end if;
  if v_note is null then
    raise exception 'Say what they need to fix';
  end if;
  if length(v_note) > 500 then
    raise exception 'Keep the note under 500 characters';
  end if;
  update public.wwcc_submissions
  set status = 'returned', decided_at = now(), decided_by = auth.uid(),
      decided_by_name = public.my_display_name(), return_note = v_note
  where id = p_submission_id;
end;
$$;

revoke execute on function public.admin_return_wwcc_submission(uuid, text) from public, anon;
grant execute on function public.admin_return_wwcc_submission(uuid, text) to authenticated;

-- A current card recorded on the member's page closes a waiting submission,
-- so nobody is asked to check it again.
create or replace function public.close_wwcc_submission_on_card()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(trim(new.wwcc_number), '') <> '' and new.wwcc_expires_on >= current_date
     and (new.wwcc_number is distinct from old.wwcc_number
       or new.wwcc_expires_on is distinct from old.wwcc_expires_on) then
    update public.wwcc_submissions
    set status = 'recorded', decided_at = now(), decided_by = auth.uid(),
        decided_by_name = public.my_display_name()
    where profile_id = new.id and status = 'waiting';
  end if;
  return new;
end;
$$;

revoke execute on function public.close_wwcc_submission_on_card() from public, anon, authenticated;

drop trigger if exists close_wwcc_submission_on_card on public.profiles;
create trigger close_wwcc_submission_on_card
  after update of wwcc_number, wwcc_expires_on on public.profiles
  for each row execute function public.close_wwcc_submission_on_card();

commit;
