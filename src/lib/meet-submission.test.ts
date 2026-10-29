import * as server from '../../convex/lib/meetSubmissions';
import { MeetCalApiError, MeetCalApiTimeoutError } from '@/lib/api/meetcal-api';
import {
  checkMeetSubmissionForm,
  contentTypeFor,
  formatDateEntry,
  MAX_MEET_SUBMISSION_FILE_BYTES,
  MAX_MEET_SUBMISSION_FILE_NAME_LEN,
  MAX_MEET_SUBMISSION_FILES,
  MAX_MEET_SUBMISSION_NAME_LEN,
  MAX_MEET_SUBMISSIONS_PER_DAY,
  MEET_SUBMISSION_FILE_EXTENSIONS,
  meetSubmissionErrorMessage,
  MeetSubmissionUploadError,
  MEET_SUBMISSION_UPLOAD_TIMEOUT_MS,
  parseUsDate,
  sendFileFromDisk,
  sendMeetSubmission,
  uploadMeetSubmissionFile,
  type PickedFile,
} from '@/lib/meet-submission';

const mockUploadAsync = jest.fn();
const mockCancel = jest.fn();
const mockCreateUploadTask = jest.fn();
let mockFileSize: number | undefined = 1000;
jest.mock('expo-file-system', () => ({
  File: jest.fn().mockImplementation((uri: string) => ({
    uri,
    get size() {
      return mockFileSize;
    },
    createUploadTask: (...args: unknown[]) => {
      mockCreateUploadTask(...args);
      return { uploadAsync: mockUploadAsync, cancel: mockCancel };
    },
  })),
}));

const pdf = (name = 'schedule.pdf', size: number | null = 1000): PickedFile => ({ uri: `file:///cache/${name}`, name, mimeType: 'application/pdf', size });

describe('meet submission limits', () => {
  it("are the server's", () => {
    expect(MAX_MEET_SUBMISSION_FILES).toBe(server.MAX_MEET_SUBMISSION_FILES);
    expect(MAX_MEET_SUBMISSION_FILE_BYTES).toBe(server.MAX_MEET_SUBMISSION_FILE_BYTES);
    expect(MAX_MEET_SUBMISSIONS_PER_DAY).toBe(server.MAX_MEET_SUBMISSIONS_PER_DAY);
    expect(MAX_MEET_SUBMISSION_NAME_LEN).toBe(server.MAX_MEET_SUBMISSION_NAME_LEN);
    expect(MAX_MEET_SUBMISSION_FILE_NAME_LEN).toBe(server.MAX_MEET_SUBMISSION_FILE_NAME_LEN);
    expect(MEET_SUBMISSION_FILE_EXTENSIONS).toEqual(server.MEET_SUBMISSION_FILE_EXTENSIONS);
  });
});

describe('dates', () => {
  it('adds the slashes while typing, digits only', () => {
    expect(formatDateEntry('0')).toBe('0');
    expect(formatDateEntry('031')).toBe('03/1');
    expect(formatDateEntry('03062')).toBe('03/06/2');
    expect(formatDateEntry('03/06/20271')).toBe('03/06/2027');
    expect(formatDateEntry('ab03-06')).toBe('03/06');
  });

  it('reads MM/DD/YYYY as the calendar date, never through a time zone', () => {
    expect(parseUsDate('03/06/2027')).toBe('2027-03-06');
    expect(parseUsDate(' 02/29/2028 ')).toBe('2028-02-29');
    expect(parseUsDate('02/29/2027')).toBeNull();
    expect(parseUsDate('13/01/2027')).toBeNull();
    expect(parseUsDate('3/6/2027')).toBeNull();
    expect(parseUsDate('')).toBeNull();
  });
});

