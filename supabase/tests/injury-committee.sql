-- Tests for 20261023200000_injury_committee.sql: a club chooses whether the
-- whole committee or chosen committee members see injuries and sign off
-- clearances (customer review R7). Run on a fresh database with the
-- migrations and seed-members.sql loaded. Prints one line per check.
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
create or replace function pg_temp.id(n text) returns uuid language sql as
$$ select ('00000000-0000-0000-0000-0000000000' || n)::uuid $$;
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
create or replace function pg_temp.injury(p_area text) returns uuid language sql as
$$ select id from public.injuries where body_area = p_area $$;
-- Whether the signed-in member reads an injury, as the app's role.
create or replace function pg_temp.reads(p_area text) returns boolean language plpgsql as
$$ declare v boolean;
   begin
     set local role authenticated;
     select exists (select 1 from public.injuries where body_area = p_area) into v;
     reset role;
     return v;
   end $$;
create or replace function pg_temp.listed(p_area text) returns boolean language sql as
$$ select exists (select 1 from public.visible_injuries(true) where body_area = p_area) $$;
create or replace function pg_temp.waiting(p_area text) returns boolean language sql as
$$ select coalesce((select waiting_for_me from public.visible_injuries(true) where body_area = p_area), false) $$;
create or replace function pg_temp.shares(p_area text) returns boolean language sql as
$$ select public.can_share_injury_documents(i) from public.injuries i where body_area = p_area $$;
create or replace function pg_temp.upload(p_area text) returns text language plpgsql as
$$ declare v_name text;
   begin
     select athlete_id::text || '/' || id::text || '/' || gen_random_uuid() || '.pdf' into v_name
     from public.injuries where body_area = p_area;
     insert into storage.objects (bucket_id, name, metadata)
     values ('injury-documents', v_name, '{"mimetype": "application/pdf"}');
     return v_name;
   end $$;
-- What a committee member sees of both injuries: Jordan's (under 18) and Kai's.
create or replace function pg_temp.sees(who text, n text, child boolean, adult boolean) returns setof text language plpgsql as
$$ begin
     perform pg_temp.as_member(n);
     return next pg_temp.ok(who || ': Jordan''s ankle', pg_temp.reads('Ankle'), child);
     return next pg_temp.ok(who || ': Jordan''s ankle listed', pg_temp.listed('Ankle'), child);
     return next pg_temp.ok(who || ': Kai''s wrist', pg_temp.reads('Wrist'), adult);
     return next pg_temp.ok(who || ': Kai''s wrist listed', pg_temp.listed('Wrist'), adult);
   end $$;

insert into public.club_settings (id) values (true) on conflict (id) do nothing;
insert into public.safeguarding_settings (id) values (true) on conflict (id) do nothing;

-- Gale (21) gets a current check; Harper (22) has none, before the checks
-- date; Indy (23) is exempt as treasurer. Rowan (51) is a second checked
-- committee member, Sage (52) is waiting for approval, and Morgan (42), a
-- coach-parent with a check, also sits on the committee.
update public.profiles set wwcc_expires_on = public.club_today() + 400 where id = pg_temp.id('21');
insert into auth.users (id, email, email_confirmed_at) values
  (pg_temp.id('51'), 'committee.second@example.test', now()),
  (pg_temp.id('52'), 'committee.pending@example.test', now());
update public.profiles set status = 'approved', full_name = 'Rowan Committee', role = 'committee',
  wwcc_number = 'WWC0051', wwcc_expires_on = public.club_today() + 400, verified_at = now() where id = pg_temp.id('51');
update public.profiles set status = 'pending', full_name = 'Sage Pending', role = 'committee' where id = pg_temp.id('52');
update public.profiles set extra_roles = '{guardian,committee}' where id = pg_temp.id('42');

-- Jordan's ankle (the seed's), with Logan's consent, and Kai's wrist.
select pg_temp.as_member('41');
select pg_temp.works('Logan consents for Jordan', $$select public.set_child_consent('00000000-0000-0000-0000-000000000031', true, true)$$);
select set_config('request.jwt.claim.sub', '', false);
insert into public.injuries (athlete_id, reported_by, body_area, description, injured_on, athlete_name)
values (pg_temp.id('32'), pg_temp.id('32'), 'Wrist', 'Jammed at training', public.club_today() - 2, 'Kai Senior');

