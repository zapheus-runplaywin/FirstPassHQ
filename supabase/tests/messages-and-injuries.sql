-- Tests for read receipts, guardians' athlete lists and injuries:
-- 20261007100000_group_messages.sql (mark_message_read, my_sent_messages,
-- with messages sent through send_group_message from
-- 20261017030000_message_copies_name_children.sql),
-- 20261012210000_guardians_end_at_18_and_check_in_averages.sql (my_athletes),
-- 20261007120000_injuries.sql and 20261009110000_multiple_roles.sql
-- (report_injury), 20261007140000_keep_injury_records.sql (injury_report) and
-- 20261012001000_team_physios.sql and 20261018000000_send_back_needs_consent.sql
-- (send_back_clearance). Rules checked: a
-- member marks only their own copy read, and only once; senders see how many
-- read their messages and recipients can't see each other's receipts; a
-- guardian's athletes are their children under 18; athletes and their
-- guardians report injuries, nobody else; the injury report is for admins;
-- a clearance is sent back by the athlete's coaches, physios or the committee
-- while it waits for them, by the committee once endorsed, never by the
-- athlete, never for a child without a guardian's health consent, and always
-- with a note. Prints one line per check.
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
-- Supabase grants table access to signed-in users and relies on row level
-- security; the local stubs don't, so do it here.
grant select on public.messages, public.message_recipients, public.injuries, public.injury_updates to authenticated;
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
create or replace function pg_temp.msg(p_body text) returns uuid language sql as
$$ select id from public.messages where body = p_body $$;
create or replace function pg_temp.read_at(p_body text, n text) returns timestamptz language sql as
$$ select read_at from public.message_recipients where message_id = pg_temp.msg(p_body) and profile_id = pg_temp.m(n) $$;
create or replace function pg_temp.injury(p_area text) returns uuid language sql as
$$ select id from public.injuries where body_area = p_area $$;
create or replace function pg_temp.status(p_area text) returns text language sql as
$$ select status::text from public.injuries where body_area = p_area $$;
-- An uploaded proof letter for an injury, and the athlete asking for clearance with it.
create or replace function pg_temp.letter(p_area text) returns text language sql as
$$ select athlete_id::text || '/' || id::text || '/' from public.injuries where body_area = p_area $$;
create or replace function pg_temp.ask_for_clearance(p_area text, n text) returns void language plpgsql as
$$ begin
     insert into storage.objects (bucket_id, name, metadata)
     values ('injury-documents', pg_temp.letter(p_area) || gen_random_uuid() || '.pdf', '{"mimetype": "application/pdf"}');
     perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || n, false);
     perform public.request_clearance(pg_temp.injury(p_area), 'Ready to play',
       (select name from storage.objects where name like pg_temp.letter(p_area) || '%' order by created_at desc, name desc limit 1), 'letter.pdf');
   end $$;

select pg_temp.ok('anon cannot mark messages read', has_function_privilege('anon', 'public.mark_message_read(uuid)', 'execute'), false);
select pg_temp.ok('anon cannot list sent messages', has_function_privilege('anon', 'public.my_sent_messages()', 'execute'), false);
select pg_temp.ok('anon cannot report injuries', has_function_privilege('anon', 'public.report_injury(uuid, text, text, date, text, date)', 'execute'), false);
select pg_temp.ok('anon cannot read the injury report', has_function_privilege('anon', 'public.injury_report(date)', 'execute'), false);
select pg_temp.ok('anon cannot send back clearances', has_function_privilege('anon', 'public.send_back_clearance(uuid, text)', 'execute'), false);

-- ---------------------------------------------------------------------------
-- Read receipts
-- ---------------------------------------------------------------------------
select pg_temp.as_member('11');
select pg_temp.works('coach messages their team', $s$ select public.send_group_message('Bring water on Saturday', 'group', null, '00000000-0000-0000-0000-0000000000a2') $s$);
select pg_temp.ok('team athlete and both guardians get it', (select array_agg(profile_id order by profile_id) = array[pg_temp.m('31'), pg_temp.m('41'), pg_temp.m('42')] from public.message_recipients where message_id = pg_temp.msg('Bring water on Saturday')), true);
select pg_temp.ok('nobody has read it yet', (select bool_and(read_at is null) from public.message_recipients where message_id = pg_temp.msg('Bring water on Saturday')), true);
select pg_temp.as_member('01');
select pg_temp.works('admin messages the whole club', $s$ select public.send_group_message('AGM on Friday', 'club') $s$);

