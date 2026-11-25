/**
 * A parent's children in Family ("Your children" in section 5 of
 * docs/user-guide.md): what each child's card says, and what the child's page
 * links to. Who may open each linked screen is that screen's rule, tested
 * with the screen; this only checks what is offered and in what order.
 */
import {
  changesLabel,
  childLinks,
  childStatus,
  toMyChild,
  type ChildFacts,
  type MyChild,
} from '@/lib/children';

jest.mock('@/lib/auth', () => ({ useAuth: jest.fn() }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/club', () => ({ useClub: jest.fn() }));

const CHILD: MyChild = {
  id: 'child-1',
  name: 'Sample Child',
  data: true,
  health: true,
  canConsent: true,
  checkInsOn: true,
  needsConsent: false,
  consentDetail: '',
};

const QUIET: ChildFacts = { newActivity: 0, injuries: [], medicalReviews: [] };
const ALL_ON = { goals: true, attendance: true, checkIns: true };

describe('a child from the database', () => {
  it('keeps their consents and works out whether one is needed', () => {
    expect(
      toMyChild({
        athlete_id: 'c1',
        full_name: 'Fifteen Locked',
        data: false,
        health: true,
        publish: false,
        can_consent: true,
      } as never),
    ).toEqual({
      id: 'c1',
      name: 'Fifteen Locked',
      data: false,
      health: true,
      canConsent: true,
      checkInsOn: true,
      needsConsent: true,
      consentDetail: 'Choose who sees their check-ins',
    });
  });

  it('names a child with no name on file', () => {
    expect(toMyChild({ athlete_id: 'c1', full_name: null } as never).name).toBe('Unnamed athlete');
  });
});

describe('a child’s card', () => {
  it('says where consent stands, and nothing else while all is quiet', () => {
    expect(childStatus(CHILD, QUIET)).toEqual([
      { key: 'consent', text: 'Check-ins: yes · Injuries: yes', attention: false },
    ]);
  });

  it('draws the eye to consent that still has to be given', () => {
    expect(childStatus({ ...CHILD, data: false, needsConsent: true }, QUIET)).toEqual([
      { key: 'consent', text: 'Check-ins: not given · Injuries: yes', attention: true },
    ]);
  });

  it('adds the child’s own current injuries, never a sibling’s', () => {
    const facts: ChildFacts = {
      ...QUIET,
      injuries: [
        { athlete_id: 'child-1', waiting_for_me: false },
        { athlete_id: 'child-1', waiting_for_me: true },
        { athlete_id: 'child-2', waiting_for_me: true },
      ],
    };
    expect(childStatus(CHILD, facts)[1]).toEqual({
      key: 'injuries',
      text: '2 current injuries · 1 waiting for you',
      attention: true,
    });
    expect(childStatus({ ...CHILD, id: 'child-3' }, facts).map((l) => l.key)).toEqual(['consent']);
  });

  it('says when medical details need adding or their yearly check, for that child only', () => {
    const facts: ChildFacts = {
      ...QUIET,
      medicalReviews: [
        { athlete_id: 'child-1', status: 'missing', due_on: null },
        { athlete_id: 'child-2', status: 'due_soon', due_on: '2026-11-02' },
      ] as ChildFacts['medicalReviews'],
    };
    expect(childStatus(CHILD, facts)[1]).toEqual({
      key: 'medical',
      text: 'Medical details to add',
      attention: true,
    });
    expect(childStatus({ ...CHILD, id: 'child-2' }, facts)[1].text).toMatch(
      /^Medical details to check by .*2026$/,
    );
  });

  it('counts the changes since the parent last looked', () => {
    expect(childStatus(CHILD, { ...QUIET, newActivity: 1 })[1]).toEqual({
      key: 'changes',
      text: '1 change since you last looked',
      attention: true,
    });
    expect(changesLabel(3)).toBe('3 changes since you last looked');
  });

  it('keeps the lines in one order: consent, injuries, medical, changes', () => {
    const facts: ChildFacts = {
      newActivity: 2,
      injuries: [{ athlete_id: 'child-1', waiting_for_me: false }],
      medicalReviews: [{ athlete_id: 'child-1', status: 'missing', due_on: null }] as ChildFacts['medicalReviews'],
    };
    expect(childStatus(CHILD, facts).map((l) => l.key)).toEqual([
      'consent',
      'injuries',
      'medical',
      'changes',
    ]);
  });
});

describe('a child’s page', () => {
  const links = (over: Partial<Parameters<typeof childLinks>[1]> = {}, child = CHILD) =>
    childLinks(child, { features: ALL_ON, injuries: true, verified: true, facts: QUIET, ...over });

  it('offers everything a verified parent had on Home, in one order', () => {
    expect(links().map((l) => l.title)).toEqual([
      'Attendance',
      'Game goals',
      'Check-ins',
      'Injuries',
      'Consent',
      'Medical and emergency',
      'What’s changed',
      'Who has viewed their records',
    ]);
  });

  it('opens the screens those cards always opened, for this child', () => {
    expect(Object.fromEntries(links().map((l) => [l.key, l.href]))).toEqual({
      attendance: { pathname: '/attendance/family/[id]', params: { id: 'child-1', name: 'Sample Child' } },
      goals: {
        pathname: '/goals/athlete/[id]',
        params: { id: 'child-1', name: 'Sample Child', view: 'guardian' },
      },
      checkIns: { pathname: '/check-ins/athlete/[id]', params: { id: 'child-1', name: 'Sample Child' } },
      injuries: '/injuries',
      consent: { pathname: '/consent/[id]', params: { id: 'child-1' } },
      medical: { pathname: '/medical/[id]', params: { id: 'child-1' } },
      changes: { pathname: '/activity/[id]', params: { id: 'child-1', name: 'Sample Child' } },
      records: { pathname: '/records/[id]', params: { id: 'child-1', name: 'Sample Child' } },
    });
  });

  it('keeps medical details and record views for a verified parent', () => {
    const keys = links({ verified: false }).map((l) => l.key);
    expect(keys).not.toContain('medical');
    expect(keys).not.toContain('records');
    expect(keys).toEqual(['attendance', 'goals', 'checkIns', 'injuries', 'consent', 'changes']);
  });

  it.each([
    ['attendance', { goals: true, attendance: false, checkIns: true }],
    ['goals', { goals: false, attendance: true, checkIns: true }],
    ['checkIns', { goals: true, attendance: true, checkIns: false }],
  ] as const)('leaves %s out while the club has it switched off', (key, features) => {
    const keys = links({ features }).map((l) => l.key);
    expect(keys).not.toContain(key);
    expect(keys).toHaveLength(7);
  });

  it('leaves Injuries out while it is off or the parent may not see injuries', () => {
    expect(links({ injuries: false }).map((l) => l.key)).not.toContain('injuries');
  });

  it('always offers consent and what has changed', () => {
    const keys = links({
      features: { goals: false, attendance: false, checkIns: false },
      injuries: false,
      verified: false,
    }).map((l) => l.key);
    expect(keys).toEqual(['consent', 'changes']);
  });

  it('says where consent stands, and draws the eye when it is needed', () => {
    const consent = (child: MyChild) => links({}, child).find((l) => l.key === 'consent')!;
    expect(consent(CHILD)).toMatchObject({ detail: 'Check-ins: yes · Injuries: yes', attention: false });
    expect(consent({ ...CHILD, health: false, needsConsent: true })).toMatchObject({
      detail: 'Check-ins: yes · Injuries: not given',
      attention: true,
    });
  });

  it('counts new changes on What’s changed', () => {
    const changes = links({ facts: { ...QUIET, newActivity: 4 } }).find((l) => l.key === 'changes')!;
    expect(changes.badge).toBe(4);
  });

  it('shows this child’s injuries on Injuries, with those waiting for the parent', () => {
    const injuries = links({
      facts: {
        ...QUIET,
        injuries: [
          { athlete_id: 'child-1', waiting_for_me: true },
          { athlete_id: 'child-2', waiting_for_me: true },
        ],
      },
    }).find((l) => l.key === 'injuries')!;
    expect(injuries).toMatchObject({
      detail: '1 current injury · 1 waiting for you',
      attention: true,
      badge: 1,
    });
    expect(links().find((l) => l.key === 'injuries')).toMatchObject({
      detail: 'No current injuries',
      attention: false,
      badge: 0,
    });
  });

  it('says when medical details need the parent', () => {
    const medical = links({
      facts: {
        ...QUIET,
        medicalReviews: [{ athlete_id: 'child-1', status: 'missing', due_on: null }] as ChildFacts['medicalReviews'],
      },
    }).find((l) => l.key === 'medical')!;
    expect(medical).toMatchObject({ detail: 'Medical details to add', attention: true });
    expect(links().find((l) => l.key === 'medical')).toMatchObject({
      detail: 'Emergency contacts, allergies, conditions, medications and an action plan',
      attention: false,
    });
  });
});
