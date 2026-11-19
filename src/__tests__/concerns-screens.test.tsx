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
import { fireEvent, screen } from 'expo-router/testing-library';

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
  openScreen,
  personas,
  resetClub,
  setClubFeatures,
  settle,
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
      screen.getByText(/The club’s Child Safety Officer, Complaints Manager and admins see it, but not the person it’s about\./),
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
    await fireEvent.changeText(screen.getByPlaceholderText('A name, or a description'), 'sample p');
    expect(screen.getByText('Sample Parent')).toBeTruthy();
    expect(screen.getByText('Sample Person')).toBeTruthy();
  });

  it('offers members from the first letter typed', async () => {
    await openRaise('athlete');
    await fireEvent.changeText(screen.getByPlaceholderText('A name, or a description'), 'P');
    expect(screen.getByText('Sample Parent')).toBeTruthy();
    expect(screen.getByText('Sample Person')).toBeTruthy();
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

async function openConcern(who: Who, shown: Concern | null, history: ConcernEvent[] = []) {
  await openScreen(who, { 'concerns/[id]': ConcernScreen }, `/concerns/${shown?.id ?? 'con-1'}`, {}, {
    rpcs: {
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
      expect(screen.getByText('Avery Athlete')).toBeTruthy();
      expect(screen.queryByText('Sample Parent')).toBeNull();
    });

    it('names the member picked', async () => {
      await openConcern('admin', concern());
      await fireEvent.changeText(screen.getByPlaceholderText('Name'), 'Avery');
      await fireEvent.press(screen.getByText('Avery Athlete'));
      await settle();
      expect(rpcCalls().find(([n]) => n === 'set_concern_about')?.[1]).toMatchObject({ p_member_id: 'p3' });
    });

    it('says when nobody matches, instead of showing nothing', async () => {
      await openConcern('admin', concern());
      await fireEvent.changeText(screen.getByPlaceholderText('Name'), 'zz');
      expect(screen.getByText('No approved member’s name matches “zz”.')).toBeTruthy();
    });
  });

  it('offers no way to clear who it’s about while nobody is named', async () => {
    await openConcern(officer, concern());
    expect(screen.queryByText('Clear who it’s about')).toBeNull();
  });

  it('offers to clear who it’s about once someone is named', async () => {
    await openConcern(officer, concern({ about_member_id: 'p1', about_member_name: 'Sample Parent' }));
    expect(screen.getByText('Clear who it’s about')).toBeTruthy();
    expect(screen.getByText('About: Sample Parent')).toBeTruthy();
    expect(screen.getByText('In their words: A parent at training')).toBeTruthy();
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
