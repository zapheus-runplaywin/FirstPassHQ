import type { DocumentPickerAsset } from 'expo-document-picker';
import { File } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';

import { DOCUMENT_TYPES, MAX_DOCUMENT_BYTES } from '@/lib/injuries';
import { supabase } from '@/lib/supabase';
import type { WwccApplication, WwccApplicationKind } from '@/lib/types';

/**
 * Lodged Working With Children Check applications. In WA, someone who has
 * applied, new or a renewal, can do child-related work while it's being
 * assessed, with the receipt. An admin records it with the receipt, the
 * member accepts a declaration, and it counts as a check until the card
 * arrives (`20261023100000_wwcc_applications.sql`).
 */
export const WWCC_RECEIPT_BUCKET = 'wwcc-receipts';

/** Days an application counts after an admin last confirmed it. */
export const APPLICATION_LAPSE_DAYS = 90;
/** How often an admin confirms it's still being assessed. */
export const APPLICATION_CHECK_DAYS = 30;

export const applicationKindLabels: Record<WwccApplicationKind, string> = {
  new: 'New check',
  renewal: 'Renewal',
};

/**
 * The Screening Unit's online services, where anyone can check whether an
 * application is still pending with its number and the family name.
 */
export const APPLICATION_STATUS_URL = 'https://workingwithchildren.wa.gov.au/online-services';

/** Uploads a receipt into the member's folder and returns its path. */
export async function uploadReceipt(profileId: string, asset: DocumentPickerAsset) {
  if (asset.size && asset.size > MAX_DOCUMENT_BYTES) {
    throw new Error('That file is over 10 MB. Try a smaller photo or a PDF.');
  }
  const contentType = asset.mimeType ?? 'application/octet-stream';
  if (!DOCUMENT_TYPES.includes(contentType)) {
    throw new Error('Attach a PDF or a photo (JPEG, PNG or HEIC).');
  }
  const body =
    Platform.OS === 'web' && asset.file ? asset.file : await new File(asset.uri).arrayBuffer();
  const name = asset.name.replace(/[^\w.\- ]+/g, '_').slice(-100) || 'receipt';
  const path = `${profileId}/${Crypto.randomUUID()}/${name}`;
  const { error } = await supabase.storage.from(WWCC_RECEIPT_BUCKET).upload(path, body, {
    contentType,
    upsert: false,
  });
  if (error) throw new Error(`The receipt didn’t upload: ${error.message}`);
  return path;
}

/** A two-minute link to show a receipt inside the app. */
export async function viewReceiptUrl(path: string) {
  const { data, error } = await supabase.storage
    .from(WWCC_RECEIPT_BUCKET)
    .createSignedUrl(path, 120);
  if (error || !data) throw new Error('That receipt couldn’t be opened. Try again.');
  return data.signedUrl;
}

/**
 * Open applications an admin needs to act on: ones due to be confirmed as
 * still being assessed, and ones that lapsed because nobody did. One waiting
 * for the member's declaration is the member's to-do, not the admin's.
 */
export function applicationsToConfirm(applications: WwccApplication[], today: string) {
  const open = applications.filter((a) => !a.ended_at);
  return {
    due: open.filter((a) => a.status === 'in_force' && a.check_due_on <= today).length,
    lapsed: open.filter((a) => a.status === 'lapsed').length,
  };
}
