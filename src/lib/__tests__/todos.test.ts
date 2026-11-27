import type { SelectionTodo } from '@/lib/assessments';
import { formatDateString, type LoggedInjury } from '@/lib/injuries';
import type { KpiReviewTodo } from '@/lib/kpis';
import type { MedicalReview } from '@/lib/medical';
import type { MyConflictDeclaration, PolicyReview } from '@/lib/registers';
import type { MySurvey } from '@/lib/surveys';
import type { ConcernClock } from '@/lib/concerns';
import { buildTodos, concernClockTodo, dueAlert, sortByAlert, type Todo, URGENT } from '@/lib/todos';
import type { MyTraining } from '@/lib/training';
import type { AwardSlot, CoachTeamGame, GoalGame, Injury, MyWwccSubmission } from '@/lib/types';
import type { SafetyTodos } from '@/lib/use-pending-requests';

// The modules load auth and club context, which need native storage.
jest.mock('@/lib/auth', () => ({ useAuth: jest.fn() }));
jest.mock('@/lib/club', () => ({ useClub: jest.fn(), useFeature: jest.fn() }));
jest.mock('@/lib/messages', () => ({ useCaptainedGroupIds: jest.fn() }));

// Sunday 18 October 2026, noon local time.
const TODAY = new Date(2026, 9, 18, 12);

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(TODAY);
});

afterEach(() => {
  jest.useRealTimers();
});

const at = (day: number, hour = 12) => new Date(2026, 9, day, hour).toISOString();

function todos(overrides: Partial<Parameters<typeof buildTodos>[0]> = {}) {
  return buildTodos({
    userId: 'me',
    injuries: [],
    pendingCount: 0,
    needsCheckIn: false,
    flaggedAthletes: 0,
    today: TODAY,
    ...overrides,
  });
}

const keys = (list: Todo[]) => list.map((t) => t.key);
const only = (list: Todo[]) => {
  expect(list).toHaveLength(1);
  return list[0];
};

function injury(overrides: Partial<Injury> = {}): Injury {
  return {
    id: 'i1',
    athlete_id: 'a1',
    athlete_name: 'Sam Sample',
    body_area: 'Ankle',
    description: '',
    injured_on: '2026-10-01',
    restrictions: null,
    expected_return: null,
    status: 'injured',
    coach_endorsed_by: null,
    cleared_at: null,
    created_at: '2026-10-01T00:00:00Z',
    last_update_at: null,
    can_report: false,
    waiting_for_me: false,
    ...overrides,
  };
}

function goalGame(overrides: Partial<GoalGame> = {}): GoalGame {
  return {
    fixture_id: 'f1',
    team_id: 't1',
    team_name: '17 & Under',
    round_name: 'Round 3',
    opponent: 'Swans',
    starts_at: at(20, 14),
    time_tbc: false,
    venue: null,
    court: null,
    is_home: true,
    goals_close_at: at(20, 14),
    played_at: at(20, 15),
    goal_count: 0,
    reflected_count: 0,
    comment_count: 0,
    ...overrides,
  };
}

function teamGame(overrides: Partial<CoachTeamGame> = {}): CoachTeamGame {
  return {
    team_id: 't1',
    team_name: 'Open A',
    team_kind: 'team',
    fixture_id: 'f9',
    is_next: true,
    round_name: 'Round 4',
    opponent: 'Rockets',
    starts_at: at(25, 10),
    time_tbc: false,
    goals_close_at: at(25, 10),
    played_at: at(25, 11),
    goal_count: 0,
    reviewed_count: 0,
    ...overrides,
  };
}

function slot(overrides: Partial<AwardSlot> = {}): AwardSlot {
  return {
    award_id: 'aw1',
    award_name: 'MVP',
    description: '',
    points: [3, 2, 1],
    nominees: 'athletes',
    team_id: 't1',
    team_name: 'Open A',
    fixture_id: 'f1',
    fixture_label: 'Round 3 v Rockets',
    preseason: false,
    closes_at: at(20),
    voted: false,
    ...overrides,
  };
}

function course(overrides: Partial<MyTraining> = {}): MyTraining {
  return {
    requirement_id: 'r1',
    season: 2026,
    name: 'Safeguarding',
    details: null,
    course_url: null,
    due_on: '2026-12-01',
    profile_id: 'me',
    profile_name: 'Me',
    is_me: true,
    status: 'to_do',
    certificate_id: null,
    completed_on: null,
    document_path: null,
    document_name: null,
    review_note: null,
    reviewed_by_name: null,
    reviewed_at: null,
    ...overrides,
  };
}

function safety(overrides: Partial<SafetyTodos> = {}): SafetyTodos {
  return {
    wwcc_missing: 0,
    wwcc_expiring: 0,
    minors_without_guardian: 0,
    turning_18: 0,
    exemptions_ending: 0,
    athletes_without_date_of_birth: 0,
    wwcc_to_validate: 0,
    wwcc_to_link: 0,
    notices_to_report: 0,
    wwc_officer_missing: 0,
    ...overrides,
  };
}

function review(overrides: Partial<KpiReviewTodo> = {}): KpiReviewTodo {
  return {
    kind: 'write',
    point_id: 'pt1',
    point_name: 'Mid-season',
    due_on: '2026-11-01',
    team_id: 't1',
    team_name: 'Open A',
    profile_id: 'p1',
    full_name: 'Alex Kim',
    ...overrides,
  };
}

function survey(overrides: Partial<MySurvey> = {}): MySurvey {
  return {
    id: 's1',
    title: 'Season survey',
    identity: 'anonymous',
    opens_at: at(1),
    closes_at: new Date(2026, 9, 30).toISOString(),
    created_by_name: null,
    for_child_names: null,
    from_child: false,
    responded: false,
    is_open: true,
    everyone_answers: false,
    ...overrides,
  };
}

describe('dueAlert', () => {
  it('is null with no date or a date more than 3 days away', () => {
    expect(dueAlert(null, TODAY)).toBeNull();
    expect(dueAlert(undefined, TODAY)).toBeNull();
    expect(dueAlert('2026-10-22', TODAY)).toBeNull();
  });

  it('is red once the day has passed', () => {
    expect(dueAlert('2026-10-17', TODAY)).toEqual({ level: 'red', label: 'Overdue' });
  });

  it('is amber from today to 3 days ahead', () => {
    expect(dueAlert('2026-10-18', TODAY)).toEqual({ level: 'amber', label: 'Due soon' });
    expect(dueAlert('2026-10-21', TODAY)).toEqual({ level: 'amber', label: 'Due soon' });
  });

  it('works across the end of a month', () => {
    const today = new Date(2026, 9, 30, 12);
    expect(dueAlert('2026-11-02', today)?.level).toBe('amber');
    expect(dueAlert('2026-11-03', today)).toBeNull();
  });

  it('uses the time now by default', () => {
    expect(dueAlert('2026-10-17')?.level).toBe('red');
  });
});

