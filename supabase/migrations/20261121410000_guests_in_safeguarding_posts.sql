-- Guests can hold a safeguarding post (Matt, 21 November 2026). "Guest" is a
-- level of app access, not a statement about club membership, which sits
-- outside the app; so an outside Child Safety Officer or Complaints Manager
-- can be a guest.
--
-- They still need everything any other holder needs: approved, 18 or over,
-- not stood down, and a current Working With Children Check (or an
-- application in force). Most guests have no check and stay ineligible. If a
-- guest's check lapses they stay named but can't act, as for anyone else.
-- Temporary helpers still can't hold a post. The WWC Registration Officer
-- must still also be an admin or committee member, which a guest can't be.
--
-- A guest can also send in their own card from the app if they have one
-- (Matt: "It wouldn't hurt to allow them to add it if they have it. We
-- wouldn't require it though"). It is never asked for: a guest gets no
-- to-do for a missing check, and an admin accepts a card they send as for
-- anyone else (admin_accept_wwcc_submission), which is what makes it count.
--
-- Replaces can_be_safeguarding_contact (20261018230000_role_guide_audits.sql,
-- which left out guests) and submit_my_wwcc (20261119135000_wwcc_self_submit
-- .sql, which refused guests). Additive: two replaced functions. No rows are
-- changed.

begin;

create or replace function public.can_be_safeguarding_contact(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_profile_id and p.status = 'approved' and p.stood_down_at is null
      and p.role <> 'volunteer'
      and not public.is_minor(p.date_of_birth, p.under_17)
  ) and public.is_cleared(p_profile_id);
$$;

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
  if not public.needs_wwcc(public.roles_of(v_me.role, v_me.extra_roles), v_me.wwcc_exempt_reason)
     and v_me.role <> 'guest' then
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

commit;
