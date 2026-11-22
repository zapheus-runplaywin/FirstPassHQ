-- Tests for 20261013000000_injury_documents.sql. Run on a fresh database with
-- the migrations and seed-members.sql loaded. Prints one line per check.
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
-- From 20261013010000_consents.sql on, coaches see a child's check-ins and
-- injury details only once a guardian consents, so give it here.
do $$ begin
  if to_regprocedure('public.set_child_consent(uuid, boolean, boolean)') is not null then
    perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000041', false);
    perform public.set_child_consent('00000000-0000-0000-0000-000000000031', true, true);
  end if;
end $$;
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

grant select, insert on storage.objects to authenticated;
-- Junior (31) has an ankle injury; Senior (32) gets one too.
insert into public.injuries (athlete_id, reported_by, body_area, description, injured_on, athlete_name)
values ('00000000-0000-0000-0000-000000000032', '00000000-0000-0000-0000-000000000032', 'Knee', 'Jarred knee', public.club_today() - 1, 'Kai Senior');
create temp table t as select
  (select id from public.injuries where athlete_id = '00000000-0000-0000-0000-000000000031') as junior,
  (select id from public.injuries where athlete_id = '00000000-0000-0000-0000-000000000032') as senior;
grant select on t to authenticated;
create or replace function pg_temp.jpath(f text) returns text language sql as
$$ select '00000000-0000-0000-0000-000000000031/' || (select junior from t) || '/' || f $$;
create or replace function pg_temp.spath(f text) returns text language sql as
$$ select '00000000-0000-0000-0000-000000000032/' || (select senior from t) || '/' || f $$;
create or replace function pg_temp.upload(p text, mime text) returns void language sql as
$$ insert into storage.objects (bucket_id, name, metadata) values ('injury-documents', p, jsonb_build_object('mimetype', mime)) $$;

-- What each member may attach.
select pg_temp.as_member('31');
select pg_temp.ok('under 18: PDF or a photo of the letter', (select public.injury_document_rule('00000000-0000-0000-0000-000000000031') = 'letter'), true);
select pg_temp.as_member('41');
select pg_temp.ok('guardian: letter only while injury photos are off', (select public.injury_document_rule('00000000-0000-0000-0000-000000000031') = 'letter'), true);
select pg_temp.as_member('32');
select pg_temp.ok('adult: photos allowed', (select public.injury_document_rule('00000000-0000-0000-0000-000000000032') = 'photos'), true);
select pg_temp.as_member('11');
select pg_temp.ok('coach has no rule (cannot report)', (select public.injury_document_rule('00000000-0000-0000-0000-000000000031') is null), true);

-- Uploads, through the storage policy.
set role authenticated;
select pg_temp.as_member('31');
select pg_temp.fails('under 18 cannot upload a photo without saying what it shows', format('select pg_temp.upload(%L, %L)', pg_temp.jpath('1-ankle.jpg'), 'image/jpeg'));
select pg_temp.fails('under 18 cannot declare a photo of the injury', format('select public.confirm_injury_photo(%L, %L)', pg_temp.jpath('1-ankle.jpg'), 'injury'));
select pg_temp.works('under 18 declares a photo of the letter', format('select public.confirm_injury_photo(%L, %L)', pg_temp.jpath('6-letter.jpg'), 'letter'));
select pg_temp.works('and uploads it', format('select pg_temp.upload(%L, %L)', pg_temp.jpath('6-letter.jpg'), 'image/jpeg'));
select pg_temp.works('under 18 can upload a PDF', format('select pg_temp.upload(%L, %L)', pg_temp.jpath('2-letter.pdf'), 'application/pdf'));
select pg_temp.works('photo renamed to .pdf gets into storage', format('select pg_temp.upload(%L, %L)', pg_temp.jpath('3-sneaky.pdf'), 'image/jpeg'));
select pg_temp.as_member('41');
select pg_temp.fails('guardian cannot upload a photo while off', format('select pg_temp.upload(%L, %L)', pg_temp.jpath('4-ankle.jpg'), 'image/jpeg'));
select pg_temp.fails('no injury photo consent while off', format('select public.confirm_injury_photo(%L, %L)', pg_temp.jpath('4-ankle.jpg'), 'injury'));
select pg_temp.fails('a photo must say what it shows', format('select public.confirm_injury_photo(%L, %L)', pg_temp.jpath('4-ankle.jpg'), 'selfie'));
select pg_temp.as_member('32');
select pg_temp.works('adult can upload a photo', format('select pg_temp.upload(%L, %L)', pg_temp.spath('1-knee.jpg'), 'image/jpeg'));
reset role;

