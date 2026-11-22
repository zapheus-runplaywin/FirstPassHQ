-- Season KPIs (migration 20261016000000): who sets, sees and updates them.
-- Run after the migrations and seed-members.sql. Raises on any failure.
\set ON_ERROR_STOP 1
set role authenticated;

create temp table ids (name text primary key, id uuid);
grant all on ids to authenticated;

-- An admin sets two review dates; nobody else can.
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
insert into ids select 'mid', public.admin_save_kpi_review_point(null, extract(year from now())::int, 'Mid-season review', public.club_today() + 3);
insert into ids select 'end', public.admin_save_kpi_review_point(null, extract(year from now())::int, 'End-of-season review', public.club_today() + 60);
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000022';
do $$ begin
  begin
    perform public.admin_save_kpi_review_point(null, 2026, 'Sneaky', public.club_today());
    raise exception 'committee set a review date';
  exception when raise_exception then
    if sqlerrm = 'committee set a review date' then raise; end if;
  end;
end $$;

-- Committee (no check needed yet) sets a KPI for the head coach and the manager.
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000022';
insert into ids select 'coach_kpi', public.save_season_kpi(null, '00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-0000000000a1', 'kpi', 'Squad attendance', 'Average across the season',
  '[{"kind":"number","target":85,"unit":"%","baseline":70}]');
insert into ids select 'manager_okr', public.save_season_kpi(null, '00000000-0000-0000-0000-000000000013',
  '00000000-0000-0000-0000-0000000000a1', 'okr', 'Run smooth game days', null,
  '[{"title":"Rosters in by Thursday","kind":"yes_no"},{"title":"Late cancellations","kind":"number","target":2,"lower_is_better":true}]');
do $$ begin
  begin
    perform public.save_season_kpi(null, '00000000-0000-0000-0000-000000000031',
      '00000000-0000-0000-0000-0000000000a1', 'kpi', 'x', null, '[{"kind":"yes_no"}]');
    raise exception 'committee set an athlete KPI';
  exception when raise_exception then
    if sqlerrm = 'committee set an athlete KPI' then raise; end if;
  end;
  if public.season_kpi_sheet('00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-0000000000a1') is not null then
    raise exception 'committee can read an athlete''s KPIs';
  end if;
end $$;

-- The committee can't read athletes' KPIs, even once set.
-- Committee member whose check expired is paused.
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000021';
do $$ begin
  if public.season_kpi_sheet('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-0000000000a1') is not null then
    raise exception 'paused committee reads coach KPIs';
  end if;
end $$;

-- Head coach sets for an assistant and an athlete, sees no one else's coach KPIs.
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000011';
insert into ids select 'assistant_kpi', public.save_season_kpi(null, '00000000-0000-0000-0000-000000000042',
  '00000000-0000-0000-0000-0000000000a1', 'kpi', 'Run the shooting station', null, '[{"kind":"yes_no"}]');
insert into ids select 'athlete_okr', public.save_season_kpi(null, '00000000-0000-0000-0000-000000000031',
  '00000000-0000-0000-0000-0000000000a1', 'okr', 'Become a reliable goal shooter', null,
  '[{"title":"Shooting percentage","kind":"number","target":75,"unit":"%"},{"title":"Extra sessions","kind":"number","target":12}]');
