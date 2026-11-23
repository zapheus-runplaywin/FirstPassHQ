/**
 * The admin pages that hold the club's settings, as an admin uses them: Club
 * brand (src/app/admin/club/brand.tsx), Club features (club/features.tsx),
 * Club options (club/options.tsx) and Record keeping (club/records.tsx, with
 * src/components/record-retention.tsx). What each form starts from, exactly
 * what Save sends, colour and logo checks, and every switch's effect on the
 * saved features (section 10 of the user guide). Only admins reach the
 * pages; the route tests cover that.
 *
 * Features are saved as switches away from their defaults only: most start
 * on, a few (such as Season KPIs) start off. The database saves the name,
 * colours, logo, features and squads switch together and replaces all of
 * them on each save, so each page must send back what it doesn't change
 * exactly as saved.
 */
import { fireEvent, screen, within } from 'expo-router/testing-library';
import * as DocumentPicker from 'expo-document-picker';

import ClubBrandScreen from '@/app/admin/club/brand';
import ClubFeaturesScreen from '@/app/admin/club/features';
import ClubOptionsScreen from '@/app/admin/club/options';
import RecordKeepingScreen from '@/app/admin/club/records';
import { RecordRetention } from '@/components/record-retention';
import { Screen } from '@/components/screen';
import { supabase } from '@/lib/supabase';

import { openScreen, settle, TODAY } from './helpers/harness';
import {
  clubReload,
  flip,
  input,
  isDisabled,
  isOn,
  isSelected,
  setSavedClub,
  type,
} from './helpers/settings-forms';

jest.mock('@/lib/club', () => jest.requireActual('./helpers/settings-forms').savedClubModuleMock());
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

// Each test settles a whole screen several times; leave room on a busy machine.
jest.setTimeout(30000);
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-file-system', () => ({
  ...jest.requireActual('expo-file-system'),
  File: jest.fn().mockImplementation(() => ({ arrayBuffer: async () => new ArrayBuffer(8) })),
}));

const rpc = () => supabase.rpc as jest.Mock;
const callsTo = (name: string) =>
  (rpc().mock.calls as [string, Record<string, unknown>][])
    .filter(([n]) => n === name)
    .map(([, args]) => args);
const rpcNames = () => (rpc().mock.calls as [string][]).map(([n]) => n);
const pickDocument = DocumentPicker.getDocumentAsync as jest.Mock;

beforeEach(() => {
  setSavedClub();
  rpc().mockClear();
  pickDocument.mockReset();
});

/** The keep periods a club that has saved them gets back. */
const RETENTION = {
  enabled: false,
  check_ins_months: 12,
  goals_months: 12,
  messages_months: 36,
  attendance_months: 12,
  certificates_months: 12,
  access_log_months: 84,
  updated_by_name: 'Sample admin',
  updated_at: '2026-10-01T03:00:00Z',
};

const SURVEYS = { surveys_months: 36, shared_surveys_months: 24, team_polls_months: 6 };
const MORE = { injuries_months: 84, safeguarding_months: 360, award_votes_months: 12, awards_months: 120 };

const RETENTION_RPCS = {
  record_retention: RETENTION,
  child_messages_keep_months: 84,
  injury_documents_keep_days: 365,
  survey_retention: SURVEYS,
  more_record_retention: MORE,
  medical_keep_months: 24,
  assessment_keep_months: 12,
};

const PAGES = {
  brand: ClubBrandScreen,
  features: ClubFeaturesScreen,
  options: ClubOptionsScreen,
  records: RecordKeepingScreen,
};
type Page = keyof typeof PAGES;

const SAVE_BUTTON: Record<Exclude<Page, 'records'>, string> = {
  brand: 'Save club brand',
  features: 'Save club features',
  options: 'Save club options',
};

let openPage: Page = 'brand';

async function openClub(
  page: Page,
  rpcs: Record<string, unknown> = {},
  rpcErrors: Record<string, string> = {},
  tables: Record<string, unknown[]> = {},
) {
  openPage = page;
  await openScreen(
    'admin',
    { [`admin/club/${page}`]: PAGES[page] },
    `/admin/club/${page}`,
    tables,
    { rpcs: { physios_get_club_messages: false, ...RETENTION_RPCS, ...rpcs }, rpcErrors },
  );
}

/** Presses the open page's save button. */
async function save() {
  await fireEvent.press(screen.getByText(SAVE_BUTTON[openPage as Exclude<Page, 'records'>]));
  await settle();
}

const savedProfile = () => callsTo('admin_update_club_profile');

/** A club with its own look, some switches changed, and no squads. */
const CUSTOM_CLUB = {
  club_name: 'Sample Netball Club',
  short_name: 'Sample',
  background_colour: '#FFFFFF',
  text_colour: '#000000',
  hero_colour: '#2274A5',
  logo_path: 'logo-1.png',
  features: { calendar: false, kpis: true, squads: false },
};
/** CUSTOM_CLUB's look and switches as every page sends them back. */
const CUSTOM_SAVED = {
  p_club_name: 'Sample Netball Club',
  p_short_name: 'Sample',
  p_background_colour: '#FFFFFF',
  p_text_colour: '#000000',
  p_hero_colour: '#2274A5',
  p_logo_path: 'logo-1.png',
  p_features: { calendar: false, kpis: true, squads: false },
};

// ---------------------------------------------------------------------------
// One page each

