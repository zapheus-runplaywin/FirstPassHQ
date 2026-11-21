import {
  calendarPosts,
  calendarRoles,
  colourAudience,
  isShownToSomeone,
  nobody,
  saveArgs,
  shownToFromRows,
  shownToLabel,
  toggled,
  type CalendarShownTo,
} from '@/lib/calendar-audience';

const teams = [
  { id: 's1', name: '20 & Under', kind: 'squad' as const },
  { id: 't1', name: '20 & Under Gold', kind: 'team' as const },
  { id: 't2', name: 'Open A', kind: 'team' as const },
];

const shown = (changes: Partial<CalendarShownTo>): CalendarShownTo => ({ ...nobody, ...changes });

describe('shownToFromRows', () => {
  it('reads each kind of row', () => {
    expect(
      shownToFromRows([
        { kind: 'role', role: 'physio', post: null, team_id: null },
        { kind: 'role', role: 'statistician', post: null, team_id: null },
        { kind: 'post', role: null, post: 'child_safety_officer', team_id: null },
        { kind: 'team', role: null, post: null, team_id: 't1' },
      ]),
    ).toEqual({
      everyone: false,
      roles: ['physio', 'statistician'],
      posts: ['child_safety_officer'],
      teamIds: ['t1'],
    });
  });

  it('reads everyone', () => {
    expect(shownToFromRows([{ kind: 'everyone', role: null, post: null, team_id: null }]).everyone).toBe(true);
  });

  it('leaves out roles and posts a calendar is never shown to, and repeats', () => {
    expect(
      shownToFromRows([
        { kind: 'role', role: 'admin', post: null, team_id: null },
        { kind: 'role', role: 'volunteer', post: null, team_id: null },
        { kind: 'role', role: 'guest', post: null, team_id: null },
        { kind: 'role', role: 'guest', post: null, team_id: null },
        { kind: 'post', role: null, post: 'head_physio', team_id: null },
        { kind: 'team', role: null, post: null, team_id: null },
        { kind: 'team', role: null, post: null, team_id: 't2' },
        { kind: 'team', role: null, post: null, team_id: 't2' },
      ]),
    ).toEqual({ everyone: false, roles: ['guest'], posts: [], teamIds: ['t2'] });
  });

  it('is nobody with no rows', () => {
    expect(shownToFromRows(null)).toEqual(nobody);
    expect(shownToFromRows([])).toEqual(nobody);
  });
});

describe('isShownToSomeone', () => {
  it('needs at least one choice', () => {
    expect(isShownToSomeone(nobody)).toBe(false);
    expect(isShownToSomeone(shown({ everyone: true }))).toBe(true);
    expect(isShownToSomeone(shown({ roles: ['guest'] }))).toBe(true);
    expect(isShownToSomeone(shown({ posts: ['wwc_officer'] }))).toBe(true);
    expect(isShownToSomeone(shown({ teamIds: ['t1'] }))).toBe(true);
  });
});

describe('shownToLabel', () => {
  it('says everyone', () => {
    expect(shownToLabel(shown({ everyone: true, roles: ['guest'] }), teams)).toBe('Everyone in the club');
  });

  it('lists roles, then posts, then squads and teams, in the order the admin sees them', () => {
    expect(
      shownToLabel(
        shown({
          roles: ['statistician', 'physio'],
          posts: ['complaints_manager', 'child_safety_officer'],
          teamIds: ['t2', 's1'],
        }),
        teams,
      ),
    ).toBe(
      'Physios, Statisticians, Child Safety Officers, Complaints Managers, 20 & Under and Open A',
    );
  });

  it('names a single choice alone', () => {
    expect(shownToLabel(shown({ roles: ['guardian'] }), teams)).toBe('Parents and guardians');
    expect(shownToLabel(shown({ posts: ['wwc_officer'] }), teams)).toBe('WWC Registration Officers');
  });

  it('counts squads and teams from seasons no longer listed', () => {
    expect(shownToLabel(shown({ teamIds: ['old'] }), teams)).toBe('1 earlier squad or team');
    expect(shownToLabel(shown({ roles: ['guest'], teamIds: ['old', 'older'] }), teams)).toBe(
      'Guests and 2 earlier squads or teams',
    );
  });

  it('says admins only when nobody is chosen', () => {
    expect(shownToLabel(nobody, teams)).toBe('Admins only (choose who sees it)');
  });
});

describe('colourAudience', () => {
  it('uses the club colour for everyone', () => {
    expect(colourAudience(shown({ everyone: true, teamIds: ['t1'] }), teams)).toBe('club');
  });

  it('uses the committee colour for the committee alone', () => {
    expect(colourAudience(shown({ roles: ['committee'] }), teams)).toBe('committee');
    expect(colourAudience(shown({ roles: ['committee', 'coach'] }), teams)).toBe('club');
    expect(colourAudience(shown({ roles: ['committee'], posts: ['wwc_officer'] }), teams)).toBe('club');
    expect(colourAudience(shown({ roles: ['committee'], teamIds: ['t1'] }), teams)).toBe('club');
  });

  it('uses a squad or team colour when shown only to squads or only to teams', () => {
    expect(colourAudience(shown({ teamIds: ['s1'] }), teams)).toBe('squad');
    expect(colourAudience(shown({ teamIds: ['t1', 't2'] }), teams)).toBe('team');
    expect(colourAudience(shown({ teamIds: ['s1', 't1'] }), teams)).toBe('club');
    expect(colourAudience(shown({ teamIds: ['t1'], roles: ['guest'] }), teams)).toBe('club');
  });

  it('treats an unlisted group as a squad', () => {
    expect(colourAudience(shown({ teamIds: ['old'] }), teams)).toBe('squad');
  });

  it('uses the club colour for roles or posts', () => {
    expect(colourAudience(shown({ roles: ['physio'] }), teams)).toBe('club');
    expect(colourAudience(shown({ posts: ['child_safety_officer'] }), teams)).toBe('club');
    expect(colourAudience(nobody, teams)).toBe('club');
  });
});

describe('saveArgs', () => {
  it('sends everyone alone', () => {
    expect(saveArgs(shown({ everyone: true, roles: ['guest'], teamIds: ['t1'], posts: ['wwc_officer'] }))).toEqual({
      p_everyone: true,
      p_roles: [],
      p_team_ids: [],
      p_posts: [],
    });
  });

  it('sends the choices', () => {
    expect(saveArgs(shown({ roles: ['physio'], teamIds: ['t1'], posts: ['wwc_officer'] }))).toEqual({
      p_everyone: false,
      p_roles: ['physio'],
      p_team_ids: ['t1'],
      p_posts: ['wwc_officer'],
    });
  });
});

describe('toggled', () => {
  it('adds and removes', () => {
    expect(toggled(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggled(['a', 'b'], 'a')).toEqual(['b']);
  });
});

describe('the choices offered', () => {
  it('match the database (admin_save_calendar)', () => {
    expect([...calendarRoles]).toEqual([
      'committee',
      'coach',
      'manager',
      'physio',
      'statistician',
      'athlete',
      'guardian',
      'guest',
    ]);
    expect([...calendarPosts]).toEqual(['child_safety_officer', 'complaints_manager', 'wwc_officer']);
  });
});
