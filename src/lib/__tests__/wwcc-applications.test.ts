/**
 * Lodged Working With Children Check applications (src/lib/wwcc-applications.ts),
 * from "Check applied for" in sections 10 and 12 of docs/user-guide.md. An
 * admin records the application with its receipt, kept in the member's
 * folder of a private bucket; links to a receipt expire in two minutes; and
 * admins are asked to confirm each open application every 30 days.
 */
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';
import type { WwccApplication } from '@/lib/types';
import {
  APPLICATION_CHECK_DAYS,
  APPLICATION_LAPSE_DAYS,
  APPLICATION_STATUS_URL,
  WWCC_RECEIPT_BUCKET,
  applicationKindLabels,
  applicationsToConfirm,
  uploadReceipt,
  viewReceiptUrl,
} from '@/lib/wwcc-applications';

// The injuries module it shares file rules with loads the signed-in member.
jest.mock('@/lib/auth', () => ({ useAuth: jest.fn() }));
jest.mock('expo-file-system', () => ({
  File: class {
    uri: string;
    constructor(uri: string) {
      this.uri = uri;
    }
    async arrayBuffer() {
      return new ArrayBuffer(4);
    }
  },
}));

const client = supabase as unknown as { storage: { from: jest.Mock } };
let upload: jest.Mock;
let createSignedUrl: jest.Mock;

const asset = (extra: Record<string, unknown> = {}) =>
  ({
    uri: 'file:///picked/receipt.pdf',
    name: 'WWC receipt (1).pdf',
    mimeType: 'application/pdf',
    size: 1000,
    ...extra,
  }) as never;

beforeEach(() => {
  upload = jest.fn(async () => ({ data: {}, error: null }));
  createSignedUrl = jest.fn(async () => ({
    data: { signedUrl: 'https://example.test/signed' },
    error: null,
  }));
  client.storage.from.mockReset();
  client.storage.from.mockImplementation(() => ({ upload, createSignedUrl }));
  jest.spyOn(Crypto, 'randomUUID').mockReturnValue('uuid-1' as never);
});

afterEach(() => {
  Platform.OS = 'ios';
});

describe('the rules', () => {
  it('lapses after 90 days and asks for a confirmation every 30', () => {
    expect(APPLICATION_LAPSE_DAYS).toBe(90);
    expect(APPLICATION_CHECK_DAYS).toBe(30);
  });

  it('names a new check and a renewal', () => {
    expect(applicationKindLabels).toEqual({ new: 'New check', renewal: 'Renewal' });
  });

  it('links to the Screening Unit’s online services', () => {
    expect(APPLICATION_STATUS_URL).toBe('https://workingwithchildren.wa.gov.au/online-services');
  });
});

