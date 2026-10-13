-- Affiliation returns: a club or association sends its governing body a
-- yearly summary of its affiliation records as a PDF.
--
-- The app builds the return on the phone from records admins can already see
-- and opens it to send by email. The database keeps:
-- - the email address returns go to;
-- - a log of each return an admin sent, with who sent it, when and where.
--
-- The return holds club facts and counts only. Nothing about a child is in it.
--
-- Additive only: a new nullable column, a new table and new functions. No rows
-- change.

begin;

alter table public.affiliation_settings
  add column if not exists return_email text check (length(return_email) <= 200);

create table if not exists public.affiliation_returns (
  id uuid primary key default gen_random_uuid(),
  season int,
  sent_to text not null check (length(sent_to) <= 200),
  sent_at timestamptz not null default now(),
  sent_by uuid references public.profiles (id) on delete set null
);

-- No policies: reached only through the functions below.
alter table public.affiliation_returns enable row level security;

-- ---------------------------------------------------------------------------
-- Where returns go, and when the last one went
-- ---------------------------------------------------------------------------

create or replace function public.admin_affiliation_return()
returns table (
  return_email text,
  last_sent_at timestamptz,
  last_sent_to text,
  last_sent_by_name text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can see affiliation returns';
  end if;
  return query
  select s.return_email, r.sent_at, r.sent_to,
         coalesce(nullif(p.preferred_name, ''), p.full_name, p.email)
  from public.affiliation_settings s
  left join lateral (
    select * from public.affiliation_returns
    order by sent_at desc
    limit 1
  ) r on true
  left join public.profiles p on p.id = r.sent_by
  where s.id;
end;
$$;

revoke execute on function public.admin_affiliation_return() from public, anon;
grant execute on function public.admin_affiliation_return() to authenticated;

create or replace function public.admin_set_affiliation_return_email(p_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := nullif(lower(trim(p_email)), '');
begin
  if not public.is_admin() then
    raise exception 'Only admins can change affiliation records';
  end if;
  if v_email is not null and (length(v_email) > 200 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    raise exception 'Enter an email address for returns, like affiliations@example.org.au';
  end if;
  update public.affiliation_settings
  set return_email = v_email,
      updated_at = now(),
      updated_by = auth.uid()
  where id;
end;
$$;

revoke execute on function public.admin_set_affiliation_return_email(text) from public, anon;
grant execute on function public.admin_set_affiliation_return_email(text) to authenticated;

-- Called when an admin sends a return, so the club can see when it last went.
create or replace function public.admin_log_affiliation_return(p_season int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
begin
  if not public.is_admin() then
    raise exception 'Only admins can send affiliation returns';
  end if;
  select return_email into v_email from public.affiliation_settings where id;
  if v_email is null then
    raise exception 'Add the email address returns go to first';
  end if;
  insert into public.affiliation_returns (season, sent_to, sent_by)
  values (p_season, v_email, auth.uid());
end;
$$;

revoke execute on function public.admin_log_affiliation_return(int) from public, anon;
grant execute on function public.admin_log_affiliation_return(int) to authenticated;

commit;
