import {
  canBeExempt,
  canWorkWithChildren,
  committeeCheckDue,
  committeeChecksDue,
  exemptionStatus,
  isDatedExemption,
  needsWwcc,
  pausedRoles,
  safetyIssues,
  volunteerTimeOff,
  wwccRecordIssues,
  wwccStatus,
} from '@/lib/safety';
import type { MyVolunteerExemption, Profile } from '@/lib/types';

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
    verified_at: null,
    stood_down_at: null,
    ...overrides,
  };
}

/** A card that is current, validated and registered. */
const goodCard = {
  wwcc_number: '123456A',
  wwcc_expires_on: '2029-01-01',
  wwcc_validated_at: '2026-06-01T00:00:00Z',
  wwcc_unit_linked_at: '2026-06-01T00:00:00Z',
};

type Exemption = Pick<
  MyVolunteerExemption,
  'basis' | 'child_name' | 'declared_at' | 'valid' | 'ends_on' | 'starts_on' | 'event_name'
>;

function exemption(overrides: Partial<Exemption> = {}): Exemption {
  return {
    basis: 'parent_volunteer',
    child_name: 'Jo Sample',
    declared_at: '2026-09-01T00:00:00Z',
    valid: true,
    ends_on: null,
    starts_on: null,
    event_name: null,
    ...overrides,
  };
}

describe('canBeExempt', () => {
  it('lets committee members and admins be exempt', () => {
    expect(canBeExempt(['committee'])).toBe(true);
    expect(canBeExempt(['admin'])).toBe(true);
    expect(canBeExempt(['admin', 'guardian'])).toBe(true);
  });

  it('never exempts someone who also coaches, manages or is a physio', () => {
    expect(canBeExempt(['committee', 'coach'])).toBe(false);
    expect(canBeExempt(['admin', 'manager'])).toBe(false);
    expect(canBeExempt(['admin', 'physio'])).toBe(false);
  });

  it('is false for other roles', () => {
    expect(canBeExempt(['guardian'])).toBe(false);
    expect(canBeExempt(['athlete'])).toBe(false);
  });
});

describe('needsWwcc', () => {
  const member = (role: Profile['role'], extra_roles: Profile['extra_roles'] = [], reason: string | null = null) => ({
    role,
    extra_roles,
    wwcc_exempt_reason: reason,
  });

  it('always needs one for coaches, managers, physios and temporary helpers', () => {
    expect(needsWwcc(member('coach'))).toBe(true);
    expect(needsWwcc(member('manager'))).toBe(true);
    expect(needsWwcc(member('physio'))).toBe(true);
    expect(needsWwcc(member('volunteer'))).toBe(true);
    expect(needsWwcc(member('guardian', ['coach']))).toBe(true);
  });

  it('ignores an exemption for roles that always need one', () => {
    expect(needsWwcc(member('coach', ['committee'], 'Board only'))).toBe(true);
  });

  it('needs one for committee members and admins unless exempt', () => {
    expect(needsWwcc(member('committee'))).toBe(true);
    expect(needsWwcc(member('admin'))).toBe(true);
    expect(needsWwcc(member('committee', [], 'No contact with children'))).toBe(false);
    expect(needsWwcc(member('guardian', ['admin'], 'No contact with children'))).toBe(false);
  });

  it('does not count a blank exemption reason', () => {
    expect(needsWwcc(member('committee', [], '   '))).toBe(true);
  });

  it('is false for athletes, guardians, guests and statisticians', () => {
    expect(needsWwcc(member('athlete'))).toBe(false);
    expect(needsWwcc(member('guardian'))).toBe(false);
    expect(needsWwcc(member('guest'))).toBe(false);
    expect(needsWwcc(member('statistician'))).toBe(false);
  });
});