describe('sortByAlert', () => {
  type Item = { id: string; level?: 'red' | 'amber'; due?: string; urgent?: boolean };
  const sort = (items: Item[]) =>
    sortByAlert(
      items,
      (i) => (i.urgent ? URGENT : i.level ? { level: i.level, label: '' } : null),
      (i) => i.due,
    ).map((i) => i.id);

  it('puts red first, then amber, then the rest', () => {
    expect(sort([{ id: 'plain' }, { id: 'amber', level: 'amber' }, { id: 'red', level: 'red' }])).toEqual([
      'red',
      'amber',
      'plain',
    ]);
  });

  it('puts the earliest due first within red and amber, undated last', () => {
    expect(
      sort([
        { id: 'r-none', level: 'red' },
        { id: 'r-late', level: 'red', due: '2026-10-10' },
        { id: 'r-early', level: 'red', due: '2026-10-01' },
        { id: 'a-late', level: 'amber', due: '2026-10-20' },
        { id: 'a-early', level: 'amber', due: '2026-10-19' },
      ]),
    ).toEqual(['r-early', 'r-late', 'r-none', 'a-early', 'a-late']);
  });

  it('puts urgent above every red, even long-overdue ones', () => {
    expect(
      sort([
        { id: 'plain' },
        { id: 'amber', level: 'amber', due: '2026-10-19' },
        { id: 'overdue', level: 'red', due: '2020-01-01' },
        { id: 'red', level: 'red' },
        { id: 'urgent', urgent: true },
      ]),
    ).toEqual(['urgent', 'overdue', 'red', 'amber', 'plain']);
  });

  it('keeps the order of everything else, whatever the dates', () => {
    expect(
      sort([
        { id: 'b', due: '2026-12-01' },
        { id: 'a', due: '2026-11-01' },
        { id: 'c' },
      ]),
    ).toEqual(['b', 'a', 'c']);
  });

  it('keeps the order of ties', () => {
    expect(
      sort([
        { id: 'x', level: 'amber', due: '2026-10-19' },
        { id: 'y', level: 'amber', due: '2026-10-19' },
      ]),
    ).toEqual(['x', 'y']);
  });

  it('does not change the list it is given', () => {
    const items: Item[] = [{ id: 'a' }, { id: 'b', level: 'red' }];
    sort(items);
    expect(items.map((i) => i.id)).toEqual(['a', 'b']);
  });
});

