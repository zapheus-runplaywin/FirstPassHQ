/**
 * Club settings (src/app/admin/club.tsx) and its Keeping records section
 * (src/components/record-retention.tsx), as an admin uses them: what the form
 * starts from, exactly what Save sends, colour and logo checks, and every
 * switch's effect on the saved features (section 10 of the user guide, "Club
 * settings" and "Keeping records"). Only admins reach the screen; the route
 * tests cover that.
 *
 * Features are saved as switches away from their defaults only: most start
 * on, Season KPIs and Affiliation records start off, and the database
 * replaces the whole list on each save, so every change must be in it.
 */
import { fireEvent, screen, within } from 'expo-router/testing-library';
import * as DocumentPicker from 'expo-document-picker';

import ClubSettingsScreen from '@/app/admin/club';
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
  useAdminPushNotifications: jest.fn(),
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
};

async function openClub(
  rpcs: Record<string, unknown> = {},
  rpcErrors: Record<string, string> = {},
) {
  await openScreen('admin', { 'admin/club': ClubSettingsScreen }, '/admin/club', {}, {
    rpcs: { physios_get_club_messages: false, ...RETENTION_RPCS, ...rpcs },
    rpcErrors,
  });
}

async function save() {
  await fireEvent.press(screen.getByText('Save club settings'));
  await settle();
}

const savedProfile = () => callsTo('admin_update_club_profile');

// ---------------------------------------------------------------------------
// Club settings

