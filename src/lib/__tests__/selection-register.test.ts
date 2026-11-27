/**
 * Selection rounds, part 4 (reporting and governance): the register's
 * "Things to check", the register report, and the three sections the round
 * record adds to the audit report.
 */
import {
  registerChecks,
  registerStatus,
  roundEventLabel,
  selectionAuditReport,
  selectionRegisterReport,
  setEventLabel,
  type RegisterRound,
  type RoundAuditor,
  type RoundRecord,
  type SelectionAudit,
  type SelectionRegister,
} from '@/lib/assessments';

jest.mock('@/lib/auth', () => ({ useAuth: jest.fn() }));
jest.mock('@/lib/club', () => ({ useFeature: jest.fn() }));


const TODAY = '2026-12-10';

function round(extra: Partial<RegisterRound> = {}): RegisterRound {
  return {
    id: 'r1',
    team_id: 's1',
    team_name: '17 & Under Squad',
    name: 'Trials',
    phase: 1,
    round_number: 2,
    starts_on: '2026-11-02',
    ends_on: '2026-12-21',
    last_day: '2026-12-21',
    closed_at: null,
    opened_at: '2026-11-01T01:00:00Z',
    opened_by_name: 'Matt',
    criteria_set_id: 'c1',
    criteria_set_name: 'Junior criteria',
    criteria_set_version: 3,
    set_fits: true,
    panel: [
      { name: 'Sam Coach', independent: false },
      { name: 'Indy Out', independent: true },
    ],
    declared_conflicts: 1,
    auditors: ['Pat Committee'],
    athletes: 14,
    observations: 61,
    athletes_observed: 14,
    summaries_signed: 23,
    summaries_expected: 28,
    feedback_shared: 4,
    released: null,
    clashes: [],
    ...extra,
  };
}

function register(rounds: RegisterRound[], extra: Partial<SelectionRegister> = {}): SelectionRegister {
  return {
    season: 2026,
    today: TODAY,
    seasons: [2026],
    groups: [{ id: 's1', name: '17 & Under Squad', kind: 'squad', squad_id: null, athletes: 14 }],
    rounds,
    sets: [
      { id: 'c1', name: 'Junior criteria', for_label: '17 & Under Squad and its teams', version: 3, archived_at: null, rounds_season: 1, rounds_ever: 2 },
      { id: 'c2', name: 'Old set', for_label: 'Every squad and team', version: 1, archived_at: '2026-12-03T01:00:00Z', rounds_season: 0, rounds_ever: 1 },
    ],
    set_events: [{ set_name: 'Junior criteria', kind: 'saved', version: 3, detail: null, by_name: 'Matt', at: '2026-12-01T01:00:00Z' }],
    round_events: [{ round_id: 'r1', kind: 'dates', detail: 'Ends 21 Dec', by_name: 'Matt', at: '2026-11-05T01:00:00Z' }],
    ...extra,
  };
}

