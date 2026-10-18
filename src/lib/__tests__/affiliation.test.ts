import {
  affiliationCriteria,
  isThisYear,
  officesFor,
  registrationsToCheck,
  returnDue,
  type Affiliation,
  type Officer,
} from '@/lib/affiliation';

// The modules load auth and club context, which need native storage.
jest.mock('@/lib/auth', () => ({ useAuth: jest.fn() }));
jest.mock('@/lib/club', () => ({ useClub: jest.fn() }));

// Sunday 18 October 2026, local time.
const TODAY = new Date(2026, 9, 18, 12);

function affiliation(overrides: Partial<Affiliation> = {}): Affiliation {
  return {
    member_type: 'club',
    tier: null,
    incorporation_number: null,
    affiliated_with: null,
    registered_on: null,
    primary_contact_1_id: null,
    primary_contact_1_name: null,
    primary_contact_2_id: null,
    primary_contact_2_name: null,
    checks: {},
    notes: null,
    updated_at: null,
    updated_by_name: null,
    season: 2026,
    team_count: 3,
    registrations_total: 0,
    registered: 0,
    not_registered: 0,
    ...overrides,
  };
}

function officer(office: Officer['office'], inducted_on: string | null = null): Officer {
  return { office, profile_id: office, name: office, inducted_on };
}

const byKey = (criteria: ReturnType<typeof affiliationCriteria>) =>
  Object.fromEntries(criteria.map((c) => [c.key, c]));

describe('isThisYear', () => {
  it('is true within the last 365 days', () => {
    expect(isThisYear('2026-10-18', TODAY)).toBe(true);
    expect(isThisYear('2025-10-18', TODAY)).toBe(true);
  });

  it('is false before that', () => {
    expect(isThisYear('2025-10-17', TODAY)).toBe(false);
  });

  it('is false with no date', () => {
    expect(isThisYear(null, TODAY)).toBe(false);
  });
});

describe('returnDue', () => {
  it('is not due until the club says where returns go', () => {
    expect(returnDue(null, TODAY)).toBe(false);
    expect(
      returnDue({ return_email: null, last_sent_at: null, last_sent_to: null, last_sent_by_name: null }, TODAY),
    ).toBe(false);
  });

  it('is due when none has been sent', () => {
    expect(
      returnDue(
        { return_email: 'returns@example.com', last_sent_at: null, last_sent_to: null, last_sent_by_name: null },
        TODAY,
      ),
    ).toBe(true);
  });

  it('is due a year after the last one', () => {
    const info = { return_email: 'returns@example.com', last_sent_to: null, last_sent_by_name: null };
    expect(returnDue({ ...info, last_sent_at: new Date(2026, 2, 1, 12).toISOString() }, TODAY)).toBe(false);
    expect(returnDue({ ...info, last_sent_at: new Date(2025, 9, 1, 12).toISOString() }, TODAY)).toBe(true);
  });
});

describe('officesFor', () => {
  it('names no offices without a tier', () => {
    expect(officesFor(null)).toEqual([]);
  });

  it('names the offices for each tier, in order', () => {
    expect(officesFor(1)).toEqual(['president', 'ado', 'audo', 'committee']);
    expect(officesFor(2)).toEqual(['president', 'ado', 'audo']);
    expect(officesFor(3)).toEqual(['president', 'ado', 'audo', 'committee']);
    expect(officesFor(4)).toEqual(['representative']);
  });
});

describe('registrationsToCheck', () => {
  it('counts members nobody has checked', () => {
    expect(registrationsToCheck(affiliation({ registrations_total: 20, registered: 12, not_registered: 3 }))).toBe(5);
  });

  it('never goes below zero', () => {
    expect(registrationsToCheck(affiliation({ registrations_total: 2, registered: 2, not_registered: 1 }))).toBe(0);
  });
});

describe('affiliationCriteria for clubs', () => {
  it('lists the club criteria, none met at first', () => {
    const criteria = affiliationCriteria(affiliation(), [], TODAY);
    expect(criteria.map((c) => c.key)).toEqual([
      'incorporated',
      'registered',
      'compliance',
      'contacts',
      'competition',
      'playhq',
    ]);
    expect(criteria.every((c) => !c.met)).toBe(true);
  });

  it('recommends incorporation under 5 teams and requires it from 5', () => {
    const small = byKey(affiliationCriteria(affiliation({ team_count: 4 }), [], TODAY));
    expect(small.incorporated.need).toBe('recommended');
    expect(small.incorporated.detail).toContain('(you have 4)');
    const big = byKey(affiliationCriteria(affiliation({ team_count: 5 }), [], TODAY));
    expect(big.incorporated.need).toBe('required');
    expect(big.incorporated.detail).toBe('Required for clubs with 5 or more teams. You have 5 this season.');
  });

  it('works out what is recorded', () => {
    const c = byKey(
      affiliationCriteria(
        affiliation({
          incorporation_number: 'A123',
          affiliated_with: 'Perth Netball',
          registered_on: '2026-03-01',
          primary_contact_1_id: 'p1',
          primary_contact_2_id: 'p2',
        }),
        [],
        TODAY,
      ),
    );
    expect(c.incorporated.met).toBe(true);
    expect(c.registered.met).toBe(true);
    expect(c.contacts.met).toBe(true);
  });

  it('needs the association and a registration this year', () => {
    const noAssociation = byKey(
      affiliationCriteria(affiliation({ affiliated_with: ' ', registered_on: '2026-03-01' }), [], TODAY),
    );
    expect(noAssociation.registered.met).toBe(false);
    const old = byKey(
      affiliationCriteria(affiliation({ affiliated_with: 'Perth Netball', registered_on: '2025-01-01' }), [], TODAY),
    );
    expect(old.registered.met).toBe(false);
  });

  it('needs both primary contacts', () => {
    const c = byKey(affiliationCriteria(affiliation({ primary_contact_1_id: 'p1' }), [], TODAY));
    expect(c.contacts.met).toBe(false);
  });

  it('does not count a blank incorporation number', () => {
    const c = byKey(affiliationCriteria(affiliation({ incorporation_number: '  ' }), [], TODAY));
    expect(c.incorporated.met).toBe(false);
  });

  it('uses the admin ticks for manual criteria', () => {
    const c = byKey(
      affiliationCriteria(affiliation({ checks: { compliance: true, playhq: false } }), [], TODAY),
    );
    expect(c.compliance).toMatchObject({ manual: true, met: true });
    expect(c.playhq).toMatchObject({ manual: true, met: false });
    expect(c.competition).toMatchObject({ manual: true, met: false });
    expect(c.incorporated.manual).toBe(false);
  });
});