do $$
declare s jsonb;
begin
  s := public.season_kpi_sheet('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-0000000000a1');
  if s ->> 'relation' <> 'self' or (s ->> 'can_edit')::boolean or not (s ->> 'can_update')::boolean then
    raise exception 'coach own sheet wrong: %', s;
  end if;
  if public.season_kpi_sheet('00000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-0000000000a1') is not null then
    raise exception 'coach reads the manager''s KPIs';
  end if;
  s := public.season_kpi_sheet('00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-0000000000a1');
  if s ->> 'relation' <> 'setter' or jsonb_array_length(s -> 'kpis' -> 0 -> 'measures') <> 2 then
    raise exception 'coach sheet for athlete wrong: %', s;
  end if;
  -- Coach can't set the result of their own KPI.
  begin
    perform public.set_kpi_result((select id from ids where name = 'coach_kpi'), 'met', null);
    raise exception 'coach set own result';
  exception when raise_exception then
    if sqlerrm = 'coach set own result' then raise; end if;
  end;
  -- Limits.
  begin
    perform public.save_season_kpi(null, '00000000-0000-0000-0000-000000000032', '00000000-0000-0000-0000-0000000000a1',
      'okr', 'x', null, '[{"title":"a","kind":"yes_no"},{"title":"b","kind":"yes_no"},{"title":"c","kind":"yes_no"},{"title":"d","kind":"yes_no"},{"title":"e","kind":"yes_no"},{"title":"f","kind":"yes_no"}]');
    raise exception 'six key results allowed';
  exception when raise_exception then
    if sqlerrm = 'six key results allowed' then raise; end if;
  end;
  begin
    perform public.save_season_kpi(null, '00000000-0000-0000-0000-000000000032', '00000000-0000-0000-0000-0000000000a1',
      'kpi', 'x', null, '[{"kind":"number"}]');
    raise exception 'number without target allowed';
  exception when raise_exception then
    if sqlerrm = 'number without target allowed' then raise; end if;
  end;
end $$;
-- The view of a child's KPIs is logged.
reset role;
do $$ begin
  if not exists (select 1 from public.record_access_log where kind = 'kpis'
    and subject_id = '00000000-0000-0000-0000-000000000031' and viewer_id = '00000000-0000-0000-0000-000000000011') then
    raise exception 'coach view not logged';
  end if;
end $$;
set role authenticated;

-- Assistant coach can't set for another assistant, can for an athlete.
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000042';
do $$ begin
  if public.season_kpi_sheet('00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-0000000000a1') is not null then
    raise exception 'assistant reads another assistant''s KPIs';
  end if;
  perform public.save_season_kpi(null, '00000000-0000-0000-0000-000000000032',
    '00000000-0000-0000-0000-0000000000a1', 'kpi', 'Play 10 games', null, '[{"kind":"number","target":10,"unit":"games"}]');
end $$;

-- Coach with an expired check can't.
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000012';
do $$ begin
  if public.season_kpi_sheet('00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-0000000000a1') is not null then
    raise exception 'lapsed coach reads an athlete''s KPIs';
  end if;
end $$;

-- The athlete updates progress and writes their own view, but can't record a result or edit.
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000031';
do $$
declare s jsonb; m uuid;
begin
  s := public.season_kpi_sheet('00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-0000000000a1');
  if s ->> 'relation' <> 'self' then raise exception 'athlete own sheet: %', s; end if;
  m := (s -> 'kpis' -> 0 -> 'measures' -> 0 ->> 'id')::uuid;
  perform public.record_kpi_progress(m, 68, null);
  perform public.save_kpi_self_review('00000000-0000-0000-0000-0000000000a1', (select id from ids where name = 'mid'), 'Getting there');
  begin
    perform public.confirm_kpi_review('00000000-0000-0000-0000-0000000000a1', (select id from ids where name = 'mid'));
    raise exception 'confirmed an unwritten review';
  exception when raise_exception then
    if sqlerrm = 'confirmed an unwritten review' then raise; end if;
  end;
  begin
    perform public.set_kpi_result((select id from ids where name = 'athlete_okr'), 'met', null);
    raise exception 'athlete set result';
  exception when raise_exception then
    if sqlerrm = 'athlete set result' then raise; end if;
  end;
  begin
    perform public.delete_season_kpi((select id from ids where name = 'athlete_okr'));
    raise exception 'athlete deleted';
  exception when raise_exception then
    if sqlerrm = 'athlete deleted' then raise; end if;
  end;
  if public.season_kpi_sheet('00000000-0000-0000-0000-000000000032', '00000000-0000-0000-0000-0000000000a1') is not null then
    raise exception 'teammate can read another athlete''s KPIs';
  end if;
  if public.season_kpi_sheet('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-0000000000a1') is not null then
    raise exception 'athlete reads the coach''s KPIs';
  end if;
  if exists (select 1 from public.season_kpi_people() where profile_id <> '00000000-0000-0000-0000-000000000031') then
    raise exception 'athlete people list shows others';
  end if;
  begin
    perform count(*) from public.season_kpis;
    raise exception 'table readable';
  exception when insufficient_privilege then null;
  end;
