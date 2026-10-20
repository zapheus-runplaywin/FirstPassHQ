/**
 * The Working With Children Checks report (wwccReport in src/lib/reports.ts),
 * which goes to the committee, auditors and the governing body. Section 10 of
 * the user guide ("Reports") says what it holds: every approved coach,
 * manager, physio, temporary helper while helping, committee member and admin
 * with their card details; problems first under Needs attention; exempt
 * committee members and admins; volunteer exemptions; temporary helpers;
 * Screening Unit notices; and stand-downs. Members who need no check
 * (athletes, guardians, guests) and anyone not approved are never in it.
 */
import { formatDateString } from '@/lib/injuries';
import type { Acknowledgement, Placement } from '@/lib/reports';
import { wwccReport } from '@/lib/reports';
import type { Profile, ScreeningNotice, StandDown, VolunteerExemption } from '@/lib/types';

import { NO_CHECK, noon, person, REPORT_DAY, team } from '../../__tests__/helpers/report-fixtures';

// The modules load auth and club context, which need native storage.
jest.mock('@/lib/auth', () => ({ useAuth: jest.fn() }));
jest.mock('@/lib/club', () => ({ useClub: jest.fn() }));

beforeEach(() => {
  jest.useFakeTimers({ now: REPORT_DAY });
});

afterEach(() => {
  jest.useRealTimers();
});

const day = (d: string) => formatDateString(d);

const OPEN_A = team('t-open-a', 'Open A', { sort_order: 1 });
const U17 = team('t-17u', '17 & Under A', { sort_order: 2 });
const TEAMS = [U17, OPEN_A];

const admin = person('admin', { role: 'admin', full_name: 'Sample admin' });
const alex = person('alex', { full_name: 'Alex Current', wwcc_card_name: ' ALEX CURRENT ' });
const blair = person('blair', { full_name: 'Blair Missing', role: 'manager', ...NO_CHECK });
const casey = person('casey', { full_name: 'Casey NoExpiry', role: 'physio', wwcc_expires_on: null });
const dana = person('dana', { full_name: 'Dana Expired', wwcc_expires_on: '2026-01-01' });
const eli = person('eli', { full_name: 'Eli Expiring', wwcc_expires_on: '2026-11-30' });
const finn = person('finn', { full_name: 'Finn Unvalidated', wwcc_validated_at: null, wwcc_validated_by: null });
const gus = person('gus', {
  full_name: 'Gus OldCheck',
  wwcc_validated_at: noon('2025-09-01'),
  wwcc_validated_by: 'someone-deleted',
  wwcc_validation_method: 'card_sighted',
  wwcc_unit_linked_at: null,
});
const harper = person('harper', { full_name: 'Harper Committee', role: 'committee' });
const ivy = person('ivy', {
  full_name: 'Ivy Exempt',
  role: 'admin',
  ...NO_CHECK,
  wwcc_exempt_reason: ' Board member who never works with children ',
  wwcc_exempted_by: 'admin',
  wwcc_exempted_at: noon('2026-02-01'),
});
const helper = (id: string, name: string, from: string, until: string, extra: Partial<Profile> = {}) =>
  person(id, {
    full_name: name,
    role: 'volunteer',
    volunteer_task: 'Carnival canteen',
    volunteer_from: from,
    volunteer_until: until,
    ...NO_CHECK,
    ...extra,
  });
const jo = helper('jo', 'Jo Helper', '2026-10-10', '2026-10-25');
const kai = helper('kai', 'Kai Uncovered', '2026-10-05', '2026-10-31');
const lee = helper('lee', 'Lee Upcoming', '2026-11-01', '2026-11-02', {
  wwcc_number: '7654321B',
  wwcc_expires_on: '2029-06-30',
});
const max = helper('max', 'Max Finished', '2026-09-01', '2026-09-30');
// Never in the report: no check needed, or not approved.
const nat = person('nat', { full_name: 'Nat Athlete', role: 'athlete', ...NO_CHECK });
const olly = person('olly', { full_name: 'Olly Guardian', role: 'guardian', ...NO_CHECK });
const quinn = person('quinn', { full_name: 'Quinn Guest', role: 'guest', ...NO_CHECK });
const pat = person('pat', { full_name: 'Pat Pending', status: 'pending', ...NO_CHECK });
const rae = person('rae', { full_name: 'Rae Rejected', status: 'rejected', role: 'manager', ...NO_CHECK });

