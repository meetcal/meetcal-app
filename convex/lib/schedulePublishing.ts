import { isoDateOf } from './dates';
import { escapeHtml } from './email';
import { meetDays } from './scheduleBuilderOptions';
import type { BuiltGroup, BuiltSchedule, RowTimes } from './scheduleBuilder';

export const MAX_PUBLISHES_PER_DAY = 10;
export const REVIEW_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type PublicationStatus = 'pending' | 'live' | 'approved' | 'rejected' | 'superseded' | 'expired';

export const PENDING_PUBLICATION_DAYS = 14;

export type PublishedScheduleRow = { date: string; sessionId: number; startTime: string; weighInTime: string; platform: string; weightClass: string };
export type Placement = { memberId: string; name: string; sessionNumber: number; platform: string; rosterId?: string };
export type PublishedSchedule = { rows: PublishedScheduleRow[]; placements: Placement[] };

const AGE_GROUP_LABELS: Record<BuiltGroup['ageGroup'], string> = { youth: ' (Youth)', masters: ' (Masters)', open: '', '': '' };
const GENDER_LETTERS: Record<string, string> = { Female: 'W', Male: 'M' };

export function platformLabel(group: Pick<BuiltGroup, 'gender' | 'weightClasses' | 'split' | 'ageGroup'>): string {
  const gender = GENDER_LETTERS[group.gender] ?? group.gender;
  const split = group.split ? ` ${group.split}` : '';
  return `${gender} ${group.weightClasses.join(', ')}${split}${AGE_GROUP_LABELS[group.ageGroup]}`;
}

export function labelOf(group: Pick<BuiltGroup, 'gender' | 'weightClasses' | 'split' | 'ageGroup' | 'publishedRows'>): string {
  if (!group.publishedRows || group.publishedRows.length === 0) return platformLabel(group);
  return [...new Set(group.publishedRows.map((row) => row.weightClass))].join(' / ');
}

export function timesOf(session: RowTimes, group: Pick<BuiltGroup, 'times'>): RowTimes {
  return group.times ?? { date: session.date, startTime: session.startTime, weighInTime: session.weighInTime };
}

export function publishProblem(schedule: BuiltSchedule, meet: { startDate: string; endDate: string }): string | null {
  if (schedule.athletes === 0 || schedule.sessions.length === 0) return 'the meet has no entrants to publish yet';
  const days = meetDays(meet.startDate, meet.endDate);
  const outside = schedule.sessions.find((s) => s.date !== '' && days.length > 0 && !days.includes(s.date));
  if (outside) return `session ${outside.number} is on ${outside.date}, which is not one of the meet's days`;
  const unscheduled = schedule.sessions.filter((s) => s.startTime === '').length;
  if (unscheduled > 0) return `${unscheduled} session${unscheduled === 1 ? ' has' : 's have'} no time; fit every session into the meet's days before publishing`;
  return null;
}

export function publishedSchedule(schedule: BuiltSchedule): PublishedSchedule {
  const rows: PublishedScheduleRow[] = [];
  const placements: Placement[] = [];
  for (const session of schedule.sessions) {
    for (const group of session.groups) {
      const written = group.publishedRows ?? [{ ...timesOf(session, group), weightClass: labelOf(group) }];
      for (const row of written) rows.push({ ...row, sessionId: session.number, platform: group.platform });
      for (const athlete of group.athletes) {
        const placement = { memberId: athlete.memberId, name: athlete.name, sessionNumber: session.number, platform: group.platform };
        placements.push(athlete.rosterId === undefined ? placement : { ...placement, rosterId: athlete.rosterId });
      }
    }
  }
  return { rows, placements };
}

export type ChangeNames = { added: readonly string[]; removed: readonly string[] };

export type PublicationEmailContent = {
  meet: string;
  status: PublicationStatus;
  contactEmail?: string;
  userId: string;
  schedule: BuiltSchedule;
  changes: ChangeNames;
  lastLiveAt: number | null;
  hasSchedule: boolean;
  reviewUrl?: string;
};

function ownStart(session: RowTimes, group: Pick<BuiltGroup, 'times'>): string {
  const times = timesOf(session, group);
  if (times.startTime === session.startTime && times.date === session.date) return '';
  return ` at ${escapeHtml(times.startTime.slice(0, 5))}, weigh-in ${escapeHtml(times.weighInTime.slice(0, 5))}`;
}

