import {
  canHoldTitle,
  isTeamRole,
  requestableRoles,
  rolesLabel,
  captainTitle,
  staffTitle,
  teamPositionLabel,
} from '@/lib/labels';
import type { CoachTitle, GroupKind, TeamRole } from '@/lib/types';

function membership(
  team_role: TeamRole,
  name: string,
  kind: GroupKind,
  sort_order: number,
  coach_title: CoachTitle | null = null,
) {
  return { team_role, coach_title, team: { name, kind, sort_order } };
}

describe('isTeamRole', () => {
  it('is true for roles that belong to a team', () => {
    for (const role of ['coach', 'manager', 'physio', 'athlete', 'guardian'] as const) {
      expect(isTeamRole(role)).toBe(true);
    }
  });

  it('is false for club roles', () => {
    for (const role of ['admin', 'committee', 'guest', 'volunteer', 'statistician'] as const) {
      expect(isTeamRole(role)).toBe(false);
    }
  });
});

describe('requestableRoles', () => {
  it('never offers admin', () => {
    expect(requestableRoles).not.toContain('admin');
  });
});

describe('teamPositionLabel', () => {
  it('uses the coach title first', () => {
    expect(teamPositionLabel('coach', 'head_coach', 'touring')).toBe('Head Coach');
    expect(teamPositionLabel('coach', 'assistant_coach')).toBe('Assistant Coach');
  });

  it('uses the selection next', () => {
    expect(teamPositionLabel('athlete', null, 'touring')).toBe('Final team athlete');
    expect(teamPositionLabel('athlete', null, 'training_partner')).toBe('Training partner');
  });

  it('falls back to the team role', () => {
    expect(teamPositionLabel('athlete', null)).toBe('Athlete');
    expect(teamPositionLabel('manager', null, null)).toBe('Manager');
  });
});

describe('canHoldTitle', () => {
  it('is only for committee members and admins', () => {
    expect(canHoldTitle(['committee'])).toBe(true);
    expect(canHoldTitle(['coach', 'admin'])).toBe(true);
    expect(canHoldTitle(['coach', 'manager', 'guardian'])).toBe(false);
    expect(canHoldTitle([])).toBe(false);
  });
});

describe('staffTitle', () => {
  it('is empty for someone who coaches or manages nothing', () => {
    expect(staffTitle([])).toBe('');
    expect(staffTitle([membership('athlete', 'Open A', 'team', 1)])).toBe('');
  });

  it('names a single group', () => {
    expect(staffTitle([membership('coach', 'Open A', 'team', 1, 'head_coach')])).toBe(
      'Head Coach, Open A',
    );
    expect(staffTitle([membership('manager', '17 & Under', 'squad', 1)])).toBe(
      'Manager, 17 & Under',
    );
  });

  it('counts teams over squads', () => {
    expect(
      staffTitle([
        membership('coach', 'Open Squad', 'squad', 0, 'head_coach'),
        membership('coach', 'Open A', 'team', 1, 'head_coach'),
      ]),
    ).toBe('Head Coach, Open A');
  });

  it('joins groups with the same position, in sort order then by name', () => {
    expect(
      staffTitle([
        membership('coach', 'Open Mixed', 'team', 2, 'head_coach'),
        membership('coach', 'Open', 'team', 1, 'head_coach'),
        membership('coach', 'Open A', 'team', 1, 'head_coach'),
      ]),
    ).toBe('Head Coach, Open, Open A and Open Mixed');
  });

  it('lists each position separately', () => {
    expect(
      staffTitle([
        membership('coach', 'Open A', 'team', 1, 'head_coach'),
        membership('coach', '17 & Under', 'team', 2, 'assistant_coach'),
        membership('coach', 'Open B', 'team', 3, 'head_coach'),
      ]),
    ).toBe('Head Coach, Open A and Open B · Assistant Coach, 17 & Under');
  });

  it('shows coach titles before manager titles', () => {
    expect(
      staffTitle([
        membership('manager', '15 & Under', 'squad', 1),
        membership('coach', 'Open A', 'team', 1),
      ]),
    ).toBe('Coach, Open A · Manager, 15 & Under');
  });

  it('decides teams over squads separately for coaching and managing', () => {
    expect(
      staffTitle([
        membership('coach', 'Open A', 'team', 1, 'head_coach'),
        membership('manager', 'Open Squad', 'squad', 1),
      ]),
    ).toBe('Head Coach, Open A · Manager, Open Squad');
  });
});

