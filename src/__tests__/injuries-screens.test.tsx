/**
 * What the injury screens (src/app/injuries/index.tsx and [id].tsx) show each
 * kind of member once they're open.
 *
 * Which injuries a member sees, and the `can_report` and `waiting_for_me`
 * flags on each, come from the database (`visible_injuries`), which also
 * hides an under-18's injury from coaches, physios and the committee until a
 * parent or guardian consents. So each test seeds what the database would
 * return for that member, and checks the screen shows it with only the
 * actions that member may take: reporting and updates for the athlete and
 * their guardians, endorsing for coaches and physios, accepting and sending
 * back for the committee and admins, and sharing documents only for whoever
 * is accepting the clearance.
 */
import { router } from 'expo-router';
import { fireEvent, screen, within } from 'expo-router/testing-library';

import InjuriesScreen from '@/app/injuries/index';
import InjuryScreen from '@/app/injuries/[id]';
import { supabase } from '@/lib/supabase';
import type { Injury, InjuryDocumentEvent, InjuryUpdate } from '@/lib/types';

import {
  morePersonas,
  onATablet,
  openScreen,
  personas,
  resetClub,
  settle,
  type BackendOptions,
  type Persona,
  type PersonaName,
} from './helpers/harness';

jest.mock('@/lib/club', () => jest.requireActual('./helpers/harness').clubModuleMock());
jest.mock('@/lib/club-choice', () => jest.requireActual('./helpers/harness').clubChoiceModuleMock());
jest.mock('@/constants/club', () => jest.requireActual('./helpers/harness').constantsClubMock());
jest.mock('@/lib/push', () => ({
  usePushNotifications: jest.fn(),
  useTodoNotifications: jest.fn(() => ({ on: true, permission: 'granted', save: jest.fn() })),
  openNotificationSettings: jest.fn(),
  unregisterForPush: jest.fn(async () => {}),
}));
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@/global.css', () => ({}));

type Who = PersonaName | Persona;

function injury(extra: Partial<Injury> = {}): Injury {
  return {
    id: 'inj-1',
    athlete_id: 'child-1',
    athlete_name: 'Sample Child',
    body_area: 'Hamstring',
    description: 'Felt it pull at training',
    injured_on: '2026-10-10',
    restrictions: 'No sprinting',
    expected_return: '2026-10-31',
    status: 'injured',
    coach_endorsed_by: null,
    cleared_at: null,
    created_at: '2026-10-10T08:00:00Z',
    last_update_at: null,
    can_report: false,
    waiting_for_me: false,
    ...extra,
  };
}

function update(extra: Partial<InjuryUpdate> = {}): InjuryUpdate {
  return {
    id: 'upd-1',
    author_name: 'Sample Guardian',
    kind: 'clearance_requested',
    notes: 'Physio says good to go',
    restrictions: null,
    expected_return: null,
    document_path: null,
    document_name: null,
    document_removed_at: null,
    created_at: '2026-10-16T08:00:00Z',
    ...extra,
  };
}

const LETTER = update({
  id: 'upd-letter',
  document_path: 'child-1/inj-1/letter.pdf',
  document_name: 'Physio letter.pdf',
});

const rpcCalls = () => (supabase.rpc as jest.Mock).mock.calls as [string, unknown][];

beforeEach(() => {
  resetClub();
  (supabase.rpc as jest.Mock).mockClear();
  (supabase.from as jest.Mock).mockClear();
});

// ---------------------------------------------------------------------------
// The injuries list

async function openList(who: Who, injuries: Injury[]) {
  await openScreen(who, { 'injuries/index': InjuriesScreen }, '/injuries', {}, {
    rpcs: { visible_injuries: injuries },
  });
}

