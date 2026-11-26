/**
 * A member's page for admins, in tabs (src/lib/member-tabs.ts): which tabs a
 * member has, the tab each to-do opens, the line above the tabs, and what
 * Overview lists as needing attention. Each rule is checked both ways.
 */
import {
  issueTab,
  memberAttention,
  memberLead,
  memberTabLabels,
  memberTabs,
  pausedNotice,
  shownTabs,
  tabForSection,
  tabToShow,
  type MemberAttentionInput,
  type MemberTab,
} from '@/lib/member-tabs';
import { memberTodoCopy, memberTodoKinds, type MemberSection } from '@/lib/member-todos';
import { safetyIssues } from '@/lib/safety';
import type { AppRole, Profile } from '@/lib/types';

// Today is Sunday 18 October 2026, local time.
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
    verified_at: '2026-01-01T00:00:00Z',
    stood_down_at: null,
    ...overrides,
  } as Profile;
}

/** A card that is current, validated and registered. */
const goodCard: Partial<Profile> = {
  wwcc_number: '123456A',
  wwcc_expires_on: '2029-01-01',
  wwcc_validated_at: '2026-06-01T00:00:00Z',
  wwcc_unit_linked_at: '2026-06-01T00:00:00Z',
};

describe('the tabs', () => {
  it('are Overview, Roles, Checks, Family and History, in that order', () => {
    expect(memberTabs.map((t) => memberTabLabels[t])).toEqual([
      'Overview',
      'Roles',
      'Checks',
      'Family',
      'History',
    ]);
  });

  it('always include Overview and Roles', () => {
    expect(shownTabs({ checks: false, family: false, history: false })).toEqual(['overview', 'roles']);
  });

  it.each<[string, { checks: boolean; family: boolean; history: boolean }, MemberTab[]]>([
    ['checks only', { checks: true, family: false, history: false }, ['overview', 'roles', 'checks']],
    ['family only', { checks: false, family: true, history: false }, ['overview', 'roles', 'family']],
    ['history only', { checks: false, family: false, history: true }, ['overview', 'roles', 'history']],
    [
      'everything',
      { checks: true, family: true, history: true },
      ['overview', 'roles', 'checks', 'family', 'history'],
    ],
  ])('offer a tab only when it holds something: %s', (_label, has, tabs) => {
    expect(shownTabs(has)).toEqual(tabs);
  });

  it('show the tab asked for when the member has it, and Overview when they don’t', () => {
    expect(tabToShow('family', ['overview', 'roles', 'family'])).toBe('family');
    expect(tabToShow('family', ['overview', 'roles', 'checks'])).toBe('overview');
    expect(tabToShow('overview', ['overview', 'roles'])).toBe('overview');
  });
});

describe('the tab a to-do opens', () => {
  it.each<[MemberSection, MemberTab]>([
    ['approve', 'overview'],
    ['delete', 'overview'],
    ['physio', 'roles'],
    ['date-of-birth', 'checks'],
    ['wwcc', 'checks'],
    ['notices', 'checks'],
    ['guardians', 'family'],
  ])('%s is on %s', (section, tab) => {
    expect(tabForSection(section)).toBe(tab);
  });

  it('is Overview when the page wasn’t opened from a to-do', () => {
    expect(tabForSection(null)).toBe('overview');
  });

  it('is a real tab for every kind of to-do about a member', () => {
    for (const kind of memberTodoKinds) {
      expect(memberTabs).toContain(tabForSection(memberTodoCopy[kind].section));
    }
  });

  it.each([
    ['locked', 'family'],
    ['turning-18', 'family'],
    ['dob', 'checks'],
    ['wwcc', 'checks'],
    ['wwcc-sent', 'checks'],
    ['wwcc-application', 'checks'],
    ['exemption-ending', 'checks'],
    ['notice', 'checks'],
    ['unendorsable', 'roles'],
    ['join', 'overview'],
    ['inactive', 'overview'],
  ] as const)('the %s to-do opens %s', (kind, tab) => {
    expect(tabForSection(memberTodoCopy[kind].section)).toBe(tab);
  });
});

