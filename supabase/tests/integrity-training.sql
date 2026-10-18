-- Tests for integrity training: 20261009120000_integrity_training.sql. Covers
-- admin_save_training_requirement, admin_delete_training_requirement,
-- admin_copy_training_requirements, admin_set_training_archived,
-- training_requirement_members, my_training, submit_training_certificate,
-- training_to_review, review_training_certificate and training_overview.
-- Rules checked: only admins set training; a requirement applies by role and,
-- when limited, by squad or team; the member or the parent or guardian of an
-- athlete under 18 uploads certificates (into the member's own folder); the
-- committee and admins check them, but nobody checks their own or their own
-- child's; certificates are private to the member, their guardians, the
-- committee and admins; archived training leaves to-do lists; training with
-- certificates can only be archived. Prints one line per check.
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
-- Supabase grants table access to signed-in users and relies on row level
-- security; the local stubs don't, so do it here.
grant select on public.training_requirements, public.training_requirement_teams,
  public.training_certificates to authenticated;
grant select, insert on storage.objects to authenticated;
create or replace function pg_temp.as_member(n text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || n, false) $$;
create or replace function pg_temp.ok(label text, actual boolean, expected boolean) returns text language sql as
$$ select case when actual is not distinct from expected then 'PASS ' else 'FAIL ' end || label || ' (got ' || coalesce(actual::text, 'null') || ')' $$;
create or replace function pg_temp.fails(label text, statement text) returns text language plpgsql as
$$ begin execute statement; return 'FAIL ' || label || ' (no error)';
   exception when others then return 'PASS ' || label || ' (' || sqlerrm || ')'; end $$;
create or replace function pg_temp.works(label text, statement text) returns text language plpgsql as
$$ begin execute statement; return 'PASS ' || label;
   exception when others then return 'FAIL ' || label || ' (' || sqlerrm || ')'; end $$;
create or replace function pg_temp.m(n text) returns uuid language sql as
$$ select ('00000000-0000-0000-0000-0000000000' || n)::uuid $$;
create or replace function pg_temp.req(p_name text) returns uuid language sql as
$$ select id from public.training_requirements where name = p_name and season = 2026 $$;
-- A certificate file path in a member's folder.
create or replace function pg_temp.file(n text, k text) returns text language sql as
$$ select '00000000-0000-0000-0000-0000000000' || n || '/00000000-0000-0000-0000-0000000000' || k || '/certificate.pdf' $$;
create or replace function pg_temp.cert(n text, p_req text) returns uuid language sql as
$$ select id from public.training_certificates where profile_id = pg_temp.m(n) and requirement_id = pg_temp.req(p_req)
   order by created_at desc limit 1 $$;

-- An archived squad, and a team in next season with the same name as this one.
insert into public.teams (id, name, kind, season, archived) values
  ('00000000-0000-0000-0000-0000000000a8', 'Gone Squad', 'squad', 2026, true),
  ('00000000-0000-0000-0000-0000000000a7', 'Sample Team', 'team', 2027, false);

select pg_temp.ok('anon cannot set training', has_function_privilege('anon', 'public.admin_save_training_requirement(uuid, integer, text, text, text, date, public.app_role[], uuid[])', 'execute'), false);
select pg_temp.ok('anon cannot upload certificates', has_function_privilege('anon', 'public.submit_training_certificate(uuid, uuid[], date, text, text, text)', 'execute'), false);
select pg_temp.ok('members cannot call training_applies directly', has_function_privilege('authenticated', 'public.training_applies(uuid, uuid)', 'execute'), false);

-- ---------------------------------------------------------------------------
-- Admins set the training
-- ---------------------------------------------------------------------------
select pg_temp.as_member('11');
select pg_temp.fails('coach cannot set training', $s$ select public.admin_save_training_requirement(null, 2026, 'Coach course', null, null, current_date + 30, '{coach}', '{}') $s$);
select pg_temp.as_member('22');
select pg_temp.fails('committee cannot set training', $s$ select public.admin_save_training_requirement(null, 2026, 'Committee course', null, null, current_date + 30, '{coach}', '{}') $s$);
select pg_temp.as_member('01');
select pg_temp.fails('training needs a name', $s$ select public.admin_save_training_requirement(null, 2026, '  ', null, null, current_date + 30, '{coach}', '{}') $s$);
select pg_temp.fails('training needs a due date', $s$ select public.admin_save_training_requirement(null, 2026, 'Course', null, null, null, '{coach}', '{}') $s$);
select pg_temp.fails('training needs a season', $s$ select public.admin_save_training_requirement(null, null, 'Course', null, null, current_date + 30, '{coach}', '{}') $s$);
select pg_temp.fails('training needs roles', $s$ select public.admin_save_training_requirement(null, 2026, 'Course', null, null, current_date + 30, '{}', '{}') $s$);
select pg_temp.fails('guests cannot be asked', $s$ select public.admin_save_training_requirement(null, 2026, 'Course', null, null, current_date + 30, '{guest}', '{}') $s$);
select pg_temp.fails('course link must be a web link', $s$ select public.admin_save_training_requirement(null, 2026, 'Course', null, 'javascript:alert(1)', current_date + 30, '{coach}', '{}') $s$);
select pg_temp.fails('archived squads cannot be chosen', $s$ select public.admin_save_training_requirement(null, 2026, 'Course', null, null, current_date + 30, '{athlete}', '{00000000-0000-0000-0000-0000000000a8}') $s$);
select pg_temp.fails('changing missing training refused', $s$ select public.admin_save_training_requirement('00000000-0000-0000-0000-0000000000ee', 2026, 'Course', null, null, current_date + 30, '{coach}', '{}') $s$);
select pg_temp.works('admin adds safeguarding for coaches and athletes', $s$ select public.admin_save_training_requirement(null, 2026, ' Safeguarding ', ' Online course ', ' https://example.test/course ', current_date + 30, '{coach,athlete,coach}', '{}') $s$);
select pg_temp.ok('saved trimmed, every team, roles de-duplicated', (select details = 'Online course' and course_url = 'https://example.test/course' and all_teams and cardinality(roles) = 2 and created_by = pg_temp.m('01') from public.training_requirements where name = 'Safeguarding'), true);
select pg_temp.works('admin adds anti-doping for the team''s athletes', $s$ select public.admin_save_training_requirement(null, 2026, 'Anti-doping', null, null, current_date + 60, '{athlete}', '{00000000-0000-0000-0000-0000000000a2}') $s$);
select pg_temp.ok('limited to the team', (select not all_teams from public.training_requirements where name = 'Anti-doping') and (select count(*) = 1 from public.training_requirement_teams where requirement_id = pg_temp.req('Anti-doping')), true);
select pg_temp.works('admin adds governance for the committee', $s$ select public.admin_save_training_requirement(null, 2026, 'Governance', null, null, current_date + 90, '{committee}', '{}') $s$);
select pg_temp.works('admin adds training to remove', $s$ select public.admin_save_training_requirement(null, 2026, 'Mistake', null, null, current_date + 90, '{manager}', '{}') $s$);
select pg_temp.works('admin renames it', format('select public.admin_save_training_requirement(%L, 2026, %L, null, null, current_date + 90, %L, %L)', pg_temp.req('Mistake'), 'Big mistake', '{manager}', '{}'));
select pg_temp.ok('renamed in place', pg_temp.req('Big mistake') is not null and pg_temp.req('Mistake') is null, true);

-- ---------------------------------------------------------------------------
-- Members see their training
-- ---------------------------------------------------------------------------
select pg_temp.as_member('31');
select pg_temp.ok('team athlete has safeguarding and anti-doping to do', (select array_agg(name order by name) = array['Anti-doping', 'Safeguarding'] and bool_and(is_me and status = 'to_do') from public.my_training()), true);
select pg_temp.as_member('32');
select pg_temp.ok('squad-only athlete has safeguarding only', (select array_agg(name) = array['Safeguarding'] from public.my_training()), true);
select pg_temp.as_member('41');
select pg_temp.ok('guardian sees the child''s training, not their own', (select count(*) = 2 and bool_and(profile_id = pg_temp.m('31') and not is_me) from public.my_training()), true);
select pg_temp.as_member('42');
select pg_temp.ok('coach who is a parent sees their own and the child''s', (select count(*) filter (where is_me) = 1 and count(*) filter (where not is_me) = 2 from public.my_training()), true);
select pg_temp.as_member('13');
select pg_temp.ok('manager has the manager course', (select array_agg(name) = array['Big mistake'] from public.my_training()), true);
select pg_temp.as_member('22');
select pg_temp.ok('committee member has governance', (select array_agg(name) = array['Governance'] from public.my_training()), true);

-- ---------------------------------------------------------------------------
-- Uploading certificates
-- ---------------------------------------------------------------------------
-- Files go in the member's folder; only the member or their guardian can put them there.
set role authenticated;
select pg_temp.as_member('41');
select pg_temp.works('guardian uploads into the child''s folder', format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'training-certificates', pg_temp.file('31', 'c1')));
select pg_temp.as_member('32');
select pg_temp.fails('another athlete cannot upload into the child''s folder', format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'training-certificates', pg_temp.file('31', 'c9')));
select pg_temp.fails('a file outside a member folder refused', $s$ insert into storage.objects (bucket_id, name) values ('training-certificates', 'loose.pdf') $s$);
select pg_temp.works('athlete uploads into their own folder', format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'training-certificates', pg_temp.file('32', 'c2')));
select pg_temp.as_member('11');
select pg_temp.fails('coach cannot upload into the child''s folder', format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'training-certificates', pg_temp.file('31', 'c8')));
reset role;
insert into storage.objects (bucket_id, name) values
  ('training-certificates', pg_temp.file('31', 'c3')),
  ('training-certificates', pg_temp.file('22', 'c4')),
  ('training-certificates', pg_temp.file('12', 'c5'));