describe('checkMeetSubmissionForm', () => {
  const form = (extra = {}) => ({ meetName: ' Example Open ', startDate: '03/06/2027', endDate: '', files: [pdf()], ...extra });
  const error = (extra = {}) => {
    const result = checkMeetSubmissionForm(form(extra));
    return result.ok ? 'ok' : result.error;
  };

  it('answers what the server takes', () => {
    expect(checkMeetSubmissionForm(form({ endDate: '03/08/2027' }))).toEqual({
      ok: true,
      value: { meetName: 'Example Open', startDate: '2027-03-06', endDate: '2027-03-08', files: [pdf()] },
    });
    expect(checkMeetSubmissionForm(form())).toMatchObject({ ok: true, value: { endDate: null } });
  });

  it('names the first thing to fix', () => {
    expect(error({ meetName: ' ' })).toBe('Enter the meet name.');
    expect(error({ meetName: 'x'.repeat(MAX_MEET_SUBMISSION_NAME_LEN + 1) })).toMatch(/at most 200/);
    expect(error({ startDate: '03/06' })).toBe('Enter the start date as MM/DD/YYYY.');
    expect(error({ endDate: '02/30/2027' })).toMatch(/end date/);
    expect(error({ endDate: '03/05/2027' })).toBe('The end date is before the start date.');
    expect(error({ files: [] })).toBe('Add at least one file.');
    expect(error({ files: Array.from({ length: MAX_MEET_SUBMISSION_FILES + 1 }, (_, i) => pdf(`${i}.pdf`)) })).toBe('Add at most 10 files.');
    expect(error({ files: [pdf('notes.txt')] })).toMatch(/isn't a PDF/);
    expect(error({ files: [pdf('big.pdf', MAX_MEET_SUBMISSION_FILE_BYTES + 1)] })).toBe('big.pdf is larger than 20 MB.');
    // Size unknown: the upload checks it.
    expect(error({ files: [pdf('big.pdf', null)] })).toBe('ok');
  });
});

describe('contentTypeFor', () => {
  it("uses the picker's type, else the extension's", () => {
    expect(contentTypeFor(pdf())).toBe('application/pdf');
    expect(contentTypeFor({ ...pdf('List.XLSX'), mimeType: null })).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(contentTypeFor({ ...pdf('photo.heic'), mimeType: '' })).toBe('image/heic');
  });
});

describe('uploadMeetSubmissionFile', () => {
  const answering = (status: number, body: string) => jest.fn(async () => ({ status, body }));

  it('sends the file with its type and answers the storage id', async () => {
    const send = answering(200, JSON.stringify({ storageId: 'kg2abc' }));
    expect(await uploadMeetSubmissionFile('https://up.example/1', pdf(), send)).toBe('kg2abc');
    expect(send).toHaveBeenCalledWith(pdf(), 'https://up.example/1', 'application/pdf');
  });

  it.each([
    ['a refusal', answering(500, '{}'), "Couldn't upload schedule.pdf (500)."],
    ['a body that is not JSON', answering(200, '<html>'), /not JSON/],
    ['no storage id', answering(200, JSON.stringify({ id: 'x' })), /no storage id/],
  ])('fails loudly on %s', async (_label, send, message) => {
    await expect(uploadMeetSubmissionFile('https://up.example/1', pdf(), send)).rejects.toThrow(message);
  });

  it('names the file when the device could not send it, and keeps its own messages', async () => {
    const offline = jest.fn(async () => {
      throw new Error('ENOENT');
    });
    await expect(uploadMeetSubmissionFile('https://up.example/1', pdf(), offline)).rejects.toThrow("Couldn't upload schedule.pdf. Check your connection");
    const tooBig = jest.fn(async () => {
      throw new MeetSubmissionUploadError('schedule.pdf is larger than 20 MB.');
    });
    await expect(uploadMeetSubmissionFile('https://up.example/1', pdf(), tooBig)).rejects.toThrow('schedule.pdf is larger than 20 MB.');
  });
});

describe('sendFileFromDisk', () => {
  beforeEach(() => {
    mockFileSize = 1000;
    mockUploadAsync.mockReset();
    mockCancel.mockReset();
    mockCreateUploadTask.mockReset();
  });
  afterEach(() => jest.useRealTimers());

  it('streams the file from disk with its type and answers the response', async () => {
    mockUploadAsync.mockResolvedValue({ status: 200, body: '{"storageId":"x"}', headers: {} });
    expect(await sendFileFromDisk(pdf(), 'https://up.example/1', 'application/pdf')).toEqual({ status: 200, body: '{"storageId":"x"}' });
    expect(mockCreateUploadTask).toHaveBeenCalledWith('https://up.example/1', { httpMethod: 'POST', headers: { 'Content-Type': 'application/pdf' } });
  });

  it('refuses a file over the limit before sending it', async () => {
    mockFileSize = MAX_MEET_SUBMISSION_FILE_BYTES + 1;
    await expect(sendFileFromDisk(pdf('big.pdf', null), 'https://up.example/1', 'application/pdf')).rejects.toThrow('big.pdf is larger than 20 MB.');
    expect(mockCreateUploadTask).not.toHaveBeenCalled();
  });

  it('cancels an upload that takes too long', async () => {
    jest.useFakeTimers();
    mockUploadAsync.mockReturnValue(new Promise(() => {}));
    const sent = sendFileFromDisk(pdf(), 'https://up.example/1', 'application/pdf');
    jest.advanceTimersByTime(MEET_SUBMISSION_UPLOAD_TIMEOUT_MS);
    await expect(sent).rejects.toThrow('took too long');
    expect(mockCancel).toHaveBeenCalled();
  });
});

describe('sendMeetSubmission', () => {
  const form = (files: PickedFile[]) => ({ meetName: 'Open', startDate: '2027-03-06', endDate: null, files });
  const fakeDeps = () => {
    const events: string[] = [];
    return {
      events,
      deps: {
        generateUploadUrl: jest.fn(async () => {
          events.push('url');
          return `https://up.example/${events.length}`;
        }),
        uploadFile: jest.fn(async (_url: string, file: PickedFile) => {
          events.push(`upload ${file.name}`);
          return `id-${file.name}`;
        }),
        submit: jest.fn(async () => {
          events.push('submit');
        }),
      },
    };
  };

  it('uploads one file at a time, then submits them with the meet', async () => {
    const { events, deps } = fakeDeps();
    let inFlight = 0;
    deps.uploadFile.mockImplementation(async (_url: string, file: PickedFile) => {
      inFlight += 1;
      expect(inFlight).toBe(1);
      await Promise.resolve();
      inFlight -= 1;
      events.push(`upload ${file.name}`);
      return `id-${file.name}`;
    });
    const progress: [number, number][] = [];
    await sendMeetSubmission('token', form([pdf('a.pdf'), pdf('b.pdf')]), ' lifter@example.com ', new Map(), (file, total) => progress.push([file, total]), deps);
    expect(events).toEqual(['url', 'upload a.pdf', 'url', 'upload b.pdf', 'submit']);
    expect(progress).toEqual([
      [1, 2],
      [2, 2],
    ]);
    expect(deps.submit).toHaveBeenCalledWith('token', {
      meetName: 'Open',
      startDate: '2027-03-06',
      endDate: null,
      contactEmail: 'lifter@example.com',
      files: [
        { storageId: 'id-a.pdf', name: 'a.pdf' },
        { storageId: 'id-b.pdf', name: 'b.pdf' },
      ],
    });
  });

  it('does not submit when an upload fails, and keeps the uploads that finished for the retry', async () => {
    const { events, deps } = fakeDeps();
    deps.uploadFile
      .mockImplementationOnce(async () => 'id-a.pdf')
      .mockImplementationOnce(async () => {
        throw new MeetSubmissionUploadError("Couldn't upload b.pdf (500).");
      });
    const uploaded = new Map<string, string>();
    await expect(sendMeetSubmission('token', form([pdf('a.pdf'), pdf('b.pdf')]), null, uploaded, undefined, deps)).rejects.toThrow('(500)');
    expect(deps.submit).not.toHaveBeenCalled();
    events.length = 0;
    await sendMeetSubmission('token', form([pdf('a.pdf'), pdf('b.pdf')]), null, uploaded, undefined, deps);
    // Only the file that failed is uploaded again.
    expect(events).toEqual(['url', 'upload b.pdf', 'submit']);
  });

  it('retries a failed submit without uploading again', async () => {
    const { events, deps } = fakeDeps();
    deps.submit.mockRejectedValueOnce(new TypeError('Network request failed'));
    const uploaded = new Map<string, string>();
    await expect(sendMeetSubmission('token', form([pdf('a.pdf')]), null, uploaded, undefined, deps)).rejects.toThrow('Network request failed');
    events.length = 0;
    await sendMeetSubmission('token', form([pdf('a.pdf')]), null, uploaded, undefined, deps);
    expect(events).toEqual(['submit']);
  });

  it('counts a retry as sent when the first submit was stored after all', async () => {
    const { deps } = fakeDeps();
    const stored = new MeetCalApiError('failed', 400, JSON.stringify({ status: 400, error: 'file already submitted: a.pdf' }));
    deps.submit.mockRejectedValue(stored);
    // Nothing reused: a real refusal.
    await expect(sendMeetSubmission('token', form([pdf('a.pdf')]), null, new Map(), undefined, deps)).rejects.toBe(stored);
    // Reused from the attempt whose submit timed out: it was stored.
    await expect(sendMeetSubmission('token', form([pdf('a.pdf')]), null, new Map([[pdf('a.pdf').uri, 'id-a.pdf']]), undefined, deps)).resolves.toBeUndefined();
  });
});

describe('meetSubmissionErrorMessage', () => {
  const api = (status: number, data: unknown) => new MeetCalApiError('failed', status, JSON.stringify(data));

  it('tells the user what happened', () => {
    expect(meetSubmissionErrorMessage(api(429, { status: 429, error: 'at most 5 meet submissions a day' }))).toBe('At most 5 meet submissions a day. Try again tomorrow.');
    expect(meetSubmissionErrorMessage(api(429, { status: 429, error: 'at most 50 uploads a day' }))).toBe('At most 50 uploads a day. Try again tomorrow.');
    expect(meetSubmissionErrorMessage(api(429, {}))).toBe('You can send 5 meets a day. Try again tomorrow.');
    expect(meetSubmissionErrorMessage(api(401, {}))).toBe('Sign in again to send this meet.');
    expect(meetSubmissionErrorMessage(api(413, {}))).toBe('A file is larger than 20 MB.');
    expect(meetSubmissionErrorMessage(api(400, { status: 400, error: 'end date is before the start date' }))).toBe('End date is before the start date.');
    expect(meetSubmissionErrorMessage(new MeetCalApiError('failed', 400, 'not json'))).toMatch(/couldn't take this meet/);
    expect(meetSubmissionErrorMessage(api(500, {}))).toMatch(/couldn't take this meet/);
    expect(meetSubmissionErrorMessage(new MeetSubmissionUploadError("Couldn't read a.pdf."))).toBe("Couldn't read a.pdf.");
    expect(meetSubmissionErrorMessage(new MeetCalApiTimeoutError('POST', '/meet-submissions', 10000))).toMatch(/Couldn't reach MeetCal/);
    expect(meetSubmissionErrorMessage(new TypeError('Network request failed'))).toMatch(/Check your connection/);
  });
});
