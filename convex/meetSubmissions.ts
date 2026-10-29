import { v } from 'convex/values';
import { internal } from './_generated/api';
import { internalAction, internalMutation, internalQuery, mutation, type MutationCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { sendEmail } from './lib/email';
import {
  DAY_MS,
  MAX_MEET_SUBMISSION_FILE_BYTES,
  MAX_MEET_SUBMISSION_UPLOAD_URLS_PER_DAY,
  MAX_MEET_SUBMISSIONS_PER_DAY,
  MEET_SUBMISSION_CLEANUP_BATCH,
  MEET_SUBMISSION_EMAIL_RETRY_DELAYS_MS,
  MEET_SUBMISSION_RETENTION_MS,
  ORPHAN_UPLOAD_MS,
  checkMeetSubmission,
  deleteMeetSubmission,
  renderMeetSubmissionEmail,
  type MeetSubmissionEmailContent,
} from './lib/meetSubmissions';
import { apiError } from './lib/validation';
import { requireUserId } from './users';

// Schedules and start lists users send for meets MeetCal does not cover yet,
// from the app's Settings (Submit a Meet) and meetcal.app/submit-meet. A
// signed-in user uploads each file to an upload URL (`generateUploadUrl`),
// then submits the meet with the files' storage ids (`submit`). The submission is stored
// first and emailed to `MEET_SUBMISSION_EMAIL` in the background (`email`),
// with a link to each file (OneSignal email has no attachments), so a failed
// send is retried rather than shown to the user. `cleanup` (daily, in
// `cronJobs.ts`) deletes submissions and their files after 30 days, and
// uploads that never became part of a submission after a day.
//
// Every file in this deployment's storage is a submission's: the cleanup
// deletes any stored file older than a day that no submission lists.

async function countSince(
  ctx: MutationCtx,
  table: 'meet_submissions' | 'meet_submission_upload_urls',
  userId: string,
  since: number,
  limit: number,
): Promise<number> {
  const rows = await ctx.db
    .query(table)
    .withIndex('by_userId_and_createdAt', (q) => q.eq('userId', userId).gt('createdAt', since))
    .take(limit);
  return rows.length;
}

async function requireSubmissionsLeft(ctx: MutationCtx, userId: string, now: number): Promise<void> {
  if ((await countSince(ctx, 'meet_submissions', userId, now - DAY_MS, MAX_MEET_SUBMISSIONS_PER_DAY)) >= MAX_MEET_SUBMISSIONS_PER_DAY) {
    throw apiError(429, `at most ${MAX_MEET_SUBMISSIONS_PER_DAY} meet submissions a day`, { max: MAX_MEET_SUBMISSIONS_PER_DAY });
  }
}

/**
 * A one-time URL to upload one file of a submission to: POST the file's
 * bytes with its Content-Type, and Convex answers `{ storageId }`. Refused
 * (429) once the user has sent the day's submissions or asked for the day's
 * upload URLs.
 */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx): Promise<{ uploadUrl: string }> => {
    const userId = await requireUserId(ctx);
    const now = Date.now();
    await requireSubmissionsLeft(ctx, userId, now);
    const urls = await countSince(ctx, 'meet_submission_upload_urls', userId, now - DAY_MS, MAX_MEET_SUBMISSION_UPLOAD_URLS_PER_DAY);
    if (urls >= MAX_MEET_SUBMISSION_UPLOAD_URLS_PER_DAY) {
      throw apiError(429, `at most ${MAX_MEET_SUBMISSION_UPLOAD_URLS_PER_DAY} uploads a day`, { max: MAX_MEET_SUBMISSION_UPLOAD_URLS_PER_DAY });
    }
    await ctx.db.insert('meet_submission_upload_urls', { userId, createdAt: now });
    return { uploadUrl: await ctx.storage.generateUploadUrl() };
  },
});