describe('registerChecks', () => {
  it('has nothing to check for a healthy season', () => {
    expect(registerChecks(register([round()]))).toEqual([]);
  });

  it('names a group with no round, but not a team whose squad has one', () => {
    const r = register([round()], {
      groups: [
        { id: 's1', name: '17 & Under Squad', kind: 'squad', squad_id: null, athletes: 14 },
        { id: 't1', name: '17 & Under Blue', kind: 'team', squad_id: 's1', athletes: 7 },
        { id: 't2', name: 'Open A', kind: 'team', squad_id: null, athletes: 9 },
      ],
    });
    expect(registerChecks(r)).toEqual(['Open A has no round this season.']);
  });

  it('flags a running round with no auditor', () => {
    expect(registerChecks(register([round({ auditors: [] })]))).toEqual([
      'Phase 1, Round 2 · Trials (17 & Under Squad) is running with no auditor.',
    ]);
  });

  it('flags a running round with one selector', () => {
    expect(registerChecks(register([round({ panel: [{ name: 'Sam', independent: false }] })]))).toEqual([
      'Phase 1, Round 2 · Trials (17 & Under Squad) is running with one selector on its panel.',
    ]);
  });

  it('flags a round that ended and isn’t closed', () => {
    const checks = registerChecks(register([round({ ends_on: '2026-12-08', last_day: '2026-12-08' })]));
    expect(checks[0]).toMatch(/^Phase 1, Round 2 · Trials \(17 & Under Squad\) ended on .* and isn’t closed\.$/);
  });

  it('flags a finished round with athletes nobody wrote about, and unsigned summaries', () => {
    const closed = round({ closed_at: '2026-12-01T00:00:00Z', athletes_observed: 11 });
    expect(registerChecks(register([closed]))).toEqual([
      'Phase 1, Round 2 · Trials (17 & Under Squad) finished with 3 of 14 athletes with nothing written.',
      'Phase 1, Round 2 · Trials (17 & Under Squad) finished with 5 of 28 summaries not signed.',
    ]);
  });

  it('doesn’t count a running round’s gaps yet', () => {
    expect(registerChecks(register([round({ athletes_observed: 2, summaries_signed: 0 })]))).toEqual([]);
  });

  it('says once when two rounds overlap', () => {
    const a = round({ clashes: [{ round_name: 'Phase 1, Round 3', starts_on: '2026-12-14', last_day: '2027-01-10' }] });
    const b = round({
      id: 'r2',
      name: 'Phase 1, Round 3',
      phase: null,
      round_number: null,
      starts_on: '2026-12-14',
      ends_on: '2027-01-10',
      last_day: '2027-01-10',
      clashes: [{ round_name: 'Trials', starts_on: '2026-11-02', last_day: '2026-12-21' }],
    });
    const checks = registerChecks(register([a, b]));
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatch(/^Phase 1, Round 2 · Trials and Phase 1, Round 3 overlap for 17 & Under Squad from .* to .*\.$/);
  });

  it('says when the set is no longer for the group', () => {
    expect(registerChecks(register([round({ set_fits: false })]))).toEqual([
      'Phase 1, Round 2 · Trials (17 & Under Squad) was assessed against Junior criteria, which is not for 17 & Under Squad now.',
    ]);
  });

  it('keeps the order: no round, no auditor, one selector', () => {
    const r = register([round({ auditors: [], panel: [{ name: 'Sam', independent: false }] })], {
      groups: [{ id: 'x', name: 'Open A', kind: 'team', squad_id: null, athletes: 0 }],
    });
    expect(registerChecks(r).map((c) => c.split(' ').slice(-3).join(' '))).toEqual([
      'round this season.',
      'with no auditor.',
      'on its panel.',
    ]);
  });
});