describe('buildTodos', () => {
  it('is empty with nothing to do', () => {
    expect(todos()).toEqual([]);
  });

  it('puts concerns and the exemption declaration first', () => {
    const list = todos({
      newConcerns: 2,
      declarationWaiting: true,
      needsCheckIn: true,
      pendingCount: 1,
    });
    expect(keys(list)).toEqual(['concerns', 'volunteer-declaration', 'check-in', 'join-requests']);
    expect(list[0].title).toBe('Look at 2 new concerns');
    expect(list[0].detail).toBe('Refer child abuse and serious crimes to Police straight away');
    expect(todos({ newConcerns: 1 })[0].title).toBe('Look at 1 new concern');
  });

  it('marks new concerns urgent: a red Urgent warning that goes above every other', () => {
    expect(todos({ newConcerns: 1 })[0].alert).toEqual({ level: 'red', label: 'Urgent', urgent: true });
    // Above red warnings that are themselves missing or overdue.
    const list = todos({
      newConcerns: 3,
      safety: safety({ records_removal_stalled: { last_ok_at: null } }),
      medicalReviews: [{ athlete_id: 'me', athlete_name: 'Me', status: 'overdue', due_on: '2026-09-01' }],
    });
    const sorted = sortByAlert(list, (t) => t.alert, (t) => t.dueOn);
    expect(sorted[0]).toMatchObject({ key: 'concerns', alert: { label: 'Urgent' } });
    expect(sorted.slice(1).map((t) => t.alert?.level)).toEqual(['red', 'red']);
  });

  describe('concern clocks', () => {
    const clock = (extra: Partial<ConcernClock> = {}): ConcernClock => ({
      concern_id: 'c1',
      reference: 'C-0007',
      stage: 'important',
      clock_from: '2026-11-01T00:00:00Z',
      escalated: false,
      ...extra,
    });

    it('chases each stage by reference only, opening the concern', () => {
      expect(concernClockTodo(clock({ stage: 'new_late' }))).toEqual({
        key: 'concern-clock-c1',
        title: 'Nothing recorded on C-0007 yet',
        detail: 'You lead this concern',
        href: '/concerns/c1',
        alert: { level: 'red', label: 'Late' },
      });
      expect(concernClockTodo(clock({ stage: 'refer' }))).toMatchObject({
        title: 'Refer C-0007 or record why not',
        alert: URGENT,
      });
      expect(concernClockTodo(clock({ stage: 'important' }))).toMatchObject({
        title: 'C-0007 has had nothing recorded for a while',
        alert: { level: 'amber', label: 'Important' },
      });
      expect(concernClockTodo(clock({ stage: 'urgent' }))).toMatchObject({
        title: 'C-0007 is urgent: nothing recorded for too long',
        alert: URGENT,
      });
    });

    it('says when it was escalated to the member', () => {
      expect(concernClockTodo(clock({ escalated: true })).detail).toBe('Escalated to you');
    });

    it('lists every clock, after new concerns and before message requests', () => {
      const list = todos({
        newConcerns: 1,
        concernClocks: [clock(), clock({ concern_id: 'c2', stage: 'urgent' })],
        messageAccess: { to_decide: 1, open_access: 0, only_one_admin: false },
      });
      expect(keys(list)).toEqual(['concerns', 'concern-clock-c1', 'concern-clock-c2', 'message-access-decide']);
    });

    it('adds nothing without clocks', () => {
      expect(todos({ concernClocks: [] })).toEqual([]);
    });
  });

  describe('message access requests', () => {
    it('marks a request waiting too long Important, then Urgent', () => {
      const late = (l: 'important' | 'urgent' | null) =>
        todos({ messageAccess: { to_decide: 1, open_access: 0, only_one_admin: false, late: l } })[0].alert;
      expect(late('important')).toEqual({ level: 'red', label: 'Important' });
      expect(late('urgent')).toEqual(URGENT);
      expect(late(null)).toEqual({ level: 'red', label: 'Waiting' });
    });

    const access = (extra: Partial<{ to_decide: number; open_access: number; only_one_admin: boolean }>) => ({
      to_decide: 0,
      open_access: 0,
      only_one_admin: false,
      ...extra,
    });

    it('asks whoever can answer to answer, in red, after new concerns', () => {
      const list = todos({ newConcerns: 1, messageAccess: access({ to_decide: 2 }) });
      expect(keys(list)).toEqual(['concerns', 'message-access-decide']);
      expect(list[1]).toMatchObject({
        title: 'Answer 2 requests to read messages',
        href: '/concerns/message-access',
        alert: { level: 'red', label: 'Waiting' },
      });
      expect(todos({ messageAccess: access({ to_decide: 1 }) })[0].title).toBe('Answer 1 request to read messages');
    });

    it('reminds the requester their 24 hours are running', () => {
      expect(todos({ messageAccess: access({ open_access: 1 }) })[0]).toMatchObject({
        key: 'message-access-open',
        detail: 'Your access lasts 24 hours from approval',
        alert: { level: 'amber' },
      });
    });

    it('tells a lone admin to add a second admin', () => {
      expect(todos({ messageAccess: access({ only_one_admin: true }) })[0]).toMatchObject({
        key: 'second-admin',
        title: 'Add a second admin',
        detail: "A backup when you're away, and someone to verify your own check",
        alert: { level: 'amber' },
      });
    });

    it('adds nothing when there is nothing to do, or nothing was loaded', () => {
      expect(todos({ messageAccess: access({}) })).toEqual([]);
      expect(todos({ messageAccess: null })).toEqual([]);
    });
  });

  it('has no urgent warning without new concerns', () => {
    expect(todos({ newConcerns: 0 }).some((t) => t.alert?.urgent)).toBe(false);
  });

  it('puts athletes flagged 3 times in a week straight after new concerns, for the Child Safety Officer', () => {
    const list = todos({ newConcerns: 1, wellbeingFlagAlerts: 2, declarationWaiting: true, needsCheckIn: true });
    expect(keys(list)).toEqual(['concerns', 'wellbeing-flags', 'volunteer-declaration', 'check-in']);
    expect(list[1]).toMatchObject({
      title: 'Look at 2 athletes flagged 3 times this week',
      detail: 'Low check-in scores on 3 of the last 7 days',
      href: '/concerns/wellbeing',
    });
    expect(todos({ wellbeingFlagAlerts: 1 })[0].title).toBe('Look at 1 athlete flagged 3 times this week');
    expect(keys(todos({ wellbeingFlagAlerts: 0 }))).toEqual([]);
  });

  it('asks the member to confirm their check application, straight after an exemption declaration', () => {
    const list = todos({
      declarationWaiting: true,
      applicationDeclarationWaiting: true,
      needsCheckIn: true,
    });
    expect(keys(list)).toEqual(['volunteer-declaration', 'wwcc-application-declaration', 'check-in']);
    expect(list[1]).toEqual({
      key: 'wwcc-application-declaration',
      title: 'Confirm your Working With Children Check application',
      detail: 'It counts as your check once you accept the declaration',
      href: '/wwcc-application',
    });
  });

  describe('the member’s own check', () => {
    const sent = (extra: Partial<MyWwccSubmission> = {}): MyWwccSubmission => ({
      id: 's1',
      card_number: 'WWC1',
      expires_on: '2029-01-01',
      card_name: 'Sam',
      submitted_at: at(17),
      status: 'waiting',
      decided_at: null,
      return_note: null,
      ...extra,
    });

    it('asks a paused member to add their card, in red', () => {
      expect(only(todos({ ownCheck: 'paused' }))).toEqual({
        key: 'wwcc-send',
        title: 'Add your Working With Children Check',
        detail: 'Your role is paused until a club admin checks it',
        href: '/wwcc',
        alert: { level: 'red', label: 'Paused' },
      });
    });

    it('asks a member whose card expires soon for the renewed one, in amber', () => {
      expect(only(todos({ ownCheck: 'expiring' }))).toEqual({
        key: 'wwcc-send',
        title: 'Add your renewed Working With Children Check',
        detail: 'Your card expires soon. Once you’ve renewed it, send the new card.',
        href: '/wwcc',
        alert: { level: 'amber', label: 'Expiring' },
      });
    });

    it('asks nothing while a card they sent waits for an admin', () => {
      expect(todos({ ownCheck: 'paused', wwccSubmission: sent() })).toEqual([]);
      expect(todos({ ownCheck: 'expiring', wwccSubmission: sent() })).toEqual([]);
      expect(todos({ ownCheck: null })).toEqual([]);
    });

    it('asks them to send a card again after an admin sent it back, with the note', () => {
      const back = sent({ status: 'returned', return_note: 'Wrong expiry' });
      expect(only(todos({ ownCheck: 'paused', wwccSubmission: back }))).toEqual({
        key: 'wwcc-send-again',
        title: 'Send your Working With Children Check again',
        detail: 'Sent back: Wrong expiry',
        href: '/wwcc',
        alert: { level: 'red', label: 'Paused' },
      });
      const noNote = only(todos({ ownCheck: null, wwccSubmission: sent({ status: 'returned' }) }));
      expect(noNote.detail).toBe('A club admin sent it back');
      expect(noNote.alert).toBeUndefined();
    });
  });

  it('asks for consent for each child', () => {
    const list = todos({
      consentsNeeded: [
        { id: 'c1', name: 'Jo' },
        { id: 'c2', name: 'Sam' },
      ],
    });
    expect(list.map((t) => [t.key, t.title, t.href])).toEqual([
      ['consent-c1', 'Give consent for Jo', '/consent/c1'],
      ['consent-c2', 'Give consent for Sam', '/consent/c2'],
    ]);
  });

  it('says what each child’s consent to-do still asks, defaulting to both', () => {
    const list = todos({
      consentsNeeded: [
        {
          id: 'c1',
          name: 'Jo',
          detail: 'Choose who sees their injury and medical details',
        },
        { id: 'c2', name: 'Sam' },
      ],
    });
    expect(list.map((t) => t.detail)).toEqual([
      'Choose who sees their injury and medical details',
      'Choose who sees their check-ins and injury details',
    ]);
  });

  it('asks for the code of conduct for the member and their children', () => {
    const list = todos({
      conduct: [
        { id: 'me', name: 'Me', forChild: false },
        { id: 'c1', name: 'Jo', forChild: true },
      ],
    });
    expect(list.map((t) => t.title)).toEqual([
      'Accept the code of conduct',
      'Accept the code of conduct for Jo',
    ]);
    expect(list[1].detail).toBe('Go through it with them. Every member accepts it each season.');
    expect(list[1].href).toEqual({ pathname: '/conduct/[id]', params: { id: 'c1' } });
  });

  it('counts flagged athletes and absences to review', () => {
    const list = todos({ flaggedAthletes: 1, absencesToReview: 3 });
    expect(list.map((t) => t.title)).toEqual([
      'Check in with 1 athlete',
      'Review 3 new or changed absences',
    ]);
    expect(todos({ flaggedAthletes: 2, absencesToReview: 1 }).map((t) => t.title)).toEqual([
      'Check in with 2 athletes',
      'Review 1 new or changed absence',
    ]);
  });

  describe('injuries', () => {
    const logged = (overrides: Partial<LoggedInjury> = {}): LoggedInjury => ({
      injury_id: 'i9',
      athlete_id: 'a1',
      athlete_name: 'Sam Sample',
      body_area: 'Knee',
      logged_by_name: 'Casey Coach',
      logged_by_role: 'coach',
      logged_at: '2026-10-18T09:00:00Z',
      ...overrides,
    });

    it('asks a guardian to look at an injury a coach logged for their child', () => {
      expect(only(todos({ loggedInjuries: [logged()] }))).toEqual({
        key: 'injury-logged-i9',
        title: 'Look at the injury Casey Coach logged for Sam Sample',
        detail: 'Knee · logged by their coach. Add the physio’s updates from there.',
        href: { pathname: '/injuries/[id]', params: { id: 'i9' } },
      });
    });

    it('speaks to the athlete about their own, one to-do per injury', () => {
      const list = todos({
        loggedInjuries: [
          logged({ athlete_id: 'me', logged_by_role: 'physio', logged_by_name: null }),
          logged({ injury_id: 'i10', athlete_name: null, logged_by_role: 'manager' }),
        ],
      });
      expect(list.map((t) => t.title)).toEqual([
        'Look at the injury a club member logged for you',
        'Look at the injury Casey Coach logged for your athlete',
      ]);
      expect(list.map((t) => t.detail)).toEqual([
        'Knee · logged by their physio. Add the physio’s updates from there.',
        'Knee · logged by their manager. Add the physio’s updates from there.',
      ]);
    });

    it('has nothing to look at by default', () => {
      expect(todos()).toEqual([]);
    });

    it('opens a single clearance waiting for the member', () => {
      const todo = only(todos({ injuries: [injury({ waiting_for_me: true })] }));
      expect(todo).toMatchObject({
        key: 'injury-sign-off',
        title: 'Review Sam Sample’s clearance',
        detail: 'Ankle · waiting for your sign-off',
        href: { pathname: '/injuries/[id]', params: { id: 'i1' } },
      });
    });

    it('marks a clearance waiting past the club’s times Important, then Urgent', () => {
      const waiting = (sent: string, times?: { clearance_important_days: number; clearance_urgent_days: number }) =>
        only(todos({ injuries: [injury({ waiting_for_me: true, last_update_at: sent })], concernTimes: times })).alert;
      // TODAY is 18 October, midday in Perth: 04:00 UTC.
      expect(waiting('2026-10-17T04:00:00Z')).toBeUndefined();
      expect(waiting('2026-10-15T04:00:00Z')).toEqual({ level: 'amber', label: 'Important' });
      expect(waiting('2026-10-11T04:00:00Z')).toEqual({ level: 'red', label: 'Urgent' });
      // The club's own times.
      expect(waiting('2026-10-17T04:00:00Z', { clearance_important_days: 1, clearance_urgent_days: 2 })).toEqual({
        level: 'amber',
        label: 'Important',
      });
    });

    it('counts from when the injury was logged when nothing was added since', () => {
      expect(only(todos({ injuries: [injury({ waiting_for_me: true, created_at: '2026-10-17T04:00:00Z' })] })).alert).toBeUndefined();
    });

    it('marks several clearances by the latest one', () => {
      const todo = only(
        todos({
          injuries: [
            injury({ waiting_for_me: true, last_update_at: '2026-10-17T04:00:00Z' }),
            injury({ id: 'i2', waiting_for_me: true, last_update_at: '2026-10-14T04:00:00Z' }),
          ],
        }),
      );
      expect(todo.alert).toEqual({ level: 'amber', label: 'Important' });
      expect(
        only(
          todos({
            injuries: [
              injury({ waiting_for_me: true, last_update_at: '2026-10-17T04:00:00Z' }),
              injury({ id: 'i2', waiting_for_me: true, last_update_at: '2026-10-01T04:00:00Z' }),
            ],
          }),
        ).alert,
      ).toEqual({ level: 'red', label: 'Urgent' });
    });

    it('groups several clearances and names each athlete once', () => {
      const todo = only(
        todos({
          injuries: [
            injury({ id: 'a', waiting_for_me: true, athlete_name: 'Sam' }),
            injury({ id: 'b', waiting_for_me: true, athlete_name: 'Jo' }),
            injury({ id: 'c', waiting_for_me: true, athlete_name: 'Sam' }),
            injury({ id: 'd', waiting_for_me: false, athlete_name: 'Alex' }),
          ],
        }),
      );
      expect(todo.title).toBe('Review 3 injury clearances');
      expect(todo.detail).toBe('Sam and Jo are waiting for your sign-off to return');
      expect(todo.href).toBe('/injuries');
    });

    it('asks for an update once the expected return has come', () => {
      const own = injury({ id: 'own', athlete_id: 'me', can_report: true, expected_return: '2026-10-18' });
      const child = injury({ id: 'kid', athlete_id: 'kid', athlete_name: 'Jo', can_report: true, expected_return: '2026-10-10' });
      const list = todos({ injuries: [own, child] });
      expect(list.map((t) => [t.title, t.dueOn, t.alert?.level])).toEqual([
        ['Update your ankle injury', '2026-10-18', 'amber'],
        ['Update Jo’s ankle injury', '2026-10-10', 'red'],
      ]);
      expect(list[0].detail).toBe(
        `Expected back ${formatDateString('2026-10-18')}. Ask for clearance or change the date.`,
      );
    });

    it('leaves out injuries not yet due back, without a date, already moving, or not theirs to update', () => {
      expect(
        todos({
          injuries: [
            injury({ can_report: true, expected_return: '2026-10-19' }),
            injury({ can_report: true, expected_return: null }),
            injury({ can_report: true, expected_return: '2026-10-01', status: 'clearance_requested' }),
            injury({ can_report: false, expected_return: '2026-10-01' }),
          ],
        }),
      ).toEqual([]);
    });
  });

  describe('game goals', () => {
    it('asks for goals before the next game', () => {
      const todo = only(todos({ goals: { next: goalGame(), recent: [] } }));
      expect(todo).toMatchObject({
        key: 'game-goals',
        title: 'Set your goals for Round 3 v Swans',
        dueOn: '2026-10-20',
        alert: { level: 'amber', label: 'Due soon' },
        href: { pathname: '/goals/game', params: { athlete: 'me', fixture: 'f1' } },
      });
      expect(todo.detail).toMatch(/goals close when the game starts$/);
    });

    it('does not ask once goals are set or the game has started', () => {
      expect(todos({ goals: { next: goalGame({ goal_count: 1 }), recent: [] } })).toEqual([]);
      expect(
        todos({ goals: { next: goalGame({ goals_close_at: at(18, 11), played_at: at(18, 13) }), recent: [] } }),
      ).toEqual([]);
    });

    it('asks for a reflection on each game in the last week, oldest first', () => {
      const recent = [
        goalGame({ fixture_id: 'new', round_name: 'Round 2', played_at: at(17), goal_count: 2, reflected_count: 1 }),
        goalGame({ fixture_id: 'old', round_name: 'Round 1', played_at: at(12), goal_count: 1 }),
        goalGame({ fixture_id: 'done', played_at: at(16), goal_count: 2, reflected_count: 2 }),
        goalGame({ fixture_id: 'none', played_at: at(16), goal_count: 0 }),
        goalGame({ fixture_id: 'stale', played_at: at(11, 11), goal_count: 1 }),
      ];
      const list = todos({ goals: { next: null, recent } });
      expect(keys(list)).toEqual(['game-reflection-old', 'game-reflection-new']);
      expect(list[0].title).toBe('Reflect on Round 1 v Swans');
    });

    it('asks coaches for team goals before the next game only', () => {
      const list = todos({
        teamGames: [
          teamGame(),
          teamGame({ fixture_id: 'set', goal_count: 2 }),
          teamGame({ fixture_id: 'last', is_next: false }),
          teamGame({ fixture_id: 'started', goals_close_at: at(18, 9), played_at: at(18, 10) }),
        ],
      });
      const todo = only(list);
      expect(todo).toMatchObject({
        key: 'team-goals-f9',
        title: 'Set team goals for Open A',
        href: { pathname: '/goals/team', params: { fixture: 'f9' } },
        dueOn: '2026-10-25',
      });
      expect(todo.alert).toBeUndefined();
    });

    it('asks coaches to comment on reflections when a group is given', () => {
      expect(only(todos({ goalReflectionsToAnswer: 1, goalCommentsTeamId: 't1' }))).toMatchObject({
        title: 'Comment on 1 goal reflection',
        href: { pathname: '/team/[id]', params: { id: 't1' } },
      });
      expect(only(todos({ goalReflectionsToAnswer: 4, goalCommentsTeamId: 't1' })).title).toBe(
        'Comment on 4 goal reflections',
      );
      expect(todos({ goalReflectionsToAnswer: 4 })).toEqual([]);
    });
  });

  describe('award votes', () => {
    it('opens a single vote', () => {
      expect(only(todos({ awardSlots: [slot(), slot({ award_id: 'x', voted: true })] }))).toEqual({
        key: 'award-vote',
        title: 'Vote for MVP',
        detail: 'Open A · Round 3 v Rockets',
        href: {
          pathname: '/awards/vote',
          params: { award: 'aw1', team: 't1', fixture: 'f1', preseason: '' },
        },
      });
    });

    it('passes a preseason vote and fills in missing ids', () => {
      const todo = only(
        todos({ awardSlots: [slot({ team_id: null, team_name: null, fixture_id: null, preseason: true })] }),
      );
      expect(todo.detail).toBe('Preseason');
      expect(todo.href).toEqual({
        pathname: '/awards/vote',
        params: { award: 'aw1', team: '', fixture: '', preseason: '1' },
      });
    });

    it('says voting is open when there is nothing else to say', () => {
      expect(
        only(todos({ awardSlots: [slot({ team_name: null, fixture_label: null })] })).detail,
      ).toBe('Voting is open');
    });

    it('groups several votes', () => {
      expect(only(todos({ awardSlots: [slot(), slot({ award_id: 'b' })] }))).toMatchObject({
        title: 'Vote in 2 awards',
        href: '/awards',
      });
    });
  });

  describe('integrity training', () => {
    it('lists up to two courses, soonest first', () => {
      const list = todos({
        training: [
          course({ requirement_id: 'late', name: 'Anti-doping', due_on: '2026-12-01' }),
          course({ requirement_id: 'soon', name: 'Safeguarding', due_on: '2026-10-19' }),
          course({ requirement_id: 'done', status: 'approved' }),
          course({ requirement_id: 'waiting', status: 'submitted' }),
        ],
      });
      expect(list.map((t) => [t.title, t.alert?.level])).toEqual([
        ['Complete Safeguarding', 'amber'],
        ['Complete Anti-doping', undefined],
      ]);
      expect(list[0].href).toEqual({
        pathname: '/training/submit',
        params: { profile: 'me', requirement: 'soon' },
      });
      expect(list[0].detail).toBe(`Due ${formatDateString('2026-10-19')} · then upload the certificate`);
    });

    it('names a child and a certificate sent back', () => {
      const list = todos({
        training: [
          course({ is_me: false, profile_id: 'kid', profile_name: 'Jo', due_on: '2026-10-01' }),
          course({ requirement_id: 'r2', status: 'sent_back', review_note: 'Wrong course', due_on: '2026-11-01' }),
        ],
      });
      expect(list.map((t) => [t.title, t.detail])).toEqual([
        ['Complete Safeguarding for Jo', `Overdue since ${formatDateString('2026-10-01')} · then upload the certificate`],
        ['Upload your Safeguarding certificate again', 'Sent back: Wrong course'],
      ]);
      expect(list[0].alert).toEqual({ level: 'red', label: 'Overdue' });
    });

    it('names a child whose certificate was sent back without a note', () => {
      const todo = only(
        todos({ training: [course({ is_me: false, profile_name: 'Jo', status: 'sent_back', due_on: '2026-11-01' })] }),
      );
      expect(todo.title).toBe('Upload Jo’s Safeguarding certificate again');
      expect(todo.detail).toBe(`Due ${formatDateString('2026-11-01')} · then upload the certificate`);
    });

    it('makes more than two courses one item', () => {
      const todo = only(
        todos({
          training: [
            course({ requirement_id: 'a', due_on: '2026-11-03' }),
            course({ requirement_id: 'b', due_on: '2026-11-01' }),
            course({ requirement_id: 'c', due_on: '2026-11-02' }),
          ],
        }),
      );
      expect(todo).toMatchObject({
        key: 'training',
        title: 'Complete 3 integrity training courses',
        href: '/training',
        dueOn: '2026-11-01',
      });
      expect(todo.detail).toBe(`Due ${formatDateString('2026-11-01')} · upload each certificate when done`);
    });

    it('says whose courses they are for a parent', () => {
      const todo = only(
        todos({
          training: [
            course({ requirement_id: 'a' }),
            course({ requirement_id: 'b', is_me: false, profile_name: 'Jo' }),
            course({ requirement_id: 'c', is_me: false, profile_name: 'Sam' }),
            course({ requirement_id: 'd', is_me: false, profile_name: 'Jo' }),
          ],
        }),
      );
      expect(todo.title).toBe('Complete 4 integrity training courses for you, Jo and Sam');
    });

    it('counts certificates to check', () => {
      expect(only(todos({ certificatesToCheck: 1 })).title).toBe('Check 1 training certificate');
      expect(only(todos({ certificatesToCheck: 2 })).title).toBe('Check 2 training certificates');
    });
  });

  it('counts join requests', () => {
    expect(only(todos({ pendingCount: 1 })).title).toBe('Approve 1 join request');
    expect(only(todos({ pendingCount: 3 })).title).toBe('Approve 3 join requests');
  });

  describe('child-safety follow-ups', () => {
    it('adds nothing when all is well', () => {
      expect(todos({ safety: safety() })).toEqual([]);
    });

    it('lists each follow-up in order', () => {
      const list = todos({
        safety: safety({
          minors_without_guardian: 1,
          athletes_without_date_of_birth: 2,
          wwcc_missing: 1,
          notices_to_report: 1,
          wwc_officer_missing: 1,
          exemptions_ending: 2,
          turning_18: 1,
          records_removal_off: true,
          inactive_members: 3,
        }),
      });
      expect(list.map((t) => t.title)).toEqual([
        '1 athlete under 18 locked out',
        'Add a date of birth for 2 athletes',
        'Sort out 1 Working With Children Check',
        'Tell the governing body about 1 Screening Unit notice',
        'Choose a WWC Registration Officer',
        '2 volunteer exemptions end soon',
        '1 athlete turns 18 this month',
        'Old records are kept forever',
        '3 members have had no team or role for 2 years',
      ]);
    });

    it('asks for an empty safeguarding post to be named, saying admins act meanwhile', () => {
      const list = todos({
        safety: safety({ child_safety_officer_missing: 1, complaints_manager_missing: 1 }),
      });
      expect(list.map((t) => [t.key, t.title, t.detail, t.href])).toEqual([
        [
          'child-safety-officer',
          'Name a Child Safety Officer',
          'Nobody with a current check holds it, so admins act in it. Under Safeguarding',
          '/admin/safeguarding',
        ],
        [
          'complaints-manager',
          'Name a Complaints Manager',
          'Nobody with a current check holds it, so admins act in it. Under Safeguarding',
          '/admin/safeguarding',
        ],
      ]);
    });

    it('opens the people each member to-do is about, never the whole member list', () => {
      const list = todos({
        pendingCount: 2,
        safety: safety({
          minors_without_guardian: 1,
          athletes_without_date_of_birth: 1,
          wwcc_missing: 1,
          wwcc_applications_due: 1,
          notices_to_report: 1,
          unendorsable_clearances: ['Kai Senior'],
          exemptions_ending: 1,
          turning_18: 1,
          inactive_members: 1,
        }),
      });
      const opens = Object.fromEntries(list.map((t) => [t.key, t.href]));
      const members = (todo: string) => ({ pathname: '/admin', params: { todo } });
      expect(opens).toEqual({
        'join-requests': members('join'),
        'minors-without-guardian': members('locked'),
        'no-date-of-birth': members('dob'),
        wwcc: members('wwcc'),
        'wwcc-applications': members('wwcc-application'),
        'notices-to-report': members('notice'),
        'unendorsable-clearances': members('unendorsable'),
        'exemptions-ending': members('exemption-ending'),
        'turning-18': members('turning-18'),
        'inactive-members': members('inactive'),
      });
      expect(list.map((t) => t.href)).not.toContain('/admin');
    });

    it('warns in red when the nightly removal has stopped, since it last finished', () => {
      const todo = only(todos({ safety: safety({ records_removal_stalled: { last_ok_at: '2026-01-05T04:00:00Z' } }) }));
      expect(todo).toMatchObject({
        key: 'records-removal-stalled',
        detail: 'The nightly removal hasn’t finished for 2 days. Ask FirstPass to check it.',
        href: '/admin/club/records',
        alert: { level: 'red', label: 'Stopped' },
      });
      expect(todo.title).toMatch(/^Old records haven’t been removed since \S.*(5.*Jan|Jan.*5)/);
    });

    it('says the nightly removal hasn’t finished yet when it never has', () => {
      expect(only(todos({ safety: safety({ records_removal_stalled: { last_ok_at: null } }) })).title).toBe(
        'Old records haven’t been removed yet',
      );
    });

    it('adds no removal warning while it runs', () => {
      expect(todos({ safety: safety({ records_removal_stalled: null }) })).toEqual([]);
    });

    it('lists a stopped removal after Remove old records, and sorts it first as a red warning', () => {
      const list = todos({
        safety: safety({ turning_18: 1, records_removal_stalled: { last_ok_at: null } }),
      });
      expect(list.map((t) => t.key)).toEqual(['turning-18', 'records-removal-stalled']);
      expect(sortByAlert(list, (t) => t.alert, (t) => t.dueOn).map((t) => t.key)).toEqual([
        'records-removal-stalled',
        'turning-18',
      ]);
    });

    it('names the athlete when one clearance has nobody to endorse it', () => {
      expect(only(todos({ safety: safety({ unendorsable_clearances: ['Kai Senior'] }) }))).toEqual({
        key: 'unendorsable-clearances',
        title: 'Nobody can endorse Kai Senior’s clearance',
        detail: 'Make a physio Head Physio, or place a physio in their squad or team',
        href: { pathname: '/admin', params: { todo: 'unendorsable' } },
        alert: { level: 'amber', label: 'Stuck' },
      });
    });

    it('counts clearances when several have nobody to endorse them', () => {
      expect(only(todos({ safety: safety({ unendorsable_clearances: ['A', 'B'] }) })).title).toBe(
        'Nobody can endorse 2 clearances',
      );
    });

    it('adds no clearance tile when every clearance has someone to endorse it', () => {
      expect(todos({ safety: safety({ unendorsable_clearances: [] }) })).toEqual([]);
    });

    it('makes one red check tile when any card is missing or expired', () => {
      const todo = only(
        todos({ safety: safety({ wwcc_missing: 1, wwcc_expiring: 2, wwcc_to_validate: 1, wwcc_to_link: 0, wwcc_people: 3 }) }),
      );
      expect(todo).toMatchObject({
        key: 'wwcc',
        title: 'Sort out 3 Working With Children Checks',
        detail: '1 missing or expired, 2 expiring, 1 to validate',
        alert: { level: 'red', label: 'Missing' },
      });
    });

    it('adds up the counts when the database does not count people', () => {
      expect(only(todos({ safety: safety({ wwcc_expiring: 1, wwcc_to_link: 2 }) })).title).toBe(
        'Sort out 3 Working With Children Checks',
      );
    });

    it('asks admins to confirm check applications are still being assessed', () => {
      expect(only(todos({ safety: safety({ wwcc_applications_due: 1 }) }))).toEqual({
        key: 'wwcc-applications',
        title: 'Confirm 1 check application is still being assessed',
        detail: 'Check online, then confirm on the member’s page',
        href: { pathname: '/admin', params: { todo: 'wwcc-application' } },
        alert: { level: 'amber', label: 'Confirm' },
      });
    });

    it('turns the applications tile red, counting lapsed ones too, once any has lapsed', () => {
      expect(
        only(todos({ safety: safety({ wwcc_applications_due: 1, wwcc_applications_lapsed: 2 }) })),
      ).toEqual({
        key: 'wwcc-applications',
        title: 'Confirm 3 check applications are still being assessed',
        detail: '2 lapsed. Check online, then confirm on the member’s page.',
        href: { pathname: '/admin', params: { todo: 'wwcc-application' } },
        alert: { level: 'red', label: 'Lapsed' },
      });
      expect(only(todos({ safety: safety({ wwcc_applications_lapsed: 1 }) })).title).toBe(
        'Confirm 1 check application is still being assessed',
      );
    });

    it('asks admins to check cards members sent in, after the checks tile', () => {
      expect(only(todos({ safety: safety({ wwcc_submitted: 1 }) }))).toEqual({
        key: 'wwcc-sent',
        title: 'Check 1 Working With Children Check members sent in',
        detail: 'Check each card with the Screening Unit, then accept it or send it back',
        href: { pathname: '/admin', params: { todo: 'wwcc-sent' } },
        alert: { level: 'amber', label: 'Check' },
      });
      expect(only(todos({ safety: safety({ wwcc_submitted: 3 }) })).title).toBe(
        'Check 3 Working With Children Checks members sent in',
      );
      expect(todos({ safety: safety({ wwcc_submitted: 0 }) })).toEqual([]);
      expect(
        keys(todos({ safety: safety({ wwcc_missing: 1, wwcc_submitted: 1, wwcc_applications_due: 1 }) })),
      ).toEqual(['wwcc', 'wwcc-sent', 'wwcc-applications']);
    });

    it('adds no applications tile when none is due', () => {
      expect(
        todos({ safety: safety({ wwcc_applications_due: 0, wwcc_applications_lapsed: 0 }) }),
      ).toEqual([]);
    });

    it('puts the applications tile after the checks tile and before notices', () => {
      expect(
        keys(
          todos({
            safety: safety({ wwcc_missing: 1, wwcc_applications_due: 1, notices_to_report: 1 }),
          }),
        ),
      ).toEqual(['wwcc', 'wwcc-applications', 'notices-to-report']);
    });

    it('makes the check tile amber, naming the most urgent kind', () => {
      const alert = (s: Partial<SafetyTodos>) => only(todos({ safety: safety(s) })).alert;
      expect(alert({ wwcc_expiring: 1, wwcc_to_validate: 1 })).toEqual({ level: 'amber', label: 'Expiring' });
      expect(alert({ wwcc_to_validate: 1, wwcc_to_link: 1 })).toEqual({ level: 'amber', label: 'Validate' });
      expect(alert({ wwcc_to_link: 1 })).toEqual({ level: 'amber', label: 'Register' });
    });
  });

  describe('KPI reviews', () => {
    it('goes straight to the person when there is one review to write', () => {
      expect(only(todos({ kpiReviews: [review()] }))).toEqual({
        key: 'kpi-review-pt1:t1',
        title: 'Write Alex Kim’s KPI review',
        detail: `Mid-season · Open A · Due ${formatDateString('2026-11-01')}`,
        href: { pathname: '/kpis/person', params: { profile: 'p1', team: 't1' } },
        dueOn: '2026-11-01',
      });
    });

    it('groups reviews by review date and group', () => {
      const list = todos({
        kpiReviews: [
          review({ due_on: '2026-10-10' }),
          review({ profile_id: 'p2', full_name: 'Jo', due_on: '2026-10-10' }),
          review({ team_id: 't2', team_name: 'Open B', due_on: '2026-10-10' }),
        ],
      });
      expect(list.map((t) => [t.key, t.title, t.alert?.level])).toEqual([
        ['kpi-review-pt1:t1', 'Write 2 KPI reviews', 'red'],
        ['kpi-review-pt1:t2', 'Write Alex Kim’s KPI review', 'red'],
      ]);
      expect(list[0].detail).toBe(`Mid-season · Open A · Was due ${formatDateString('2026-10-10')}`);
      expect(list[0].href).toBe('/kpis');
    });

    it('asks the member to confirm their own reviews', () => {
      const todo = only(todos({ kpiReviews: [review({ kind: 'confirm', profile_id: 'me' })] }));
      expect(todo).toEqual({
        key: 'kpi-confirm-pt1:t1',
        title: 'Confirm your KPI review was done',
        detail: 'Mid-season · Open A',
        href: { pathname: '/kpis/person', params: { profile: 'me', team: 't1' } },
      });
    });
  });

  describe('surveys', () => {
    it('asks for open surveys the member has not answered', () => {
      const list = todos({
        surveys: [
          survey(),
          survey({ id: 's2', responded: true }),
          survey({ id: 's3', is_open: false }),
          survey({ id: 's4', for_child_names: ['Jo'] }),
        ],
      });
      expect(only(list)).toEqual({
        key: 'survey-s1',
        title: 'Answer the survey “Season survey”',
        detail: `Open until ${formatDateString('2026-10-29')}`,
        href: { pathname: '/surveys/[id]', params: { id: 's1' } },
        dueOn: '2026-10-29',
      });
    });

    it('says when everyone must answer and warns as it closes', () => {
      const todo = only(
        todos({ surveys: [survey({ everyone_answers: true, closes_at: new Date(2026, 9, 20).toISOString() })] }),
      );
      expect(todo.detail).toBe(`Everyone must answer. Open until ${formatDateString('2026-10-19')}`);
      expect(todo.alert).toEqual({ level: 'amber', label: 'Due soon' });
    });
  });

  it('keeps the daily items ahead of admin follow-ups', () => {
    const list = todos({
      needsCheckIn: true,
      pendingCount: 1,
      safety: safety({ minors_without_guardian: 1 }),
      consentsNeeded: [{ id: 'c1', name: 'Jo' }],
      newConcerns: 1,
      awardSlots: [slot()],
    });
    expect(keys(list)).toEqual([
      'concerns',
      'consent-c1',
      'check-in',
      'award-vote',
      'join-requests',
      'minors-without-guardian',
    ]);
  });
});

