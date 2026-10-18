-- Sending back a child's clearance needs a parent's health consent, like
-- endorsing and accepting it (20261013010000_consents.sql): without it coaches,
-- physios and the committee don't see the child's injuries at all, so they
-- can't send a clearance back either. Found by the regression tests
-- (supabase/tests/messages-and-injuries.sql).
--
-- This migration changes no rows. It only replaces send_back_clearance, the
-- same as 20261012001000_team_physios.sql plus the consent check.

begin;

create or replace function public.send_back_clearance(p_injury_id uuid, p_notes text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_injury public.injuries;
begin
  select * into v_injury from public.injuries where id = p_injury_id for update;
  if v_injury.id is null then
    raise exception 'Injury not found';
  end if;
  if not (
    (v_injury.status = 'clearance_requested'
      and (public.coaches_athlete(v_injury.athlete_id) or public.is_committee()
        or public.physio_looks_after(v_injury.athlete_id)))
    or (v_injury.status = 'coach_endorsed' and public.is_committee())
  ) then
    raise exception 'You can’t send this back';
  end if;
  if v_injury.athlete_id = auth.uid() then
    raise exception 'You can’t send back your own clearance';
  end if;
  if not public.has_child_consent(v_injury.athlete_id, 'health') then
    raise exception 'A parent or guardian needs to give consent before you can see this injury';
  end if;
  if coalesce(trim(p_notes), '') = '' then
    raise exception 'Say why it’s being sent back';
  end if;

  update public.injuries
  set status = 'injured', coach_endorsed_by = null, coach_endorsed_at = null
  where id = p_injury_id;

  insert into public.injury_updates (injury_id, author_id, author_name, kind, notes)
  values (p_injury_id, auth.uid(), public.my_display_name(), 'sent_back', trim(p_notes));
end;
$$;

revoke execute on function public.send_back_clearance(uuid, text) from public, anon;
grant execute on function public.send_back_clearance(uuid, text) to authenticated;

commit;
