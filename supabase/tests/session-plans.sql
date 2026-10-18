-- Session plans (migration 20261016010000): coaches and admins add plans,
-- share them with the group's coaches, its athletes (and so guardians of
-- minors) and coaches of other groups by name. Only authors and admins edit;
-- only admins delete. Run after the migrations and seed-members.sql.
-- Raises on any failure.

-- A coach of another team, and a stood-down-free plain athlete outside it.
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000000051', 'coach.other@example.test', now());
update public.profiles set status = 'approved', full_name = 'Nico Other', role = 'coach',
  wwcc_number = 'WWC0051', wwcc_expires_on = current_date + 400, verified_at = now()
where id = '00000000-0000-0000-0000-000000000051';
insert into public.teams (id, name, kind, sort_order) values
  ('00000000-0000-0000-0000-0000000000a3', 'Other Squad', 'squad', 3);
insert into public.team_members (team_id, profile_id, team_role, coach_title) values
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000051', 'coach', 'head_coach');
grant select, insert, delete on storage.objects to authenticated;

create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated;

set role authenticated;

-- The head coach adds a plan for the squad, shared with its coaches and athletes
-- and by name with the other squad's coach.
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000011';
insert into ids values ('plan', public.save_session_plan(
  null, '00000000-0000-0000-0000-0000000000a1', 'Tuesday training', current_date - 1,
  '18:00', '19:30', 'Main court', 'Warm up, footwork, 3v2', null, true, true,
  array['00000000-0000-0000-0000-000000000051']::uuid[]));
do $$ begin
  if (select author_position from public.session_plans) <> 'Head coach' then raise exception 'position not recorded'; end if;
  if (select team_name from public.session_plans) <> 'Sample Squad' then raise exception 'team name not kept'; end if;
end $$;