describe('wwccStatus', () => {
  it('is missing with no number', () => {
    expect(wwccStatus({ wwcc_number: null, wwcc_expires_on: '2030-01-01' })).toEqual({
      kind: 'missing',
      label: 'No Working With Children Check recorded',
      short: 'Missing',
      problem: true,
    });
    expect(wwccStatus({ wwcc_number: '  ', wwcc_expires_on: '2030-01-01' }).kind).toBe('missing');
  });

  it('is missing with no expiry date', () => {
    expect(wwccStatus({ wwcc_number: '123', wwcc_expires_on: null })).toEqual({
      kind: 'missing',
      label: 'Working With Children Check has no expiry date',
      short: 'No expiry date',
      problem: true,
    });
  });

  it('is expired the day after it expires', () => {
    expect(wwccStatus({ wwcc_number: '123', wwcc_expires_on: '2026-10-17' })).toEqual({
      kind: 'expired',
      label: 'Working With Children Check expired 17/10/2026',
      short: 'Expired',
      problem: true,
    });
  });

  it('is expiring on its last day and within 60 days', () => {
    expect(wwccStatus({ wwcc_number: '123', wwcc_expires_on: '2026-10-18' })).toEqual({
      kind: 'expiring',
      label: 'Working With Children Check expires 18/10/2026',
      short: 'Expires within 60 days',
      problem: true,
    });
    // 60 days after 18 October is 17 December.
    expect(wwccStatus({ wwcc_number: '123', wwcc_expires_on: '2026-12-16' }).kind).toBe('expiring');
  });

  it('is current from 60 days out', () => {
    expect(wwccStatus({ wwcc_number: '123', wwcc_expires_on: '2026-12-17' })).toEqual({
      kind: 'current',
      label: 'Current',
      short: 'Current',
      problem: false,
    });
  });
});

describe('wwccRecordIssues', () => {
  it('is empty when validated this year and registered', () => {
    expect(
      wwccRecordIssues({
        wwcc_validated_at: '2026-01-01T00:00:00Z',
        wwcc_unit_linked_at: '2026-01-01T00:00:00Z',
      }),
    ).toEqual([]);
  });

  it('lists a card never validated or registered', () => {
    expect(wwccRecordIssues({ wwcc_validated_at: null, wwcc_unit_linked_at: null })).toEqual([
      'Check not validated',
      'Card not registered with the club',
    ]);
    expect(wwccRecordIssues({})).toEqual([
      'Check not validated',
      'Card not registered with the club',
    ]);
  });

  it('flags a validation over a year old', () => {
    expect(
      wwccRecordIssues({
        wwcc_validated_at: '2025-10-01T00:00:00Z',
        wwcc_unit_linked_at: '2025-10-01T00:00:00Z',
      }),
    ).toEqual(['Check validated over a year ago']);
  });
});

describe('isDatedExemption', () => {
  it('is true for visitors and national events only', () => {
    expect(isDatedExemption('short_term_visitor')).toBe(true);
    expect(isDatedExemption('national_event')).toBe(true);
    expect(isDatedExemption('parent_volunteer')).toBe(false);
    expect(isDatedExemption('under_18_volunteer')).toBe(false);
  });
});

describe('exemptionStatus', () => {
  it('waits for the declaration', () => {
    expect(exemptionStatus(exemption({ declared_at: null }))).toEqual({
      label: 'Parent volunteer for Jo Sample: waiting for them to accept the declaration',
      problem: true,
    });
  });

  it('names each kind of exemption', () => {
    expect(exemptionStatus(exemption({ child_name: null })).label).toBe(
      'Parent volunteer for their child',
    );
    expect(exemptionStatus(exemption({ basis: 'under_18_volunteer' })).label).toBe(
      'Under-18 volunteer',
    );
    expect(exemptionStatus(exemption({ basis: 'short_term_visitor' })).label).toBe(
      'Short-term visitor exemption',
    );
    expect(exemptionStatus(exemption({ basis: 'national_event', event_name: 'Nationals' })).label).toBe(
      'National event exemption for Nationals',
    );
    expect(exemptionStatus(exemption({ basis: 'national_event' })).label).toBe(
      'National event exemption for an event',
    );
  });

  it('shows dates for a dated exemption that has not started', () => {
    expect(
      exemptionStatus(
        exemption({ basis: 'short_term_visitor', starts_on: '2026-11-01', ends_on: '2026-11-14' }),
      ),
    ).toEqual({
      label: 'Short-term visitor exemption: 01/11/2026 to 14/11/2026',
      problem: false,
    });
  });

  it('shows when a running dated exemption ends, without flagging it', () => {
    expect(
      exemptionStatus(
        exemption({ basis: 'national_event', event_name: 'Nationals', starts_on: '2026-10-10', ends_on: '2026-10-20' }),
      ),
    ).toEqual({ label: 'National event exemption for Nationals until 20/10/2026', problem: false });
  });

  it('flags a dated exemption that has ended', () => {
    expect(
      exemptionStatus(
        exemption({ basis: 'short_term_visitor', starts_on: '2026-09-01', ends_on: '2026-09-14', valid: false }),
      ),
    ).toEqual({ label: 'Short-term visitor exemption: ended 14/09/2026', problem: true });
  });

  it('flags an exemption that no longer applies', () => {
    expect(exemptionStatus(exemption({ valid: false }))).toEqual({
      label: 'Parent volunteer for Jo Sample: no longer applies (child turned 18, left or was unlinked)',
      problem: true,
    });
    expect(exemptionStatus(exemption({ basis: 'under_18_volunteer', valid: false }))).toEqual({
      label: 'Under-18 volunteer: no longer applies (turned 18)',
      problem: true,
    });
  });

  it('flags an exemption ending within 60 days', () => {
    expect(exemptionStatus(exemption({ ends_on: '2026-11-30' }))).toEqual({
      label: 'Parent volunteer for Jo Sample: ends 30/11/2026',
      problem: true,
    });
  });

  it('shows a later end without flagging it', () => {
    expect(exemptionStatus(exemption({ basis: 'under_18_volunteer', ends_on: '2027-06-01' }))).toEqual({
      label: 'Under-18 volunteer until 01/06/2027',
      problem: false,
    });
  });

  it('is fine with no end date', () => {
    expect(exemptionStatus(exemption())).toEqual({
      label: 'Parent volunteer for Jo Sample',
      problem: false,
    });
  });
});