end $$;

-- The guardian reads, and can't change anything.
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000041';
do $$
declare s jsonb;
begin
  s := public.season_kpi_sheet('00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-0000000000a1');
  if s ->> 'relation' <> 'guardian' or (s ->> 'can_update')::boolean then raise exception 'guardian sheet: %', s; end if;
  if (s -> 'kpis' -> 0 -> 'measures' -> 0 ->> 'current_value')::numeric <> 68 then raise exception 'progress missing'; end if;
  if s -> 'reviews' -> 0 ->> 'self_review' <> 'Getting there' or jsonb_array_length(s -> 'reviews') <> 2 then
    raise exception 'self review missing: %', s -> 'reviews';
  end if;
  begin
    perform public.record_kpi_progress((s -> 'kpis' -> 0 -> 'measures' -> 0 ->> 'id')::uuid, 99, null);
    raise exception 'guardian updated progress';
  exception when raise_exception then
    if sqlerrm = 'guardian updated progress' then raise; end if;
  end;
  if (select count(*) from public.season_kpi_people()) <> 2 then raise exception 'guardian should see child in squad and team'; end if;
end $$;
reset role;
do $$ begin
  if exists (select 1 from public.record_access_log where kind = 'kpis' and viewer_id = '00000000-0000-0000-0000-000000000041') then
    raise exception 'guardian view logged';
  end if;
end $$;
set role authenticated;

-- The coach has to-dos for the reviews due within a week of people whose KPIs they set.
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000011';
do $$ begin
  if (select count(*) from public.kpi_review_todos() where kind = 'write') <> 2 then
    raise exception 'coach review to-dos: %', (select jsonb_agg(t) from public.kpi_review_todos() t);
  end if;
end $$;
select public.save_kpi_review('00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-0000000000a1', (select id from ids where name = 'mid'), 'Good progress');
do $$ begin
  if (select count(*) from public.kpi_review_todos() where kind = 'write') <> 1 then raise exception 'written review still a to-do'; end if;
end $$;
-- The athlete now confirms it.
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000031';
do $$ begin
  if (select count(*) from public.kpi_review_todos() where kind = 'confirm') <> 1 then raise exception 'athlete has no confirm to-do'; end if;
  perform public.confirm_kpi_review('00000000-0000-0000-0000-0000000000a1', (select id from ids where name = 'mid'));
  if exists (select 1 from public.kpi_review_todos()) then raise exception 'confirm to-do stayed'; end if;