-- ---------------------------------------------------------------------------
-- Who can call what
-- ---------------------------------------------------------------------------
select pg_temp.ok('the helper is closed to members', has_function_privilege('authenticated', 'public.committee_member_sees_injuries(uuid)', 'execute'), false);
select pg_temp.ok('and to anon', has_function_privilege('anon', 'public.committee_member_sees_injuries(uuid)', 'execute'), false);
select pg_temp.ok('members ask whether they see injuries as committee', has_function_privilege('authenticated', 'public.my_committee_sees_injuries()', 'execute'), true);
select pg_temp.ok('anon can''t', has_function_privilege('anon', 'public.my_committee_sees_injuries()', 'execute'), false);
select pg_temp.ok('anon can''t read the choice', has_function_privilege('anon', 'public.admin_injury_committee()', 'execute'), false);
select pg_temp.ok('anon can''t set it', has_function_privilege('anon', 'public.admin_set_injury_committee(boolean, uuid[])', 'execute'), false);
select pg_temp.ok('starts as the whole committee', (select not injury_committee_chosen and injury_committee_ids = '{}' from public.safeguarding_settings where id), true);

-- Only admins read or change the choice.
select pg_temp.as_member('01');
select pg_temp.ok('an admin reads the choice', (select not chosen and member_ids = '{}' from public.admin_injury_committee()), true);
select pg_temp.as_member('02');
select pg_temp.ok('an admin without a check reads it too', (select count(*) = 1 from public.admin_injury_committee()), true);
select pg_temp.as_member('21');
select pg_temp.ok('a committee member reads nothing', (select count(*) = 0 from public.admin_injury_committee()), true);
select pg_temp.fails('and can''t change it', $$select public.admin_set_injury_committee(true, array['00000000-0000-0000-0000-000000000021'::uuid])$$);
select pg_temp.as_member('11');
select pg_temp.ok('a coach reads nothing', (select count(*) = 0 from public.admin_injury_committee()), true);
select pg_temp.fails('and can''t change it', $$select public.admin_set_injury_committee(true, '{}')$$);
select pg_temp.as_member('31');
select pg_temp.fails('an athlete can''t change it', $$select public.admin_set_injury_committee(false, '{}')$$);
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.ok('signed out reads nothing', (select count(*) = 0 from public.admin_injury_committee()), true);
select pg_temp.fails('and can''t change it', $$select public.admin_set_injury_committee(true, '{}')$$);
select pg_temp.as_member('01');
update public.profiles set stood_down_at = now() where id = pg_temp.id('02');
select pg_temp.as_member('02');
select pg_temp.fails('a stood-down admin can''t change it', $$select public.admin_set_injury_committee(true, '{}')$$);
update public.profiles set stood_down_at = null where id = pg_temp.id('02');
select pg_temp.ok('nothing changed', (select not injury_committee_chosen and injury_committee_ids = '{}' from public.safeguarding_settings where id), true);

-- ---------------------------------------------------------------------------
-- The whole committee (the default): as before
-- ---------------------------------------------------------------------------
select pg_temp.sees('whole committee, Gale (check)', '21', true, true);
select pg_temp.sees('whole committee, Rowan (check)', '51', true, true);
select pg_temp.sees('whole committee, Harper (no check yet)', '22', false, true);
select pg_temp.sees('whole committee, Indy (exempt)', '23', false, true);
select pg_temp.sees('whole committee, Morgan (committee as an extra role)', '42', true, true);
select pg_temp.sees('whole committee, an admin', '01', true, true);
select pg_temp.as_member('21');
select pg_temp.ok('Gale has the Injuries screen as committee', public.my_committee_sees_injuries(), true);
select pg_temp.as_member('23');
select pg_temp.ok('so does Indy', public.my_committee_sees_injuries(), true);
select pg_temp.as_member('01');
select pg_temp.ok('an admin isn''t asked as committee', public.my_committee_sees_injuries(), false);
select pg_temp.as_member('11');
select pg_temp.ok('nor a coach', public.my_committee_sees_injuries(), false);
select pg_temp.as_member('31');
select pg_temp.ok('nor an athlete', public.my_committee_sees_injuries(), false);
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.ok('nor anyone signed out', coalesce(public.my_committee_sees_injuries(), false), false);

