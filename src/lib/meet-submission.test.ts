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
  parseUsDate,
  sendMeetSubmission,
  uploadMeetSubmissionFile,
  type PickedFile,
} from '@/lib/meet-submission';

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

function response(status: number, body: unknown, blob?: Blob): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (body instanceof Error) throw body;
      return body;
    },
    blob: async () => blob ?? new Blob(['x']),
  } as unknown as Response;
}

describe('uploadMeetSubmissionFile', () => {
  it('posts the bytes with their type and answers the storage id', async () => {
    const fetchImpl = jest.fn(async (url: string) => (url.startsWith('file:') ? response(200, null) : response(200, { storageId: 'kg2abc' })));
    expect(await uploadMeetSubmissionFile('https://up.example/1', pdf(), fetchImpl as unknown as typeof fetch)).toBe('kg2abc');
    expect(fetchImpl).toHaveBeenLastCalledWith('https://up.example/1', expect.objectContaining({ method: 'POST', headers: { 'Content-Type': 'application/pdf' } }));
  });

  it('refuses a file over the limit before uploading it', async () => {
    const big = { size: MAX_MEET_SUBMISSION_FILE_BYTES + 1 } as Blob;
    const fetchImpl = jest.fn(async () => response(200, null, big));
    await expect(uploadMeetSubmissionFile('https://up.example/1', pdf('x.pdf', null), fetchImpl as unknown as typeof fetch)).rejects.toThrow('x.pdf is larger than 20 MB.');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a refusal', response(500, {})],
    ['a body that is not JSON', response(200, new Error('bad json'))],
    ['no storage id', response(200, { id: 'x' })],
  ])('fails loudly on %s', async (_label, answer) => {
    const fetchImpl = jest.fn(async (url: string) => (url.startsWith('file:') ? response(200, null) : answer));
    await expect(uploadMeetSubmissionFile('https://up.example/1', pdf(), fetchImpl as unknown as typeof fetch)).rejects.toBeInstanceOf(MeetSubmissionUploadError);
  });

  it('says which file it could not read', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new Error('ENOENT');
    });
    await expect(uploadMeetSubmissionFile('https://up.example/1', pdf(), fetchImpl as unknown as typeof fetch)).rejects.toThrow("Couldn't read schedule.pdf.");
  });
});

describe('sendMeetSubmission', () => {
  it('uploads one file at a time, then submits them with the meet', async () => {
    const events: string[] = [];
    let inFlight = 0;
    const deps = {
      generateUploadUrl: jest.fn(async () => {
        events.push('url');
        return `https://up.example/${events.length}`;
      }),
      uploadFile: jest.fn(async (_url: string, file: PickedFile) => {
        inFlight += 1;
        expect(inFlight).toBe(1);
        await Promise.resolve();
        inFlight -= 1;
        events.push(`upload ${file.name}`);
        return `id-${file.name}`;
      }),
      submit: jest.fn(async () => {
        events.push('submit');
      }),
    };
    const progress: [number, number][] = [];
    await sendMeetSubmission(
      'token',
      { meetName: 'Open', startDate: '2027-03-06', endDate: null, files: [pdf('a.pdf'), pdf('b.pdf')] },
      ' lifter@example.com ',
      (file, total) => progress.push([file, total]),
      deps,
    );
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

  it('does not submit when an upload fails', async () => {
    const deps = {
      generateUploadUrl: jest.fn(async () => 'https://up.example/1'),
      uploadFile: jest.fn(async () => {
        throw new MeetSubmissionUploadError("Couldn't upload a.pdf (500).");
      }),
      submit: jest.fn(),
    };
    await expect(sendMeetSubmission('token', { meetName: 'Open', startDate: '2027-03-06', endDate: null, files: [pdf('a.pdf')] }, null, undefined, deps)).rejects.toThrow('(500)');
    expect(deps.submit).not.toHaveBeenCalled();
  });
});

describe('meetSubmissionErrorMessage', () => {
  const api = (status: number, data: unknown) => new MeetCalApiError('failed', status, JSON.stringify(data));

  it('tells the user what happened', () => {
    expect(meetSubmissionErrorMessage(api(429, { status: 429, error: 'at most 5' }))).toBe('You can send 5 meets a day. Try again tomorrow.');
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
