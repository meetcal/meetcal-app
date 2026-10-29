import {
  generateMeetSubmissionUploadUrl,
  MeetCalApiError,
  MeetCalApiTimeoutError,
  submitMeet,
  type MeetSubmissionBody,
} from '@/lib/api/meetcal-api';

// Sending a schedule or start list for a meet MeetCal does not cover yet
// (`convex/meetSubmissions.ts`): the form's checks, the uploads and the
// submit, apart from the screen. The limits mirror the server's
// (`convex/lib/meetSubmissions.ts`); a test keeps them equal.

/** The form's screen, opened from the meet picker. */
export const SUBMIT_MEET_ROUTE = '/schedule-toolbar/submit-meet';

export const MAX_MEET_SUBMISSION_FILES = 10;
export const MAX_MEET_SUBMISSION_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_MEET_SUBMISSIONS_PER_DAY = 5;
export const MAX_MEET_SUBMISSION_NAME_LEN = 200;
export const MAX_MEET_SUBMISSION_FILE_NAME_LEN = 200;
export const MEET_SUBMISSION_FILE_EXTENSIONS = ['pdf', 'jpg', 'jpeg', 'png', 'heic', 'heif', 'webp', 'xlsx', 'xls', 'csv', 'doc', 'docx'] as const;

/** The document picker's filter: the types above. */
export const MEET_SUBMISSION_PICKER_TYPES = [
  'application/pdf',
  'image/*',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'text/comma-separated-values',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

/** One file's upload, from reading it off the device to Convex's answer. */
export const MEET_SUBMISSION_UPLOAD_TIMEOUT_MS = 120_000;

const CONTENT_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  heic: 'image/heic',
  heif: 'image/heif',
  webp: 'image/webp',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  csv: 'text/csv',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

/** A file the user picked: the document picker's asset, as far as the upload needs it. */
export interface PickedFile {
  uri: string;
  name: string;
  mimeType: string | null;
  /** Bytes; null when the picker could not tell. */
  size: number | null;
}

export interface MeetSubmissionForm {
  meetName: string;
  /** As typed, `MM/DD/YYYY`. */
  startDate: string;
  /** As typed, `MM/DD/YYYY`; blank for a one-day meet. */
  endDate: string;
  files: PickedFile[];
}

export interface CheckedMeetSubmissionForm {
  meetName: string;
  startDate: string;
  endDate: string | null;
  files: PickedFile[];
}

/** A file name's extension, lower case, or '' for none. */
export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot <= 0 || dot === name.length - 1 ? '' : name.slice(dot + 1).toLowerCase();
}

export function isAcceptedFileName(name: string): boolean {
  return (MEET_SUBMISSION_FILE_EXTENSIONS as readonly string[]).includes(fileExtension(name));
}

/** The Content-Type a file is uploaded with: the picker's, else its extension's. */
export function contentTypeFor(file: PickedFile): string {
  return file.mimeType || CONTENT_TYPES[fileExtension(file.name)] || 'application/octet-stream';
}

/** What the user typed in a date field, as `MM/DD/YYYY` while typing: digits only, slashes added. */
export function formatDateEntry(text: string): string {
  const digits = text.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

/**
 * A typed `MM/DD/YYYY` as the calendar date `YYYY-MM-DD`, or null when it is
 * not a real date. Text only: a meet's date is a calendar date, never read
 * through the device's time zone.
 */
export function parseUsDate(text: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text.trim());
  if (!match) return null;
  const [, mm, dd, yyyy] = match;
  const year = Number(yyyy);
  const month = Number(mm);
  const day = Number(dd);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (days === undefined || day < 1 || day > days || year < 1900) return null;
  return `${yyyy}-${mm}-${dd}`;
}

function formatMegabytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

/** The form checked as the server will check it, or the first thing to fix. */
export function checkMeetSubmissionForm(
  form: MeetSubmissionForm,
): { ok: true; value: CheckedMeetSubmissionForm } | { ok: false; error: string } {
  const meetName = form.meetName.trim();
  if (meetName === '') return { ok: false, error: 'Enter the meet name.' };
  if (Array.from(meetName).length > MAX_MEET_SUBMISSION_NAME_LEN) {
    return { ok: false, error: `The meet name can be at most ${MAX_MEET_SUBMISSION_NAME_LEN} characters.` };
  }
  const startDate = parseUsDate(form.startDate);
  if (startDate === null) return { ok: false, error: 'Enter the start date as MM/DD/YYYY.' };
  let endDate: string | null = null;
  if (form.endDate.trim() !== '') {
    endDate = parseUsDate(form.endDate);
    if (endDate === null) return { ok: false, error: 'Enter the end date as MM/DD/YYYY, or leave it blank.' };
    if (endDate < startDate) return { ok: false, error: 'The end date is before the start date.' };
  }
  if (form.files.length === 0) return { ok: false, error: 'Add at least one file.' };
  if (form.files.length > MAX_MEET_SUBMISSION_FILES) {
    return { ok: false, error: `Add at most ${MAX_MEET_SUBMISSION_FILES} files.` };
  }
  for (const file of form.files) {
    const name = file.name.trim();
    if (name === '' || Array.from(name).length > MAX_MEET_SUBMISSION_FILE_NAME_LEN) {
      return { ok: false, error: `Rename ${name || 'a file'}: its name must be 1 to ${MAX_MEET_SUBMISSION_FILE_NAME_LEN} characters.` };
    }
    if (!isAcceptedFileName(name)) {
      return { ok: false, error: `${name} isn't a PDF, image, spreadsheet or Word document.` };
    }
    if (file.size !== null && file.size > MAX_MEET_SUBMISSION_FILE_BYTES) {
      return { ok: false, error: `${name} is larger than ${formatMegabytes(MAX_MEET_SUBMISSION_FILE_BYTES)}.` };
    }
  }
  return { ok: true, value: { meetName, startDate, endDate, files: form.files.map((file) => ({ ...file, name: file.name.trim() })) } };
}

