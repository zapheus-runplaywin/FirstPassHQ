/**
 * "Check applied for" on a member's admin page (src/components/wwcc-application.tsx
 * in src/app/admin/[id].tsx), the receipt viewer (admin/wwcc-receipt.tsx),
 * and the members list counting applications (Safeguarding's contacts are
 * in admin-safeguarding-screens.test.tsx). From
 * "Check applied for" in sections 10 and 12 of docs/user-guide.md.
 *
 * In WA someone who has applied for a check, new or a renewal, can do
 * child-related work while it's assessed, with the receipt. An admin records
 * the application with the receipt, the member accepts a declaration, and
 * it counts as their check until their card is recorded. An admin confirms
 * it's still being assessed every 30 days. Admins never record or confirm
 * their own, and members under 18, exempt members and members with a current
 * card don't see it.
 */
import * as DocumentPicker from 'expo-document-picker';
import { router } from 'expo-router';
import { fireEvent, screen } from 'expo-router/testing-library';
import { Linking } from 'react-native';

import MemberScreen from '@/app/admin/[id]';
import MembersScreen from '@/app/admin/index';
import WwccReceiptScreen from '@/app/admin/wwcc-receipt';
import { DocumentViewer } from '@/components/document-viewer';
import { localDay } from '@/lib/reports';
import { supabase } from '@/lib/supabase';
import type { Profile, WwccApplication } from '@/lib/types';
import { uploadReceipt, viewReceiptUrl } from '@/lib/wwcc-applications';

