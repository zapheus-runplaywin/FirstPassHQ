/**
 * What one session plan (src/app/session-plans/[id].tsx) shows each kind of
 * member once it's open.
 *
 * The author changes their own plan while they can work with children, and
 * admins change or delete any plan (`can_edit_session_plan` in the database,
 * and section 6 of the user guide). Anyone who can add plans can use one
 * again (`session_plan_summary`). Who a plan is shared with by name is for
 * the author and admins only. Which plans a member can open at all is the
 * database's call, so the tests seed what it would return.
 */
import { screen } from 'expo-router/testing-library';

import SessionPlanScreen from '@/app/session-plans/[id]';
import { supabase } from '@/lib/supabase';
import type { SessionPlan } from '@/lib/session-plans';
import type { MyVolunteerExemption } from '@/lib/types';

import {
  morePersonas,
  openScreen,
  personas,
  resetClub,
  setClubFeatures,
  TEAM,
  type Persona,
  type PersonaName,
} from './helpers/harness';

jest.mock('@/lib/club', () => jest.requireActual('./helpers/harness').clubModuleMock());
jest.mock('@/lib/club-choice', () => jest.requireActual('./helpers/harness').clubChoiceModuleMock());
jest.mock('@/constants/club', () => jest.requireActual('./helpers/harness').constantsClubMock());
jest.mock('@/lib/push', () => ({
  usePushNotifications: jest.fn(),
  useTodoNotifications: jest.fn(() => ({ on: true, permission: 'granted', save: jest.fn() })),
  openNotificationSettings: jest.fn(),
  unregisterForPush: jest.fn(async () => {}),
}));
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@/global.css', () => ({}));

type Who = PersonaName | Persona;

beforeEach(() => {
  resetClub();
  (supabase.rpc as jest.Mock).mockClear();
});

function plan(extra: Partial<SessionPlan> = {}): SessionPlan {
  return {
    id: 'plan-1',
    team_id: TEAM.id,
    team_name: TEAM.name,
    title: 'Tuesday skills',
    session_on: '2026-10-13',
    starts_at: '18:00:00',
    ends_at: '19:30:00',
    location: 'Main courts',
    notes: 'Warm up, then passing drills',
    run_by: null,
    share_team_coaches: true,
    share_athletes: false,
    author_id: 'coach',
    author_name: 'Sample coach',
    author_position: 'Head coach',
    copied_from: null,
    created_at: '2026-10-12T09:00:00Z',
    edited_at: null,
    edited_by_name: null,
    ...extra,
  };
}

const FILE = {
  id: 'f1',
  plan_id: 'plan-1',
  path: 'plan-1/drills.pdf',
  name: 'Drills.pdf',
  content_type: 'application/pdf',
  size_bytes: 1000,
  added_by_name: 'Sample coach',
  created_at: '2026-10-12T09:00:00Z',
};

async function openPlan(
  who: Who,
  shown: SessionPlan | null,
  { canAdd = false, shares = [] as { profile_id: string }[] } = {},
) {
  await openScreen(
    who,
    { 'session-plans/[id]': SessionPlanScreen },
    '/session-plans/plan-1',
    { session_plans: shown ? [shown] : [], session_plan_files: [FILE], session_plan_shares: shares },
    {
      rpcs: {
        session_plan_summary: [{ can_add: canAdd, shared: 0, new_shared: 0 }],
        session_plan_coaches: [{ profile_id: 'coach-2', full_name: 'Other Coach' }],
      },
    },
  );
}

const CONTROLS = ['Change this plan', 'Use again for another session', 'Delete this plan'] as const;

function shownControls() {
  return CONTROLS.filter((c) => screen.queryAllByText(c).length > 0);
}

