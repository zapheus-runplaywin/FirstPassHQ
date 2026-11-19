-- A child who doesn't use the app (20261120000000_no_sign_in_athletes) has no
-- app to lock and no link code. When their last verified parent or guardian
-- goes, the notice to admins said they "see only a link code to share", which
-- is wrong for them. It now says nobody can act for them until an admin links
-- another parent or guardian from their page. Only the notice's wording for
-- those children changes (guardianship_changed from 20261101000000). No rows
-- are changed.
begin;

create or replace function public.guardianship_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_guardian_id uuid := case when tg_op = 'INSERT' then new.guardian_id else old.guardian_id end;
  v_athlete_id uuid := case when tg_op = 'INSERT' then new.athlete_id else old.athlete_id end;
  v_change text := case when tg_op = 'INSERT' then 'linked' else 'unlinked' end;
  v_guardian text := coalesce(public.member_display_name(v_guardian_id), 'A former member');
  v_athlete public.profiles;
  v_athlete_name text := coalesce(public.member_display_name(v_athlete_id), 'A former member');
  v_by text := public.member_display_name(auth.uid());
  v_reason text := nullif(current_setting('app.guardian_reason', true), '');
  v_recipients uuid[];
  v_message_id uuid;
begin
  insert into public.guardianship_history (
    guardian_id, guardian_name, athlete_id, athlete_name, change, reason, changed_by, changed_by_name
  )
  values (
    v_guardian_id, v_guardian, v_athlete_id, v_athlete_name, v_change, v_reason, auth.uid(), v_by
  );

  -- Linked: their request to be linked is done.
  if tg_op = 'INSERT' then
    delete from public.guardian_link_requests
    where guardian_id = new.guardian_id and athlete_id = new.athlete_id;
  end if;

  -- No notice when the child is leaving or has left the club, or isn't
  -- approved.
  select * into v_athlete from public.profiles where id = v_athlete_id;
  if v_athlete.id is null or v_athlete.status <> 'approved'
     or v_athlete_id::text = current_setting('app.deleting_profile', true) then
    return null;
  end if;

  -- The child's last verified parent or guardian went (unlinked, no longer
  -- approved, or deleted their account), so the child is locked again: every
  -- admin is told.
  if tg_op = 'DELETE'
     and exists (select 1 from public.profiles where id = v_guardian_id and verified_at is not null)
     and public.is_locked_child(v_athlete_id) then
    insert into public.messages (sender_id, sender_name, body, audience, audience_label)
    values (
      null,
      'Club safeguarding',
      case when v_athlete.no_sign_in then
        -- A child who doesn't use the app has no app to lock and no link
        -- code: only an admin can link another parent or guardian.
        v_athlete_name || ' is under 18, doesn’t use the app, and no longer has a verified parent '
        || 'or guardian linked (' || v_guardian || ' was the last). Nobody can report their '
        || 'absences or injuries, give consent or answer surveys for them until one is. Link '
        || 'another parent or guardian from ' || v_athlete_name || '’s page in Members.'
      else
        v_athlete_name || ' is under 18 and no longer has a verified parent or guardian linked ('
        || v_guardian || ' was the last). Their app is locked until one is: they see only a link '
        || 'code to share with a parent or guardian. Approve the parent or guardian who enters it, '
        || 'or link one from ' || v_athlete_name || '’s page in Members.'
      end,
      'notice',
      'Admins'
    )
    returning id into v_message_id;
    insert into public.message_recipients (message_id, profile_id)
    select v_message_id, p.id from public.profiles p
    where p.status = 'approved' and 'admin' = any (public.roles_of(p.role, p.extra_roles))
    on conflict do nothing;
  end if;

  select coalesce(array_agg(g.guardian_id), '{}') into v_recipients
  from public.guardianships g
  join public.profiles p on p.id = g.guardian_id and p.status = 'approved'
  where g.athlete_id = v_athlete_id;
  if cardinality(v_recipients) = 0 then
    return null;
  end if;
  if v_athlete.date_of_birth is not null
     and v_athlete.date_of_birth <= current_date - interval '13 years' then
    v_recipients := v_recipients || v_athlete.id;
  end if;

  insert into public.messages (sender_id, sender_name, body, audience, audience_label)
  values (
    null,
    'Club safeguarding',
    case v_change
      when 'linked' then
        v_guardian || ' is now linked to ' || v_athlete_name || ' as a parent or guardian. '
        || 'Guardians can see ' || v_athlete_name
        || '''s injuries, check-ins, goals and messages from the club.'
      else
        v_guardian || ' is no longer linked to ' || v_athlete_name || ' as a parent or guardian.'
    end
    || case when v_by is not null
         then ' Changed by ' || v_by || ' on '
           || to_char(now() at time zone 'Australia/Perth', 'DD/MM/YYYY') || '.'
         else '' end
    || ' If this isn''t right, tell the club''s Child Safety Officer or an admin.',
    'notice',
    'Parents and guardians of ' || v_athlete_name
  )
  returning id into v_message_id;

  insert into public.message_recipients (message_id, profile_id)
  select v_message_id, r from unnest(v_recipients) as r
  on conflict do nothing;

  return null;
end;
$$;

revoke execute on function public.guardianship_changed() from public, anon;

commit;
