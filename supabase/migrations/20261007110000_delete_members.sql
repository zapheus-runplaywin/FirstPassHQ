-- Deleting members: admins can delete another member, and anyone can delete
-- their own account.
--
-- Deleting the sign-in (auth.users) row removes the profile and everything
-- that cascades from it: squad and team places, guardian links, push tokens,
-- verification codes and message receipts. Messages they sent stay, with the
-- sender's name as it was. If they sign in again later they start as a new
-- member and have to ask to join again.
--
-- Additive only: two new functions. Nothing is deleted when this migration runs.

create function public.delete_member_now(p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles where id = p_profile_id) then
    raise exception 'Member not found';
  end if;
  -- The club always keeps at least one admin.
  if exists (
    select 1 from public.profiles
    where id = p_profile_id and role = 'admin' and status = 'approved'
  ) and not exists (
    select 1 from public.profiles
    where id <> p_profile_id and role = 'admin' and status = 'approved'
  ) then
    raise exception 'This is the club’s only admin. Make someone else an admin first.';
  end if;

  delete from auth.users where id = p_profile_id;
  -- In case the sign-in was already gone.
  delete from public.profiles where id = p_profile_id;
end;
$$;

-- Only callable through the two functions below.
revoke execute on function public.delete_member_now(uuid) from public, anon, authenticated;

create function public.admin_delete_member(p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can delete members';
  end if;
  if p_profile_id = auth.uid() then
    raise exception 'Delete your own account from the home screen instead';
  end if;
  perform public.delete_member_now(p_profile_id);
end;
$$;

revoke execute on function public.admin_delete_member(uuid) from public, anon;
grant execute on function public.admin_delete_member(uuid) to authenticated;

create function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  perform public.delete_member_now(auth.uid());
end;
$$;

revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
