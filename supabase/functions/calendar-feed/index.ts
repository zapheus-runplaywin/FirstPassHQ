// The phone link for a club-wide calendar kept in the app. A phone's calendar
// app asks for
//   https://<project>.supabase.co/functions/v1/calendar-feed?t=<key>
// and gets the calendar's events as a calendar file, read only.
//
// Deployed WITHOUT JWT verification by .github/workflows/calendar-feed-function.yml
// (only when someone presses Run workflow): a calendar app has no member's
// sign-in, so the key in the link is the way in. An admin turns a link on for
// one calendar (Club tab > Calendars), can reset it or turn it off, and the
// database decides on every request whether the key still works
// (public.calendar_phone_feed, which only the service role may call). Until
// the function is deployed the links answer "not found" and nothing else in
// the app changes.
//
// It gives each event's name, time, place and whether it's cancelled: never a
// note, a person's name or a suggestion. It needs no secrets of its own.
//
// The logic is in feed.ts, which Jest tests; this file only talks to the
// database and serves requests.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleFeed, type Feed } from './feed.ts';

const url = Deno.env.get('SUPABASE_URL')!;

Deno.serve((request) =>
  handleFeed(request, {
    logger: console,
    async feed(token) {
      const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data, error } = await admin.rpc('calendar_phone_feed', { p_token: token });
      if (error) throw new Error(`calendar_phone_feed: ${error.code ?? 'failed'}`);
      return (data ?? null) as Feed | null;
    },
  }),
);
