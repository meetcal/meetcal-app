import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { escapeHtml } from './email';
import { apiError, isValidIsoDate } from './validation';

// Meet submissions (`convex/meetSubmissions.ts`): the checks, the email and
// the delete, apart from the functions so the app's form and the tests share
// them. The app mirrors the limits in `src/lib/meet-submission.ts`.

export const MAX_MEET_SUBMISSION_FILES = 10;
export const MAX_MEET_SUBMISSION_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_MEET_SUBMISSIONS_PER_DAY = 5;
/** Upload URLs one user may ask for a day: every file of a full day's submissions. */
export const MAX_MEET_SUBMISSION_UPLOAD_URLS_PER_DAY = MAX_MEET_SUBMISSION_FILES * MAX_MEET_SUBMISSIONS_PER_DAY;
export const MAX_MEET_SUBMISSION_NAME_LEN = 200;
export const MAX_MEET_SUBMISSION_FILE_NAME_LEN = 200;
export const MAX_MEET_SUBMISSION_EMAIL_LEN = 254;
/** Schedules and start lists come as PDFs, photos, spreadsheets and Word documents. */
export const MEET_SUBMISSION_FILE_EXTENSIONS = ['pdf', 'jpg', 'jpeg', 'png', 'heic', 'heif', 'webp', 'xlsx', 'xls', 'csv', 'doc', 'docx'] as const;

export const DAY_MS = 24 * 60 * 60 * 1000;
/** How long a submission and its files are kept; the email's links work until then. */
export const MEET_SUBMISSION_RETENTION_DAYS = 30;
export const MEET_SUBMISSION_RETENTION_MS = MEET_SUBMISSION_RETENTION_DAYS * DAY_MS;
/** An upload this old that is in no submission was abandoned. */
export const ORPHAN_UPLOAD_MS = DAY_MS;
/** Rows (or stored files) one cleanup run looks at per kind; a full batch schedules the next. */
export const MEET_SUBMISSION_CLEANUP_BATCH = 100;
/** Waits before each retry of a failed email; after the last, the failure is thrown. */
export const MEET_SUBMISSION_EMAIL_RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000] as const;

export type MeetSubmissionFileArg = { storageId: string; name: string };

export type CheckedMeetSubmission = {
  meetName: string;
  startDate: string;
  endDate?: string;
  contactEmail?: string;
  files: MeetSubmissionFileArg[];
};

const EMAIL = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/;

/** A file name's extension, lower case, or '' for none. */
export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot <= 0 || dot === name.length - 1 ? '' : name.slice(dot + 1).toLowerCase();
}

export function isAcceptedFileName(name: string): boolean {
  return (MEET_SUBMISSION_FILE_EXTENSIONS as readonly string[]).includes(fileExtension(name));
}

function length(text: string): number {
  return Array.from(text).length;
}

/**
 * A submission's arguments, trimmed and checked, before anything is read:
 * a 400 for each thing a client should have caught. Blank optional fields
 * read as absent.
 */