describe('each settings page', () => {
  it.each([
    ['brand', ['Club name', 'Background', 'Choose logo'], ['Injuries', 'Members join a squad first', 'Remove old records']],
    ['features', ['Injuries', 'Pilot squads and teams'], ['Club name', 'Members join a squad first', 'Remove old records']],
    ['options', ['Members join a squad first', 'Physios get club messages'], ['Club name', 'Injuries', 'Remove old records']],
    ['records', ['Remove old records', 'Save keep periods'], ['Club name', 'Injuries', 'Members join a squad first']],
  ] as [Page, string[], string[]][])('%s shows only its own settings', async (page, shown, hidden) => {
    await openClub(page);
    const has = (label: string) =>
      screen.queryAllByText(label).length + screen.queryAllByLabelText(label).length > 0;
    for (const label of shown) expect(has(label)).toBe(true);
    for (const label of hidden) expect(has(label)).toBe(false);
  });

  it.each(['brand', 'features', 'options'] as Page[])(
    '%s sends back everything it doesn’t change exactly as saved',
    async (page) => {
      setSavedClub(CUSTOM_CLUB);
      await openClub(page);
      await save();
      expect(savedProfile()).toEqual([CUSTOM_SAVED]);
    },
  );

  it.each(['brand', 'features', 'options'] as Page[])(
    '%s loads the latest saved settings before filling the form',
    async (page) => {
      await openClub(page);
      expect(clubReload).toHaveBeenCalled();
    },
  );

  it('only Club features saves the pilot and only Club options saves the physio switch', async () => {
    await openClub('brand');
    await save();
    expect(rpcNames()).not.toContain('admin_set_pilot');
    expect(rpcNames()).not.toContain('admin_set_physios_get_club_messages');

    rpc().mockClear();
    await openClub('features');
    await save();
    expect(rpcNames()).toContain('admin_set_pilot');
    expect(rpcNames()).not.toContain('admin_set_physios_get_club_messages');

    rpc().mockClear();
    await openClub('options');
    await save();
    expect(rpcNames()).not.toContain('admin_set_pilot');
    expect(rpcNames()).toContain('admin_set_physios_get_club_messages');
  });

  it.each(['brand', 'features', 'options'] as Page[])(
    '%s shows the database’s refusal and saves nothing more',
    async (page) => {
      await openClub(page, {}, { admin_update_club_profile: 'Only admins can change club settings' });
      clubReload.mockClear();
      await save();
      expect(screen.getByText('Only admins can change club settings')).toBeTruthy();
      expect(rpcNames()).not.toContain('admin_set_pilot');
      expect(rpcNames()).not.toContain('admin_set_physios_get_club_messages');
      expect(clubReload).not.toHaveBeenCalled();
      expect(screen.queryByText(/^Saved\./)).toBeNull();
    },
  );
});

// ---------------------------------------------------------------------------
// Club brand