describe('medical details', () => {
  const review = (extra: Partial<MedicalReview>): MedicalReview => ({
    athlete_id: 'me',
    athlete_name: 'Sample Me',
    status: 'due_soon',
    due_on: '2026-11-10',
    ...extra,
  });

  it('asks an athlete to check their own once a year, by the day it’s due', () => {
    const todo = only(todos({ medicalReviews: [review({})] }));
    expect(todo).toEqual({
      key: 'medical-me',
      title: 'Check your medical details are still right',
      detail: `Once a year. Due ${formatDateString('2026-11-10')}`,
      href: { pathname: '/medical/[id]', params: { id: 'me' } },
      dueOn: '2026-11-10',
    });
  });

  it('names the child for a guardian', () => {
    expect(only(todos({ medicalReviews: [review({ athlete_id: 'kid', athlete_name: 'Kit Child' })] })).title).toBe(
      'Check Kit Child’s medical details are still right',
    );
  });

  it('warns amber in the last three days and red once overdue', () => {
    expect(only(todos({ medicalReviews: [review({ due_on: '2026-10-20' })] })).alert).toEqual({ level: 'amber', label: 'Due soon' });
    expect(only(todos({ medicalReviews: [review({ status: 'overdue', due_on: '2026-10-01' })] })).alert).toEqual({ level: 'red', label: 'Overdue' });
    expect(only(todos({ medicalReviews: [review({})] })).alert).toBeUndefined();
  });

  it('asks for them to be added when nothing is saved, with no due day', () => {
    const own = only(todos({ medicalReviews: [review({ status: 'missing', due_on: null })] }));
    expect(own.title).toBe('Add your medical and emergency details');
    expect(own.dueOn).toBeUndefined();
    expect(own.alert).toBeUndefined();
    expect(only(todos({ medicalReviews: [review({ athlete_id: 'kid', athlete_name: 'Kit Child', status: 'missing', due_on: null })] })).title).toBe(
      'Add Kit Child’s medical and emergency details',
    );
  });

  it('has one to-do per athlete, and none without reviews', () => {
    expect(keys(todos({ medicalReviews: [review({}), review({ athlete_id: 'kid', athlete_name: 'Kit' })] }))).toEqual(['medical-me', 'medical-kid']);
    expect(todos()).toEqual([]);
  });
});