select pg_temp.as_member('32');
select pg_temp.fails('another athlete cannot upload for the child', format('select public.submit_training_certificate(%L, %L, current_date, %L, %L)', pg_temp.m('31'), array[pg_temp.req('Safeguarding')], pg_temp.file('31', 'c1'), 'cert.pdf'));
select pg_temp.fails('training that isn''t on the list refused', format('select public.submit_training_certificate(%L, %L, current_date, %L, %L)', pg_temp.m('32'), array[pg_temp.req('Anti-doping')], pg_temp.file('32', 'c2'), 'cert.pdf'));
select pg_temp.fails('nothing ticked refused', format('select public.submit_training_certificate(%L, %L, current_date, %L, %L)', pg_temp.m('32'), '{}'::uuid[], pg_temp.file('32', 'c2'), 'cert.pdf'));
select pg_temp.fails('completed in the future refused', format('select public.submit_training_certificate(%L, %L, current_date + 1, %L, %L)', pg_temp.m('32'), array[pg_temp.req('Safeguarding')], pg_temp.file('32', 'c2'), 'cert.pdf'));
select pg_temp.fails('a file that wasn''t uploaded refused', format('select public.submit_training_certificate(%L, %L, current_date, %L, %L)', pg_temp.m('32'), array[pg_temp.req('Safeguarding')], pg_temp.file('32', 'c7'), 'cert.pdf'));
select pg_temp.fails('someone else''s file refused', format('select public.submit_training_certificate(%L, %L, current_date, %L, %L)', pg_temp.m('32'), array[pg_temp.req('Safeguarding')], pg_temp.file('31', 'c1'), 'cert.pdf'));
select pg_temp.works('adult athlete uploads their own certificate', format('select public.submit_training_certificate(%L, %L, current_date - 2, %L, %L, %L)', pg_temp.m('32'), array[pg_temp.req('Safeguarding')], pg_temp.file('32', 'c2'), ' cert.pdf ', ' Done online '));
select pg_temp.ok('certificate waiting, with who sent it', (select status = 'submitted' and submitted_by = pg_temp.m('32') and submitted_by_name = 'Kai Senior' and notes = 'Done online' and document_name = 'cert.pdf' from public.training_certificates where profile_id = pg_temp.m('32')), true);
select pg_temp.fails('second certificate while one is waiting refused', format('select public.submit_training_certificate(%L, %L, current_date, %L, %L)', pg_temp.m('32'), array[pg_temp.req('Safeguarding')], pg_temp.file('32', 'c2'), 'again.pdf'));
select pg_temp.as_member('11');
select pg_temp.fails('coach cannot upload for the child', format('select public.submit_training_certificate(%L, %L, current_date, %L, %L)', pg_temp.m('31'), array[pg_temp.req('Safeguarding')], pg_temp.file('31', 'c1'), 'cert.pdf'));
select pg_temp.as_member('41');
select pg_temp.ok('guardian may upload for a child under 18', public.can_submit_training_for(pg_temp.m('31')), true);
select pg_temp.works('guardian uploads one certificate for both courses', format('select public.submit_training_certificate(%L, %L, current_date, %L, %L)', pg_temp.m('31'), array[pg_temp.req('Safeguarding'), pg_temp.req('Anti-doping')], pg_temp.file('31', 'c1'), 'both.pdf'));
select pg_temp.ok('two certificates added, submitted by the guardian', (select count(*) = 2 and bool_and(submitted_by = pg_temp.m('41')) from public.training_certificates where profile_id = pg_temp.m('31')), true);
select pg_temp.ok('guardian sees both as submitted', (select count(*) = 2 and bool_and(status = 'submitted') from public.my_training()), true);
-- At 18 the guardian no longer acts for them.
update public.profiles set date_of_birth = current_date - interval '19 years', under_17 = false where id = pg_temp.m('31');
select pg_temp.ok('guardian may not upload for an adult', public.can_submit_training_for(pg_temp.m('31')), false);
select pg_temp.ok('guardian no longer sees the adult''s training', (select count(*) = 0 from public.my_training()), true);
update public.profiles set date_of_birth = current_date - interval '14 years', under_17 = true where id = pg_temp.m('31');
select pg_temp.as_member('22');
select pg_temp.works('committee member uploads their own certificate', format('select public.submit_training_certificate(%L, %L, current_date, %L, %L)', pg_temp.m('22'), array[pg_temp.req('Governance')], pg_temp.file('22', 'c4'), 'gov.pdf'));