describe('the injuries list', () => {
  // Only athletes and parents or guardians report injuries (section 11 of the guide).
  const REPORTERS: [string, Who][] = [
    ['athlete', 'athlete'],
    ['under-18 athlete', morePersonas.under18Athlete],
    ['guardian', 'guardian'],
    ['coach who is also a guardian', morePersonas.coachGuardian],
    ['athlete who also coaches', morePersonas.athleteCoach],
  ];
  const NOT_REPORTERS: [string, Who][] = [
    ['coach', 'coach'],
    ['assistant coach', morePersonas.assistantCoach],
    ['manager', 'manager'],
    ['physio', 'physio'],
    ['Head Physio', morePersonas.headPhysio],
    ['committee', 'committee'],
    ['admin', 'admin'],
    ['guest', 'guest'],
    ['stood-down coach', 'stoodDownCoach'],
  ];

  it.each(REPORTERS)('offers Report an injury to a %s', async (_label, who) => {
    await openList(who, []);
    expect(screen.getByText('Report an injury')).toBeTruthy();
  });

  it.each(NOT_REPORTERS)('doesn’t offer Report an injury to a %s', async (_label, who) => {
    await openList(who, []);
    expect(screen.queryByText('Report an injury')).toBeNull();
    expect(screen.getByText('No current injuries.')).toBeTruthy();
  });

  it('shows an athlete their own injuries without their name', async () => {
    await openList('athlete', [injury({ athlete_id: 'athlete', athlete_name: 'Sample athlete', can_report: true })]);
    expect(screen.getByText('Your injuries')).toBeTruthy();
    expect(screen.getByText('Hamstring')).toBeTruthy();
    expect(screen.queryByText('Injured athletes')).toBeNull();
    expect(screen.queryByText('Waiting for your sign-off')).toBeNull();
  });

  it('shows a guardian their children’s injuries by name', async () => {
    await openList('guardian', [injury({ can_report: true })]);
    expect(screen.getByText('Your athletes')).toBeTruthy();
    expect(screen.getByText('Sample Child · Hamstring')).toBeTruthy();
    expect(screen.getByText('Restrictions: No sprinting')).toBeTruthy();
  });

  it.each<[string, Who]>([
    ['coach', 'coach'],
    ['physio', 'physio'],
    ['committee', 'committee'],
    ['admin', 'admin'],
  ])('lists other athletes’ injuries for a %s, and nothing as their own', async (_label, who) => {
    await openList(who, [injury()]);
    expect(screen.getByText('Injured athletes')).toBeTruthy();
    expect(screen.getByText('Sample Child · Hamstring')).toBeTruthy();
    expect(screen.queryByText('Your injuries')).toBeNull();
    expect(screen.queryByText('Your athletes')).toBeNull();
  });

  it('puts a clearance waiting for the coach first, marked for their sign-off', async () => {
    await openList('coach', [
      injury({ id: 'inj-2', athlete_name: 'Other Child', body_area: 'Ankle' }),
      injury({ status: 'clearance_requested', waiting_for_me: true }),
    ]);
    expect(screen.getAllByText('Waiting for your sign-off')).toHaveLength(2); // section and card
    expect(screen.getByText('Waiting for a coach or physio')).toBeTruthy();
    expect(screen.getByText('Other Child · Ankle')).toBeTruthy();
  });

  it('shows the empty message for whatever the database leaves out', async () => {
    // An under-18's injury without consent never reaches a coach.
    await openList('coach', []);
    expect(screen.getByText('No current injuries.')).toBeTruthy();
    expect(
      screen.getByText(/An athlete under 18 shows to their coaches, physios and the committee members cleared to work with children only once a parent or guardian gives consent\./),
    ).toBeTruthy();
  });

  it('asks the database for cleared injuries only when chosen', async () => {
    await openList('committee', []);
    expect(rpcCalls()).toContainEqual(['visible_injuries', { p_include_cleared: false }]);
    await fireEvent.press(screen.getByText('Including cleared'));
    await settle();
    expect(rpcCalls()).toContainEqual(['visible_injuries', { p_include_cleared: true }]);
    expect(screen.getByText('No injuries have been reported.')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// One injury

async function openInjury(
  who: Who,
  shown: Injury | null,
  updates: InjuryUpdate[] = [],
  extra: BackendOptions = {},
) {
  await openScreen(
    who,
    { 'injuries/[id]': InjuryScreen },
    '/injuries/inj-1',
    { injury_updates: updates },
    {
      ...extra,
      rpcs: {
        visible_injuries: shown ? [shown] : [],
        can_share_injury: false,
        // The database refuses the log to everyone but the athlete, guardians and admins.
        ...extra.rpcs,
      },
      rpcErrors: extra.rpcErrors ?? {
        injury_document_log: 'Only the athlete, their guardians and admins see who opened documents',
      },
    },
  );
}

const ACTIONS = [
  'Add physio update',
  'Ask for clearance',
  'Endorse clearance',
  'Accept clearance',
  'Send back',
] as const;

function shownActions() {
  return ACTIONS.filter((a) => screen.queryAllByText(a).length > 0);
}

describe('one injury', () => {
  it('says so when the database doesn’t return it', async () => {
    await openInjury('coach', null);
    expect(screen.getByText('This injury isn’t available.')).toBeTruthy();
    expect(shownActions()).toEqual([]);
  });

  it('shows the details and records the view against the athlete', async () => {
    await openInjury('coach', injury());
    expect(screen.getByText('Hamstring')).toBeTruthy();
    expect(screen.getByText('Sample Child')).toBeTruthy();
    expect(screen.getByText('No sprinting')).toBeTruthy();
    expect(rpcCalls()).toContainEqual([
      'log_record_view',
      { p_subject_id: 'child-1', p_kind: 'injury', p_record_id: 'inj-1' },
    ]);
  });

  describe('while injured', () => {
    it.each<[string, Who]>([
      ['athlete', 'athlete'],
      ['guardian', 'guardian'],
      ['coach who is the child’s guardian', morePersonas.coachGuardian],
    ])('lets the %s add an update or ask for clearance', async (_label, who) => {
      await openInjury(who, injury({ can_report: true }));
      expect(shownActions()).toEqual(['Add physio update', 'Ask for clearance']);
    });

    it.each<[string, Who]>([
      ['coach', 'coach'],
      ['physio', 'physio'],
      ['Head Physio', morePersonas.headPhysio],
      ['committee', 'committee'],
      ['admin', 'admin'],
      ['manager', 'manager'],
    ])('gives a %s nothing to do', async (_label, who) => {
      await openInjury(who, injury());
      expect(shownActions()).toEqual([]);
    });
  });

  describe('when clearance is asked for', () => {
    const requested = injury({ status: 'clearance_requested' });

    it.each<[string, Who]>([
      ['coach', 'coach'],
      ['assistant coach', morePersonas.assistantCoach],
      ['physio', 'physio'],
      ['Head Physio', morePersonas.headPhysio],
    ])('lets a %s it waits for endorse it or send it back', async (_label, who) => {
      await openInjury(who, { ...requested, waiting_for_me: true });
      expect(shownActions()).toEqual(['Endorse clearance', 'Send back']);
    });

    it.each<[string, Who]>([
      ['committee', 'committee'],
      ['admin', 'admin'],
    ])('lets the %s send it back before a coach looks at it, but not endorse it', async (_label, who) => {
      await openInjury(who, requested);
      expect(shownActions()).toEqual(['Send back']);
      expect(
        screen.getByText('Waiting for one of the athlete’s coaches or a physio to endorse it.'),
      ).toBeTruthy();
    });

    it.each<[string, Who]>([
      ['athlete', 'athlete'],
      ['guardian', 'guardian'],
      ['coach it isn’t waiting for', 'coach'],
      ['manager', 'manager'],
      // Their committee and admin roles are paused, so the database refuses them.
      ['committee member whose check lapsed', morePersonas.committeeExpiredCheck],
      ['stood-down admin', 'stoodDownAdmin'],
    ])('only tells a %s what it’s waiting for', async (_label, who) => {
      const own = who === 'athlete' || who === 'guardian';
      await openInjury(who, { ...requested, can_report: own });
      expect(shownActions()).toEqual([]);
      expect(
        screen.getByText('Waiting for one of the athlete’s coaches or a physio to endorse it.'),
      ).toBeTruthy();
    });

    // send_back_clearance refuses a member's own clearance, and the database
    // never sets waiting_for_me on their own or their own child's, so neither
    // gets a clearance action (can_report is true for exactly those two).
    it.each<[string, Persona, string]>([
      [
        'committee member who is the injured athlete',
        { ...personas.committee, profile: { ...personas.committee.profile!, extra_roles: ['athlete'] } },
        'committee',
      ],
      [
        'committee member who is the injured child’s guardian',
        { ...personas.committee, profile: { ...personas.committee.profile!, extra_roles: ['guardian'] } },
        'child-1',
      ],
      [
        'admin who is the injured child’s guardian',
        morePersonas.adminGuardian,
        'child-1',
      ],
    ])('gives a %s no way to send their own clearance back', async (_label, who, athleteId) => {
      await openInjury(who, { ...requested, athlete_id: athleteId, can_report: true });
      expect(shownActions()).toEqual([]);
      expect(
        screen.getByText('Waiting for one of the athlete’s coaches or a physio to endorse it.'),
      ).toBeTruthy();
    });

    it('opens the send-back form, which needs a reason', async () => {
      await openInjury('committee', requested);
      await fireEvent.press(screen.getByText('Send back'));
      expect(screen.getByText('Why is it being sent back?')).toBeTruthy();
      await fireEvent.press(screen.getAllByText('Send back').at(-1)!);
      await settle();
      expect(screen.getByText('Say why it’s being sent back.')).toBeTruthy();
      expect(rpcCalls().map(([name]) => name)).not.toContain('send_back_clearance');
    });
  });

  describe('once a coach endorses it', () => {
    const endorsed = injury({ status: 'coach_endorsed', coach_endorsed_by: 'coach' });

    it.each<[string, Who]>([
      ['committee', 'committee'],
      ['admin', 'admin'],
    ])('lets the %s it waits for accept it or send it back', async (_label, who) => {
      await openInjury(who, { ...endorsed, waiting_for_me: true });
      expect(shownActions()).toEqual(['Accept clearance', 'Send back']);
    });

    it.each<[string, Who]>([
      // The coach who endorsed it, a committee member who is the child's guardian:
      // the database leaves waiting_for_me off for them.
      ['coach who endorsed it', 'coach'],
      ['physio', 'physio'],
      ['committee member it isn’t waiting for', 'committee'],
      ['athlete', 'athlete'],
      ['guardian', 'guardian'],
    ])('gives a %s nothing to do', async (_label, who) => {
      await openInjury(who, endorsed);
      expect(shownActions()).toEqual([]);
      expect(
        screen.getByText(
          'Waiting for a committee member to accept it. It has to be someone other than the coach or physio who endorsed it.',
        ),
      ).toBeTruthy();
    });

    it('warns before accepting that it clears the athlete to play', async () => {
      await openInjury('committee', { ...endorsed, waiting_for_me: true });
      await fireEvent.press(screen.getByText('Accept clearance'));
      expect(screen.getByText('Accept and clear to play')).toBeTruthy();
      expect(
        screen.getByText(
          'This clears the athlete to train and play. Check the proof in the history below first.',
        ),
      ).toBeTruthy();
    });
  });

  it.each<[string, Who]>([
    ['athlete', 'athlete'],
    ['coach', 'coach'],
    ['committee', 'committee'],
    ['admin', 'admin'],
  ])('offers a %s nothing once cleared', async (_label, who) => {
    await openInjury(who, injury({ status: 'cleared', cleared_at: '2026-10-17T00:00:00Z', can_report: who === 'athlete' }));
    expect(shownActions()).toEqual([]);
    expect(screen.getAllByText('Cleared to play').length).toBeGreaterThan(0);
  });

  describe('documents', () => {
    it.each<[string, Who]>([
      ['coach', 'coach'],
      ['physio', 'physio'],
      ['committee member who isn’t accepting it', 'committee'],
    ])('lets a %s view a document in the app, but not share it or see who opened it', async (_label, who) => {
      await openInjury(who, injury({ status: 'clearance_requested' }), [LETTER]);
      expect(screen.getByText('📎 Physio letter.pdf')).toBeTruthy();
      expect(screen.getByText('View')).toBeTruthy();
      expect(screen.queryByText('Share')).toBeNull();
      expect(screen.queryByText('Nobody has opened it yet.')).toBeNull();
      expect(
        screen.getByText(
          'Documents open in the app only. Every view and share is recorded and shown to the athlete, their guardians and admins.',
        ),
      ).toBeTruthy();
    });

    it('lets the committee member accepting the clearance share its documents', async () => {
      await openInjury(
        'committee',
        injury({ status: 'coach_endorsed', waiting_for_me: true }),
        [LETTER],
        { rpcs: { can_share_injury: true } },
      );
      expect(screen.getByText('View')).toBeTruthy();
      expect(screen.getByText('Share')).toBeTruthy();
      expect(screen.getByText(/This clearance is waiting for the committee, so you can Share its documents/)).toBeTruthy();
    });

    const LOG: InjuryDocumentEvent[] = [
      {
        document_path: LETTER.document_path!,
        viewer_name: 'Sample coach',
        viewer_role: 'Head coach',
        kind: 'viewed',
        created_at: '2026-10-17T01:00:00Z',
      },
    ];

    it.each<[string, Who]>([
      ['guardian', 'guardian'],
      ['admin', 'admin'],
    ])('shows a %s who opened each document', async (_label, who) => {
      await openInjury(who, injury({ can_report: who === 'guardian' }), [LETTER], {
        rpcs: { injury_document_log: LOG },
        rpcErrors: {},
      });
      expect(screen.getByText(/^Viewed by Sample coach \(head coach\) · /)).toBeTruthy();
      expect(screen.queryByText('Share')).toBeNull();
    });

    it('tells the athlete when nobody has opened a document yet', async () => {
      await openInjury('athlete', injury({ can_report: true }), [LETTER], {
        rpcs: { injury_document_log: [] },
        rpcErrors: {},
      });
      expect(screen.getByText('Nobody has opened it yet.')).toBeTruthy();
    });

    it('keeps the record of a document removed after the keep period, with nothing to open', async () => {
      await openInjury('committee', injury(), [
        { ...LETTER, document_removed_at: '2026-10-17T00:00:00Z' },
      ]);
      expect(screen.getByText('📎 Physio letter.pdf')).toBeTruthy();
      expect(screen.getByText(/after the club’s keep period\. The record of it stays\./)).toBeTruthy();
      expect(screen.queryByText('View')).toBeNull();
    });
  });

  it('shows the history with who wrote each entry', async () => {
    await openInjury('coach', injury(), [
      update({ id: 'u2', kind: 'physio_update', author_name: 'Sample Guardian', notes: 'Rest a week', restrictions: 'No running', expected_return: '2026-10-31' }),
      update({ id: 'u1', kind: 'reported', author_name: null, notes: null }),
    ]);
    expect(screen.getByText('Physio update')).toBeTruthy();
    expect(screen.getByText('Rest a week')).toBeTruthy();
    expect(screen.getByText(/^Restrictions: No running · Expected back:/)).toBeTruthy();
    expect(screen.getByText('Reported the injury')).toBeTruthy();
    expect(screen.getByText('Former member')).toBeTruthy();
  });

  it('offers everyone a way to raise a concern about it', async () => {
    await openInjury('athlete', injury({ can_report: true }));
    expect(screen.getByText('Worried about something? Raise a concern')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// On a tablet: an injury opens beside the list

describe('the injuries list on a tablet', () => {
  onATablet();

  let push: jest.SpyInstance;
  beforeEach(() => {
    push = jest.spyOn(router, 'push').mockImplementation(() => {});
  });
  afterEach(() => push.mockRestore());

  const KNEE = injury({ id: 'inj-2', athlete_id: 'a-2', athlete_name: 'Other Athlete', body_area: 'Knee', restrictions: 'No jumping' });

  async function open(who: Who, injuries: Injury[] = [injury(), KNEE]) {
    await openScreen(who, { 'injuries/index': InjuriesScreen }, '/injuries', { injury_updates: [] }, {
      rpcs: { can_share_injury: false },
      rpcHandlers: {
        // The list asks for every injury the member may see, an injury's screen for one.
        visible_injuries: (args) =>
          args.p_injury_id ? injuries.filter((i) => i.id === args.p_injury_id) : injuries,
      },
      rpcErrors: {
        injury_document_log: 'Only the athlete, their guardians and admins see who opened documents',
      },
    });
  }
  const beside = () => within(screen.getByTestId('detail-pane'));
  const list = () => within(screen.getByTestId('list-pane'));
  const called = (name: string) => rpcCalls().filter(([n]) => n === name);

  it.each<[string, Who]>([
    ['coach', 'coach'],
    ['physio', 'physio'],
    ['committee member', 'committee'],
    ['admin', 'admin'],
  ])('opens nothing for a %s, and records no view, until an injury is tapped', async (_l, who) => {
    await open(who);
    expect(beside().getByText('Choose an injury to open it here.')).toBeTruthy();
    expect(list().getByText('Sample Child · Hamstring')).toBeTruthy();
    expect(called('log_record_view')).toHaveLength(0);
    expect(called('can_share_injury')).toHaveLength(0);
  });

  it('opens the tapped injury beside the list, and records that view only', async () => {
    await open('coach');
    await fireEvent.press(list().getByText('Other Athlete · Knee'));
    await settle();
    expect(push).not.toHaveBeenCalled();
    expect(beside().getByText('No jumping')).toBeTruthy();
    expect(beside().queryByText('No sprinting')).toBeNull();
    expect(list().getByText('Sample Child · Hamstring')).toBeTruthy();
    expect(called('log_record_view')).toEqual([
      ['log_record_view', { p_subject_id: 'a-2', p_kind: 'injury', p_record_id: 'inj-2' }],
    ]);
  });

  it('marks which injury is open', async () => {
    await open('coach');
    await fireEvent.press(list().getByText('Other Athlete · Knee'));
    await settle();
    // The cards, leaving out the Current and Cleared chips above them.
    const cards = list()
      .getAllByRole('button')
      .filter((b) => within(b).queryByText(/ · /) !== null);
    expect(
      cards.map((card) => [
        [within(card).getByText(/ · /).props.children].flat().join(''),
        card.props.accessibilityState?.selected,
      ]),
    ).toEqual([
      ['Sample Child · Hamstring', false],
      ['Other Athlete · Knee', true],
    ]);
  });

  it.each<[string, Who, string[]]>([
    ['guardian', 'guardian', ['Add physio update', 'Ask for clearance']],
    ['coach', 'coach', []],
    ['admin', 'admin', []],
  ])('offers a %s beside the list what the injury’s own screen offers', async (_l, who, actions) => {
    await open(who, [injury({ can_report: who === 'guardian' })]);
    await fireEvent.press(list().getByText('Sample Child · Hamstring'));
    await settle();
    expect(ACTIONS.filter((a) => beside().queryAllByText(a).length > 0)).toEqual(actions);
  });

  it('reloads the list when an update is saved, and keeps the injury open', async () => {
    await open('guardian', [injury({ can_report: true })]);
    await fireEvent.press(list().getByText('Sample Child · Hamstring'));
    await settle();
    const listLoads = () => called('visible_injuries').filter(([, a]) => !(a as { p_injury_id?: string }).p_injury_id).length;
    const before = listLoads();
    await fireEvent.press(beside().getByText('Add physio update'));
    await fireEvent.changeText(beside().getByPlaceholderText('Progress, treatment and what to do next'), 'Resting it');
    await fireEvent.press(beside().getByText('Save update'));
    await settle();
    expect(called('add_injury_update')).toHaveLength(1);
    expect(listLoads()).toBe(before + 1);
    expect(beside().getByText('No sprinting')).toBeTruthy();
  });

  it('closes the injury from the cross', async () => {
    await open('coach');
    await fireEvent.press(list().getByText('Other Athlete · Knee'));
    await settle();
    await fireEvent.press(screen.getByLabelText(/^Close /));
    await settle();
    expect(beside().getByText('Choose an injury to open it here.')).toBeTruthy();
    expect(screen.queryByText('No jumping')).toBeNull();
  });
});

describe('the injuries list on a phone', () => {
  it('opens an injury on its own screen', async () => {
    const push = jest.spyOn(router, 'push').mockImplementation(() => {});
    try {
      await openList('coach', [injury()]);
      expect(screen.queryByTestId('list-detail')).toBeNull();
      await fireEvent.press(screen.getByText('Sample Child · Hamstring'));
      expect(push).toHaveBeenCalledWith({ pathname: '/injuries/[id]', params: { id: 'inj-1' } });
    } finally {
      push.mockRestore();
    }
  });
});