select pg_temp.as_member('31');
select pg_temp.works('athlete marks the message read', format('select public.mark_message_read(%L)', pg_temp.msg('Bring water on Saturday')));
select pg_temp.ok('athlete''s copy is read', pg_temp.read_at('Bring water on Saturday', '31') is not null, true);
select pg_temp.ok('guardians'' copies are not', pg_temp.read_at('Bring water on Saturday', '41') is null and pg_temp.read_at('Bring water on Saturday', '42') is null, true);
update public.message_recipients set read_at = now() - interval '1 day'
where message_id = pg_temp.msg('Bring water on Saturday') and profile_id = pg_temp.m('31');
select pg_temp.works('marking it read again', format('select public.mark_message_read(%L)', pg_temp.msg('Bring water on Saturday')));
select pg_temp.ok('first read time is kept', pg_temp.read_at('Bring water on Saturday', '31') < now() - interval '23 hours', true);
select pg_temp.as_member('32');
select pg_temp.works('someone the message didn''t go to marks it read', format('select public.mark_message_read(%L)', pg_temp.msg('Bring water on Saturday')));
select pg_temp.ok('no copy is made for them', (select count(*) = 3 from public.message_recipients where message_id = pg_temp.msg('Bring water on Saturday')), true);
select pg_temp.works('marking a missing message read does nothing', $s$ select public.mark_message_read('00000000-0000-0000-0000-0000000000ee') $s$);
select pg_temp.as_member('41');
select pg_temp.works('guardian marks their copy read', format('select public.mark_message_read(%L)', pg_temp.msg('Bring water on Saturday')));
select pg_temp.ok('guardian''s copy is read, the other guardian''s is not', pg_temp.read_at('Bring water on Saturday', '41') is not null and pg_temp.read_at('Bring water on Saturday', '42') is null, true);

select pg_temp.as_member('11');
select pg_temp.ok('coach sees their message went to 3 and 2 read it', (select recipient_count = 3 and read_count = 2 and audience = 'group' and audience_label = 'Sample Team' from public.my_sent_messages() where id = pg_temp.msg('Bring water on Saturday')), true);
select pg_temp.ok('coach''s sent list is only their own messages', (select count(*) = 1 from public.my_sent_messages()), true);
select pg_temp.as_member('01');
select pg_temp.ok('admin''s sent list has the club message', (select count(*) = 1 and bool_and(audience = 'club' and read_count = 0 and recipient_count > 0) from public.my_sent_messages()), true);
select pg_temp.as_member('31');
select pg_temp.ok('athlete has sent nothing', (select count(*) = 0 from public.my_sent_messages()), true);

set role authenticated;
select pg_temp.as_member('31');
select pg_temp.ok('athlete sees only their own receipt', (select count(*) = 1 and bool_and(profile_id = pg_temp.m('31')) from public.message_recipients where message_id = pg_temp.msg('Bring water on Saturday')), true);
select pg_temp.as_member('41');
select pg_temp.ok('guardian''s copy names the child it is for', (select for_child_names = array['Jordan Junior'] from public.message_recipients where message_id = pg_temp.msg('Bring water on Saturday') and profile_id = pg_temp.m('41')), true);
select pg_temp.as_member('11');
select pg_temp.ok('sender sees every receipt', (select count(*) = 3 from public.message_recipients where message_id = pg_temp.msg('Bring water on Saturday')), true);
select pg_temp.as_member('32');
select pg_temp.ok('someone it didn''t go to cannot read it', (select count(*) = 0 from public.messages where id = pg_temp.msg('Bring water on Saturday')), true);
reset role;