describe('policy reviews and conflicts of interest', () => {
  const policy = (extra: Partial<PolicyReview> = {}): PolicyReview => ({
    id: 'p1',
    title: 'Child Safeguarding Policy',
    review_on: '2026-11-10',
    ...extra,
  });
  const declaration = (extra: Partial<MyConflictDeclaration> = {}): MyConflictDeclaration => ({
    required: true,
    season: 2026,
    has_conflict: null,
    details: null,
    declared_at: null,
    ...extra,
  });

  it('asks a policy’s owner to review it by its review date', () => {
    expect(only(todos({ policyReviews: [policy()] }))).toEqual({
      key: 'policy-p1',
      title: 'Review the Child Safeguarding Policy',
      detail: `Due ${formatDateString('2026-11-10')}`,
      href: { pathname: '/registers/review', params: { id: 'p1' } },
      dueOn: '2026-11-10',
    });
  });

  it('says a review was due once its day has passed, in red, and amber in the last three days', () => {
    const overdue = only(todos({ policyReviews: [policy({ review_on: '2026-10-01' })] }));
    expect(overdue.detail).toBe(`Was due ${formatDateString('2026-10-01')}`);
    expect(overdue.alert).toEqual({ level: 'red', label: 'Overdue' });
    const today = only(todos({ policyReviews: [policy({ review_on: '2026-10-18' })] }));
    expect(today.detail).toBe(`Due ${formatDateString('2026-10-18')}`);
    expect(today.alert).toEqual({ level: 'amber', label: 'Due soon' });
    expect(only(todos({ policyReviews: [policy()] })).alert).toBeUndefined();
  });

  it('has one to-do per policy', () => {
    expect(keys(todos({ policyReviews: [policy(), policy({ id: 'p2', title: 'Privacy Policy' })] }))).toEqual([
      'policy-p1',
      'policy-p2',
    ]);
  });

  it('asks committee members and coaches to declare once a season, even with none', () => {
    expect(only(todos({ conflictDeclaration: declaration() }))).toEqual({
      key: 'conflicts',
      title: 'Declare any conflicts of interest',
      detail: 'Once a season, for the 2026–27 season, even if you have none',
      href: '/declare-conflicts',
    });
  });

  it('stops asking once they declare, and never asks someone who doesn’t declare', () => {
    expect(todos({ conflictDeclaration: declaration({ declared_at: '2026-10-01T00:00:00Z', has_conflict: false }) })).toEqual([]);
    expect(todos({ conflictDeclaration: declaration({ required: false }) })).toEqual([]);
    expect(todos({ conflictDeclaration: null })).toEqual([]);
  });
});

