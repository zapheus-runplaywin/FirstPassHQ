import type { DocumentPickerAsset } from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import { useFocusEffect } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useCallback, useState } from 'react';
import { Platform } from 'react-native';

import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import type {
  Injury,
  InjuryLoggerRole,
  InjuryStatus,
  InjuryUpdate,
  InjuryUpdateKind,
} from '@/lib/types';
import { hasRole } from '@/lib/roles';

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
  const { profile, memberships, committeeSeesInjuries } = useAuth();
  if (profile?.status !== 'approved') return false;
  return (
    hasRole(profile, 'athlete', 'guardian', 'physio', 'admin') ||
    // A club can choose which committee members see injuries.
    (hasRole(profile, 'committee') && committeeSeesInjuries) ||
    memberships.some((m) => m.team_role === 'coach')
  );
}

/**
 * Coaches, managers and physios of a squad or team, and every physio, can log
 * an injury for one of their athletes at the time it happens. The database
 * decides which athletes (`injury_loggable_athletes`).
 */
export function useCanLogInjuries() {
  const { profile, memberships } = useAuth();
  if (profile?.status !== 'approved') return false;
  return (
    hasRole(profile, 'physio') ||
    memberships.some((m) => m.team_role === 'coach' || m.team_role === 'manager' || m.team_role === 'physio')
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

/** An injury a coach, manager or physio logged that the family hasn't opened yet. */
export type LoggedInjury = {
  injury_id: string;
  athlete_id: string;
  athlete_name: string | null;
  body_area: string;
  logged_by_name: string | null;
  logged_by_role: InjuryLoggerRole;
  logged_at: string;
};

/** For athletes and guardians: injuries logged for them that they haven't opened. */
export function useLoggedInjuries() {
  const { profile } = useAuth();
  const reports = profile?.status === 'approved' && hasRole(profile, 'athlete', 'guardian');
  const [logged, setLogged] = useState<LoggedInjury[]>([]);

  const load = useCallback(async () => {
    if (!reports) return;
    const { data } = await supabase.rpc('my_logged_injuries');
    setLogged((data as LoggedInjury[] | null) ?? []);
  }, [reports]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return { loggedInjuries: logged, reloadLoggedInjuries: load };
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

const loggerLabels: Record<InjuryLoggerRole, string> = {
  coach: 'coach',
  manager: 'manager',
  physio: 'physio',
};

/** Who wrote an update, such as "Finley Physio (physio)". */
export function injuryAuthor(update: Pick<InjuryUpdate, 'author_name' | 'author_role'>) {
  const name = update.author_name ?? 'Former member';
  return update.author_role ? `${name} (${loggerLabels[update.author_role]})` : name;
}

/** The heading of an update in the history. */
export function injuryUpdateTitle(update: Pick<InjuryUpdate, 'kind' | 'concussion' | 'author_role'>) {
  if (update.kind === 'reported' && update.author_role) return 'Logged the injury';
  if (update.kind === 'physio_update' && update.concussion === true) {
    return 'Marked as a possible concussion';
  }
  if (update.kind === 'physio_update' && update.concussion === false) {
    return 'Concussion ruled out';
  }
  return injuryUpdateLabels[update.kind];
}

/**
 * Whether clearance can be asked for today. After a suspected concussion it
 * can't before the club's minimum days (`earliest_clearance`).
 */
export function clearanceOpen(injury: Pick<Injury, 'earliest_clearance'>, today: Date) {
  return !injury.earliest_clearance || injury.earliest_clearance <= toDateString(today);
}

/** What the concussion rules are, in the words the screens use. */
export function concussionRules(minDays: number) {
  return `After a concussion, clearance can’t be asked for until ${minDays} days after it happened, needs a doctor’s clearance, and only a physio can endorse it.`;
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

/**
 * What the signed-in member can attach for an athlete: 'photos' (adults: a
 * PDF or any photo), 'letter' (under 18s: a PDF, or a photo confirmed to show
 * the letter or report) or 'consent' (as 'letter', and a verified guardian
 * may also add a photo of their child's injury once they confirm consent).
 */
export type DocumentRule = 'photos' | 'letter' | 'consent';

/** What someone adding a photo for an athlete under 18 says it shows. */
export type PhotoShows = 'letter' | 'injury';

/** Uploads a picked file for an injury and returns its storage path. */
export async function uploadInjuryDocument(
  injury: Pick<Injury, 'id' | 'athlete_id'>,
  asset: DocumentPickerAsset,
  rule: DocumentRule,
  /** What the photo shows, once confirmed; null when it hasn't been. */
  photoShows: PhotoShows | null,
) {
  if (asset.size && asset.size > MAX_DOCUMENT_BYTES) {
    throw new Error('That file is over 10 MB. Try a smaller photo or a PDF.');
  }
  const contentType = asset.mimeType ?? 'application/octet-stream';
  if (!DOCUMENT_TYPES.includes(contentType)) {
    throw new Error('Attach a PDF or a photo (JPEG, PNG or HEIC).');
  }
  const photo = contentType !== 'application/pdf';
  const declare = photo && rule !== 'photos';
  if (declare && !photoShows) {
    throw new Error('Confirm what the photo shows before sending it.');
  }
  if (declare && photoShows === 'injury' && rule !== 'consent') {
    throw new Error('Attach a photo of the letter or report, not of the injury.');
  }
  const body =
    Platform.OS === 'web' && asset.file ? asset.file : await new File(asset.uri).arrayBuffer();
  const path = `${injury.athlete_id}/${injury.id}/${Date.now()}-${safeFileName(asset.name, contentType)}`;
  if (declare) {
    // What it shows is recorded with the photo's path before it uploads.
    const { error: declareError } = await supabase.rpc('confirm_injury_photo', {
      p_path: path,
      p_kind: photoShows,
    });
    if (declareError) throw new Error(declareError.message);
  }
  const { error } = await supabase.storage.from(INJURY_BUCKET).upload(path, body, {
    contentType,
    upsert: false,
  });
  if (error) throw new Error(`The file didn’t upload: ${error.message}`);
  return path;
}

/** Photos open in the zoomable image viewer; everything else is a PDF. */
export function isImageDocument(path: string) {
  return /\.(jpe?g|png|heic|heif)$/i.test(path);
}

/**
 * A link to show a document inside the app. It stops working after two
 * minutes, so it's no use if copied out of the app. Each open is recorded
 * first, for the athlete, their guardians and admins to see.
 */
export async function viewInjuryDocumentUrl(path: string) {
  const { error: logError } = await supabase.rpc('open_injury_document', { p_path: path });
  if (logError) throw new Error('That document couldn’t be opened. Try again.');
  const { data, error } = await supabase.storage.from(INJURY_BUCKET).createSignedUrl(path, 120);
  if (error || !data) throw new Error('That document couldn’t be opened. Try again.');
  return data.signedUrl;
}

/**
 * Opens the share sheet for a proof document, so it can be saved to OneDrive,
 * Files or email. On the web it opens in a new tab instead. Only the
 * committee member or admin accepting the clearance is offered this, while
 * it's waiting for them; the share is recorded for the athlete, their
 * guardians and admins to see. Everyone else views documents in the app.
 */
export async function shareInjuryDocument(path: string, name: string | null) {
  const { error: logError } = await supabase.rpc('open_injury_document', {
    p_path: path,
    p_share: true,
  });
  if (logError) throw new Error(logError.message);
  const { data, error } = await supabase.storage.from(INJURY_BUCKET).createSignedUrl(path, 60);
  if (error || !data) throw new Error('That document couldn’t be opened. Try again.');
  if (Platform.OS === 'web') {
    window.open(data.signedUrl, '_blank', 'noopener');
    return;
  }
  const destination = new File(Paths.cache, safeFileName(name ?? path.split('/').pop() ?? 'file'));
  const file = await File.downloadFileAsync(data.signedUrl, destination, { idempotent: true });
  try {
    await Sharing.shareAsync(file.uri, { dialogTitle: name ?? 'Injury document' });
  } finally {
    // The copy made for the share sheet isn't left in the app's cache.
    try {
      file.delete();
    } catch {}
  }
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

/**
 * A file name safe for storage. When the content type is known, a PDF always
 * ends in .pdf and a photo never does, so the name matches what's inside.
 */
function safeFileName(name: string, contentType?: string) {
  let safe = name.replace(/[^\w.\- ]+/g, '_').slice(-100) || 'file';
  const pdf = /\.pdf$/i.test(safe);
  if (contentType === 'application/pdf' && !pdf) safe = `${safe.slice(0, 96)}.pdf`;
  if (contentType && contentType !== 'application/pdf' && pdf) safe = safe.replace(/\.pdf$/i, '.jpg');
  return safe;
}
