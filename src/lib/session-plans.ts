import * as Crypto from 'expo-crypto';
import type { DocumentPickerAsset } from 'expo-document-picker';
import { File } from 'expo-file-system';
import type { ImagePickerAsset } from 'expo-image-picker';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Platform } from 'react-native';

import { formatTime } from '@/lib/clock';
import { useAuth } from '@/lib/auth';
import { useFeature } from '@/lib/club';
import { MAX_DOCUMENT_BYTES } from '@/lib/injuries';
import { supabase } from '@/lib/supabase';
import type { Team } from '@/lib/types';

export const SESSION_PLAN_BUCKET = 'session-plans';

/** Photos and files a plan can have. */
export const MAX_PLAN_FILES = 5;

const WORD_TYPES = [
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

/** What the file picker offers: PDFs, Word documents and photos. */
export const PLAN_FILE_TYPES = [
  'application/pdf',
  ...WORD_TYPES,
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
];

/** A session plan as stored. */
export type SessionPlan = {
  id: string;
  team_id: string | null;
  team_name: string;
  title: string;
  session_on: string;
  /** "18:00:00", or null when no time was given. */
  starts_at: string | null;
  ends_at: string | null;
  location: string | null;
  notes: string | null;
  run_by: string | null;
  share_team_coaches: boolean;
  share_athletes: boolean;
  author_id: string;
  author_name: string;
  /** Head coach, Assistant coach, Coach or Admin, when the plan was added. */
  author_position: string;
  copied_from: string | null;
  created_at: string;
  edited_at: string | null;
  edited_by_name: string | null;
};

export const PLAN_COLUMNS =
  'id, team_id, team_name, title, session_on, starts_at, ends_at, location, notes, run_by, share_team_coaches, share_athletes, author_id, author_name, author_position, copied_from, created_at, edited_at, edited_by_name';

export type SessionPlanFile = {
  id: string;
  plan_id: string;
  path: string;
  name: string;
  content_type: string;
  size_bytes: number | null;
  added_by_name: string | null;
  created_at: string;
};

/** A row in either list on the Session plans screen. */
export type SessionPlanRow = Pick<
  SessionPlan,
  'id' | 'team_id' | 'team_name' | 'title' | 'session_on' | 'starts_at' | 'ends_at' | 'author_name' | 'author_position'
> & { file_count: number; is_new?: boolean };

/** A coach of a current squad or team, to share a plan with by name. */
export type PlanCoach = {
  profile_id: string;
  full_name: string;
  groups: string;
  team_ids: string[];
};

/** A photo or file chosen but not yet uploaded. */
export type PlanAttachment = {
  uri: string;
  name: string;
  mimeType: string;
  size: number | null;
  /** Web only. */
  file?: Blob;
};

/**
 * Whether the member can add plans and how many plans shared with them they
 * haven't opened. Refreshed when the screen is shown.
 */
export function useSessionPlanSummary() {
  const { profile } = useAuth();
  const on = useFeature('sessionPlans') && profile?.status === 'approved';
  const [summary, setSummary] = useState({ canAdd: false, shared: 0, newShared: 0 });

  const load = useCallback(async () => {
    if (!on) return;
    const { data } = await supabase.rpc('session_plan_summary');
    const row = (data as { can_add: boolean; shared: number; new_shared: number }[] | null)?.[0];
    setSummary({
      canAdd: !!row?.can_add,
      shared: row?.shared ?? 0,
      newShared: row?.new_shared ?? 0,
    });
  }, [on]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return { ...(on ? summary : { canAdd: false, shared: 0, newShared: 0 }), reloadSummary: load };
}

/**
 * The squads and teams the member can add plans for: the ones they coach, or
 * every current one for admins.
 */
export function usePlanGroups(teams: Team[]) {
  const { memberships, isAdmin, profile } = useAuth();
  if (profile?.status !== 'approved') return [];
  if (isAdmin) return teams;
  const coached = new Set(
    memberships.filter((m) => m.team_role === 'coach').map((m) => m.team.id),
  );
  return teams.filter((t) => coached.has(t.id));
}

export { formatTime, parseTime, timeOf } from '@/lib/clock';

/** Such as "6:00 pm – 7:30 pm", or an empty string with no times. */
export function formatTimes(start: string | null, end: string | null) {
  if (!start) return '';
  return end ? `${formatTime(start)} – ${formatTime(end)}` : formatTime(start);
}

export function isImageFile(contentType: string) {
  return contentType.startsWith('image/');
}

export function isWordFile(contentType: string) {
  return WORD_TYPES.includes(contentType);
}

/** A photo from the camera roll or camera, ready to upload. */
export function attachmentFromPhoto(asset: ImagePickerAsset): PlanAttachment {
  const mimeType = asset.mimeType ?? 'image/jpeg';
  const extension = mimeType === 'image/png' ? 'png' : mimeType.startsWith('image/hei') ? 'heic' : 'jpg';
  return {
    uri: asset.uri,
    name: asset.fileName || `photo-${Date.now()}.${extension}`,
    mimeType,
    size: asset.fileSize ?? null,
    file: asset.file,
  };
}

/** A file from the file picker, ready to upload. */
export function attachmentFromDocument(asset: DocumentPickerAsset): PlanAttachment {
  return {
    uri: asset.uri,
    name: asset.name,
    mimeType: asset.mimeType ?? guessType(asset.name),
    size: asset.size ?? null,
    file: asset.file,
  };
}

function guessType(name: string) {
  const extension = name.split('.').pop()?.toLowerCase();
  switch (extension) {
    case 'pdf':
      return 'application/pdf';
    case 'doc':
      return 'application/msword';
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'png':
      return 'image/png';
    case 'heic':
      return 'image/heic';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    default:
      return 'application/octet-stream';
  }
}

/** Why a chosen file can't be attached, or null when it can. */
export function attachmentProblem(attachment: PlanAttachment) {
  if (attachment.size && attachment.size > MAX_DOCUMENT_BYTES) {
    return `${attachment.name} is over 10 MB. Try a smaller photo or file.`;
  }
  if (!PLAN_FILE_TYPES.includes(attachment.mimeType)) {
    return `${attachment.name} can’t be attached. Attach a photo, a PDF or a Word document.`;
  }
  return null;
}

/** Uploads a photo or file into the plan's folder and records it. */
export async function uploadPlanFile(planId: string, attachment: PlanAttachment) {
  const problem = attachmentProblem(attachment);
  if (problem) throw new Error(problem);
  const body =
    Platform.OS === 'web' && attachment.file
      ? attachment.file
      : await new File(attachment.uri).arrayBuffer();
  const path = `${planId}/${Crypto.randomUUID()}/${safeFileName(attachment.name)}`;
  const { error } = await supabase.storage.from(SESSION_PLAN_BUCKET).upload(path, body, {
    contentType: attachment.mimeType,
    upsert: false,
  });
  if (error) throw new Error(`${attachment.name} didn’t upload: ${error.message}`);
  const { error: recordError } = await supabase.rpc('add_session_plan_file', {
    p_plan_id: planId,
    p_path: path,
    p_name: attachment.name,
    p_content_type: attachment.mimeType,
  });
  if (recordError) {
    // Don't leave a file nobody can see in the list.
    await supabase.storage.from(SESSION_PLAN_BUCKET).remove([path]);
    throw new Error(recordError.message);
  }
}

/**
 * Copies a file from another plan into this one, for "Use again". Downloads
 * and uploads again, so the copy is in the new plan's folder.
 */
export async function copyPlanFile(planId: string, file: SessionPlanFile) {
  const { data, error } = await supabase.storage.from(SESSION_PLAN_BUCKET).download(file.path);
  if (error || !data) throw new Error(`${file.name} couldn’t be copied. Attach it again.`);
  const path = `${planId}/${Crypto.randomUUID()}/${safeFileName(file.name)}`;
  const { error: uploadError } = await supabase.storage
    .from(SESSION_PLAN_BUCKET)
    .upload(path, await data.arrayBuffer(), { contentType: file.content_type, upsert: false });
  if (uploadError) throw new Error(`${file.name} couldn’t be copied: ${uploadError.message}`);
  const { error: recordError } = await supabase.rpc('add_session_plan_file', {
    p_plan_id: planId,
    p_path: path,
    p_name: file.name,
    p_content_type: file.content_type,
  });
  if (recordError) {
    await supabase.storage.from(SESSION_PLAN_BUCKET).remove([path]);
    throw new Error(recordError.message);
  }
}

/** Removes a file from storage, then its record. */
export async function removePlanFile(file: SessionPlanFile) {
  const { error } = await supabase.storage.from(SESSION_PLAN_BUCKET).remove([file.path]);
  if (error) throw new Error(`${file.name} wasn’t removed. Try again.`);
  const { error: recordError } = await supabase.rpc('remove_session_plan_file', {
    p_file_id: file.id,
  });
  if (recordError) throw new Error(recordError.message);
}

/** For admins: removes every file of a plan, then the plan. */
export async function deletePlan(planId: string, files: SessionPlanFile[]) {
  if (files.length > 0) {
    const { error } = await supabase.storage
      .from(SESSION_PLAN_BUCKET)
      .remove(files.map((f) => f.path));
    if (error) throw new Error('The plan’s files weren’t removed. Try again.');
  }
  const { error } = await supabase.rpc('admin_delete_session_plan', { p_plan_id: planId });
  if (error) throw new Error(error.message);
}

/** A five-minute link to a plan's file. */
export async function planFileUrl(path: string) {
  const { data, error } = await supabase.storage
    .from(SESSION_PLAN_BUCKET)
    .createSignedUrl(path, 300);
  if (error || !data) throw new Error('That file couldn’t be opened. Try again.');
  return data.signedUrl;
}

function safeFileName(name: string) {
  return name.replace(/[^\w.\- ]+/g, '_').slice(-100) || 'file';
}
