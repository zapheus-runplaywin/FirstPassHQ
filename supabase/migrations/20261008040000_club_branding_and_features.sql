-- Club branding and features, so the app can be set up for any club.
--
-- Matt (2026-10-08): other clubs should be able to use the app. Admins set
-- the club's name, colours (background, text and hero colour) and logo, and
-- turn features on and off, from Administration > Club settings.
--
-- Additive only: new nullable columns on the single club_settings row, a
-- public storage bucket for the logo and new functions. Every new value
-- starts empty, which means "use the app's built-in default", so West Coast
-- Thunder looks exactly as before until an admin changes something.

begin;

alter table public.club_settings
  add column if not exists club_name text
    check (club_name is null or length(trim(club_name)) between 1 and 60),
  -- A short name, such as "Thunder": used to find the club's teams in PlayHQ
  -- fixtures and to name exported files.
  add column if not exists short_name text
    check (short_name is null or length(trim(short_name)) between 1 and 20),
  add column if not exists background_colour text
    check (background_colour is null or background_colour ~ '^#[0-9A-F]{6}$'),
  add column if not exists text_colour text
    check (text_colour is null or text_colour ~ '^#[0-9A-F]{6}$'),
  add column if not exists hero_colour text
    check (hero_colour is null or hero_colour ~ '^#[0-9A-F]{6}$'),
  -- A file in the club-branding bucket. Empty means the logo built into the app.
  add column if not exists logo_path text,
  -- Features an admin has turned off, as {"injuries": false}. A feature that
  -- isn't listed is on, so features added later start on.
  add column if not exists features jsonb not null default '{}'::jsonb
    check (jsonb_typeof(features) = 'object'),
  add column if not exists updated_at timestamptz;

-- ---------------------------------------------------------------------------
-- Reading and changing the settings
-- ---------------------------------------------------------------------------

-- Everything a signed-in member's app needs to look like the club. The join
-- password hash is never returned.
create or replace function public.club_profile()
returns table (
  club_name text,
  short_name text,
  background_colour text,
  text_colour text,
  hero_colour text,
  logo_path text,
  features jsonb,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.club_name, s.short_name, s.background_colour, s.text_colour, s.hero_colour,
         s.logo_path, s.features, s.updated_at
  from public.club_settings s;
$$;

revoke execute on function public.club_profile() from public, anon;
grant execute on function public.club_profile() to authenticated;

-- Saves the club's name, colours, logo and features. Empty values go back to
-- the app's defaults. Only admins can call it.
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
      updated_at = now();
end;
$$;

revoke execute on function public.admin_update_club_profile(text, text, text, text, text, text, jsonb)
  from public, anon;
grant execute on function public.admin_update_club_profile(text, text, text, text, text, text, jsonb)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Logo files
-- ---------------------------------------------------------------------------

-- Public, so the logo loads without a signed link, including on the sign-in
-- screen. It only ever holds the club's logo. Admins upload; nobody else can.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('club-branding', 'club-branding', true, 2097152, array['image/png', 'image/jpeg'])
on conflict (id) do nothing;

drop policy if exists "Admins upload club branding" on storage.objects;
create policy "Admins upload club branding"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'club-branding' and public.is_admin());

commit;
