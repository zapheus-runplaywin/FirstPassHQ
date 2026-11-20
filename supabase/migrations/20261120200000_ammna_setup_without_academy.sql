-- The AMMNA State Teams starting setup no longer includes Lightning Academy
-- (Matt, 2026-11-20). It now makes four squads: Mixed Open Squad, Open Squad,
-- 20 & Under Squad and 17 & Under Squad.
--
-- Only admin_apply_team_template changes, so only clubs that choose this
-- setup from now on are affected. Clubs that already chose it keep their
-- Lightning Academy squad (an admin can archive it), and no row is changed or
-- deleted here.

begin;

create or replace function public.admin_apply_team_template(p_template text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Australia/Perth')::date;
  v_season int := case
    when extract(month from v_today) >= 5 then extract(year from v_today)::int
    else extract(year from v_today)::int - 1
  end;
begin
  if not public.is_admin() then
    raise exception 'Only admins can choose a starting setup';
  end if;
  if p_template is null or p_template not in ('ammna_state_teams', 'wanl', 'blank') then
    raise exception 'Choose AMMNA State Teams, WA Netball League or Blank';
  end if;
  if exists (select 1 from public.teams where not archived) then
    raise exception 'Your club already has squads or teams. Add, rename or remove them instead.';
  end if;

  if p_template = 'ammna_state_teams' then
    insert into public.teams (name, kind, season, sort_order) values
      ('Mixed Open Squad', 'squad', v_season, 1),
      ('Open Squad', 'squad', v_season, 2),
      ('20 & Under Squad', 'squad', v_season, 3),
      ('17 & Under Squad', 'squad', v_season, 4);
    update public.club_settings
    set features = coalesce(features, '{}'::jsonb) - 'squads', updated_at = now()
    where id;
  elsif p_template = 'wanl' then
    insert into public.teams (name, kind, season, sort_order) values
      ('Mens Team', 'team', v_season, 1),
      ('Opens Team', 'team', v_season, 2),
      ('21 & Under Team', 'team', v_season, 3),
      ('Futures Team', 'team', v_season, 4);
    update public.club_settings
    set features = coalesce(features, '{}'::jsonb) || '{"squads": false}'::jsonb,
        updated_at = now()
    where id;
  end if;

  update public.club_settings set team_template = p_template where id;
end;
$$;

revoke execute on function public.admin_apply_team_template(text) from public, anon;
grant execute on function public.admin_apply_team_template(text) to authenticated;

commit;
