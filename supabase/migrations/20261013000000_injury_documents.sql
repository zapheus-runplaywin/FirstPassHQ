-- Photos of children's injuries, who can share documents, and a record of
-- every time a document is opened (child-safety audit finding 4).
--
-- Until now a 15-year-old could upload a photo of a bruised thigh, every
-- coach, physio, committee member and admin who sees their injuries could
-- open it, any committee member could share it to their own OneDrive or
-- email, and nobody knew who had looked. Netball Australia's image rules ask
-- for a parent's written consent, use inside the club only, and nothing kept
-- on personal devices.
--
-- Now:
-- - For athletes under 18, proof is a PDF (a letter or report) unless an admin
--   allows photos under Safeguarding. Even then, only a verified guardian can
--   upload a photo of their child, and they confirm their consent first; the
--   consent is kept with the photo.
-- - Share is only for the committee member or admin who can accept that
--   clearance, while it's waiting for them.
-- - Every view and share is recorded (who, their role, when, which document)
--   and shown to the athlete, their guardians and admins. A document can only
--   be opened after the open is recorded, so nothing gets past the record.
--
-- Documents already uploaded stay as they are. Nothing is deleted.
--
-- Additive only: a new column with a default, new tables and functions, and
-- replaced functions.

begin;

-- ---------------------------------------------------------------------------
-- The club's choice about photos of under 18s
-- ---------------------------------------------------------------------------

alter table public.safeguarding_settings
  add column if not exists minor_injury_photos boolean not null default false;

create or replace function public.minor_injury_photos_allowed()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select minor_injury_photos from public.safeguarding_settings where id), false);
$$;

revoke execute on function public.minor_injury_photos_allowed() from public, anon, authenticated;