describe('selection rounds', () => {
  const date = (extra: Partial<SelectionTodo> = {}): SelectionTodo => ({
    kind: 'date',
    round_id: 'r1',
    round_name: '2027 selection phase',
    milestone_id: 'm1',
    title: 'Teams named',
    due_on: '2026-10-24',
    athletes: null,
    for_admin: false,
    ...extra,
  });
  const thin = (extra: Partial<SelectionTodo> = {}): SelectionTodo =>
    date({ kind: 'thin', milestone_id: null, title: null, due_on: '2026-10-30', athletes: 3, ...extra });

  it('reminds a panel member of a date, opening the round’s athletes', () => {
    expect(only(todos({ selectionTodos: [date()] }))).toEqual({
      key: 'selection-date-m1',
      title: 'Teams named: 2027 selection phase',
      detail: `Due ${formatDateString('2026-10-24')}`,
      href: { pathname: '/assessments/round', params: { id: 'r1' } },
      dueOn: '2026-10-24',
    });
  });

  it('sends an admin who isn’t on the panel to the round’s set-up, to mark it done', () => {
    expect(only(todos({ selectionTodos: [date({ for_admin: true })] }))).toMatchObject({
      detail: `Due ${formatDateString('2026-10-24')}. Mark it done when it is`,
      href: { pathname: '/admin/assessments/round', params: { id: 'r1' } },
    });
  });

  it('says a date was due once its day has passed, in red, and amber in the last three days', () => {
    const overdue = only(todos({ selectionTodos: [date({ due_on: '2026-10-17' })] }));
    expect(overdue.detail).toBe(`Was due ${formatDateString('2026-10-17')}`);
    expect(overdue.alert).toEqual({ level: 'red', label: 'Overdue' });
    const today = only(todos({ selectionTodos: [date({ due_on: '2026-10-18' })] }));
    expect(today.detail).toBe(`Due ${formatDateString('2026-10-18')}`);
    expect(today.alert).toEqual({ level: 'amber', label: 'Due soon' });
    expect(only(todos({ selectionTodos: [date()] })).alert).toBeUndefined();
  });

  it('falls back to a plain name for a date without one', () => {
    expect(only(todos({ selectionTodos: [date({ title: null })] })).title).toBe('Selection date: 2027 selection phase');
  });

  it('counts the athletes with nothing written as a round runs out, and never names them', () => {
    expect(only(todos({ selectionTodos: [thin()] }))).toEqual({
      key: 'selection-thin-r1',
      title: '3 athletes have nothing written yet: 2027 selection phase',
      detail: `The round ends ${formatDateString('2026-10-30')}`,
      href: { pathname: '/assessments/round', params: { id: 'r1' } },
      dueOn: '2026-10-30',
    });
    expect(only(todos({ selectionTodos: [thin({ athletes: 1 })] })).title).toBe(
      '1 athlete has nothing written yet: 2027 selection phase',
    );
    expect(only(todos({ selectionTodos: [thin({ athletes: null })] })).title).toBe(
      '0 athletes have nothing written yet: 2027 selection phase',
    );
  });

  const summaries = (extra: Partial<SelectionTodo> = {}): SelectionTodo =>
    date({ kind: 'summaries', milestone_id: null, title: null, due_on: '2026-10-24', athletes: 4, ...extra });

  it('counts the summaries a selector still has to sign as the round ends, and never names anyone', () => {
    expect(only(todos({ selectionTodos: [summaries()] }))).toEqual({
      key: 'selection-summaries-r1',
      title: 'Sign your 4 summaries: 2027 selection phase',
      detail: `The round ends ${formatDateString('2026-10-24')}`,
      href: { pathname: '/assessments/round', params: { id: 'r1' } },
      dueOn: '2026-10-24',
    });
    expect(only(todos({ selectionTodos: [summaries({ athletes: 1 })] })).title).toBe(
      'Sign your summary: 2027 selection phase',
    );
    expect(only(todos({ selectionTodos: [summaries({ athletes: null })] })).title).toBe(
      'Sign your 0 summaries: 2027 selection phase',
    );
  });

  it('keeps the summaries to-do, in red, once the round’s last day has passed', () => {
    const late = only(todos({ selectionTodos: [summaries({ due_on: '2026-10-17' })] }));
    expect(late.detail).toBe(`The round ended ${formatDateString('2026-10-17')}`);
    expect(late.alert).toEqual({ level: 'red', label: 'Overdue' });
    expect(only(todos({ selectionTodos: [summaries({ due_on: '2026-10-18' })] })).detail).toBe(
      `The round ends ${formatDateString('2026-10-18')}`,
    );
  });

  it('leaves out a kind of selection to-do this version doesn’t know', () => {
    const unknown = { ...date(), kind: 'feedback' } as unknown as SelectionTodo;
    expect(todos({ selectionTodos: [unknown] })).toEqual([]);
    expect(keys(todos({ selectionTodos: [unknown, thin(), summaries()] }))).toEqual([
      'selection-thin-r1',
      'selection-summaries-r1',
    ]);
  });

  it('has one to-do per date and one per round, and none without any', () => {
    expect(
      keys(todos({ selectionTodos: [date(), date({ milestone_id: 'm2' }), thin(), thin({ round_id: 'r2' })] })),
    ).toEqual(['selection-date-m1', 'selection-date-m2', 'selection-thin-r1', 'selection-thin-r2']);
    expect(todos({ selectionTodos: [] })).toEqual([]);
    expect(todos()).toEqual([]);
  });
});

describe('suggested events', () => {
  it('asks an admin to answer the ones waiting, by how many', () => {
    const todo = only(todos({ eventSuggestions: 1 }));
    expect(todo).toMatchObject({
      key: 'event-suggestions',
      title: 'Answer 1 suggested event',
      detail: 'Add them to the calendar, or decline with a reason',
      href: '/admin/event-suggestions',
    });
    expect(only(todos({ eventSuggestions: 3 })).title).toBe('Answer 3 suggested events');
  });

  it('asks nothing when none wait', () => {
    expect(todos({ eventSuggestions: 0 })).toEqual([]);
    expect(todos()).toEqual([]);
  });

  it('tells the member each suggestion of theirs that wasn’t added, and opens it', () => {
    const list = todos({
      declinedEvents: [
        { id: 'hq-event:a', title: 'Trivia night' },
        { id: 'hq-event:b', title: 'Working bee' },
      ],
    });
    expect(keys(list)).toEqual(['event-declined-hq-event:a', 'event-declined-hq-event:b']);
    expect(list[0]).toMatchObject({
      title: '“Trivia night” wasn’t added to the calendar',
      detail: 'See why, then clear it away',
      href: { pathname: '/event/[id]', params: { id: 'hq-event:a' } },
    });
  });
});
