-- One safeguarding post may back up the other in its escalation chain, but
-- not both ways (Matt, 24 November 2026: "not for each other as that's a
-- circular redundancy"). Replaces admin_set_escalation_chain from
-- 20261124800000 with that one extra refusal. Chains already saved are left
-- as they are; the next save of either one is checked.

begin;

create or replace function public.admin_set_escalation_chain(p_lead_post text, p_steps jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_step jsonb;
  v_pos integer := 0;
  v_post text;
  v_person uuid;
  v_wait integer;
  v_seen text[] := array[p_lead_post];
  v_node text;
  v_after_admins boolean := false;
begin
  if not public.is_admin() then
    raise exception 'Only admins can set escalation';
  end if;
  if p_lead_post not in ('child_safety_officer', 'complaints_manager') then
    raise exception 'Choose the Child Safety Officer''s or the Complaints Manager''s chain';
  end if;
  if p_steps is null or jsonb_typeof(p_steps) <> 'array' then
    raise exception 'Send the steps as a list';
  end if;
  if jsonb_array_length(p_steps) > 4 then
    raise exception 'A chain has at most 4 steps';
  end if;

  delete from public.escalation_steps where lead_post = p_lead_post;

  for v_step in select value from jsonb_array_elements(p_steps) loop
    v_pos := v_pos + 1;
    if v_after_admins then
      raise exception 'Admins are the last stop, so nothing can come after them';
    end if;
    v_post := nullif(v_step ->> 'post', '');
    v_person := nullif(v_step ->> 'person', '')::uuid;
    v_wait := coalesce((v_step ->> 'wait_days')::integer, 7);
    if (v_post is null) = (v_person is null) then
      raise exception 'Each step is a post or a person';
    end if;
    if v_wait not between 1 and 30 then
      raise exception 'Wait between 1 and 30 days before each step';
    end if;
    if v_post is not null and v_post not in ('child_safety_officer', 'complaints_manager', 'admins') then
      raise exception 'Choose the Child Safety Officer, the Complaints Manager or Admins';
    end if;
    if v_person is not null then
      if not public.can_be_safeguarding_contact(v_person) then
        raise exception 'Each person named must be an approved adult with a current Working With Children Check';
      end if;
      if public.holds_safeguarding_post(p_lead_post, v_person) then
        raise exception 'They already hold the post this chain starts from, so it would come back to them';
      end if;
    end if;
    v_node := coalesce(v_post, v_person::text);
    if v_node = any (v_seen) then
      raise exception 'A chain can''t come back to a post or person already in it';
    end if;
    v_seen := v_seen || v_node;
    -- One post may back up the other, but not both ways (Matt, 24 November
    -- 2026): that would be a circular redundancy.
    if v_post in ('child_safety_officer', 'complaints_manager') and exists (
      select 1 from public.escalation_steps o
      where o.lead_post = v_post and o.target_post = p_lead_post
    ) then
      raise exception '% already backs up the %, so it can''t be the other way round too',
        public.post_label(p_lead_post), public.post_label(v_post);
    end if;
    if v_post = 'admins' then
      v_after_admins := true;
    end if;
    insert into public.escalation_steps (lead_post, step_no, target_post, target_person, wait_days, added_by)
    values (p_lead_post, v_pos, v_post, v_person, v_wait, auth.uid());
  end loop;
end;
$$;

revoke execute on function public.admin_set_escalation_chain(text, jsonb) from public, anon;
grant execute on function public.admin_set_escalation_chain(text, jsonb) to authenticated;

commit;
