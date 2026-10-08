-- Fix "UPDATE requires a WHERE clause" when an admin saves Club settings.
--
-- Supabase turns on pg-safeupdate for app requests, which refuses any UPDATE
-- without a WHERE clause, even inside a function. club_settings holds one row
-- (id is always true), so the three admin functions that save it updated it
-- with no WHERE and every save failed. They now say "where id", which matches
-- that one row. Nothing else changes.
--
-- Additive only: three replaced functions. No rows change.

begin;

-- Same as before, with "where id".
create or replace function public.admin_set_join_password(p_password text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can set the club password';
  end if;
  update public.club_settings
  set join_password_hash = case
    when coalesce(trim(p_password), '') = '' then null
    else extensions.crypt(trim(p_password), extensions.gen_salt('bf'))
  end
  where id;
end;
$$;

-- Same as before, with "where id".
create or replace function public.admin_update_club_profile(
  p_club_name text,
  p_short_name text,
  p_background_colour text,
  p_text_colour text,
  p_hero_colour text,
  p_logo_path text,
  p_features jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
begin
  if not public.is_admin() then
    raise exception 'Only admins can change club settings';
  end if;
  if p_features is null or jsonb_typeof(p_features) <> 'object' then
    raise exception 'Features must be a list of on and off switches';
  end if;
  for v_key in select jsonb_object_keys(p_features) loop
    if jsonb_typeof(p_features -> v_key) <> 'boolean' then
      raise exception 'Feature % must be on or off', v_key;
    end if;
  end loop;
  if coalesce(trim(p_background_colour), '') !~ '^(#[0-9A-Fa-f]{6})?$'
     or coalesce(trim(p_text_colour), '') !~ '^(#[0-9A-Fa-f]{6})?$'
     or coalesce(trim(p_hero_colour), '') !~ '^(#[0-9A-Fa-f]{6})?$' then
    raise exception 'Colours must look like #FFCD00';
  end if;
  if p_logo_path is not null and p_logo_path <> '' and not exists (
    select 1 from storage.objects
    where bucket_id = 'club-branding' and name = p_logo_path
  ) then
    raise exception 'Upload the logo before saving';
  end if;

  update public.club_settings
  set club_name = nullif(trim(p_club_name), ''),
      short_name = nullif(trim(p_short_name), ''),
      background_colour = nullif(upper(trim(p_background_colour)), ''),
      text_colour = nullif(upper(trim(p_text_colour)), ''),
      hero_colour = nullif(upper(trim(p_hero_colour)), ''),
      logo_path = nullif(p_logo_path, ''),
      features = p_features,
      updated_at = now()
  where id;
end;
$$;

-- Same as before, with "where id".
create or replace function public.admin_set_physios_get_club_messages(p_on boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can change club settings';
  end if;
  update public.club_settings set physios_get_club_messages = coalesce(p_on, false) where id;
end;
$$;

commit;