-- ---------------------------------------------------------------------------
-- A guardian's athletes
-- ---------------------------------------------------------------------------
select pg_temp.as_member('41');
select pg_temp.ok('guardian''s athlete is the child', (select array_agg(profile_id) = array[pg_temp.m('31')] from public.my_athletes()), true);
select pg_temp.as_member('42');
select pg_temp.ok('coach who is a parent sees the child', (select array_agg(full_name) = array['Jordan Junior'] from public.my_athletes()), true);
select pg_temp.as_member('11');
select pg_temp.ok('coach has no athletes of their own', (select count(*) = 0 from public.my_athletes()), true);
select pg_temp.as_member('31');
select pg_temp.ok('athlete has no athletes', (select count(*) = 0 from public.my_athletes()), true);
update public.profiles set date_of_birth = current_date - interval '18 years', under_17 = false where id = pg_temp.m('31');
select pg_temp.as_member('41');
select pg_temp.ok('the child drops off on their 18th birthday', (select count(*) = 0 from public.my_athletes()), true);
update public.profiles set date_of_birth = current_date - interval '18 years' + interval '1 day' where id = pg_temp.m('31');
select pg_temp.ok('the day before their 18th they are still listed', (select count(*) = 1 from public.my_athletes()), true);
update public.profiles set date_of_birth = current_date - interval '14 years', under_17 = true where id = pg_temp.m('31');
update public.profiles set status = 'pending' where id = pg_temp.m('31');
select pg_temp.ok('a child who isn''t approved is not listed', (select count(*) = 0 from public.my_athletes()), true);
update public.profiles set status = 'approved' where id = pg_temp.m('31');

-- ---------------------------------------------------------------------------
-- Reporting injuries
-- ---------------------------------------------------------------------------
select pg_temp.as_member('32');
select pg_temp.works('adult athlete reports their own injury', $s$ select public.report_injury('00000000-0000-0000-0000-000000000032', ' Knee ', ' Jarred landing ', current_date - 1, ' No jumping ', current_date + 14) $s$);
select pg_temp.ok('injury saved trimmed, injured, reported by them', (select status = 'injured' and reported_by = pg_temp.m('32') and description = 'Jarred landing' and restrictions = 'No jumping' and expected_return = current_date + 14 from public.injuries where body_area = 'Knee'), true);
select pg_temp.ok('report added to the history', (select count(*) = 1 and bool_and(kind = 'reported' and author_name = 'Kai Senior') from public.injury_updates where injury_id = pg_temp.injury('Knee')), true);
select pg_temp.fails('athlete cannot report for another athlete', $s$ select public.report_injury('00000000-0000-0000-0000-000000000031', 'Wrist', 'Fell', current_date) $s$);
select pg_temp.fails('injury needs a body area', $s$ select public.report_injury('00000000-0000-0000-0000-000000000032', ' ', 'Fell', current_date) $s$);
select pg_temp.fails('injury needs a description', $s$ select public.report_injury('00000000-0000-0000-0000-000000000032', 'Wrist', '', current_date) $s$);
select pg_temp.fails('injury in the future refused', $s$ select public.report_injury('00000000-0000-0000-0000-000000000032', 'Wrist', 'Fell', current_date + 1) $s$);
select pg_temp.fails('injury needs a date', $s$ select public.report_injury('00000000-0000-0000-0000-000000000032', 'Wrist', 'Fell', null) $s$);
select pg_temp.as_member('41');
select pg_temp.works('guardian reports for their child', $s$ select public.report_injury('00000000-0000-0000-0000-000000000031', 'Shoulder', 'Fell at school', current_date) $s$);
select pg_temp.ok('reported by the guardian', (select reported_by = pg_temp.m('41') and athlete_id = pg_temp.m('31') from public.injuries where body_area = 'Shoulder'), true);
update public.profiles set date_of_birth = current_date - interval '19 years', under_17 = false where id = pg_temp.m('31');
select pg_temp.fails('guardian cannot report for an adult', $s$ select public.report_injury('00000000-0000-0000-0000-000000000031', 'Hip', 'Sore', current_date) $s$);
update public.profiles set date_of_birth = current_date - interval '14 years', under_17 = true where id = pg_temp.m('31');
select pg_temp.as_member('11');
select pg_temp.fails('coach cannot report for an athlete', $s$ select public.report_injury('00000000-0000-0000-0000-000000000031', 'Hip', 'Sore', current_date) $s$);
select pg_temp.fails('a coach is not an athlete to report for', $s$ select public.report_injury('00000000-0000-0000-0000-000000000011', 'Back', 'Sore', current_date) $s$);
select pg_temp.as_member('14');
select pg_temp.fails('physio cannot report for an athlete', $s$ select public.report_injury('00000000-0000-0000-0000-000000000032', 'Hip', 'Sore', current_date) $s$);
select pg_temp.as_member('01');
select pg_temp.fails('admin cannot report for an athlete', $s$ select public.report_injury('00000000-0000-0000-0000-000000000032', 'Hip', 'Sore', current_date) $s$);

