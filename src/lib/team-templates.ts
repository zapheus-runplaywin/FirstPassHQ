/**
 * Starting setups an admin picks from the first time they open Squads and
 * teams. The squads and teams themselves are made by
 * `admin_apply_team_template`; keep the two lists the same.
 */
export const TEAM_TEMPLATES = [
  {
    key: 'ammna_state_teams',
    title: 'AMMNA State Teams',
    groups: [
      'Mixed Open Squad',
      'Open Squad',
      '20 & Under Squad',
      '17 & Under Squad',
    ],
    detail:
      'Squads on. Members join a squad first, and at selections you name teams from each squad.',
  },
  {
    key: 'wanl',
    title: 'WA Netball League',
    groups: ['Mens Team', 'Opens Team', '21 & Under Team', 'Futures Team'],
    detail: 'Squads off. Members join a team straight away.',
  },
  {
    key: 'blank',
    title: 'Blank',
    groups: [],
    detail: 'No squads or teams. Add your own.',
  },
] as const;

export type TeamTemplate = (typeof TEAM_TEMPLATES)[number]['key'];
