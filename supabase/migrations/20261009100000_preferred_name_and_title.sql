-- Preferred names and committee titles.
--
-- Members can say what they like to be called, so the home screen greets
-- them by it ("Hi Jono"). Committee members and admins can also have a title,
-- like President or Secretary, shown with their role. Members set both from
-- Your details; admins can set a committee member's or admin's title from
-- their member page.
--
-- Two new empty columns. Nothing here changes or removes existing rows.

begin;

alter table public.profiles
  add column if not exists preferred_name text,
  add column if not exists title text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_preferred_name_length'
  ) then
    alter table public.profiles
      add constraint profiles_preferred_name_length
      check (preferred_name is null or char_length(preferred_name) between 1 and 40);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_title_length') then
    alter table public.profiles
      add constraint profiles_title_length
      check (title is null or char_length(title) between 1 and 40);
  end if;
end;
$$;

-- Only committee members and admins hold a title.
create or replace function public.can_hold_title(p_role public.app_role)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_role in ('committee', 'admin');
$$;
revoke execute on function public.can_hold_title(public.app_role) from public, anon;
grant execute on function public.can_hold_title(public.app_role) to authenticated;

-- The signed-in member's own preferred name, and their title when they are
-- an approved committee member or admin. Blank clears either.
create or replace function public.save_my_details(
  p_preferred_name text,
  p_title text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_preferred_name text := nullif(trim(coalesce(p_preferred_name, '')), '');
  v_title text := nullif(trim(coalesce(p_title, '')), '');
begin
  select * into v_profile from public.profiles where id = auth.uid();
  if not found then
    raise exception 'Sign in first';
  end if;
  if char_length(v_preferred_name) > 40 then
    raise exception 'Keep your preferred name to 40 characters';
  end if;
  if char_length(v_title) > 40 then
    raise exception 'Keep your title to 40 characters';
  end if;

  if v_profile.status = 'approved' and public.can_hold_title(v_profile.role) then
    update public.profiles
    set preferred_name = v_preferred_name, title = v_title
    where id = auth.uid();
  else
    if v_title is not null then
      raise exception 'Only committee members and admins have a title';
    end if;
    update public.profiles set preferred_name = v_preferred_name where id = auth.uid();
  end if;
end;
$$;
revoke execute on function public.save_my_details(text, text) from public, anon;
grant execute on function public.save_my_details(text, text) to authenticated;

-- An admin sets a committee member's or admin's title. Blank clears it.
create or replace function public.admin_set_member_title(p_profile_id uuid, p_title text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.app_role;
  v_title text := nullif(trim(coalesce(p_title, '')), '');
begin
  if not public.is_admin() then
    raise exception 'Only admins can change members';
  end if;
  select role into v_role from public.profiles where id = p_profile_id;
  if not found then
    raise exception 'Member not found';
  end if;
  if char_length(v_title) > 40 then
    raise exception 'Keep the title to 40 characters';
  end if;
  if v_title is not null and not public.can_hold_title(v_role) then
    raise exception 'Only committee members and admins have a title';
  end if;
  update public.profiles set title = v_title where id = p_profile_id;
end;
$$;
revoke execute on function public.admin_set_member_title(uuid, text) from public, anon;
grant execute on function public.admin_set_member_title(uuid, text) to authenticated;

commit;
