import { leaveOtherGroups } from '@/lib/team-placements';
import type { Team, TeamRole } from '@/lib/types';

const group = (
  id: string,
  kind: Team['kind'],
  squad_id: string | null = null,
  season = 2026,
): Team => ({
  id,
  name: id,
  sort_order: 1,
  kind,
  season,
  squad_id,
  selections_completed_at: null,
});

const SQUAD = group('Open Squad', 'squad');
const OPEN_A = group('Open A', 'team', SQUAD.id);
const OPEN_B = group('Open B', 'team', SQUAD.id);
const U20_SQUAD = group('20 & Under Squad', 'squad');
const U20 = group('20 & Under', 'team', U20_SQUAD.id);
const FREE = group('Free Team', 'team');
const NEXT_SQUAD = group('Open Squad 2027', 'squad', null, 2027);
const NEXT_TEAM = group('Open A 2027', 'team', NEXT_SQUAD.id, 2027);
const TEAMS = [SQUAD, OPEN_A, OPEN_B, U20_SQUAD, U20, FREE, NEXT_SQUAD, NEXT_TEAM];

const as = (role: TeamRole, ...ids: string[]) =>
  Object.fromEntries(ids.map((id) => [id, { team_role: role }]));

describe('leaveOtherGroups', () => {
  it('moves an athlete from the squad’s other team', () => {
    const placed = as('athlete', SQUAD.id, OPEN_A.id, OPEN_B.id);
    expect(Object.keys(leaveOtherGroups(placed, TEAMS, OPEN_B.id))).toEqual([SQUAD.id, OPEN_B.id]);
  });

  it('moves an athlete from a team in another squad or with no squad', () => {
    expect(
      Object.keys(leaveOtherGroups(as('athlete', U20.id, OPEN_A.id), TEAMS, OPEN_A.id)),
    ).toEqual([OPEN_A.id]);
    expect(
      Object.keys(leaveOtherGroups(as('athlete', FREE.id, OPEN_A.id), TEAMS, OPEN_A.id)),
    ).toEqual([OPEN_A.id]);
  });

  it('moves an athlete to another squad, out of the old squad’s teams', () => {
    const placed = as('athlete', SQUAD.id, OPEN_A.id, U20_SQUAD.id);
    expect(Object.keys(leaveOtherGroups(placed, TEAMS, U20_SQUAD.id))).toEqual([U20_SQUAD.id]);
  });

  it('keeps next season’s places', () => {
    const placed = as('athlete', SQUAD.id, OPEN_A.id, NEXT_SQUAD.id, NEXT_TEAM.id);
    expect(leaveOtherGroups(placed, TEAMS, NEXT_TEAM.id)).toEqual(placed);
  });

  it.each<TeamRole>(['coach', 'manager', 'physio'])('lets a %s stay in several teams', (role) => {
    const placed = as(role, SQUAD.id, OPEN_A.id, OPEN_B.id, FREE.id);
    expect(leaveOtherGroups(placed, TEAMS, OPEN_B.id)).toEqual(placed);
  });

  it('keeps a place where they are something other than an athlete', () => {
    const placed = { ...as('coach', OPEN_A.id), ...as('athlete', OPEN_B.id) };
    expect(leaveOtherGroups(placed, TEAMS, OPEN_B.id)).toEqual(placed);
  });

  it('changes nothing for a group they aren’t in, or one that doesn’t exist', () => {
    const placed = as('athlete', OPEN_A.id);
    expect(leaveOtherGroups(placed, TEAMS, OPEN_B.id)).toBe(placed);
    expect(
      leaveOtherGroups({ ...placed, gone: { team_role: 'athlete' as TeamRole } }, TEAMS, 'gone'),
    ).toEqual({
      ...placed,
      gone: { team_role: 'athlete' },
    });
  });
});
