import type { DocumentPickerAsset } from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import { useFocusEffect } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useCallback, useState } from 'react';
import { Platform } from 'react-native';

import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import type { Injury, InjuryStatus, InjuryUpdateKind } from '@/lib/types';

export const INJURY_BUCKET = 'injury-documents';

/** File types the injury-documents bucket accepts. */
export const DOCUMENT_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
];

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

export const injuryStatusLabels: Record<InjuryStatus, string> = {
  injured: 'Injured',
  clearance_requested: 'Waiting for a coach or physio',
  coach_endorsed: 'Waiting for the committee',
  cleared: 'Cleared to play',
};

export const injuryUpdateLabels: Record<InjuryUpdateKind, string> = {
  reported: 'Reported the injury',
  physio_update: 'Physio update',
  clearance_requested: 'Asked for clearance',
  coach_endorsed: 'Endorsed',
  sent_back: 'Sent back',
  cleared: 'Cleared to play',
};

/**
 * Athletes, guardians, coaches, the committee and admins have an injuries
 * screen. The database decides which injuries each of them sees.
 */
export function useCanSeeInjuries() {
  const { profile, memberships } = useAuth();
  if (profile?.status !== 'approved') return false;
  return (
    ['athlete', 'guardian', 'committee', 'physio', 'admin'].includes(profile.role) ||
    memberships.some((m) => m.team_role === 'coach')
  );
}

/** Open injuries the member can see, refreshed when the screen is shown. */
export function useOpenInjuries() {
  const canSee = useCanSeeInjuries();
  const [injuries, setInjuries] = useState<Injury[]>([]);

  const load = useCallback(async () => {
    if (!canSee) return;
    const { data } = await supabase.rpc('visible_injuries');
    setInjuries((data as Injury[] | null) ?? []);
  }, [canSee]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return { openInjuries: injuries, reloadInjuries: load };
}

/** A summary for the home card, such as "2 injured · 1 waiting for you". */
export function injuriesSummary(injuries: Injury[]) {
  const waiting = injuries.filter((i) => i.waiting_for_me).length;
  const parts = [
    injuries.length === 0
      ? 'No current injuries'
      : `${injuries.length} current ${injuries.length === 1 ? 'injury' : 'injuries'}`,
  ];
  if (waiting > 0) parts.push(`${waiting} waiting for you`);
  return parts.join(' · ');
}

// ---------------------------------------------------------------------------
// Dates. Injury dates are calendar days ("2026-10-07"), not moments in time.
// ---------------------------------------------------------------------------

const dayFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** Quick choices for when an athlete expects to be back. */
export const returnQuickPicks = [
  { label: 'In 1 week', days: 7 },
  { label: '2 weeks', days: 14 },
  { label: '4 weeks', days: 28 },
  { label: '6 weeks', days: 42 },
];

export function toDateString(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseDateString(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/** Such as "Tue 7 Oct 2026". */
export function formatDateString(value: string) {
  return dayFormat.format(parseDateString(value));
}

// ---------------------------------------------------------------------------
// Proof documents
// ---------------------------------------------------------------------------

/** Uploads a picked file for an injury and returns its storage path. */
export async function uploadInjuryDocument(
  injury: Pick<Injury, 'id' | 'athlete_id'>,
  asset: DocumentPickerAsset,
) {
  if (asset.size && asset.size > MAX_DOCUMENT_BYTES) {
    throw new Error('That file is over 10 MB. Try a smaller photo or a PDF.');
  }
  const contentType = asset.mimeType ?? 'application/octet-stream';
  if (!DOCUMENT_TYPES.includes(contentType)) {
    throw new Error('Attach a PDF or a photo (JPEG, PNG or HEIC).');
  }
  const body =
    Platform.OS === 'web' && asset.file ? asset.file : await new File(asset.uri).arrayBuffer();
  const path = `${injury.athlete_id}/${injury.id}/${Date.now()}-${safeFileName(asset.name)}`;
  const { error } = await supabase.storage.from(INJURY_BUCKET).upload(path, body, {
    contentType,
    upsert: false,
  });
  if (error) throw new Error(`The file didn’t upload: ${error.message}`);
  return path;
}

/**
 * Opens the share sheet for a proof document, so it can be saved to OneDrive,
 * Files or email. On the web it opens in a new tab instead.
 */
export async function shareInjuryDocument(path: string, name: string | null) {
  const { data, error } = await supabase.storage.from(INJURY_BUCKET).createSignedUrl(path, 60);
  if (error || !data) throw new Error('That document couldn’t be opened. Try again.');
  if (Platform.OS === 'web') {
    window.open(data.signedUrl, '_blank', 'noopener');
    return;
  }
  const destination = new File(Paths.cache, safeFileName(name ?? path.split('/').pop() ?? 'file'));
  const file = await File.downloadFileAsync(data.signedUrl, destination, { idempotent: true });
  await Sharing.shareAsync(file.uri, { dialogTitle: name ?? 'Injury document' });
}

/** Opens the share sheet for a CSV file. On the web it downloads instead. */
export async function shareCsv(fileName: string, csv: string) {
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
    return;
  }
  const file = new File(Paths.cache, fileName);
  file.write(csv);
  await Sharing.shareAsync(file.uri, {
    mimeType: 'text/csv',
    UTI: 'public.comma-separated-values-text',
    dialogTitle: fileName,
  });
}

/**
 * Builds CSV text, quoting every value so commas and line breaks are safe.
 * Text that a spreadsheet would run as a formula is prefixed with '.
 */
export function toCsv(rows: (string | number | null)[][]) {
  const cell = (value: string | number | null) => {
    let text = String(value ?? '');
    if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  return rows.map((row) => row.map(cell).join(',')).join('\r\n');
}

function safeFileName(name: string) {
  return name.replace(/[^\w.\- ]+/g, '_').slice(-100) || 'file';
}