end $$;
-- An admin can't remove a date with reviews, and reads the athlete's KPIs.
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
do $$
declare s jsonb;
begin
  begin
    perform public.admin_delete_kpi_review_point((select id from ids where name = 'mid'));
    raise exception 'removed a date with reviews';
  exception when raise_exception then
    if sqlerrm = 'removed a date with reviews' then raise; end if;
  end;
  s := public.season_kpi_sheet('00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-0000000000a1');
  if s ->> 'relation' <> 'viewer' or (s ->> 'can_edit')::boolean or (s ->> 'can_update')::boolean then
    raise exception 'admin sheet for athlete: %', s;
  end if;
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000011';
select public.set_kpi_result((select id from ids where name = 'athlete_okr'), 'partly_met', 'Close on shooting');
select public.remove_kpi_self_review('00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-0000000000a1', (select id from ids where name = 'mid'));
do $$
declare s jsonb;
begin
  s := public.season_kpi_sheet('00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-0000000000a1');
  if s -> 'reviews' -> 0 ->> 'note' <> 'Good progress' or s -> 'reviews' -> 0 ->> 'self_review' is not null
     or s -> 'reviews' -> 0 ->> 'confirmed_at' is null then
    raise exception 'review wrong: %', s -> 'reviews';
  end if;
  if s -> 'kpis' -> 0 ->> 'result' <> 'partly_met' then raise exception 'result wrong'; end if;
  if (select count(*) from public.season_kpi_people() where relation = 'setter') <> 5 then
    raise exception 'coach people list: %', (select jsonb_agg(p) from public.season_kpi_people() p);
  end if;
  -- Editing keeps progress on kept measures.
  perform public.save_season_kpi((select id from ids where name = 'athlete_okr'), null, null, 'okr',
    'Become a reliable goal shooter', null,
    jsonb_build_array(jsonb_build_object('id', s -> 'kpis' -> 0 -> 'measures' -> 0 ->> 'id', 'title', 'Shooting %', 'kind', 'number', 'target', 80)));
  s := public.season_kpi_sheet('00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-0000000000a1');
  if jsonb_array_length(s -> 'kpis' -> 0 -> 'measures') <> 1
     or (s -> 'kpis' -> 0 -> 'measures' -> 0 ->> 'current_value')::numeric <> 68 then
    raise exception 'edit lost progress: %', s;
  end if;
end $$;

-- Admins get the coach and manager report; nobody else does.
do $$ begin
  if exists (select 1 from public.season_kpi_report(extract(year from now())::int)) then raise exception 'coach sees report'; end if;
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
do $$ begin
  if (select count(*) from public.season_kpi_report(extract(year from now())::int) where kpi_id is not null) <> 3 then
    raise exception 'report rows: %', (select jsonb_agg(r) from public.season_kpi_report(extract(year from now())::int) r);
  end if;
  if exists (select 1 from public.season_kpi_report(extract(year from now())::int) where team_role = 'athlete') then
    raise exception 'report shows athletes';
  end if;
end $$;

-- Archived: still readable, no longer changeable.
reset role;
update public.teams set archived = true where id = '00000000-0000-0000-0000-0000000000a1';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000011';
do $$ begin
  if public.season_kpi_sheet('00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-0000000000a1') ->> 'can_edit' <> 'false' then
    raise exception 'archived still editable';
  end if;
  begin
    perform public.delete_season_kpi((select id from ids where name = 'athlete_okr'));
    raise exception 'deleted after archive';
  exception when raise_exception then
    if sqlerrm = 'deleted after archive' then raise; end if;
  end;
end $$;

-- Past seasons stay in the athlete's list.
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000031';
do $$ begin
  if not exists (select 1 from public.season_kpi_people() where archived and team_id = '00000000-0000-0000-0000-0000000000a1') then
    raise exception 'archived season missing from the list';
  end if;
  if exists (select 1 from public.kpi_review_todos()) then raise exception 'to-dos for an archived season'; end if;
end $$;

-- Keeping records removes old athletes' KPIs only, once archived.
reset role;
update public.club_settings set retention_enabled = true where id;
update public.season_kpis set updated_at = now() - interval '10 years';
update public.season_kpi_reviews set updated_at = now() - interval '10 years';
do $$
declare r jsonb;
begin
  r := public.purge_expired_records();
  if (r ->> 'season_kpis')::int <> 2 or (r ->> 'season_kpi_reviews')::int <> 1 then raise exception 'purge: %', r; end if;
  if (select count(*) from public.season_kpis) <> 3 then raise exception 'coach and manager KPIs should stay'; end if;
end $$;

select 'season KPI tests passed';
