import { phoneLinkUrl } from '@/lib/calendar-phone-link';

describe('phoneLinkUrl', () => {
  it('is the club’s own project, the calendar-feed function and the key', () => {
    expect(phoneLinkUrl('https://abc.supabase.co', 'ab12')).toBe('https://abc.supabase.co/functions/v1/calendar-feed?t=ab12');
  });

  it('copes with a trailing slash on the club’s address', () => {
    expect(phoneLinkUrl('https://abc.supabase.co//', 'ab12')).toBe('https://abc.supabase.co/functions/v1/calendar-feed?t=ab12');
  });

  it('keeps an odd key from breaking the address', () => {
    expect(phoneLinkUrl('https://abc.supabase.co', 'a&b=c')).toBe('https://abc.supabase.co/functions/v1/calendar-feed?t=a%26b%3Dc');
  });
});