create or replace function public.admin_set_minor_injury_photos(p_allowed boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can change safeguarding settings';
  end if;
  if p_allowed is null then
    raise exception 'Choose whether photos are allowed';
  end if;
  update public.safeguarding_settings
  set minor_injury_photos = p_allowed, updated_by = auth.uid(), updated_at = now()
  where id;
end;
$$;

revoke execute on function public.admin_set_minor_injury_photos(boolean) from public, anon;
grant execute on function public.admin_set_minor_injury_photos(boolean) to authenticated;

-- Whether the club allows photos of under 18s, for the Safeguarding screen.
create or replace function public.safeguarding_photo_setting()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.minor_injury_photos_allowed() where auth.uid() is not null;
$$;

revoke execute on function public.safeguarding_photo_setting() from public, anon;
grant execute on function public.safeguarding_photo_setting() to authenticated;

-- ---------------------------------------------------------------------------
-- What the signed-in member can attach for an athlete
-- ---------------------------------------------------------------------------

create or replace function public.is_image_document(p_name text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select lower(coalesce(p_name, '')) !~ '\.pdf$';
$$;

revoke execute on function public.is_image_document(text) from public, anon, authenticated;

create or replace function public.athlete_is_minor(p_athlete_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select public.is_minor(p.date_of_birth, p.under_17) from public.profiles p where p.id = p_athlete_id),
    false
  );
$$;

revoke execute on function public.athlete_is_minor(uuid) from public, anon, authenticated;

-- A guardian whose identity the club has checked.
create or replace function public.is_verified_guardian_of(p_athlete_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_guardian_of(p_athlete_id)
    and exists (select 1 from public.profiles where id = auth.uid() and verified_at is not null);
$$;

revoke execute on function public.is_verified_guardian_of(uuid) from public, anon, authenticated;

-- 'photos' (adults: a PDF or a photo), 'consent' (a verified guardian may add
-- a photo of their child after confirming consent) or 'pdf' (PDF only).
create or replace function public.injury_document_rule(p_athlete_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not public.athlete_is_minor(p_athlete_id) then 'photos'
    when public.minor_injury_photos_allowed() and public.is_verified_guardian_of(p_athlete_id)
      then 'consent'
    else 'pdf'
  end
  where public.can_report_for(p_athlete_id);
$$;

revoke execute on function public.injury_document_rule(uuid) from public, anon;
grant execute on function public.injury_document_rule(uuid) to authenticated;

-- A guardian's consent for one photo of their child, kept with the photo.
create table if not exists public.injury_photo_consents (
  id uuid primary key default gen_random_uuid(),
  injury_id uuid not null references public.injuries (id) on delete cascade,
  document_path text not null unique check (length(document_path) <= 500),
  guardian_id uuid references public.profiles (id) on delete set null,
  guardian_name text,
  created_at timestamptz not null default now()
);

-- No policies: only reached through the functions below.
alter table public.injury_photo_consents enable row level security;

-- Called by a verified guardian just before uploading a photo of their child.
create or replace function public.confirm_injury_photo_consent(p_path text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_injury public.injuries := public.injury_document_injury(p_path);
begin
  if v_injury.id is null or v_injury.status = 'cleared' then
    raise exception 'That injury isn’t open for documents';
  end if;
  if public.injury_document_rule(v_injury.athlete_id) is distinct from 'consent' then
    raise exception 'Attach the letter or report as a PDF, not a photo of the injury';
  end if;
  insert into public.injury_photo_consents (injury_id, document_path, guardian_id, guardian_name)
  values (v_injury.id, p_path, auth.uid(), public.my_display_name())
  on conflict (document_path) do nothing;
end;
$$;

revoke execute on function public.confirm_injury_photo_consent(text) from public, anon;
grant execute on function public.confirm_injury_photo_consent(text) to authenticated;

-- Whether a file may be added for this athlete: adults any allowed type;
-- under 18s a PDF, or a photo the uploading guardian consented to.
create or replace function public.injury_document_allowed(p_athlete_id uuid, p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not public.is_image_document(p_name)
    or not public.athlete_is_minor(p_athlete_id)
    or (
      public.injury_document_rule(p_athlete_id) = 'consent'
      and exists (
        select 1 from public.injury_photo_consents c
        where c.document_path = p_name and c.guardian_id = auth.uid()
      )
    );
$$;

revoke execute on function public.injury_document_allowed(uuid, text) from public, anon, authenticated;

-- As before, plus the photo rule.
create or replace function public.can_upload_injury_document(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_injury public.injuries := public.injury_document_injury(p_name);
begin
  return v_injury.id is not null
    and v_injury.status <> 'cleared'
    and public.can_report_for(v_injury.athlete_id)
    and public.injury_document_allowed(v_injury.athlete_id, p_name);
end;
$$;

-- As before, plus the photo rule checked again against the stored file's
-- type, so a photo renamed to .pdf can't be attached for an under 18.
create or replace function public.check_injury_document(p_injury public.injuries, p_path text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_type text;
begin
  if p_path is null then
    return;
  end if;
  select o.metadata ->> 'mimetype' into v_type
  from storage.objects o
  where o.bucket_id = 'injury-documents' and o.name = p_path;
  if not (p_path like p_injury.athlete_id::text || '/' || p_injury.id::text || '/%')
    or not found then
    raise exception 'That document wasn’t uploaded. Try attaching it again.';
  end if;
  if not public.injury_document_allowed(p_injury.athlete_id, p_path)
    or (
      v_type is not null and v_type <> 'application/pdf'
      and public.athlete_is_minor(p_injury.athlete_id)
      and not exists (
        select 1 from public.injury_photo_consents c
        where c.document_path = p_path and c.guardian_id = auth.uid()
      )
    ) then
    raise exception 'Attach the letter or report as a PDF, not a photo of the injury';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Who opened and shared each document
-- ---------------------------------------------------------------------------

create table if not exists public.injury_document_events (
  id uuid primary key default gen_random_uuid(),
  injury_id uuid not null references public.injuries (id) on delete cascade,
  document_path text not null,
  viewer_id uuid references public.profiles (id) on delete set null,
  viewer_name text,
  viewer_role text,
  kind text not null check (kind in ('viewed', 'shared')),
  created_at timestamptz not null default now()
);

create index if not exists injury_document_events_injury
  on public.injury_document_events (injury_id, created_at);
create index if not exists injury_document_events_viewer
  on public.injury_document_events (viewer_id, document_path, created_at);

-- No policies: written and read only through the functions below.
alter table public.injury_document_events enable row level security;

-- How the signed-in member is connected to the athlete, for the record.
create or replace function public.injury_viewer_role(p_athlete_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_athlete_id = auth.uid() then 'Athlete'
    when public.is_guardian_of(p_athlete_id) then 'Parent or guardian'
    when public.coaches_athlete(p_athlete_id) then 'Coach'
    when public.physio_looks_after(p_athlete_id) then 'Physio'
    when public.is_admin() then 'Admin'
    when public.is_committee() then 'Committee'
    else 'Member'
  end;
$$;

revoke execute on function public.injury_viewer_role(uuid) from public, anon, authenticated;

-- Whether the signed-in member can share this injury's documents: only the
-- committee member or admin who can accept its clearance, while it's waiting
-- for them. The same rules as accept_clearance.
create or replace function public.can_share_injury_documents(p_injury public.injuries)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_committee()
    and p_injury.status = 'coach_endorsed'
    and p_injury.coach_endorsed_by is distinct from auth.uid()
    and p_injury.athlete_id <> auth.uid()
    and not public.is_guardian_of(p_injury.athlete_id);
$$;

revoke execute on function public.can_share_injury_documents(public.injuries)
  from public, anon, authenticated;

-- Records that the signed-in member is opening (or sharing) a document. The
-- app calls it before asking for the file's short-lived link, and storage
-- only hands out that link once this is recorded.
create or replace function public.open_injury_document(p_path text, p_share boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_injury public.injuries := public.injury_document_injury(p_path);
begin
  if v_injury.id is null
    or not public.can_view_athlete_injuries(v_injury.athlete_id)
    or not exists (
      select 1 from storage.objects
      where bucket_id = 'injury-documents' and name = p_path
    ) then
    raise exception 'That document couldn’t be opened';
  end if;
  if coalesce(p_share, false) and not public.can_share_injury_documents(v_injury) then
    raise exception 'Only the committee member accepting this clearance can share its documents';
  end if;
  insert into public.injury_document_events (
    injury_id, document_path, viewer_id, viewer_name, viewer_role, kind
  )
  values (
    v_injury.id, p_path, auth.uid(), public.my_display_name(),
    public.injury_viewer_role(v_injury.athlete_id),
    case when coalesce(p_share, false) then 'shared' else 'viewed' end
  );
end;
$$;

revoke execute on function public.open_injury_document(text, boolean) from public, anon;
grant execute on function public.open_injury_document(text, boolean) to authenticated;

-- As before, and only for a few minutes after the open was recorded.
create or replace function public.can_view_injury_document(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_injury public.injuries := public.injury_document_injury(p_name);
begin
  return v_injury.id is not null
    and public.can_view_athlete_injuries(v_injury.athlete_id)
    and exists (
      select 1 from public.injury_document_events e
      where e.viewer_id = auth.uid() and e.document_path = p_name
        and e.created_at > now() - interval '5 minutes'
    );
end;
$$;

-- Whether the signed-in member sees who opened an athlete's documents: the
-- athlete, their guardians and admins.
create or replace function public.can_see_injury_document_log(p_athlete_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_approved()
    and (p_athlete_id = auth.uid() or public.is_guardian_of(p_athlete_id) or public.is_admin());
$$;

revoke execute on function public.can_see_injury_document_log(uuid) from public, anon, authenticated;

-- Everyone who opened or shared one injury's documents, oldest first, with
-- the photo consents given. Null (rather than an empty list) when the
-- signed-in member doesn't see the record.
create or replace function public.injury_document_log(p_injury_id uuid)
returns table (
  document_path text,
  viewer_name text,
  viewer_role text,
  kind text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_athlete uuid;
begin
  select athlete_id into v_athlete from public.injuries where id = p_injury_id;
  if v_athlete is null or not public.can_see_injury_document_log(v_athlete) then
    raise exception 'Only the athlete, their guardians and admins see who opened documents';
  end if;
  return query
    select e.document_path, e.viewer_name, e.viewer_role, e.kind, e.created_at
    from public.injury_document_events e
    where e.injury_id = p_injury_id
    union all
    select c.document_path, c.guardian_name, 'Parent or guardian', 'consented', c.created_at
    from public.injury_photo_consents c
    where c.injury_id = p_injury_id
    order by 5;
end;
$$;

revoke execute on function public.injury_document_log(uuid) from public, anon;
grant execute on function public.injury_document_log(uuid) to authenticated;

-- Whether the signed-in member can share this injury's documents, for the
-- injury screen.
create or replace function public.can_share_injury(p_injury_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select public.can_share_injury_documents(i) from public.injuries i where i.id = p_injury_id),
    false
  );
$$;

revoke execute on function public.can_share_injury(uuid) from public, anon;
grant execute on function public.can_share_injury(uuid) to authenticated;

commit;
