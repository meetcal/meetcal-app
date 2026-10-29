import { ConvexError } from 'convex/values';
import { getFunctionName } from 'convex/server';
import { cleanup, email, emailContent, generateUploadUrl, submit } from '../convex/meetSubmissions';
import {
  checkMeetSubmission,
  DAY_MS,
  MAX_MEET_SUBMISSION_FILE_BYTES,
  MAX_MEET_SUBMISSION_FILES,
  MAX_MEET_SUBMISSION_UPLOAD_URLS_PER_DAY,
  MAX_MEET_SUBMISSIONS_PER_DAY,
  MEET_SUBMISSION_CLEANUP_BATCH,
  MEET_SUBMISSION_EMAIL_RETRY_DELAYS_MS,
  MEET_SUBMISSION_RETENTION_MS,
  renderMeetSubmissionEmail,
} from '../convex/lib/meetSubmissions';
import { sendEmail } from '../convex/lib/email';
import { fakeMutationCtx, handlerOf, type StoredFile } from './fakeDb';

jest.mock('../convex/lib/email', () => ({
  ...jest.requireActual('../convex/lib/email'),
  sendEmail: jest.fn(),
}));
const sendEmailMock = sendEmail as jest.MockedFunction<typeof sendEmail>;

const A = 'user_a';
const B = 'user_b';
const NOW = Date.UTC(2027, 0, 10, 12);
type Args = Record<string, unknown>;

beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  sendEmailMock.mockReset();
});
afterEach(() => jest.restoreAllMocks());

const file = (id: string, size = 1000, createdAt = NOW): StoredFile => ({ _id: `_storage:${id}`, _creationTime: createdAt, size });

function server(seed: Record<string, Record<string, unknown>[]> = {}, files: StoredFile[] = []) {
  const store = fakeMutationCtx(seed, files);
  const as = (subject: string | null) => {
    const ctx = { ...store.ctx, auth: { getUserIdentity: async () => (subject === null ? null : { subject }) } };
    return (fn: unknown, args: Args = {}) => handlerOf<Args>(fn)(ctx, args) as Promise<Record<string, unknown>>;
  };
  return { ...store, as };
}

async function failure(promise: Promise<unknown>): Promise<{ status: number; error: string } | 'ok'> {
  try {
    await promise;
    return 'ok';
  } catch (error) {
    if (error instanceof ConvexError) return error.data as { status: number; error: string };
    throw error;
  }
}

const meet = (extra: Args = {}) => ({
  meetName: '  2027 Example Open ',
  startDate: '2027-03-06',
  endDate: '2027-03-07',
  contactEmail: 'lifter@example.com',
  files: [{ storageId: '_storage:f1', name: 'Schedule.PDF' }],
  ...extra,
});

describe('checkMeetSubmission', () => {
  const check = (extra: Args = {}) => checkMeetSubmission(meet(extra) as Parameters<typeof checkMeetSubmission>[0]);
  const reason = (extra: Args) => {
    try {
      check(extra);
      return 'ok';
    } catch (error) {
      return (error as ConvexError<{ error: string }>).data.error;
    }
  };

  it('trims, and reads blank optional fields as absent', () => {
    expect(check({ endDate: ' ', contactEmail: null })).toEqual({
      meetName: '2027 Example Open',
      startDate: '2027-03-06',
      endDate: undefined,
      contactEmail: undefined,
      files: [{ storageId: '_storage:f1', name: 'Schedule.PDF' }],
    });
  });

  it('refuses what the form should have caught', () => {
    expect(reason({ meetName: '   ' })).toBe('meet name is required');
    expect(reason({ meetName: 'x'.repeat(201) })).toMatch(/longer than 200/);
    expect(reason({ startDate: '03/06/2027' })).toMatch(/start date/);
    expect(reason({ startDate: '2027-02-30' })).toMatch(/start date/);
    expect(reason({ endDate: '2027-03-05' })).toBe('end date is before the start date');
    expect(reason({ contactEmail: 'not an email' })).toMatch(/email/);
    expect(reason({ contactEmail: 'a@b.com\r\nBcc: c@d.com' })).toMatch(/email/);
    expect(reason({ files: [] })).toBe('at least one file is required');
    expect(reason({ files: Array.from({ length: MAX_MEET_SUBMISSION_FILES + 1 }, (_, i) => ({ storageId: `_storage:${i}`, name: 'a.pdf' })) })).toMatch(/at most 10/);
    expect(reason({ files: [{ storageId: '_storage:f1', name: 'run.exe' }] })).toBe('file type not accepted: run.exe');
    expect(reason({ files: [{ storageId: '_storage:f1', name: 'pdf' }] })).toBe('file type not accepted: pdf');
    expect(reason({ files: [{ storageId: '_storage:f1', name: 'a.pdf' }, { storageId: '_storage:f1', name: 'b.pdf' }] })).toMatch(/twice/);
    expect(reason({})).toBe('ok');
  });
});