describe('volunteerTimeOff', () => {
  const helper = (from: string | null, until: string | null) => ({
    role: 'volunteer' as const,
    extra_roles: [],
    volunteer_from: from,
    volunteer_until: until,
  });

  it('is false for members who are not temporary helpers', () => {
    expect(
      volunteerTimeOff({ role: 'coach', extra_roles: [], volunteer_from: null, volunteer_until: '2020-01-01' }),
    ).toBe(false);
  });

  it('is false during their dates, including the first and last day', () => {
    expect(volunteerTimeOff(helper('2026-10-18', '2026-10-18'))).toBe(false);
    expect(volunteerTimeOff(helper(null, null))).toBe(false);
  });

  it('is true before the first day and after the last', () => {
    expect(volunteerTimeOff(helper('2026-10-19', null))).toBe(true);
    expect(volunteerTimeOff(helper(null, '2026-10-17'))).toBe(true);
  });
});

describe('committeeChecksDue', () => {
  it('is due from the day itself', () => {
    expect(committeeChecksDue('2026-10-18')).toBe(true);
    expect(committeeChecksDue('2026-01-01')).toBe(true);
    expect(committeeChecksDue('2026-10-19')).toBe(false);
    expect(committeeChecksDue(null)).toBe(false);
  });
});

describe('committeeCheckDue', () => {
  const committee = (overrides: Partial<Profile> = {}) =>
    profile({ role: 'committee', ...overrides });

  it('is true for a committee member with no check before the date', () => {
    expect(committeeCheckDue(committee(), '2027-01-11')).toBe(true);
    expect(committeeCheckDue(committee({ role: 'guardian', extra_roles: ['committee'] }), '2027-01-11')).toBe(
      true,
    );
  });

  it('is false once the date has come', () => {
    expect(committeeCheckDue(committee(), '2026-10-18')).toBe(false);
  });

  it('is false with no date set', () => {
    expect(committeeCheckDue(committee(), null)).toBe(false);
  });

  it('is false with a check or an exemption recorded', () => {
    expect(committeeCheckDue(committee({ wwcc_number: '123' }), '2027-01-11')).toBe(false);
    expect(committeeCheckDue(committee({ wwcc_exempt_reason: 'Board only' }), '2027-01-11')).toBe(false);
  });

  it('is false for members who are not approved committee members', () => {
    expect(committeeCheckDue(committee({ status: 'pending' }), '2027-01-11')).toBe(false);
    expect(committeeCheckDue(profile({ role: 'admin' }), '2027-01-11')).toBe(false);
  });
});