import { press, rpcsNamed, typeInto } from './helpers/admin-screens';
import {
  morePersonas,
  openScreen,
  personas,
  resetClub,
  settle,
  type BackendOptions,
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
// The viewer needs a native web view; what it's given is what matters here.
jest.mock('@/components/document-viewer', () => ({ DocumentViewer: jest.fn(() => null) }));
// The upload itself is tested in src/lib/__tests__/wwcc-applications.test.ts.
jest.mock('@/lib/wwcc-applications', () => ({
  ...jest.requireActual('@/lib/wwcc-applications'),
  uploadReceipt: jest.fn(async (profileId: string) => `${profileId}/uuid-1/receipt.pdf`),
}));

const pickDocument = DocumentPicker.getDocumentAsync as jest.Mock;

beforeEach(() => {
  resetClub();
  (supabase.rpc as jest.Mock).mockClear();
  pickDocument.mockReset();
  jest.mocked(uploadReceipt).mockClear();
});

const NO_CARD = { wwcc_number: null, wwcc_expires_on: null };
const coach = (extra: Partial<Profile> = {}): Profile => ({
  ...personas.coach.profile!,
  id: 'coach-applied',
  full_name: 'Sample applied coach',
  ...NO_CARD,
  ...extra,
});

function application(overrides: Partial<WwccApplication> = {}): WwccApplication {
  return {
    id: 'a1',
    profile_id: 'coach-applied',
    member_name: 'Sample applied coach',
    application_number: 'APL 123',
    lodged_on: '2026-10-10',
    kind: 'new',
    receipt_path: 'coach-applied/uuid-1/receipt.pdf',
    receipt_name: 'receipt.pdf',
    recorded_at: '2026-10-11T02:00:00Z',
    recorded_by_name: 'Sample admin',
    declared_at: '2026-10-12T02:00:00Z',
    checked_at: null,
    checked_by_name: null,
    check_due_on: '2026-11-10',
    lapses_on: '2027-01-09',
    status: 'in_force',
    ended_at: null,
    ended_reason: null,
    ended_by_name: null,
    end_note: null,
    ...overrides,
  };
}

async function openMember(
  target: Profile,
  applications: WwccApplication[] = [],
  options: BackendOptions & { viewer?: Parameters<typeof openScreen>[0] } = {},
) {
  const { viewer = 'admin', ...rest } = options;
  await openScreen(
    viewer,
    { 'admin/[id]': MemberScreen },
    `/admin/${target.id}`,
    { guardianships: [], stand_downs: [], screening_notices: [], guardianship_history: [] },
    {
      ...rest,
      tableHandlers: {
        profiles: (q) => (q.eq('id') === target.id ? [target] : undefined),
      },
      rpcs: {
        admin_volunteer_exemptions: [],
        admin_date_of_birth_record: null,
        admin_wwcc_applications: applications,
        ...rest.rpcs,
      },
    },
  );
}

const HEADING = 'Check applied for';

describe('who it’s shown for', () => {
  it('shows it for a coach with no card, offering to record one', async () => {
    await openMember(coach());
    expect(screen.getByText(HEADING)).toBeTruthy();
    expect(screen.getByText('Record an application')).toBeTruthy();
    expect(screen.getByText(/can start or keep doing child-related work while it’s assessed/)).toBeTruthy();
  });

  it('shows it for a coach whose card expired, and a committee member with none', async () => {
    await openMember(coach({ wwcc_number: 'WWC1', wwcc_expires_on: '2025-01-01' }));
    expect(screen.getByText(HEADING)).toBeTruthy();
    await openMember({ ...personas.committee.profile!, ...NO_CARD });
    expect(screen.getByText(HEADING)).toBeTruthy();
  });

  it('leaves it out for a current card, an athlete, a temporary helper or a child', async () => {
    await openMember(coach({ wwcc_number: 'WWC1', wwcc_expires_on: '2029-01-01' }));
    expect(screen.queryByText(HEADING)).toBeNull();
    await openMember(personas.athlete.profile!);
    expect(screen.queryByText(HEADING)).toBeNull();
    await openMember({ ...personas.volunteer.profile!, ...NO_CARD });
    expect(screen.queryByText(HEADING)).toBeNull();
    await openMember(morePersonas.under18Athlete.profile);
    expect(screen.queryByText(HEADING)).toBeNull();
  });

  it('leaves it out while an exemption is chosen instead', async () => {
    await openMember(coach());
    await press('Parent volunteer').catch(() => {});
    await press('Short-term visitor');
    expect(screen.queryByText(HEADING)).toBeNull();
  });

  it('shows an admin their own application, but leaves recording and confirming to another admin', async () => {
    const me = { ...personas.admin.profile!, ...NO_CARD };
    await openMember(me, [application({ profile_id: me.id })]);
    expect(screen.getByText('Application APL 123, new check, lodged 10/10/2026')).toBeTruthy();
    expect(screen.getByText('Another admin confirms yours.')).toBeTruthy();
    expect(screen.queryByText('Still being assessed')).toBeNull();
    expect(screen.queryByText('It’s ended')).toBeNull();
    expect(screen.queryByText('Record an application')).toBeNull();
  });
});

describe('recording an application', () => {
  async function fill() {
    await openMember(coach());
    await press('Record an application');
    await typeInto('Application number', 'apl 123');
    await typeInto('Day it was lodged', '10/10/2026');
    await press('Renewal');
  }

  it('uploads the receipt into the member’s folder and records it', async () => {
    pickDocument.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///r.pdf', name: 'receipt.pdf', mimeType: 'application/pdf', size: 10 }],
    });
    await fill();
    await press('Attach the receipt');
    expect(screen.getByText('Receipt: receipt.pdf')).toBeTruthy();
    expect(pickDocument).toHaveBeenCalledWith({
      type: ['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif'],
      copyToCacheDirectory: true,
    });
    await press('Save application');
    expect(uploadReceipt).toHaveBeenCalledWith('coach-applied', expect.objectContaining({ name: 'receipt.pdf' }));
    expect(rpcsNamed('admin_record_wwcc_application')).toEqual([
      [
        'admin_record_wwcc_application',
        {
          p_profile_id: 'coach-applied',
          p_application_number: 'apl 123',
          p_lodged_on: '2026-10-10',
          p_kind: 'renewal',
          p_receipt_path: 'coach-applied/uuid-1/receipt.pdf',
          p_receipt_name: 'receipt.pdf',
        },
      ],
    ]);
    // The form closes and the list is read again.
    expect(screen.getByText('Record an application')).toBeTruthy();
    expect(rpcsNamed('admin_wwcc_applications').length).toBeGreaterThan(1);
  });

  it.each([
    ['the number', async () => typeInto('Application number', ' '), 'Enter the application number from the receipt.'],
    ['the day', async () => typeInto('Day it was lodged', '31/02/2026'), 'Enter the day it was lodged as DD/MM/YYYY.'],
    ['new or renewal', async () => press('Renewal'), 'Choose whether it’s a new check or a renewal.'],
  ])('asks for %s before sending anything', async (_what, undo, message) => {
    pickDocument.mockResolvedValue({ canceled: false, assets: [{ uri: 'f', name: 'r.pdf' }] });
    await fill();
    await press('Attach the receipt');
    await undo();
    await press('Save application');
    expect(screen.getByText(message)).toBeTruthy();
    expect(rpcsNamed('admin_record_wwcc_application')).toEqual([]);
    expect(uploadReceipt).not.toHaveBeenCalled();
  });

  it('asks for the receipt, and keeps none when picking is cancelled', async () => {
    pickDocument.mockResolvedValue({ canceled: true, assets: null });
    await fill();
    await press('Attach the receipt');
    expect(screen.getByText('Attach the receipt')).toBeTruthy();
    await press('Save application');
    expect(screen.getByText('Attach the receipt.')).toBeTruthy();
    expect(rpcsNamed('admin_record_wwcc_application')).toEqual([]);
  });

  it('shows the database’s refusal and keeps the form', async () => {
    pickDocument.mockResolvedValue({ canceled: false, assets: [{ uri: 'f', name: 'r.pdf' }] });
    await openMember(coach(), [], {
      rpcErrors: {
        admin_record_wwcc_application: 'A Screening Unit notice since then bars them, so the application doesn’t count',
      },
    });
    await press('Record an application');
    await typeInto('Application number', 'APL 1');
    await typeInto('Day it was lodged', '10/10/2026');
    await press('New check');
    await press('Attach the receipt');
    await press('Save application');
    expect(
      screen.getByText('A Screening Unit notice since then bars them, so the application doesn’t count'),
    ).toBeTruthy();
    expect(screen.getByText('Save application')).toBeTruthy();
  });

  it('shows an upload that fails', async () => {
    jest.mocked(uploadReceipt).mockRejectedValueOnce(new Error('The receipt didn’t upload: offline'));
    pickDocument.mockResolvedValue({ canceled: false, assets: [{ uri: 'f', name: 'r.pdf' }] });
    await fill();
    await press('Attach the receipt');
    await press('Save application');
    expect(screen.getByText('The receipt didn’t upload: offline')).toBeTruthy();
    expect(rpcsNamed('admin_record_wwcc_application')).toEqual([]);
  });
});