describe('the line above the tabs', () => {
  const lead = (member: Partial<Profile>, rest: Partial<Parameters<typeof memberLead>[0]> = {}) =>
    memberLead({ member: profile(member), places: [], asked: 'Asked to join', reason: null, ...rest });

  it('says an approved member’s roles and where they are', () => {
    expect(lead({ role: 'coach', extra_roles: ['guardian'] }, { places: ['Open A', '17 & Under A'] })).toBe(
      'Approved · Coach, Guardian · Open A, 17 & Under A',
    );
  });

  it('is never a bare role: someone in no squad or team still starts with Approved', () => {
    expect(lead({ role: 'guest' })).toBe('Approved · Guest');
  });

  it('names their main role once, even when it is repeated in their other roles', () => {
    expect(lead({ role: 'coach', extra_roles: ['coach', 'manager'] })).toBe('Approved · Coach, Manager');
  });

  it('adds a committee title and says Head Physio', () => {
    expect(lead({ role: 'committee', title: 'President' })).toBe('Approved · Committee · President');
    expect(lead({ role: 'physio', head_physio: true })).toBe('Approved · Head Physio');
  });

  it('says what someone waiting asked for, not the role they haven’t been given', () => {
    expect(
      lead(
        { status: 'pending', role: 'guest', join_requested_at: '2026-10-01T00:00:00Z' },
        { asked: 'Asked to join as a coach · Open', places: ['Open'] },
      ),
    ).toBe('Pending · Asked to join as a coach · Open');
  });

  it('says so when someone waiting hasn’t asked to join', () => {
    expect(lead({ status: 'pending', join_requested_at: null }, { asked: 'Asked to join as a coach' })).toBe(
      'Pending · Hasn’t asked to join yet',
    );
  });

  it('says why someone wasn’t approved or lost access, when a reason was given', () => {
    expect(lead({ status: 'rejected' }, { reason: 'Not a club member' })).toBe('Rejected · Not a club member');
    expect(lead({ status: 'rejected' })).toBe('Rejected');
  });
});

describe('the line for paused roles', () => {
  const paused = (roles: AppRole[], stoodDownOn: string | null = null, approved = true) =>
    pausedNotice({ approved, stoodDownOn, paused: roles });

  it('is nothing when nothing is paused', () => {
    expect(paused([])).toBeNull();
  });

  it('says a stand-down and the roles it pauses', () => {
    expect(paused(['coach', 'committee'], '01/10/2026')).toBe(
      'Stood down since 01/10/2026. Paused: Coach, Committee.',
    );
  });

  it('says a stand-down even when it pauses no role they hold now', () => {
    expect(paused([], '01/10/2026')).toBe('Stood down since 01/10/2026.');
  });

  it('says one role paused for want of a check', () => {
    expect(paused(['coach'])).toBe(
      'Paused: Coach. They can’t use this role until their Working With Children Check is sorted out.',
    );
  });

  it('says several roles paused for want of a check', () => {
    expect(paused(['coach', 'manager'])).toBe(
      'Paused: Coach, Manager. They can’t use these roles until their Working With Children Check is sorted out.',
    );
  });

  it('says nothing about someone who isn’t approved: they have no roles to pause', () => {
    expect(paused(['coach'], null, false)).toBeNull();
    expect(paused(['coach'], '01/10/2026', false)).toBeNull();
  });
});

