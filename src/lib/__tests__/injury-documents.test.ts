/**
 * Injury proof documents (src/lib/injuries.ts), from "Injury documents and
 * photos" in section 12 of docs/user-guide.md.
 *
 * For an adult, a PDF or any photo. For an athlete under 18, a PDF, or a
 * photo confirmed to show the letter or report, never their injury; only a
 * verified guardian who confirms consent may add a photo of their child's
 * injury. What a photo shows is recorded before it uploads, every view and
 * share is logged first, and links to documents expire quickly.
 */
import { File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import {
  INJURY_BUCKET,
  MAX_DOCUMENT_BYTES,
  shareCsv,
  shareInjuryDocument,
  uploadInjuryDocument,
  viewInjuryDocumentUrl,
  type DocumentRule,
  type PhotoShows,
} from '@/lib/injuries';
import { supabase } from '@/lib/supabase';

jest.mock('@/lib/auth', () => ({ useAuth: jest.fn() }));
jest.mock('expo-sharing', () => ({ shareAsync: jest.fn(async () => {}) }));
jest.mock('expo-file-system', () => {
  class MockFile {
    uri: string;
    written: string | null = null;
    static downloads: string[] = [];
    static deleted: string[] = [];
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts.map((p) => (typeof p === 'string' ? p : p.uri)).join('/');
    }
    async arrayBuffer() {
      return new ArrayBuffer(4);
    }
    // Like SDK 58's File.write(), the file is only there once the promise settles.
    async write(text: string) {
      await Promise.resolve();
      this.written = text;
      MockFile.lastWritten = { uri: this.uri, text };
    }
    delete() {
      MockFile.deleted.push(this.uri);
    }
    static lastWritten: { uri: string; text: string } | null = null;
    static async downloadFileAsync(url: string, destination: MockFile) {
      MockFile.downloads.push(url);
      return destination;
    }
  }
  return { File: MockFile, Paths: { cache: { uri: 'cache:' } } };
});

const MockFile = File as unknown as {
  downloads: string[];
  deleted: string[];
  lastWritten: { uri: string; text: string } | null;
};

const client = supabase as unknown as { rpc: jest.Mock; storage: { from: jest.Mock } };
let upload: jest.Mock;
let createSignedUrl: jest.Mock;

const INJURY = { id: 'inj-1', athlete_id: 'child-1' };
const asset = (extra: Record<string, unknown> = {}) =>
  ({ uri: 'file:///picked/report.pdf', name: 'report.pdf', mimeType: 'application/pdf', size: 1000, ...extra }) as never;
const photo = (extra: Record<string, unknown> = {}) =>
  asset({ uri: 'file:///picked/IMG_1.jpg', name: 'IMG 1.jpg', mimeType: 'image/jpeg', ...extra });

beforeEach(() => {
  jest.useFakeTimers({ now: new Date('2026-10-18T02:00:00Z') });
  client.rpc.mockReset();
  client.rpc.mockImplementation(async () => ({ data: null, error: null }));
  upload = jest.fn(async () => ({ data: {}, error: null }));
  createSignedUrl = jest.fn(async () => ({ data: { signedUrl: 'https://example.test/signed' }, error: null }));
  client.storage.from.mockReset();
  client.storage.from.mockImplementation(() => ({ upload, createSignedUrl }));
  MockFile.downloads = [];
  MockFile.deleted = [];
  (Sharing.shareAsync as jest.Mock).mockClear();
});

afterEach(() => jest.useRealTimers());

const STAMP = Date.parse('2026-10-18T02:00:00Z');