describe('an open application', () => {
  it('shows where it’s up to, who recorded and confirmed it, and opens the receipt', async () => {
    const push = jest.spyOn(router, 'push').mockImplementation(() => {});
    await openMember(coach(), [
      application({ checked_at: '2026-10-15T02:00:00Z', checked_by_name: 'Sample second admin' }),
    ]);
    expect(screen.getByText('Application APL 123, new check, lodged 10/10/2026')).toBeTruthy();
    expect(screen.getByText('Check applied for 10/10/2026, counts until 09/01/2027')).toBeTruthy();
    expect(
      screen.getByText(
        `Recorded by Sample admin on ${localDay('2026-10-11T02:00:00Z')}; declaration accepted ${localDay('2026-10-12T02:00:00Z')}; last confirmed by Sample second admin on ${localDay('2026-10-15T02:00:00Z')}.`,
      ),
    ).toBeTruthy();
    expect(screen.queryByText('Record an application')).toBeNull();
    await fireEvent.press(screen.getByText('Open the receipt'));
    expect(push).toHaveBeenCalledWith({
      pathname: '/admin/wwcc-receipt',
      params: { path: 'coach-applied/uuid-1/receipt.pdf', name: 'receipt.pdf' },
    });
    push.mockRestore();
  });

  it('links to the Screening Unit’s online status check', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await openMember(coach(), [application()]);
    await fireEvent.press(screen.getByText('Check its status online'));
    expect(open).toHaveBeenCalledWith('https://workingwithchildren.wa.gov.au/online-services');
    open.mockRestore();
  });

  it('flags one waiting for the declaration, or lapsed', async () => {
    await openMember(coach(), [application({ declared_at: null, status: 'waiting_for_declaration' })]);
    expect(screen.getByText('Check applied for 10/10/2026: waiting for them to accept the declaration')).toBeTruthy();
    expect(screen.getByText(`Recorded by Sample admin on ${localDay('2026-10-11T02:00:00Z')}.`)).toBeTruthy();
    await openMember(coach(), [application({ status: 'lapsed', recorded_by_name: null })]);
    expect(screen.getByText('Check applied for 10/10/2026: lapsed, nobody confirmed it’s still being assessed')).toBeTruthy();
    expect(screen.getByText(/^Recorded by a former admin on /)).toBeTruthy();
  });

  it('confirms it’s still being assessed', async () => {
    await openMember(coach(), [application()]);
    await press('Still being assessed');
    expect(rpcsNamed('admin_confirm_wwcc_application')).toEqual([
      ['admin_confirm_wwcc_application', { p_application_id: 'a1' }],
    ]);
  });

  it('shows a refusal to confirm', async () => {
    await openMember(coach(), [application()], {
      rpcErrors: { admin_confirm_wwcc_application: 'That application has ended' },
    });
    await press('Still being assessed');
    expect(screen.getByText('That application has ended')).toBeTruthy();
  });

  it('offers no confirmation once a notice has stopped it', async () => {
    await openMember(coach(), [application({ status: 'stopped' })]);
    expect(screen.getByText('Check applied for 10/10/2026: stopped by a Screening Unit notice')).toBeTruthy();
    expect(screen.queryByText('Still being assessed')).toBeNull();
    expect(screen.getByText('It’s ended')).toBeTruthy();
  });

  it('ends it with a reason and a note', async () => {
    await openMember(coach(), [application()]);
    await press('It’s ended');
    await press('End the application');
    expect(screen.getByText('Choose why it ended.')).toBeTruthy();
    expect(rpcsNamed('admin_end_wwcc_application')).toEqual([]);
    await press('Withdrawn');
    await typeInto('What happened (optional)', 'They moved interstate');
    await press('End the application');
    expect(rpcsNamed('admin_end_wwcc_application')).toEqual([
      [
        'admin_end_wwcc_application',
        { p_application_id: 'a1', p_reason: 'withdrawn', p_note: 'They moved interstate' },
      ],
    ]);
    expect(screen.queryByText('End the application')).toBeNull();
  });

  it.each([
    ['Refused', 'refused'],
    ['Something else', 'other'],
  ])('ends it as %s', async (label, reason) => {
    await openMember(coach(), [application()]);
    await press('It’s ended');
    await press(label);
    await press('End the application');
    expect(rpcsNamed('admin_end_wwcc_application')[0][1]).toMatchObject({ p_reason: reason, p_note: '' });
  });

  it('shows a refusal to end it, and keeps the choices', async () => {
    await openMember(coach(), [application()], {
      rpcErrors: { admin_end_wwcc_application: 'That application has already ended' },
    });
    await press('It’s ended');
    await press('Refused');
    await press('End the application');
    expect(screen.getByText('That application has already ended')).toBeTruthy();
    expect(screen.getByText('End the application')).toBeTruthy();
  });

  it('lists earlier ones with how they ended, and only this member’s', async () => {
    await openMember(coach(), [
      application({
        id: 'a0',
        application_number: 'APL 99',
        lodged_on: '2026-08-01',
        ended_at: '2026-09-01T02:00:00Z',
        ended_reason: 'withdrawn',
        end_note: 'Moved',
        status: 'ended',
      }),
      application({ id: 'a2', ended_at: '2026-09-02T02:00:00Z', ended_reason: null, status: 'ended' }),
      application({ id: 'other', profile_id: 'someone-else', application_number: 'APL 7' }),
    ]);
    expect(
      screen.getByText(
        `Earlier: application APL 99, lodged 01/08/2026, ended ${localDay('2026-09-01T02:00:00Z')} (withdrawn): Moved`,
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(`Earlier: application APL 123, lodged 10/10/2026, ended ${localDay('2026-09-02T02:00:00Z')}`),
    ).toBeTruthy();
    expect(screen.queryByText(/APL 7/)).toBeNull();
    expect(screen.getByText('Record an application')).toBeTruthy();
  });
});

