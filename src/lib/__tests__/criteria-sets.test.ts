import {
  makeCriteria,
  pickSet,
  roundCriteriaLine,
  saveSetTitle,
  setEventLine,
  setLine,
  setProblem,
  setUseLine,
  type CriteriaSetEvent,
  type SetChoice,
} from '@/lib/assessments';
import { formatDateString } from '@/lib/injuries';

jest.mock('@/lib/auth', () => ({ useAuth: jest.fn() }));
jest.mock('@/lib/club', () => ({ useFeature: jest.fn() }));

const CRITERIA = makeCriteria([{ name: 'Skills', items: ['Passing'] }]);

function choice(extra: Partial<SetChoice> = {}): SetChoice {
  return { set_id: 's1', name: 'A', version: 1, groups: 1, items: 1, for_label: 'Every squad and team', is_default: false, ...extra };
}

describe('setLine', () => {
  it('counts groups and items with the version', () => {
    expect(setLine({ groups: 9, items: 33, version: 2 })).toBe('9 groups, 33 items · version 2');
    expect(setLine({ groups: 1, items: 1, version: 1 })).toBe('1 group, 1 item · version 1');
  });
});

describe('setUseLine', () => {
  it.each([
    [0, 'Not used yet'],
    [1, 'Used by 1 round'],
    [2, 'Used by 2 rounds'],
  ])('%i rounds reads "%s"', (n, line) => {
    expect(setUseLine(n)).toBe(line);
  });
});

describe('roundCriteriaLine', () => {
  it('names the set and version, the name alone on an older round, or nothing', () => {
    expect(roundCriteriaLine({ criteria_set_name: 'Junior criteria', criteria_set_version: 3 })).toBe('Junior criteria, version 3');
    expect(roundCriteriaLine({ criteria_set_name: 'Club criteria', criteria_set_version: null })).toBe('Club criteria');
    expect(roundCriteriaLine({ criteria_set_name: null, criteria_set_version: null })).toBe('');
  });
});

describe('setEventLine', () => {
  const at = '2026-12-10T01:00:00Z';
  const day = formatDateString('2026-12-10');
  const line = (e: Partial<CriteriaSetEvent>) =>
    setEventLine({ kind: 'created', version: null, detail: null, by_name: 'Matt', at, ...e });
  it.each([
    [{ kind: 'created' }, `Created · ${day} · Matt`],
    [{ kind: 'saved', version: 3 }, `Version 3 saved · ${day} · Matt`],
    [{ kind: 'renamed', detail: 'From “Juniors” to “Junior criteria”' }, `Renamed from “Juniors” to “Junior criteria” · ${day} · Matt`],
    [{ kind: 'renamed' }, `Renamed · ${day} · Matt`],
    [{ kind: 'for', detail: 'Open A' }, `Now for Open A · ${day} · Matt`],
    [{ kind: 'archived' }, `Archived · ${day} · Matt`],
    [{ kind: 'restored' }, `Brought back · ${day} · Matt`],
    [{ kind: 'deleted', by_name: null }, `Deleted · ${day}`],
  ] as [Partial<CriteriaSetEvent>, string][])('%o', (event, expected) => {
    expect(line(event)).toBe(expected);
  });
});

describe('saveSetTitle', () => {
  it('says Save on a new set or a name change, and the next version on a criteria change', () => {
    expect(saveSetTitle(false, false, 1)).toBe('Save');
    expect(saveSetTitle(false, true, 1)).toBe('Save');
    expect(saveSetTitle(true, false, 3)).toBe('Save');
    expect(saveSetTitle(true, true, 3)).toBe('Save as version 4');
  });
});

describe('pickSet', () => {
  it('takes the default, else the only one, else none', () => {
    const a = choice();
    const b = choice({ set_id: 's2', is_default: true });
    expect(pickSet([a, b])).toBe(b);
    expect(pickSet([a])).toBe(a);
    expect(pickSet([a, choice({ set_id: 's3' })])).toBeNull();
    expect(pickSet([])).toBeNull();
  });
});

describe('setProblem', () => {
  it('asks for a name of up to 60 characters', () => {
    expect(setProblem('  ', CRITERIA, true, [])).toBe('Name the set, in up to 60 characters.');
    expect(setProblem('x'.repeat(61), CRITERIA, true, [])).toBe('Name the set, in up to 60 characters.');
    expect(setProblem('x'.repeat(60), CRITERIA, true, [])).toBeNull();
  });
  it('asks for squads or teams when it is only for some', () => {
    expect(setProblem('A', CRITERIA, false, [])).toBe('Choose the squads or teams this set is for.');
    expect(setProblem('A', CRITERIA, false, ['t1'])).toBeNull();
  });
  it('then checks the criteria', () => {
    expect(setProblem('A', { groups: [] }, true, [])).toBe('Add at least one group of criteria.');
  });
});