describe('uploadReceipt', () => {
  it('puts the receipt in the member’s folder of the private receipts bucket', async () => {
    await expect(uploadReceipt('member-1', asset())).resolves.toBe(
      'member-1/uuid-1/WWC receipt _1_.pdf',
    );
    expect(client.storage.from).toHaveBeenCalledWith('wwcc-receipts');
    expect(WWCC_RECEIPT_BUCKET).toBe('wwcc-receipts');
    expect(upload).toHaveBeenCalledWith('member-1/uuid-1/WWC receipt _1_.pdf', expect.any(ArrayBuffer), {
      contentType: 'application/pdf',
      upsert: false,
    });
  });

  it('keeps the last 100 characters of a long name, and names a nameless one', async () => {
    const long = `${'a'.repeat(120)}.pdf`;
    await expect(uploadReceipt('m', asset({ name: long }))).resolves.toBe(`m/uuid-1/${long.slice(-100)}`);
    await expect(uploadReceipt('m', asset({ name: '' }))).resolves.toBe('m/uuid-1/receipt');
  });

  it('sends the picked file itself on the web', async () => {
    Platform.OS = 'web';
    const file = { kind: 'web file' };
    await uploadReceipt('m', asset({ file }));
    expect(upload.mock.calls[0][1]).toBe(file);
  });

  it('accepts a photo of the receipt', async () => {
    await uploadReceipt('m', asset({ name: 'IMG.heic', mimeType: 'image/heic' }));
    expect(upload.mock.calls[0][2]).toEqual({ contentType: 'image/heic', upsert: false });
  });

  it('refuses a file over 10 MB, or one that isn’t a PDF or photo, before uploading', async () => {
    await expect(uploadReceipt('m', asset({ size: 10 * 1024 * 1024 + 1 }))).rejects.toThrow(
      'That file is over 10 MB. Try a smaller photo or a PDF.',
    );
    await expect(uploadReceipt('m', asset({ mimeType: 'text/plain' }))).rejects.toThrow(
      'Attach a PDF or a photo (JPEG, PNG or HEIC).',
    );
    await expect(uploadReceipt('m', asset({ mimeType: undefined }))).rejects.toThrow(
      'Attach a PDF or a photo (JPEG, PNG or HEIC).',
    );
    expect(upload).not.toHaveBeenCalled();
  });

  it('accepts a file of exactly 10 MB', async () => {
    await expect(uploadReceipt('m', asset({ size: 10 * 1024 * 1024 }))).resolves.toBeTruthy();
  });

  it('says when the upload fails', async () => {
    upload.mockResolvedValueOnce({ data: null, error: { message: 'Bucket full' } });
    await expect(uploadReceipt('m', asset())).rejects.toThrow('The receipt didn’t upload: Bucket full');
  });
});

describe('viewReceiptUrl', () => {
  it('makes a two-minute link', async () => {
    await expect(viewReceiptUrl('m/uuid-1/r.pdf')).resolves.toBe('https://example.test/signed');
    expect(client.storage.from).toHaveBeenCalledWith('wwcc-receipts');
    expect(createSignedUrl).toHaveBeenCalledWith('m/uuid-1/r.pdf', 120);
  });

  it('says when it can’t be opened', async () => {
    createSignedUrl.mockResolvedValueOnce({ data: null, error: { message: 'gone' } });
    await expect(viewReceiptUrl('x')).rejects.toThrow('That receipt couldn’t be opened. Try again.');
    createSignedUrl.mockResolvedValueOnce({ data: null, error: null });
    await expect(viewReceiptUrl('x')).rejects.toThrow('That receipt couldn’t be opened. Try again.');
  });
});

describe('applicationsToConfirm', () => {
  const application = (overrides: Partial<WwccApplication>) =>
    ({ status: 'in_force', check_due_on: '2026-11-01', ended_at: null, ...overrides }) as WwccApplication;

  it('counts open applications due to be confirmed from the day they’re due', () => {
    expect(
      applicationsToConfirm(
        [
          application({ check_due_on: '2026-10-17' }),
          application({ check_due_on: '2026-10-18' }),
          application({ check_due_on: '2026-10-19' }),
        ],
        '2026-10-18',
      ),
    ).toEqual({ due: 2, lapsed: 0 });
  });

  it('counts lapsed ones apart, and leaves out ones waiting for the member, stopped or ended', () => {
    expect(
      applicationsToConfirm(
        [
          application({ status: 'lapsed' }),
          application({ status: 'waiting_for_declaration', check_due_on: '2026-10-01' }),
          application({ status: 'stopped', check_due_on: '2026-10-01' }),
          application({ status: 'in_force', check_due_on: '2026-10-01', ended_at: '2026-10-10T00:00:00Z' }),
          application({ status: 'lapsed', ended_at: '2026-10-10T00:00:00Z' }),
        ],
        '2026-10-18',
      ),
    ).toEqual({ due: 0, lapsed: 1 });
  });

  it('is nothing with no applications', () => {
    expect(applicationsToConfirm([], '2026-10-18')).toEqual({ due: 0, lapsed: 0 });
  });
});