-- Who sees certificates.
set role authenticated;
select pg_temp.as_member('32');
select pg_temp.ok('athlete sees only their own certificate', (select count(*) = 1 and bool_and(profile_id = pg_temp.m('32')) from public.training_certificates), true);
select pg_temp.as_member('41');
select pg_temp.ok('guardian sees the child''s certificates', (select count(*) = 2 and bool_and(profile_id = pg_temp.m('31')) from public.training_certificates), true);
select pg_temp.ok('guardian sees the child''s files', (select count(*) = 2 from storage.objects where bucket_id = 'training-certificates' and name like '00000000-0000-0000-0000-000000000031/%'), true);
select pg_temp.as_member('11');
select pg_temp.ok('coach sees no certificates', (select count(*) = 0 from public.training_certificates), true);
select pg_temp.ok('coach sees no certificate files', (select count(*) = 0 from storage.objects where bucket_id = 'training-certificates'), true);
select pg_temp.as_member('14');
select pg_temp.ok('physio sees no certificates', (select count(*) = 0 from public.training_certificates), true);
select pg_temp.as_member('23');
select pg_temp.ok('committee sees every certificate', (select count(*) = 4 from public.training_certificates), true);
reset role;

-- ---------------------------------------------------------------------------
-- Checking certificates
-- ---------------------------------------------------------------------------
select pg_temp.as_member('11');
select pg_temp.ok('coach has nothing to check', (select count(*) = 0 from public.training_to_review()), true);
select pg_temp.fails('coach cannot check certificates', format('select public.review_training_certificate(%L, true)', pg_temp.cert('32', 'Safeguarding')));
select pg_temp.as_member('21');
select pg_temp.fails('committee member with a lapsed check cannot check certificates', format('select public.review_training_certificate(%L, true)', pg_temp.cert('32', 'Safeguarding')));
select pg_temp.as_member('22');
select pg_temp.ok('committee sees four waiting, oldest first', (select count(*) = 4 from public.training_to_review()), true);
select pg_temp.ok('committee member can''t check their own', (select not can_review from public.training_to_review() where profile_id = pg_temp.m('22')), true);
select pg_temp.fails('committee member cannot approve their own', format('select public.review_training_certificate(%L, true)', pg_temp.cert('22', 'Governance')));
select pg_temp.fails('send-back needs a note', format('select public.review_training_certificate(%L, false, %L)', pg_temp.cert('32', 'Safeguarding'), '  '));
select pg_temp.fails('missing certificate refused', $s$ select public.review_training_certificate('00000000-0000-0000-0000-0000000000ee', true) $s$);
select pg_temp.works('committee sends a certificate back', format('select public.review_training_certificate(%L, false, %L)', pg_temp.cert('32', 'Safeguarding'), ' Name is cut off '));
select pg_temp.ok('sent back with the note and reviewer', (select status = 'sent_back' and review_note = 'Name is cut off' and reviewed_by = pg_temp.m('22') and reviewed_by_name = 'Harper Committee' from public.training_certificates where profile_id = pg_temp.m('32')), true);
select pg_temp.fails('a checked certificate cannot be checked again', format('select public.review_training_certificate(%L, true)', pg_temp.cert('32', 'Safeguarding')));
select pg_temp.works('committee approves the child''s safeguarding', format('select public.review_training_certificate(%L, true)', pg_temp.cert('31', 'Safeguarding')));
-- A parent on the committee can't check their own child's.
update public.profiles set extra_roles = '{guardian,committee}' where id = pg_temp.m('42');
select pg_temp.as_member('42');
select pg_temp.ok('parent on the committee can''t check their child''s', (select not can_review from public.training_to_review() where profile_id = pg_temp.m('31')), true);
select pg_temp.fails('parent on the committee cannot approve their child''s', format('select public.review_training_certificate(%L, true)', pg_temp.cert('31', 'Anti-doping')));
update public.profiles set extra_roles = '{guardian}' where id = pg_temp.m('42');
select pg_temp.as_member('23');
select pg_temp.works('another committee member approves the governance certificate', format('select public.review_training_certificate(%L, true)', pg_temp.cert('22', 'Governance')));

