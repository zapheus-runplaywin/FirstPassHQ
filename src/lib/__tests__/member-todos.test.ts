/**
 * Which members each home screen to-do about members is about
 * (src/lib/member-todos.ts), so a tap on the to-do opens those people, and
 * straight at the action when there is only one. Each rule is checked both
 * ways: the member it is about, and the nearest member it isn't.
 */
import {
  isMemberTodoKind,
  memberMatchesTodo,
  memberPageHref,
  memberTodoCopy,
  memberTodoDone,
  memberTodoHref,
  memberTodoKinds,
  type MemberTodoContext,
  type MemberTodoKind,
} from '@/lib/member-todos';
import type { Profile, VolunteerExemption, WwccApplication } from '@/lib/types';

// Today is Sunday 18 October 2026, local time.
const TODAY = '2026-10-18';
beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date(2026, 9, 18, 12));
});
afterEach(() => {
  jest.useRealTimers();
});

function profile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'p1',
    email: 'sam@example.com',
    full_name: 'Sam Sample',
    preferred_name: null,
    title: null,
    head_physio: false,
    playhq_email: null,
    role: 'athlete',
    extra_roles: [],
    status: 'approved',
    requested_role: null,
    requested_team_id: null,
    join_requested_at: null,
    under_17: false,
    date_of_birth: '1990-01-01',
    declared_date_of_birth: null,
    guardian_email: null,
    wwcc_number: null,
    wwcc_expires_on: null,
    wwcc_exempt_reason: null,
    wwcc_exempted_by: null,
    wwcc_exempted_at: null,
    rejection_reason: null,
    verified_at: null,
    stood_down_at: null,
    ...overrides,
  };
}

/** A card that is current, validated and registered. */
const goodCard: Partial<Profile> = {
  wwcc_number: '123456A',
  wwcc_expires_on: '2029-01-01',
  wwcc_validated_at: '2026-06-01T00:00:00Z',
  wwcc_unit_linked_at: '2026-06-01T00:00:00Z',
};

type Exemption = NonNullable<MemberTodoContext['exemption']>;
const exemption = (overrides: Partial<VolunteerExemption> = {}): Exemption => ({
  basis: 'parent_volunteer',
  valid: true,
  declared_at: '2026-09-01T00:00:00Z',
  ends_on: null,
  ended_at: null,
  ...overrides,
});

type Application = NonNullable<MemberTodoContext['application']>;
const application = (overrides: Partial<WwccApplication> = {}): Application => ({
  status: 'in_force',
  check_due_on: '2026-11-30',
  ended_at: null,
  ...overrides,
});

function matches(kind: MemberTodoKind, member: Profile, context: Partial<MemberTodoContext> = {}) {
  return memberMatchesTodo(kind, member, { hasVerifiedGuardian: false, today: TODAY, ...context });
}

describe('member to-do links', () => {
  it('opens the to-do’s people from the home screen, and a member’s page at the action', () => {
    expect(memberTodoHref('join')).toEqual({ pathname: '/admin', params: { todo: 'join' } });
    expect(memberPageHref('m1', 'wwcc')).toEqual({
      pathname: '/admin/[id]',
      params: { id: 'm1', todo: 'wwcc' },
    });
  });

  it('knows its own kinds and nothing else', () => {
    for (const kind of memberTodoKinds) expect(isMemberTodoKind(kind)).toBe(true);
    for (const other of ['', 'Join', 'concerns', undefined, null, 3, ['join']]) {
      expect(isMemberTodoKind(other)).toBe(false);
    }
  });

  it('says for every kind what to do, where on the page, and what “all done” means', () => {
    for (const kind of memberTodoKinds) {
      const copy = memberTodoCopy[kind];
      // Short enough to fit a phone's title bar.
      expect(copy.heading.length).toBeGreaterThan(0);
      expect(copy.heading.length).toBeLessThanOrEqual(27);
      expect(copy.action).toMatch(/\.$/);
      expect(copy.empty).toMatch(/\.$/);
    }
    expect(memberTodoCopy.join.section).toBe('approve');
    expect(memberTodoCopy.locked.section).toBe('guardians');
    expect(memberTodoCopy['turning-18'].section).toBe('guardians');
    expect(memberTodoCopy.dob.section).toBe('date-of-birth');
    expect(memberTodoCopy.wwcc.section).toBe('wwcc');
    expect(memberTodoCopy['wwcc-application'].section).toBe('wwcc');
    expect(memberTodoCopy['exemption-ending'].section).toBe('wwcc');
    expect(memberTodoCopy.notice.section).toBe('notices');
    expect(memberTodoCopy.inactive.section).toBe('delete');
    expect(memberTodoCopy.unendorsable.section).toBe('physio');
  });
});

