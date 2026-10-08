-- Removes the Partner role.
--
-- Matt (2026-10-08): "Lets remove the partner role. I don't think that it is
-- a good idea." Members who were Partners become Guests, which see the same
-- things (the club calendar and messages to the whole club). Members who asked
-- to join as a Partner are asked about as Guests.
--
-- Postgres can't take a value out of an enum without rebuilding the type, so
-- 'partner' stays in app_role for old rows (messages already sent to all
-- partners, awards that listed partners as voters). A trigger stops anyone
-- being given the role again.
--
-- Data: each member's Partner role (or Partner join request) is copied to
-- public.former_partner_roles before it changes to Guest, so nothing is lost
-- and the change can be undone from that table. These two updates are why this
-- migration needs Matt's data-loss-approved label.

begin;

create table if not exists public.former_partner_roles (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  was_partner boolean not null,
  requested_partner boolean not null,
  changed_at timestamptz not null default now()
);

alter table public.former_partner_roles enable row level security;
-- No policies: only the database owner reads it, to undo the change if needed.
revoke all on public.former_partner_roles from public, anon, authenticated;

insert into public.former_partner_roles (profile_id, was_partner, requested_partner)
select id, role = 'partner', requested_role is not distinct from 'partner'
from public.profiles
where role = 'partner' or requested_role = 'partner'
on conflict (profile_id) do nothing;

update public.profiles set role = 'guest' where role = 'partner';
update public.profiles set requested_role = 'guest' where requested_role = 'partner';

-- Nobody can be given the Partner role, or ask for it, from now on.
create or replace function public.reject_partner_role()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.role = 'partner' or new.requested_role = 'partner' then
    raise exception 'The Partner role has been removed. Use Guest instead.';
  end if;
  return new;
end;
$$;

revoke execute on function public.reject_partner_role() from public, anon, authenticated;

create or replace trigger reject_partner_role
  before insert or update of role, requested_role on public.profiles
  for each row execute function public.reject_partner_role();

commit;