describe('pausedRoles', () => {
  it('pauses nothing for members who are not approved', () => {
    expect(pausedRoles(profile({ role: 'coach', status: 'pending' }))).toEqual([]);
  });

  it('pauses coach, manager and physio without a current check', () => {
    expect(pausedRoles(profile({ role: 'coach', extra_roles: ['manager', 'physio', 'guardian'] }))).toEqual([
      'coach',
      'manager',
      'physio',
    ]);
    expect(
      pausedRoles(profile({ role: 'coach', wwcc_number: '123', wwcc_expires_on: '2026-10-17' })),
    ).toEqual(['coach']);
  });

  it('keeps roles with a current or expiring check', () => {
    expect(pausedRoles(profile({ role: 'coach', ...goodCard }))).toEqual([]);
    expect(pausedRoles(profile({ role: 'coach', wwcc_number: '123', wwcc_expires_on: '2026-10-18' }))).toEqual(
      [],
    );
  });

  it('keeps coaching roles with a volunteer exemption that applies', () => {
    expect(pausedRoles(profile({ role: 'coach', extra_roles: ['manager'] }), true)).toEqual([]);
  });

  it('never pauses athletes, guardians or guests without a check', () => {
    expect(pausedRoles(profile({ role: 'athlete', extra_roles: ['guardian'] }))).toEqual([]);
    expect(pausedRoles(profile({ role: 'guest' }))).toEqual([]);
  });

  it('keeps admin and statistician without a check', () => {
    expect(pausedRoles(profile({ role: 'admin', extra_roles: ['statistician'] }))).toEqual([]);
  });

  it('keeps committee without a check before the committee checks date', () => {
    expect(pausedRoles(profile({ role: 'committee' }), false, '2027-01-11')).toEqual([]);
    expect(pausedRoles(profile({ role: 'committee' }))).toEqual([]);
  });

  it('pauses committee without a check from the committee checks date', () => {
    expect(pausedRoles(profile({ role: 'committee' }), false, '2026-10-18')).toEqual(['committee']);
  });

  it('pauses committee with an expired check, whatever the date', () => {
    expect(
      pausedRoles(profile({ role: 'committee', wwcc_number: '123', wwcc_expires_on: '2026-01-01' })),
    ).toEqual(['committee']);
    expect(pausedRoles(profile({ role: 'committee', wwcc_number: '123' }))).toEqual(['committee']);
  });

  it('keeps committee with an exemption', () => {
    expect(
      pausedRoles(profile({ role: 'committee', wwcc_exempt_reason: 'Board only' }), false, '2026-01-01'),
    ).toEqual([]);
  });

  it('a volunteer exemption does not cover committee', () => {
    expect(pausedRoles(profile({ role: 'committee' }), true, '2026-01-01')).toEqual(['committee']);
  });

  it('pauses every stand-down role while stood down, even with a current check', () => {
    expect(
      pausedRoles(
        profile({
          role: 'admin',
          extra_roles: ['coach', 'committee', 'statistician', 'guardian', 'athlete'],
          stood_down_at: '2026-10-01T00:00:00Z',
          wwcc_exempt_reason: 'Board only',
          ...goodCard,
        }),
        true,
      ),
    ).toEqual(['admin', 'coach', 'committee', 'statistician']);
    expect(
      pausedRoles(profile({ role: 'volunteer', stood_down_at: '2026-10-01T00:00:00Z' })),
    ).toEqual(['volunteer']);
  });
});