describe('Club brand', () => {
  it('starts from the club’s saved name, colours, text and logo', async () => {
    setSavedClub(CUSTOM_CLUB);
    await openClub('brand');
    expect(input('Club name').props.value).toBe('Sample Netball Club');
    expect(input('Short name').props.value).toBe('Sample');
    expect(input('Background').props.value).toBe('#FFFFFF');
    expect(input('Hero colour').props.value).toBe('#2274A5');
    expect(isSelected('Dark text')).toBe(true);
    expect(isSelected('Light text')).toBe(false);
    expect(screen.getByText('Use the FirstPass mark')).toBeTruthy();
  });

  it('leaves everything empty for a club on the built-in look, with the field limits', async () => {
    await openClub('brand');
    expect(input('Club name').props.value).toBe('');
    expect(input('Club name').props.placeholder).toBe('FirstPass HQ');
    expect(input('Club name').props.maxLength).toBe(60);
    expect(input('Short name').props.maxLength).toBe(20);
    expect(input('Background').props.placeholder).toBe('#0F172A');
    expect(input('Hero colour').props.placeholder).toBe('#F75C03');
    expect(input('Background').props.maxLength).toBe(7);
    expect(isSelected('Light text')).toBe(true);
    expect(screen.queryByText('Use the FirstPass mark')).toBeNull();
  });

  it('saves the name, colours and logo as entered, with no feature changes when all are on their defaults', async () => {
    await openClub('brand');
    await type('Club name', 'Sample Netball Club');
    await type('Short name', 'Sample');
    await type('Background', '#ffcd00');
    await type('Hero colour', '#000000');
    await fireEvent.press(screen.getByText('Dark text'));
    await save();
    expect(savedProfile()).toEqual([
      {
        p_club_name: 'Sample Netball Club',
        p_short_name: 'Sample',
        p_background_colour: '#ffcd00',
        p_text_colour: '#000000',
        p_hero_colour: '#000000',
        p_logo_path: '',
        p_features: {},
      },
    ]);
    expect(screen.getByText('Saved. Members see the changes next time they open the app.')).toBeTruthy();
  });

  it('saves a new look while keeping the club’s saved switches', async () => {
    setSavedClub(CUSTOM_CLUB);
    await openClub('brand');
    await type('Club name', 'Sample Hawks');
    await save();
    expect(savedProfile()).toEqual([{ ...CUSTOM_SAVED, p_club_name: 'Sample Hawks' }]);
  });

  it('saves Light text as white, and no text colour when the built-in text is kept', async () => {
    await openClub('brand');
    await fireEvent.press(screen.getByText('Light text'));
    await save();
    expect(savedProfile()[0].p_text_colour).toBe('#FFFFFF');

    rpc().mockClear();
    await fireEvent.press(screen.getByText('Use the built-in colours'));
    await save();
    expect(savedProfile()[0]).toMatchObject({
      p_background_colour: '',
      p_hero_colour: '',
      p_text_colour: '',
    });
  });

  it('puts the built-in colours back, clearing the colour codes and text choice', async () => {
    setSavedClub({ background_colour: '#FFFFFF', hero_colour: '#2274A5', text_colour: '#000000' });
    await openClub('brand');
    await fireEvent.press(screen.getByText('Use the built-in colours'));
    expect(input('Background').props.value).toBe('');
    expect(input('Hero colour').props.value).toBe('');
    expect(isSelected('Light text')).toBe(true);
  });

  it.each([
    ['Background', '#12345', 'Background must be a colour code like #F75C03.'],
    ['Background', 'yellow', 'Background must be a colour code like #F75C03.'],
    ['Hero colour', '#GGGGGG', 'Hero colour must be a colour code like #F75C03.'],
  ])('refuses to save %s “%s”, saying what a colour code looks like', async (field, value, message) => {
    await openClub('brand');
    await type(field, value);
    await save();
    expect(screen.getByText(message)).toBeTruthy();
    expect(savedProfile()).toEqual([]);
  });

  it('warns when the text would be hard to read on the background', async () => {
    await openClub('brand');
    expect(screen.queryByText(/text and background are close in colour/)).toBeNull();
    // Dark text on the built-in deep navy.
    await fireEvent.press(screen.getByText('Dark text'));
    expect(screen.getByText(/text and background are close in colour/)).toBeTruthy();
  });

  it('warns when the hero colour is close to the background', async () => {
    await openClub('brand');
    expect(screen.queryByText(/hero colour is close to the background/)).toBeNull();
    await type('Hero colour', '#10182C');
    expect(screen.getByText(/hero colour is close to the background/)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Club features

describe('Club features', () => {
  it('saves every feature switched away from its default, and only those', async () => {
    await openClub('features');
    // On by default: switching off is saved.
    await flip('Messages', false);
    await flip('Injuries', false);
    await flip('Captains’ polls', false);
    // Off by default: switching on is saved.
    await flip('Season KPIs', true);
    await flip('Policy and conflict registers', true);
    await save();
    expect(savedProfile()).toEqual([
      {
        p_club_name: '',
        p_short_name: '',
        p_background_colour: '',
        p_text_colour: '',
        p_hero_colour: '',
        p_logo_path: '',
        p_features: {
          messages: false,
          injuries: false,
          captainPolls: false,
          kpis: true,
          registers: true,
        },
      },
    ]);
    expect(screen.getByText('Saved. Members see the changes next time they open the app.')).toBeTruthy();
  });

  it('warns before Injuries is turned off with injuries open, saying they pause and registers keep the note', async () => {
    await openClub('features', {
      visible_injuries: [
        { id: 'i1', status: 'injured' },
        { id: 'i2', status: 'clearance_requested' },
        { id: 'i3', status: 'coach_endorsed' },
      ],
    });
    expect(screen.queryByText(/injuries are open/)).toBeNull();
    await flip('Injuries', false);
    await settle();
    expect(
      screen.getByText(
        /^3 injuries are open, and 2 are waiting for clearance sign-off, which will wait too\./,
      ),
    ).toBeTruthy();
    expect(screen.getByText(/Registers keep showing “Injured”/)).toBeTruthy();
    // Back on before saving: the warning goes.
    await flip('Injuries', true);
    expect(screen.queryByText(/injuries are open/)).toBeNull();
  });

  it('says what turning Daily check-ins or Live streams off does to parents’ consent', async () => {
    await openClub('features');
    expect(screen.getByText('Live streams')).toBeTruthy();
    expect(isOn('Live streams')).toBe(true);
    await flip('Daily check-ins', false);
    await flip('Live streams', false);
    expect(
      screen.getByText(/haven’t answered the check-in consent question no longer see it/),
    ).toBeTruthy();
    expect(
      screen.getByText(/no longer see the question about their child’s stats on live streams/),
    ).toBeTruthy();
    await save();
    expect(savedProfile()[0].p_features).toEqual({
      checkIns: false,
      liveStreams: false,
    });
  });

  it('shows no note under a feature already off when the screen opens', async () => {
    setSavedClub({ features: { injuries: false } });
    await openClub('features', { visible_injuries: [{ id: 'i1', status: 'injured' }] });
    expect(screen.queryByText(/injur(y is|ies are) open/)).toBeNull();
  });

  it('shows the club’s saved switches and keeps them when saved again, dropping the old Affiliation switch', async () => {
    setSavedClub({
      features: { calendar: false, awards: false, kpis: true, affiliation: true, squads: false },
    });
    await openClub('features');
    expect(isOn('Calendar')).toBe(false);
    expect(isOn('Awards')).toBe(false);
    expect(isOn('Messages')).toBe(true);
    expect(isOn('Season KPIs')).toBe(true);
    // Affiliation was removed on 7 November 2026: no switch, and saving clears it.
    expect(screen.queryByText('Affiliation records')).toBeNull();
    expect(screen.queryByText(/association/i)).toBeNull();
    await save();
    // Squads stay off: they're on Club options, and this page sends them back as saved.
    expect(savedProfile()[0].p_features).toEqual({
      calendar: false,
      awards: false,
      kpis: true,
      squads: false,
    });
  });

  it('turning a switched-off feature back on stores nothing for it', async () => {
    setSavedClub({ features: { messages: false, kpis: true, registers: true } });
    await openClub('features');
    await flip('Messages', true);
    await flip('Season KPIs', false);
    await flip('Policy and conflict registers', false);
    await save();
    expect(savedProfile()[0].p_features).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Club options

describe('Club options', () => {
  it('starts from the club’s saved squads and physio switches', async () => {
    setSavedClub({ features: { squads: false } });
    await openClub('options', { physios_get_club_messages: true });
    expect(isOn('Members join a squad first')).toBe(false);
    expect(isOn('Physios get club messages')).toBe(true);
  });

  it('starts with squads on and physios off', async () => {
    await openClub('options');
    expect(isOn('Members join a squad first')).toBe(true);
    expect(isOn('Physios get club messages')).toBe(false);
  });

  it('saves squads off with the club’s look and other switches as saved', async () => {
    setSavedClub({ ...CUSTOM_CLUB, features: { calendar: false, kpis: true } });
    await openClub('options');
    await flip('Members join a squad first', false);
    await save();
    expect(savedProfile()).toEqual([CUSTOM_SAVED]);
  });

  it('turning squads back on stores nothing for them', async () => {
    setSavedClub({ features: { squads: false } });
    await openClub('options');
    await flip('Members join a squad first', true);
    await save();
    expect(savedProfile()[0].p_features).toEqual({});
  });

  it('explains what changes when squads are switched off or back on', async () => {
    await openClub('options');
    expect(screen.getByText(/^New members join a squad\./)).toBeTruthy();
    expect(screen.queryByText(/Squads you already have stay until the season ends/)).toBeNull();
    await flip('Members join a squad first', false);
    expect(screen.getByText(/^Members join a team straight away/)).toBeTruthy();
    expect(screen.getByText(/Squads you already have stay until the season ends, and nobody is moved\./)).toBeTruthy();
  });

  it('says what happens to existing teams when squads are switched on', async () => {
    setSavedClub({ features: { squads: false } });
    await openClub('options');
    expect(screen.queryByText(/From now on, new teams are named from a squad/)).toBeNull();
    await flip('Members join a squad first', true);
    expect(screen.getByText(/From now on, new teams are named from a squad\. Teams you already have keep their members\./)).toBeTruthy();
  });

  it('saves the physio switch after the club settings', async () => {
    await openClub('options');
    await flip('Physios get club messages', true);
    await save();
    const names = rpcNames();
    expect(names.indexOf('admin_update_club_profile')).toBeLessThan(
      names.indexOf('admin_set_physios_get_club_messages'),
    );
    expect(callsTo('admin_set_physios_get_club_messages')).toEqual([{ p_on: true }]);
    expect(screen.getByText('Saved. Members see the changes next time they open the app.')).toBeTruthy();
  });

  it('shows a failed physio setting and doesn’t say it saved', async () => {
    await openClub('options', {}, { admin_set_physios_get_club_messages: 'Not allowed' });
    await save();
    expect(screen.getByText('Not allowed')).toBeTruthy();
    expect(screen.queryByText(/^Saved\./)).toBeNull();
  });
  it('shows the club’s time zone, Perth unless changed', async () => {
    await openClub('options');
    expect(screen.getByText('Time zone')).toBeTruthy();
    expect(screen.getByText('Perth')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Perth', selected: true })).toBeTruthy();
    expect(screen.getByText(/^Perth \(Western Australia\)\. Today there is /)).toBeTruthy();
  });

  it('starts from the zone the club saved', async () => {
    setSavedClub({ timezone: 'Australia/Hobart' });
    await openClub('options');
    expect(screen.getByRole('button', { name: 'Hobart', selected: true })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Perth', selected: false })).toBeTruthy();
  });

  it('keeps a zone saved some other way on the list', async () => {
    setSavedClub({ timezone: 'Pacific/Fiji' });
    await openClub('options');
    expect(screen.getByRole('button', { name: 'Pacific/Fiji', selected: true })).toBeTruthy();
  });

  it('doesn’t save the time zone when it hasn’t changed', async () => {
    await openClub('options');
    await save();
    expect(rpcNames()).not.toContain('admin_set_club_timezone');
  });

  it('saves a new time zone after the club settings', async () => {
    await openClub('options');
    await fireEvent.press(screen.getByRole('button', { name: 'Sydney' }));
    expect(screen.getByText(/^Sydney \(New South Wales and the ACT\)\. Today there is /)).toBeTruthy();
    await save();
    const names = rpcNames();
    expect(names.indexOf('admin_update_club_profile')).toBeLessThan(names.indexOf('admin_set_club_timezone'));
    expect(callsTo('admin_set_club_timezone')).toEqual([{ p_timezone: 'Australia/Sydney' }]);
    expect(screen.getByText('Saved. Members see the changes next time they open the app.')).toBeTruthy();
  });

  it('shows a refused time zone and doesn’t say it saved', async () => {
    await openClub('options', {}, { admin_set_club_timezone: 'Choose a time zone from the list' });
    await fireEvent.press(screen.getByRole('button', { name: 'Adelaide' }));
    await save();
    expect(screen.getByText('Choose a time zone from the list')).toBeTruthy();
    expect(screen.queryByText(/^Saved\./)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Record keeping

describe('Record keeping', () => {
  it('holds the keep periods and the removal switch', async () => {
    await openClub('records');
    expect(screen.getByText(/^How long the club keeps members’ records/)).toBeTruthy();
    expect(screen.getByLabelText('Remove old records')).toBeTruthy();
    expect(screen.getByText('Save keep periods')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Team pilot: a feature on for pilot teams only (Matt, 2026-11-16)

const group = (id: string, name: string, kind: 'squad' | 'team', squad_id: string | null, sort_order: number) => ({
  id,
  name,
  kind,
  squad_id,
  sort_order,
  season: 2026,
  archived: false,
  selections_completed_at: null,
});
const TEAMS = {
  teams: [
    group('sq-20', '20 & Under', 'squad', null, 1),
    group('t-20a', '20 & Under A', 'team', 'sq-20', 2),
    group('sq-open', 'Open', 'squad', null, 3),
  ],
};
const audience = (feature: string) => within(screen.getByLabelText(`Who sees ${feature}`));
const audienceIs = (feature: string, label: string) => {
  let node: ReturnType<typeof screen.getByText> | null = audience(feature).getByText(label);
  while (node && node.props.accessibilityState === undefined) node = node.parent;
  return node?.props.accessibilityState?.selected === true;
};
async function choose(feature: string, label: string) {
  await fireEvent.press(audience(feature).getByText(label));
  await settle();
}
async function pickGroup(label: string) {
  await fireEvent.press(screen.getByText(label));
  await settle();
}
const savedPilot = () => callsTo('admin_set_pilot');

describe('Team pilot', () => {
  it('starts every feature that’s on as shown to everyone, and offers no choice for one that’s off', async () => {
    setSavedClub({ features: { awards: false } });
    await openClub('features', {}, {}, TEAMS);
    expect(audienceIs('Injuries', 'Everyone')).toBe(true);
    expect(audienceIs('Injuries', 'Pilot teams only')).toBe(false);
    expect(screen.queryByLabelText('Who sees Awards')).toBeNull();
    expect(screen.queryByLabelText('Who sees Season KPIs')).toBeNull();
    expect(callsTo('admin_pilot_settings')).toHaveLength(1);
  });

  it('lists squads before their teams, marked as squad or team', async () => {
    await openClub('features', {}, {}, TEAMS);
    const labels = ['20 & Under (squad)', '20 & Under A (team)', 'Open (squad)'];
    for (const label of labels) expect(screen.getByText(label)).toBeTruthy();
    const all = screen.getAllByText(/\((squad|team)\)$/).map((n) => n.props.children);
    expect(all).toEqual(labels);
  });

  it('saves the pilot-only features and pilot teams after the club settings, leaving the on and off switches alone', async () => {
    await openClub('features', {}, {}, TEAMS);
    await choose('Injuries', 'Pilot teams only');
    await choose('Surveys', 'Pilot teams only');
    await pickGroup('20 & Under (squad)');
    await save();
    expect(savedProfile()[0].p_features).toEqual({});
    expect(savedPilot()).toEqual([{ p_features: ['injuries', 'surveys'], p_team_ids: ['sq-20'] }]);
    const names = rpcNames();
    expect(names.indexOf('admin_update_club_profile')).toBeLessThan(names.indexOf('admin_set_pilot'));
    expect(screen.getByText(/^Saved\./)).toBeTruthy();
  });

  it('shows the saved pilot and keeps it when saved again', async () => {
    await openClub(
      'features',
      { admin_pilot_settings: [{ pilot_features: ['messages'], pilot_team_ids: ['t-20a'] }] },
      {},
      TEAMS,
    );
    expect(audienceIs('Messages', 'Pilot teams only')).toBe(true);
    expect(audienceIs('Calendar', 'Everyone')).toBe(true);
    expect(isSelected('20 & Under A (team)')).toBe(true);
    expect(isSelected('20 & Under (squad)')).toBe(false);
    await save();
    expect(savedPilot()).toEqual([{ p_features: ['messages'], p_team_ids: ['t-20a'] }]);
  });

  it('puts a feature back to everyone and takes a team out of the pilot', async () => {
    await openClub(
      'features',
      { admin_pilot_settings: [{ pilot_features: ['messages', 'injuries'], pilot_team_ids: ['t-20a', 'sq-open'] }] },
      {},
      TEAMS,
    );
    await choose('Messages', 'Everyone');
    await pickGroup('Open (squad)');
    await save();
    expect(savedPilot()).toEqual([{ p_features: ['injuries'], p_team_ids: ['t-20a'] }]);
  });

  it('drops a pilot-only feature that is switched off, since off is off for everyone', async () => {
    await openClub(
      'features',
      { admin_pilot_settings: [{ pilot_features: ['injuries'], pilot_team_ids: ['t-20a'] }] },
      {},
      TEAMS,
    );
    await flip('Injuries', false);
    expect(screen.queryByLabelText('Who sees Injuries')).toBeNull();
    await save();
    expect(savedProfile()[0].p_features).toEqual({ injuries: false });
    expect(savedPilot()).toEqual([{ p_features: [], p_team_ids: ['t-20a'] }]);
  });

  it('says who sees pilot features, and warns when no squad or team is in the pilot', async () => {
    await openClub('features', {}, {}, TEAMS);
    expect(screen.queryByText(/Features for pilot teams only show/)).toBeNull();
    await choose('Attendance', 'Pilot teams only');
    expect(screen.getByText(/No squads or teams are in the pilot yet/)).toBeTruthy();
    await pickGroup('20 & Under A (team)');
    expect(screen.queryByText(/No squads or teams are in the pilot yet/)).toBeNull();
    expect(screen.getByText(/parents of their athletes, admins and committee/)).toBeTruthy();
  });

  it('asks for squads or teams first when the club has none', async () => {
    await openClub('features');
    expect(screen.getByText('Add squads or teams in Administration first.')).toBeTruthy();
  });

  it('shows a refused pilot save, saves nothing after it and doesn’t say it saved', async () => {
    await openClub('features', {}, { admin_set_pilot: 'A squad or team in the pilot no longer exists' }, TEAMS);
    await choose('Injuries', 'Pilot teams only');
    await save();
    expect(screen.getByText('A squad or team in the pilot no longer exists')).toBeTruthy();
    expect(screen.queryByText(/^Saved\./)).toBeNull();
  });

  it('starts with no pilot when the pilot can’t be read', async () => {
    await openClub('features', {}, { admin_pilot_settings: 'Only admins can see the pilot settings' }, TEAMS);
    expect(audienceIs('Injuries', 'Everyone')).toBe(true);
    await save();
    expect(savedPilot()).toEqual([{ p_features: [], p_team_ids: [] }]);
  });
});

// ---------------------------------------------------------------------------
// The logo

describe('the club logo', () => {
  const upload = jest.fn();

  function useStorage() {
    upload.mockReset();
    upload.mockResolvedValue({ error: null });
    (supabase.storage.from as jest.Mock).mockImplementation(() => ({
      upload,
      getPublicUrl: () => ({ data: { publicUrl: 'https://example.test/logo.png' } }),
    }));
  }

  async function choose(asset: Record<string, unknown> | null) {
    pickDocument.mockResolvedValue(
      asset ? { canceled: false, assets: [{ uri: 'file:///logo', name: 'logo', ...asset }] } : { canceled: true, assets: null },
    );
    await fireEvent.press(screen.getByText('Choose logo'));
    await settle();
  }

  it('offers only PNG and JPEG images', async () => {
    await openClub('brand');
    useStorage();
    await choose(null);
    expect(pickDocument).toHaveBeenCalledWith({
      type: ['image/png', 'image/jpeg'],
      copyToCacheDirectory: true,
    });
    expect(upload).not.toHaveBeenCalled();
  });

  it('uploads a PNG to the club’s branding files and saves its path with the settings', async () => {
    await openClub('brand');
    useStorage();
    await choose({ mimeType: 'image/png', size: 1000 });
    expect(supabase.storage.from).toHaveBeenCalledWith('club-branding');
    const path = `logo-${TODAY.getTime()}.png`;
    expect(upload).toHaveBeenCalledWith(path, expect.any(ArrayBuffer), {
      contentType: 'image/png',
      upsert: false,
    });
    expect(screen.getByText('Use the FirstPass mark')).toBeTruthy();
    await save();
    expect(savedProfile()[0].p_logo_path).toBe(path);
  });

  it('names a JPEG .jpg', async () => {
    await openClub('brand');
    useStorage();
    await choose({ mimeType: 'image/jpeg', size: 1000 });
    expect(upload.mock.calls[0][0]).toBe(`logo-${TODAY.getTime()}.jpg`);
  });

  it('refuses an image over 2 MB without uploading it', async () => {
    await openClub('brand');
    useStorage();
    await choose({ mimeType: 'image/png', size: 2 * 1024 * 1024 + 1 });
    expect(screen.getByText('That image is over 2 MB. Try a smaller PNG.')).toBeTruthy();
    expect(upload).not.toHaveBeenCalled();
  });

  it('takes an image of exactly 2 MB', async () => {
    await openClub('brand');
    useStorage();
    await choose({ mimeType: 'image/png', size: 2 * 1024 * 1024 });
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it.each([['image/gif'], [undefined]])('refuses a file of type %p', async (mimeType) => {
    await openClub('brand');
    useStorage();
    await choose({ mimeType, size: 1000 });
    expect(
      screen.getByText('Choose a PNG or JPEG image. A square PNG with a see-through background works best.'),
    ).toBeTruthy();
    expect(upload).not.toHaveBeenCalled();
  });

  it('says why an upload failed and keeps the old logo', async () => {
    setSavedClub({ logo_path: 'logo-old.png' });
    await openClub('brand');
    useStorage();
    upload.mockResolvedValue({ error: { message: 'Bucket full' } });
    await choose({ mimeType: 'image/png', size: 1000 });
    expect(screen.getByText('The logo didn’t upload: Bucket full')).toBeTruthy();
    await save();
    expect(savedProfile()[0].p_logo_path).toBe('logo-old.png');
  });

  it('goes back to the FirstPass mark, saving no logo', async () => {
    setSavedClub({ logo_path: 'logo-old.png' });
    await openClub('brand');
    await fireEvent.press(screen.getByText('Use the FirstPass mark'));
    expect(screen.queryByText('Use the FirstPass mark')).toBeNull();
    await save();
    expect(savedProfile()[0].p_logo_path).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Keeping records

function RetentionOnly() {
  return (
    <Screen>
      <RecordRetention />
    </Screen>
  );
}

async function openRetention(rpcs: Record<string, unknown> = {}, rpcErrors: Record<string, string> = {}) {
  await openScreen('admin', { retention: RetentionOnly }, '/retention', {}, {
    rpcs: { ...RETENTION_RPCS, ...rpcs },
    rpcErrors,
  });
}

/** The chip `choice` under the period labelled `period`. */
function chip(period: string, choice: string) {
  let node = screen.getByText(period).parent;
  while (node && within(node).queryAllByText(choice).length === 0) node = node.parent;
  return within(node!).getByText(choice);
}

function chosen(period: string, choice: string) {
  let node: ReturnType<typeof chip> | null = chip(period, choice);
  while (node && node.props.accessibilityState === undefined) node = node.parent;
  return node?.props.accessibilityState?.selected === true;
}

async function saveKeepPeriods() {
  await fireEvent.press(screen.getByText('Save keep periods'));
  await settle();
}

describe('Keeping records', () => {
  it('says injuries of athletes who left follow the Cleared injuries period, not 12 months', async () => {
    await openRetention();
    expect(
      screen.getByText(/Injuries of athletes who have left follow Cleared injuries below, counted from\s+when they left\./),
    ).toBeTruthy();
    expect(screen.queryByText(/12 months after an athlete leaves/)).toBeNull();
    expect(screen.getByText(/for an athlete who has left, each of their injuries goes this long after they left/)).toBeTruthy();
  });

  it('shows the saved periods, the removal switch and who last changed them', async () => {
    await openRetention();
    expect(isOn('Remove old records')).toBe(false);
    expect(chosen('Daily check-ins', '1 year')).toBe(true);
    expect(chosen('Message text', '3 years')).toBe(true);
    expect(chosen('Message text involving a child', '7 years')).toBe(true);
    expect(chosen('Injury documents', '1 year')).toBe(true);
    expect(chosen('Medical and emergency details', '2 years')).toBe(true);
    expect(chosen('Cleared injuries', '7 years')).toBe(true);
    expect(chosen('Safeguarding records', '30 years')).toBe(true);
    expect(chosen('Awards and their results', '10 years')).toBe(true);
    expect(chosen('Selection assessments', '1 year')).toBe(true);
    expect(screen.getByText(/^Last changed by Sample admin, /)).toBeTruthy();
    // Nothing to save until something changes.
    expect(isDisabled('Save keep periods')).toBe(true);
  });

  it('starts on the recommended periods when the club has saved none of the newer ones', async () => {
    await openRetention({
      record_retention: { ...RETENTION, updated_at: null, updated_by_name: null },
      child_messages_keep_months: null,
      injury_documents_keep_days: null,
      survey_retention: null,
      more_record_retention: null,
      medical_keep_months: null,
      assessment_keep_months: null,
    });
    expect(chosen('Selection assessments', '1 year')).toBe(true);
    expect(chosen('Message text involving a child', '7 years')).toBe(true);
    expect(chosen('Medical and emergency details', '2 years')).toBe(true);
    expect(chosen('Injury documents', '1 year')).toBe(true);
    expect(chosen('Surveys from the committee and admins', '3 years')).toBe(true);
    expect(chosen('Squad and team surveys shared with admins or the committee', '2 years')).toBe(true);
    expect(chosen('Squad and team polls kept in the team', '6 months')).toBe(true);
    expect(chosen('Cleared injuries', '7 years')).toBe(true);
    expect(chosen('Safeguarding records', '30 years')).toBe(true);
    expect(chosen('Who voted for whom in awards', '1 year')).toBe(true);
    expect(chosen('Awards and their results', '10 years')).toBe(true);
    expect(screen.queryByText(/^Last changed by/)).toBeNull();
  });

  it('shows nothing when the database returns no keep periods', async () => {
    await openRetention({ record_retention: null });
    expect(screen.queryByText(/^How long the club keeps members’ records/)).toBeNull();
    expect(screen.queryByText('Save keep periods')).toBeNull();
  });

  it('offers only the choices for each period', async () => {
    await openRetention();
    for (const choice of ['3 months', '6 months', '1 year', '2 years']) {
      expect(chip('Daily check-ins', choice)).toBeTruthy();
    }
    for (const choice of ['90 days', '1 year', '3 years']) expect(chip('Injury documents', choice)).toBeTruthy();
    for (const choice of ['2 years', '3 years', '5 years', '7 years']) {
      expect(chip('Medical and emergency details', choice)).toBeTruthy();
    }
    expect(screen.getByText(/when nobody has done their yearly check for this long/)).toBeTruthy();
    for (const choice of ['3 years', '5 years', '10 years', '20 years', 'Keep for good']) {
      expect(chip('Awards and their results', choice)).toBeTruthy();
    }
  });

  it('offers attendance for 10 or 15 years and safeguarding for 45 years or for good', async () => {
    await openRetention();
    for (const choice of ['1 year', '5 years', '10 years', '15 years']) expect(chip('Attendance', choice)).toBeTruthy();
    for (const choice of ['7 years', '30 years', '45 years', 'Keep for good']) {
      expect(chip('Safeguarding records', choice)).toBeTruthy();
    }
    expect(screen.getByText(/at least 45 years/)).toBeTruthy();
    expect(screen.getByText(/while a concern names a member nothing about them is removed/)).toBeTruthy();
    await fireEvent.press(chip('Attendance', '15 years'));
    await fireEvent.press(chip('Safeguarding records', 'Keep for good'));
    await saveKeepPeriods();
    expect(callsTo('admin_set_record_retention_all')[0].p_attendance_months).toBe(180);
    expect(callsTo('admin_set_more_record_retention')[0].p_safeguarding_months).toBe(0);
  });

  it('saves the removal switch and every period across the three settings, in order', async () => {
    await openRetention();
    await flip('Remove old records', true);
    await fireEvent.press(chip('Daily check-ins', '3 months'));
    await fireEvent.press(chip('Message text involving a child', '15 years'));
    await fireEvent.press(chip('Injury documents', '90 days'));
    await fireEvent.press(chip('Squad and team polls kept in the team', '1 year'));
    await fireEvent.press(chip('Awards and their results', 'Keep for good'));
    await fireEvent.press(chip('Medical and emergency details', '5 years'));
    expect(isDisabled('Save keep periods')).toBe(false);
    await saveKeepPeriods();
    expect(callsTo('admin_set_record_retention_all')).toEqual([
      {
        p_enabled: true,
        p_check_ins_months: 3,
        p_goals_months: 12,
        p_messages_months: 36,
        p_child_messages_months: 180,
        p_attendance_months: 12,
        p_certificates_months: 12,
        p_access_log_months: 84,
        p_injury_documents_days: 90,
      },
    ]);
    expect(callsTo('admin_set_survey_retention')).toEqual([
      { p_surveys_months: 36, p_shared_surveys_months: 24, p_team_polls_months: 12 },
    ]);
    expect(callsTo('admin_set_more_record_retention')).toEqual([
      { p_injuries_months: 84, p_safeguarding_months: 360, p_award_votes_months: 12, p_awards_months: 0 },
    ]);
    const names = rpcNames();
    expect(names.indexOf('admin_set_record_retention_all')).toBeLessThan(names.indexOf('admin_set_survey_retention'));
    expect(names.indexOf('admin_set_survey_retention')).toBeLessThan(names.indexOf('admin_set_more_record_retention'));
    expect(callsTo('admin_set_medical_keep_months')).toEqual([{ p_months: 60 }]);
    expect(names.indexOf('admin_set_more_record_retention')).toBeLessThan(names.indexOf('admin_set_medical_keep_months'));
    expect(callsTo('admin_set_assessment_keep_months')).toEqual([{ p_months: 12 }]);
    expect(names.indexOf('admin_set_medical_keep_months')).toBeLessThan(
      names.indexOf('admin_set_assessment_keep_months'),
    );
    expect(screen.getByText('Saved.')).toBeTruthy();
  });

  it('keeps a period the club saved before it stopped being offered, so saving never shortens it', async () => {
    await openRetention({ record_retention: { ...RETENTION, attendance_months: 84 } });
    expect(chosen('Attendance', '7 years')).toBe(true);
    await flip('Remove old records', true);
    await saveKeepPeriods();
    expect(callsTo('admin_set_record_retention_all')[0].p_attendance_months).toBe(84);
  });

  it('lists an old saved awards period before Keep for good', async () => {
    await openRetention({ more_record_retention: { ...MORE, awards_months: 180 } });
    let node = screen.getByText('Awards and their results').parent;
    while (node && within(node).queryAllByText('Keep for good').length === 0) node = node.parent;
    const labels = within(node!)
      .getAllByText(/years|Keep for good/)
      .map((t) => t.props.children as string)
      .filter((l) => l !== 'Awards and their results');
    expect(labels).toEqual(['3 years', '5 years', '10 years', '15 years', '20 years', 'Keep for good']);
    expect(chosen('Awards and their results', '15 years')).toBe(true);
  });

  it('stops at the first refusal and shows it', async () => {
    await openRetention({}, {
      admin_set_record_retention_all: 'Messages involving a child must be kept at least as long as other messages',
    });
    await fireEvent.press(chip('Message text', '7 years'));
    await saveKeepPeriods();
    expect(
      screen.getByText('Messages involving a child must be kept at least as long as other messages'),
    ).toBeTruthy();
    expect(callsTo('admin_set_survey_retention')).toEqual([]);
    expect(callsTo('admin_set_more_record_retention')).toEqual([]);
    expect(callsTo('admin_set_medical_keep_months')).toEqual([]);
    expect(screen.queryByText('Saved.')).toBeNull();
  });

  it('doesn’t save the later periods when the survey periods are refused', async () => {
    await openRetention({}, { admin_set_survey_retention: 'Survey periods refused' });
    await flip('Remove old records', true);
    await saveKeepPeriods();
    expect(screen.getByText('Survey periods refused')).toBeTruthy();
    expect(callsTo('admin_set_more_record_retention')).toEqual([]);
  });

  it('shows a refusal of the later periods', async () => {
    await openRetention({}, {
      admin_set_more_record_retention: 'Awards must be kept at least as long as who voted for whom',
    });
    await fireEvent.press(chip('Awards and their results', '3 years'));
    await fireEvent.press(chip('Who voted for whom in awards', '5 years'));
    await saveKeepPeriods();
    expect(screen.getByText('Awards must be kept at least as long as who voted for whom')).toBeTruthy();
    expect(callsTo('admin_set_medical_keep_months')).toEqual([]);
    expect(screen.queryByText('Saved.')).toBeNull();
  });

  it('shows a refusal of the medical details period', async () => {
    await openRetention({}, {
      admin_set_medical_keep_months: 'Medical details can be kept 2, 3, 5 or 7 years without their yearly check',
    });
    await fireEvent.press(chip('Medical and emergency details', '3 years'));
    await saveKeepPeriods();
    expect(screen.getByText('Medical details can be kept 2, 3, 5 or 7 years without their yearly check')).toBeTruthy();
    expect(screen.queryByText('Saved.')).toBeNull();
  });

  it('offers selection assessments for 1 to 7 years from the end of the round, and saves the choice', async () => {
    await openRetention();
    for (const choice of ['1 year', '2 years', '3 years', '5 years', '7 years']) {
      expect(chip('Selection assessments', choice)).toBeTruthy();
    }
    expect(screen.getByText(/from the day the round ends, or the day it was closed if that was later/)).toBeTruthy();
    expect(screen.getByText(/A round stays while a concern names anyone assessed in it/)).toBeTruthy();
    await fireEvent.press(chip('Selection assessments', '3 years'));
    await saveKeepPeriods();
    expect(callsTo('admin_set_assessment_keep_months')).toEqual([{ p_months: 36 }]);
    expect(screen.getByText('Saved.')).toBeTruthy();
  });

  it('shows a refusal of the selection assessments period, after saving the others', async () => {
    await openRetention({}, {
      admin_set_assessment_keep_months: 'Selection assessments can be kept 1, 2, 3, 5 or 7 years after the round ends',
    });
    await fireEvent.press(chip('Selection assessments', '2 years'));
    await saveKeepPeriods();
    expect(
      screen.getByText('Selection assessments can be kept 1, 2, 3, 5 or 7 years after the round ends'),
    ).toBeTruthy();
    expect(callsTo('admin_set_medical_keep_months')).toHaveLength(1);
    expect(screen.queryByText('Saved.')).toBeNull();
  });

  it('doesn’t save the selection assessments period when the medical period is refused', async () => {
    await openRetention({}, { admin_set_medical_keep_months: 'Medical period refused' });
    await fireEvent.press(chip('Selection assessments', '2 years'));
    await saveKeepPeriods();
    expect(callsTo('admin_set_assessment_keep_months')).toEqual([]);
  });

  it('loads the periods again after saving and shows what the database holds', async () => {
    await openRetention();
    rpc().mockClear();
    await flip('Remove old records', true);
    await saveKeepPeriods();
    expect(callsTo('record_retention')).toHaveLength(1);
    // This fake database still says off: the screen shows what was stored, not the draft.
    expect(isOn('Remove old records')).toBe(false);
    expect(isDisabled('Save keep periods')).toBe(true);
  });
});

describe('Keeping records: the nightly removal', () => {
  const RUN = {
    last_run_at: '2026-10-22T18:17:00Z',
    last_ok_at: '2026-10-22T18:17:00Z',
    failed_step: null,
    overdue: false,
  };

  it('shows when it last ran', async () => {
    await openRetention({ removal_run_status: RUN });
    expect(callsTo('removal_run_status')).toHaveLength(1);
    expect(screen.getByText(/^Last run .+\.$/)).toBeTruthy();
    expect(screen.queryByText(/Ask FirstPass/)).toBeNull();
  });

  it('says it hasn’t run yet', async () => {
    await openRetention({ removal_run_status: { ...RUN, last_run_at: null, last_ok_at: null } });
    expect(screen.getByText('The nightly removal hasn’t run yet.')).toBeTruthy();
  });

  it('says where the last run stopped, and that the next one carries on', async () => {
    await openRetention({
      removal_run_status: { ...RUN, last_run_at: '2026-10-23T18:17:00Z', failed_step: 'removing documents' },
    });
    expect(screen.getByText(/^The last run, .+, stopped while removing documents\. The next run carries on from there\.$/)).toBeTruthy();
    expect(screen.queryByText(/Ask FirstPass/)).toBeNull();
  });

  it('warns when it is overdue, since the last time it finished', async () => {
    await openRetention({ removal_run_status: { ...RUN, overdue: true } });
    expect(screen.getByText(/^Old records haven’t been removed since .+\. Ask FirstPass to check the nightly removal\.$/)).toBeTruthy();
  });

  it('warns when it is overdue and has never finished, with where it stopped', async () => {
    await openRetention({
      removal_run_status: { last_run_at: '2026-10-21T18:17:00Z', last_ok_at: null, failed_step: 'removing old records', overdue: true },
    });
    expect(
      screen.getByText(/^Old records haven’t been removed yet\. The last run, .+, stopped while removing old records\. Ask FirstPass to check the nightly removal\.$/),
    ).toBeTruthy();
  });

  it('shows no line when the status can’t be read', async () => {
    await openRetention({ removal_run_status: null });
    expect(screen.getByText(/^How long the club keeps members’ records/)).toBeTruthy();
    expect(screen.queryByText(/^Last run|nightly removal|haven’t been removed/)).toBeNull();
  });
});
