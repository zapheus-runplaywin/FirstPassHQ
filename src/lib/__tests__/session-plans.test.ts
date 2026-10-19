/**
 * Session plan helpers (src/lib/session-plans.ts), from "Session plans" in
 * section 6 of docs/user-guide.md: times typed in any common way, the photos,
 * PDFs and Word documents a plan can hold (up to 10 MB each), and the file
 * operations, which never leave a stored file without its record (or the
 * other way round) and give five-minute links only.
 */
import { File } from 'expo-file-system';

import {
  attachmentFromDocument,
  attachmentFromPhoto,
  attachmentProblem,
  copyPlanFile,
  deletePlan,
  formatTime,
  formatTimes,
  isImageFile,
  isWordFile,
  parseTime,
  planFileUrl,
  removePlanFile,
  SESSION_PLAN_BUCKET,
  timeOf,
  uploadPlanFile,
  type PlanAttachment,
  type SessionPlanFile,
} from '@/lib/session-plans';
import { supabase } from '@/lib/supabase';

jest.mock('@/lib/auth', () => ({ useAuth: jest.fn() }));
jest.mock('@/lib/club', () => ({ useFeature: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('expo-file-system', () => ({
  File: class {
    uri: string;
    constructor(uri: string) {
      this.uri = uri;
    }
    async arrayBuffer() {
      return new ArrayBuffer(8);
    }
  },
}));

const client = supabase as unknown as { rpc: jest.Mock; storage: { from: jest.Mock } };
let bucket: Record<string, jest.Mock>;

beforeEach(() => {
  jest.useFakeTimers({ now: new Date('2026-10-18T02:00:00Z') });
  client.rpc.mockReset();
  client.rpc.mockImplementation(async () => ({ data: null, error: null }));
  bucket = {
    upload: jest.fn(async () => ({ data: {}, error: null })),
    remove: jest.fn(async () => ({ data: [], error: null })),
    download: jest.fn(async () => ({ data: { arrayBuffer: async () => new ArrayBuffer(3) }, error: null })),
    createSignedUrl: jest.fn(async () => ({ data: { signedUrl: 'https://example.test/s' }, error: null })),
  };
  client.storage.from.mockReset();
  client.storage.from.mockImplementation(() => bucket);
});
afterEach(() => jest.useRealTimers());

describe('times', () => {
  it.each([
    ['6pm', '18:00'],
    ['6 PM', '18:00'],
    ['6.30 pm', '18:30'],
    ['18:00', '18:00'],
    ['7:05am', '07:05'],
    ['12pm', '12:00'],
    ['12am', '00:00'],
    ['0:15', '00:15'],
    ['9', '09:00'],
    ['  23:59 ', '23:59'],
  ])('reads %p as %s', (typed, time) => {
    expect(parseTime(typed)).toBe(time);
  });

  it.each(['', 'noon', '24:00', '13pm', '0am', '6:60', '6:5', '6:30:00'])('refuses %p', (typed) => {
    expect(parseTime(typed)).toBeNull();
  });

  it.each([
    ['18:00:00', '6:00 pm'],
    ['00:30:00', '12:30 am'],
    ['12:00:00', '12:00 pm'],
    ['09:05:00', '9:05 am'],
    [null, ''],
  ])('shows %p as %p', (time, shown) => {
    expect(formatTime(time)).toBe(shown);
  });

  it('shows a range, a start alone, or nothing', () => {
    expect(formatTimes('18:00:00', '19:30:00')).toBe('6:00 pm – 7:30 pm');
    expect(formatTimes('18:00:00', null)).toBe('6:00 pm');
    expect(formatTimes(null, '19:30:00')).toBe('');
  });

  it('gives a Date’s local time', () => {
    expect(timeOf(new Date(2026, 9, 18, 7, 5))).toBe('07:05');
  });
});

describe('what a plan can hold', () => {
  const file = (extra: Partial<PlanAttachment> = {}): PlanAttachment => ({
    uri: 'file:///x',
    name: 'Drills.pdf',
    mimeType: 'application/pdf',
    size: 1000,
    ...extra,
  });

  it.each([
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg',
    'image/png',
    'image/heic',
  ])('accepts %s', (mimeType) => {
    expect(attachmentProblem(file({ mimeType }))).toBeNull();
  });

  it('refuses other kinds of file, by name', () => {
    expect(attachmentProblem(file({ name: 'clip.mp4', mimeType: 'video/mp4' }))).toBe(
      'clip.mp4 can’t be attached. Attach a photo, a PDF or a Word document.',
    );
  });

  it('refuses anything over 10 MB', () => {
    expect(attachmentProblem(file({ size: 10 * 1024 * 1024 + 1 }))).toBe(
      'Drills.pdf is over 10 MB. Try a smaller photo or file.',
    );
    expect(attachmentProblem(file({ size: 10 * 1024 * 1024 }))).toBeNull();
  });

  it('knows photos and Word documents', () => {
    expect(isImageFile('image/heic')).toBe(true);
    expect(isImageFile('application/pdf')).toBe(false);
    expect(isWordFile('application/msword')).toBe(true);
    expect(isWordFile('application/pdf')).toBe(false);
  });

  it('names a photo with no file name by the time and its type', () => {
    const stamp = Date.parse('2026-10-18T02:00:00Z');
    expect(attachmentFromPhoto({ uri: 'u', mimeType: 'image/png' } as never).name).toBe(`photo-${stamp}.png`);
    expect(attachmentFromPhoto({ uri: 'u', mimeType: 'image/heif' } as never).name).toBe(`photo-${stamp}.heic`);
    const plain = attachmentFromPhoto({ uri: 'u' } as never);
    expect(plain).toEqual({ uri: 'u', name: `photo-${stamp}.jpg`, mimeType: 'image/jpeg', size: null, file: undefined });
    expect(attachmentFromPhoto({ uri: 'u', fileName: 'IMG_1.JPG', fileSize: 99 } as never)).toMatchObject({
      name: 'IMG_1.JPG',
      size: 99,
    });
  });

  it.each([
    ['plan.pdf', 'application/pdf'],
    ['plan.DOC', 'application/msword'],
    ['plan.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['court.png', 'image/png'],
    ['court.heic', 'image/heic'],
    ['court.jpeg', 'image/jpeg'],
    ['court.jpg', 'image/jpeg'],
    ['notes.txt', 'application/octet-stream'],
  ])('works out a picked %s with no type as %s', (name, mimeType) => {
    expect(attachmentFromDocument({ uri: 'u', name } as never)).toEqual({
      uri: 'u',
      name,
      mimeType,
      size: null,
      file: undefined,
    });
  });

  it('keeps the type the picker gives', () => {
    expect(attachmentFromDocument({ uri: 'u', name: 'x.bin', mimeType: 'application/pdf', size: 5 } as never)).toMatchObject({
      mimeType: 'application/pdf',
      size: 5,
    });
  });
});

describe('uploading a file', () => {
  const attachment: PlanAttachment = { uri: 'file:///Drill #1.pdf', name: 'Drill #1.pdf', mimeType: 'application/pdf', size: 10 };

  it('stores it in the plan’s folder, then records it', async () => {
    await uploadPlanFile('plan-1', attachment);
    expect(client.storage.from).toHaveBeenCalledWith(SESSION_PLAN_BUCKET);
    expect(bucket.upload).toHaveBeenCalledWith('plan-1/uuid-1/Drill _1.pdf', expect.any(ArrayBuffer), {
      contentType: 'application/pdf',
      upsert: false,
    });
    expect(client.rpc).toHaveBeenCalledWith('add_session_plan_file', {
      p_plan_id: 'plan-1',
      p_path: 'plan-1/uuid-1/Drill _1.pdf',
      p_name: 'Drill #1.pdf',
      p_content_type: 'application/pdf',
    });
  });

  it('uploads nothing it can’t attach', async () => {
    await expect(uploadPlanFile('plan-1', { ...attachment, mimeType: 'video/mp4' })).rejects.toThrow(
      'Drill #1.pdf can’t be attached.',
    );
    expect(bucket.upload).not.toHaveBeenCalled();
  });

  it('says when the upload fails, recording nothing', async () => {
    bucket.upload.mockResolvedValue({ data: null, error: { message: 'quota' } });
    await expect(uploadPlanFile('plan-1', attachment)).rejects.toThrow('Drill #1.pdf didn’t upload: quota');
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('removes the stored file when it can’t be recorded', async () => {
    client.rpc.mockResolvedValue({ data: null, error: { message: 'A plan can have up to 5 files.' } });
    await expect(uploadPlanFile('plan-1', attachment)).rejects.toThrow('A plan can have up to 5 files.');
    expect(bucket.remove).toHaveBeenCalledWith(['plan-1/uuid-1/Drill _1.pdf']);
  });

  it('reads the file from the device', async () => {
    const read = jest.spyOn(File.prototype, 'arrayBuffer');
    await uploadPlanFile('plan-1', attachment);
    expect(read).toHaveBeenCalled();
  });
});

const PLAN_FILE: SessionPlanFile = {
  id: 'f1',
  plan_id: 'old-plan',
  path: 'old-plan/u0/court.png',
  name: 'court.png',
  content_type: 'image/png',
  size_bytes: 3,
  added_by_name: 'Sample coach',
  created_at: '2026-10-01T00:00:00Z',
};

describe('copying a file for Use again', () => {
  it('copies it into the new plan’s folder and records it', async () => {
    await copyPlanFile('new-plan', PLAN_FILE);
    expect(bucket.download).toHaveBeenCalledWith('old-plan/u0/court.png');
    expect(bucket.upload).toHaveBeenCalledWith('new-plan/uuid-1/court.png', expect.any(ArrayBuffer), {
      contentType: 'image/png',
      upsert: false,
    });
    expect(client.rpc).toHaveBeenCalledWith('add_session_plan_file', {
      p_plan_id: 'new-plan',
      p_path: 'new-plan/uuid-1/court.png',
      p_name: 'court.png',
      p_content_type: 'image/png',
    });
  });

  it('asks for it to be attached again when it can’t be read', async () => {
    bucket.download.mockResolvedValue({ data: null, error: { message: 'gone' } });
    await expect(copyPlanFile('new-plan', PLAN_FILE)).rejects.toThrow('court.png couldn’t be copied. Attach it again.');
    expect(bucket.upload).not.toHaveBeenCalled();
  });

  it('says when the copy won’t upload', async () => {
    bucket.upload.mockResolvedValue({ data: null, error: { message: 'quota' } });
    await expect(copyPlanFile('new-plan', PLAN_FILE)).rejects.toThrow('court.png couldn’t be copied: quota');
  });

  it('removes the copy when it can’t be recorded', async () => {
    client.rpc.mockResolvedValue({ data: null, error: { message: 'Not your plan.' } });
    await expect(copyPlanFile('new-plan', PLAN_FILE)).rejects.toThrow('Not your plan.');
    expect(bucket.remove).toHaveBeenCalledWith(['new-plan/uuid-1/court.png']);
  });
});

describe('removing files and plans', () => {
  it('removes the stored file, then its record', async () => {
    await removePlanFile(PLAN_FILE);
    expect(bucket.remove).toHaveBeenCalledWith(['old-plan/u0/court.png']);
    expect(client.rpc).toHaveBeenCalledWith('remove_session_plan_file', { p_file_id: 'f1' });
  });

  it('keeps the record when the file couldn’t be removed', async () => {
    bucket.remove.mockResolvedValue({ data: null, error: { message: 'x' } });
    await expect(removePlanFile(PLAN_FILE)).rejects.toThrow('court.png wasn’t removed. Try again.');
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('passes on the database’s refusal', async () => {
    client.rpc.mockResolvedValue({ data: null, error: { message: 'Only its author can remove it.' } });
    await expect(removePlanFile(PLAN_FILE)).rejects.toThrow('Only its author can remove it.');
  });

  it('an admin’s delete removes every file first, then the plan', async () => {
    await deletePlan('old-plan', [PLAN_FILE, { ...PLAN_FILE, id: 'f2', path: 'old-plan/u2/a.pdf' }]);
    expect(bucket.remove).toHaveBeenCalledWith(['old-plan/u0/court.png', 'old-plan/u2/a.pdf']);
    expect(client.rpc).toHaveBeenCalledWith('admin_delete_session_plan', { p_plan_id: 'old-plan' });
  });

  it('a plan with no files goes straight to the database', async () => {
    await deletePlan('p', []);
    expect(bucket.remove).not.toHaveBeenCalled();
    expect(client.rpc).toHaveBeenCalledWith('admin_delete_session_plan', { p_plan_id: 'p' });
  });

  it('keeps the plan when its files weren’t removed', async () => {
    bucket.remove.mockResolvedValue({ data: null, error: { message: 'x' } });
    await expect(deletePlan('p', [PLAN_FILE])).rejects.toThrow('The plan’s files weren’t removed. Try again.');
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('passes on a refused delete', async () => {
    client.rpc.mockResolvedValue({ data: null, error: { message: 'Only admins can delete plans.' } });
    await expect(deletePlan('p', [])).rejects.toThrow('Only admins can delete plans.');
  });
});

describe('opening a file', () => {
  it('gives a five-minute link', async () => {
    await expect(planFileUrl('p/u/a.pdf')).resolves.toBe('https://example.test/s');
    expect(bucket.createSignedUrl).toHaveBeenCalledWith('p/u/a.pdf', 300);
  });

  it('says when it can’t be opened', async () => {
    bucket.createSignedUrl.mockResolvedValue({ data: null, error: { message: 'x' } });
    await expect(planFileUrl('p')).rejects.toThrow('That file couldn’t be opened. Try again.');
  });
});
