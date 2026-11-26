/**
 * What the concern screens show once they're open: raising a concern
 * (src/app/concern/new.tsx), which every signed-in member can do, and the
 * register (concerns/index.tsx, [id].tsx and report.tsx), for the Child
 * Safety Officer, the Complaints Manager and admins.
 *
 * The database decides which concerns reach the register (`concern_register`
 * returns nothing to anyone else, and nothing about the member themselves),
 * and hides the name of whoever asked not to be named. The tests seed what it
 * would return for each member and check the screens show that, keep an
 * anonymous raiser anonymous, and prompt a referral for a child's safety.
 */
import { router } from 'expo-router';
import { fireEvent, screen, within } from 'expo-router/testing-library';

import RaiseConcernScreen from '@/app/concern/new';
import ConcernScreen from '@/app/concerns/[id]';
import ConcernsScreen from '@/app/concerns/index';
import ConcernsReportScreen from '@/app/concerns/report';
import WellbeingFlagsScreen from '@/app/concerns/wellbeing';
import { formatDateString } from '@/lib/injuries';
import { supabase } from '@/lib/supabase';
import type { Concern, ConcernEvent, MyConcern, SafeguardingContacts } from '@/lib/types';
import type { WellbeingFlag } from '@/lib/wellbeing-flags';

