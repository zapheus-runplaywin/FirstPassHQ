import type { DocumentPickerAsset } from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useFocusEffect } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { useCallback, useState } from 'react';
import { Platform } from 'react-native';

import { useAuth } from '@/lib/auth';
import { useFeature } from '@/lib/club';
import { DOCUMENT_TYPES, formatDateString, MAX_DOCUMENT_BYTES, toDateString } from '@/lib/injuries';
import { hasRole } from '@/lib/roles';
import { supabase } from '@/lib/supabase';
import type { AppRole } from '@/lib/types';

export const TRAINING_BUCKET = 'training-certificates';

/** Where a member is up to with one piece of training. */
export type TrainingStatus = 'to_do' | 'submitted' | 'approved' | 'sent_back';

/** Training an admin has set for a club year. */
export type TrainingRequirement = {
  id: string;
  season: number;
  name: string;
  details: string | null;
  course_url: string | null;
  due_on: string;
  roles: AppRole[];
  all_teams: boolean;
  archived: boolean;
  training_requirement_teams: { team_id: string }[];
};

export const REQUIREMENT_COLUMNS =
  'id, season, name, details, course_url, due_on, roles, all_teams, archived, training_requirement_teams (team_id)';

/** A row from `my_training`: one piece of training for the member or their child. */
export type MyTraining = {
  requirement_id: string;
  season: number;
  name: string;
  details: string | null;
  course_url: string | null;
  due_on: string;
  profile_id: string;
  profile_name: string | null;
  is_me: boolean;
  status: TrainingStatus;
  certificate_id: string | null;
  completed_on: string | null;
  document_path: string | null;
  document_name: string | null;
  review_note: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
};

/** A row from `training_to_review`: a certificate waiting for the committee. */
export type CertificateToReview = {
  certificate_id: string;
  requirement_id: string;
  requirement_name: string;
  due_on: string;
  profile_id: string;
  profile_name: string | null;
  submitted_by_name: string | null;
  completed_on: string;
  notes: string | null;
  document_path: string;
  document_name: string | null;
  created_at: string;
  /** False for the reviewer's own certificate or their own child's. */
  can_review: boolean;
};

/** A row from `training_overview`. */
export type TrainingCounts = {
  requirement_id: string;
  required: number;
  approved: number;
  submitted: number;
  outstanding: number;
};

/** A row from `training_requirement_members`. */
export type TrainingMember = {
  profile_id: string;
  full_name: string | null;
  status: TrainingStatus;
  completed_on: string | null;
  certificate_id: string | null;
  document_path: string | null;
  document_name: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  review_note: string | null;
};

export const trainingStatusLabels: Record<TrainingStatus, string> = {
  to_do: 'To do',
  submitted: 'Waiting to be checked',
  approved: '✓ Approved',
  sent_back: 'Sent back',
};

/** Roles an admin can ask to complete training. Guests can't be. */
export const trainingRoleOptions: { value: AppRole; label: string }[] = [
  { value: 'athlete', label: 'Athletes' },
  { value: 'coach', label: 'Coaches' },
  { value: 'manager', label: 'Managers' },
  { value: 'physio', label: 'Physios' },
  { value: 'committee', label: 'Committee' },
  { value: 'admin', label: 'Admins' },
  { value: 'guardian', label: 'Guardians' },
];

/** Committee members and admins check certificates and see everyone's progress. */
export function useCanCheckTraining() {
  const { profile } = useAuth();
  return profile?.status === 'approved' && hasRole(profile, 'committee', 'admin');
}

/**
 * The member's training and their children's, refreshed when the screen is
 * shown. Null until it has loaded.
 */