describe('rolesLabel', () => {
  it('lists the roles', () => {
    expect(rolesLabel(['coach', 'guardian'])).toBe('Coach, Guardian');
    expect(rolesLabel(['volunteer'])).toBe('Temporary helper');
  });

  it('adds a committee member or admin title', () => {
    expect(rolesLabel(['committee'], 'President')).toBe('Committee · President');
    expect(rolesLabel(['admin'], 'Secretary')).toBe('Admin · Secretary');
  });

  it('leaves out a title someone cannot hold', () => {
    expect(rolesLabel(['coach'], 'President')).toBe('Coach');
  });

  it('leaves out a blank title', () => {
    expect(rolesLabel(['committee'], null)).toBe('Committee');
    expect(rolesLabel(['committee'], '')).toBe('Committee');
  });

  it('shows a Head Physio', () => {
    expect(rolesLabel(['physio'], null, true)).toBe('Head Physio');
    expect(rolesLabel(['physio'], null, false)).toBe('Physio');
  });

  it('adds a coach or manager group title', () => {
    expect(rolesLabel(['coach'], null, false, 'Head Coach, Open A')).toBe(
      'Coach · Head Coach, Open A',
    );
    expect(rolesLabel(['manager'], null, false, 'Manager, Open A')).toBe(
      'Manager · Manager, Open A',
    );
  });

  it('leaves out a group title for other roles', () => {
    expect(rolesLabel(['athlete'], null, false, 'Head Coach, Open A')).toBe('Athlete');
  });

  it('shows both titles together', () => {
    expect(rolesLabel(['committee', 'coach'], 'President', false, 'Head Coach, Open A')).toBe(
      'Committee, Coach · President · Head Coach, Open A',
    );
  });
});

describe('captainTitle', () => {
  const playing = (id: string, name: string, sort = 1, role: TeamRole = 'athlete') => ({
    team_role: role,
    team: { id, name, sort_order: sort },
  });

  it('is empty for someone who captains nothing', () => {
    expect(captainTitle([], [playing('a', 'Open A')], false)).toBe('');
  });

  it('names the team they captain or vice captain', () => {
    expect(
      captainTitle([{ team_id: 'a', captain_role: 'captain' }], [playing('a', 'Open A')], false),
    ).toBe('Captain, Open A');
    expect(
      captainTitle(
        [{ team_id: 'u20', captain_role: 'vice_captain' }],
        [playing('u20', '20 & Under')],
        false,
      ),
    ).toBe('Vice Captain, 20 & Under');
  });

  it('puts Club Captain first, then captain before vice captain', () => {
    expect(
      captainTitle(
        [
          { team_id: 'b', captain_role: 'vice_captain' },
          { team_id: 'a', captain_role: 'captain' },
        ],
        [playing('a', 'Open A', 2), playing('b', 'Open Mixed', 3)],
        true,
      ),
    ).toBe('Club Captain · Captain, Open A · Vice Captain, Open Mixed');
    expect(captainTitle([], [], true)).toBe('Club Captain');
  });

  it('joins several teams in club order', () => {
    expect(
      captainTitle(
        [
          { team_id: 'b', captain_role: 'captain' },
          { team_id: 'a', captain_role: 'captain' },
        ],
        [playing('b', 'Open Mixed', 3), playing('a', 'Open A', 1)],
        false,
      ),
    ).toBe('Captain, Open A and Open Mixed');
  });

  it('leaves out a past season\'s captaincy (no current membership) and groups they coach', () => {
    expect(
      captainTitle(
        [
          { team_id: 'old', captain_role: 'captain' },
          { team_id: 'c', captain_role: 'captain' },
        ],
        [playing('c', 'Open', 1, 'coach')],
        false,
      ),
    ).toBe('');
  });
});
