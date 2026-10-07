-- A colour per calendar. Empty means the default for who it's for: yellow for
-- the club, pink for the committee, blue for a squad and green for a team.
-- Keep the list in step with src/constants/calendar-colors.ts.

alter table public.calendars
  add column color text
    check (color in (
      'yellow', 'blue', 'green', 'pink', 'orange', 'violet', 'light_blue', 'dark_blue'
    ));