describe('one session plan', () => {
  it('lets its author change it and use it again, but not delete it', async () => {
    await openPlan('coach', plan(), { canAdd: true });
    expect(shownControls()).toEqual(['Change this plan', 'Use again for another session']);
    expect(screen.getByText('Shared with the other coaches of Open A.')).toBeTruthy();
  });

  it('lets an admin change, use again and delete any plan', async () => {
    await openPlan('admin', plan(), { canAdd: true });
    expect(shownControls()).toEqual(CONTROLS);
  });

  it('shows the author and admins who it was shared with by name', async () => {
    await openPlan('admin', plan({ share_team_coaches: false }), {
      canAdd: true,
      shares: [{ profile_id: 'coach-2' }, { profile_id: 'gone' }],
    });
    expect(screen.getByText('Shared with Other Coach, A former coach.')).toBeTruthy();
  });

  it('tells the author when a plan isn’t shared with anyone', async () => {
    await openPlan('coach', plan({ share_team_coaches: false }), { canAdd: true });
    expect(screen.getByText('Not shared. Only you and the club’s admins can see it.')).toBeTruthy();
  });

  it.each<[string, Who]>([
    ['another coach it’s shared with', morePersonas.assistantCoach],
    ['coach who is also a guardian', morePersonas.coachGuardian],
  ])('lets a %s use it again, but not change it or see who else has it', async (_l, who) => {
    await openPlan(who, plan(), { canAdd: true });
    expect(shownControls()).toEqual(['Use again for another session']);
    expect(screen.queryByText(/^Shared with/)).toBeNull();
    expect(screen.queryByText(/^Not shared/)).toBeNull();
  });

  it.each<[string, Who]>([
    ['athlete', 'athlete'],
    ['under-18 athlete', morePersonas.under18Athlete],
    ['guardian', 'guardian'],
  ])('lets a %s it’s shared with read it and its files, and nothing more', async (_l, who) => {
    await openPlan(who, plan({ share_athletes: true }));
    expect(shownControls()).toEqual([]);
    expect(screen.getByText('Tuesday skills')).toBeTruthy();
    expect(screen.getByText('Warm up, then passing drills')).toBeTruthy();
    expect(screen.getByText(/Drills\.pdf$/)).toBeTruthy();
    expect(screen.queryByText(/^Shared with/)).toBeNull();
  });

  it('shows who added it, who ran it and when it last changed', async () => {
    await openPlan('athlete', plan({ run_by: 'Sample manager', edited_at: '2026-10-14T01:00:00Z', edited_by_name: 'Sample admin' }));
    expect(screen.getByText(/^Added by Sample coach \(head coach\), /)).toBeTruthy();
    expect(screen.getByText('Run by Sample manager')).toBeTruthy();
    expect(screen.getByText(/ by Sample admin$/)).toBeTruthy();
  });

  it.each<[string, Who]>([
    // The database no longer returns the author's own plan once their check
    // lapses or they're stood down, nor any plan to a stood-down admin.
    ['author whose check lapsed', 'coachExpiredCheck'],
    ['stood-down author', 'stoodDownCoach'],
    ['stood-down admin', 'stoodDownAdmin'],
    ['member it isn’t shared with', 'athlete'],
  ])('tells an %s it isn’t shared with them when the database doesn’t return it', async (_l, who) => {
    await openPlan(who, null);
    expect(screen.getByText('This plan isn’t shared with you, or it has been removed.')).toBeTruthy();
    expect(shownControls()).toEqual([]);
    expect((supabase.rpc as jest.Mock).mock.calls.map(([n]) => n)).not.toContain('mark_session_plan_seen');
  });

  // can_edit_session_plan: the author only while approved, not stood down,
  // and with a current check, or a volunteer exemption or lodged check
  // application in force.
  it.each<[string, Persona]>([
    ['whose check lapsed', personas.coachExpiredCheck],
    ['who is stood down', personas.stoodDownCoach],
  ])('doesn’t let an author %s change their plan, even if the screen gets it', async (_l, who) => {
    await openPlan(who, plan({ author_id: who.profile!.id }), { canAdd: false });
    expect(shownControls()).toEqual([]);
    expect(screen.queryByText(/^Shared with/)).toBeNull();
  });

  it('lets an author with a volunteer exemption in force change their plan', async () => {
    const coach = personas.coach;
    await openPlan(
      {
        ...coach,
        profile: { ...coach.profile!, wwcc_number: null, wwcc_expires_on: null },
        exemption: {
          basis: 'parent_volunteer',
          child_name: 'Sample Child',
          declared_at: '2026-10-01T00:00:00Z',
          declaration_text: 'I volunteer',
          valid: true,
          ends_on: null,
          starts_on: null,
        } as MyVolunteerExemption,
      },
      plan(),
      { canAdd: true },
    );
    expect(shownControls()).toEqual(['Change this plan', 'Use again for another session']);
  });

  it.each([
    ['in force', 'in_force', true],
    ['that lapsed', 'lapsed', false],
  ] as const)('with a lodged check application %s, the author can change their plan: %s', async (_l, status, valid) => {
    const coach = personas.coach;
    await openPlan(
      {
        ...coach,
        profile: { ...coach.profile!, wwcc_number: null, wwcc_expires_on: null },
        wwccApplication: {
          id: 'application-1',
          application_number: 'APL 1',
          lodged_on: '2026-10-01',
          kind: 'new',
          declaration_text: 'I applied',
          declared_at: '2026-10-02T00:00:00Z',
          lapses_on: '2026-12-30',
          status,
          valid,
        },
      },
      plan(),
      { canAdd: valid },
    );
    expect(shownControls()).toEqual(valid ? ['Change this plan', 'Use again for another session'] : []);
  });

  it('marks the plan seen when it opens', async () => {
    await openPlan('athlete', plan());
    expect((supabase.rpc as jest.Mock).mock.calls).toContainEqual([
      'mark_session_plan_seen',
      { p_plan_id: 'plan-1' },
    ]);
  });

  it('offers nobody Use again while the club has Session plans off', async () => {
    setClubFeatures({ sessionPlans: false });
    await openPlan('coach', plan(), { canAdd: true });
    expect(screen.queryByText('Use again for another session')).toBeNull();
  });
});