describe('memberMatchesTodo', () => {
  describe('join requests', () => {
    it('is about someone who asked to join and is waiting', () => {
      expect(matches('join', profile({ status: 'pending', join_requested_at: '2026-10-10T00:00:00Z' }))).toBe(true);
    });
    it('is not about someone who only signed in, or was already approved or turned down', () => {
      expect(matches('join', profile({ status: 'pending', join_requested_at: null }))).toBe(false);
      expect(matches('join', profile({ status: 'approved', join_requested_at: '2026-10-10T00:00:00Z' }))).toBe(false);
      expect(matches('join', profile({ status: 'rejected', join_requested_at: '2026-10-10T00:00:00Z' }))).toBe(false);
    });
  });

  describe('children locked out', () => {
    const child = profile({ date_of_birth: '2012-02-02' });
    it('is about an approved athlete under 18 with no verified parent or guardian', () => {
      expect(matches('locked', child)).toBe(true);
      expect(matches('locked', profile({ date_of_birth: null, under_17: true }))).toBe(true);
    });
    it('is not about a child with one, an adult, a parent, or a child not yet approved', () => {
      expect(matches('locked', child, { hasVerifiedGuardian: true })).toBe(false);
      expect(matches('locked', profile())).toBe(false);
      expect(matches('locked', profile({ role: 'guardian', date_of_birth: '2012-02-02' }))).toBe(false);
      expect(matches('locked', { ...child, status: 'pending' })).toBe(false);
    });
  });

  describe('no date of birth', () => {
    it('is about an approved athlete without one, as a main or extra role', () => {
      expect(matches('dob', profile({ date_of_birth: null }))).toBe(true);
      expect(matches('dob', profile({ role: 'coach', extra_roles: ['athlete'], date_of_birth: null }))).toBe(true);
    });
    it('is not about an athlete with one, someone else without one, or a request', () => {
      expect(matches('dob', profile())).toBe(false);
      expect(matches('dob', profile({ role: 'guardian', date_of_birth: null }))).toBe(false);
      expect(matches('dob', profile({ status: 'pending', date_of_birth: null }))).toBe(false);
    });
  });

  describe('turning 18', () => {
    it('is about an athlete under 18 whose 18th birthday is within 30 days', () => {
      expect(matches('turning-18', profile({ date_of_birth: '2008-11-17' }))).toBe(true);
      expect(matches('turning-18', profile({ date_of_birth: '2008-10-19' }))).toBe(true);
    });
    it('is not about one further off, one already 18, or no date of birth', () => {
      expect(matches('turning-18', profile({ date_of_birth: '2008-11-18' }))).toBe(false);
      expect(matches('turning-18', profile({ date_of_birth: '2008-10-18' }))).toBe(false);
      expect(matches('turning-18', profile({ date_of_birth: null, under_17: true }))).toBe(false);
      expect(matches('turning-18', profile({ role: 'guardian', date_of_birth: '2008-11-01' }))).toBe(false);
    });
  });

  describe('no team or role for 2 years', () => {
    it('follows what the database says, for approved members only', () => {
      expect(matches('inactive', profile(), { inactive: true })).toBe(true);
      expect(matches('inactive', profile(), { inactive: false })).toBe(false);
      expect(matches('inactive', profile({ status: 'rejected' }), { inactive: true })).toBe(false);
    });
  });

  describe('Screening Unit notices', () => {
    it('is about whoever has a barring notice not yet reported, whatever their status now', () => {
      expect(matches('notice', profile({ role: 'coach' }), { noticeToReport: true })).toBe(true);
      expect(matches('notice', profile({ status: 'rejected' }), { noticeToReport: true })).toBe(true);
      expect(matches('notice', profile({ role: 'coach' }), { noticeToReport: false })).toBe(false);
      expect(matches('notice', profile({ role: 'coach' }))).toBe(false);
    });
  });

  describe('clearances nobody can endorse', () => {
    it('lists the club’s approved physios, who can be made Head Physio or placed', () => {
      expect(matches('unendorsable', profile({ role: 'physio' }))).toBe(true);
      expect(matches('unendorsable', profile({ role: 'coach', extra_roles: ['physio'] }))).toBe(true);
      expect(matches('unendorsable', profile({ role: 'coach' }))).toBe(false);
      expect(matches('unendorsable', profile({ role: 'physio', status: 'pending' }))).toBe(false);
    });
  });

  describe('check applications', () => {
    const coach = profile({ role: 'coach' });
    it('is about an application due to be confirmed, or lapsed', () => {
      expect(matches('wwcc-application', coach, { application: application({ check_due_on: TODAY }) })).toBe(true);
      expect(matches('wwcc-application', coach, { application: application({ status: 'lapsed' }) })).toBe(true);
    });
    it('is not about one not due yet, ended, waiting for the declaration, or none', () => {
      expect(matches('wwcc-application', coach, { application: application({ check_due_on: '2026-10-19' }) })).toBe(false);
      expect(
        matches('wwcc-application', coach, {
          application: application({ status: 'lapsed', ended_at: '2026-10-01T00:00:00Z' }),
        }),
      ).toBe(false);
      expect(
        matches('wwcc-application', coach, {
          application: application({ status: 'waiting_for_declaration', check_due_on: TODAY }),
        }),
      ).toBe(false);
      expect(matches('wwcc-application', coach)).toBe(false);
    });
  });

  describe('Working With Children Checks', () => {
    it('is about someone who needs a check and has none, an expired one or one without an expiry', () => {
      expect(matches('wwcc', profile({ role: 'coach' }))).toBe(true);
      expect(matches('wwcc', profile({ role: 'manager', ...goodCard, wwcc_expires_on: '2026-10-17' }))).toBe(true);
      expect(matches('wwcc', profile({ role: 'physio', ...goodCard, wwcc_expires_on: null }))).toBe(true);
      expect(matches('wwcc', profile({ role: 'committee' }))).toBe(true);
    });

    it('is about a current card expiring within 60 days, not validated in a year, or not registered', () => {
      expect(matches('wwcc', profile({ role: 'coach', ...goodCard, wwcc_expires_on: '2026-12-01' }))).toBe(true);
      expect(matches('wwcc', profile({ role: 'coach', ...goodCard, wwcc_validated_at: null }))).toBe(true);
      expect(
        matches('wwcc', profile({ role: 'coach', ...goodCard, wwcc_validated_at: '2025-10-01T00:00:00Z' })),
      ).toBe(true);
      expect(matches('wwcc', profile({ role: 'coach', ...goodCard, wwcc_unit_linked_at: null }))).toBe(true);
    });

    it('is not about a good card, someone who needs none, or an exempt committee member', () => {
      expect(matches('wwcc', profile({ role: 'coach', ...goodCard }))).toBe(false);
      expect(matches('wwcc', profile())).toBe(false);
      expect(matches('wwcc', profile({ role: 'committee', wwcc_exempt_reason: 'Treasurer only' }))).toBe(false);
      expect(matches('wwcc', profile({ role: 'coach', status: 'pending' }))).toBe(false);
    });

    it('is not about someone covered by a volunteer exemption or an application in force', () => {
      const coach = profile({ role: 'coach' });
      expect(matches('wwcc', coach, { exemption: exemption() })).toBe(false);
      expect(matches('wwcc', coach, { application: application() })).toBe(false);
      // An exemption that no longer applies, or has ended, or a lapsed application, doesn't cover them.
      expect(matches('wwcc', coach, { exemption: exemption({ valid: false }) })).toBe(true);
      expect(matches('wwcc', coach, { exemption: exemption({ declared_at: null }) })).toBe(true);
      expect(matches('wwcc', coach, { exemption: exemption({ ended_at: '2026-10-01T00:00:00Z' }) })).toBe(true);
      expect(matches('wwcc', coach, { application: application({ status: 'lapsed' }) })).toBe(true);
      expect(
        matches('wwcc', coach, { application: application({ ended_at: '2026-10-01T00:00:00Z' }) }),
      ).toBe(true);
    });

    it('leaves a temporary helper alone outside their days, and a card that lasts past their last day', () => {
      const helper = { role: 'volunteer' as const, volunteer_from: '2026-10-10', volunteer_until: '2026-10-25' };
      expect(matches('wwcc', profile(helper))).toBe(true);
      expect(matches('wwcc', profile({ ...helper, volunteer_from: '2026-11-01', volunteer_until: '2026-11-02' }))).toBe(false);
      expect(matches('wwcc', profile({ ...helper, volunteer_until: '2026-10-17' }))).toBe(false);
      expect(matches('wwcc', profile({ ...helper, ...goodCard, wwcc_expires_on: '2026-11-01' }))).toBe(false);
      expect(matches('wwcc', profile({ ...helper, ...goodCard, wwcc_expires_on: '2026-10-20' }))).toBe(true);
    });
  });

  describe('volunteer exemptions ending', () => {
    const manager = profile({ role: 'manager' });
    it('is about an exemption that applies and ends within 60 days, with no current card', () => {
      expect(matches('exemption-ending', manager, { exemption: exemption({ ends_on: '2026-12-01' }) })).toBe(true);
      expect(
        matches('exemption-ending', manager, {
          exemption: exemption({ basis: 'under_18_volunteer', ends_on: '2026-10-20' }),
        }),
      ).toBe(true);
    });
    it('is not about one ending later, with no end, no longer applying, dated, or with a card', () => {
      expect(matches('exemption-ending', manager, { exemption: exemption({ ends_on: '2026-12-17' }) })).toBe(false);
      expect(matches('exemption-ending', manager, { exemption: exemption() })).toBe(false);
      expect(
        matches('exemption-ending', manager, { exemption: exemption({ declared_at: null, ends_on: '2026-12-01' }) }),
      ).toBe(false);
      expect(
        matches('exemption-ending', manager, { exemption: exemption({ valid: false, ends_on: '2026-12-01' }) }),
      ).toBe(false);
      expect(
        matches('exemption-ending', manager, {
          exemption: exemption({ basis: 'short_term_visitor', ends_on: '2026-10-25' }),
        }),
      ).toBe(false);
      expect(
        matches('exemption-ending', profile({ role: 'manager', ...goodCard }), {
          exemption: exemption({ ends_on: '2026-12-01' }),
        }),
      ).toBe(false);
      expect(matches('exemption-ending', manager)).toBe(false);
    });
    it('is not about a helper whose exemption lasts past their last day', () => {
      const helper = profile({ role: 'volunteer', volunteer_from: '2026-10-10', volunteer_until: '2026-10-25' });
      expect(matches('exemption-ending', helper, { exemption: exemption({ ends_on: '2026-10-30' }) })).toBe(false);
      expect(matches('exemption-ending', helper, { exemption: exemption({ ends_on: '2026-10-20' }) })).toBe(true);
    });
  });
});