-- The admin report.
select pg_temp.as_member('01');
select pg_temp.ok('admin report lists all three injuries', (select count(*) = 3 from public.injury_report(current_date - 30)), true);
select pg_temp.ok('admin report has the athlete and history count', (select athlete_name = 'Kai Senior' and update_count = 1 and document_count = 0 and status = 'injured' from public.injury_report(current_date - 30) where body_area = 'Knee'), true);
update public.injuries set status = 'cleared', cleared_at = now() - interval '60 days', created_at = now() - interval '90 days' where body_area = 'Ankle';
select pg_temp.ok('injuries cleared before the date drop off', (select count(*) = 2 from public.injury_report(current_date - 30)), true);
select pg_temp.ok('and come back for a longer period', (select count(*) = 3 from public.injury_report(current_date - 100)), true);
select pg_temp.as_member('22');
select pg_temp.ok('committee gets no admin report', (select count(*) = 0 from public.injury_report(current_date - 30)), true);
select pg_temp.as_member('11');
select pg_temp.ok('coach gets no admin report', (select count(*) = 0 from public.injury_report(current_date - 30)), true);
select pg_temp.as_member('41');
select pg_temp.ok('guardian gets no admin report', (select count(*) = 0 from public.injury_report(current_date - 30)), true);

-- ---------------------------------------------------------------------------
-- Sending back a clearance
-- ---------------------------------------------------------------------------
select pg_temp.works('athlete asks for clearance on the knee', $s$ select pg_temp.ask_for_clearance('Knee', '32') $s$);
select pg_temp.ok('clearance asked for', pg_temp.status('Knee') = 'clearance_requested', true);
select pg_temp.as_member('32');
select pg_temp.fails('athlete cannot send back their own clearance', format('select public.send_back_clearance(%L, %L)', pg_temp.injury('Knee'), 'Not yet'));
select pg_temp.as_member('13');
select pg_temp.fails('manager cannot send back a clearance', format('select public.send_back_clearance(%L, %L)', pg_temp.injury('Knee'), 'Not yet'));
select pg_temp.as_member('41');
select pg_temp.fails('guardian of someone else cannot send back a clearance', format('select public.send_back_clearance(%L, %L)', pg_temp.injury('Knee'), 'Not yet'));
select pg_temp.as_member('12');
select pg_temp.fails('coach with a lapsed check cannot send back a clearance', format('select public.send_back_clearance(%L, %L)', pg_temp.injury('Knee'), 'Not yet'));
select pg_temp.as_member('11');
select pg_temp.fails('missing injury refused', $s$ select public.send_back_clearance('00000000-0000-0000-0000-0000000000ee', 'Not yet') $s$);
select pg_temp.fails('send-back needs a note', format('select public.send_back_clearance(%L, %L)', pg_temp.injury('Knee'), '  '));
select pg_temp.works('coach sends the clearance back', format('select public.send_back_clearance(%L, %L)', pg_temp.injury('Knee'), ' Letter is unsigned '));
select pg_temp.ok('injury is back to injured', pg_temp.status('Knee') = 'injured', true);
select pg_temp.ok('send-back in the history with the note and coach', (select notes = 'Letter is unsigned' and author_id = pg_temp.m('11') and author_name = 'Casey Coach' from public.injury_updates where injury_id = pg_temp.injury('Knee') and kind = 'sent_back'), true);
select pg_temp.fails('an injury not waiting cannot be sent back', format('select public.send_back_clearance(%L, %L)', pg_temp.injury('Knee'), 'Again'));

-- Physios placed in the squad look after its athletes.
select pg_temp.works('athlete asks again, for the physio', $s$ select pg_temp.ask_for_clearance('Knee', '32') $s$);
select pg_temp.as_member('14');
select pg_temp.works('squad physio sends a clearance back', format('select public.send_back_clearance(%L, %L)', pg_temp.injury('Knee'), 'Needs another week'));
select pg_temp.ok('physio send-back recorded', (select count(*) = 2 from public.injury_updates where injury_id = pg_temp.injury('Knee') and kind = 'sent_back'), true);