const MEMBERS = [admin, alex, blair, casey, dana, eli, finn, gus, harper, ivy, jo, kai, lee, max, nat, olly, quinn, pat, rae];

const PLACEMENTS: Placement[] = [
  { team_id: U17.id, profile_id: alex.id, team_role: 'coach' },
  { team_id: OPEN_A.id, profile_id: alex.id, team_role: 'coach' },
  // Playing isn't child-related work, so the athlete place isn't listed.
  { team_id: 't-masters', profile_id: alex.id, team_role: 'athlete' },
  { team_id: OPEN_A.id, profile_id: blair.id, team_role: 'manager' },
  // A group that has since been removed.
  { team_id: 't-gone', profile_id: casey.id, team_role: 'physio' },
];

function exemption(overrides: Partial<VolunteerExemption>): VolunteerExemption {
  return {
    id: 'e1',
    profile_id: jo.id,
    basis: 'parent_volunteer',
    child_id: 'kid',
    child_name: 'Kid Sample',
    set_by_name: 'Sample admin',
    set_at: noon('2026-10-08'),
    declared_at: noon('2026-10-09'),
    declaration_text: 'I volunteer…',
    ended_at: null,
    ended_by_name: null,
    end_note: null,
    valid: true,
    ends_on: null,
    starts_on: null,
    event_name: null,
    organiser: null,
    ...overrides,
  };
}

const EXEMPTIONS = [
  exemption({}),
  exemption({ id: 'e2', profile_id: 'left-member', ended_at: noon('2026-09-20'), ended_by_name: 'Sample admin', end_note: 'Child left the club' }),
  // An open exemption for someone not approved isn't listed.
  exemption({ id: 'e3', profile_id: pat.id }),
];

const NOTICES: ScreeningNotice[] = [
  {
    id: 'n1',
    profile_id: dana.id,
    member_name: 'Dana Expired',
    kind: 'interim_negative_notice',
    received_on: '2026-10-12',
    action: 'Stood down from coaching at once',
    governing_body_told_on: null,
    governing_body_told_by_name: null,
    recorded_at: noon('2026-10-12'),
    recorded_by_name: 'Sample admin',
  },
  {
    id: 'n2',
    profile_id: null,
    member_name: 'A former coach',
    kind: 'negative_notice',
    received_on: '2026-06-02',
    action: 'Removed from the club',
    governing_body_told_on: '2026-06-03',
    governing_body_told_by_name: null,
    recorded_at: noon('2026-06-02'),
    recorded_by_name: 'Sample admin',
  },
  {
    id: 'n3',
    profile_id: alex.id,
    member_name: 'Alex Current',
    kind: 'other',
    received_on: '2026-05-01',
    action: 'Address updated',
    governing_body_told_on: null,
    governing_body_told_by_name: null,
    recorded_at: noon('2026-05-01'),
    recorded_by_name: 'Sample admin',
  },
];

const STAND_DOWNS: StandDown[] = [
  {
    id: 's1',
    profile_id: dana.id,
    member_name: 'Dana Expired',
    reason: 'interim_negative_notice',
    note: 'Notice received',
    started_at: noon('2026-10-12'),
    started_by_name: 'Sample admin',
    lifted_at: null,
    lifted_by_name: null,
    lift_note: null,
  },
  {
    id: 's2',
    profile_id: null,
    member_name: 'A former coach',
    reason: 'allegation',
    note: 'Looked into',
    started_at: noon('2026-04-01'),
    started_by_name: null,
    lifted_at: noon('2026-04-20'),
    lifted_by_name: 'Sample admin',
    lift_note: 'Nothing found',
  },
];

const ACKS: Acknowledgement[] = [{ profile_id: jo.id, policy_version: '2', acknowledged_at: noon('2026-10-09') }];

const full = () =>
  wwccReport(MEMBERS, PLACEMENTS, TEAMS, STAND_DOWNS, EXEMPTIONS, NOTICES, 'Sample admin', ACKS);

const sectionOf = (report: ReturnType<typeof full>, title: string) => {
  const found = report.sections.find((s) => s.title === title);
  if (!found) throw new Error(`No section ${title}`);
  return found;
};
const names = (report: ReturnType<typeof full>, title: string) => sectionOf(report, title).rows.map((r) => r.cells[0]);