describe('uploading a document', () => {
  it.each<DocumentRule>(['photos', 'letter', 'consent'])('a PDF uploads for any athlete (%s), with no photo record', async (rule) => {
    const path = await uploadInjuryDocument(INJURY, asset(), rule, null);
    expect(path).toBe(`child-1/inj-1/${STAMP}-report.pdf`);
    expect(client.storage.from).toHaveBeenCalledWith(INJURY_BUCKET);
    expect(upload).toHaveBeenCalledWith(path, expect.any(ArrayBuffer), {
      contentType: 'application/pdf',
      upsert: false,
    });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('an adult’s photo uploads without saying what it shows', async () => {
    const path = await uploadInjuryDocument(INJURY, photo(), 'photos', null);
    expect(path).toBe(`child-1/inj-1/${STAMP}-IMG 1.jpg`);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each<DocumentRule>(['letter', 'consent'])(
    'for an under 18 (%s), a photo must say what it shows, and nothing uploads until it does',
    async (rule) => {
      await expect(uploadInjuryDocument(INJURY, photo(), rule, null)).rejects.toThrow(
        'Confirm what the photo shows before sending it.',
      );
      expect(upload).not.toHaveBeenCalled();
      expect(client.rpc).not.toHaveBeenCalled();
    },
  );

  it.each<[DocumentRule, PhotoShows]>([
    ['letter', 'letter'],
    ['consent', 'letter'],
    ['consent', 'injury'],
  ])('rule %s allows a photo of the %s, recorded before it uploads', async (rule, shows) => {
    const order: string[] = [];
    client.rpc.mockImplementation(async () => {
      order.push('confirm');
      return { data: null, error: null };
    });
    upload.mockImplementation(async () => {
      order.push('upload');
      return { data: {}, error: null };
    });
    const path = await uploadInjuryDocument(INJURY, photo(), rule, shows);
    expect(client.rpc).toHaveBeenCalledWith('confirm_injury_photo', { p_path: path, p_kind: shows });
    expect(order).toEqual(['confirm', 'upload']);
  });

  it('never a photo of an under 18’s injury without a guardian’s consent', async () => {
    await expect(uploadInjuryDocument(INJURY, photo(), 'letter', 'injury')).rejects.toThrow(
      'Attach a photo of the letter or report, not of the injury.',
    );
    expect(upload).not.toHaveBeenCalled();
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('stops when the database won’t record the photo', async () => {
    client.rpc.mockResolvedValue({ data: null, error: { message: 'Only a verified guardian can add that.' } });
    await expect(uploadInjuryDocument(INJURY, photo(), 'consent', 'injury')).rejects.toThrow(
      'Only a verified guardian can add that.',
    );
    expect(upload).not.toHaveBeenCalled();
  });

  it('refuses a file over 10 MB', async () => {
    await expect(uploadInjuryDocument(INJURY, asset({ size: MAX_DOCUMENT_BYTES + 1 }), 'photos', null)).rejects.toThrow(
      'That file is over 10 MB. Try a smaller photo or a PDF.',
    );
    await expect(uploadInjuryDocument(INJURY, asset({ size: MAX_DOCUMENT_BYTES }), 'photos', null)).resolves.toBeTruthy();
  });

  it.each([['image/gif'], ['application/msword'], [undefined]])('refuses a %p file', async (mimeType) => {
    await expect(uploadInjuryDocument(INJURY, asset({ mimeType }), 'photos', null)).rejects.toThrow(
      'Attach a PDF or a photo (JPEG, PNG or HEIC).',
    );
    expect(upload).not.toHaveBeenCalled();
  });

  it.each([
    ['a PDF without .pdf', asset({ name: 'scan' }), `${STAMP}-scan.pdf`],
    ['a photo named .pdf', photo({ name: 'photo.pdf' }), `${STAMP}-photo.jpg`],
    ['odd characters', asset({ name: 'Dr’s letter #2.pdf' }), `${STAMP}-Dr_s letter _2.pdf`],
  ])('names the stored file to match what’s inside: %s', async (_l, file, name) => {
    const path = await uploadInjuryDocument(INJURY, file, 'photos', null);
    expect(path).toBe(`child-1/inj-1/${name}`);
  });

  it('says when the upload fails', async () => {
    upload.mockResolvedValue({ data: null, error: { message: 'Bucket full' } });
    await expect(uploadInjuryDocument(INJURY, asset(), 'photos', null)).rejects.toThrow(
      'The file didn’t upload: Bucket full',
    );
  });
});

describe('viewing a document', () => {
  it('records the view, then gives a link that lasts two minutes', async () => {
    const url = await viewInjuryDocumentUrl('child-1/inj-1/a.pdf');
    expect(url).toBe('https://example.test/signed');
    expect(client.rpc).toHaveBeenCalledWith('open_injury_document', { p_path: 'child-1/inj-1/a.pdf' });
    expect(createSignedUrl).toHaveBeenCalledWith('child-1/inj-1/a.pdf', 120);
  });

  it('gives no link when the view can’t be recorded', async () => {
    client.rpc.mockResolvedValue({ data: null, error: { message: 'not allowed' } });
    await expect(viewInjuryDocumentUrl('p')).rejects.toThrow('That document couldn’t be opened. Try again.');
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('says so when no link comes back', async () => {
    createSignedUrl.mockResolvedValue({ data: null, error: { message: 'gone' } });
    await expect(viewInjuryDocumentUrl('p')).rejects.toThrow('That document couldn’t be opened. Try again.');
  });
});

describe('sharing a document', () => {
  it('records the share, opens the share sheet, then deletes the copy', async () => {
    await shareInjuryDocument('child-1/inj-1/123-report.pdf', 'Physio letter.pdf');
    expect(client.rpc).toHaveBeenCalledWith('open_injury_document', {
      p_path: 'child-1/inj-1/123-report.pdf',
      p_share: true,
    });
    expect(createSignedUrl).toHaveBeenCalledWith('child-1/inj-1/123-report.pdf', 60);
    expect(MockFile.downloads).toEqual(['https://example.test/signed']);
    expect(Sharing.shareAsync).toHaveBeenCalledWith('cache:/Physio letter.pdf', { dialogTitle: 'Physio letter.pdf' });
    expect(MockFile.deleted).toEqual(['cache:/Physio letter.pdf']);
  });

  it('names the file from its path when it has no name, and deletes it even if sharing fails', async () => {
    (Sharing.shareAsync as jest.Mock).mockRejectedValueOnce(new Error('cancelled'));
    await expect(shareInjuryDocument('child-1/inj-1/123-report.pdf', null)).rejects.toThrow('cancelled');
    expect(MockFile.deleted).toEqual(['cache:/123-report.pdf']);
  });

  it('shares nothing when the database refuses the share', async () => {
    client.rpc.mockResolvedValue({ data: null, error: { message: 'Only the committee member accepting it can share it.' } });
    await expect(shareInjuryDocument('p', 'n')).rejects.toThrow('Only the committee member accepting it can share it.');
    expect(createSignedUrl).not.toHaveBeenCalled();
    expect(Sharing.shareAsync).not.toHaveBeenCalled();
  });
});

describe('sharing a CSV', () => {
  it('writes it to the cache and opens the share sheet as CSV', async () => {
    await shareCsv('injuries.csv', '"a","b"');
    expect(MockFile.lastWritten).toEqual({ uri: 'cache:/injuries.csv', text: '"a","b"' });
    expect(Sharing.shareAsync).toHaveBeenCalledWith('cache:/injuries.csv', {
      mimeType: 'text/csv',
      UTI: 'public.comma-separated-values-text',
      dialogTitle: 'injuries.csv',
    });
  });

  it('opens the share sheet only once the file has finished writing', async () => {
    MockFile.lastWritten = null;
    let writtenWhenShared: unknown = null;
    (Sharing.shareAsync as jest.Mock).mockImplementationOnce(async () => {
      writtenWhenShared = MockFile.lastWritten;
    });
    await shareCsv('injuries.csv', '"a"');
    expect(writtenWhenShared).toEqual({ uri: 'cache:/injuries.csv', text: '"a"' });
  });
});