-- The member sees where they are up to and uploads again.
select pg_temp.as_member('32');
select pg_temp.ok('athlete sees it was sent back and why', (select status = 'sent_back' and review_note = 'Name is cut off' from public.my_training() where name = 'Safeguarding'), true);
select pg_temp.works('athlete uploads a new certificate', format('select public.submit_training_certificate(%L, %L, current_date, %L, %L)', pg_temp.m('32'), array[pg_temp.req('Safeguarding')], pg_temp.file('32', 'c2'), 'better.pdf'));
select pg_temp.ok('new one is waiting, old one kept', (select status = 'submitted' and document_name = 'better.pdf' from public.my_training() where name = 'Safeguarding') and (select count(*) = 2 from public.training_certificates where profile_id = pg_temp.m('32')), true);
select pg_temp.as_member('41');
select pg_temp.ok('guardian sees the approval', (select status = 'approved' and reviewed_by_name = 'Harper Committee' from public.my_training() where name = 'Safeguarding'), true);
select pg_temp.fails('approved training cannot be uploaded again', format('select public.submit_training_certificate(%L, %L, current_date, %L, %L)', pg_temp.m('31'), array[pg_temp.req('Safeguarding')], pg_temp.file('31', 'c3'), 'again.pdf'));

-- ---------------------------------------------------------------------------
-- Overview and member lists, for the committee and admins
-- ---------------------------------------------------------------------------
select pg_temp.as_member('22');
-- Safeguarding: coaches 11, 12, 42 and athletes 31, 32. 31 approved, 32 waiting.
select pg_temp.ok('safeguarding overview counts', (select required = 5 and approved = 1 and submitted = 1 and outstanding = 3 from public.training_overview(2026) where requirement_id = pg_temp.req('Safeguarding')), true);
select pg_temp.ok('anti-doping overview counts', (select required = 1 and approved = 0 and submitted = 1 and outstanding = 0 from public.training_overview(2026) where requirement_id = pg_temp.req('Anti-doping')), true);
select pg_temp.ok('overview lists every requirement of the season', (select count(*) = 4 from public.training_overview(2026)), true);
select pg_temp.ok('member list for anti-doping is the team''s athlete', (select array_agg(profile_id) = array[pg_temp.m('31')] and bool_and(status = 'submitted') from public.training_requirement_members(pg_temp.req('Anti-doping'))), true);
select pg_temp.ok('member list shows who is still to do it', (select count(*) = 3 from public.training_requirement_members(pg_temp.req('Safeguarding')) where status = 'to_do'), true);
select pg_temp.as_member('11');
select pg_temp.ok('coach sees no overview', (select count(*) = 0 from public.training_overview(2026)), true);
select pg_temp.ok('coach sees no member list', (select count(*) = 0 from public.training_requirement_members(pg_temp.req('Safeguarding'))), true);
select pg_temp.as_member('41');
select pg_temp.ok('guardian sees no member list', (select count(*) = 0 from public.training_requirement_members(pg_temp.req('Anti-doping'))), true);