describe('the tab an issue is sorted out on', () => {
  // The lines come from safetyIssues itself, so a change to their wording is caught here.
  const issuesOf = (member: Partial<Profile>, hasVerifiedGuardian = true) =>
    safetyIssues(profile(member), hasVerifiedGuardian);

  it('a missing, expired or expiring check is on Checks', () => {
    for (const card of [
      {},
      { wwcc_number: '1', wwcc_expires_on: '2026-01-01' },
      { wwcc_number: '1', wwcc_expires_on: '2026-11-01', wwcc_validated_at: '2026-06-01T00:00:00Z', wwcc_unit_linked_at: '2026-06-01T00:00:00Z' },
    ]) {
      const issues = issuesOf({ role: 'coach', ...card });
      expect(issues).toHaveLength(1);
      expect(issueTab(issues[0])).toBe('checks');
    }
  });

  it('a card not validated or not registered is on Checks', () => {
    const issues = issuesOf({ role: 'coach', wwcc_number: '1', wwcc_expires_on: '2029-01-01' });
    expect(issues).toEqual(['Check not validated', 'Card not registered with the club']);
    expect(issues.map(issueTab)).toEqual(['checks', 'checks']);
  });

  it('an exemption or application with a problem is on Checks', () => {
    const exemption = safetyIssues(profile({ role: 'coach' }), true, {
      basis: 'parent_volunteer',
      child_name: 'Riley',
      declared_at: null,
      valid: true,
      ends_on: null,
      starts_on: null,
      event_name: null,
    });
    const application = safetyIssues(profile({ role: 'coach' }), true, null, {
      lodged_on: '2026-10-10',
      status: 'lapsed',
      lapses_on: '2027-01-08',
    });
    expect(exemption).toHaveLength(1);
    expect(application).toHaveLength(1);
    expect(issueTab(exemption[0])).toBe('checks');
    expect(issueTab(application[0])).toBe('checks');
  });

  it('an athlete’s missing date of birth is on Checks', () => {
    const issues = issuesOf({ date_of_birth: null });
    expect(issues).toEqual(['No date of birth']);
    expect(issueTab(issues[0])).toBe('checks');
  });

  it('a locked child and one about to turn 18 are on Family', () => {
    const issues = issuesOf({ date_of_birth: '2008-11-01' }, false);
    expect(issues).toEqual(['Locked: no verified parent or guardian linked', 'Turns 18 on 01/11/2026']);
    expect(issues.map(issueTab)).toEqual(['family', 'family']);
  });
});