-- ---------------------------------------------------------------------------
-- Choosing who
-- ---------------------------------------------------------------------------
select pg_temp.as_member('01');
select pg_temp.fails('the choice is needed', $$select public.admin_set_injury_committee(null, '{}')$$);
select pg_temp.fails('a coach can''t be chosen', $$select public.admin_set_injury_committee(true, array['00000000-0000-0000-0000-000000000011'::uuid])$$);
select pg_temp.fails('an admin can''t be chosen as committee', $$select public.admin_set_injury_committee(true, array['00000000-0000-0000-0000-000000000001'::uuid])$$);
select pg_temp.fails('a committee member waiting for approval can''t be chosen', $$select public.admin_set_injury_committee(true, array['00000000-0000-0000-0000-000000000052'::uuid])$$);
select pg_temp.fails('nor someone who isn''t a member', $$select public.admin_set_injury_committee(true, array[gen_random_uuid()])$$);
select pg_temp.ok('a refused choice changes nothing', (select not injury_committee_chosen and injury_committee_ids = '{}' from public.safeguarding_settings where id), true);
select pg_temp.works('an admin chooses Gale, Indy and Morgan', $$select public.admin_set_injury_committee(true, array['00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000023', '00000000-0000-0000-0000-000000000042', '00000000-0000-0000-0000-000000000021']::uuid[])$$);
select pg_temp.ok('saved once each, with who changed it', (select injury_committee_chosen and cardinality(injury_committee_ids) = 3 and updated_by = pg_temp.id('01') from public.safeguarding_settings where id), true);
select pg_temp.ok('the admin reads it back', (select chosen and pg_temp.id('42') = any (member_ids) from public.admin_injury_committee()), true);

select pg_temp.sees('chosen, Gale (check)', '21', true, true);
select pg_temp.sees('chosen, Morgan (committee as an extra role)', '42', true, true);
-- C6 still applies to a chosen member: Indy is exempt, so adults only.
select pg_temp.sees('chosen, Indy (exempt)', '23', false, true);
select pg_temp.sees('not chosen, Rowan (check)', '51', false, false);
select pg_temp.sees('not chosen, Harper (no check yet)', '22', false, false);
select pg_temp.sees('admins aren''t affected', '01', true, true);
select pg_temp.sees('nor an admin without a check, for adults', '02', true, true);
select pg_temp.as_member('51');
select pg_temp.ok('Rowan has no Injuries screen as committee', public.my_committee_sees_injuries(), false);
select pg_temp.as_member('21');
select pg_temp.ok('Gale keeps it', public.my_committee_sees_injuries(), true);
-- A chosen member whose recorded check lapses has the committee role paused,
-- so sees nothing; Indy above shows a chosen member without a check keeps
-- adults' injuries only.
update public.profiles set wwcc_expires_on = public.club_today() - 1 where id = pg_temp.id('21');
select pg_temp.sees('chosen, Gale after the check lapses (role paused)', '21', false, false);
update public.profiles set wwcc_expires_on = public.club_today() + 400 where id = pg_temp.id('21');
-- A chosen member stood down sees nothing.
update public.profiles set stood_down_at = now() where id = pg_temp.id('21');
select pg_temp.sees('chosen, Gale stood down', '21', false, false);
update public.profiles set stood_down_at = null where id = pg_temp.id('21');
-- Leaving the committee ends it, even while still on the list.
update public.profiles set extra_roles = '{guardian}' where id = pg_temp.id('42');
select pg_temp.as_member('42');
select pg_temp.ok('Morgan off the committee: no Injuries screen as committee', public.my_committee_sees_injuries(), false);
select pg_temp.ok('Morgan still sees Jordan''s as a coach and parent', pg_temp.reads('Ankle'), true);
update public.profiles set extra_roles = '{guardian,committee}' where id = pg_temp.id('42');

