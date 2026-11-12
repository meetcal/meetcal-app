import { escapeHtml } from './email';
import type { BuiltGroup, BuiltSchedule } from './scheduleBuilder';

export const MAX_PUBLISHES_PER_DAY = 10;
export const REVIEW_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type PublicationStatus = 'pending' | 'live' | 'approved' | 'rejected' | 'superseded';

export type PublishedScheduleRow = { date: string; sessionId: number; startTime: string; weighInTime: string; platform: string; weightClass: string };
export type Placement = { memberId: string; name: string; sessionNumber: number; platform: string };
export type PublishedSchedule = { rows: PublishedScheduleRow[]; placements: Placement[] };

const AGE_GROUP_LABELS: Record<BuiltGroup['ageGroup'], string> = { youth: ' (Youth)', masters: ' (Masters)', open: '', '': '' };
const GENDER_LETTERS: Record<string, string> = { Female: 'W', Male: 'M' };

export function platformLabel(group: Pick<BuiltGroup, 'gender' | 'weightClasses' | 'split' | 'ageGroup'>): string {
  const gender = GENDER_LETTERS[group.gender] ?? group.gender;
  const split = group.split ? ` ${group.split}` : '';
  return `${gender} ${group.weightClasses.join(', ')}${split}${AGE_GROUP_LABELS[group.ageGroup]}`;
}

export function publishProblem(schedule: BuiltSchedule): string | null {
  if (schedule.athletes === 0 || schedule.sessions.length === 0) return 'the meet has no entrants to publish yet';
  const unscheduled = schedule.sessions.filter((s) => s.startTime === '').length;
  if (unscheduled > 0) return `${unscheduled} session${unscheduled === 1 ? ' has' : 's have'} no time; fit every session into the meet's days before publishing`;
  return null;
}

export function publishedSchedule(schedule: BuiltSchedule): PublishedSchedule {
  const rows: PublishedScheduleRow[] = [];
  const placements: Placement[] = [];
  for (const session of schedule.sessions) {
    for (const group of session.groups) {
      rows.push({ date: session.date, sessionId: session.number, startTime: session.startTime, weighInTime: session.weighInTime, platform: group.platform, weightClass: platformLabel(group) });
      for (const athlete of group.athletes) placements.push({ memberId: athlete.memberId, name: athlete.name, sessionNumber: session.number, platform: group.platform });
    }
  }
  return { rows, placements };
}

export type PublicationEmailContent = {
  meet: string;
  status: PublicationStatus;
  contactEmail?: string;
  userId: string;
  schedule: BuiltSchedule;
  reviewUrl?: string;
};

function sessionLines(schedule: BuiltSchedule): string {
  return schedule.sessions
    .map((session) => {
      const platforms = session.groups.map((g) => `${escapeHtml(g.platform)}: ${escapeHtml(platformLabel(g))} (${g.athletes.length})`).join('; ');
      return `<li>Session ${session.number}, ${escapeHtml(session.date)} ${escapeHtml(session.startTime.slice(0, 5))}: ${platforms}</li>`;
    })
    .join('');
}

export function renderPublicationEmail(content: PublicationEmailContent): { subject: string; html: string } {
  const from = content.contactEmail ? escapeHtml(content.contactEmail) : 'no email given';
  const warnings = content.schedule.warnings.length ? `<p>Warnings:</p><ul>${content.schedule.warnings.map((w) => `<li>${escapeHtml(w.message)}</li>`).join('')}</ul>` : '';
  const summary = `<p>${escapeHtml(content.meet)}: ${content.schedule.athletes} athletes in ${content.schedule.sessions.length} sessions, from ${from} (${escapeHtml(content.userId)}).</p>${warnings}<ul>${sessionLines(content.schedule)}</ul>`;
  if (content.status === 'live') {
    return { subject: `Schedule updated: ${content.meet}`, html: `<p>The meet's organizer published a new schedule. It is live.</p>${summary}` };
  }
  const link = content.reviewUrl ? `<p><a href="${escapeHtml(content.reviewUrl)}">Review it to approve or reject</a></p>` : '';
  return { subject: `Schedule to review: ${content.meet}`, html: `<p>A schedule was published for a meet with no organizer yet. It goes live once approved.</p>${link}${summary}` };
}

export function reviewUrl(siteUrl: string, publicationId: string, token: string): string {
  return `${siteUrl.replace(/\/$/, '')}/schedule-builder/review?id=${encodeURIComponent(publicationId)}&token=${encodeURIComponent(token)}`;
}

const PAGE_STYLE = 'body{font-family:system-ui,sans-serif;max-width:720px;margin:24px auto;padding:0 16px;line-height:1.5}button{font-size:16px;padding:8px 16px;margin-right:8px}';

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title><style>${PAGE_STYLE}</style></head><body>${body}</body></html>`;
}

export type ReviewPageContent = { meet: string; status: PublicationStatus; contactEmail?: string; userId: string; schedule: BuiltSchedule; publicationId: string; token: string };

export function renderReviewPage(content: ReviewPageContent): string {
  const { html } = renderPublicationEmail({ meet: content.meet, status: 'pending', ...(content.contactEmail ? { contactEmail: content.contactEmail } : {}), userId: content.userId, schedule: content.schedule });
  const hidden = `<input type="hidden" name="id" value="${escapeHtml(content.publicationId)}"><input type="hidden" name="token" value="${escapeHtml(content.token)}">`;
  const actions =
    content.status === 'pending'
      ? `<form method="post">${hidden}<button name="decision" value="approve">Approve</button><button name="decision" value="reject">Reject</button></form>`
      : `<p>This schedule is already ${escapeHtml(content.status)}.</p>`;
  return page(`Review: ${content.meet}`, `<h1>Review Schedule</h1>${html}${actions}`);
}

export function renderReviewResult(message: string): string {
  return page('Schedule Review', `<h1>Schedule Review</h1><p>${escapeHtml(message)}</p>`);
}