/** Thrown when a file could not be read off the device or Convex refused its upload. */
export class MeetSubmissionUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MeetSubmissionUploadError';
  }
}

/**
 * Uploads one file to an upload URL and answers its storage id. Reads the
 * file through `fetch(uri)` (React Native serves `file://` that way) and
 * POSTs it with its Content-Type, within MEET_SUBMISSION_UPLOAD_TIMEOUT_MS.
 */
export async function uploadMeetSubmissionFile(
  uploadUrl: string,
  file: PickedFile,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MEET_SUBMISSION_UPLOAD_TIMEOUT_MS);
  try {
    let blob: Blob;
    try {
      blob = await (await fetchImpl(file.uri, { signal: controller.signal })).blob();
    } catch {
      throw new MeetSubmissionUploadError(`Couldn't read ${file.name}.`);
    }
    if (blob.size > MAX_MEET_SUBMISSION_FILE_BYTES) {
      throw new MeetSubmissionUploadError(`${file.name} is larger than ${formatMegabytes(MAX_MEET_SUBMISSION_FILE_BYTES)}.`);
    }
    const response = await fetchImpl(uploadUrl, {
      method: 'POST',
      headers: { 'Content-Type': contentTypeFor(file) },
      body: blob,
      signal: controller.signal,
    });
    if (!response.ok) throw new MeetSubmissionUploadError(`Couldn't upload ${file.name} (${response.status}).`);
    let answer: unknown;
    try {
      answer = await response.json();
    } catch {
      throw new MeetSubmissionUploadError(`Couldn't upload ${file.name}: the answer was not JSON.`);
    }
    const storageId = typeof answer === 'object' && answer !== null ? (answer as { storageId?: unknown }).storageId : undefined;
    if (typeof storageId !== 'string' || storageId === '') {
      throw new MeetSubmissionUploadError(`Couldn't upload ${file.name}: no storage id in the answer.`);
    }
    return storageId;
  } finally {
    clearTimeout(timer);
  }
}

export interface MeetSubmissionDeps {
  generateUploadUrl: (token: string) => Promise<string>;
  uploadFile: (uploadUrl: string, file: PickedFile) => Promise<string>;
  submit: (token: string, body: MeetSubmissionBody) => Promise<void>;
}

const DEFAULT_DEPS: MeetSubmissionDeps = {
  generateUploadUrl: generateMeetSubmissionUploadUrl,
  uploadFile: (uploadUrl, file) => uploadMeetSubmissionFile(uploadUrl, file),
  submit: submitMeet,
};

/**
 * Uploads a checked form's files one at a time (each is read whole into
 * memory, so never all at once), then submits the meet. `onProgress` hears
 * each file as its upload starts (1-based).
 */
export async function sendMeetSubmission(
  token: string,
  form: CheckedMeetSubmissionForm,
  contactEmail: string | null,
  onProgress: (file: number, total: number) => void = () => {},
  deps: MeetSubmissionDeps = DEFAULT_DEPS,
): Promise<void> {
  const files: MeetSubmissionBody['files'] = [];
  for (const [index, file] of form.files.entries()) {
    onProgress(index + 1, form.files.length);
    const uploadUrl = await deps.generateUploadUrl(token);
    files.push({ storageId: await deps.uploadFile(uploadUrl, file), name: file.name });
  }
  await deps.submit(token, {
    meetName: form.meetName,
    startDate: form.startDate,
    endDate: form.endDate,
    contactEmail: contactEmail?.trim() || null,
    files,
  });
}

/** What to tell the user when sending failed. */
export function meetSubmissionErrorMessage(error: unknown): string {
  if (error instanceof MeetSubmissionUploadError) return error.message;
  if (error instanceof MeetCalApiTimeoutError) return "Couldn't reach MeetCal. Check your connection and try again.";
  if (error instanceof MeetCalApiError) {
    if (error.status === 429) return `You can send ${MAX_MEET_SUBMISSIONS_PER_DAY} meets a day. Try again tomorrow.`;
    if (error.status === 401) return 'Sign in again to send this meet.';
    if (error.status === 413) return `A file is larger than ${formatMegabytes(MAX_MEET_SUBMISSION_FILE_BYTES)}.`;
    if (error.status === 400) {
      const reason = serverReason(error.body);
      if (reason) return `${reason.charAt(0).toUpperCase()}${reason.slice(1)}.`;
    }
    return "MeetCal couldn't take this meet right now. Try again later.";
  }
  return "Couldn't send the meet. Check your connection and try again.";
}

/** The `error` text of a ConvexError body (`{ status, error }`), if it has one. */
function serverReason(body: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  const reason = typeof parsed === 'object' && parsed !== null ? (parsed as { error?: unknown }).error : undefined;
  return typeof reason === 'string' && reason.trim() !== '' ? reason.trim() : null;
}
