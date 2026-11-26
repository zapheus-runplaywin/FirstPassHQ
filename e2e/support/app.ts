// Opens the web build as one sample member, with the fake Supabase backend.
import type { Page } from '@playwright/test';

import { eq, FakeSupabase, startDevice, type FakeRequest, type Handler } from './fake-supabase';
import { TODAY, type SampleProfile } from './people';

type Membership = { team_role: string; coach_title: string | null; selection: string | null; team: object };

export type AppOptions = {
  /** Signed in as this member; signed out when left out. */
  me?: SampleProfile | null;
  /** The club code picked on this device; THUNDER unless set, null for none. */
  club?: string | null;
  /** The member's squads and teams, for `team_members`. */
  memberships?: Membership[];
  /** This season's squads and teams, for `teams`. */
  teams?: object[];
  /** Answers for this test's screens; return undefined to fall back to the defaults below. */
  handle?: Handler;
  path?: string;
};

/**
 * Pins today's date, starts the device with the club picked (and the member
 * signed in), answers Supabase from the handler and opens the path.
 */
export async function openApp(page: Page, options: AppOptions = {}) {
  const { me = null, memberships = [], teams = [], handle, path = '/' } = options;
  const backend = new FakeSupabase((req: FakeRequest) => {
    const answer = handle?.(req);
    if (answer !== undefined) return answer;
    if (req.table === '/auth/v1/user' && me) return { id: me.id, email: me.email, aud: 'authenticated' };
    // The signed-in member's own profile (AuthProvider).
    if (req.table === 'profiles' && me && req.single && eq(req.params, 'id') === me.id) return me;
    if (req.table === 'team_members' && me && eq(req.params, 'profile_id') === me.id) return memberships;
    if (req.table === 'teams') return teams;
    if (req.table === 'rpc/is_club_captain' || req.table === 'rpc/is_safeguarding_officer') return false;
    if (req.table === 'rpc/committee_checks_from' || req.table === 'rpc/my_volunteer_exemption') return null;
    return undefined;
  });
  await page.clock.setFixedTime(TODAY);
  await backend.install(page.context());
  await startDevice(page.context(), { club: options.club, member: me });
  await page.goto(path);
  return backend;
}

/** The tabs in the bar at the bottom of the screen, left to right. */
export type Tab = 'Today' | 'Calendar' | 'Messages' | 'Team' | 'Family' | 'Club' | 'Me';

const TAB_PATHS: Record<Tab, string> = {
  Today: '/',
  Calendar: '/calendar',
  Messages: '/messages',
  Team: '/team',
  Family: '/family',
  Club: '/club',
  Me: '/me',
};

/** A tab's button in the bar. */
export function tab(page: Page, name: Tab) {
  return page.locator(`a[role="tab"][href="${TAB_PATHS[name]}"]`);
}

/** Taps a tab in the bar, as a member does to move between Today, their hub and Me. */
export async function openTab(page: Page, name: Tab) {
  await tab(page, name).click();
}

/** The tabs on a member's page for admins (src/components/member-tabs.tsx). */
export type MemberTab = 'Overview' | 'Roles' | 'Checks' | 'Family' | 'History';

/** A tab on a member's page: not the bar at the bottom, which has its own Family. */
export function memberTab(page: Page, name: MemberTab) {
  return page.getByTestId('member-header').filter({ visible: true }).getByRole('tab', { name, exact: true });
}