describe('wwccReport', () => {
  it('is printed across the page and names the WWC Registration Officer', () => {
    const report = full();
    expect(report.title).toBe('Working With Children Checks');
    expect(report.landscape).toBe(true);
    expect(report.subtitle).toMatch(/WWC Registration Officer: Sample admin$/);
    expect(wwccReport([], [], []).subtitle).toMatch(/WWC Registration Officer: not named yet$/);
  });

  it('says committee roles pause with the others, or only from the club’s committee checks date', () => {
    const note = (from: string | null) =>
      wwccReport(MEMBERS, PLACEMENTS, TEAMS, STAND_DOWNS, EXEMPTIONS, NOTICES, 'Sample admin', ACKS, from)
        .sections[0].note;
    expect(note(null)).toContain('coach, manager and physio roles are paused while a check is missing or expired, and committee roles too.');
    expect(note('2020-01-01')).toContain('and committee roles too.');
    expect(note('2099-01-01')).toContain(`and committee roles from ${formatDateString('2099-01-01')}.`);
  });

  it('has its sections in order', () => {
    expect(full().sections.map((s) => s.title)).toEqual([
      'Needs attention',
      'Current',
      'Committee members and admins exempted',
      'Exempt from a check',
      'Temporary helpers',
      'Screening Unit notices',
      'Stand-downs',
    ]);
  });

  it('puts missing, undated, expired, expiring, unvalidated and unregistered checks under Needs attention, by name', () => {
    const report = full();
    expect(names(report, 'Needs attention')).toEqual([
      'Blair Missing',
      'Casey NoExpiry',
      'Dana Expired',
      'Eli Expiring',
      'Finn Unvalidated',
      'Gus OldCheck',
      'Kai Uncovered',
    ]);
    const status = Object.fromEntries(sectionOf(report, 'Needs attention').rows.map((r) => [r.cells[0], r.cells[9]]));
    expect(status).toEqual({
      'Blair Missing': 'Missing',
      'Casey NoExpiry': 'No expiry date',
      'Dana Expired': 'Expired',
      'Eli Expiring': 'Expires within 60 days',
      'Finn Unvalidated': 'Current. Check not validated',
      'Gus OldCheck': 'Current. Check validated over a year ago. Card not registered with the club',
      'Kai Uncovered': 'Missing',
    });
    expect(sectionOf(report, 'Needs attention').rows.every((r) => r.flag)).toBe(true);
  });

  it('lists checks with nothing to do under Current, not in red', () => {
    const current = sectionOf(full(), 'Current');
    expect(current.rows.map((r) => r.cells[0])).toEqual(['Alex Current', 'Harper Committee', 'Sample admin']);
    expect(current.rows.every((r) => !r.flag)).toBe(true);
  });

  it('shows every detail of a card in its columns', () => {
    const report = full();
    expect(sectionOf(report, 'Current').columns.map((c) => c.label)).toEqual([
      'Name',
      'Name on card',
      'Born',
      'Roles',
      'Squads and teams',
      'Card number',
      'Expires',
      'Validated',
      'Registered with club',
      'Status',
    ]);
    expect(sectionOf(report, 'Current').rows[0].cells).toEqual([
      'Alex Current',
      'ALEX CURRENT',
      '05/05/1990',
      'Coach',
      // Coaching places only, in the club's order.
      'Open A\n17 & Under A',
      '1234567A',
      '30/06/2029',
      `${day('2026-03-01')}, checked online by Sample admin`,
      day('2026-03-02'),
      'Current',
    ]);
  });

  it('says how a card was validated, by an admin who has since left', () => {
    const gusRow = sectionOf(full(), 'Needs attention').rows.find((r) => r.cells[0] === 'Gus OldCheck')!;
    expect(gusRow.cells[7]).toBe(`${day('2025-09-01')}, card sighted by A former admin`);
    expect(gusRow.cells[8]).toBe('');
  });

  it('leaves blanks for a missing check, and for a group that has gone', () => {
    const report = full();
    const blairRow = sectionOf(report, 'Needs attention').rows[0];
    expect(blairRow.cells).toEqual(['Blair Missing', '', '05/05/1990', 'Manager', 'Open A', '', '', '', '', 'Missing']);
    const caseyRow = sectionOf(report, 'Needs attention').rows[1];
    expect(caseyRow.cells[4]).toBe('');
    expect(caseyRow.cells[6]).toBe('');
  });

  it('never lists athletes, guardians, guests, or anyone not approved', () => {
    const report = full();
    const everyName = report.sections.flatMap((s) => s.rows.map((r) => r.cells[0]));
    for (const left of ['Nat Athlete', 'Olly Guardian', 'Quinn Guest', 'Pat Pending', 'Rae Rejected']) {
      expect(everyName).not.toContain(left);
    }
  });

  it('counts each kind of check', () => {
    expect(Object.fromEntries(full().stats!.map((s) => [s.label, s.value]))).toEqual({
      'Need a check': 10,
      Current: 5,
      'Expire within 60 days': 1,
      Expired: 1,
      Missing: 3,
      'Committee and admins exempt': 1,
      'Exempt from a check': 1,
      'To validate': 2,
      'Stood down now': 1,
      'Temporary helpers helping now': 2,
    });
  });

  it('counts nothing for a club with nobody yet, and says so in each section', () => {
    const report = wwccReport([], [], []);
    expect(report.stats!.every((s) => s.value === 0)).toBe(true);
    expect(report.sections.map((s) => [s.rows.length, s.empty])).toEqual([
      [0, 'Every check is current.'],
      [0, 'No current checks recorded.'],
      [0, 'Nobody is exempt.'],
      [0, 'No volunteer exemptions recorded.'],
      [0, 'No temporary helpers.'],
      [0, 'No notices recorded.'],
      [0, 'Nobody has been stood down.'],
    ]);
  });

  it('lists committee members and admins another admin exempted, with the reason, who and when', () => {
    const exempt = sectionOf(full(), 'Committee members and admins exempted');
    expect(exempt.rows.map((r) => r.cells)).toEqual([
      ['Ivy Exempt', 'Admin', 'Board member who never works with children', 'Sample admin', day('2026-02-01')],
    ]);
    const report = full();
    expect(report.sections.slice(0, 2).flatMap((s) => s.rows.map((r) => r.cells[0]))).not.toContain('Ivy Exempt');
  });

  it('never exempts a committee member who also coaches', () => {
    const coachToo = person('cc', {
      full_name: 'Coach Committee',
      role: 'committee',
      extra_roles: ['coach'],
      ...NO_CHECK,
      wwcc_exempt_reason: 'Board only',
    });
    const report = wwccReport([coachToo], [], []);
    expect(names(report, 'Needs attention')).toEqual(['Coach Committee']);
    expect(sectionOf(report, 'Needs attention').rows[0].cells[3]).toBe('Committee, Coach');
    expect(sectionOf(report, 'Committee members and admins exempted').rows).toHaveLength(0);
  });

  it('keeps someone with an exemption on the list when their own card is current', () => {
    const report = wwccReport([alex], [], [], [], [exemption({ profile_id: alex.id })]);
    expect(names(report, 'Current')).toEqual(['Alex Current']);
    expect(report.stats!.find((s) => s.label === 'Exempt from a check')!.value).toBe(0);
  });

  describe('Exempt from a check', () => {
    it('lists each exemption in the order given (current first), with a former member’s ended one', () => {
      const rows = sectionOf(full(), 'Exempt from a check').rows;
      expect(rows.map((r) => r.cells)).toEqual([
        [
          'Jo Helper',
          'Parent volunteer for Kid Sample',
          `${day('2026-10-08')} by Sample admin`,
          `Accepted ${day('2026-10-09')}`,
          'Parent volunteer for Kid Sample',
        ],
        [
          'A former member',
          'Parent volunteer for Kid Sample',
          `${day('2026-10-08')} by Sample admin`,
          `Accepted ${day('2026-10-09')}`,
          `Ended ${day('2026-09-20')} by Sample admin (Child left the club)`,
        ],
      ]);
      expect(rows.map((r) => r.flag)).toEqual([false, false]);
    });

    it('describes an event exemption waiting for its declaration, in red', () => {
      const report = wwccReport(
        [jo],
        [],
        [],
        [],
        [
          exemption({
            basis: 'national_event',
            child_name: null,
            event_name: 'National Championships',
            organiser: null,
            starts_on: '2026-10-15',
            ends_on: '2026-10-30',
            declared_at: null,
            set_by_name: null,
          }),
        ],
      );
      const [row] = sectionOf(report, 'Exempt from a check').rows;
      expect(row.cells).toEqual([
        'Jo Helper',
        'National event or tour: National Championships, run by unknown, 15/10/2026 to 30/10/2026',
        `${day('2026-10-08')} by a former admin`,
        'Waiting',
        'National event exemption for National Championships: waiting for them to accept the declaration',
      ]);
      expect(row.flag).toBe(true);
    });

    it('never flags an ended exemption, and names who ended it when they’ve left', () => {
      const [row] = sectionOf(
        wwccReport([jo], [], [], [], [exemption({ ended_at: noon('2026-10-01'), ended_by_name: null, valid: false })]),
        'Exempt from a check',
      ).rows;
      expect(row.cells[4]).toBe(`Ended ${day('2026-10-01')} by a former admin`);
      expect(row.flag).toBe(false);
    });
  });

  describe('Temporary helpers', () => {
    it('lists every helper, newest first, with their task, dates, cover, policies and where they’re up to', () => {
      const rows = sectionOf(full(), 'Temporary helpers').rows;
      expect(rows.map((r) => r.cells)).toEqual([
        ['Lee Upcoming', 'Carnival canteen', '01/11/2026 to 02/11/2026', 'Card 7654321B, expires 30/06/2029', 'No', 'Upcoming'],
        ['Jo Helper', 'Carnival canteen', '10/10/2026 to 25/10/2026', 'Parent volunteer for Kid Sample', day('2026-10-09'), 'Helping now'],
        ['Kai Uncovered', 'Carnival canteen', '05/10/2026 to 31/10/2026', 'No Working With Children Check recorded', 'No', 'Helping now'],
        ['Max Finished', 'Carnival canteen', '01/09/2026 to 30/09/2026', 'No Working With Children Check recorded', 'No', 'Finished'],
      ]);
      // Only a helper helping now with nothing covering them is in red.
      expect(rows.map((r) => r.flag)).toEqual([false, false, true, false]);
    });

    it('lists helpers outside their dates there only, not as needing a check', () => {
      const report = full();
      const checks = report.sections.slice(0, 2).flatMap((s) => s.rows.map((r) => r.cells[0]));
      expect(checks).not.toContain('Lee Upcoming');
      expect(checks).not.toContain('Max Finished');
      expect(checks).not.toContain('Jo Helper');
      expect(checks).toContain('Kai Uncovered');
    });

    it('marks a stood-down helper as stood down', () => {
      const stood = helper('sd', 'Sid Stood', '2026-10-01', '2026-10-31', { stood_down_at: noon('2026-10-15') });
      const [row] = sectionOf(wwccReport([stood], [], []), 'Temporary helpers').rows;
      expect(row.cells[5]).toBe('Stood down');
      expect(row.flag).toBe(false);
    });

    it('still counts a helper as needing a check while their exemption doesn’t apply', () => {
      // Waiting for the declaration, or the child turned 18 or was unlinked:
      // the exemption is open but covers nothing, so the missing check counts.
      for (const open of [exemption({ declared_at: null, valid: false }), exemption({ valid: false })]) {
        const report = wwccReport([jo], [], [], [], [open]);
        const stat = (label: string) => report.stats!.find((s) => s.label === label)!.value;
        expect(stat('Exempt from a check')).toBe(0);
        expect(stat('Need a check')).toBe(1);
        expect(stat('Missing')).toBe(1);
        expect(sectionOf(report, 'Needs attention').rows.map((r) => r.cells[0])).toEqual(['Jo Helper']);
      }
    });

    it('doesn’t count a stood-down helper as helping now', () => {
      const stood = helper('sd', 'Sid Stood', '2026-10-01', '2026-10-31', { stood_down_at: noon('2026-10-15') });
      const report = wwccReport([stood, kai], [], []);
      expect(report.stats!.find((s) => s.label === 'Temporary helpers helping now')!.value).toBe(1);
    });

    it('flags a helper whose exemption doesn’t apply yet, and says why', () => {
      const report = wwccReport([jo], [], [], [], [exemption({ declared_at: null, valid: false })]);
      const [row] = sectionOf(report, 'Temporary helpers').rows;
      expect(row.cells[3]).toBe('Parent volunteer for Kid Sample: waiting for them to accept the declaration');
      expect(row.flag).toBe(true);
    });

    it('has an empty Dates cell when a helper’s dates aren’t both set', () => {
      const undated = helper('u', 'Una Undated', '2026-10-01', '2026-10-31', { volunteer_until: null, volunteer_task: null });
      const [row] = sectionOf(wwccReport([undated], [], []), 'Temporary helpers').rows;
      expect(row.cells.slice(1, 3)).toEqual(['', '']);
    });
  });

  describe('Screening Unit notices', () => {
    it('shows when the governing body was told, and flags barring notices it hasn’t been told of', () => {
      const rows = sectionOf(full(), 'Screening Unit notices').rows;
      expect(rows.map((r) => r.cells)).toEqual([
        ['Dana Expired', 'Interim negative notice', '12/10/2026', 'Stood down from coaching at once', 'Not yet'],
        ['A former coach', 'Negative notice', '02/06/2026', 'Removed from the club', '03/06/2026 by a former admin'],
        ['Alex Current', 'Other notice', '01/05/2026', 'Address updated', 'Not needed'],
      ]);
      expect(rows.map((r) => r.flag)).toEqual([true, false, false]);
    });

    it.each(['interim_negative_notice', 'negative_notice', 'interstate_decision', 'card_cancelled'] as const)(
      'treats a %s as one the governing body must be told of',
      (kind) => {
        const [row] = sectionOf(wwccReport([], [], [], [], [], [{ ...NOTICES[0], kind }]), 'Screening Unit notices').rows;
        expect(row.cells[4]).toBe('Not yet');
        expect(row.flag).toBe(true);
      },
    );
  });

  describe('Stand-downs', () => {
    it('lists every stand-down, with who started and lifted it, and flags those still open', () => {
      const rows = sectionOf(full(), 'Stand-downs').rows;
      expect(rows.map((r) => r.cells)).toEqual([
        ['Dana Expired', 'Interim negative notice', `${day('2026-10-12')} by Sample admin`, 'Still stood down', 'Notice received'],
        [
          'A former coach',
          'Allegation being looked into',
          `${day('2026-04-01')} by a former admin`,
          `${day('2026-04-20')} by Sample admin`,
          'Looked into · Nothing found',
        ],
      ]);
      expect(rows.map((r) => r.flag)).toEqual([true, false]);
    });

    it('keeps a stood-down member’s check on the list', () => {
      const stood = person('sd', { full_name: 'Sam Stood', stood_down_at: noon('2026-10-12') });
      expect(names(wwccReport([stood], [], []), 'Current')).toEqual(['Sam Stood']);
    });
  });

  it('turns red the day a check expires and the day it comes within 60 days', () => {
    const on = (expires: string) => wwccReport([person('x', { full_name: 'X', wwcc_expires_on: expires })], [], []);
    // Today is 18/10/2026: a card expiring today is still current today.
    expect(sectionOf(on('2026-10-18'), 'Needs attention').rows[0].cells[9]).toBe('Expires within 60 days');
    expect(sectionOf(on('2026-10-17'), 'Needs attention').rows[0].cells[9]).toBe('Expired');
    // 60 days from today is 17/12/2026.
    expect(sectionOf(on('2026-12-16'), 'Needs attention').rows[0].cells[9]).toBe('Expires within 60 days');
    expect(names(on('2026-12-17'), 'Current')).toEqual(['X']);
  });

  it('asks for a card validated exactly a year ago to be validated again only once the year has passed', () => {
    const validated = (at: string) =>
      wwccReport([person('x', { full_name: 'X', wwcc_validated_at: at })], [], []);
    expect(names(validated('2025-10-18T03:00:00Z'), 'Current')).toEqual(['X']);
    expect(sectionOf(validated('2025-10-18T01:00:00Z'), 'Needs attention').rows[0].cells[9]).toBe(
      'Current. Check validated over a year ago',
    );
  });

  it('falls back to the email, then a placeholder, for a member with no name', () => {
    const report = wwccReport(
      [person('a', { full_name: null }), person('b', { full_name: null, email: null })],
      [],
      [],
    );
    expect(names(report, 'Current')).toEqual(['a@example.test', 'Unnamed member']);
  });

  it('adds the season to a group whose name another current group shares', () => {
    const old = team('t-old', 'Open A', { season: 2025, sort_order: 1 });
    const report = wwccReport([alex], [{ team_id: old.id, profile_id: alex.id, team_role: 'coach' }], [OPEN_A, old]);
    expect(sectionOf(report, 'Current').rows[0].cells[4]).toBe('Open A (2025–26)');
  });
});
