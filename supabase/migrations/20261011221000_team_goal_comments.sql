-- Comments on team goals.
--
-- Everyone in the team (its athletes, coaches and managers) can comment on
-- the team goals for its games, before or after the game, so every member
-- has a say in them. Parents and guardians read the comments but don't
-- write them. A member can remove their own comment, and the team's coaches
-- can remove any comment on their team's goals.
--
-- Additive only: one new table, its policy and three new functions.

begin;

create table if not exists public.team_game_goal_comments (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.team_game_goals (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  author_name text not null,
  -- The author's part in the team when they wrote it: coach, manager or athlete.
  author_role text not null check (author_role in ('coach', 'manager', 'athlete')),
  body text not null check (length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists team_game_goal_comments_goal_idx
  on public.team_game_goal_comments (goal_id);

alter table public.team_game_goal_comments enable row level security;

-- The same people who see the team goals see their comments.
drop policy if exists "Members of the team see team goal comments" on public.team_game_goal_comments;
create policy "Members of the team see team goal comments"
  on public.team_game_goal_comments for select to authenticated
  using (
    exists (
      select 1 from public.team_game_goals g
      where g.id = goal_id and public.can_view_team_goals(g.fixture_id)
    )
  );

-- The signed-in member's part in the current squad or team a game is for
-- (coach, manager or athlete), or null if they aren't in it.
create or replace function public.fixture_team_role(p_fixture_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.team_role::text
  from public.fixtures f
  join public.teams t on t.id = f.team_id
  join public.team_members m on m.team_id = t.id and m.profile_id = auth.uid()
  where f.id = p_fixture_id
    and not t.archived
    and public.is_approved()
  order by case m.team_role when 'coach' then 1 when 'manager' then 2 else 3 end
  limit 1;
$$;

-- A member of the team comments on one of its team goals.
create or replace function public.add_team_game_goal_comment(p_goal_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_goal public.team_game_goals;
  v_role text;
  v_id uuid;
begin
  select * into v_goal from public.team_game_goals where id = p_goal_id;
  if v_goal.id is null then
    raise exception 'That goal has been removed';
  end if;
  v_role := public.fixture_team_role(v_goal.fixture_id);
  if v_role is null then
    raise exception 'Only members of the team can comment on its goals';
  end if;
  if coalesce(btrim(p_body), '') = '' then
    raise exception 'Write a comment first';
  end if;
  if length(btrim(p_body)) > 1000 then
    raise exception 'Keep a comment under 1000 characters';
  end if;

  insert into public.team_game_goal_comments (goal_id, author_id, author_name, author_role, body)
  values (v_goal.id, auth.uid(), public.my_display_name(), v_role, btrim(p_body))
  returning id into v_id;
  return v_id;
end;
$$;

-- The author removes their own comment, or a coach of the team removes any.
create or replace function public.delete_team_game_goal_comment(p_comment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_comment public.team_game_goal_comments;
  v_fixture_id uuid;
begin
  select * into v_comment from public.team_game_goal_comments where id = p_comment_id for update;
  if v_comment.id is null then
    return;
  end if;
  select fixture_id into v_fixture_id from public.team_game_goals where id = v_comment.goal_id;
  if not (
    (v_comment.author_id = auth.uid() and public.is_approved())
    or public.coaches_fixture_team(v_fixture_id)
  ) then
    raise exception 'Only the person who wrote it or the team’s coaches can remove a comment';
  end if;
  delete from public.team_game_goal_comments where id = v_comment.id;
end;
$$;

revoke execute on function public.fixture_team_role(uuid) from public, anon;
revoke execute on function public.add_team_game_goal_comment(uuid, text) from public, anon;
revoke execute on function public.delete_team_game_goal_comment(uuid) from public, anon;
grant execute on function public.fixture_team_role(uuid) to authenticated;
grant execute on function public.add_team_game_goal_comment(uuid, text) to authenticated;
grant execute on function public.delete_team_game_goal_comment(uuid) to authenticated;

commit;