describe('what Overview lists as needing attention', () => {
  const attention = (
    member: Partial<Profile>,
    rest: Partial<Omit<MemberAttentionInput, 'member'>> = {},
  ) => {
    const whole = profile(member);
    return memberAttention({
      member: whole,
      roles: [whole.role, ...whole.extra_roles],
      issues: safetyIssues(whole, true),
      comboProblem: null,
      hasOpenExemption: false,
      parentCodes: 0,
      childCodes: 0,
      ...rest,
    });
  };

  it('is empty for an approved member with nothing to sort out', () => {
    expect(attention({ role: 'coach', ...goodCard })).toEqual([]);
    expect(attention({ role: 'athlete' })).toEqual([]);
  });

  it('lists an approved member’s issues as the member list words them, each with its tab', () => {
    expect(attention({ role: 'coach', wwcc_number: '1', wwcc_expires_on: '2026-11-01' })).toEqual([
      { text: 'Working With Children Check expires 01/11/2026', tab: 'checks' },
      { text: 'Check not validated', tab: 'checks' },
      { text: 'Card not registered with the club', tab: 'checks' },
    ]);
  });

  it('sends a locked child to Family', () => {
    const child = profile({ date_of_birth: '2012-01-01' });
    expect(
      memberAttention({
        member: child,
        roles: ['athlete'],
        issues: safetyIssues(child, false),
        comboProblem: null,
        hasOpenExemption: false,
        parentCodes: 0,
        childCodes: 0,
      }),
    ).toEqual([{ text: 'Locked: no verified parent or guardian linked', tab: 'family' }]);
  });

  it('leaves a stand-down to the line above the tabs', () => {
    const stoodDown = attention({ role: 'coach', ...goodCard, stood_down_at: '2026-10-01T00:00:00Z' });
    expect(stoodDown).toEqual([]);
    // It is still one of the member list's issues.
    expect(safetyIssues(profile({ role: 'coach', ...goodCard, stood_down_at: '2026-10-01T00:00:00Z' }), true)).toEqual([
      'Stood down',
    ]);
  });

  it('puts roles that can’t be held together first, on Roles', () => {
    expect(
      attention(
        { role: 'athlete', extra_roles: ['manager'], date_of_birth: null },
        { comboProblem: 'Athletes can’t also be managers.' },
      )[0],
    ).toEqual({ text: 'Athletes can’t also be managers.', tab: 'roles' });
  });

  it('says an approved parent or guardian isn’t verified, but not other approved members', () => {
    expect(attention({ role: 'guardian', verified_at: null })).toEqual([
      { text: 'Not verified yet', tab: 'checks' },
    ]);
    expect(attention({ role: 'coach', extra_roles: ['guardian'], verified_at: null, ...goodCard })).toEqual([
      { text: 'Not verified yet', tab: 'checks' },
    ]);
    expect(attention({ role: 'coach', verified_at: null, ...goodCard })).toEqual([]);
    expect(attention({ role: 'guardian' })).toEqual([]);
  });

  describe('for someone not approved yet', () => {
    const waiting = (roles: AppRole[], member: Partial<Profile> = {}, rest = {}) =>
      attention({ status: 'pending', role: 'guest', ...member }, { roles, issues: [], ...rest });

    it('says they aren’t verified, whatever they asked for', () => {
      expect(waiting(['coach'], { verified_at: null, ...goodCard })).toEqual([
        { text: 'Not verified yet', tab: 'checks' },
      ]);
      expect(waiting(['coach'], goodCard)).toEqual([]);
    });

    it.each<AppRole>(['athlete', 'guest'])('asks for a %s’s date of birth', (role) => {
      expect(waiting([role], { date_of_birth: null })).toEqual([
        { text: 'No date of birth checked yet', tab: 'checks' },
      ]);
      expect(waiting([role], { date_of_birth: '1990-01-01' })).toEqual([]);
    });

    it('doesn’t ask for a date of birth for roles that need none', () => {
      expect(waiting(['guardian'], { date_of_birth: null })).toEqual([]);
      expect(waiting(['coach'], { date_of_birth: null, ...goodCard })).toEqual([]);
    });

    it.each<AppRole>(['coach', 'manager', 'physio', 'volunteer', 'committee', 'admin', 'statistician'])(
      'asks for a %s’s check',
      (role) => {
        expect(waiting([role])).toEqual([
          { text: 'No Working With Children Check recorded', tab: 'checks' },
        ]);
        expect(waiting([role], goodCard)).toEqual([]);
      },
    );

    it.each<AppRole>(['athlete', 'guardian', 'guest', 'studio'])('asks a %s for no check', (role) => {
      expect(waiting([role]).filter((i) => /Check/.test(i.text))).toEqual([]);
    });

    it('says an expired card, and one about to expire', () => {
      expect(waiting(['coach'], { wwcc_number: '1', wwcc_expires_on: '2026-01-01' })).toEqual([
        { text: 'Working With Children Check expired 01/01/2026', tab: 'checks' },
      ]);
      expect(waiting(['coach'], { wwcc_number: '1', wwcc_expires_on: '2026-11-01' })).toEqual([
        { text: 'Working With Children Check expires 01/11/2026', tab: 'checks' },
      ]);
    });

    it('asks for no check once an exemption is recorded, or an admin exempted them', () => {
      expect(waiting(['coach'], {}, { hasOpenExemption: true })).toEqual([]);
      expect(waiting(['committee'], { wwcc_exempt_reason: 'Treasurer only' })).toEqual([]);
      // An admin's reason never excuses a coach.
      expect(waiting(['coach'], { wwcc_exempt_reason: 'Treasurer only' })).toEqual([
        { text: 'No Working With Children Check recorded', tab: 'checks' },
      ]);
    });

    it('uses the roles the page would save, not the role they hold while waiting', () => {
      // Waiting as a guest in the database; the page would approve them as a coach.
      expect(waiting(['coach'], { role: 'guest' })).toEqual([
        { text: 'No Working With Children Check recorded', tab: 'checks' },
      ]);
    });
  });

  it('says link codes waiting for an answer, on Family', () => {
    expect(attention({}, { parentCodes: 1 })).toEqual([
      { text: 'A parent entered their link code', tab: 'family' },
    ]);
    expect(attention({}, { parentCodes: 2 })).toEqual([
      { text: '2 parents entered their link code', tab: 'family' },
    ]);
    expect(attention({ role: 'guardian' }, { childCodes: 1 })).toEqual([
      { text: 'They entered a child’s link code', tab: 'family' },
    ]);
    expect(attention({ role: 'guardian' }, { childCodes: 3 })).toEqual([
      { text: 'They entered 3 children’s link codes', tab: 'family' },
    ]);
  });

  it('lists every line once, most pressing first', () => {
    const texts = attention(
      { role: 'guardian', verified_at: null },
      { comboProblem: 'A problem with roles', childCodes: 1 },
    ).map((i) => i.text);
    expect(texts).toEqual(['A problem with roles', 'Not verified yet', 'They entered a child’s link code']);
    expect(new Set(texts).size).toBe(texts.length);
  });
});