describe('generateUploadUrl', () => {
  it('needs a signed-in user', async () => {
    const store = server();
    expect(await failure(store.as(null)(generateUploadUrl))).toMatchObject({ status: 401 });
    expect(store.rows('meet_submission_upload_urls')).toEqual([]);
  });

  it("records each URL and refuses past the day's limit", async () => {
    const store = server({
      meet_submission_upload_urls: Array.from({ length: MAX_MEET_SUBMISSION_UPLOAD_URLS_PER_DAY - 1 }, () => ({ userId: A, createdAt: NOW - 1000 })),
    });
    expect(await store.as(A)(generateUploadUrl)).toEqual({ uploadUrl: 'https://upload.example/0' });
    expect(await failure(store.as(A)(generateUploadUrl))).toMatchObject({ status: 429 });
    // Another user, and a day later, are not limited.
    expect(await store.as(B)(generateUploadUrl)).toEqual({ uploadUrl: 'https://upload.example/1' });
  });

  it("refuses once the day's submissions are sent", async () => {
    const store = server({
      meet_submissions: Array.from({ length: MAX_MEET_SUBMISSIONS_PER_DAY }, () => ({ userId: A, meetName: 'M', startDate: '2027-01-01', createdAt: NOW - DAY_MS + 1 })),
    });
    expect(await failure(store.as(A)(generateUploadUrl))).toMatchObject({ status: 429 });
  });
});

describe('submit', () => {
  it('stores the submission and its files, then schedules the email', async () => {
    const store = server({}, [file('f1', 2048), file('f2', 10)]);
    const files = [
      { storageId: '_storage:f1', name: 'Schedule.PDF' },
      { storageId: '_storage:f2', name: 'start list.xlsx' },
    ];
    expect(await store.as(A)(submit, meet({ files }))).toEqual({ submitted: true });
    const [row] = store.docs('meet_submissions');
    expect(row).toMatchObject({ userId: A, meetName: '2027 Example Open', startDate: '2027-03-06', endDate: '2027-03-07', contactEmail: 'lifter@example.com', createdAt: NOW });
    expect(store.rows('meet_submission_files')).toEqual([
      { submissionId: row._id, storageId: '_storage:f1', name: 'Schedule.PDF', size: 2048 },
      { submissionId: row._id, storageId: '_storage:f2', name: 'start list.xlsx', size: 10 },
    ]);
    expect(store.scheduled).toEqual([{ name: 'meetSubmissions:email', delayMs: 0, args: { submissionId: row._id, attempt: 0 } }]);
  });

  it('refuses a file that was not uploaded, is too large, or is already submitted', async () => {
    const store = server({}, [file('f1'), file('big', MAX_MEET_SUBMISSION_FILE_BYTES + 1)]);
    expect(await failure(store.as(A)(submit, meet({ files: [{ storageId: 'nope', name: 'a.pdf' }] })))).toMatchObject({ status: 400 });
    expect(await failure(store.as(A)(submit, meet({ files: [{ storageId: '_storage:gone', name: 'a.pdf' }] })))).toMatchObject({ status: 400 });
    expect(await failure(store.as(A)(submit, meet({ files: [{ storageId: '_storage:big', name: 'a.pdf' }] })))).toMatchObject({ status: 413 });
    expect(await store.as(A)(submit, meet())).toEqual({ submitted: true });
    expect(await failure(store.as(B)(submit, meet()))).toMatchObject({ status: 400, error: 'file already submitted: Schedule.PDF' });
    expect(store.rows('meet_submissions')).toHaveLength(1);
  });

  it('needs a signed-in user, checking the arguments first', async () => {
    const store = server({}, [file('f1')]);
    expect(await failure(store.as(null)(submit, meet()))).toMatchObject({ status: 401 });
    expect(await failure(store.as(null)(submit, meet({ meetName: '' })))).toMatchObject({ status: 400 });
    expect(store.rows('meet_submissions')).toEqual([]);
  });

  it('allows five a day per user', async () => {
    const recent = (userId: string, createdAt: number) => ({ userId, meetName: 'M', startDate: '2027-01-01', createdAt });
    const store = server(
      {
        meet_submissions: [
          ...Array.from({ length: MAX_MEET_SUBMISSIONS_PER_DAY - 1 }, () => recent(A, NOW - 1000)),
          // Older than a day: does not count.
          recent(A, NOW - DAY_MS - 1),
        ],
      },
      [file('f1'), file('f2')],
    );
    expect(await store.as(A)(submit, meet())).toEqual({ submitted: true });
    expect(await failure(store.as(A)(submit, meet({ files: [{ storageId: '_storage:f2', name: 'a.pdf' }] })))).toMatchObject({ status: 429 });
  });
});