import {
  morePersonas,
  onATablet,
  openScreen,
  personas,
  resetClub,
  setClubFeatures,
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

const rpcCalls = () => (supabase.rpc as jest.Mock).mock.calls as [string, unknown][];

beforeEach(() => {
  resetClub();
  (supabase.rpc as jest.Mock).mockClear();
});

const CONTACTS: SafeguardingContacts = {
  child_safety_officer_id: 'cso',
  child_safety_officer_name: 'Sample Officer',
  complaints_manager_id: 'cm',
  complaints_manager_name: 'Sample Manager',
  governing_body_name: 'State Netball',
  governing_body_phone: '08 9000 0000',
  governing_body_url: 'https://example.test/complaints',
  policy_url: null,
};

function concern(extra: Partial<Concern> = {}): Concern {
  return {
    id: 'con-1',
    created_at: '2026-10-16T02:00:00Z',
    raised_by_name: 'Sample Guardian',
    anonymous: false,
    contact_ok: true,
    contact_details: '0400 000 000 after 5',
    about_member_id: null,
    about_member_name: null,
    about_text: 'A parent at training',
    happened_on: '2026-10-14',
    body: 'Shouted at the under 12s',
    involves_child: 'yes',
    context: null,
    status: 'received',
    closed_at: null,
    last_action_at: null,
    ...extra,
  };
}

const ANONYMOUS = concern({
  id: 'con-anon',
  raised_by_name: null,
  anonymous: true,
  contact_ok: false,
  contact_details: null,
  body: 'Saw something worrying',
  involves_child: 'unsure',
});

// A coach who is the club's Child Safety Officer.
const officer: Persona = { ...personas.coach, isSafeguardingOfficer: true };

// ---------------------------------------------------------------------------
// Raising a concern

async function openRaise(
  who: Who,
  mine: MyConcern[] = [],
  url = '/concern/new',
  tables: Record<string, unknown[]> = {},
) {
  await openScreen(who, { 'concern/new': RaiseConcernScreen }, url, tables, {
    rpcs: {
      safeguarding_contacts: [CONTACTS],
      concern_people: [
        { id: 'p1', name: 'Sample Parent' },
        { id: 'p2', name: 'Sample Person' },
      ],
      my_concerns: mine,
    },
  });
}

describe('raising a concern', () => {
  const EVERYONE: [string, Who][] = [
    ['athlete', 'athlete'],
    ['under-18 athlete', morePersonas.under18Athlete],
    ['guardian', 'guardian'],
    ['guest', 'guest'],
    ['temporary helper', 'volunteer'],
    ['member waiting for approval', 'pending'],
    ['coach', 'coach'],
    ['stood-down coach', 'stoodDownCoach'],
    ['admin', 'admin'],
  ];

  it('names every Child Safety Officer and Complaints Manager when a club has several', async () => {
    await openScreen('athlete', { 'concern/new': RaiseConcernScreen }, '/concern/new', {}, {
      rpcs: {
        safeguarding_contacts: [
          {
            ...CONTACTS,
            child_safety_officers: [
              { id: 'cso', name: 'Sample Officer' },
              { id: 'cso-2', name: 'Second Officer' },
            ],
            complaints_managers: [{ id: 'cm', name: 'Sample Manager' }],
          },
        ],
        concern_people: [],
        my_concerns: [],
      },
    });
    expect(screen.getByText('Child Safety Officers: Sample Officer and Second Officer')).toBeTruthy();
    expect(screen.getByText('Complaints Manager: Sample Manager')).toBeTruthy();
  });

  it.each(EVERYONE)('lets a %s raise one, and shows who to call first', async (_l, who) => {
    await openRaise(who);
    expect(screen.getByText('If a child is in danger now, call 000.')).toBeTruthy();
    expect(screen.getByText('Child Safety Officer: Sample Officer')).toBeTruthy();
    expect(screen.getByText('Complaints Manager: Sample Manager')).toBeTruthy();
    expect(screen.getByText(/^Kids Helpline/)).toBeTruthy();
    expect(screen.getByText('What happened?')).toBeTruthy();
    expect(screen.getByText('Send to the club')).toBeTruthy();
  });

  it('says the person it’s about won’t see it', async () => {
    await openRaise('athlete');
    expect(
      screen.getByText(/The club’s Child Safety Officers, Complaints Managers and admins see it, but not anyone it’s about\./),
    ).toBeTruthy();
  });

  it('shows the member the concerns they’ve raised and where each is up to', async () => {
    await openRaise('guardian', [
      { id: 'm1', created_at: '2026-10-10T02:00:00Z', status: 'under_review', about_text: 'A coach', anonymous: true },
    ]);
    expect(screen.getByText('Concerns you’ve raised')).toBeTruthy();
    expect(screen.getByText('Being looked into · your name not shown')).toBeTruthy();
  });

  it('shows no list of past concerns to someone who hasn’t raised any', async () => {
    await openRaise('athlete');
    expect(screen.queryByText('Concerns you’ve raised')).toBeNull();
  });

  it('keeps where it was raised from with the concern', async () => {
    await openRaise('athlete', [], '/concern/new?context=Message%20from%20Sample%20coach');
    expect(screen.getByText('About: Message from Sample coach')).toBeTruthy();
  });

  it('drops the contact questions when the member hides their name', async () => {
    await openRaise('athlete');
    expect(screen.getByText('Can they contact you about it?')).toBeTruthy();
    await fireEvent.press(screen.getByText('Don’t show my name'));
    expect(screen.queryByText('Can they contact you about it?')).toBeNull();
    expect(screen.getByText(/The people who look into it won’t see who you are/)).toBeTruthy();
  });

  it('needs something written before it sends', async () => {
    await openRaise('athlete');
    await fireEvent.press(screen.getByText('Send to the club'));
    await settle();
    expect(screen.getByText('Say what happened.')).toBeTruthy();
    expect(rpcCalls().map(([n]) => n)).not.toContain('raise_concern');
  });

  it('sends an anonymous concern without contact details, then thanks them', async () => {
    await openRaise('athlete');
    await fireEvent.changeText(screen.getByPlaceholderText('In your own words'), 'Something happened');
    await fireEvent.press(screen.getByText('Don’t show my name'));
    await fireEvent.press(screen.getByText('Send to the club'));
    await settle();
    const sent = rpcCalls().find(([n]) => n === 'raise_concern');
    expect(sent?.[1]).toMatchObject({
      p_body: 'Something happened',
      p_anonymous: true,
      p_contact_ok: false,
      p_involves_child: 'unsure',
      p_context: null,
      p_message_id: null,
    });
    expect(screen.getByText('Thank you for telling us')).toBeTruthy();
  });

  describe('reporting a message', () => {
    const REPORTED = {
      id: 'msg-1',
      sender_name: 'Sample Coach',
      created_at: '2026-10-17T10:30:00Z',
      body: 'Come early on your own',
    };
    const url = '/concern/new?context=Message%20from%20Sample%20Coach&message=msg-1';

    it('shows the message being reported, and that a copy is kept', async () => {
      await openRaise(morePersonas.under18Athlete, [], url, { messages: [REPORTED] });
      expect(screen.getByText('The message you’re reporting')).toBeTruthy();
      expect(screen.getByText(/^From Sample Coach, /)).toBeTruthy();
      expect(screen.getByText('Come early on your own')).toBeTruthy();
      expect(screen.getByText(/A copy of this message is kept with your concern/)).toBeTruthy();
      expect(screen.queryByText(/^About: /)).toBeNull();
    });

    it('sends the message with the concern, keeping their name hidden if they ask', async () => {
      await openRaise('athlete', [], url, { messages: [REPORTED] });
      await fireEvent.changeText(screen.getByPlaceholderText('In your own words'), 'Strange message');
      await fireEvent.press(screen.getByText('Don’t show my name'));
      await fireEvent.press(screen.getByText('Send to the club'));
      await settle();
      expect(rpcCalls().find(([n]) => n === 'raise_concern')?.[1]).toMatchObject({
        p_body: 'Strange message',
        p_anonymous: true,
        p_contact_ok: false,
        p_context: 'Message from Sample Coach',
        p_message_id: 'msg-1',
      });
    });

    it('still sends where it came from when the message can’t be shown', async () => {
      await openRaise('athlete', [], url, { messages: [] });
      expect(screen.queryByText('The message you’re reporting')).toBeNull();
      expect(screen.getByText('About: Message from Sample Coach')).toBeTruthy();
      await fireEvent.changeText(screen.getByPlaceholderText('In your own words'), 'Strange message');
      await fireEvent.press(screen.getByText('Send to the club'));
      await settle();
      // The database refuses a message they can't see, so nothing is copied.
      expect(rpcCalls().find(([n]) => n === 'raise_concern')?.[1]).toMatchObject({ p_message_id: 'msg-1' });
    });
  });

  it('offers matching members to name who it’s about', async () => {
    await openRaise('athlete');
    await fireEvent.changeText(screen.getByPlaceholderText('Name'), 'sample p');
    expect(screen.getByText('+ Sample Parent')).toBeTruthy();
    expect(screen.getByText('+ Sample Person')).toBeTruthy();
  });

  it('offers members from the first letter typed', async () => {
    await openRaise('athlete');
    await fireEvent.changeText(screen.getByPlaceholderText('Name'), 'P');
    expect(screen.getByText('+ Sample Parent')).toBeTruthy();
    expect(screen.getByText('+ Sample Person')).toBeTruthy();
  });

  it('shows each person picked right under the search box, and clears the search', async () => {
    await openRaise('athlete');
    const chosen = () => within(screen.getByTestId('Who is it about? (optional) chosen'));
    expect(chosen().getByText('Nobody named yet.')).toBeTruthy();
    await fireEvent.changeText(screen.getByPlaceholderText('Name'), 'parent');
    await fireEvent.press(screen.getByText('+ Sample Parent'));
    expect(chosen().getByText('Sample Parent  ✕')).toBeTruthy();
    expect(screen.getByPlaceholderText('Name').props.value).toBe('');
    expect(screen.getByText('1 of 10')).toBeTruthy();
  });

  it('names several people, takes one off again, and sends the rest with their own words', async () => {
    await openRaise('athlete');
    await fireEvent.changeText(screen.getByPlaceholderText('In your own words'), 'Left behind after training');
    await fireEvent.changeText(screen.getByPlaceholderText('Name'), 'parent');
    await fireEvent.press(screen.getByText('+ Sample Parent'));
    await fireEvent.changeText(screen.getByPlaceholderText('Name'), 'person');
    await fireEvent.press(screen.getByText('+ Sample Person'));
    // Someone already picked isn't offered again.
    await fireEvent.changeText(screen.getByPlaceholderText('Name'), 'sample');
    expect(screen.queryByText('+ Sample Parent')).toBeNull();
    await fireEvent.changeText(screen.getByPlaceholderText('Name'), '');
    await fireEvent.press(screen.getByLabelText('Take Sample Parent off Who is it about? (optional)'));
    await fireEvent.changeText(
      screen.getByPlaceholderText('A name or a description, if they’re not in the search'),
      'A parent helper',
    );
    await fireEvent.press(screen.getByText('Send to the club'));
    await settle();
    expect(rpcCalls().find(([n]) => n === 'raise_concern')?.[1]).toMatchObject({
      p_about_member_ids: ['p2'],
      p_about_text: 'A parent helper',
    });
  });

  it('sends nobody named as an empty list', async () => {
    await openRaise('athlete');
    await fireEvent.changeText(screen.getByPlaceholderText('In your own words'), 'Something happened');
    await fireEvent.press(screen.getByText('Send to the club'));
    await settle();
    expect(rpcCalls().find(([n]) => n === 'raise_concern')?.[1]).toMatchObject({ p_about_member_ids: [] });
  });

  it('lists only the adults with club roles, never every member', async () => {
    await openRaise('guest');
    expect(rpcCalls().map(([n]) => n)).toContain('concern_people');
    expect(rpcCalls().map(([n]) => n)).not.toContain('concern_about_people');
  });
});

// ---------------------------------------------------------------------------
// The register

async function openRegister(who: Who, concerns: Concern[]) {
  await openScreen(who, { 'concerns/index': ConcernsScreen }, '/concerns', {}, {
    rpcs: { concern_register: concerns },
  });
}

describe('the concerns register', () => {
  const HANDLERS: [string, Who][] = [
    ['Child Safety Officer', officer],
    ['admin', 'admin'],
  ];

  it.each(HANDLERS)('lists open and closed concerns for the %s', async (_l, who) => {
    await openRegister(who, [concern(), concern({ id: 'con-2', status: 'closed', body: 'Old matter', involves_child: 'no' })]);
    expect(screen.getByText('Open')).toBeTruthy();
    expect(screen.getByText('Shouted at the under 12s')).toBeTruthy();
    expect(screen.getByText('Received · child’s safety · from Sample Guardian')).toBeTruthy();
    expect(screen.getByText('Closed · from Sample Guardian')).toBeTruthy();
    expect(screen.getByText('Export the register as a PDF')).toBeTruthy();
  });

  it('never names someone who asked not to be named', async () => {
    await openRegister('admin', [ANONYMOUS]);
    expect(screen.getByText('Received · name not shown')).toBeTruthy();
    expect(screen.queryByText(/from /)).toBeNull();
  });

  it('shows everyone a concern is about', async () => {
    await openRegister(officer, [
      concern({
        about_member_id: 'p1',
        about_member_name: 'Sample Parent',
        about_members: [
          { id: 'p1', name: 'Sample Parent' },
          { id: null, name: 'A former coach' },
        ],
      }),
    ]);
    expect(screen.getByText(/ · about Sample Parent, A former coach$/)).toBeTruthy();
  });

  it('shows who a concern is about by their member name', async () => {
    await openRegister(officer, [concern({ about_member_id: 'p1', about_member_name: 'Sample Parent' })]);
    expect(screen.getByText(/ · about Sample Parent$/)).toBeTruthy();
  });

  it('shows empty sections when the database returns nothing', async () => {
    // A concern about the officer themselves never reaches them.
    await openRegister(officer, []);
    expect(screen.getByText('No open concerns.')).toBeTruthy();
    expect(screen.getByText('None closed yet.')).toBeTruthy();
  });

  it.each(HANDLERS)('describes the register and offers the PDF to the %s', async (_l, who) => {
    await openRegister(who, []);
    expect(screen.getByText(/^Concerns raised by members, newest first\./)).toBeTruthy();
    expect(screen.getByText('Export the register as a PDF')).toBeTruthy();
  });

  it.each<[string, Who]>([
    ['athlete', 'athlete'],
    ['guardian', 'guardian'],
    ['coach', 'coach'],
    ['committee member', 'committee'],
    ['stood-down admin', 'stoodDownAdmin'],
  ])('offers a %s who doesn’t handle concerns no export and no register', async (_l, who) => {
    await openRegister(who, []);
    expect(screen.queryByText('Export the register as a PDF')).toBeNull();
    expect(screen.queryByText(/^Concerns raised by members/)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// One concern

async function openConcern(
  who: Who,
  shown: Concern | null,
  history: ConcernEvent[] = [],
  more: Record<string, unknown> = {},
  rpcErrors: Record<string, string> = {},
) {
  await openScreen(who, { 'concerns/[id]': ConcernScreen }, `/concerns/${shown?.id ?? 'con-1'}`, {}, {
    rpcErrors,
    rpcs: {
      ...more,
      concern_register: shown ? [shown] : [],
      concern_history: history,
      concern_about_people: [
        { id: 'p1', name: 'Sample Parent' },
        { id: 'p3', name: 'Avery Athlete' },
      ],
      safeguarding_contacts: [CONTACTS],
    },
  });
}

const REFERRAL = 'Child abuse or a serious crime?';

describe('one concern', () => {
  it.each<[string, Who]>([
    ['athlete', 'athlete'],
    ['coach', 'coach'],
    ['committee member', 'committee'],
    // An officer it's about: the database leaves it out.
    ['Child Safety Officer it’s about', officer],
  ])('tells a %s it isn’t available when the database doesn’t return it', async (_l, who) => {
    await openConcern(who, null);
    expect(screen.getByText(/This concern isn’t available to you\./)).toBeTruthy();
    expect(screen.queryByText('Add note')).toBeNull();
    expect(screen.queryByText('Referred to Police')).toBeNull();
  });

  it.each<[string, Who]>([
    ['Child Safety Officer', officer],
    ['admin', 'admin'],
  ])('shows the %s everything raised, with ways to record what they did', async (_l, who) => {
    await openConcern(who, concern());
    expect(screen.getByText('Shouted at the under 12s')).toBeTruthy();
    expect(screen.getByText('About: A parent at training')).toBeTruthy();
    expect(screen.getByText('Raised by: Sample Guardian')).toBeTruthy();
    expect(screen.getByText('Contact: 0400 000 000 after 5')).toBeTruthy();
    expect(screen.getByText('Referred to State Netball')).toBeTruthy();
    expect(screen.getByText('Referred to Police')).toBeTruthy();
    expect(screen.getByText('Add note')).toBeTruthy();
    expect(screen.getByText('Nothing recorded yet.')).toBeTruthy();
  });

  it('keeps an anonymous raiser anonymous, with no contact line', async () => {
    await openConcern('admin', ANONYMOUS);
    expect(screen.getByText('Raised by: They asked for their name not to be shown')).toBeTruthy();
    expect(screen.queryByText(/^Contact:/)).toBeNull();
  });

  it('says when the raiser asked not to be contacted', async () => {
    await openConcern('admin', concern({ contact_ok: false }));
    expect(screen.getByText('Contact: Asked not to be contacted')).toBeTruthy();
  });

  it('prompts a referral while a child’s safety may be involved', async () => {
    await openConcern(officer, concern({ involves_child: 'unsure' }));
    expect(screen.getByText(REFERRAL)).toBeTruthy();
    expect(screen.getByText(/Refer it to Police and State Netball straight away/)).toBeTruthy();
  });

  it.each<[string, Partial<Concern>, ConcernEvent[]]>([
    ['no child is involved', { involves_child: 'no' }, []],
    ['it’s closed', { status: 'closed' }, []],
    [
      'it has been referred',
      {},
      [{ id: 'e1', created_at: '2026-10-17T00:00:00Z', by_name: 'Sample Officer', kind: 'referred_police', status: 'referred', note: 'Ref 123' }],
    ],
  ])('stops prompting a referral once %s', async (_l, extra, history) => {
    await openConcern(officer, concern(extra), history);
    expect(screen.queryByText(REFERRAL)).toBeNull();
  });

  it('shows everything done about it, and by whom', async () => {
    await openConcern(officer, concern(), [
      { id: 'e1', created_at: '2026-10-17T00:00:00Z', by_name: 'Sample Officer', kind: 'referred_police', status: 'referred', note: 'Ref 123' },
      { id: 'e2', created_at: '2026-10-17T01:00:00Z', by_name: null, kind: 'status_changed', status: 'under_review', note: null },
    ]);
    // The button, and the event.
    expect(screen.getAllByText('Referred to Police')).toHaveLength(2);
    expect(screen.getByText('Ref 123')).toBeTruthy();
    expect(screen.getByText('Status changed: Being looked into')).toBeTruthy();
    expect(screen.getByText(/ by a former member$/)).toBeTruthy();
  });

  it('only offers status changes away from the current one', async () => {
    await openConcern(officer, concern({ status: 'under_review' }));
    expect(screen.queryByText('Being looked into')).toBeNull();
    await fireEvent.press(screen.getByText('Closed'));
    expect(screen.getByText('Close it (the note says why)')).toBeTruthy();
  });

  it('shows the reported message in full: who sent it, when and what it said', async () => {
    await openConcern(
      officer,
      concern({
        context: 'Message from Sample Coach, Saturday 17 October, 6:30 pm',
        reported_message_sender_name: 'Sample Coach',
        reported_message_sent_at: '2026-10-17T10:30:00Z',
        reported_message_body: 'Come early on your own, don’t tell your parents',
      }),
    );
    expect(screen.getByText('Reported message')).toBeTruthy();
    expect(screen.getByText(/^From Sample Coach, /)).toBeTruthy();
    expect(screen.getByText('Come early on your own, don’t tell your parents')).toBeTruthy();
  });

  it('shows no reported message for a concern raised some other way', async () => {
    await openConcern(officer, concern());
    expect(screen.queryByText('Reported message')).toBeNull();
  });

  describe('naming who it’s about', () => {
    it('searches every approved member, athletes and parents included', async () => {
      await openConcern(officer, concern());
      expect(rpcCalls().map(([n]) => n)).toContain('concern_about_people');
      expect(rpcCalls().map(([n]) => n)).not.toContain('concern_people');
    });

    it('finds members from the first letter typed', async () => {
      await openConcern('admin', concern());
      await fireEvent.changeText(screen.getByPlaceholderText('Name'), 'A');
      expect(screen.getByText('+ Avery Athlete')).toBeTruthy();
      expect(screen.queryByText('+ Sample Parent')).toBeNull();
    });

    it('adds the member picked, straight away', async () => {
      await openConcern('admin', concern());
      await fireEvent.changeText(screen.getByPlaceholderText('Name'), 'Avery');
      await fireEvent.press(screen.getByText('+ Avery Athlete'));
      await settle();
      expect(rpcCalls().find(([n]) => n === 'add_concern_about')?.[1]).toMatchObject({
        p_concern_id: 'con-1',
        p_member_id: 'p3',
      });
      expect(rpcCalls().map(([n]) => n)).not.toContain('set_concern_about');
    });

    it('says when nobody matches, instead of showing nothing', async () => {
      await openConcern('admin', concern());
      await fireEvent.changeText(screen.getByPlaceholderText('Name'), 'zz');
      expect(screen.getByText('Nobody matches “zz”.')).toBeTruthy();
    });

    it('shows everyone named right under the search box, each with a way to take them off', async () => {
      await openConcern(
        officer,
        concern({
          about_member_id: 'p1',
          about_member_name: 'Sample Parent',
          about_members: [
            { id: 'p1', name: 'Sample Parent' },
            { id: 'p3', name: 'Avery Athlete' },
          ],
        }),
      );
      const chosen = within(screen.getByTestId('Who it’s about chosen'));
      expect(chosen.getByText('Sample Parent  ✕')).toBeTruthy();
      expect(chosen.getByText('Avery Athlete  ✕')).toBeTruthy();
      expect(screen.getByText('About: Sample Parent, Avery Athlete')).toBeTruthy();
      await fireEvent.press(screen.getByLabelText('Take Avery Athlete off Who it’s about'));
      await settle();
      expect(rpcCalls().find(([n]) => n === 'remove_concern_about')?.[1]).toMatchObject({
        p_concern_id: 'con-1',
        p_member_id: 'p3',
      });
    });

    it('shows why the database refused a change beside the picker', async () => {
      await openConcern('admin', concern(), [], {}, { add_concern_about: 'Name up to 10 people' });
      await fireEvent.changeText(screen.getByPlaceholderText('Name'), 'Avery');
      await fireEvent.press(screen.getByText('+ Avery Athlete'));
      await settle();
      expect(screen.getByText('Name up to 10 people')).toBeTruthy();
    });
  });

  it('says nobody is named yet', async () => {
    await openConcern(officer, concern());
    expect(within(screen.getByTestId('Who it’s about chosen')).getByText('No member named.')).toBeTruthy();
  });

  it('shows the member named by an older register row, with the raiser’s words', async () => {
    await openConcern(officer, concern({ about_member_id: 'p1', about_member_name: 'Sample Parent' }));
    expect(within(screen.getByTestId('Who it’s about chosen')).getByText('Sample Parent  ✕')).toBeTruthy();
    expect(screen.getByText('About: Sample Parent')).toBeTruthy();
    expect(screen.getByText('In their words: A parent at training')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// The child's parents and guardians, on a concern about a child

describe('a concern about a child: their parents and guardians', () => {
  const aboutChild = concern({ about_member_id: 'p3', about_member_name: 'Avery Athlete' });
  const GUARDIANS = [
    { guardian_id: 'g1', name: 'Sample Parent', email: 'parent@example.test' },
    { guardian_id: 'g2', name: 'Sample Carer', email: null },
  ];
  const VIEWS = [
    { viewer_name: 'Sample Officer', created_at: '2026-10-18T02:00:00Z' },
    { viewer_name: null, created_at: '2026-10-17T02:00:00Z' },
  ];

  it('shows each verified parent and guardian with their email', async () => {
    await openConcern(officer, aboutChild, [], {
      concern_guardians: GUARDIANS,
      concern_guardian_views: VIEWS,
    });
    const card = within(screen.getByTestId('concern-guardians'));
    expect(card.getByText('Avery Athlete’s parents and guardians')).toBeTruthy();
    expect(card.getByText('Sample Parent · parent@example.test')).toBeTruthy();
    expect(card.getByText('Sample Carer')).toBeTruthy();
    expect(card.getByText(/never in the child’s record views, which parents read/)).toBeTruthy();
  });

  it('says who has looked, newest first', async () => {
    await openConcern(officer, aboutChild, [], {
      concern_guardians: GUARDIANS,
      concern_guardian_views: VIEWS,
    });
    expect(
      screen.getByText(
        `Looked at by Sample Officer ${formatDateString('2026-10-18')}, A former member ${formatDateString('2026-10-17')}`,
      ),
    ).toBeTruthy();
  });

  it('asks for the guardians of this concern, then who has looked', async () => {
    await openConcern(officer, aboutChild, [], {
      concern_guardians: GUARDIANS,
      concern_guardian_views: VIEWS,
    });
    expect(supabase.rpc).toHaveBeenCalledWith('concern_guardians', { p_concern_id: aboutChild.id });
    expect(supabase.rpc).toHaveBeenCalledWith('concern_guardian_views', {
      p_concern_id: aboutChild.id,
    });
  });

  it('groups the parents and guardians by child when it’s about several children', async () => {
    await openConcern(
      officer,
      concern({
        about_member_id: 'p3',
        about_member_name: 'Avery Athlete',
        about_members: [
          { id: 'p3', name: 'Avery Athlete' },
          { id: 'p4', name: 'Bailey Junior' },
        ],
      }),
      [],
      {
        concern_guardians: [
          { guardian_id: 'g1', name: 'Sample Parent', email: 'parent@example.test', child_id: 'p3', child_name: 'Avery Athlete' },
          { guardian_id: 'g1', name: 'Sample Parent', email: 'parent@example.test', child_id: 'p4', child_name: 'Bailey Junior' },
          { guardian_id: 'g3', name: 'Sample Aunt', email: null, child_id: 'p4', child_name: 'Bailey Junior' },
        ],
        concern_guardian_views: [],
      },
    );
    const card = within(screen.getByTestId('concern-guardians'));
    expect(card.getByText('Avery Athlete’s parents and guardians')).toBeTruthy();
    expect(card.getByText('Bailey Junior’s parents and guardians')).toBeTruthy();
    expect(card.getAllByText('Sample Parent · parent@example.test')).toHaveLength(2);
    expect(card.getByText('Sample Aunt')).toBeTruthy();
  });

  it('asks for the guardians when only the list of people names someone', async () => {
    await openConcern(
      officer,
      concern({ about_members: [{ id: 'p4', name: 'Bailey Junior' }] }),
      [],
      { concern_guardians: [] },
    );
    expect(supabase.rpc).toHaveBeenCalledWith('concern_guardians', { p_concern_id: 'con-1' });
  });

  it('shows nothing when the database lists nobody (an adult, or no verified parent)', async () => {
    await openConcern(officer, aboutChild, [], { concern_guardians: [] });
    expect(screen.queryByTestId('concern-guardians')).toBeNull();
    expect(supabase.rpc).not.toHaveBeenCalledWith('concern_guardian_views', expect.anything());
  });

  it('doesn’t ask, so no look is kept, when the concern names nobody', async () => {
    await openConcern(officer, concern(), [], { concern_guardians: GUARDIANS });
    expect(screen.queryByTestId('concern-guardians')).toBeNull();
    expect(supabase.rpc).not.toHaveBeenCalledWith('concern_guardians', expect.anything());
  });

  it('doesn’t ask for a concern the member can’t see', async () => {
    await openConcern(officer, null, [], { concern_guardians: GUARDIANS });
    expect(screen.queryByTestId('concern-guardians')).toBeNull();
    expect(supabase.rpc).not.toHaveBeenCalledWith('concern_guardians', expect.anything());
  });
});

// ---------------------------------------------------------------------------
// The register as a PDF

describe('the concerns register report', () => {
  it('counts open, unactioned, referred and closed concerns', async () => {
    await openScreen(officer, { 'concerns/report': ConcernsReportScreen }, '/concerns/report', {}, {
      rpcs: { safeguarding_contacts: [CONTACTS], concern_register: [concern(), concern({ id: 'c2', status: 'closed' })] },
      rpcHandlers: {
        concern_history: (args) =>
          args.p_concern_id === 'c2'
            ? [{ id: 'e1', created_at: '2026-10-17T00:00:00Z', by_name: 'Sample Officer', kind: 'referred_governing_body', status: 'referred', note: null }]
            : [],
      },
    });
    expect(screen.getByText('Concerns raised in the app, newest first')).toBeTruthy();
    expect(screen.getByText('Not acted on yet')).toBeTruthy();
    expect(screen.getByText('Referred to Police or the governing body')).toBeTruthy();
    expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(3);
  });

  it('shows the database’s refusal instead of a report', async () => {
    await openScreen('athlete', { 'concerns/report': ConcernsReportScreen }, '/concerns/report', {}, {
      rpcErrors: { concern_register: 'Not allowed' },
    });
    expect(screen.getByText('Not allowed')).toBeTruthy();
    expect(screen.queryByText('Not acted on yet')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Wellbeing flags, for the Child Safety Officer

const FLAGS: WellbeingFlag[] = [
  { athlete_id: 'a1', athlete_name: 'Sample Junior', day: '2026-10-18', lowest_score: 2, flags_in_7_days: 3 },
  { athlete_id: 'a2', athlete_name: 'Sample Senior', day: '2026-10-17', lowest_score: 1, flags_in_7_days: 1 },
  { athlete_id: 'a1', athlete_name: 'Sample Junior', day: '2026-10-16', lowest_score: 1, flags_in_7_days: 3 },
  { athlete_id: 'a1', athlete_name: 'Sample Junior', day: '2026-10-13', lowest_score: 2, flags_in_7_days: 3 },
];

describe('wellbeing flags', () => {
  async function openFlags(who: Who, options: Parameters<typeof openScreen>[4] = {}) {
    await openScreen(who, { 'concerns/wellbeing': WellbeingFlagsScreen }, '/concerns/wellbeing', {}, options);
  }

  it('shows the Child Safety Officer each athlete’s flagged days and lowest scores, never answers or notes', async () => {
    await openFlags(officer, { rpcs: { wellbeing_flags: FLAGS } });
    expect(rpcCalls()).toContainEqual(['wellbeing_flags', { p_days: 14 }]);
    expect(screen.getByText('Sample Junior')).toBeTruthy();
    expect(screen.getByText('Flagged on 3 days in the last 7')).toBeTruthy();
    expect(screen.getByText('Sample Senior')).toBeTruthy();
    expect(screen.getByText('Flagged on 1 day in the last 7')).toBeTruthy();
    expect(screen.getByText(`${formatDateString('2026-10-18')} · lowest score 2`)).toBeTruthy();
    expect(screen.getByText(`${formatDateString('2026-10-16')} · lowest score 1`)).toBeTruthy();
    expect(screen.getByText(/never their answers or notes/)).toBeTruthy();
    expect(screen.queryByText(/Sleep|Soreness|Stress|Mood/)).toBeNull();
  });

  it('lists the athlete flagged 3 times first', async () => {
    await openFlags(officer, { rpcs: { wellbeing_flags: [...FLAGS].reverse() } });
    const names = screen.getAllByText(/^Sample (Junior|Senior)$/).map((n) => n.props.children);
    expect(names).toEqual(['Sample Junior', 'Sample Senior']);
  });

  it('says when an athlete hasn’t been flagged this week', async () => {
    await openFlags(officer, {
      rpcs: { wellbeing_flags: [{ ...FLAGS[0], day: '2026-10-08', flags_in_7_days: 0 }] },
    });
    expect(screen.getByText('Not flagged in the last 7 days')).toBeTruthy();
  });

  it('says when nobody has been flagged', async () => {
    await openFlags(officer, { rpcs: { wellbeing_flags: [] } });
    expect(screen.getByText('Nobody has been flagged in the last 14 days.')).toBeTruthy();
  });

  it('links to raising a concern', async () => {
    await openFlags(officer, { rpcs: { wellbeing_flags: [] } });
    expect(screen.getByText('Raise a concern')).toBeTruthy();
  });

  it.each<[string, Who]>([
    ['an admin', 'admin'],
    ['the Complaints Manager', { ...personas.manager, isSafeguardingOfficer: true }],
    ['a coach', 'coach'],
  ])('shows %s the database’s refusal and no flags', async (_l, who) => {
    await openFlags(who, {
      rpcs: { wellbeing_flags: FLAGS },
      rpcErrors: { wellbeing_flags: 'Only the Child Safety Officer sees wellbeing flags' },
    });
    expect(screen.getByText('Only the Child Safety Officer sees wellbeing flags.')).toBeTruthy();
    expect(screen.queryByText('Sample Junior')).toBeNull();
  });

  describe('the link from the concerns register', () => {
    it('shows the Child Safety Officer the link, with how many were flagged 3 times in 7 days', async () => {
      await openScreen(officer, { 'concerns/index': ConcernsScreen }, '/concerns', {}, {
        rpcs: { concern_register: [], wellbeing_flag_alerts: 2 },
      });
      expect(screen.getByText('Wellbeing flags (2 to look at)')).toBeTruthy();
    });

    it('shows a plain link when nobody was flagged 3 times', async () => {
      await openScreen(officer, { 'concerns/index': ConcernsScreen }, '/concerns', {}, {
        rpcs: { concern_register: [], wellbeing_flag_alerts: 0 },
      });
      expect(screen.getByText('Wellbeing flags')).toBeTruthy();
    });

    it('hides it from admins and the Complaints Manager, who the database answers with nothing', async () => {
      for (const who of ['admin', { ...personas.manager, isSafeguardingOfficer: true }] as Who[]) {
        await openScreen(who, { 'concerns/index': ConcernsScreen }, '/concerns', {}, {
          rpcs: { concern_register: [], wellbeing_flag_alerts: null },
        });
        expect(screen.queryByText(/^Wellbeing flags/)).toBeNull();
      }
    });

    it('hides it, without asking, when the club has check-ins turned off', async () => {
      setClubFeatures({ checkIns: false });
      await openScreen(officer, { 'concerns/index': ConcernsScreen }, '/concerns', {}, {
        rpcs: { concern_register: [], wellbeing_flag_alerts: 2 },
      });
      expect(screen.queryByText(/^Wellbeing flags/)).toBeNull();
      expect(rpcCalls().map(([name]) => name)).not.toContain('wellbeing_flag_alerts');
    });
  });
});

// ---------------------------------------------------------------------------
// Escalation: a concern with nothing recorded for too long goes to the next
// person in its lead post's chain (supabase/tests/concern-clocks-and-escalation.sql).

describe('escalation', () => {
  const ESCALATIONS = [
    { reached_at: '2026-10-30T01:00:00Z', target_name: 'Child Safety Officer', skipped: false, reason: null },
    {
      reached_at: '2026-11-06T01:00:00Z',
      target_name: 'Sample Committee',
      skipped: true,
      reason: 'Nobody in this step could take it: everyone is named in the concern or can’t act',
    },
  ];
  // A coach a concern was escalated to by name: no post, not an admin.
  const named: Persona = { ...personas.coach, rpcs: { has_escalated_concerns: true } };

  it('shows each step, and who looked because it reached them by name', async () => {
    await openConcern(officer, concern(), [], {
      concern_escalation_history: ESCALATIONS,
      concern_escalated_view_log: [{ viewer_name: 'Sample Committee', viewed_at: '2026-11-07T01:00:00Z' }],
    });
    const card = within(screen.getByTestId('concern-escalations'));
    expect(card.getByText(`${formatDateString('2026-10-30')}: Escalated to Child Safety Officer`)).toBeTruthy();
    expect(card.getByText(/: Passed over Sample Committee: Nobody in this step could take it/)).toBeTruthy();
    expect(card.getByText(`Looked at by Sample Committee (${formatDateString('2026-11-07')})`)).toBeTruthy();
  });

  it('shows nothing about escalation for a concern that never escalated', async () => {
    await openConcern(officer, concern());
    expect(screen.queryByTestId('concern-escalations')).toBeNull();
  });

  it('notes each look, and the database keeps only those by someone named in a chain', async () => {
    await openConcern(named, concern());
    expect(rpcCalls()).toContainEqual(['note_escalated_concern_view', { p_concern_id: 'con-1' }]);
  });

  it('notes no look at a concern the member can’t see', async () => {
    await openConcern(named, null);
    expect(rpcCalls().map(([n]) => n)).not.toContain('note_escalated_concern_view');
  });

  it('lets someone it reached by name record steps, but not change who it’s about', async () => {
    await openConcern(named, concern());
    expect(screen.getByText('Add note')).toBeTruthy();
    expect(screen.queryByText('Who it’s about')).toBeNull();
    expect(screen.queryByText('Ask to read messages')).toBeNull();
  });

  it('lists their escalated concerns in the register, without the officers’ tools', async () => {
    await openRegister(named, [concern()]);
    expect(screen.getByText(/^Concerns escalated to you by name/)).toBeTruthy();
    expect(screen.getByText('Shouted at the under 12s')).toBeTruthy();
    expect(screen.queryByText('Export the register as a PDF')).toBeNull();
    expect(screen.queryByText('Message access')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// On a tablet: a concern opens beside the register

describe('the register on a tablet', () => {
  onATablet();

  let push: jest.SpyInstance;
  beforeEach(() => {
    push = jest.spyOn(router, 'push').mockImplementation(() => {});
  });
  afterEach(() => push.mockRestore());

  const named: Persona = { ...personas.coach, rpcs: { has_escalated_concerns: true } };
  const OLD = concern({ id: 'con-2', body: 'Old matter', status: 'closed', involves_child: 'no' });

  async function open(who: Who, tables: BackendOptions = {}) {
    await openScreen(who, { 'concerns/index': ConcernsScreen }, '/concerns', {}, {
      ...tables,
      rpcs: {
        concern_register: [concern(), OLD],
        concern_history: [],
        concern_about_people: [{ id: 'p1', name: 'Sample Parent' }],
        safeguarding_contacts: [CONTACTS],
        ...tables.rpcs,
      },
    });
  }
  const beside = () => within(screen.getByTestId('detail-pane'));
  const list = () => within(screen.getByTestId('list-pane'));
  const called = (name: string) => rpcCalls().filter(([n]) => n === name);

  it.each<[string, Who]>([
    ['Child Safety Officer', officer],
    ['admin', 'admin'],
    ['someone a concern reached by name', named],
  ])('opens nothing for the %s, and records no look, until a concern is tapped', async (_l, who) => {
    await open(who);
    expect(beside().getByText('Choose a concern to open it here.')).toBeTruthy();
    expect(list().getByText('Shouted at the under 12s')).toBeTruthy();
    expect(called('note_escalated_concern_view')).toHaveLength(0);
    expect(called('concern_history')).toHaveLength(0);
  });

  it('opens the tapped concern beside the register, which stays', async () => {
    await open(officer);
    await fireEvent.press(list().getByText('Shouted at the under 12s'));
    await settle();
    expect(push).not.toHaveBeenCalled();
    expect(beside().getByText('Raised by: Sample Guardian')).toBeTruthy();
    expect(beside().getByText('Add note')).toBeTruthy();
    expect(list().getByText('Old matter')).toBeTruthy();
    expect(called('concern_history')).toEqual([['concern_history', { p_concern_id: 'con-1' }]]);
    expect(called('note_escalated_concern_view')).toEqual([
      ['note_escalated_concern_view', { p_concern_id: 'con-1' }],
    ]);
  });

  it('marks which concern is open, and opens another in its place', async () => {
    await open(officer);
    await fireEvent.press(list().getByText('Shouted at the under 12s'));
    await settle();
    const selected = () =>
      list()
        .getAllByRole('button')
        .filter((b) => b.props.accessibilityState?.selected)
        .map((b) => within(b).queryByText('Old matter') !== null);
    expect(selected()).toEqual([false]);
    await fireEvent.press(list().getByText('Old matter'));
    await settle();
    expect(selected()).toEqual([true]);
    expect(called('concern_history').at(-1)).toEqual(['concern_history', { p_concern_id: 'con-2' }]);
    expect(beside().queryByText('Add note')).toBeTruthy();
  });

  it('reloads the register when a step is recorded, and keeps the concern open', async () => {
    await open(officer);
    await fireEvent.press(list().getByText('Shouted at the under 12s'));
    await settle();
    const before = called('concern_register').length;
    await fireEvent.press(beside().getByText('Referred to Police'));
    await settle();
    expect(called('add_concern_event')).toHaveLength(1);
    // Once for the concern, once for the register beside it.
    expect(called('concern_register').length).toBe(before + 2);
    expect(beside().getByText('Raised by: Sample Guardian')).toBeTruthy();
  });

  it('closes the concern from the cross, and reloads the register', async () => {
    await open(officer);
    await fireEvent.press(list().getByText('Shouted at the under 12s'));
    await settle();
    const before = called('concern_register').length;
    await fireEvent.press(screen.getByLabelText(/^Close /));
    await settle();
    expect(beside().getByText('Choose a concern to open it here.')).toBeTruthy();
    expect(called('concern_register').length).toBe(before + 1);
  });

  it('shows someone it reached by name the concern without the officers’ tools, as its own screen does', async () => {
    await open(named);
    await fireEvent.press(list().getByText('Shouted at the under 12s'));
    await settle();
    expect(beside().getByText('Add note')).toBeTruthy();
    expect(beside().queryByText('Who it’s about')).toBeNull();
    expect(beside().queryByText('Ask to read messages')).toBeNull();
    expect(list().queryByText('Export the register as a PDF')).toBeNull();
  });

  it.each<[string, Who]>([
    ['athlete', 'athlete'],
    ['guardian', 'guardian'],
    ['coach', 'coach'],
    ['committee member', 'committee'],
    ['stood-down admin', 'stoodDownAdmin'],
  ])('gives a %s, who the database returns nothing to, nothing to open', async (_l, who) => {
    await open(who, { rpcs: { concern_register: [] } });
    expect(list().getByText('No open concerns.')).toBeTruthy();
    expect(beside().getByText('Choose a concern to open it here.')).toBeTruthy();
    expect(called('concern_history')).toHaveLength(0);
  });
});

describe('the register on a phone', () => {
  it('opens a concern on its own screen', async () => {
    const push = jest.spyOn(router, 'push').mockImplementation(() => {});
    try {
      await openRegister(officer, [concern()]);
      expect(screen.queryByTestId('list-detail')).toBeNull();
      await fireEvent.press(screen.getByText('Shouted at the under 12s'));
      expect(push).toHaveBeenCalledWith({ pathname: '/concerns/[id]', params: { id: 'con-1' } });
    } finally {
      push.mockRestore();
    }
  });
});
