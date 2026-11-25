/**
 * The words on the cards that sit on Today, in the hubs and in Me
 * (src/lib/home-labels.ts). The paused-role sentences are covered where they
 * show, in src/__tests__/home-states.test.tsx.
 */
import {
  awardsLabel,
  consentSummary,
  kpisLabel,
  sortMemberships,
  trainingLabel,
  waitsOnDeclaration,
} from '@/lib/home-labels';
import type { KpiPerson } from '@/lib/kpis';
import type { MyTraining } from '@/lib/training';
import type { TeamMembership } from '@/lib/types';

// The modules these words come from load auth and club context, which need native storage.
jest.mock('@/lib/auth', () => ({ useAuth: jest.fn() }));
jest.mock('@/lib/club', () => ({ useClub: jest.fn(), useFeature: jest.fn() }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));

describe('awardsLabel', () => {
  it.each([
    [1, 1, '1 vote waiting for you'],
    [3, 2, '2 votes waiting for you'],
    [1, 0, '✓ You’ve voted in all open award'],
    [4, 0, '✓ You’ve voted in all 4 open awards'],
  ])('%i open, %i to vote: %s', (open, toVote, label) => {
    expect(awardsLabel(open, toVote)).toBe(label);
  });
});

describe('trainingLabel', () => {
  const row = (status: MyTraining['status']) => ({ status }) as MyTraining;

  it('counts what the member still has to complete, sent back included', () => {
    expect(trainingLabel([row('to_do'), row('sent_back'), row('to_do')], 0)).toBe('3 still to complete');
  });

  it('says when all of it is in', () => {
    expect(trainingLabel([row('accepted' as MyTraining['status'])], 0)).toBe('✓ All your training is in');
  });

  it('adds the certificates waiting for the committee or an admin to check', () => {
    expect(trainingLabel([row('to_do')], 1)).toBe('1 still to complete · 1 certificate to check');
    expect(trainingLabel([], 4)).toBe('4 certificates to check');
  });

  it('with nothing of their own and nothing to check, says what the card is for', () => {
    expect(trainingLabel([], 0)).toBe('Certificates and everyone’s progress');
  });
});

describe('kpisLabel', () => {
  const person = (profile_id: string, relation: KpiPerson['relation'], extra: Partial<KpiPerson> = {}) =>
    ({ profile_id, relation, kpi_count: 1, archived: false, ...extra }) as KpiPerson;

  it('counts the member’s own', () => {
    expect(kpisLabel([person('me', 'self', { kpi_count: 3 })])).toBe('3 of yours');
  });

  it('names a parent’s child, or children', () => {
    expect(kpisLabel([person('c1', 'guardian')])).toBe('Your child’s');
    expect(kpisLabel([person('c1', 'guardian'), person('c2', 'guardian')])).toBe('Your children’s');
  });

  it('counts each person a coach sets them for once, however many teams they share', () => {
    expect(kpisLabel([person('a1', 'setter'), person('a1', 'setter'), person('a2', 'setter')])).toBe(
      '2 people you set them for',
    );
    expect(kpisLabel([person('a1', 'setter')])).toBe('1 person you set them for');
  });

  it('puts them together, the member’s own first', () => {
    expect(
      kpisLabel([person('a1', 'setter'), person('c1', 'guardian'), person('me', 'self', { kpi_count: 2 })]),
    ).toBe('2 of yours · Your child’s · 1 person you set them for');
  });

  it('leaves out an archived season, and says what the card is for with nothing current', () => {
    expect(kpisLabel([person('me', 'self', { archived: true })])).toBe(
      'What each person is working to achieve this season',
    );
    expect(kpisLabel([person('me', 'viewer')])).toBe('What each person is working to achieve this season');
  });
});

describe('sortMemberships', () => {
  const group = (name: string, kind: 'team' | 'squad', sort_order: number) =>
    ({ team_role: 'athlete', team: { id: name, name, kind, sort_order } }) as unknown as TeamMembership;

  it('puts named teams before squads, each in the club’s order, then by name', () => {
    const list = [
      group('Open squad', 'squad', 1),
      group('Open B', 'team', 2),
      group('Under 20s squad', 'squad', 0),
      group('Open A', 'team', 2),
      group('Under 20s', 'team', 1),
    ];
    expect(sortMemberships(list).map((m) => m.team.name)).toEqual([
      'Under 20s',
      'Open A',
      'Open B',
      'Under 20s squad',
      'Open squad',
    ]);
  });

  it('leaves the list it was given as it was', () => {
    const list = [group('B', 'squad', 0), group('A', 'team', 0)];
    sortMemberships(list);
    expect(list.map((m) => m.team.name)).toEqual(['B', 'A']);
  });
});

describe('waitsOnDeclaration', () => {
  it('is true for an exemption the member hasn’t accepted the declaration for', () => {
    expect(waitsOnDeclaration({ declared_at: null } as never, null)).toBe(true);
    expect(waitsOnDeclaration({ declared_at: '2026-10-01T00:00:00Z' } as never, null)).toBe(false);
  });

  it('is true for an application waiting for its declaration, and only then', () => {
    const application = (status: string, declared_at: string | null) => ({ status, declared_at }) as never;
    expect(waitsOnDeclaration(null, application('waiting_for_declaration', null))).toBe(true);
    expect(waitsOnDeclaration(null, application('lapsed', null))).toBe(false);
    expect(waitsOnDeclaration(null, application('waiting_for_declaration', '2026-10-01T00:00:00Z'))).toBe(false);
    expect(waitsOnDeclaration(null, null)).toBe(false);
  });
});

describe('consentSummary', () => {
  const child = (extra: Partial<Parameters<typeof consentSummary>[0]>) => ({
    data: false,
    health: false,
    canConsent: true,
    checkInsOn: true,
    ...extra,
  });

  it.each([
    [child({}), 'Check-ins: not given · Injuries: not given'],
    [child({ data: true }), 'Check-ins: yes · Injuries: not given'],
    [child({ data: true, health: true }), 'Check-ins: yes · Injuries: yes'],
    // Check-ins are left out while they are off for the child and none was given.
    [child({ checkInsOn: false, health: true }), 'Injuries: yes'],
    // A consent given before they were switched off still shows.
    [child({ checkInsOn: false, data: true }), 'Check-ins: yes · Injuries: not given'],
    [child({ canConsent: false }), 'Waiting for an admin to verify you'],
    // Consents already given show even while the parent waits to be verified again.
    [child({ canConsent: false, health: true }), 'Check-ins: not given · Injuries: yes'],
  ])('%j reads "%s"', (a, summary) => {
    expect(consentSummary(a)).toBe(summary);
  });
});