function sessionLines(schedule: BuiltSchedule): string {
  return schedule.sessions
    .map((session) => {
      const platforms = session.groups.map((g) => `${escapeHtml(g.platform)}${ownStart(session, g)}: ${escapeHtml(labelOf(g))} (${g.athletes.length})`).join('; ');
      return `<li>Session ${session.number}, ${escapeHtml(session.date)} ${escapeHtml(session.startTime.slice(0, 5))}: ${platforms}</li>`;
    })
    .join('');
}

function changeLines({ added, removed }: ChangeNames): string {
  const line = (what: string, names: readonly string[]) => (names.length > 0 ? `<p>${what}: ${escapeHtml(names.join(', '))}.</p>` : '');
  return line('Adds to the start list', added) + line('Takes off the start list', removed);
}

export function renderPublicationEmail(content: PublicationEmailContent): { subject: string; html: string } {
  const from = content.contactEmail ? escapeHtml(content.contactEmail) : 'no email given';
  const warnings = content.schedule.warnings.length ? `<p>Warnings:</p><ul>${content.schedule.warnings.map((w) => `<li>${escapeHtml(w.message)}</li>`).join('')}</ul>` : '';
  const summary = `<p>${escapeHtml(content.meet)}: ${content.schedule.athletes} athletes in ${content.schedule.sessions.length} sessions, from ${from} (${escapeHtml(content.userId)}).</p>${changeLines(content.changes)}${warnings}<ul>${sessionLines(content.schedule)}</ul>`;
  if (content.status === 'live') {
    return { subject: `Schedule updated: ${content.meet}`, html: `<p>The meet's organizer published a new schedule. It is live.</p>${summary}` };
  }
  const link = content.reviewUrl ? `<p><a href="${escapeHtml(content.reviewUrl)}">Review it to approve or reject</a></p>` : '';
  const context =
    content.lastLiveAt !== null
      ? `<p>Someone who is not this meet's organizer published a new schedule. The organizer's schedule went live on ${isoDateOf(content.lastLiveAt)}; approving replaces it and makes this publisher an organizer too.</p>`
      : content.hasSchedule
        ? "<p>A schedule was published for a meet that already has a schedule on MeetCal. Approving replaces the meet's current schedule and start list sessions, and makes this publisher its organizer.</p>"
        : '<p>A schedule was published for a meet with no organizer yet. It goes live once approved.</p>';
  return { subject: `Schedule to review: ${content.meet}`, html: `${context}${link}${summary}` };
}

export function reviewUrl(siteUrl: string, publicationId: string, token: string): string {
  return `${siteUrl.replace(/\/$/, '')}/schedule-builder/review?id=${encodeURIComponent(publicationId)}&token=${encodeURIComponent(token)}`;
}

const PAGE_STYLE = 'body{font-family:system-ui,sans-serif;max-width:720px;margin:24px auto;padding:0 16px;line-height:1.5}button{font-size:16px;padding:8px 16px;margin-right:8px}';

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title><style>${PAGE_STYLE}</style></head><body>${body}</body></html>`;
}

export type ReviewPageContent = {
  meet: string;
  status: PublicationStatus;
  contactEmail?: string;
  userId: string;
  schedule: BuiltSchedule;
  changes: ChangeNames;
  problem: string | null;
  lastLiveAt: number | null;
  hasSchedule: boolean;
  publicationId: string;
  token: string;
};

export function renderReviewPage(content: ReviewPageContent): string {
  const { html } = renderPublicationEmail({
    meet: content.meet,
    status: 'pending',
    ...(content.contactEmail ? { contactEmail: content.contactEmail } : {}),
    userId: content.userId,
    schedule: content.schedule,
    changes: content.changes,
    lastLiveAt: content.lastLiveAt,
    hasSchedule: content.hasSchedule,
  });
  const hidden = `<input type="hidden" name="id" value="${escapeHtml(content.publicationId)}"><input type="hidden" name="token" value="${escapeHtml(content.token)}">`;
  const approve = content.problem === null ? '<button name="decision" value="approve">Approve</button>' : '';
  const problem = content.problem === null ? '' : `<p><strong>${escapeHtml(content.problem)}</strong></p>`;
  const actions =
    content.status === 'pending'
      ? `${problem}<form method="post">${hidden}${approve}<button name="decision" value="reject">Reject</button></form>`
      : `<p>This schedule is already ${escapeHtml(content.status)}.</p>`;
  return page(`Review: ${content.meet}`, `<h1>Review Schedule</h1>${html}${actions}`);
}

export function renderReviewResult(message: string): string {
  return page('Schedule Review', `<h1>Schedule Review</h1><p>${escapeHtml(message)}</p>`);
}