export function checkMeetSubmission(args: {
  meetName: string;
  startDate: string;
  endDate?: string | null;
  contactEmail?: string | null;
  files: MeetSubmissionFileArg[];
}): CheckedMeetSubmission {
  const meetName = args.meetName.trim();
  if (meetName === '') throw apiError(400, 'meet name is required');
  if (length(meetName) > MAX_MEET_SUBMISSION_NAME_LEN) {
    throw apiError(400, `meet name is longer than ${MAX_MEET_SUBMISSION_NAME_LEN} characters`, { max: MAX_MEET_SUBMISSION_NAME_LEN });
  }
  const startDate = args.startDate.trim();
  if (!isValidIsoDate(startDate)) throw apiError(400, 'start date must be a date (YYYY-MM-DD)');
  const endDate = args.endDate?.trim() || undefined;
  if (endDate !== undefined) {
    if (!isValidIsoDate(endDate)) throw apiError(400, 'end date must be a date (YYYY-MM-DD)');
    if (endDate < startDate) throw apiError(400, 'end date is before the start date');
  }
  const contactEmail = args.contactEmail?.trim() || undefined;
  if (contactEmail !== undefined && (contactEmail.length > MAX_MEET_SUBMISSION_EMAIL_LEN || !EMAIL.test(contactEmail))) {
    throw apiError(400, 'contact email is not an email address');
  }
  if (args.files.length === 0) throw apiError(400, 'at least one file is required');
  if (args.files.length > MAX_MEET_SUBMISSION_FILES) {
    throw apiError(400, `at most ${MAX_MEET_SUBMISSION_FILES} files`, { max: MAX_MEET_SUBMISSION_FILES });
  }
  const seen = new Set<string>();
  const files = args.files.map(({ storageId, name }) => {
    const trimmed = name.trim();
    if (trimmed === '') throw apiError(400, 'file name is required');
    if (length(trimmed) > MAX_MEET_SUBMISSION_FILE_NAME_LEN) {
      throw apiError(400, `file name is longer than ${MAX_MEET_SUBMISSION_FILE_NAME_LEN} characters`, { max: MAX_MEET_SUBMISSION_FILE_NAME_LEN });
    }
    if (!isAcceptedFileName(trimmed)) throw apiError(400, `file type not accepted: ${trimmed}`);
    if (seen.has(storageId)) throw apiError(400, 'the same file is listed twice');
    seen.add(storageId);
    return { storageId, name: trimmed };
  });
  return { meetName, startDate, endDate, contactEmail, files };
}

export type MeetSubmissionEmailContent = {
  meetName: string;
  startDate: string;
  endDate?: string;
  contactEmail?: string;
  userId: string;
  createdAt: number;
  files: { name: string; size: number; url: string | null }[];
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The email for a submission: what was sent, by whom, and a link to each file. */
export function renderMeetSubmissionEmail(content: MeetSubmissionEmailContent): { subject: string; html: string } {
  const dates = content.endDate && content.endDate !== content.startDate ? `${content.startDate} to ${content.endDate}` : content.startDate;
  const expires = new Date(content.createdAt + MEET_SUBMISSION_RETENTION_MS).toISOString().slice(0, 10);
  const files = content.files
    .map((file) =>
      file.url === null
        ? `<li>${escapeHtml(file.name)} (${formatBytes(file.size)}): no longer stored</li>`
        : `<li><a href="${escapeHtml(file.url)}">${escapeHtml(file.name)}</a> (${formatBytes(file.size)})</li>`,
    )
    .join('');
  const from = content.contactEmail ? escapeHtml(content.contactEmail) : 'no email given';
  const html =
    `<p><b>Meet:</b> ${escapeHtml(content.meetName)}<br><b>Dates:</b> ${escapeHtml(dates)}</p>` +
    `<p><b>From:</b> ${from} (${escapeHtml(content.userId)})<br><b>Sent:</b> ${new Date(content.createdAt).toISOString()}</p>` +
    `<ul>${files}</ul>` +
    `<p>The links work until ${expires}, when the files are deleted.</p>`;
  return { subject: `Meet submission: ${content.meetName} (${dates})`, html };
}

/** Deletes a submission, its file rows and its stored files. */
export async function deleteMeetSubmission(ctx: MutationCtx, submissionId: Id<'meet_submissions'>): Promise<void> {
  const files = await ctx.db
    .query('meet_submission_files')
    .withIndex('by_submissionId', (q) => q.eq('submissionId', submissionId))
    .take(MAX_MEET_SUBMISSION_FILES);
  for (const file of files) {
    if (await ctx.db.system.get('_storage', file.storageId)) await ctx.storage.delete(file.storageId);
    await ctx.db.delete(file._id);
  }
  await ctx.db.delete(submissionId);
}