describe('Club settings', () => {
  it('starts from the club’s saved name, colours, text, logo and physio switch', async () => {
    setSavedClub({
      club_name: 'Sample Netball Club',
      short_name: 'Sample',
      background_colour: '#FFFFFF',
      text_colour: '#000000',
      hero_colour: '#2274A5',
      logo_path: 'logo-1.png',
    });
    await openClub({ physios_get_club_messages: true });
    expect(input('Club name').props.value).toBe('Sample Netball Club');
    expect(input('Short name').props.value).toBe('Sample');
    expect(input('Background').props.value).toBe('#FFFFFF');
    expect(input('Hero colour').props.value).toBe('#2274A5');
    expect(isSelected('Dark text')).toBe(true);
    expect(isSelected('Light text')).toBe(false);
    expect(screen.getByText('Use the FirstPass mark')).toBeTruthy();
    expect(isOn('Physios get club messages')).toBe(true);
    expect(clubReload).toHaveBeenCalled();
  });

  it('leaves everything empty for a club on the built-in look, with the field limits', async () => {
    await openClub();
    expect(input('Club name').props.value).toBe('');
    expect(input('Club name').props.placeholder).toBe('FirstPass HQ');
    expect(input('Club name').props.maxLength).toBe(60);
    expect(input('Short name').props.maxLength).toBe(20);
    expect(input('Background').props.placeholder).toBe('#0F172A');
    expect(input('Hero colour').props.placeholder).toBe('#F75C03');
    expect(input('Background').props.maxLength).toBe(7);
    expect(isSelected('Light text')).toBe(true);
    expect(screen.queryByText('Use the FirstPass mark')).toBeNull();
    // Physios start off.
    expect(isOn('Physios get club messages')).toBe(false);
  });

  it('saves the name, colours and logo as entered, with no feature changes when all are on their defaults', async () => {
    await openClub();
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
    expect(callsTo('admin_set_physios_get_club_messages')).toEqual([{ p_on: false }]);
    expect(screen.getByText('Saved. Members see the changes next time they open the app.')).toBeTruthy();
  });

  it('saves Light text as white, and no text colour when the built-in text is kept', async () => {
    await openClub();
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
    await openClub();
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
    await openClub();
    await type(field, value);
    await save();
    expect(screen.getByText(message)).toBeTruthy();
    expect(savedProfile()).toEqual([]);
    expect(callsTo('admin_set_physios_get_club_messages')).toEqual([]);
  });

  it('warns when the text would be hard to read on the background', async () => {
    await openClub();
    expect(screen.queryByText(/text and background are close in colour/)).toBeNull();
    // Dark text on the built-in deep navy.
    await fireEvent.press(screen.getByText('Dark text'));
    expect(screen.getByText(/text and background are close in colour/)).toBeTruthy();
  });

  it('warns when the hero colour is close to the background', async () => {
    await openClub();
    expect(screen.queryByText(/hero colour is close to the background/)).toBeNull();
    await type('Hero colour', '#10182C');
    expect(screen.getByText(/hero colour is close to the background/)).toBeTruthy();
  });

  it('saves every feature switched away from its default, and only those', async () => {
    await openClub();
    // On by default: switching off is saved.
    await flip('Messages', false);
    await flip('Injuries', false);
    await flip('Captains’ polls', false);
    // Off by default: switching on is saved.
    await flip('Season KPIs', true);
    await flip('Affiliation records', true);
    await flip('Policy and conflict registers', true);
    await flip('Members join a squad first', false);
    await save();
    expect(savedProfile()[0].p_features).toEqual({
      messages: false,
      injuries: false,
      captainPolls: false,
      kpis: true,
      registers: true,
      squads: false,
      affiliation: true,
    });
  });

  it('shows the club’s saved switches and keeps them when saved again', async () => {
    setSavedClub({
      features: { calendar: false, awards: false, kpis: true, affiliation: true, squads: false },
    });
    await openClub();
    expect(isOn('Calendar')).toBe(false);
    expect(isOn('Awards')).toBe(false);
    expect(isOn('Messages')).toBe(true);
    expect(isOn('Season KPIs')).toBe(true);
    expect(isOn('Affiliation records')).toBe(true);
    expect(isOn('Members join a squad first')).toBe(false);
    await save();
    expect(savedProfile()[0].p_features).toEqual({
      calendar: false,
      awards: false,
      kpis: true,
      squads: false,
      affiliation: true,
    });
  });

  it('turning a switched-off feature back on stores nothing for it', async () => {
    setSavedClub({ features: { messages: false, kpis: true, registers: true } });
    await openClub();
    await flip('Messages', true);
    await flip('Season KPIs', false);
    await flip('Policy and conflict registers', false);
    await save();
    expect(savedProfile()[0].p_features).toEqual({});
  });

  it('explains what changes when squads are switched off or back on', async () => {
    await openClub();
    expect(screen.getByText(/^New members join a squad\./)).toBeTruthy();
    expect(screen.queryByText(/Squads you already have stay until the season ends/)).toBeNull();
    await flip('Members join a squad first', false);
    expect(screen.getByText(/^Members join a team straight away/)).toBeTruthy();
    expect(screen.getByText(/Squads you already have stay until the season ends, and nobody is moved\./)).toBeTruthy();
  });

  it('says what happens to existing teams when squads are switched on', async () => {
    setSavedClub({ features: { squads: false } });
    await openClub();
    expect(screen.queryByText(/From now on, new teams are named from a squad/)).toBeNull();
    await flip('Members join a squad first', true);
    expect(screen.getByText(/From now on, new teams are named from a squad\. Teams you already have keep their members\./)).toBeTruthy();
  });

  it('saves the physio switch after the club settings', async () => {
    await openClub();
    await flip('Physios get club messages', true);
    await save();
    const names = (rpc().mock.calls as [string][]).map(([n]) => n);
    expect(names.indexOf('admin_update_club_profile')).toBeLessThan(
      names.indexOf('admin_set_physios_get_club_messages'),
    );
    expect(callsTo('admin_set_physios_get_club_messages')).toEqual([{ p_on: true }]);
  });

  it('shows the database’s refusal and saves nothing more', async () => {
    await openClub({}, { admin_update_club_profile: 'Only admins can change club settings' });
    clubReload.mockClear();
    await save();
    expect(screen.getByText('Only admins can change club settings')).toBeTruthy();
    expect(callsTo('admin_set_physios_get_club_messages')).toEqual([]);
    expect(clubReload).not.toHaveBeenCalled();
    expect(screen.queryByText(/^Saved\./)).toBeNull();
  });

  it('shows a failed physio setting and doesn’t say it saved', async () => {
    await openClub({}, { admin_set_physios_get_club_messages: 'Not allowed' });
    await save();
    expect(screen.getByText('Not allowed')).toBeTruthy();
    expect(screen.queryByText(/^Saved\./)).toBeNull();
  });

  it('has the Keeping records section at the bottom', async () => {
    await openClub();
    expect(screen.getByText('Keeping records')).toBeTruthy();
    expect(screen.getByLabelText('Remove old records')).toBeTruthy();
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
    await openClub();
    useStorage();
    await choose(null);
    expect(pickDocument).toHaveBeenCalledWith({
      type: ['image/png', 'image/jpeg'],
      copyToCacheDirectory: true,
    });
    expect(upload).not.toHaveBeenCalled();
  });

  it('uploads a PNG to the club’s branding files and saves its path with the settings', async () => {
    await openClub();
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
    await openClub();
    useStorage();
    await choose({ mimeType: 'image/jpeg', size: 1000 });
    expect(upload.mock.calls[0][0]).toBe(`logo-${TODAY.getTime()}.jpg`);
  });

  it('refuses an image over 2 MB without uploading it', async () => {
    await openClub();
    useStorage();
    await choose({ mimeType: 'image/png', size: 2 * 1024 * 1024 + 1 });
    expect(screen.getByText('That image is over 2 MB. Try a smaller PNG.')).toBeTruthy();
    expect(upload).not.toHaveBeenCalled();
  });

  it('takes an image of exactly 2 MB', async () => {
    await openClub();
    useStorage();
    await choose({ mimeType: 'image/png', size: 2 * 1024 * 1024 });
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it.each([['image/gif'], [undefined]])('refuses a file of type %p', async (mimeType) => {
    await openClub();
    useStorage();
    await choose({ mimeType, size: 1000 });
    expect(
      screen.getByText('Choose a PNG or JPEG image. A square PNG with a see-through background works best.'),
    ).toBeTruthy();
    expect(upload).not.toHaveBeenCalled();
  });

  it('says why an upload failed and keeps the old logo', async () => {
    setSavedClub({ logo_path: 'logo-old.png' });
    await openClub();
    useStorage();
    upload.mockResolvedValue({ error: { message: 'Bucket full' } });
    await choose({ mimeType: 'image/png', size: 1000 });
    expect(screen.getByText('The logo didn’t upload: Bucket full')).toBeTruthy();
    await save();
    expect(savedProfile()[0].p_logo_path).toBe('logo-old.png');
  });

  it('goes back to the FirstPass mark, saving no logo', async () => {
    setSavedClub({ logo_path: 'logo-old.png' });
    await openClub();
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
    });
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
    expect(screen.queryByText('Keeping records')).toBeNull();
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
    const names = (rpc().mock.calls as [string][]).map(([n]) => n);
    expect(names.indexOf('admin_set_record_retention_all')).toBeLessThan(names.indexOf('admin_set_survey_retention'));
    expect(names.indexOf('admin_set_survey_retention')).toBeLessThan(names.indexOf('admin_set_more_record_retention'));
    expect(callsTo('admin_set_medical_keep_months')).toEqual([{ p_months: 60 }]);
    expect(names.indexOf('admin_set_more_record_retention')).toBeLessThan(names.indexOf('admin_set_medical_keep_months'));
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
    expect(screen.getByText('Keeping records')).toBeTruthy();
    expect(screen.queryByText(/^Last run|nightly removal|haven’t been removed/)).toBeNull();
  });
});
