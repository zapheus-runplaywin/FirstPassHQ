-- Personal tasks (migration 20261015210000): only the member who wrote a task
-- sees or changes it; nobody else, admins and guardians included.
-- Run after the migrations and seed-members.sql. Raises on any failure.
set role authenticated;

-- An athlete under 18 adds two tasks.
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000031';
insert into public.personal_tasks (title, due_on) values ('Pack my bib', current_date + 1);
insert into public.personal_tasks (title) values ('Stretch before bed');
do $$ begin
  if (select count(*) from public.personal_tasks) <> 2 then raise exception 'owner should see 2 tasks'; end if;
end $$;
-- Ticks one off and edits the other.
update public.personal_tasks set done_at = now() where title = 'Pack my bib';
update public.personal_tasks set title = 'Stretch for 10 minutes' where title = 'Stretch before bed';
do $$ begin
  if (select count(*) from public.personal_tasks where done_at is null) <> 1 then raise exception 'tick off failed'; end if;
end $$;

-- Admin, guardian and coach see nothing and change nothing.
do $$
declare who text; n int;
begin
  foreach who in array array['00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000011'] loop
    perform set_config('request.jwt.claim.sub', who, true);
    if (select count(*) from public.personal_tasks) <> 0 then raise exception '% can read another member''s tasks', who; end if;
    update public.personal_tasks set title = 'hacked';
    get diagnostics n = row_count;
    if n <> 0 then raise exception '% updated another member''s task', who; end if;
    delete from public.personal_tasks;
    get diagnostics n = row_count;
    if n <> 0 then raise exception '% deleted another member''s task', who; end if;
  end loop;
end $$;

-- Nobody can add a task for someone else.
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
do $$ begin
  begin
    insert into public.personal_tasks (profile_id, title) values ('00000000-0000-0000-0000-000000000031', 'Planted');
    raise exception 'admin added a task for an athlete';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Or move their own task onto someone else.
do $$ begin
  insert into public.personal_tasks (title) values ('Mine');
  begin
    update public.personal_tasks set profile_id = '00000000-0000-0000-0000-000000000031' where title = 'Mine';
    raise exception 'task moved to another member';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Blank titles are refused.
do $$ begin
  begin
    insert into public.personal_tasks (title) values ('   ');
    raise exception 'blank title accepted';
  exception when check_violation then null;
  end;
end $$;

-- At most 100 tasks still to do.
do $$ begin
  insert into public.personal_tasks (title) select 'Task ' || g from generate_series(1, 99) g;
  begin
    insert into public.personal_tasks (title) values ('One too many');
    raise exception 'limit not enforced';
  exception when raise_exception then
    if sqlerrm not like 'You have 100 tasks%' then raise; end if;
  end;
  -- Ticking one off makes room.
  update public.personal_tasks set done_at = now() where title = 'Task 1';
  insert into public.personal_tasks (title) values ('Now it fits');
end $$;

-- Signed-out visitors can't touch the table.
reset role;
set role anon;
do $$ begin
  begin
    perform 1 from public.personal_tasks;
    raise exception 'anon can read personal tasks';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- The owner can delete their own task.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000031';
delete from public.personal_tasks where title = 'Pack my bib';
do $$ begin
  if (select count(*) from public.personal_tasks) <> 1 then raise exception 'delete failed'; end if;
end $$;
reset role;

-- Deleting a member removes their tasks with them.
delete from auth.users where id = '00000000-0000-0000-0000-000000000031';
do $$ begin
  if exists (select 1 from public.personal_tasks where profile_id = '00000000-0000-0000-0000-000000000031') then
    raise exception 'tasks outlived their member';
  end if;
end $$;

select 'personal tasks: all checks passed' as result;