-- But it can't be attached: the stored type is checked.
select pg_temp.as_member('31');
select pg_temp.fails('renamed photo cannot be attached',
  format('select public.add_injury_update(%L, %L, null, null, %L, %L)', (select junior from t), 'Physio said rest', pg_temp.jpath('3-sneaky.pdf'), 'sneaky.pdf'));
select pg_temp.works('declared photo of the letter can be attached',
  format('select public.add_injury_update(%L, %L, null, null, %L, %L)', (select junior from t), 'Physio letter', pg_temp.jpath('6-letter.jpg'), 'letter.jpg'));
select pg_temp.works('PDF can be attached',
  format('select public.add_injury_update(%L, %L, null, null, %L, %L)', (select junior from t), 'Physio said rest', pg_temp.jpath('2-letter.pdf'), 'letter.pdf'));

-- An admin allows photos.
select pg_temp.as_member('11');
select pg_temp.fails('only admins change the photo setting', 'select public.admin_set_minor_injury_photos(true)');
select pg_temp.as_member('01');
select pg_temp.works('admin allows photos', 'select public.admin_set_minor_injury_photos(true)');
select pg_temp.ok('setting reads back on', (select public.safeguarding_photo_setting()), true);

select pg_temp.as_member('31');
select pg_temp.ok('under 18 still letter only', (select public.injury_document_rule('00000000-0000-0000-0000-000000000031') = 'letter'), true);
select pg_temp.fails('under 18 cannot consent', format('select public.confirm_injury_photo(%L, %L)', pg_temp.jpath('5-ankle.jpg'), 'injury'));
select pg_temp.as_member('41');
select pg_temp.ok('verified guardian: photo with consent', (select public.injury_document_rule('00000000-0000-0000-0000-000000000031') = 'consent'), true);
reset role;
update public.profiles set verified_at = null where id = '00000000-0000-0000-0000-000000000041';
select pg_temp.ok('unverified guardian: letter only', (select public.injury_document_rule('00000000-0000-0000-0000-000000000031') = 'letter'), true);
update public.profiles set verified_at = now() where id = '00000000-0000-0000-0000-000000000041';

set role authenticated;
select pg_temp.fails('guardian photo without consent refused', format('select pg_temp.upload(%L, %L)', pg_temp.jpath('5-ankle.jpg'), 'image/jpeg'));
select pg_temp.works('guardian confirms consent', format('select public.confirm_injury_photo(%L, %L)', pg_temp.jpath('5-ankle.jpg'), 'injury'));
select pg_temp.works('guardian photo with consent uploads', format('select pg_temp.upload(%L, %L)', pg_temp.jpath('5-ankle.jpg'), 'image/jpeg'));
reset role;
select pg_temp.works('consented photo can be attached',
  format('select public.add_injury_update(%L, %L, null, null, %L, %L)', (select junior from t), 'Bruising photo', pg_temp.jpath('5-ankle.jpg'), 'ankle.jpg'));
select pg_temp.as_member('31');
select pg_temp.fails('athlete cannot reuse the guardian''s consent for another photo',
  format('select public.add_injury_update(%L, %L, null, null, %L, %L)', (select junior from t), 'x', pg_temp.jpath('3-sneaky.pdf'), 'x.pdf'));

-- Opening documents is recorded first.
set role authenticated;
select pg_temp.as_member('11');
select pg_temp.ok('coach cannot get the file before the open is recorded',
  (select count(*) = 0 from storage.objects where name = pg_temp.jpath('2-letter.pdf')), true);
select pg_temp.works('coach opens the letter', format('select public.open_injury_document(%L)', pg_temp.jpath('2-letter.pdf')));
select pg_temp.ok('coach can get the file once recorded',
  (select count(*) = 1 from storage.objects where name = pg_temp.jpath('2-letter.pdf')), true);
