/**
 * Integrity training: the member's own and their children's
 * (src/app/training/index.tsx), sending a certificate
 * (src/app/training/submit.tsx), the committee's checks
 * (src/app/training/review.tsx), everyone's progress
 * (src/app/training/progress.tsx) and one course's members
 * (src/app/training/requirement/[id].tsx).
 *
 * Members, and parents for their children, upload a certificate for the
 * courses it covers. Only committee members and admins (with their roles in
 * force) check certificates and see everyone's progress; nobody checks their
 * own or their child's, and sending one back needs a note (user guide
 * sections 3 and 8).
 */
import * as DocumentPicker from 'expo-document-picker';
import { fireEvent, screen } from 'expo-router/testing-library';
import { Text } from 'react-native';

import TrainingScreen from '@/app/training/index';
import TrainingProgressScreen from '@/app/training/progress';
import TrainingRequirementScreen from '@/app/training/requirement/[id]';
import ReviewCertificatesScreen from '@/app/training/review';
import SubmitCertificateScreen from '@/app/training/submit';
import { formatDateString, shareCsv } from '@/lib/injuries';
import { supabase } from '@/lib/supabase';
import type {
  CertificateToReview,
  MyTraining,
  TrainingCounts,
  TrainingMember,
  TrainingRequirement,
} from '@/lib/training';