/**
 * Submits a meet: its name, dates (`YYYY-MM-DD`; `endDate` optional) and the
 * files uploaded for it (`{ storageId, name }`, 1 to 10, each at most 20 MB,
 * a PDF, image, spreadsheet or Word document by name). `contactEmail` is the
 * address the client has for the user, for the email's Reply-To. At most 5
 * a day per user. Answers `{ submitted: true }` once it is stored; the email
 * follows.
 */
export const submit = mutation({
  args: {
    meetName: v.string(),
    startDate: v.string(),
    endDate: v.optional(v.union(v.string(), v.null())),
    contactEmail: v.optional(v.union(v.string(), v.null())),
    files: v.array(v.object({ storageId: v.string(), name: v.string() })),
  },
  handler: async (ctx, args): Promise<{ submitted: true }> => {
    const checked = checkMeetSubmission(args);
    const userId = await requireUserId(ctx);
    const now = Date.now();
    await requireSubmissionsLeft(ctx, userId, now);
    const files: { storageId: Id<'_storage'>; name: string; size: number }[] = [];
    for (const file of checked.files) {
      const storageId = ctx.db.system.normalizeId('_storage', file.storageId);
      const stored = storageId === null ? null : await ctx.db.system.get('_storage', storageId);
      if (storageId === null || stored === null) throw apiError(400, `file not uploaded: ${file.name}`);
      if (stored.size > MAX_MEET_SUBMISSION_FILE_BYTES) {
        throw apiError(413, `file is larger than 20 MB: ${file.name}`, { max: MAX_MEET_SUBMISSION_FILE_BYTES });
      }
      const claimed = await ctx.db
        .query('meet_submission_files')
        .withIndex('by_storageId', (q) => q.eq('storageId', storageId))
        .first();
      if (claimed) throw apiError(400, `file already submitted: ${file.name}`);
      files.push({ storageId, name: file.name, size: stored.size });
    }
    const submissionId = await ctx.db.insert('meet_submissions', {
      userId,
      contactEmail: checked.contactEmail,
      meetName: checked.meetName,
      startDate: checked.startDate,
      endDate: checked.endDate,
      createdAt: now,
    });
    for (const file of files) await ctx.db.insert('meet_submission_files', { submissionId, ...file });
    await ctx.scheduler.runAfter(0, internal.meetSubmissions.email, { submissionId, attempt: 0 });
    return { submitted: true };
  },
});

/** What the email needs: the submission and a link to each file. Null once deleted. */
export const emailContent = internalQuery({
  args: { submissionId: v.id('meet_submissions') },
  handler: async (ctx, { submissionId }): Promise<(MeetSubmissionEmailContent & { emailedAt?: number }) | null> => {
    const submission = await ctx.db.get(submissionId);
    if (!submission) return null;
    const rows = await ctx.db
      .query('meet_submission_files')
      .withIndex('by_submissionId', (q) => q.eq('submissionId', submissionId))
      .collect();
    const files = [];
    for (const row of rows) files.push({ name: row.name, size: row.size, url: await ctx.storage.getUrl(row.storageId) });
    const { meetName, startDate, endDate, contactEmail, userId, createdAt, emailedAt } = submission;
    return { meetName, startDate, endDate, contactEmail, userId, createdAt, emailedAt, files };
  },
});

export const markEmailed = internalMutation({
  args: { submissionId: v.id('meet_submissions'), emailedAt: v.number() },
  handler: async (ctx, { submissionId, emailedAt }) => {
    if (await ctx.db.get(submissionId)) await ctx.db.patch(submissionId, { emailedAt });
  },
});

/**
 * Emails a submission to `MEET_SUBMISSION_EMAIL`, Reply-To the submitter.
 * A failed send is tried again after each of
 * MEET_SUBMISSION_EMAIL_RETRY_DELAYS_MS; the last failure is thrown, so it
 * shows in the logs and Sentry. Without `MEET_SUBMISSION_EMAIL` it is only
 * logged. Sends nothing for a submission already emailed or deleted.
 *
 *   npx convex run meetSubmissions:email '{"submissionId":"…","attempt":0}'
 */