-- Everyone it's shared with is told once: the assistant coach and coach-parent,
-- both athletes, the minor's parent and the named coach. Not the coach whose
-- check lapsed, and not the author.
reset role;
do $$ begin
  if (select count(*) from public.session_plan_notices) <> 5 then
    raise exception 'expected 5 people told, got %', (select count(*) from public.session_plan_notices);
  end if;
  if exists (select 1 from public.session_plan_notices where profile_id in
    ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000012')) then
    raise exception 'author or lapsed coach told';
  end if;
end $$;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000011';

-- Coaches can only add plans for groups they coach.
do $$ begin
  begin
    perform public.save_session_plan(null, '00000000-0000-0000-0000-0000000000a3', 'Sneaky', current_date,
      null, null, null, null, null, true, false, '{}');
    raise exception 'coach added a plan for a squad they don''t coach';
  exception when others then
    if sqlerrm not like 'You can only add plans%' then raise; end if;
  end;
end $$;
-- Names can only be shared with coaches.
do $$ begin
  begin
    perform public.save_session_plan(null, '00000000-0000-0000-0000-0000000000a1', 'X', current_date,
      null, null, null, null, null, true, false, array['00000000-0000-0000-0000-000000000032']::uuid[]);
    raise exception 'shared with a non-coach by name';
  exception when others then
    if sqlerrm not like 'Plans can only be shared by name with coaches' then raise; end if;
  end;
end $$;
-- End before start is refused.
do $$ begin
  begin
    perform public.save_session_plan(null, '00000000-0000-0000-0000-0000000000a1', 'X', current_date,
      '19:00', '18:00', null, null, null, true, false, '{}');
    raise exception 'end before start accepted';
  exception when others then
    if sqlerrm not like '%finish after it starts%' then raise; end if;
  end;
end $$;

-- A file goes into the plan's folder and is recorded.
reset role;
insert into storage.objects (bucket_id, name, metadata)
select 'session-plans', v || '/11111111-1111-1111-1111-111111111111/plan.pdf', '{"size": 1234}'
from ids where k = 'plan';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000011';
insert into ids select 'file', public.add_session_plan_file(v, v || '/11111111-1111-1111-1111-111111111111/plan.pdf', 'plan.pdf', 'application/pdf') from ids where k = 'plan';
do $$ begin
  if (select size_bytes from public.session_plan_files) <> 1234 then raise exception 'file size not recorded'; end if;
end $$;
-- A file that wasn't uploaded is refused.
do $$ begin
  begin
    perform public.add_session_plan_file(v, v || '/22222222-2222-2222-2222-222222222222/x.pdf', 'x.pdf', 'application/pdf') from ids where k = 'plan';
    raise exception 'unuploaded file recorded';
  exception when others then
    if sqlerrm not like '%wasn''t uploaded%' then raise; end if;
  end;
end $$;

-- Who sees it.
do $$
declare who text; seen int;
begin
  -- Author, admin, other squad coach (assistant), named coach, both athletes,
  -- guardian of the minor and coach-parent see it.
  foreach who in array array[
    '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000042', '00000000-0000-0000-0000-000000000051',
    '00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000032',
    '00000000-0000-0000-0000-000000000041'] loop
    perform set_config('request.jwt.claim.sub', who, true);
    select count(*) into seen from public.session_plans;
    if seen <> 1 then raise exception '% should see the plan', who; end if;
    select count(*) into seen from public.session_plan_files;
    if seen <> 1 then raise exception '% should see the file', who; end if;
    select count(*) into seen from storage.objects where bucket_id = 'session-plans';
    if seen <> 1 then raise exception '% should see the stored file', who; end if;
  end loop;
  -- Manager, physio, committee, the lapsed-WWCC assistant coach see nothing.
  foreach who in array array[
    '00000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000014',
    '00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000012'] loop
    perform set_config('request.jwt.claim.sub', who, true);
    select count(*) into seen from public.session_plans;
    if seen <> 0 then raise exception '% should not see the plan', who; end if;
    select count(*) into seen from storage.objects where bucket_id = 'session-plans';
    if seen <> 0 then raise exception '% should not see the stored file', who; end if;
  end loop;
end $$;

-- Shared lists: new until opened; not "shared" with the author or the admin.
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000031';
do $$ begin
  if (select count(*) from public.shared_session_plans() where is_new) <> 1 then raise exception 'athlete should have 1 new plan'; end if;
  perform public.mark_session_plan_seen(v) from ids where k = 'plan';
  if (select new_shared from public.session_plan_summary()) <> 0 then raise exception 'plan still new after opening'; end if;
  if (select can_add from public.session_plan_summary()) then raise exception 'athlete can add plans'; end if;
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000011';
do $$ begin
  if (select count(*) from public.shared_session_plans()) <> 0 then raise exception 'author sees own plan as shared'; end if;
  if not (select can_add from public.session_plan_summary()) then raise exception 'coach can''t add plans'; end if;
  if (select count(*) from public.session_plan_shares) <> 1 then raise exception 'author should see the named share'; end if;
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
do $$ begin
  if (select count(*) from public.shared_session_plans()) <> 0 then raise exception 'admin sees plan as shared'; end if;
  if (select count(*) from public.session_plan_report(current_date - 30, current_date)) <> 1 then raise exception 'report missing plan'; end if;
end $$;
-- Only admins get the report.
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000011';
do $$ begin
  if (select count(*) from public.session_plan_report(current_date - 30, current_date)) <> 0 then raise exception 'coach got the report'; end if;
end $$;
-- Athletes don't see who it was shared with by name.
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000031';
do $$ begin
  if (select count(*) from public.session_plan_shares) <> 0 then raise exception 'athlete sees named shares'; end if;
end $$;

-- Turning off athlete sharing hides it from athletes and guardians.
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000011';
select public.save_session_plan(v, '00000000-0000-0000-0000-0000000000a1', 'Tuesday training (edited)', current_date - 1,
  '18:00', '19:30', 'Main court', 'Updated', null, true, false, '{}') from ids where k = 'plan';
do $$
declare who text;
begin
  if (select edited_at from public.session_plans) is null then raise exception 'edit not stamped'; end if;
  foreach who in array array['00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000051'] loop
    perform set_config('request.jwt.claim.sub', who, true);
    if (select count(*) from public.session_plans) <> 0 then raise exception '% still sees the plan', who; end if;
  end loop;
end $$;

-- Editing tells nobody again.
reset role;
do $$ begin
  if (select count(*) from public.session_plan_notices) <> 5 then raise exception 'edit told people again'; end if;
end $$;
set role authenticated;

-- Nobody but the author or an admin changes it; the table can't be written directly.
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000042';
do $$ begin
  begin
    perform public.save_session_plan(v, '00000000-0000-0000-0000-0000000000a1', 'Hijack', current_date,
      null, null, null, null, null, true, true, '{}') from ids where k = 'plan';
    raise exception 'other coach edited the plan';
  exception when others then
    if sqlerrm not like 'Only the coach who added%' then raise; end if;
  end;
  begin
    update public.session_plans set title = 'Hijack';
    raise exception 'direct update allowed';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Only admins delete, and only once files are gone.
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000011';
do $$ begin
  begin
    perform public.admin_delete_session_plan(v) from ids where k = 'plan';
    raise exception 'coach deleted a plan';
  exception when others then
    if sqlerrm not like 'Only admins%' then raise; end if;
  end;
end $$;
-- Admins add plans for any group, recorded as Admin with Run by.
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
insert into ids values ('admin_plan', public.save_session_plan(
  null, '00000000-0000-0000-0000-0000000000a3', 'Conditioning', current_date, null, null, null,
  'S&C circuit', 'S&C partner', false, true, '{}'));
do $$ begin
  if (select author_position from public.session_plans p join ids on ids.v = p.id and ids.k = 'admin_plan') <> 'Admin' then
    raise exception 'admin position not recorded'; end if;
  begin
    perform public.admin_delete_session_plan(v) from ids where k = 'plan';
    raise exception 'deleted with files left';
  exception when others then
    if sqlerrm not like '%files are still there%' then raise; end if;
  end;
end $$;
-- The author removes the file (storage first), then the record.
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000011';
delete from storage.objects where bucket_id = 'session-plans';
select public.remove_session_plan_file(v) from ids where k = 'file';
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select public.admin_delete_session_plan(v) from ids where k = 'plan';
do $$ begin
  if (select count(*) from public.session_plans) <> 1 then raise exception 'plan not deleted'; end if;
end $$;

-- Switched off: nobody sees plans.
reset role;
update public.club_settings set features = features || '{"sessionPlans": false}' where id;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
do $$ begin
  if (select count(*) from public.session_plans) <> 0 then raise exception 'plans visible while switched off'; end if;
end $$;
reset role;
update public.club_settings set features = features - 'sessionPlans' where id;

-- Retention: an old plan goes only with removal on, after its files.
update public.session_plans set session_on = current_date - interval '8 years';
update public.club_settings set retention_enabled = false where id;
do $$ begin
  if (select count(*) from public.expired_session_plan_files()) <> 0 then raise exception 'files listed with removal off'; end if;
  perform public.purge_expired_records();
  if (select count(*) from public.session_plans) <> 1 then raise exception 'purged with removal off'; end if;
end $$;
update public.club_settings set retention_enabled = true where id;
do $$ begin
  if (public.purge_expired_records() ->> 'session_plans')::int <> 1 then raise exception 'old plan not purged'; end if;
end $$;

select 'session plans: all passed';
