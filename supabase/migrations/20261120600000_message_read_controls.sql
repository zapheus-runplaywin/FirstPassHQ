-- Read controls in the messages inbox (Matt, 20 November 2026).
--
--   * "Mark all read" clears every unread dot in the member's inbox at once.
--   * "Mark as unread" on an open message puts it back in the inbox as unread,
--     to come back to later.
--   * "Hide read" (in the app only) shows just the unread ones.
--
-- Read receipts stay honest for senders. `read_at` still means "this person
-- opened it", and only opening a message (or answering its question) sets it.
-- These controls change only the member's own inbox, through a new
-- `inbox_state` column that nobody else sees:
--
--   null      follow read_at: unread until the member opens it
--   'read'    the member marked it read without opening it ("Mark all read")
--   'unread'  the member opened it, then marked it unread
--
-- So "Mark all read" doesn't tell a coach their message was read, and "Mark as
-- unread" doesn't take back a receipt the coach has already seen. Opening a
-- message clears `inbox_state` again.
--
-- Additive only: a new nullable column, a generated column and new or replaced
-- functions. No existing rows change.

begin;

alter table public.message_recipients
  add column if not exists inbox_state text;

alter table public.message_recipients drop constraint if exists message_recipients_inbox_state_check;
alter table public.message_recipients add constraint message_recipients_inbox_state_check
  check (inbox_state is null or inbox_state in ('read', 'unread'));

-- Whether the message shows as unread in the member's own inbox.
alter table public.message_recipients
  add column if not exists unread boolean
  generated always as (coalesce(inbox_state = 'unread', read_at is null)) stored;

create index if not exists message_recipients_unread_idx
  on public.message_recipients (profile_id)
  where unread;

-- Opening a message: the first open time is kept for the sender's receipt, and
-- the message leaves the member's unread list. Does nothing for its sender or
-- anyone it didn't go to.
create or replace function public.mark_message_read(p_message_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.message_recipients
  set read_at = coalesce(read_at, now()),
      inbox_state = null
  where message_id = p_message_id
    and profile_id = auth.uid()
    and (read_at is null or inbox_state is not null);
$$;

revoke execute on function public.mark_message_read(uuid) from public, anon;
grant execute on function public.mark_message_read(uuid) to authenticated;

-- "Mark as unread": puts one of the member's own messages back as unread. The
-- sender's receipt is left alone.
create or replace function public.mark_message_unread(p_message_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.message_recipients
  set inbox_state = 'unread'
  where message_id = p_message_id
    and profile_id = auth.uid()
    and inbox_state is distinct from 'unread';
$$;

revoke execute on function public.mark_message_unread(uuid) from public, anon;
grant execute on function public.mark_message_unread(uuid) to authenticated;

-- "Mark all read": clears every unread message in the member's own inbox and
-- says how many. Senders' receipts are left alone: these weren't opened.
create or replace function public.mark_all_messages_read()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  if auth.uid() is null then
    return 0;
  end if;
  update public.message_recipients
  set inbox_state = 'read'
  where profile_id = auth.uid()
    and unread;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

revoke execute on function public.mark_all_messages_read() from public, anon;
grant execute on function public.mark_all_messages_read() to authenticated;

commit;