describe('selectionRegisterReport', () => {
  const report = selectionRegisterReport(register([round()]), '2026–27');

  it('has its sections in order', () => {
    expect(report.sections.map((s) => s.title)).toEqual([
      'Things to check',
      'Rounds',
      'The work in each round',
      'Panels and auditors',
      'Criteria sets',
      'Changes to criteria sets',
      'Changes to rounds',
    ]);
    expect(report.title).toBe('Selection register');
    expect(report.subtitle).toMatch(/^Season 2026–27 · as at /);
    expect(report.landscape).toBe(true);
  });

  it('counts summaries as “23 of 28” and shows a dash for released', () => {
    const work = report.sections[2].rows[0].cells;
    expect(work).toContain('23 of 28');
    expect(work[work.length - 1]).toBe('–');
  });

  it('counts releases as “5 of 14” once part 5 fills them', () => {
    const work = selectionRegisterReport(register([round({ released: 5 })]), '2026–27').sections[2].rows[0].cells;
    expect(work[work.length - 1]).toBe('5 of 14');
  });

  it('marks independent selectors and lists auditors', () => {
    expect(report.sections[3].rows[0].cells).toEqual([
      'Phase 1, Round 2 · Trials (17 & Under Squad)',
      'Sam Coach, Indy Out (independent)',
      'Pat Committee',
    ]);
  });

  it('shows each set’s state and the history in words', () => {
    expect(report.sections[4].rows.map((r) => r.cells[5])).toEqual(['In use', expect.stringMatching(/^Archived /)]);
    expect(report.sections[5].rows[0].cells[2]).toBe('Version 3 saved');
    expect(report.sections[6].rows[0].cells[2]).toBe('Dates changed');
  });

  it('says nothing needs checking', () => {
    expect(report.sections[0].empty).toBe('Nothing needs checking.');
    expect(report.sections[0].rows).toEqual([]);
  });

  it('names no athlete', () => {
    expect(JSON.stringify(report)).not.toMatch(/athlete_name/);
  });

  it('gives each status in words', () => {
    expect(registerStatus(round({ starts_on: '2026-12-20' }), TODAY)).toBe('Coming up');
    expect(registerStatus(round(), TODAY)).toBe('Running');
    expect(registerStatus(round({ ends_on: '2026-12-01' }), TODAY)).toBe('Ended, not closed');
    expect(registerStatus(round({ closed_at: '2026-12-22T00:00:00Z' }), TODAY)).toMatch(/^Closed /);
  });

  it('puts words to every change', () => {
    expect(['opened', 'renamed', 'dates', 'phase', 'criteria', 'closed', 'reopened'].map((k) => roundEventLabel(k as never))).toEqual([
      'Opened',
      'Renamed',
      'Dates changed',
      'Phase or round changed',
      'Criteria changed',
      'Closed',
      'Opened again',
    ]);
    const e = { set_name: 'S', version: null, by_name: null, at: '2026-12-01T00:00:00Z' };
    expect(setEventLabel({ ...e, kind: 'created', detail: null })).toBe('Created');
    expect(setEventLabel({ ...e, kind: 'renamed', detail: 'Renamed from Old' })).toBe('Renamed from Old');
    expect(setEventLabel({ ...e, kind: 'for', detail: 'Now for Open A' })).toBe('Now for Open A');
    expect(setEventLabel({ ...e, kind: 'archived', detail: null })).toBe('Archived');
    expect(setEventLabel({ ...e, kind: 'restored', detail: null })).toBe('Brought back');
    expect(setEventLabel({ ...e, kind: 'deleted', detail: null })).toBe('Deleted');
  });
});