-- ---------------------------------------------------------------------------
-- Signing off clearances
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.upload('Wrist') as wrist_letter \gset
select pg_temp.upload('Ankle') as ankle_letter \gset
select pg_temp.as_member('32');
select pg_temp.works('Kai asks for clearance', format($$select public.request_clearance(pg_temp.injury('Wrist'), null, %L, 'letter.pdf')$$, :'wrist_letter'));
select pg_temp.as_member('31');
select pg_temp.works('Jordan asks for clearance', format($$select public.request_clearance(pg_temp.injury('Ankle'), null, %L, 'letter.pdf')$$, :'ankle_letter'));
select pg_temp.as_member('51');
select pg_temp.fails('Rowan (not chosen) can''t send back Kai''s request', $$select public.send_back_clearance(pg_temp.injury('Wrist'), 'Wrong letter')$$);
select pg_temp.as_member('11');
select pg_temp.works('the coach endorses Kai''s wrist', $$select public.endorse_clearance(pg_temp.injury('Wrist'))$$);
select pg_temp.works('and Jordan''s ankle', $$select public.endorse_clearance(pg_temp.injury('Ankle'))$$);
select pg_temp.as_member('51');
select pg_temp.ok('Rowan isn''t asked to accept Kai''s', pg_temp.waiting('Wrist'), false);
select pg_temp.fails('and can''t accept it', $$select public.accept_clearance(pg_temp.injury('Wrist'))$$);
select pg_temp.fails('nor send it back', $$select public.send_back_clearance(pg_temp.injury('Wrist'), 'Wrong letter')$$);
select pg_temp.ok('nor share its documents', pg_temp.shares('Wrist'), false);
select pg_temp.ok('nor Jordan''s', pg_temp.shares('Ankle'), false);
select pg_temp.as_member('23');
select pg_temp.ok('Indy (chosen, exempt) is asked to accept Kai''s', pg_temp.waiting('Wrist'), true);
select pg_temp.ok('and may share its documents', pg_temp.shares('Wrist'), true);
select pg_temp.ok('but isn''t asked for Jordan''s', pg_temp.waiting('Ankle'), false);
select pg_temp.fails('and can''t accept Jordan''s', $$select public.accept_clearance(pg_temp.injury('Ankle'))$$);
select pg_temp.as_member('21');
select pg_temp.ok('Gale (chosen, check) is asked to accept Jordan''s', pg_temp.waiting('Ankle'), true);
select pg_temp.works('and accepts it', $$select public.accept_clearance(pg_temp.injury('Ankle'))$$);
select pg_temp.ok('Jordan is cleared', (select status = 'cleared' from public.injuries where body_area = 'Ankle'), true);

-- Nobody chosen: admins still sign off.
select pg_temp.as_member('01');
select pg_temp.works('an admin chooses nobody', $$select public.admin_set_injury_committee(true, '{}')$$);
select pg_temp.sees('nobody chosen, Gale', '21', false, false);
select pg_temp.sees('nobody chosen, Indy', '23', false, false);
select pg_temp.as_member('23');
select pg_temp.fails('Indy can''t accept Kai''s now', $$select public.accept_clearance(pg_temp.injury('Wrist'))$$);
select pg_temp.as_member('01');
select pg_temp.ok('the admin is asked to accept Kai''s', pg_temp.waiting('Wrist'), true);
select pg_temp.works('and accepts it', $$select public.accept_clearance(pg_temp.injury('Wrist'))$$);
select pg_temp.ok('Kai is cleared', (select status = 'cleared' from public.injuries where body_area = 'Wrist'), true);

-- Back to the whole committee: the list is kept for next time.
select pg_temp.works('an admin chooses Rowan, then switches back to the whole committee', $$select public.admin_set_injury_committee(true, array['00000000-0000-0000-0000-000000000051'::uuid]), public.admin_set_injury_committee(false, array['00000000-0000-0000-0000-000000000051'::uuid])$$);
select pg_temp.ok('the list is kept', (select not injury_committee_chosen and injury_committee_ids = array[pg_temp.id('51')] from public.safeguarding_settings where id), true);
select pg_temp.sees('whole committee again, Harper', '22', false, true);
select pg_temp.sees('whole committee again, Gale', '21', true, true);

-- ---------------------------------------------------------------------------
-- No rows change, and the migration runs again cleanly
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.ok('still one settings row', (select count(*) = 1 from public.safeguarding_settings), true);
\ir ../migrations/20261023200000_injury_committee.sql
select pg_temp.ok('re-running keeps the choice', (select injury_committee_ids = array[pg_temp.id('51')] from public.safeguarding_settings where id), true);