export const email = internalAction({
  args: { submissionId: v.id('meet_submissions'), attempt: v.number() },
  handler: async (ctx, { submissionId, attempt }) => {
    const to = process.env.MEET_SUBMISSION_EMAIL;
    if (!to) {
      console.warn(`meet submission ${submissionId}: MEET_SUBMISSION_EMAIL is not set, so it was not emailed`);
      return;
    }
    const content = await ctx.runQuery(internal.meetSubmissions.emailContent, { submissionId });
    if (!content || content.emailedAt !== undefined) return;
    const { subject, html } = renderMeetSubmissionEmail(content);
    try {
      await sendEmail(to, subject, html, { replyTo: content.contactEmail });
    } catch (error) {
      const delay = MEET_SUBMISSION_EMAIL_RETRY_DELAYS_MS[attempt];
      if (delay === undefined) throw error;
      console.warn(`meet submission ${submissionId}: email failed (attempt ${attempt + 1}), retrying in ${delay / 1000}s:`, error);
      await ctx.scheduler.runAfter(delay, internal.meetSubmissions.email, { submissionId, attempt: attempt + 1 });
      return;
    }
    await ctx.runMutation(internal.meetSubmissions.markEmailed, { submissionId, emailedAt: Date.now() });
  },
});

/**
 * One pass of the cleanup: submissions past MEET_SUBMISSION_RETENTION_MS with
 * their files, upload-URL records past a day, and stored files older than a
 * day that no submission lists, from `after` (a stored file's creation time)
 * on. Each kind at most MEET_SUBMISSION_CLEANUP_BATCH; a full batch schedules
 * the next pass.
 */
async function cleanupPass(ctx: MutationCtx, now: number, after: number | null) {
  const expired = await ctx.db
    .query('meet_submissions')
    .withIndex('by_createdAt', (q) => q.lt('createdAt', now - MEET_SUBMISSION_RETENTION_MS))
    .take(MEET_SUBMISSION_CLEANUP_BATCH);
  for (const submission of expired) await deleteMeetSubmission(ctx, submission._id);

  const urls = await ctx.db
    .query('meet_submission_upload_urls')
    .withIndex('by_createdAt', (q) => q.lt('createdAt', now - DAY_MS))
    .take(MEET_SUBMISSION_CLEANUP_BATCH);
  for (const row of urls) await ctx.db.delete(row._id);

  const cutoff = now - ORPHAN_UPLOAD_MS;
  const stored = await ctx.db.system
    .query('_storage')
    .withIndex('by_creation_time', (q) => (after === null ? q.lt('_creationTime', cutoff) : q.gt('_creationTime', after).lt('_creationTime', cutoff)))
    .take(MEET_SUBMISSION_CLEANUP_BATCH);
  let orphans = 0;
  for (const file of stored) {
    const listed = await ctx.db
      .query('meet_submission_files')
      .withIndex('by_storageId', (q) => q.eq('storageId', file._id))
      .first();
    if (listed) continue;
    await ctx.storage.delete(file._id);
    orphans += 1;
  }

  const more = [expired, urls, stored].some((rows) => rows.length === MEET_SUBMISSION_CLEANUP_BATCH);
  const last = stored[stored.length - 1];
  if (more) await ctx.scheduler.runAfter(0, internal.meetSubmissions.cleanupFrom, { now, after: last ? last._creationTime : after });
  return { submissions: expired.length, uploadUrls: urls.length, orphans, more };
}

/** The daily cleanup (`cronJobs.ts`). */
export const cleanup = internalMutation({
  args: {},
  handler: async (ctx) => await cleanupPass(ctx, Date.now(), null),
});

/** The cleanup's next pass, after one that hit its batch limit. */
export const cleanupFrom = internalMutation({
  args: { now: v.number(), after: v.union(v.number(), v.null()) },
  handler: async (ctx, { now, after }) => await cleanupPass(ctx, now, after),
});