select pg_temp.ok('only that file', (select count(*) = 0 from storage.objects where name = pg_temp.jpath('5-ankle.jpg')), true);
select pg_temp.fails('coach cannot share', format('select public.open_injury_document(%L, true)', pg_temp.jpath('2-letter.pdf')));
-- Supabase grants the table, so row level security, with no policy, shows nothing.
select pg_temp.ok('no direct reading of the record', (select count(*) = 0 from public.injury_document_events), true);
select pg_temp.as_member('13');
select pg_temp.fails('manager cannot open injury documents', format('select public.open_injury_document(%L)', pg_temp.jpath('2-letter.pdf')));
select pg_temp.fails('missing file cannot be opened', format('select public.open_injury_document(%L)', pg_temp.jpath('9-none.pdf')));
reset role;
update public.injury_document_events set created_at = now() - interval '6 minutes'
where viewer_id = '00000000-0000-0000-0000-000000000011';
set role authenticated;
select pg_temp.as_member('11');
select pg_temp.ok('the link stops being handed out after 5 minutes',
  (select count(*) = 0 from storage.objects where name = pg_temp.jpath('2-letter.pdf')), true);
reset role;

-- Sharing is for whoever accepts the clearance, while it's waiting for them.
select pg_temp.as_member('01');
select pg_temp.fails('admin cannot share before endorsement', format('select public.open_injury_document(%L, true)', pg_temp.jpath('2-letter.pdf')));
select pg_temp.ok('can_share_injury false before endorsement', (select public.can_share_injury((select junior from t))), false);
select pg_temp.as_member('31');
select public.request_clearance((select junior from t), 'Ready', pg_temp.jpath('2-letter.pdf'), 'letter.pdf');
select pg_temp.as_member('11');
select public.endorse_clearance((select junior from t), 'Trained fully');
select pg_temp.fails('endorsing coach cannot share', format('select public.open_injury_document(%L, true)', pg_temp.jpath('2-letter.pdf')));
select pg_temp.as_member('42');
select pg_temp.fails('coach who is a guardian cannot share', format('select public.open_injury_document(%L, true)', pg_temp.jpath('2-letter.pdf')));
select pg_temp.as_member('01');
select pg_temp.ok('can_share_injury true for the accepting admin', (select public.can_share_injury((select junior from t))), true);
select pg_temp.works('accepting admin shares', format('select public.open_injury_document(%L, true)', pg_temp.jpath('2-letter.pdf')));
select public.accept_clearance((select junior from t), null);
select pg_temp.fails('no sharing after acceptance', format('select public.open_injury_document(%L, true)', pg_temp.jpath('2-letter.pdf')));
select pg_temp.works('viewing still works after acceptance', format('select public.open_injury_document(%L)', pg_temp.jpath('2-letter.pdf')));

-- Who sees the record.
select pg_temp.as_member('41');
select pg_temp.ok('guardian sees the coach''s view',
  (select count(*) = 1 from public.injury_document_log((select junior from t)) where viewer_name = 'Casey Coach' and viewer_role = 'Coach' and kind = 'viewed'), true);
select pg_temp.ok('guardian sees the admin''s share',
  (select count(*) = 1 from public.injury_document_log((select junior from t)) where viewer_name = 'Alex Admin' and viewer_role = 'Admin' and kind = 'shared'), true);
select pg_temp.ok('guardian sees the athlete''s letter declaration',
  (select count(*) = 1 from public.injury_document_log((select junior from t)) where viewer_name = 'Jordan Junior' and viewer_role = 'Athlete' and kind = 'letter_declared'), true);
select pg_temp.ok('guardian sees their own consent',
  (select count(*) = 1 from public.injury_document_log((select junior from t)) where viewer_name = 'Logan Parent' and kind = 'consented'), true);
select pg_temp.as_member('31');
select pg_temp.ok('athlete sees the record', (select count(*) >= 3 from public.injury_document_log((select junior from t))), true);
select pg_temp.as_member('01');
select pg_temp.ok('admin sees the record', (select count(*) >= 3 from public.injury_document_log((select junior from t))), true);
select pg_temp.as_member('11');
select pg_temp.fails('coach does not see the record', format('select * from public.injury_document_log(%L)', (select junior from t)));
select pg_temp.as_member('22');
select pg_temp.fails('committee does not see the record', format('select * from public.injury_document_log(%L)', (select junior from t)));
select pg_temp.as_member('32');
select pg_temp.fails('another athlete does not see the record', format('select * from public.injury_document_log(%L)', (select junior from t)));

-- Nothing about adults changed: their own photos work end to end.
select pg_temp.works('adult attaches their photo',
  format('select public.add_injury_update(%L, %L, null, null, %L, %L)', (select senior from t), 'Swelling', pg_temp.spath('1-knee.jpg'), 'knee.jpg'));