describe('the email', () => {
  const content = {
    meetName: '<b>Open</b>',
    startDate: '2027-03-06',
    endDate: '2027-03-07',
    contactEmail: 'lifter@example.com',
    userId: A,
    createdAt: NOW,
    files: [
      { name: 'a&b.pdf', size: 2 * 1024 * 1024, url: 'https://files.example/_storage:f1?x="1"' },
      { name: 'gone.pdf', size: 10, url: null },
    ],
  };

  it('escapes what the user typed and links each file until it is deleted', () => {
    const { subject, html } = renderMeetSubmissionEmail(content);
    expect(subject).toBe('Meet submission: <b>Open</b> (2027-03-06 to 2027-03-07)');
    expect(html).toContain('&lt;b&gt;Open&lt;/b&gt;');
    expect(html).not.toContain('<b>Open</b>');
    expect(html).toContain('<a href="https://files.example/_storage:f1?x=&quot;1&quot;">a&amp;b.pdf</a> (2.0 MB)');
    expect(html).toContain('gone.pdf (10 B): no longer stored');
    expect(html).toContain('lifter@example.com');
    expect(html).toContain(`until ${new Date(NOW + MEET_SUBMISSION_RETENTION_MS).toISOString().slice(0, 10)}`);
    expect(renderMeetSubmissionEmail({ ...content, endDate: undefined }).subject).toBe('Meet submission: <b>Open</b> (2027-03-06)');
  });

  function actionCtx(found: unknown) {
    const scheduled: { name: string; delayMs: number; args: unknown }[] = [];
    const mutations: { name: string; args: unknown }[] = [];
    return {
      scheduled,
      mutations,
      ctx: {
        runQuery: async () => found,
        runMutation: async (fn: unknown, args: unknown) => {
          mutations.push({ name: getFunctionName(fn as never), args });
        },
        scheduler: {
          runAfter: async (delayMs: number, fn: unknown, args: unknown) => {
            scheduled.push({ name: getFunctionName(fn as never), delayMs, args });
          },
        },
      },
    };
  }
  const run = handlerOf<{ submissionId: string; attempt: number }>(email);
  const withRecipient = async (to: string | undefined, body: () => Promise<void>) => {
    const previous = process.env.MEET_SUBMISSION_EMAIL;
    if (to === undefined) delete process.env.MEET_SUBMISSION_EMAIL;
    else process.env.MEET_SUBMISSION_EMAIL = to;
    try {
      await body();
    } finally {
      if (previous === undefined) delete process.env.MEET_SUBMISSION_EMAIL;
      else process.env.MEET_SUBMISSION_EMAIL = previous;
    }
  };

  it('sends to MEET_SUBMISSION_EMAIL with Reply-To the submitter, then marks it emailed', () =>
    withRecipient('owner@example.com', async () => {
      sendEmailMock.mockResolvedValue('n1');
      const { ctx, mutations } = actionCtx(content);
      await run(ctx, { submissionId: 's1', attempt: 0 });
      expect(sendEmailMock).toHaveBeenCalledWith('owner@example.com', expect.stringContaining('Meet submission'), expect.any(String), { replyTo: 'lifter@example.com' });
      expect(mutations).toEqual([{ name: 'meetSubmissions:markEmailed', args: { submissionId: 's1', emailedAt: NOW } }]);
    }));

  it('retries a failed send after each delay, then throws', () =>
    withRecipient('owner@example.com', async () => {
      sendEmailMock.mockRejectedValue(new Error('OneSignal email failed (500)'));
      jest.spyOn(console, 'warn').mockImplementation(() => {});
      for (const [attempt, delay] of MEET_SUBMISSION_EMAIL_RETRY_DELAYS_MS.entries()) {
        const { ctx, scheduled, mutations } = actionCtx(content);
        await run(ctx, { submissionId: 's1', attempt });
        expect(scheduled).toEqual([{ name: 'meetSubmissions:email', delayMs: delay, args: { submissionId: 's1', attempt: attempt + 1 } }]);
        expect(mutations).toEqual([]);
      }
      const { ctx } = actionCtx(content);
      await expect(run(ctx, { submissionId: 's1', attempt: MEET_SUBMISSION_EMAIL_RETRY_DELAYS_MS.length })).rejects.toThrow('OneSignal email failed');
    }));

  it('sends nothing without a recipient, or for a submission emailed or deleted', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    await withRecipient(undefined, async () => {
      await run(actionCtx(content).ctx, { submissionId: 's1', attempt: 0 });
    });
    await withRecipient('owner@example.com', async () => {
      await run(actionCtx({ ...content, emailedAt: 1 }).ctx, { submissionId: 's1', attempt: 0 });
      await run(actionCtx(null).ctx, { submissionId: 's1', attempt: 0 });
    });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("reads the submission with a link to each stored file", async () => {
    const store = server({}, [file('f1')]);
    const submissionId = await store.db.insert('meet_submissions', { userId: A, meetName: 'Open', startDate: '2027-03-06', createdAt: NOW });
    await store.db.insert('meet_submission_files', { submissionId, storageId: '_storage:f1', name: 'a.pdf', size: 1000 });
    await store.db.insert('meet_submission_files', { submissionId, storageId: '_storage:gone', name: 'b.pdf', size: 5 });
    expect(await handlerOf(emailContent)(store.ctx, { submissionId })).toEqual({
      meetName: 'Open',
      startDate: '2027-03-06',
      endDate: undefined,
      contactEmail: undefined,
      userId: A,
      createdAt: NOW,
      emailedAt: undefined,
      files: [
        { name: 'a.pdf', size: 1000, url: 'https://files.example/_storage:f1' },
        { name: 'b.pdf', size: 5, url: null },
      ],
    });
  });
});

describe('cleanup', () => {
  const run = handlerOf<Args, Record<string, unknown>>(cleanup);

  it('deletes expired submissions with their files, old upload records, and abandoned uploads', async () => {
    const store = server({}, [
      file('expired', 1, NOW - MEET_SUBMISSION_RETENTION_MS - 10),
      file('kept', 1, NOW - 2 * DAY_MS),
      file('orphan', 1, NOW - DAY_MS - 1),
      file('fresh', 1, NOW - 1000),
    ]);
    const expired = await store.db.insert('meet_submissions', { userId: A, meetName: 'Old', startDate: '2026-01-01', createdAt: NOW - MEET_SUBMISSION_RETENTION_MS - 1 });
    await store.db.insert('meet_submission_files', { submissionId: expired, storageId: '_storage:expired', name: 'a.pdf', size: 1 });
    const kept = await store.db.insert('meet_submissions', { userId: A, meetName: 'New', startDate: '2027-01-01', createdAt: NOW - 2 * DAY_MS });
    await store.db.insert('meet_submission_files', { submissionId: kept, storageId: '_storage:kept', name: 'b.pdf', size: 1 });
    await store.db.insert('meet_submission_upload_urls', { userId: A, createdAt: NOW - DAY_MS - 1 });
    await store.db.insert('meet_submission_upload_urls', { userId: A, createdAt: NOW - 1000 });

    expect(await run(store.ctx, {})).toEqual({ submissions: 1, uploadUrls: 1, orphans: 1, more: false });
    expect(store.rows('meet_submissions').map((r) => r.meetName)).toEqual(['New']);
    expect(store.rows('meet_submission_files').map((r) => r.storageId)).toEqual(['_storage:kept']);
    expect(store.rows('meet_submission_upload_urls')).toEqual([{ userId: A, createdAt: NOW - 1000 }]);
    expect(store.storedIds().sort()).toEqual(['_storage:fresh', '_storage:kept']);
    expect(store.scheduled).toEqual([]);
  });

  it('continues past a full batch from the last stored file it read', async () => {
    const files = Array.from({ length: MEET_SUBMISSION_CLEANUP_BATCH + 2 }, (_, i) => file(`o${i}`, 1, NOW - 2 * DAY_MS + i));
    const store = server({}, files);
    expect(await run(store.ctx, {})).toMatchObject({ orphans: MEET_SUBMISSION_CLEANUP_BATCH, more: true });
    expect(store.scheduled).toEqual([
      { name: 'meetSubmissions:cleanupFrom', delayMs: 0, args: { now: NOW, after: NOW - 2 * DAY_MS + MEET_SUBMISSION_CLEANUP_BATCH - 1 } },
    ]);
    expect(store.storedIds()).toHaveLength(2);
  });
});
