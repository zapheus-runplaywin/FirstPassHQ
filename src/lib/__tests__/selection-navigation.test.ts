/**
 * Getting around selection assessments quickly (Matt, 23 November 2026):
 * where Home's card goes, the next date on a round, the filters and search
 * over a round's athletes, and the next athlete whose summary is unsigned.
 */
import {
  SEARCH_FROM,
  athleteFilters,
  filterAthletes,
  nextRoundDate,
  nextToSign,
  selectionHomeHref,
  summariesDue,
  type MyRound,
  type RoundDate,
  type SheetAthlete,
  type SummaryStatus,
} from '@/lib/assessments';

jest.mock('@/lib/auth', () => ({ useAuth: jest.fn() }));
jest.mock('@/lib/club', () => ({ useFeature: jest.fn() }));

const athlete = (id: string, name: string | null, observations = 2): SheetAthlete => ({
  id,
  name,
  is_minor: true,
  observations,
  my_observations: 0,
  assessors: 1,
  groups_covered: 1,
  last_observed_on: null,
});
const ATHLETES = [athlete('a1', 'Mia Chen'), athlete('a2', 'Ava Thompson', 0), athlete('a3', null), athlete('a4', 'Amy Chen')];
const status = (athlete_id: string, mine: SummaryStatus['mine']): SummaryStatus => ({ athlete_id, mine, signed: 0 });

describe('Home’s card', () => {
  const round = (id: string) => ({ id }) as MyRound;

  it('goes straight to the round when there is only one, open or closed', () => {
    expect(selectionHomeHref([round('r1')])).toEqual({ pathname: '/assessments/round', params: { id: 'r1' } });
  });

  it('goes to the list with several rounds, or none', () => {
    expect(selectionHomeHref([round('r1'), round('r2')])).toBe('/assessments');
    expect(selectionHomeHref([])).toBe('/assessments');
  });
});

describe('the next date on a round', () => {
  const date = (id: string, due_on: string, done = false): RoundDate => ({ id, title: id, due_on, done });

  it('is the earliest date not done, overdue ones first, whatever order they come in', () => {
    const dates = [date('later', '2026-11-20'), date('done', '2026-10-01', true), date('overdue', '2026-10-10')];
    expect(nextRoundDate(dates)?.id).toBe('overdue');
    expect(dates.map((d) => d.id)).toEqual(['later', 'done', 'overdue']);
  });

  it('is nothing once every date is done, or with none', () => {
    expect(nextRoundDate([date('done', '2026-10-01', true)])).toBeNull();
    expect(nextRoundDate([])).toBeNull();
  });
});

describe('when summaries are due', () => {
  it('is from a week before the round’s last day, and after it, while the round is open', () => {
    const round = { ends_on: '2026-11-29', closed: false };
    expect(summariesDue(round, '2026-11-21')).toBe(false);
    expect(summariesDue(round, '2026-11-22')).toBe(true);
    expect(summariesDue(round, '2026-12-05')).toBe(true);
    expect(summariesDue({ ...round, closed: true }, '2026-11-28')).toBe(false);
  });
});

describe('the filters over a round’s athletes', () => {
  it('offers Nothing written only when someone has nothing', () => {
    expect(athleteFilters(ATHLETES, [], false)).toEqual([
      { value: 'all', label: 'All (4)' },
      { value: 'nothing', label: 'Nothing written (1)' },
    ]);
    expect(athleteFilters([ATHLETES[0]], [], false)).toEqual([]);
  });

  it('offers Summary to sign once summaries are due or one is started, counting those not signed', () => {
    expect(athleteFilters([ATHLETES[0], ATHLETES[3]], [], true)).toEqual([
      { value: 'all', label: 'All (2)' },
      { value: 'unsigned', label: 'Summary to sign (2)' },
    ]);
    expect(athleteFilters([ATHLETES[0], ATHLETES[3]], [status('a1', 'draft')], false)).toHaveLength(2);
    expect(athleteFilters([ATHLETES[0], ATHLETES[3]], [status('a1', 'signed')], false)[1]).toEqual({
      value: 'unsigned',
      label: 'Summary to sign (1)',
    });
    // Signed by other selectors only is not a start of the member's own.
    expect(athleteFilters([ATHLETES[0]], [{ athlete_id: 'a1', mine: 'none', signed: 2 }], false)).toEqual([]);
  });

  it('drops Summary to sign once every summary is signed', () => {
    expect(athleteFilters([ATHLETES[0]], [status('a1', 'signed')], true)).toEqual([]);
  });

  it('lists everyone, those with nothing written, or those unsigned', () => {
    const ids = (filter: Parameters<typeof filterAthletes>[2], statuses: SummaryStatus[] = []) =>
      filterAthletes(ATHLETES, statuses, filter).map((a) => a.id);
    expect(ids('all')).toEqual(['a1', 'a2', 'a3', 'a4']);
    expect(ids('nothing')).toEqual(['a2']);
    expect(ids('unsigned', [status('a1', 'signed'), status('a2', 'draft')])).toEqual(['a2', 'a3', 'a4']);
  });

  it('searches part of a name, ignoring case and spaces around it, within the filter', () => {
    const names = (search: string, filter: Parameters<typeof filterAthletes>[2] = 'all') =>
      filterAthletes(ATHLETES, [], filter, search).map((a) => a.name);
    expect(names('  CHEN ')).toEqual(['Mia Chen', 'Amy Chen']);
    expect(names('ath')).toEqual([null]);
    expect(names('a', 'nothing')).toEqual(['Ava Thompson']);
    expect(names('zzz')).toEqual([]);
    expect(names('   ')).toHaveLength(4);
  });

  it('is searchable from nine athletes', () => {
    expect(SEARCH_FROM).toBe(8);
  });
});

describe('the next athlete to sign', () => {
  it('is the next in the list after this one whose summary isn’t signed', () => {
    expect(nextToSign(ATHLETES, [status('a2', 'signed')], 'a1')?.id).toBe('a3');
    expect(nextToSign(ATHLETES, [], 'a1')?.id).toBe('a2');
  });

  it('wraps round to the top after the last athlete', () => {
    expect(nextToSign(ATHLETES, [status('a1', 'draft')], 'a4')?.id).toBe('a1');
    expect(nextToSign(ATHLETES, [status('a1', 'signed'), status('a2', 'signed')], 'a4')?.id).toBe('a3');
  });

  it('is never this athlete, and nobody once the rest are signed', () => {
    const rest = [status('a2', 'signed'), status('a3', 'signed'), status('a4', 'signed')];
    expect(nextToSign(ATHLETES, rest, 'a1')).toBeNull();
    expect(nextToSign([ATHLETES[0]], [], 'a1')).toBeNull();
    expect(nextToSign([], [], 'a1')).toBeNull();
  });

  it('starts from the top for an athlete who isn’t on the list', () => {
    expect(nextToSign(ATHLETES, [], 'gone')?.id).toBe('a1');
  });
});