import { clearCalls, onlyRpcCall, pushTo, rpcCalls, rpcNames } from './helpers/calls';
import {
  openScreen,
  resetClub,
  setClubFeatures,
  settle,
  TEAM,
  toneOf,
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
jest.mock('expo-file-system', () => ({
  File: class {
    async arrayBuffer() {
      return new ArrayBuffer(8);
    }
  },
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('@/lib/injuries', () => ({
  ...jest.requireActual('@/lib/injuries'),
  shareCsv: jest.fn(async () => {}),
}));

type Who = PersonaName | Persona;

// Each test fills in forms screen by screen; on a busy CI runner that can take
// longer than Jest's 5 second default.
jest.setTimeout(20000);

const storage = { upload: jest.fn() };

beforeEach(() => {
  resetClub();
  clearCalls();
  storage.upload.mockReset().mockResolvedValue({ data: {}, error: null });
  (DocumentPicker.getDocumentAsync as jest.Mock).mockReset();
  (shareCsv as jest.Mock).mockReset().mockResolvedValue(undefined);
});

const placeholder = (route: string) =>
  function Shown() {
    return <Text>{`screen:${route}`}</Text>;
  };

const press = async (text: string | RegExp, index = 0) => {
  await fireEvent.press(screen.getAllByText(text)[index]);
  await settle(6);
};

function row(extra: Partial<MyTraining> = {}): MyTraining {
  return {
    requirement_id: 'r1',
    season: 2026,
    name: 'Safeguarding in Sport',
    details: 'Sports Integrity Australia',
    course_url: 'https://example.test/course',
    due_on: '2027-03-31',
    profile_id: 'athlete',
    profile_name: 'Sample athlete',
    is_me: true,
    status: 'to_do',
    certificate_id: null,
    completed_on: null,
    document_path: null,
    document_name: null,
    review_note: null,
    reviewed_by_name: null,
    reviewed_at: null,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// The member's training

async function openTraining(who: Who, mine: MyTraining[], toReview: CertificateToReview[] = []) {
  await openScreen(
    who,
    {
      'training/index': TrainingScreen,
      'training/submit': placeholder('training/submit'),
      'training/review': placeholder('training/review'),
      'training/progress': placeholder('training/progress'),
      'training/document': placeholder('training/document'),
    },
    '/training',
    {},
    { rpcs: { my_training: mine, training_to_review: toReview } },
  );
}

function cert(extra: Partial<CertificateToReview> = {}): CertificateToReview {
  return {
    certificate_id: 'c1',
    requirement_id: 'r1',
    requirement_name: 'Safeguarding in Sport',
    due_on: '2027-03-31',
    profile_id: 'athlete',
    profile_name: 'Sample athlete',
    submitted_by_name: 'Sample athlete',
    completed_on: '2026-10-15',
    notes: null,
    document_path: 'athlete/x/cert.pdf',
    document_name: 'cert.pdf',
    created_at: '2026-10-15T00:00:00Z',
    can_review: true,
    ...extra,
  };
}

describe('a member’s integrity training', () => {
  it('shows each course with its due day and where it’s up to', async () => {
    await openTraining('athlete', [
      row(),
      row({ requirement_id: 'r2', name: 'Anti-doping', status: 'submitted', completed_on: '2026-10-15', document_path: 'p/c.pdf', document_name: 'c.pdf', course_url: null, due_on: '2026-10-01' }),
      row({ requirement_id: 'r3', name: 'Concussion', status: 'approved', completed_on: '2026-09-01' }),
      row({ requirement_id: 'r4', name: 'Code of conduct', status: 'sent_back', review_note: 'The name is cut off', reviewed_by_name: 'Sample committee', document_path: 'p/old.pdf' }),
    ]);
    expect(screen.getByText('Your training')).toBeTruthy();
    expect(screen.getAllByText(`Due ${formatDateString('2027-03-31')}`)).toHaveLength(3);
    expect(screen.getByText(`Overdue since ${formatDateString('2026-10-01')}`)).toBeTruthy();
    expect(screen.getByText('To do')).toBeTruthy();
    expect(screen.getByText(`Waiting to be checked · completed ${formatDateString('2026-10-15')}`)).toBeTruthy();
    expect(screen.getByText(`✓ Approved · completed ${formatDateString('2026-09-01')}`)).toBeTruthy();
    expect(screen.getByText('Sent back')).toBeTruthy();
    expect(toneOf(screen.getByText('Sent back'))).toBe('attention');
    expect(toneOf(screen.getByText(`✓ Approved · completed ${formatDateString('2026-09-01')}`))).toBe('plain');
    expect(screen.getByText('Sample committee: “The name is cut off”')).toBeTruthy();
    // A sent-back certificate isn't offered to view again.
    expect(screen.getAllByText('View certificate')).toHaveLength(1);
    expect(screen.getAllByText('Open the course')).toHaveLength(3);
  });

  it('offers Add a certificate while a course is still to do', async () => {
    await openTraining('athlete', [row()]);
    await press('Add a certificate');
    expect(screen.getByText('screen:training/submit')).toBeTruthy();
    expect(screen).toHaveSearchParams({ profile: 'athlete' });
  });

  it('offers no Add a certificate once everything is sent', async () => {
    await openTraining('athlete', [row({ status: 'submitted' }), row({ requirement_id: 'r2', status: 'approved' })]);
    expect(screen.queryByText('Add a certificate')).toBeNull();
  });

  it('opens a certificate in the app', async () => {
    await openTraining('athlete', [row({ status: 'approved', document_path: 'athlete/x/cert.pdf', document_name: 'cert.pdf' })]);
    await press('View certificate');
    expect(screen).toHaveSearchParams({ path: 'athlete/x/cert.pdf', name: 'cert.pdf' });
  });

  it('shows a parent their child’s training, uploaded for the child', async () => {
    await openTraining('guardian', [
      row({ profile_id: 'guardian', profile_name: 'Sample guardian', status: 'approved' }),
      row({ profile_id: 'child-1', profile_name: 'Sample Child', is_me: false }),
    ]);
    expect(screen.getByText('Your training')).toBeTruthy();
    expect(screen.getByText('Sample Child’s training')).toBeTruthy();
    await press('Add a certificate');
    expect(screen).toHaveSearchParams({ profile: 'child-1' });
  });

  it('says when there’s nothing to complete', async () => {
    await openTraining('athlete', []);
    expect(screen.getByText('You have no integrity training to complete.')).toBeTruthy();
  });

  it.each<[string, Who]>([
    ['committee member', 'committee'],
    ['admin', 'admin'],
  ])('lets a %s check certificates and see everyone’s progress', async (_l, who) => {
    await openTraining(who, [], [cert(), cert({ certificate_id: 'c2' }), cert({ certificate_id: 'c3', can_review: false })]);
    // Their own or their child's don't count as waiting for them.
    expect(screen.getByText('2 certificates waiting for you')).toBeTruthy();
    await press('Check certificates');
    expect(screen.getByText('screen:training/review')).toBeTruthy();
  });

  it('opens everyone’s progress', async () => {
    await openTraining('committee', []);
    expect(screen.getByText('Nothing waiting for you')).toBeTruthy();
    await press('Everyone’s progress');
    expect(screen.getByText('screen:training/progress')).toBeTruthy();
  });

  it.each<[string, Who]>([
    ['athlete', 'athlete'],
    ['coach', 'coach'],
    ['guardian', 'guardian'],
    ['committee member whose check lapsed', 'committeeExpiredCheck'],
    ['committee member past the checks date', 'committeePastChecksDate'],
    ['stood-down admin', 'stoodDownAdmin'],
  ])('gives a %s no way to check certificates', async (_l, who) => {
    await openTraining(who, [row()], [cert()]);
    expect(screen.queryByText('Check certificates')).toBeNull();
    expect(screen.queryByText('Everyone’s progress')).toBeNull();
    expect(rpcNames()).not.toContain('training_to_review');
  });

  it('asks for nothing while the club has integrity training off', async () => {
    setClubFeatures({ integrity: false });
    await openTraining('committee', [row()], [cert()]);
    expect(rpcNames()).not.toContain('my_training');
    expect(rpcNames()).not.toContain('training_to_review');
  });
});

// ---------------------------------------------------------------------------
// Sending a certificate

const PDF = { uri: 'file:///cert.pdf', name: 'cert.pdf', mimeType: 'application/pdf', size: 5000 };

async function openSubmit(who: Who, mine: MyTraining[], query = '', errors: Record<string, string> = {}) {
  await openScreen(
    who,
    { 'training/index': placeholder('training/index'), 'training/submit': SubmitCertificateScreen },
    '/training',
    {},
    { rpcs: { my_training: mine }, rpcErrors: errors },
  );
  await pushTo(`/training/submit${query}`);
  (supabase.storage.from as jest.Mock).mockImplementation(() => storage);
}

function attach(asset: object = PDF) {
  (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValue({ canceled: false, assets: [asset] });
}

describe('sending a certificate', () => {
  const two = [row(), row({ requirement_id: 'r2', name: 'Anti-doping', status: 'sent_back' }), row({ requirement_id: 'r3', name: 'Done one', status: 'approved' })];

  it('offers only the courses still needing a certificate', async () => {
    await openSubmit('athlete', two);
    expect(screen.getByText('Tick each course this certificate shows you completed.')).toBeTruthy();
    expect(screen.getByText('Safeguarding in Sport')).toBeTruthy();
    expect(screen.getByText(`Sent back · Due ${formatDateString('2027-03-31')}`)).toBeTruthy();
    expect(screen.queryByText('Done one')).toBeNull();
  });

  it('sends one certificate for every course ticked, then goes back', async () => {
    await openSubmit('athlete', two);
    await press('Safeguarding in Sport');
    await press('Anti-doping');
    await press('Yesterday');
    attach();
    await press('Attach the certificate');
    expect(screen.getByText('📎 cert.pdf')).toBeTruthy();
    await fireEvent.changeText(screen.getByPlaceholderText('Anything the committee should know'), 'Both on one PDF');
    await press('Send for checking');
    expect(storage.upload).toHaveBeenCalledWith('athlete/uuid-1/cert.pdf', expect.any(ArrayBuffer), {
      contentType: 'application/pdf',
      upsert: false,
    });
    expect(onlyRpcCall('submit_training_certificate')).toEqual({
      p_profile_id: 'athlete',
      p_requirement_ids: ['r1', 'r2'],
      p_completed_on: '2026-10-17',
      p_document_path: 'athlete/uuid-1/cert.pdf',
      p_document_name: 'cert.pdf',
      p_notes: 'Both on one PDF',
    });
    expect(screen).toHavePathname('/training');
  });

  it('starts with the course it was opened for ticked', async () => {
    await openSubmit('athlete', two, '?requirement=r2');
    attach();
    await press('Attach the certificate');
    await press('Send for checking');
    expect(onlyRpcCall('submit_training_certificate').p_requirement_ids).toEqual(['r2']);
  });

  it('takes a tick off when tapped again', async () => {
    await openSubmit('athlete', two);
    await press('Safeguarding in Sport');
    await press('Safeguarding in Sport');
    attach();
    await press('Attach the certificate');
    await press('Send for checking');
    expect(screen.getByText('Tick the training this certificate is for.')).toBeTruthy();
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('asks for the certificate itself', async () => {
    await openSubmit('athlete', two);
    await press('Safeguarding in Sport');
    await press('Send for checking');
    expect(screen.getByText('Attach the certificate of completion.')).toBeTruthy();
    expect(rpcCalls('submit_training_certificate')).toEqual([]);
  });

  it('won’t take a completion day after today', async () => {
    await openSubmit('athlete', two);
    await fireEvent.press(screen.getByLabelText('Day after'));
    await settle();
    expect(screen.getByText(formatDateString('2026-10-18'))).toBeTruthy();
  });

  it.each([
    [{ ...PDF, size: 11 * 1024 * 1024 }, 'That file is over 10 MB. Try a smaller photo or a PDF.'],
    [{ ...PDF, name: 'cert.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }, 'Attach a PDF or a photo (JPEG, PNG or HEIC).'],
  ])('refuses a file it can’t keep: %#', async (asset, message) => {
    await openSubmit('athlete', two);
    await press('Safeguarding in Sport');
    attach(asset);
    await press('Attach the certificate');
    await press('Send for checking');
    expect(screen.getByText(message)).toBeTruthy();
    expect(storage.upload).not.toHaveBeenCalled();
    expect(rpcCalls('submit_training_certificate')).toEqual([]);
  });

  it('shows why the upload failed', async () => {
    await openSubmit('athlete', two);
    await press('Safeguarding in Sport');
    attach();
    await press('Attach the certificate');
    storage.upload.mockResolvedValueOnce({ data: null, error: { message: 'Storage is full' } });
    await press('Send for checking');
    expect(screen.getByText('The file didn’t upload: Storage is full')).toBeTruthy();
    expect(rpcCalls('submit_training_certificate')).toEqual([]);
  });

  it('shows the database’s refusal and stays', async () => {
    await openSubmit('athlete', two, '', { submit_training_certificate: 'That training is already approved' });
    await press('Safeguarding in Sport');
    attach();
    await press('Attach the certificate');
    await press('Send for checking');
    expect(screen.getByText('That training is already approved')).toBeTruthy();
    expect(screen).toHavePathname('/training/submit');
  });

  it('lets a parent send their child’s certificate, named for the child', async () => {
    await openSubmit('guardian', [
      row({ profile_id: 'guardian', profile_name: 'Sample guardian' }),
      row({ profile_id: 'child-1', profile_name: 'Sample Child', is_me: false, requirement_id: 'r5', name: 'Junior safeguarding' }),
    ], '?profile=child-1');
    expect(screen.getByText('Who is it for?')).toBeTruthy();
    expect(screen.getByText('Tick each course this certificate shows Sample Child completed.')).toBeTruthy();
    expect(screen.queryByText('Safeguarding in Sport')).toBeNull();
    await press('Junior safeguarding');
    attach();
    await press('Attach the certificate');
    await press('Send for checking');
    expect(storage.upload).toHaveBeenCalledWith('child-1/uuid-1/cert.pdf', expect.any(ArrayBuffer), expect.anything());
    expect(onlyRpcCall('submit_training_certificate')).toMatchObject({ p_profile_id: 'child-1', p_requirement_ids: ['r5'] });
  });

  it('keeps ticks to the person chosen', async () => {
    await openSubmit('guardian', [
      row({ profile_id: 'guardian', profile_name: 'Sample guardian' }),
      row({ profile_id: 'child-1', profile_name: 'Sample Child', is_me: false, requirement_id: 'r5', name: 'Junior safeguarding' }),
    ]);
    await press('Safeguarding in Sport');
    await press('Sample Child');
    attach();
    await press('Attach the certificate');
    await press('Send for checking');
    // The tick on the parent's own course doesn't carry over to the child's.
    expect(screen.getByText('Tick the training this certificate is for.')).toBeTruthy();
  });

  it('says when nothing is waiting for a certificate', async () => {
    await openSubmit('athlete', [row({ status: 'approved' })]);
    expect(screen.getByText('There is no training waiting for a certificate.')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// The committee's checks

async function openReview(who: Who, certs: CertificateToReview[], errors: Record<string, string> = {}) {
  await openScreen(
    who,
    { 'training/review': ReviewCertificatesScreen, 'training/document': placeholder('training/document') },
    '/training/review',
    {},
    { rpcs: { training_to_review: certs }, rpcErrors: errors },
  );
}

describe('checking certificates', () => {
  it('shows who it’s for, the course, when it was done and who uploaded it', async () => {
    await openReview('committee', [cert({ profile_name: 'Sample Child', submitted_by_name: 'Sample guardian', notes: 'Second try' })]);
    expect(screen.getByText('Sample Child')).toBeTruthy();
    expect(screen.getByText(`Completed ${formatDateString('2026-10-15')} · Due ${formatDateString('2027-03-31')} · uploaded by Sample guardian`)).toBeTruthy();
    expect(screen.getByText('“Second try”')).toBeTruthy();
    await press('📎 cert.pdf');
    expect(screen).toHaveSearchParams({ path: 'athlete/x/cert.pdf', name: 'cert.pdf' });
  });

  it('approves a certificate and loads the list again', async () => {
    await openReview('committee', [cert()]);
    await press('Approve');
    expect(onlyRpcCall('review_training_certificate')).toEqual({ p_certificate_id: 'c1', p_approve: true, p_note: '' });
    expect(rpcCalls('training_to_review')).toHaveLength(2);
  });

  it('sends one back only with a note saying what to fix', async () => {
    await openReview('admin', [cert()]);
    await press('Send back');
    await press('Send back');
    expect(screen.getByText('Say what needs fixing, such as “The name is cut off”.')).toBeTruthy();
    expect(rpcCalls('review_training_certificate')).toEqual([]);
    await fireEvent.changeText(screen.getByPlaceholderText('The member sees this note'), 'The name is cut off');
    await press('Send back');
    expect(onlyRpcCall('review_training_certificate')).toEqual({
      p_certificate_id: 'c1',
      p_approve: false,
      p_note: 'The name is cut off',
    });
  });

  it('never lets anyone check their own or their child’s', async () => {
    await openReview('committee', [cert({ can_review: false })]);
    expect(screen.getByText('This is yours or your child’s, so another committee member or admin checks it.')).toBeTruthy();
    expect(screen.queryByText('Approve')).toBeNull();
    expect(screen.queryByText('Send back')).toBeNull();
  });

  it('shows the database’s refusal', async () => {
    await openReview('committee', [cert()], { review_training_certificate: 'Someone else has checked it' });
    await press('Approve');
    expect(screen.getByText('Someone else has checked it')).toBeTruthy();
  });

  it('says when nothing is waiting', async () => {
    await openReview('committee', []);
    expect(screen.getByText('✓ No certificates are waiting to be checked.')).toBeTruthy();
  });

  it.each<[string, Who]>([
    ['athlete', 'athlete'],
    ['coach', 'coach'],
    ['committee member whose check lapsed', 'committeeExpiredCheck'],
    ['stood-down admin', 'stoodDownAdmin'],
  ])('turns a %s away', async (_l, who) => {
    await openReview(who, [cert()]);
    expect(screen.getByText('Only the committee and admins check certificates.')).toBeTruthy();
    expect(screen.queryByText('Approve')).toBeNull();
    expect(rpcNames()).not.toContain('training_to_review');
  });
});

// ---------------------------------------------------------------------------
// Everyone's progress and one course

function requirement(extra: Partial<TrainingRequirement> = {}): TrainingRequirement {
  return {
    id: 'r1',
    season: 2026,
    name: 'Safeguarding in Sport',
    details: 'Sports Integrity Australia',
    course_url: null,
    due_on: '2027-03-31',
    roles: ['athlete', 'coach'],
    all_teams: true,
    archived: false,
    training_requirement_teams: [],
    ...extra,
  };
}

const COUNTS: TrainingCounts[] = [{ requirement_id: 'r1', required: 12, approved: 4, submitted: 2, outstanding: 6 }];

async function openProgress(who: Who, requirements: TrainingRequirement[]) {
  await openScreen(
    who,
    { 'training/progress': TrainingProgressScreen, 'training/requirement/[id]': placeholder('training/requirement/[id]') },
    '/training/progress',
    { teams: [TEAM], training_requirements: requirements },
    { rpcs: { training_overview: COUNTS } },
  );
}

describe('everyone’s progress', () => {
  it('shows the current season’s courses, who must do them and how many are done', async () => {
    await openProgress('committee', [
      requirement(),
      requirement({ id: 'r2', name: 'Junior course', all_teams: false, roles: ['athlete'], training_requirement_teams: [{ team_id: TEAM.id }, { team_id: 'gone' }], archived: true }),
      requirement({ id: 'r3', name: 'Last year', season: 2025 }),
    ]);
    expect(rpcCalls('training_overview')).toEqual([{ p_season: 2026 }]);
    expect(screen.getByText('Athletes and Coaches, all squads and teams')).toBeTruthy();
    expect(screen.getByText(`Due ${formatDateString('2027-03-31')} · 4 of 12 approved · 2 waiting to be checked`)).toBeTruthy();
    expect(screen.getByText('Junior course (archived)')).toBeTruthy();
    expect(screen.getByText(`Athletes in ${TEAM.name} and Archived group`)).toBeTruthy();
    expect(screen.queryByText('Last year')).toBeNull();
  });

  it('switches to another season', async () => {
    await openProgress('admin', [requirement(), requirement({ id: 'r3', name: 'Last year', season: 2025 })]);
    await press('2025–26');
    expect(screen.getByText('Last year')).toBeTruthy();
    expect(rpcCalls('training_overview')).toContainEqual({ p_season: 2025 });
  });

  it('opens one course', async () => {
    await openProgress('committee', [requirement()]);
    await press('Safeguarding in Sport');
    expect(screen).toHavePathname('/training/requirement/r1');
  });

  it('says when a season has no training yet', async () => {
    await openProgress('committee', []);
    expect(screen.getByText('No training set for 2026–27 yet.')).toBeTruthy();
  });

  it.each<[string, Who]>([
    ['athlete', 'athlete'],
    ['coach', 'coach'],
    ['guardian', 'guardian'],
    ['committee member whose check lapsed', 'committeeExpiredCheck'],
  ])('shows a %s nobody else’s training', async (_l, who) => {
    await openProgress(who, [requirement()]);
    expect(screen.getByText('Only the committee and admins see everyone’s training.')).toBeTruthy();
    expect(screen.queryByText('Safeguarding in Sport')).toBeNull();
  });
});

function member(extra: Partial<TrainingMember> = {}): TrainingMember {
  return {
    profile_id: 'm1',
    full_name: 'Amy Athlete',
    status: 'approved',
    completed_on: '2026-10-01',
    certificate_id: 'c1',
    document_path: 'm1/x/cert.pdf',
    document_name: 'cert.pdf',
    reviewed_by_name: 'Sample committee',
    reviewed_at: '2026-10-02T03:00:00Z',
    review_note: null,
    ...extra,
  };
}

const MEMBERS = [
  member(),
  member({ profile_id: 'm2', full_name: 'Ben Athlete', status: 'submitted', completed_on: '2026-10-10', reviewed_by_name: null, reviewed_at: null }),
  member({ profile_id: 'm3', full_name: 'Cat Athlete', status: 'sent_back', review_note: 'Blurry', completed_on: null }),
  member({ profile_id: 'm4', full_name: 'Dan Athlete', status: 'to_do', completed_on: null, document_path: null, certificate_id: null, reviewed_by_name: null, reviewed_at: null }),
];

async function openRequirement(who: Who) {
  await openScreen(
    who,
    { 'training/requirement/[id]': TrainingRequirementScreen, 'training/document': placeholder('training/document'), 'admin/training/edit': placeholder('admin/training/edit') },
    '/training/requirement/r1',
    { training_requirements: [requirement()] },
    { rpcs: { training_requirement_members: MEMBERS } },
  );
}

const names = () => screen.queryAllByText(/^(Amy|Ben|Cat|Dan) Athlete$/).map((n) => n.props.children);

describe('one course’s members', () => {
  it('lists everyone who must complete it, with how many are approved', async () => {
    await openRequirement('committee');
    expect(rpcCalls('training_requirement_members')).toEqual([{ p_requirement_id: 'r1' }]);
    expect(screen.getByText(`Due ${formatDateString('2027-03-31')} · 1 of 4 approved`)).toBeTruthy();
    expect(names()).toEqual(['Amy Athlete', 'Ben Athlete', 'Cat Athlete', 'Dan Athlete']);
    expect(screen.getByText('Sent back: Blurry')).toBeTruthy();
    // The filter, and Ben's row.
    expect(screen.getAllByText('Waiting')).toHaveLength(2);
    // Sent-back and missing certificates have nothing to open.
    expect(screen.getAllByLabelText(/’s certificate$/)).toHaveLength(2);
  });

  it.each([
    ['Still to do', ['Cat Athlete', 'Dan Athlete']],
    ['Waiting', ['Ben Athlete']],
    ['Approved', ['Amy Athlete']],
  ])('filters to %s', async (filter, shown) => {
    await openRequirement('committee');
    await press(filter);
    expect(names()).toEqual(shown);
  });

  it('opens a member’s certificate', async () => {
    await openRequirement('committee');
    await fireEvent.press(screen.getByLabelText('Amy Athlete’s certificate'));
    await settle();
    expect(screen).toHaveSearchParams({ path: 'm1/x/cert.pdf', name: 'cert.pdf' });
  });

  it('exports the list as a CSV', async () => {
    await openRequirement('committee');
    await press('Export CSV');
    expect(shareCsv).toHaveBeenCalledTimes(1);
    const [fileName, csv] = (shareCsv as jest.Mock).mock.calls[0] as [string, string];
    expect(fileName).toBe('Safeguarding in Sport 2026.csv');
    const lines = csv.split(/\r?\n/).filter(Boolean);
    expect(lines[0]).toBe('"Name","Status","Completed on","Checked by","Checked on"');
    expect(lines[1]).toBe('"Amy Athlete","Approved","2026-10-01","Sample committee","2026-10-02"');
    expect(lines[3]).toBe('"Cat Athlete","Sent back","","Sample committee","2026-10-02"');
    expect(lines).toHaveLength(5);
  });

  it('says when the export failed', async () => {
    await openRequirement('committee');
    (shareCsv as jest.Mock).mockRejectedValueOnce(new Error('no'));
    await press('Export CSV');
    expect(screen.getByText('The list couldn’t be exported. Try again.')).toBeTruthy();
  });

  it('gives the committee no way to change the course', async () => {
    await openRequirement('committee');
    expect(screen.queryByText('Change')).toBeNull();
  });

  it('lets an admin change the course', async () => {
    await openRequirement('admin');
    await press('Change');
    expect(screen.getByText('screen:admin/training/edit')).toBeTruthy();
    expect(screen).toHaveSearchParams({ id: 'r1' });
  });
});
