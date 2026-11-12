/**
 * The session plans list (src/app/session-plans/index.tsx) and adding,
 * changing or reusing a plan (src/app/session-plans/edit.tsx).
 *
 * Coaches add plans for the squads and teams they coach, and admins for any
 * (`usePlanGroups`, and `save_session_plan` in the database). A plan is shared
 * with the group's other coaches to start with; athletes (and so the parents
 * of under-18s) and coaches of other groups only when ticked. Files are
 * photos, PDFs or Word documents, up to 5 of 10 MB each. Use again copies a
 * plan and its files for a new session in a group the member coaches (user
 * guide section 6, "Session plans").
 */
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { fireEvent, screen } from 'expo-router/testing-library';
import { Text } from 'react-native';

import EditSessionPlanScreen from '@/app/session-plans/edit';
import SessionPlansScreen from '@/app/session-plans/index';
import type { CalendarEvent } from '@/lib/calendar';
import { formatDateString } from '@/lib/injuries';
import type { SessionPlan, SessionPlanFile, SessionPlanRow } from '@/lib/session-plans';
import { supabase } from '@/lib/supabase';

import { clearCalls, onlyRpcCall, pushTo, rpcCalls, rpcNames } from './helpers/calls';
import {
  morePersonas,
  openScreen,
  personas,
  resetClub,
  setClubFeatures,
  settle,
  TEAM,
  TEAM_B,
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
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  requestCameraPermissionsAsync: jest.fn(),
}));
jest.mock('expo-file-system', () => ({
  File: class {
    async arrayBuffer() {
      return new ArrayBuffer(8);
    }
  },
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
// The calendar's sessions, without fetching ICS files.
const mockCalendar: { events: CalendarEvent[] } = { events: [] };
const mockShowPast = jest.fn();
jest.mock('@/lib/use-events', () => ({
  useEvents: () => ({ events: mockCalendar.events, showPast: mockShowPast }),
}));

type Who = PersonaName | Persona;

// Each test fills in forms screen by screen; on a busy CI runner that can take
// longer than Jest's 5 second default.
jest.setTimeout(20000);

const storage = {
  upload: jest.fn(),
  remove: jest.fn(),
  download: jest.fn(),
};

beforeEach(() => {
  resetClub();
  clearCalls();
  mockCalendar.events = [];
  storage.upload.mockReset().mockResolvedValue({ data: {}, error: null });
  storage.remove.mockReset().mockResolvedValue({ data: [], error: null });
  storage.download.mockReset().mockResolvedValue({
    data: { arrayBuffer: async () => new ArrayBuffer(4) },
    error: null,
  });
  (DocumentPicker.getDocumentAsync as jest.Mock).mockReset();
  (ImagePicker.launchImageLibraryAsync as jest.Mock).mockReset();
  (ImagePicker.launchCameraAsync as jest.Mock).mockReset();
  (ImagePicker.requestCameraPermissionsAsync as jest.Mock).mockReset();
});

/** Storage for plan files, once the screen has loaded. */
function fakeStorage() {
  (supabase.storage.from as jest.Mock).mockImplementation(() => storage);
}

const placeholder = (route: string) =>
  function Shown() {
    return <Text>{`screen:${route}`}</Text>;
  };

const press = async (text: string | RegExp, index = 0) => {
  await fireEvent.press(screen.getAllByText(text)[index]);
  await settle(6);
};

const type = async (placeholderText: string, value: string) => {
  await fireEvent.changeText(screen.getByPlaceholderText(placeholderText), value);
  await settle(2);
};

// ---------------------------------------------------------------------------
// The list

function row(extra: Partial<SessionPlanRow> = {}): SessionPlanRow {
  return {
    id: 'plan-1',
    team_id: TEAM.id,
    team_name: TEAM.name,
    title: 'Tuesday skills',
    session_on: '2026-10-13',
    starts_at: '18:00:00',
    ends_at: '19:30:00',
    author_name: 'Sample coach',
    author_position: 'Head coach',
    file_count: 0,
    ...extra,
  };
}

async function openList(
  who: Who,
  { canAdd = false, newShared = 0, own = [] as SessionPlanRow[], shared = [] as SessionPlanRow[] } = {},
) {
  const ownRows = own.map(({ file_count, ...r }) => ({ ...r, session_plan_files: [{ count: file_count }] }));
  await openScreen(
    who,
    { 'session-plans/index': SessionPlansScreen, 'session-plans/[id]': placeholder('session-plans/[id]'), 'session-plans/edit': placeholder('session-plans/edit') },
    '/session-plans',
    {},
    {
      rpcs: {
        session_plan_summary: [{ can_add: canAdd, shared: shared.length, new_shared: newShared }],
        shared_session_plans: shared,
      },
      // Only the member's own plans come back for their own list.
      tableHandlers: {
        session_plans: (q) => {
          const me = (typeof who === 'string' ? personas[who] : who).profile!.id;
          return q.eq('author_id') === me ? ownRows : [];
        },
      },
    },
  );
}

describe('the session plans list', () => {
  it('starts a coach on their own plans, with how many files each has', async () => {
    await openList('coach', {
      canAdd: true,
      own: [row(), row({ id: 'plan-2', title: 'Thursday match prep', file_count: 2, starts_at: null, ends_at: null })],
    });
    expect(screen.getByText('Add a session plan')).toBeTruthy();
    expect(screen.getByText('My plans')).toBeTruthy();
    expect(screen.getByText('Tuesday skills')).toBeTruthy();
    expect(screen.getByText(`${formatDateString('2026-10-13')} · 6:00 pm – 7:30 pm · ${TEAM.name}`)).toBeTruthy();
    expect(screen.getByText(`${formatDateString('2026-10-13')} · ${TEAM.name}`)).toBeTruthy();
    expect(screen.getByText('2 files')).toBeTruthy();
    // Their own plans don't name them.
    expect(screen.queryByText('Sample coach, head coach')).toBeNull();
  });

  it('shows the plans shared with them, who wrote each, and which are new', async () => {
    await openList('coach', {
      canAdd: true,
      newShared: 1,
      shared: [
        row({ id: 'plan-9', title: 'Shooting circuit', author_name: 'Other Coach', author_position: 'Assistant coach', file_count: 1, is_new: true }),
      ],
    });
    await press('Shared with me (1 new)');
    expect(screen.getByText('Shooting circuit')).toBeTruthy();
    expect(screen.getByText('Other Coach, assistant coach · 1 file')).toBeTruthy();
    expect(screen.getByText('New')).toBeTruthy();
  });

  it.each<[string, Who]>([
    ['athlete', 'athlete'],
    ['under-18 athlete', morePersonas.under18Athlete],
    ['guardian', 'guardian'],
  ])('gives a %s only the plans shared with them, with no way to add one', async (_l, who) => {
    await openList(who, { shared: [row({ title: 'Shared drills' })] });
    expect(screen.queryByText('Add a session plan')).toBeNull();
    expect(screen.queryByText('My plans')).toBeNull();
    expect(screen.getByText('Shared drills')).toBeTruthy();
    expect(screen.getByText('Sample coach, head coach')).toBeTruthy();
  });

  it('keeps a coach whose check lapsed reading their plans, with no way to add one', async () => {
    await openList('coachExpiredCheck', { canAdd: false, own: [row()] });
    expect(screen.queryByText('Add a session plan')).toBeNull();
    expect(screen.getByText('My plans')).toBeTruthy();
    expect(screen.getByText('Tuesday skills')).toBeTruthy();
  });

  it('asks for the member’s own plans by their id', async () => {
    await openList('coach', { canAdd: true });
    const own = (supabase.from as jest.Mock).mock.calls.filter(([t]) => t === 'session_plans');
    expect(own).toHaveLength(1);
    expect(rpcNames()).toContain('shared_session_plans');
  });

  it('says what an empty list of their own is for', async () => {
    await openList('coach', { canAdd: true });
    expect(
      screen.getByText('You haven’t added any session plans yet. Add one before or after a session.'),
    ).toBeTruthy();
  });

  it('says when nothing has been shared with them', async () => {
    await openList('athlete');
    expect(screen.getByText('No session plans have been shared with you yet.')).toBeTruthy();
  });

  it('opens a plan when tapped', async () => {
    await openList('coach', { canAdd: true, own: [row()] });
    await press('Tuesday skills');
    expect(screen.getByText('screen:session-plans/[id]')).toBeTruthy();
    expect(screen).toHavePathname('/session-plans/plan-1');
  });

  it('opens the form from Add a session plan', async () => {
    await openList('coach', { canAdd: true });
    await press('Add a session plan');
    expect(screen.getByText('screen:session-plans/edit')).toBeTruthy();
  });

  it('offers nobody Add a session plan while the club has Session plans off', async () => {
    setClubFeatures({ sessionPlans: false });
    await openList('coach', { canAdd: true });
    expect(screen.queryByText('Add a session plan')).toBeNull();
    expect(rpcNames()).not.toContain('session_plan_summary');
  });
});

// ---------------------------------------------------------------------------
// Adding, changing and reusing a plan

function plan(extra: Partial<SessionPlan> = {}): SessionPlan {
  return {
    id: 'plan-1',
    team_id: TEAM.id,
    team_name: TEAM.name,
    title: 'Tuesday skills',
    session_on: '2026-10-13',
    starts_at: '18:00:00',
    ends_at: '19:30:00',
    location: 'Main courts',
    notes: 'Warm up, then passing drills',
    run_by: null,
    share_team_coaches: false,
    share_athletes: true,
    author_id: 'coach',
    author_name: 'Sample coach',
    author_position: 'Head coach',
    copied_from: null,
    created_at: '2026-10-12T09:00:00Z',
    edited_at: null,
    edited_by_name: null,
    ...extra,
  };
}

const FILE: SessionPlanFile = {
  id: 'f1',
  plan_id: 'plan-1',
  path: 'plan-1/abc/drills.pdf',
  name: 'Drills.pdf',
  content_type: 'application/pdf',
  size_bytes: 1000,
  added_by_name: 'Sample coach',
  created_at: '2026-10-12T09:00:00Z',
};

const COACHES = [
  { profile_id: 'coach-2', full_name: 'Other Coach', groups: TEAM_B.name, team_ids: [TEAM_B.id] },
  // Coaches the chosen group, so the first tick box covers them.
  { profile_id: 'coach-3', full_name: 'Team Mate Coach', groups: TEAM.name, team_ids: [TEAM.id] },
];

async function openForm(
  who: Who,
  url = '/session-plans/edit',
  {
    source = null as SessionPlan | null,
    files = [] as SessionPlanFile[],
    shares = [] as { profile_id: string }[],
    saveError,
    recordError,
  }: { source?: SessionPlan | null; files?: SessionPlanFile[]; shares?: { profile_id: string }[]; saveError?: string; recordError?: string } = {},
) {
  // Changing a plan starts from the plan, so saving can go back to it.
  const changing = url.includes('?id=');
  await openScreen(
    who,
    { 'session-plans/edit': EditSessionPlanScreen, 'session-plans/[id]': placeholder('session-plans/[id]') },
    changing ? '/session-plans/plan-1' : url,
    {
      teams: [TEAM, TEAM_B],
      session_plans: source ? [source] : [],
      session_plan_files: files,
      session_plan_shares: shares,
    },
    {
      rpcs: { session_plan_coaches: COACHES },
      rpcHandlers: { save_session_plan: (args) => (args.p_id as string | null) ?? 'plan-new' },
      rpcErrors: {
        ...(saveError ? { save_session_plan: saveError } : {}),
        ...(recordError ? { add_session_plan_file: recordError } : {}),
      },
    },
  );
  if (changing) await pushTo(url);
  fakeStorage();
}

async function fillMinimum() {
  await type('For example, Tuesday training', 'Tuesday training');
  await type('Warm up, drills, focus areas, anything you want to record', 'Passing drills');
}

const saved = () => onlyRpcCall('save_session_plan');

describe('adding a session plan', () => {
  it('saves a coach’s plan for the group they coach, shared with its other coaches', async () => {
    await openForm('coach');
    await fillMinimum();
    await type('6:00 pm', '6pm');
    await type('7:30 pm', '7.30 pm');
    await type('For example, Main court', 'Court 2');
    await press('Save session plan');
    expect(saved()).toEqual({
      p_id: null,
      p_team_id: TEAM.id,
      p_title: 'Tuesday training',
      p_session_on: '2026-10-18',
      p_starts_at: '18:00',
      p_ends_at: '19:30',
      p_location: 'Court 2',
      p_notes: 'Passing drills',
      p_run_by: '',
      p_share_team_coaches: true,
      p_share_athletes: false,
      p_coach_ids: [],
      p_copied_from: null,
    });
    expect(screen.getByText('screen:session-plans/[id]')).toBeTruthy();
    expect(screen).toHavePathname('/session-plans/plan-new');
  });

  it('offers a coach only the groups they coach', async () => {
    await openForm('coach');
    expect(screen.getByText(TEAM.name)).toBeTruthy();
    expect(screen.queryByText(TEAM_B.name)).toBeNull();
  });

  it('offers an admin every current group', async () => {
    await openForm('admin');
    expect(screen.getByText(TEAM.name)).toBeTruthy();
    expect(screen.getByText(TEAM_B.name)).toBeTruthy();
  });

  it.each<[string, Who]>([
    ['athlete', 'athlete'],
    ['guardian', 'guardian'],
    ['manager', 'manager'],
    ['committee member', 'committee'],
    ['coach whose check lapsed', 'coachExpiredCheck'],
    ['stood-down coach', 'stoodDownCoach'],
  ])('tells a %s that plans are for the coaches of a group', async (_l, who) => {
    await openForm(who);
    expect(screen.getByText(/^Session plans are added by the coaches of a squad or team, and by admins\./)).toBeTruthy();
    expect(screen.queryByText('Save session plan')).toBeNull();
  });

  it('lets an athlete who coaches another team add plans only for the team they coach', async () => {
    await openForm(personas.athleteCoach);
    expect(screen.getByText(TEAM_B.name)).toBeTruthy();
    expect(screen.queryByText(TEAM.name)).toBeNull();
    await fillMinimum();
    await press('Save session plan');
    expect(saved()).toMatchObject({ p_team_id: TEAM_B.id });
  });

  it('asks an admin to choose the group first', async () => {
    await openForm('admin');
    await fillMinimum();
    await press('Save session plan');
    expect(screen.getByText('Choose the squad or team the session is for.')).toBeTruthy();
    expect(rpcCalls('save_session_plan')).toEqual([]);
    await press(TEAM_B.name);
    await press('Save session plan');
    expect(saved()).toMatchObject({ p_team_id: TEAM_B.id });
  });

  it.each([
    ['a name', async () => type('Warm up, drills, focus areas, anything you want to record', 'Drills'), 'Name the session, for example Tuesday training.'],
    [
      'a plan or a file',
      async () => type('For example, Tuesday training', 'Tuesday'),
      'Write the plan, or attach a photo or file of it.',
    ],
    [
      'times it can read',
      async () => {
        await fillMinimum();
        await type('6:00 pm', '25:00');
      },
      'Write times like 6:00 pm or 18:00.',
    ],
    [
      'a finish time it can read',
      async () => {
        await fillMinimum();
        await type('7:30 pm', 'soon');
      },
      'Write times like 6:00 pm or 18:00.',
    ],
  ])('asks for %s before saving', async (_l, fill, message) => {
    await openForm('coach');
    await fill();
    await press('Save session plan');
    expect(screen.getByText(message)).toBeTruthy();
    expect(rpcCalls('save_session_plan')).toEqual([]);
  });

  it('leaves the times out when none are given', async () => {
    await openForm('coach');
    await fillMinimum();
    await press('Save session plan');
    expect(saved()).toMatchObject({ p_starts_at: null, p_ends_at: null });
  });

  it('shares it with the group’s athletes and coaches of other groups only when ticked', async () => {
    await openForm('coach');
    await fillMinimum();
    expect(screen.getByText('Parents and guardians of athletes under 18 see it too.')).toBeTruthy();
    await press('The other coaches of this squad or team');
    await press('Its athletes');
    // The group's own coaches are covered by the first tick box, so aren't listed.
    expect(screen.queryByText(/^Team Mate Coach/)).toBeNull();
    await press(`Other Coach (${TEAM_B.name})`);
    await press('Save session plan');
    expect(saved()).toMatchObject({
      p_share_team_coaches: false,
      p_share_athletes: true,
      p_coach_ids: ['coach-2'],
    });
  });

  it('takes a coach off the list when tapped again', async () => {
    await openForm('coach');
    await fillMinimum();
    await press(`Other Coach (${TEAM_B.name})`);
    await press(`Other Coach (${TEAM_B.name})`);
    await press('Save session plan');
    expect(saved()).toMatchObject({ p_coach_ids: [] });
  });

  it('never shares by name with a coach of the group it ends up in', async () => {
    await openForm('admin');
    await fillMinimum();
    await press(TEAM.name);
    await press(`Other Coach (${TEAM_B.name})`);
    // Moving the plan to Other Coach's own group drops the named share.
    await press(TEAM_B.name);
    expect(screen.queryByText(`Other Coach (${TEAM_B.name})`)).toBeNull();
    await press('Save session plan');
    expect(saved()).toMatchObject({ p_team_id: TEAM_B.id, p_coach_ids: [] });
  });

  it('gives a coach no Run by field', async () => {
    await openForm('coach');
    expect(screen.queryByText('Run by (optional)')).toBeNull();
  });

  it('lets an admin say who ran the session', async () => {
    await openForm('admin');
    await press(TEAM.name);
    await fillMinimum();
    await type('For example, the S&C partner', 'S&C partner');
    await press('Save session plan');
    expect(saved()).toMatchObject({ p_run_by: 'S&C partner' });
  });

  it('notes when the plan is for a session ahead', async () => {
    await openForm('coach');
    expect(screen.queryByText(/^Planning ahead for/)).toBeNull();
    await press('Tomorrow');
    expect(
      screen.getByText(
        `Planning ahead for ${formatDateString('2026-10-19')}. You can change the plan after the session.`,
      ),
    ).toBeTruthy();
    await fillMinimum();
    await press('Save session plan');
    expect(saved()).toMatchObject({ p_session_on: '2026-10-19' });
  });

  it('shows the database’s refusal and stays on the form', async () => {
    await openForm('coach', '/session-plans/edit', { saveError: 'You can’t add plans for that team' });
    await fillMinimum();
    await press('Save session plan');
    expect(screen.getByText('You can’t add plans for that team')).toBeTruthy();
    expect(screen.queryByText('screen:session-plans/[id]')).toBeNull();
  });

  it('fills the name, day, times and place from a calendar session of the group', async () => {
    mockCalendar.events = [
      {
        id: 'e1',
        title: 'Open A training',
        start: new Date('2026-10-20T07:00:00Z'),
        end: new Date('2026-10-20T08:30:00Z'),
        allDay: false,
        location: 'Stadium court 1',
        description: null,
        calendarId: 'cal-a',
        calendarName: TEAM.name,
        clubWide: false,
        color: '#000000',
      },
      {
        id: 'e2',
        title: 'Other team training',
        start: new Date('2026-10-19T07:00:00Z'),
        end: new Date('2026-10-19T08:00:00Z'),
        allDay: false,
        location: null,
        description: null,
        calendarId: 'cal-b',
        calendarName: TEAM_B.name,
        clubWide: false,
        color: '#000000',
      },
      {
        id: 'e3',
        title: 'Too far away',
        start: new Date('2026-12-20T07:00:00Z'),
        end: new Date('2026-12-20T08:00:00Z'),
        allDay: false,
        location: null,
        description: null,
        calendarId: 'cal-a',
        calendarName: TEAM.name,
        clubWide: false,
        color: '#000000',
      },
      {
        id: 'e4',
        title: 'Club presentation night',
        start: new Date('2026-10-17T00:00:00Z'),
        end: new Date('2026-10-17T00:00:00Z'),
        allDay: true,
        location: 'Clubrooms',
        description: null,
        calendarId: 'cal-club',
        calendarName: 'Club',
        clubWide: true,
        color: '#000000',
      },
    ];
    await openForm('coach');
    expect(mockShowPast).toHaveBeenCalled();
    expect(screen.getByText('Fill in from the calendar')).toBeTruthy();
    expect(screen.queryByText('Other team training')).toBeNull();
    expect(screen.queryByText('Too far away')).toBeNull();
    await press('Open A training');
    await type('Warm up, drills, focus areas, anything you want to record', 'Drills');
    await press('Save session plan');
    expect(saved()).toMatchObject({
      p_title: 'Open A training',
      p_session_on: '2026-10-20',
      p_starts_at: '07:00',
      p_ends_at: '08:30',
      p_location: 'Stadium court 1',
    });
  });

  it('leaves the times out for an all-day calendar event', async () => {
    mockCalendar.events = [
      {
        id: 'e4',
        title: 'Club presentation night',
        start: new Date('2026-10-17T00:00:00Z'),
        end: new Date('2026-10-17T00:00:00Z'),
        allDay: true,
        location: 'Clubrooms',
        description: null,
        calendarId: 'cal-club',
        calendarName: 'Club',
        clubWide: true,
        color: '#000000',
      },
    ];
    await openForm('coach');
    await type('6:00 pm', '6pm');
    await press('Club presentation night');
    await type('Warm up, drills, focus areas, anything you want to record', 'Notes');
    await press('Save session plan');
    expect(saved()).toMatchObject({
      p_title: 'Club presentation night',
      p_session_on: '2026-10-17',
      p_starts_at: null,
      p_ends_at: null,
      p_location: 'Clubrooms',
    });
  });
});

describe('photos and files on a plan', () => {
  const pdf = { uri: 'file:///drills.pdf', name: 'drills.pdf', mimeType: 'application/pdf', size: 2000 };

  function pickDocuments(...assets: object[]) {
    (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValue({ canceled: false, assets });
  }

  it('offers only photos, PDFs and Word documents', async () => {
    await openForm('coach');
    pickDocuments(pdf);
    await press('Attach a PDF or Word document');
    expect(DocumentPicker.getDocumentAsync).toHaveBeenCalledWith({
      type: [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'image/jpeg',
        'image/png',
        'image/heic',
        'image/heif',
      ],
      multiple: true,
      copyToCacheDirectory: true,
    });
    expect(screen.getByText('📎 drills.pdf')).toBeTruthy();
  });

  it('saves a plan with only a file, uploading it into the plan’s folder', async () => {
    await openForm('coach');
    await type('For example, Tuesday training', 'Whiteboard');
    pickDocuments(pdf);
    await press('Attach a PDF or Word document');
    await press('Save session plan');
    expect(saved()).toMatchObject({ p_notes: '' });
    expect(storage.upload).toHaveBeenCalledWith('plan-new/uuid-1/drills.pdf', expect.any(ArrayBuffer), {
      contentType: 'application/pdf',
      upsert: false,
    });
    expect(onlyRpcCall('add_session_plan_file')).toEqual({
      p_plan_id: 'plan-new',
      p_path: 'plan-new/uuid-1/drills.pdf',
      p_name: 'drills.pdf',
      p_content_type: 'application/pdf',
    });
    expect(screen.getByText('screen:session-plans/[id]')).toBeTruthy();
  });

  it.each([
    [{ uri: 'file:///a.exe', name: 'setup.exe', mimeType: 'application/x-msdownload', size: 10 }, 'setup.exe can’t be attached. Attach a photo, a PDF or a Word document.'],
    [{ uri: 'file:///big.pdf', name: 'big.pdf', mimeType: 'application/pdf', size: 11 * 1024 * 1024 }, 'big.pdf is over 10 MB. Try a smaller photo or file.'],
  ])('refuses a file it can’t keep: %#', async (asset, message) => {
    await openForm('coach');
    pickDocuments(asset);
    await press('Attach a PDF or Word document');
    expect(screen.getByText(message)).toBeTruthy();
    expect(screen.queryByText(`📎 ${asset.name}`)).toBeNull();
  });

  it('keeps 5 files at most', async () => {
    await openForm('coach');
    pickDocuments(...[1, 2, 3, 4, 5, 6].map((n) => ({ ...pdf, uri: `file:///${n}.pdf`, name: `${n}.pdf` })));
    await press('Attach a PDF or Word document');
    expect(screen.getAllByText(/^📎 \d\.pdf$/)).toHaveLength(5);
    expect(screen.queryByText('📎 6.pdf')).toBeNull();
    expect(screen.getByText('A plan can have up to 5 photos and files.')).toBeTruthy();
    expect(screen.queryByText('Attach a PDF or Word document')).toBeNull();
    expect(screen.queryByText('Choose photos')).toBeNull();
  });

  it('leaves out a file before saving when asked', async () => {
    await openForm('coach');
    await fillMinimum();
    pickDocuments(pdf);
    await press('Attach a PDF or Word document');
    await press('Leave out');
    expect(screen.queryByText('📎 drills.pdf')).toBeNull();
    await press('Save session plan');
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('adds photos from the phone, compressed', async () => {
    await openForm('coach');
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///board.jpg', fileName: 'board.jpg', mimeType: 'image/jpeg', fileSize: 5000 }],
    });
    await press('Choose photos');
    expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: 5,
      quality: 0.7,
    });
    expect(screen.getByText('📎 board.jpg')).toBeTruthy();
  });

  it('asks for the camera to be allowed before taking a photo', async () => {
    await openForm('coach');
    (ImagePicker.requestCameraPermissionsAsync as jest.Mock).mockResolvedValue({ granted: false });
    await press('Take a photo');
    expect(screen.getByText('Allow the camera in your phone’s settings to take a photo.')).toBeTruthy();
    expect(ImagePicker.launchCameraAsync).not.toHaveBeenCalled();
  });

  it('adds a photo taken with the camera', async () => {
    await openForm('coach');
    (ImagePicker.requestCameraPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
    (ImagePicker.launchCameraAsync as jest.Mock).mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///cam.png', fileName: null, mimeType: 'image/png', fileSize: 3000 }],
    });
    await press('Take a photo');
    expect(screen.getByText(/^📎 photo-\d+\.png$/)).toBeTruthy();
  });

  it('keeps the plan when a file fails to upload, and sends only the rest on retry', async () => {
    await openForm('coach');
    await fillMinimum();
    pickDocuments(pdf);
    await press('Attach a PDF or Word document');
    storage.upload.mockResolvedValueOnce({ data: null, error: { message: 'Storage is full' } });
    await press('Save session plan');
    expect(
      screen.getByText('drills.pdf didn’t upload: Storage is full The plan is saved; tap Save again to send the rest.'),
    ).toBeTruthy();
    expect(screen.queryByText('screen:session-plans/[id]')).toBeNull();
    await press('Save session plan');
    // The second save changes the plan already saved, not a new one.
    expect(rpcCalls('save_session_plan').map((a) => a.p_id)).toEqual([null, 'plan-new']);
    expect(storage.upload).toHaveBeenCalledTimes(2);
    expect(screen.getByText('screen:session-plans/[id]')).toBeTruthy();
  });

  it('removes an uploaded file nobody can see when it can’t be recorded', async () => {
    await openForm('coach', '/session-plans/edit', { recordError: 'Plan is full' });
    await fillMinimum();
    pickDocuments(pdf);
    await press('Attach a PDF or Word document');
    await press('Save session plan');
    expect(storage.remove).toHaveBeenCalledWith(['plan-new/uuid-1/drills.pdf']);
    expect(screen.getByText('Plan is full The plan is saved; tap Save again to send the rest.')).toBeTruthy();
  });
});

describe('changing a plan', () => {
  it('fills the form from the plan, with its named shares, and saves the same plan', async () => {
    await openForm('coach', '/session-plans/edit?id=plan-1', {
      source: plan(),
      files: [FILE],
      shares: [{ profile_id: 'coach-2' }],
    });
    expect(screen.getByDisplayValue('Tuesday skills')).toBeTruthy();
    expect(screen.getByDisplayValue('18:00')).toBeTruthy();
    expect(screen.getByDisplayValue('19:30')).toBeTruthy();
    expect(screen.getByDisplayValue('Main courts')).toBeTruthy();
    expect(screen.getByDisplayValue('Warm up, then passing drills')).toBeTruthy();
    expect(screen.getByText('📎 Drills.pdf')).toBeTruthy();
    expect(screen.getByText(formatDateString('2026-10-13'))).toBeTruthy();
    await press('Save changes');
    expect(saved()).toEqual({
      p_id: 'plan-1',
      p_team_id: TEAM.id,
      p_title: 'Tuesday skills',
      p_session_on: '2026-10-13',
      p_starts_at: '18:00',
      p_ends_at: '19:30',
      p_location: 'Main courts',
      p_notes: 'Warm up, then passing drills',
      p_run_by: '',
      p_share_team_coaches: false,
      p_share_athletes: true,
      p_coach_ids: ['coach-2'],
      p_copied_from: null,
    });
    // Its existing file isn't sent again.
    expect(storage.upload).not.toHaveBeenCalled();
    // Back to the plan.
    expect(screen).toHavePathname('/session-plans/plan-1');
  });

  it('shows Run by to a coach when the plan already has one', async () => {
    await openForm('coach', '/session-plans/edit?id=plan-1', { source: plan({ run_by: 'S&C partner' }) });
    expect(screen.getByDisplayValue('S&C partner')).toBeTruthy();
  });

  it('removes one of its files from storage and then its record', async () => {
    await openForm('coach', '/session-plans/edit?id=plan-1', { source: plan(), files: [FILE] });
    await press('Remove');
    expect(storage.remove).toHaveBeenCalledWith(['plan-1/abc/drills.pdf']);
    expect(onlyRpcCall('remove_session_plan_file')).toEqual({ p_file_id: 'f1' });
    expect(screen.queryByText('📎 Drills.pdf')).toBeNull();
  });

  it('keeps the file and says so when it can’t be removed', async () => {
    await openForm('coach', '/session-plans/edit?id=plan-1', { source: plan(), files: [FILE] });
    storage.remove.mockResolvedValueOnce({ data: null, error: { message: 'nope' } });
    await press('Remove');
    expect(screen.getByText('Drills.pdf wasn’t removed. Try again.')).toBeTruthy();
    expect(rpcCalls('remove_session_plan_file')).toEqual([]);
    expect(screen.getByText('📎 Drills.pdf')).toBeTruthy();
  });

  it('keeps an admin’s change in the plan’s own group', async () => {
    await openForm('admin', '/session-plans/edit?id=plan-1', { source: plan({ team_id: TEAM_B.id }) });
    await press('Save changes');
    expect(saved()).toMatchObject({ p_id: 'plan-1', p_team_id: TEAM_B.id });
  });

  it('keeps a plan in a group its author no longer coaches', async () => {
    await openForm('coach', '/session-plans/edit?id=plan-1', { source: plan({ team_id: TEAM_B.id }) });
    expect(screen.getByText(TEAM_B.name)).toBeTruthy();
    await press('Save changes');
    expect(saved()).toMatchObject({ p_team_id: TEAM_B.id });
  });

  it('says when the plan can’t be found', async () => {
    await openForm('coach', '/session-plans/edit?id=gone', { source: null });
    expect(screen.getByText('That plan couldn’t be found.')).toBeTruthy();
  });
});

describe('using a plan again', () => {
  it('copies it for today, with its files, as a new plan', async () => {
    await openForm('coach', '/session-plans/edit?copy=plan-1', { source: plan(), files: [FILE] });
    expect(screen.getByText('📎 Drills.pdf')).toBeTruthy();
    expect(screen.getByText('Leave out')).toBeTruthy();
    expect(screen.queryByText('Remove')).toBeNull();
    await press('Save session plan');
    expect(saved()).toMatchObject({
      p_id: null,
      p_team_id: TEAM.id,
      p_title: 'Tuesday skills',
      p_session_on: '2026-10-18',
      p_copied_from: 'plan-1',
    });
    expect(storage.download).toHaveBeenCalledWith('plan-1/abc/drills.pdf');
    expect(storage.upload).toHaveBeenCalledWith('plan-new/uuid-1/Drills.pdf', expect.any(ArrayBuffer), {
      contentType: 'application/pdf',
      upsert: false,
    });
    expect(onlyRpcCall('add_session_plan_file')).toEqual({
      p_plan_id: 'plan-new',
      p_path: 'plan-new/uuid-1/Drills.pdf',
      p_name: 'Drills.pdf',
      p_content_type: 'application/pdf',
    });
  });

  it('leaves a file out of the copy when asked', async () => {
    await openForm('coach', '/session-plans/edit?copy=plan-1', { source: plan(), files: [FILE] });
    await press('Leave out');
    await press('Save session plan');
    expect(storage.download).not.toHaveBeenCalled();
    expect(rpcCalls('add_session_plan_file')).toEqual([]);
  });

  it('puts a copy of another group’s plan only in a group the member coaches', async () => {
    await openForm('coach', '/session-plans/edit?copy=plan-1', { source: plan({ team_id: TEAM_B.id }) });
    expect(screen.queryByText(TEAM_B.name)).toBeNull();
    await press('Save session plan');
    expect(saved()).toMatchObject({ p_team_id: TEAM.id, p_copied_from: 'plan-1' });
  });

  it('asks an admin to choose the group for a copy of a plan from a group they can’t add to', async () => {
    await openForm('admin', '/session-plans/edit?copy=plan-1', { source: plan({ team_id: 'team-archived' }) });
    await press('Save session plan');
    expect(screen.getByText('Choose the squad or team the session is for.')).toBeTruthy();
  });

  it('says when a file couldn’t be copied, keeping the new plan', async () => {
    await openForm('coach', '/session-plans/edit?copy=plan-1', { source: plan(), files: [FILE] });
    storage.download.mockResolvedValueOnce({ data: null, error: { message: 'gone' } });
    await press('Save session plan');
    expect(
      screen.getByText('Drills.pdf couldn’t be copied. Attach it again. The plan is saved; tap Save again to send the rest.'),
    ).toBeTruthy();
  });
});