describe('affiliationCriteria for associations', () => {
  const association = (tier: Affiliation['tier'], overrides: Partial<Affiliation> = {}) =>
    affiliation({ member_type: 'association', tier, ...overrides });

  it('lists nothing until a tier is chosen', () => {
    expect(affiliationCriteria(association(null), [], TODAY)).toEqual([]);
  });

  it('lists every criterion for tiers 1 to 3', () => {
    expect(affiliationCriteria(association(1), [], TODAY).map((c) => c.key)).toEqual([
      'incorporated',
      'board',
      'agreement',
      'compliance',
      'induction',
      'raffle',
      'competitions',
      'rules',
      'sinkingFund',
      'clubs',
      'playhq',
      'clubsAffiliated',
      'developmentOfficers',
      'pathway',
    ]);
  });

  it('leaves out criteria that do not apply to tier 4', () => {
    expect(affiliationCriteria(association(4), [], TODAY).map((c) => c.key)).toEqual([
      'incorporated',
      'board',
      'agreement',
      'compliance',
      'induction',
      'raffle',
      'rules',
      'playhq',
    ]);
  });

  it('sets the clubs needed for each tier', () => {
    expect(byKey(affiliationCriteria(association(1), [], TODAY)).clubs.label).toBe(
      'At least 5 affiliated clubs or entity teams',
    );
    expect(byKey(affiliationCriteria(association(2), [], TODAY)).clubs.label).toBe(
      'At least 4 affiliated clubs or entity teams',
    );
    expect(byKey(affiliationCriteria(association(3), [], TODAY)).clubs.label).toBe(
      'At least 3 affiliated clubs or entity teams',
    );
  });

  it('requires the raffle, officers and pathway for tiers 1 and 2 only', () => {
    for (const tier of [1, 2] as const) {
      const c = byKey(affiliationCriteria(association(tier), [], TODAY));
      expect([c.raffle.need, c.developmentOfficers.need, c.pathway.need]).toEqual([
        'required',
        'required',
        'required',
      ]);
    }
    const three = byKey(affiliationCriteria(association(3), [], TODAY));
    expect([three.raffle.need, three.developmentOfficers.need, three.pathway.need]).toEqual([
      'recommended',
      'recommended',
      'recommended',
    ]);
    expect(byKey(affiliationCriteria(association(4), [], TODAY)).raffle.need).toBe('recommended');
  });

  it('counts the agreement as signed within the last year', () => {
    expect(byKey(affiliationCriteria(association(2, { registered_on: '2026-01-10' }), [], TODAY)).agreement.met).toBe(
      true,
    );
    expect(byKey(affiliationCriteria(association(2, { registered_on: '2025-01-10' }), [], TODAY)).agreement.met).toBe(
      false,
    );
  });

  it('needs every inducted office for the tier to have done the induction', () => {
    const tier2 = [officer('president', '2026-01-01'), officer('ado', '2026-01-01')];
    expect(byKey(affiliationCriteria(association(2), tier2, TODAY)).induction.met).toBe(false);
    const done = [...tier2, officer('audo', '2026-01-01')];
    expect(byKey(affiliationCriteria(association(2), done, TODAY)).induction.met).toBe(true);
    // Named but not inducted.
    const named = [...tier2, officer('audo')];
    expect(byKey(affiliationCriteria(association(2), named, TODAY)).induction.met).toBe(false);
  });

  it('names who must do the induction', () => {
    expect(byKey(affiliationCriteria(association(3), [], TODAY)).induction.detail).toContain(
      'President and Another committee member.',
    );
    expect(byKey(affiliationCriteria(association(4), [], TODAY)).induction.detail).toContain(
      'Induction: Representative.',
    );
  });

  it('needs both development officers named', () => {
    expect(
      byKey(affiliationCriteria(association(1), [officer('ado')], TODAY)).developmentOfficers.met,
    ).toBe(false);
    expect(
      byKey(affiliationCriteria(association(1), [officer('ado'), officer('audo')], TODAY)).developmentOfficers
        .met,
    ).toBe(true);
  });
});
