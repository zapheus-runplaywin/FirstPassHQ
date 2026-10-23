/**
 * What the Working With Children Checks and Integrity training reports load
 * (src/lib/report-data.ts): the right rows from the right tables, every page
 * of them, and a clear failure when the database refuses.
 */
import { loadCourses, loadWwccData } from '@/lib/report-data';
import { supabase } from '@/lib/supabase';

import { personas, signInAs, type QueryInfo } from '../../__tests__/helpers/harness';

jest.mock('@/lib/auth', () => ({ useAuth: jest.fn(), PROFILE_COLUMNS: 'PROFILE_COLUMNS' }));
jest.mock('@/lib/club', () => ({ useClub: jest.fn() }));

/** Every query the code made, by table or RPC. */
let seen: QueryInfo[] = [];
const record = (rows: unknown) => (q: QueryInfo) => {
  seen.push(q);
  return rows;
};
const recordRpc = (rows: unknown) => (_args: Record<string, unknown>, q: QueryInfo) => {
  seen.push(q);
  return rows;
};
const callsTo = (name: string) => seen.filter((q) => q.name === name);
const methods = (q: QueryInfo) => q.calls.map((c) => [c.method, ...c.args]);

beforeEach(() => {
  seen = [];
});

describe('loadWwccData', () => {
  const members = [{ id: 'm1' }, { id: 'm2' }];
  const placements = [{ team_id: 't', profile_id: 'm1', team_role: 'coach' }];
  const standDowns = [{ id: 's1' }];
  const exemptions = [{ id: 'e1' }];
  const notices = [{ id: 'n1' }];
  const applications = [{ id: 'a1' }];
  const acks = [{ profile_id: 'm1', policy_version: '2', acknowledged_at: 'x' }];

  function backend(officer: unknown = { officer_name: 'Sample officer' }, rpcErrors: Record<string, string> = {}) {
    signInAs(personas.admin, {}, {
      tableHandlers: {
        team_members: record(placements),
        stand_downs: record(standDowns),
        screening_notices: record(notices),
        policy_acknowledgements: record(acks),
      },
      rpcHandlers: {
        report_members: recordRpc(members),
        admin_volunteer_exemptions: recordRpc(exemptions),
        admin_wwcc_applications: recordRpc(applications),
        admin_wwc_officer: recordRpc(officer ? [officer] : []),
      },
      rpcErrors,
    });
  }

  it('loads approved members, child-related places, stand-downs, exemptions, notices, the officer, acknowledgements and check applications', async () => {
    backend();
    await expect(loadWwccData()).resolves.toEqual({
      members,
      placements,
      standDowns,
      exemptions,
      notices,
      officerName: 'Sample officer',
      acknowledgements: acks,
      applications,
    });
    // Members come from report_members, which leaves out contact details, so
    // checked committee members read the report too; profiles isn't read.
    expect(methods(callsTo('report_members')[0])).toEqual([['range', 0, 999]]);
    expect(callsTo('profiles')).toEqual([]);
    expect(methods(callsTo('team_members')[0])).toEqual([
      ['select', 'team_id, profile_id, team_role'],
      ['in', 'team_role', ['coach', 'manager', 'physio']],
      ['range', 0, 999],
    ]);
    // Newest first, as the report lists them.
    expect(methods(callsTo('stand_downs')[0])).toContainEqual(['order', 'started_at', { ascending: false }]);
    expect(methods(callsTo('screening_notices')[0])).toContainEqual(['order', 'received_on', { ascending: false }]);
    expect(methods(callsTo('policy_acknowledgements')[0])).toContainEqual(['order', 'acknowledged_at', { ascending: false }]);
    expect(methods(callsTo('admin_volunteer_exemptions')[0])).toEqual([['range', 0, 999]]);
  });

  it('has no officer name when the club hasn’t named one', async () => {
    backend(null);
    expect((await loadWwccData()).officerName).toBeNull();
  });

  it('fails with the database’s message when a list is refused', async () => {
    backend(undefined, { admin_volunteer_exemptions: 'Only admins can see exemptions' });
    await expect(loadWwccData()).rejects.toThrow('Only admins can see exemptions');
  });

  it('fetches every page of a long member list', async () => {
    const page = (from: number, n: number) => Array.from({ length: n }, (_, i) => ({ id: `m${from + i}` }));
    signInAs(personas.admin, {}, {
      rpcHandlers: {
        report_members: (_args, q) => {
          seen.push(q);
          const range = q.calls.find((c) => c.method === 'range')!.args as [number, number];
          return range[0] === 0 ? page(0, 1000) : page(1000, 5);
        },
      },
    });
    const { members: loaded } = await loadWwccData();
    expect(loaded).toHaveLength(1005);
    expect(callsTo('report_members').map((q) => q.calls.find((c) => c.method === 'range')!.args)).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });
});

describe('loadCourses', () => {
  const requirement = (id: string, season: number) => ({ id, name: `Course ${id}`, due_on: '2026-12-01', season });

  function backend(options: { error?: string; memberErrors?: string[] } = {}) {
    signInAs(personas.admin, {}, {
      tableHandlers: {
        training_requirements: record([requirement('a', 2026), requirement('b', 2025), requirement('c', 2026)]),
      },
      rpcHandlers: {
        training_requirement_members: (args, q) => {
          seen.push(q);
          return [{ profile_id: `of-${args.p_requirement_id}` }];
        },
      },
      rpcErrors: options.memberErrors ? { training_requirement_members: options.memberErrors[0] } : {},
    });
    if (options.error) {
      (supabase.from as jest.Mock).mockImplementation(() => ({
        select: () => ({ eq: () => ({ order: () => ({ order: async () => ({ data: null, error: { message: options.error } }) }) }) }),
      }));
    }
  }

  it('loads the season’s courses that aren’t archived, with who must do each, and every season with courses', async () => {
    backend();
    const loaded = await loadCourses(2026);
    expect(loaded).toEqual({
      seasons: [2026, 2025],
      courses: [
        { name: 'Course a', due_on: '2026-12-01', members: [{ profile_id: 'of-a' }] },
        { name: 'Course c', due_on: '2026-12-01', members: [{ profile_id: 'of-c' }] },
      ],
      error: null,
    });
    expect(methods(callsTo('training_requirements')[0])).toEqual([
      ['select', expect.any(String)],
      ['eq', 'archived', false],
      ['order', 'due_on'],
      ['order', 'name'],
    ]);
    // Only the chosen season's courses are asked about.
    expect(callsTo('training_requirement_members')).toHaveLength(2);
  });

  it('has no courses for a season without any', async () => {
    backend();
    expect((await loadCourses(2030)).courses).toEqual([]);
  });

  it('passes on a refusal for who must do a course, showing nobody for it', async () => {
    backend({ memberErrors: ['Not allowed'] });
    const loaded = await loadCourses(2026);
    expect(loaded.error).toBe('Not allowed');
    expect(loaded.courses.map((c) => c.members)).toEqual([[], []]);
  });

  it('fails with the database’s message when the courses can’t load', async () => {
    backend({ error: 'permission denied for table training_requirements' });
    await expect(loadCourses(2026)).rejects.toThrow('permission denied for table training_requirements');
  });
});