-- ---------------------------------------------------------------------------
-- Archiving, removing and copying
-- ---------------------------------------------------------------------------
select pg_temp.as_member('22');
select pg_temp.fails('committee cannot archive training', format('select public.admin_set_training_archived(%L, true)', pg_temp.req('Anti-doping')));
select pg_temp.fails('committee cannot remove training', format('select public.admin_delete_training_requirement(%L)', pg_temp.req('Big mistake')));
select pg_temp.fails('committee cannot copy training', $s$ select public.admin_copy_training_requirements(2026, 2027) $s$);
select pg_temp.as_member('01');
select pg_temp.fails('training with certificates cannot be removed', format('select public.admin_delete_training_requirement(%L)', pg_temp.req('Anti-doping')));
select pg_temp.works('admin removes training with no certificates', format('select public.admin_delete_training_requirement(%L)', pg_temp.req('Big mistake')));
select pg_temp.ok('removed', pg_temp.req('Big mistake') is null, true);
select pg_temp.works('admin archives anti-doping', format('select public.admin_set_training_archived(%L, true)', pg_temp.req('Anti-doping')));
select pg_temp.ok('certificates kept when archived', (select count(*) = 1 from public.training_certificates where requirement_id = pg_temp.req('Anti-doping')), true);
select pg_temp.as_member('31');
select pg_temp.ok('archived training leaves the to-do list', (select array_agg(name) = array['Safeguarding'] from public.my_training()), true);
select pg_temp.fails('certificate for archived training refused', format('select public.submit_training_certificate(%L, %L, current_date, %L, %L)', pg_temp.m('31'), array[pg_temp.req('Anti-doping')], pg_temp.file('31', 'c3'), 'late.pdf'));
select pg_temp.as_member('01');
select pg_temp.fails('copying into an earlier season refused', $s$ select public.admin_copy_training_requirements(2026, 2026) $s$);
select pg_temp.ok('copy skips archived training', public.admin_copy_training_requirements(2026, 2027) = 2, true);
select pg_temp.ok('copied with due dates a year on', (select due_on = current_date + 30 + interval '1 year' and all_teams from public.training_requirements where season = 2027 and name = 'Safeguarding'), true);
select pg_temp.works('admin brings anti-doping back', format('select public.admin_set_training_archived(%L, false)', pg_temp.req('Anti-doping')));
select pg_temp.ok('second copy adds only what is new', public.admin_copy_training_requirements(2026, 2027) = 1, true);
select pg_temp.ok('copied team matched by name in the new season', (select array_agg(rt.team_id) = array[pg_temp.m('a7')] from public.training_requirement_teams rt join public.training_requirements r on r.id = rt.requirement_id where r.season = 2027 and r.name = 'Anti-doping'), true);
select pg_temp.ok('copy again adds nothing', public.admin_copy_training_requirements(2026, 2027) = 0, true);