-- The committee, before and after a coach endorses it.
select pg_temp.works('athlete asks again, for the committee', $s$ select pg_temp.ask_for_clearance('Knee', '32') $s$);
select pg_temp.as_member('22');
select pg_temp.works('committee sends back a clearance waiting for a coach', format('select public.send_back_clearance(%L, %L)', pg_temp.injury('Knee'), 'Wrong form'));
select pg_temp.works('athlete asks a fourth time', $s$ select pg_temp.ask_for_clearance('Knee', '32') $s$);
select pg_temp.as_member('11');
select pg_temp.works('coach endorses it', format('select public.endorse_clearance(%L)', pg_temp.injury('Knee')));
select pg_temp.fails('coach cannot send back once endorsed', format('select public.send_back_clearance(%L, %L)', pg_temp.injury('Knee'), 'Changed my mind'));
select pg_temp.as_member('14');
select pg_temp.fails('physio cannot send back once endorsed', format('select public.send_back_clearance(%L, %L)', pg_temp.injury('Knee'), 'Changed my mind'));
select pg_temp.as_member('22');
select pg_temp.works('committee sends back an endorsed clearance', format('select public.send_back_clearance(%L, %L)', pg_temp.injury('Knee'), 'Needs the club form'));
select pg_temp.ok('endorsement cleared on send-back', (select status = 'injured' and coach_endorsed_by is null and coach_endorsed_at is null from public.injuries where body_area = 'Knee'), true);
update public.injuries set status = 'cleared' where body_area = 'Knee';
select pg_temp.fails('a cleared injury cannot be sent back', format('select public.send_back_clearance(%L, %L)', pg_temp.injury('Knee'), 'Late'));

-- A child's clearance can't be sent back before a guardian gives health
-- consent (20261018000000_send_back_needs_consent.sql).
select pg_temp.works('guardian asks for clearance on the shoulder', $s$ select pg_temp.ask_for_clearance('Shoulder', '41') $s$);
select pg_temp.ok('guardian asked for the child''s clearance', pg_temp.status('Shoulder') = 'clearance_requested', true);
select pg_temp.as_member('11');
select pg_temp.fails('coach cannot send back without health consent', format('select public.send_back_clearance(%L, %L)', pg_temp.injury('Shoulder'), 'See the physio first'));
select pg_temp.as_member('14');
select pg_temp.fails('physio cannot send back without health consent', format('select public.send_back_clearance(%L, %L)', pg_temp.injury('Shoulder'), 'See the physio first'));
select pg_temp.as_member('22');
select pg_temp.fails('committee cannot send back without health consent', format('select public.send_back_clearance(%L, %L)', pg_temp.injury('Shoulder'), 'See the physio first'));
select pg_temp.ok('still waiting without consent', pg_temp.status('Shoulder') = 'clearance_requested', true);

-- Once a guardian has given health consent.
do $$ begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000041', false);
  perform public.set_child_consent('00000000-0000-0000-0000-000000000031', true, true);
end $$;
select pg_temp.as_member('31');
select pg_temp.fails('child cannot send back their own clearance', format('select public.send_back_clearance(%L, %L)', pg_temp.injury('Shoulder'), 'No'));
select pg_temp.as_member('41');
select pg_temp.fails('guardian cannot send back their child''s clearance', format('select public.send_back_clearance(%L, %L)', pg_temp.injury('Shoulder'), 'No'));
select pg_temp.as_member('11');
select pg_temp.works('coach sends back the child''s clearance', format('select public.send_back_clearance(%L, %L)', pg_temp.injury('Shoulder'), 'See the physio first'));
select pg_temp.ok('child''s injury is back to injured', pg_temp.status('Shoulder') = 'injured', true);

-- Who reads the injuries and their history.
set role authenticated;
select pg_temp.as_member('41');
select pg_temp.ok('guardian reads the child''s injuries only', (select count(*) = 2 and bool_and(athlete_id = pg_temp.m('31')) from public.injuries), true);
select pg_temp.as_member('13');
select pg_temp.ok('manager reads no injuries', (select count(*) = 0 from public.injuries) and (select count(*) = 0 from public.injury_updates), true);
select pg_temp.as_member('32');
select pg_temp.ok('adult athlete reads only their own injury', (select count(*) = 1 and bool_and(athlete_id = pg_temp.m('32')) from public.injuries), true);
reset role;