export function useMyTraining() {
  const { profile } = useAuth();
  const on = useFeature('integrity') && profile?.status === 'approved';
  const [training, setTraining] = useState<MyTraining[] | null>(null);

  const load = useCallback(async () => {
    if (!on) return;
    const { data } = await supabase.rpc('my_training');
    setTraining((data as MyTraining[] | null) ?? []);
  }, [on]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return { myTraining: on ? training : [], reloadMyTraining: load };
}

/** Certificates waiting for the committee, refreshed when the screen is shown. */
export function useTrainingToReview() {
  const canCheck = useCanCheckTraining();
  const on = useFeature('integrity') && canCheck;
  const [rows, setRows] = useState<CertificateToReview[] | null>(null);

  const load = useCallback(async () => {
    if (!on) return;
    const { data } = await supabase.rpc('training_to_review');
    setRows((data as CertificateToReview[] | null) ?? []);
  }, [on]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return { toReview: on ? rows : [], reloadToReview: load };
}

/** Training that still needs a certificate: never started, or sent back. */
export function isOutstanding(row: Pick<MyTraining, 'status'>) {
  return row.status === 'to_do' || row.status === 'sent_back';
}

/** "Due Fri 31 Mar 2027", or "Overdue since …" once the day has passed. */
export function dueLabel(dueOn: string, today = new Date()) {
  return dueOn < toDateString(today)
    ? `Overdue since ${formatDateString(dueOn)}`
    : `Due ${formatDateString(dueOn)}`;
}

/** Such as "Athletes and Coaches", or "Athletes and Coaches in 17 & Under Squad". */
export function audienceLabel(roles: AppRole[], groupNames: string[] | null) {
  const names = trainingRoleOptions.filter((o) => roles.includes(o.value)).map((o) => o.label);
  const who = joinNames(names) || 'Nobody';
  if (groupNames === null) return `${who}, all squads and teams`;
  if (groupNames.length === 0) return `${who} · no squads or teams chosen`;
  return `${who} in ${joinNames(groupNames)}`;
}

function joinNames(names: string[]) {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** The club year the newest current squads and teams belong to, or this year's. */
export function currentSeason(seasons: number[], today = new Date()) {
  if (seasons.length > 0) return Math.max(...seasons);
  // The club year starts in May.
  return today.getMonth() >= 4 ? today.getFullYear() : today.getFullYear() - 1;
}

// ---------------------------------------------------------------------------
// Certificate files
// ---------------------------------------------------------------------------

/** Uploads a picked certificate for a member and returns its storage path. */
export async function uploadCertificate(profileId: string, asset: DocumentPickerAsset) {
  if (asset.size && asset.size > MAX_DOCUMENT_BYTES) {
    throw new Error('That file is over 10 MB. Try a smaller photo or a PDF.');
  }
  const contentType = asset.mimeType ?? 'application/octet-stream';
  if (!DOCUMENT_TYPES.includes(contentType)) {
    throw new Error('Attach a PDF or a photo (JPEG, PNG or HEIC).');
  }
  const body =
    Platform.OS === 'web' && asset.file ? asset.file : await new File(asset.uri).arrayBuffer();
  const path = `${profileId}/${Crypto.randomUUID()}/${safeFileName(asset.name)}`;
  const { error } = await supabase.storage.from(TRAINING_BUCKET).upload(path, body, {
    contentType,
    upsert: false,
  });
  if (error) throw new Error(`The file didn’t upload: ${error.message}`);
  return path;
}

/** A two-minute link to show a certificate inside the app. */
export async function viewCertificateUrl(path: string) {
  const { data, error } = await supabase.storage.from(TRAINING_BUCKET).createSignedUrl(path, 120);
  if (error || !data) throw new Error('That certificate couldn’t be opened. Try again.');
  return data.signedUrl;
}

function safeFileName(name: string) {
  return name.replace(/[^\w.\- ]+/g, '_').slice(-100) || 'file';
}

/**
 * Every season's training with each requirement's progress counts for the
 * chosen season. For the committee and admins.
 */
export function useTrainingRequirements(season: number | null) {
  const [requirements, setRequirements] = useState<TrainingRequirement[] | null>(null);
  const [counts, setCounts] = useState<TrainingCounts[]>([]);

  const load = useCallback(async () => {
    const [{ data }, overview] = await Promise.all([
      supabase
        .from('training_requirements')
        .select(REQUIREMENT_COLUMNS)
        .order('season', { ascending: false })
        .order('due_on')
        .order('name'),
      season === null
        ? Promise.resolve({ data: [] })
        : supabase.rpc('training_overview', { p_season: season }),
    ]);
    setRequirements((data as TrainingRequirement[] | null) ?? []);
    setCounts((overview.data as TrainingCounts[] | null) ?? []);
  }, [season]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return { requirements, counts, reload: load };
}

/** "4 of 12 approved · 2 waiting to be checked" */
export function countsLabel(counts: TrainingCounts | undefined) {
  if (!counts || counts.required === 0) return 'Nobody has to complete it yet';
  const parts = [`${counts.approved} of ${counts.required} approved`];
  if (counts.submitted > 0) parts.push(`${counts.submitted} waiting to be checked`);
  return parts.join(' · ');
}

/**
 * Whether the club has set any training that isn't archived, so the committee's
 * home card only shows once there is something to follow.
 */
export function useClubHasTraining() {
  const canCheck = useCanCheckTraining();
  const on = useFeature('integrity') && canCheck;
  const [has, setHas] = useState(false);

  const load = useCallback(async () => {
    if (!on) return;
    const { count } = await supabase
      .from('training_requirements')
      .select('id', { count: 'exact', head: true })
      .eq('archived', false);
    setHas((count ?? 0) > 0);
  }, [on]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return { clubHasTraining: on && has, reloadClubHasTraining: load };
}