describe('safetyIssues', () => {
  it('is empty for members who are not approved', () => {
    expect(safetyIssues(profile({ role: 'coach', status: 'pending' }), false)).toEqual([]);
  });

  it('is empty for an adult athlete with a date of birth', () => {
    expect(safetyIssues(profile(), false)).toEqual([]);
  });

  it('flags a stood-down member', () => {
    expect(
      safetyIssues(profile({ role: 'coach', stood_down_at: '2026-10-01T00:00:00Z', ...goodCard }), false),
    ).toEqual(['Stood down']);
  });

  it('flags a missing check', () => {
    expect(safetyIssues(profile({ role: 'coach' }), false)).toEqual([
      'No Working With Children Check recorded',
    ]);
  });

  it('flags an expiring check and what its record still needs', () => {
    expect(
      safetyIssues(profile({ role: 'manager', wwcc_number: '123', wwcc_expires_on: '2026-11-01' }), false),
    ).toEqual([
      'Working With Children Check expires 01/11/2026',
      'Check not validated',
      'Card not registered with the club',
    ]);
  });

  it('is empty for a coach with a good card', () => {
    expect(safetyIssues(profile({ role: 'coach', ...goodCard }), false)).toEqual([]);
  });

  it('leaves out exempt committee members', () => {
    expect(safetyIssues(profile({ role: 'committee', wwcc_exempt_reason: 'Board only' }), false)).toEqual(
      [],
    );
  });

  it('leaves out a temporary helper outside their dates', () => {
    expect(
      safetyIssues(profile({ role: 'volunteer', volunteer_from: '2026-11-01', volunteer_until: '2026-11-02' }), false),
    ).toEqual([]);
    expect(
      safetyIssues(profile({ role: 'volunteer', volunteer_from: '2026-10-01', volunteer_until: '2026-10-30' }), false),
    ).toEqual(['No Working With Children Check recorded']);
  });

  it('shows the exemption instead of the check when one is open', () => {
    const helper = profile({ role: 'volunteer' });
    expect(safetyIssues(helper, false, exemption())).toEqual([]);
    expect(safetyIssues(helper, false, exemption({ declared_at: null }))).toEqual([
      'Parent volunteer for Jo Sample: waiting for them to accept the declaration',
    ]);
  });

  it('goes by the check when it is current, whatever the exemption', () => {
    expect(
      safetyIssues(profile({ role: 'volunteer', ...goodCard }), false, exemption({ valid: false })),
    ).toEqual([]);
  });

  it('flags an athlete with no date of birth', () => {
    expect(safetyIssues(profile({ date_of_birth: null }), false)).toEqual(['No date of birth']);
  });

  it('flags an athlete under 18 with no guardian', () => {
    expect(safetyIssues(profile({ date_of_birth: '2012-01-01' }), false)).toEqual([
      'Under 18 with no guardian linked',
    ]);
    expect(safetyIssues(profile({ date_of_birth: '2012-01-01' }), true)).toEqual([]);
  });

  it('uses the admin choice without a date of birth', () => {
    expect(safetyIssues(profile({ date_of_birth: null, under_17: true }), false)).toEqual([
      'No date of birth',
      'Under 18 with no guardian linked',
    ]);
  });

  it('warns 30 days before an athlete turns 18', () => {
    expect(safetyIssues(profile({ date_of_birth: '2008-11-17' }), true)).toEqual([
      'Turns 18 on 17/11/2026',
    ]);
    expect(safetyIssues(profile({ date_of_birth: '2008-11-18' }), true)).toEqual([]);
    expect(safetyIssues(profile({ date_of_birth: '2008-10-19' }), true)).toEqual([
      'Turns 18 on 19/10/2026',
    ]);
  });

  it('gives 1 March for someone born on 29 February', () => {
    jest.setSystemTime(new Date(2026, 1, 10, 12));
    expect(safetyIssues(profile({ date_of_birth: '2008-02-29' }), true)).toEqual([
      'Turns 18 on 01/03/2026',
    ]);
  });

  it('lists every reason together', () => {
    expect(
      safetyIssues(
        profile({
          role: 'athlete',
          extra_roles: ['coach'],
          date_of_birth: '2008-11-01',
          stood_down_at: '2026-10-01T00:00:00Z',
        }),
        false,
      ),
    ).toEqual([
      'Stood down',
      'No Working With Children Check recorded',
      'Under 18 with no guardian linked',
      'Turns 18 on 01/11/2026',
    ]);
  });
});

describe('canWorkWithChildren', () => {
  const current = { wwcc_number: '1234567A', wwcc_expires_on: '2028-06-30' };

  it.each<[string, Partial<Profile>, boolean, boolean]>([
    ['an approved member with a current check', current, false, true],
    ['a check expiring within 60 days', { ...current, wwcc_expires_on: '2026-11-01' }, false, true],
    ['a check that has expired', { ...current, wwcc_expires_on: '2026-10-17' }, false, false],
    ['no check', { wwcc_number: null, wwcc_expires_on: null }, false, false],
    ['no check but an exemption that applies', { wwcc_number: null, wwcc_expires_on: null }, true, true],
    ['a stood-down member with a current check', { ...current, stood_down_at: '2026-10-01T00:00:00Z' }, false, false],
    ['a stood-down member with an exemption', { stood_down_at: '2026-10-01T00:00:00Z' }, true, false],
    ['a member waiting for approval', { ...current, status: 'pending' }, false, false],
    ['a rejected member', { ...current, status: 'rejected' }, true, false],
  ])('%s', (_label, overrides, exempt, expected) => {
    expect(canWorkWithChildren(profile(overrides), exempt)).toBe(expected);
  });

  it('is false for nobody signed in', () => {
    expect(canWorkWithChildren(null, true)).toBe(false);
  });
});
