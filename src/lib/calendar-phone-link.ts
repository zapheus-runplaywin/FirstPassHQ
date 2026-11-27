/**
 * The phone link of a club-wide calendar kept in the app: the address a
 * phone's calendar app subscribes to. The club's own project serves it
 * (supabase/functions/calendar-feed), and the key is the way in.
 */
export function phoneLinkUrl(supabaseUrl: string, token: string) {
  return `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/calendar-feed?t=${encodeURIComponent(token)}`;
}