describe('the receipt', () => {
  it('opens in the app from a two-minute link, never saved to the phone', async () => {
    await openScreen(
      'admin',
      { 'admin/wwcc-receipt': WwccReceiptScreen },
      '/admin/wwcc-receipt?path=coach-applied%2Fuuid-1%2Freceipt.pdf&name=receipt.pdf',
    );
    await settle();
    expect(jest.mocked(DocumentViewer).mock.calls.at(-1)?.[0]).toEqual({
      path: 'coach-applied/uuid-1/receipt.pdf',
      name: 'receipt.pdf',
      fallbackName: 'Application receipt',
      signedUrl: viewReceiptUrl,
    });
  });
});

describe('the members list', () => {
  const applied = coach();
  const lapsed = coach({ id: 'coach-lapsed', full_name: 'Sample lapsed coach' });

  it('leaves an application in force off Needs checking, and says what a lapsed one needs', async () => {
    await openScreen('admin', { 'admin/index': MembersScreen }, '/admin', {}, {
      tableHandlers: { profiles: () => [applied, lapsed] },
      rpcs: {
        admin_volunteer_exemptions: [],
        admin_inactive_members: [],
        admin_wwcc_applications: [
          application(),
          application({ id: 'a2', profile_id: 'coach-lapsed', status: 'lapsed' }),
        ],
      },
    });
    expect(
      screen.getByText('Coach · Check applied for 10/10/2026: lapsed, nobody confirmed it’s still being assessed'),
    ).toBeTruthy();
    expect(screen.queryByText(/No Working With Children Check recorded/)).toBeNull();
    expect(screen.getAllByText(/Check applied for/)).toHaveLength(1);
  });

});