describe('memberTodoDone', () => {
  const none = { hasVerifiedGuardian: false };
  it('says a join request was already answered', () => {
    expect(memberTodoDone('join', profile({ status: 'approved' }), none)).toBe(
      'Already approved. Nothing left to do here.',
    );
    expect(memberTodoDone('join', profile({ status: 'rejected' }), none)).toBe(
      'Already not approved. Nothing left to do here.',
    );
    expect(memberTodoDone('join', profile({ status: 'pending' }), none)).toBe(
      'They haven’t asked to join yet.',
    );
    expect(
      memberTodoDone('join', profile({ status: 'pending', join_requested_at: '2026-10-10T00:00:00Z' }), none),
    ).toBeNull();
  });

  it('says a date of birth was already added', () => {
    expect(memberTodoDone('dob', profile(), none)).toBe('Their date of birth is already added.');
    expect(memberTodoDone('dob', profile({ date_of_birth: null }), none)).toBeNull();
  });

  it('says a child was already unlocked', () => {
    const child = profile({ date_of_birth: '2012-02-02' });
    expect(memberTodoDone('locked', child, { hasVerifiedGuardian: true })).toBe(
      'Already unlocked: a verified parent or guardian is linked.',
    );
    expect(memberTodoDone('locked', child, none)).toBeNull();
    // A child not approved yet isn't unlocked by anyone.
    expect(memberTodoDone('locked', { ...child, status: 'pending' }, { hasVerifiedGuardian: true })).toBeNull();
  });

  it('leaves the rest to the page itself', () => {
    for (const kind of ['wwcc', 'wwcc-application', 'notice', 'exemption-ending', 'turning-18', 'inactive', 'unendorsable'] as const) {
      expect(memberTodoDone(kind, profile({ role: 'coach', ...goodCard }), none)).toBeNull();
    }
  });
});
