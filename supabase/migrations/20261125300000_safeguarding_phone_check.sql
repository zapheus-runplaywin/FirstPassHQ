-- The governing body's phone number on the Safeguarding screen must be a
-- phone number (Matt, 25 November 2026: "Safeguarding phone number entry
-- allows email addresses to be saved"). The app checks and spaces it as it's
-- typed (src/lib/phone.ts); this is the same rule in the database, so no app
-- version can save an email address or a note there.
--
-- Accepted: Australian mobiles (04, 05), landlines with an area code (02, 03,
-- 07, 08), 1800, 1300 and 13 numbers, in national or +61 form, and a number
-- from another country written with + and 8 to 15 digits.
--
-- Nothing already saved is changed or removed. The rule is checked when the
-- contacts are saved, not as a table constraint, so a number saved before it
-- (an email address, say) stays as it is and doesn't stop other settings on
-- the same row being saved. The Safeguarding screen flags such a number
-- until an admin fixes it.
--
-- Replaces admin_set_safeguarding_contacts (from
-- 20261121300000_several_safeguarding_contacts_and_about_people.sql) with the
-- same signature; only the phone check is new. The old admin_set_safeguarding
-- calls it, so older app versions get the check too.

begin;

-- Whether the text is a phone number the club can call. Mirrors isPhoneNumber
-- in src/lib/phone.ts.
create or replace function public.is_phone_number(p_text text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_text text := btrim(coalesce(p_text, ''));
  v_digits text;
  v_national text;
begin
  if v_text = '' or v_text !~ '^\+?[0-9 ().-]*$' then
    return false;
  end if;
  v_digits := regexp_replace(v_text, '[^0-9]', '', 'g');
  if left(v_text, 1) = '+' then
    if left(v_digits, 2) <> '61' then
      return char_length(v_digits) between 8 and 15 and left(v_digits, 1) <> '0';
    end if;
    -- "+61 (0)8 ..." keeps a 0 some people write after the country code.
    v_national := '0' || regexp_replace(substr(v_digits, 3), '^0', '');
  elsif char_length(v_digits) = 11 and left(v_digits, 2) = '61' then
    v_national := '0' || substr(v_digits, 3);
  else
    v_national := v_digits;
  end if;
  return v_national ~ '^0[45][0-9]{8}$'
    or v_national ~ '^0[2378][0-9]{8}$'
    or v_national ~ '^1[38]00[0-9]{6}$'
    or v_national ~ '^13[0-9]{4}$';
end;
$$;

revoke execute on function public.is_phone_number(text) from public, anon;
grant execute on function public.is_phone_number(text) to authenticated, service_role;

create or replace function public.admin_set_safeguarding_contacts(
  p_child_safety_officer_ids uuid[],
  p_complaints_manager_ids uuid[],
  p_governing_body_name text,
  p_governing_body_phone text,
  p_governing_body_url text,
  p_policy_url text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_officers uuid[] := array(select distinct x from unnest(coalesce(p_child_safety_officer_ids, '{}')) x where x is not null);
  v_managers uuid[] := array(select distinct x from unnest(coalesce(p_complaints_manager_ids, '{}')) x where x is not null);
  v_body_url text := nullif(trim(p_governing_body_url), '');
  v_policy_url text := nullif(trim(p_policy_url), '');
begin
  if not public.is_admin() then
    raise exception 'Only admins can change the safeguarding contacts';
  end if;
  if v_officers && v_managers then
    raise exception 'Nobody can be both a Child Safety Officer and a Complaints Manager, so a concern about one can go to another';
  end if;
  if auth.uid() = any (v_officers || v_managers) and cardinality(v_officers || v_managers) < 2 then
    raise exception 'Choose a second contact as well, so a concern about you has somewhere to go';
  end if;
  if v_body_url !~ '^https://' or v_policy_url !~ '^https://' then
    raise exception 'Links must start with https://';
  end if;
  if nullif(trim(p_governing_body_phone), '') is not null
    and not public.is_phone_number(p_governing_body_phone) then
    raise exception 'The governing body phone must be a phone number, such as 1800 123 456 or (08) 9123 4567';
  end if;

  perform public.replace_safeguarding_post('child_safety_officer', p_child_safety_officer_ids);
  perform public.replace_safeguarding_post('complaints_manager', p_complaints_manager_ids);

  update public.safeguarding_settings
  set governing_body_name = nullif(trim(p_governing_body_name), ''),
      governing_body_phone = nullif(trim(p_governing_body_phone), ''),
      governing_body_url = v_body_url,
      policy_url = v_policy_url,
      updated_by = auth.uid(),
      updated_at = now()
  where id;
end;
$$;

revoke execute on function public.admin_set_safeguarding_contacts(uuid[], uuid[], text, text, text, text) from public, anon;
grant execute on function public.admin_set_safeguarding_contacts(uuid[], uuid[], text, text, text, text) to authenticated;

commit;