describe('the audit report with the round record', () => {
  const audit: SelectionAudit = {
    round: {
      id: 'r1',
      name: 'Trials',
      team_name: '17 & Under Squad',
      season: 2026,
      starts_on: '2026-11-02',
      ends_on: '2026-12-21',
      opened_at: '2026-11-01T01:00:00Z',
      opened_by_name: 'Matt',
      closed_at: null,
      closed_by_name: null,
      criteria_groups: 6,
      criteria_items: 20,
      athletes: 14,
      observations: 0,
      today: TODAY,
    },
    panel: [],
    selectors: [],
    athletes: [],
  };
  const auditor = (extra: Partial<RoundAuditor> = {}): RoundAuditor => ({
    name: 'Pat Committee',
    added_at: '2026-11-03T00:00:00Z',
    added_by_name: 'Matt',
    removed_at: null,
    removed_by_name: null,
    can_audit: true,
    own_children: 0,
    is_admin: false,
    other_rounds: 0,
    ...extra,
  });
  const record = (criteria: Partial<RoundRecord['criteria']> = {}, events: RoundRecord['events'] = []): RoundRecord => ({
    criteria: {
      set_name: 'Junior criteria',
      version: 3,
      saved_at: '2026-10-10T02:00:00Z',
      saved_by_name: 'Matt',
      for_label: '17 & Under Squad and its teams',
      groups: 6,
      items: 20,
      recommendations: 4,
      set_state: 'same',
      set_version: 3,
      ...criteria,
    },
    events,
  });
  const titles = (r: ReturnType<typeof selectionAuditReport>) => r.sections.map((s) => s.title);

  it('is unchanged without a record', () => {
    const r = selectionAuditReport(audit);
    expect(titles(r)).toEqual(['The round', 'Dates', 'The panel', 'What each selector wrote', 'Evidence about each athlete']);
    expect(r.stats?.map((s) => s.label)).not.toContain('Auditors');
  });

  it('adds Criteria, Changes to the round and Auditors in their places', () => {
    const r = selectionAuditReport({ ...audit, auditors: [auditor()] }, [], null, null, record());
    expect(titles(r)).toEqual([
      'The round',
      'Criteria',
      'Changes to the round',
      'Dates',
      'The panel',
      'Auditors',
      'What each selector wrote',
      'Evidence about each athlete',
    ]);
    expect(r.stats?.find((s) => s.label === 'Auditors')?.value).toBe(1);
  });

  const criteriaRows = (rec: RoundRecord) =>
    Object.fromEntries(selectionAuditReport(audit, [], null, null, rec).sections[1].rows.map((row) => [row.cells[0], row.cells[1]]));

  it('names the set and version, who saved it, who it is for and the round’s counts', () => {
    const rows = criteriaRows(record());
    expect(rows['Criteria set']).toBe('Junior criteria, version 3');
    expect(rows['That version was saved']).toMatch(/ by Matt$/);
    expect(rows['The set is for']).toBe('17 & Under Squad and its teams');
    expect(rows['In this round']).toBe('6 groups, 20 items, 4 recommendations');
    expect(rows['Since the round opened']).toBe('The set hasn’t changed.');
  });

  it('says where the set stands now', () => {
    expect(criteriaRows(record({ set_state: 'changed', set_version: 5 }))['Since the round opened']).toBe(
      'The set is now at version 5. This round keeps version 3.',
    );
    expect(criteriaRows(record({ set_state: 'archived' }))['Since the round opened']).toBe(
      'The set has been archived. This round keeps its copy.',
    );
    expect(criteriaRows(record({ set_state: 'deleted', for_label: null }))['Since the round opened']).toBe(
      'The set has been deleted. This round keeps its copy.',
    );
  });

  it('describes a round from before criteria sets, and leaves out what isn’t known', () => {
    const rows = criteriaRows(record({ set_name: 'Club criteria', version: null, set_state: 'legacy', saved_at: null, for_label: null }));
    expect(rows['Criteria set']).toBe('Club criteria (opened before criteria sets were added)');
    expect(rows).not.toHaveProperty('That version was saved');
    expect(rows).not.toHaveProperty('Since the round opened');
  });

  it('lists every change, oldest first, and says when none were kept', () => {
    const r = selectionAuditReport(audit, [], null, null, record({}, [
      { kind: 'opened', detail: 'Phase 1, Round 2', by_name: 'Matt', at: '2026-11-01T01:00:00Z' },
      { kind: 'reopened', detail: null, by_name: 'Matt', at: '2026-11-09T01:00:00Z' },
    ]));
    expect(r.sections[2].rows.map((row) => row.cells[1])).toEqual(['Opened', 'Opened again']);
    expect(selectionAuditReport(audit, [], null, null, record()).sections[2].empty).toBe(
      'This round was opened before changes were kept.',
    );
  });

  it('notes each auditor, and a round with none', () => {
    const r = selectionAuditReport(
      { ...audit, auditors: [auditor({ own_children: 1, is_admin: true, can_audit: false }), auditor({ name: 'Old', removed_at: '2026-11-20T00:00:00Z', removed_by_name: 'Matt' })] },
      [],
      null,
      null,
      record(),
    );
    const section = r.sections[5];
    expect(section.rows[0].cells[5]).toBe('Can’t check 1 athlete: their own child; Also an admin; No current check');
    expect(section.rows[1].cells[4]).toBe('Matt');
    const none = selectionAuditReport(audit, [], null, null, record()).sections[5];
    expect(none.empty).toBe('Nobody audited this round.');
    expect(none.note).toBe('No committee member was assigned to audit this round.');
  });
});
