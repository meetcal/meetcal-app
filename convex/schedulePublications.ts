import { ConvexError, v } from 'convex/values';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { httpAction, internalAction, internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import { writeBuiltSchedule } from './ingest/rosters';
import { requireUserId } from './lib/access';
import { DAY_MS } from './lib/dates';
import { EMAIL_RETRY_DELAYS_MS, sendEmail } from './lib/email';
import { checkContactEmail } from './lib/meetSubmissions';
import { buildFromPublished, unlistedRemovals, type BuiltSchedule, type RosterChanges } from './lib/scheduleBuilder';
import { baseVersionValidator, builderEditValidator, builderOptionsValidator, scheduleBaseValidator } from './lib/scheduleBuilderOptions';
import { meetByName } from './lib/meetData';
import {
  MAX_PUBLISHES_PER_DAY,
  PENDING_PUBLICATION_DAYS,
  publishedSchedule,
  publishProblem,
  renderPublicationEmail,
  renderReviewPage,
  renderReviewResult,
  REVIEW_TOKEN_TTL_MS,
  reviewUrl,
  type ChangeNames,
  type PublicationStatus,
} from './lib/schedulePublishing';
import { randomHex, sha256Hex } from './lib/tokens';
import { apiError } from './lib/validation';
import { errorMessage } from './lib/errors';
import { isRecord } from './lib/json';
import { buildOn, checked, publishedMeetOf, requireMeet, type BaseBuild } from './scheduleBuilder';

const USER_PUBLICATIONS_READ = 50;
const PENDING_LIST_MAX = 50;
const MEET_PUBLICATIONS_READ = 50;
const EXPIRE_BATCH = 100;

export const STALE_BASE = "Someone else published this meet's schedule since you opened it. Open it again to see their changes.";
export const STALE_APPROVAL = "The meet's schedule changed after this one was made, so approving it would undo that change. Its publisher can open the builder again and republish.";
export const BASE_GONE = "This schedule was made on the meet's published schedule, which is no longer on MeetCal, so it can't be approved.";

export function stillListedProblem(names: readonly string[]): string {
  const who = names.length === 1 ? `${names.join('')} is` : `${names.slice(0, -1).join(', ')} and ${names.slice(-1).join('')} are`;
  return `${who} still on Sport80, and only lifters Sport80 no longer lists can be taken off the start list before the publisher organizes this meet.`;
}

type Decision = 'approve' | 'reject';
type DecisionResult = { status: PublicationStatus; message: string };

async function isOrganizer(ctx: QueryCtx, meet: string, userId: string): Promise<boolean> {
  const row = await ctx.db
    .query('meet_organizers')
    .withIndex('by_meet_and_userId', (q) => q.eq('meet', meet).eq('userId', userId))
    .first();
  return row !== null;
}

async function lastLiveAt(ctx: QueryCtx, meet: string): Promise<number | null> {
  const recent = await ctx.db
    .query('schedule_publications')
    .withIndex('by_meet_and_createdAt', (q) => q.eq('meet', meet))
    .order('desc')
    .take(MEET_PUBLICATIONS_READ);
  const wentLive = recent.filter((p) => p.status === 'live' || p.status === 'approved').map((p) => p.decidedAt ?? p.createdAt);
  return wentLive.length > 0 ? Math.max(...wentLive) : null;
}

async function hasSchedule(ctx: QueryCtx, meet: string): Promise<boolean> {
  return (
    (await ctx.db
      .query('session_schedule')
      .withIndex('by_meet', (q) => q.eq('meet', meet))
      .first()) !== null
  );
}

async function requireOpenMeet(ctx: QueryCtx, meet: string) {
  const row = await requireMeet(ctx, meet);
  if (row.status === 'completed') throw apiError(409, 'this meet is over, so its schedule can no longer be published');
  return row;
}

async function recentOfUser(ctx: QueryCtx, userId: string): Promise<Doc<'schedule_publications'>[]> {
  return ctx.db
    .query('schedule_publications')
    .withIndex('by_userId_and_createdAt', (q) => q.eq('userId', userId))
    .order('desc')
    .take(USER_PUBLICATIONS_READ);
}

const NO_SCHEDULE: BuiltSchedule = { athletes: 0, sessions: [], warnings: [] };

const namesOf = (changes: RosterChanges): ChangeNames => ({ added: changes.add.map((entrant) => entrant.name), removed: changes.remove.map((removal) => removal.name) });

type Review = { schedule: BuiltSchedule; changes: ChangeNames; problem: string | null };

async function reviewOf(ctx: QueryCtx, publication: Doc<'schedule_publications'>): Promise<Review> {
  const stored = { added: publication.added ?? [], removed: publication.removed ?? [] };
  const meet = await meetByName(ctx, publication.meet);
  if (!meet) return { schedule: NO_SCHEDULE, changes: stored, problem: 'This meet is no longer on MeetCal.' };
  if (publication.status !== 'pending') {
    const published = await publishedMeetOf(ctx, meet);
    return { schedule: published ? buildFromPublished(published.base, publication.options) : NO_SCHEDULE, changes: stored, problem: null };
  }
  if (publication.base === 'published' && !(await publishedMeetOf(ctx, meet))) return { schedule: NO_SCHEDULE, changes: stored, problem: BASE_GONE };
  const built = await buildOn(ctx, meet, publication.base ?? 'entries', publication.options, publication.edits);
  return { schedule: built.schedule, changes: namesOf(built.changes), problem: approvalProblem(built, publication) };
}

function approvalProblem(built: BaseBuild, publication: Pick<Doc<'schedule_publications'>, 'baseVersion'>): string | null {
  if (built.published && built.published.version !== (publication.baseVersion ?? null)) return STALE_APPROVAL;
  const stillListed = built.base === 'published' ? unlistedRemovals(built.schedule) : [];
  return stillListed.length > 0 ? stillListedProblem(stillListed) : null;
}

async function writeBuild(ctx: MutationCtx, meet: string, built: BaseBuild, options: Doc<'schedule_publications'>['options']): Promise<number> {
  return (await writeBuiltSchedule(ctx, meet, publishedSchedule(built.schedule), built.changes, options)).revision;
}

export const publish = mutation({
  args: {
    meet: v.string(),
    options: builderOptionsValidator,
    edits: v.array(builderEditValidator),
    base: v.optional(scheduleBaseValidator),
    baseVersion: v.optional(baseVersionValidator),
    contactEmail: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, { meet, options, edits, base, baseVersion, contactEmail }): Promise<{ status: 'live' | 'pending'; sessions: number; athletes: number; version: string | null }> => {
    const userId = await requireUserId(ctx);
    checked(options, edits, base);
    const email = checkContactEmail(contactEmail);
    const row = await requireOpenMeet(ctx, meet);
    const now = Date.now();
    const recent = await recentOfUser(ctx, userId);
    if (recent.filter((p) => p.createdAt > now - DAY_MS).length >= MAX_PUBLISHES_PER_DAY) {
      throw apiError(429, `at most ${MAX_PUBLISHES_PER_DAY} schedule publishes a day`, { max: MAX_PUBLISHES_PER_DAY });
    }
    const built = await buildOn(ctx, row, base ?? 'entries', options, edits);
    if (built.published && built.published.version !== (baseVersion ?? null)) throw apiError(409, STALE_BASE);
    const schedule = built.schedule;
    const problem = publishProblem(schedule, row);
    if (problem) throw apiError(400, problem);
    const live = await isOrganizer(ctx, row.name, userId);
    const stillListed = !live && built.base === 'published' ? unlistedRemovals(built.schedule) : [];
    if (stillListed.length > 0) throw apiError(400, stillListedProblem(stillListed));
    const version = live ? String(await writeBuild(ctx, row.name, built, options)) : (built.published?.version ?? null);
    const names = namesOf(built.changes);
    for (const earlier of recent) {
      if (earlier.meet === row.name && earlier.status === 'pending') await ctx.db.patch(earlier._id, { status: 'superseded', decidedAt: now, reviewTokenHash: undefined });
    }
    const status = live ? 'live' : 'pending';
    const publicationId = await ctx.db.insert('schedule_publications', {
      meet: row.name,
      userId,
      ...(email ? { contactEmail: email } : {}),
      options,
      edits,
      base: built.base,
      baseVersion: built.published?.version ?? null,
      ...(names.added.length > 0 ? { added: [...names.added] } : {}),
      ...(names.removed.length > 0 ? { removed: [...names.removed] } : {}),
      status,
      createdAt: now,
      ...(live ? { decidedAt: now } : {}),
    });
    await ctx.scheduler.runAfter(0, internal.schedulePublications.email, { publicationId, attempt: 0 });
    return { status, sessions: schedule.sessions.length, athletes: schedule.athletes, version };
  },
});

export const publications = query({
  args: { meet: v.string() },
  handler: async (ctx, { meet }) => {
    const userId = await requireUserId(ctx);
    const recent = (await recentOfUser(ctx, userId)).filter((p) => p.meet === meet);
    return {
      organizer: await isOrganizer(ctx, meet, userId),
      publications: recent.map(({ _id, status, createdAt, decidedAt }) => ({ id: _id, status, createdAt, decidedAt: decidedAt ?? null })),
    };
  },
});

export const emailContent = internalQuery({
  args: { publicationId: v.id('schedule_publications') },
  handler: async (ctx, { publicationId }) => {
    const publication = await ctx.db.get(publicationId);
    if (!publication) return null;
    const { meet, status, contactEmail, userId, emailedAt } = publication;
    const { schedule, changes } = await reviewOf(ctx, publication);
    return { meet, status, contactEmail, userId, emailedAt, schedule, changes, lastLiveAt: await lastLiveAt(ctx, meet), hasSchedule: await hasSchedule(ctx, meet) };
  },
});

export const setReviewToken = internalMutation({
  args: { publicationId: v.id('schedule_publications'), tokenHash: v.string(), expiresAt: v.number() },
  handler: async (ctx, { publicationId, tokenHash, expiresAt }) => {
    const publication = await ctx.db.get(publicationId);
    if (!publication || publication.status !== 'pending' || publication.emailedAt !== undefined) return false;
    await ctx.db.patch(publicationId, { reviewTokenHash: tokenHash, reviewTokenExpiresAt: expiresAt });
    return true;
  },
});

export const markEmailed = internalMutation({
  args: { publicationId: v.id('schedule_publications'), emailedAt: v.number() },
  handler: async (ctx, { publicationId, emailedAt }) => {
    if (await ctx.db.get(publicationId)) await ctx.db.patch(publicationId, { emailedAt });
  },
});

export const email = internalAction({
  args: { publicationId: v.id('schedule_publications'), attempt: v.number() },
  handler: async (ctx, { publicationId, attempt }) => {
    const to = process.env.MEET_SUBMISSION_EMAIL;
    if (!to) {
      console.warn(`schedule publication ${publicationId}: MEET_SUBMISSION_EMAIL is not set, so it was not emailed`);
      return;
    }
    const content = await ctx.runQuery(internal.schedulePublications.emailContent, { publicationId });
    if (!content || content.emailedAt !== undefined || (content.status !== 'pending' && content.status !== 'live')) return;
    let link: string | undefined;
    if (content.status === 'pending') {
      const site = process.env.CONVEX_SITE_URL;
      if (!site) throw new Error('schedule publication email: CONVEX_SITE_URL is not set');
      const token = randomHex(32);
      const stored: boolean = await ctx.runMutation(internal.schedulePublications.setReviewToken, {
        publicationId,
        tokenHash: await sha256Hex(token),
        expiresAt: Date.now() + REVIEW_TOKEN_TTL_MS,
      });
      if (!stored) return;
      link = reviewUrl(site, publicationId, token);
    }
    const { subject, html } = renderPublicationEmail({ ...content, ...(link ? { reviewUrl: link } : {}) });
    try {
      await sendEmail(to, subject, html, { replyTo: content.contactEmail });
    } catch (error) {
      const delay = EMAIL_RETRY_DELAYS_MS[attempt];
      if (delay === undefined) throw error;
      console.warn(`schedule publication ${publicationId}: email failed (attempt ${attempt + 1}), retrying in ${delay / 1000}s:`, error);
      await ctx.scheduler.runAfter(delay, internal.schedulePublications.email, { publicationId, attempt: attempt + 1 });
      return;
    }
    await ctx.runMutation(internal.schedulePublications.markEmailed, { publicationId, emailedAt: Date.now() });
  },
});

async function decide(ctx: MutationCtx, publication: Doc<'schedule_publications'>, decision: Decision): Promise<DecisionResult> {
  if (publication.status !== 'pending') return { status: publication.status, message: `This schedule is already ${publication.status}.` };
  const now = Date.now();
  if (decision === 'reject') {
    await ctx.db.patch(publication._id, { status: 'rejected', decidedAt: now, reviewTokenHash: undefined });
    return { status: 'rejected', message: 'The schedule was rejected. Nothing on MeetCal changed.' };
  }
  const meet = await requireOpenMeet(ctx, publication.meet);
  const built = await buildOn(ctx, meet, publication.base ?? 'entries', publication.options, publication.edits);
  const refused = approvalProblem(built, publication);
  if (refused) throw apiError(409, refused);
  const problem = publishProblem(built.schedule, meet);
  if (problem) throw apiError(409, `it can't go live now: ${problem}`);
  await writeBuild(ctx, publication.meet, built, publication.options);
  if (!(await isOrganizer(ctx, publication.meet, publication.userId))) {
    await ctx.db.insert('meet_organizers', { meet: publication.meet, userId: publication.userId, approvedAt: now });
  }
  await ctx.db.patch(publication._id, { status: 'approved', decidedAt: now, reviewTokenHash: undefined });
  return { status: 'approved', message: "The schedule is live, and its publisher is now the meet's organizer." };
}

async function publicationByToken(ctx: QueryCtx, id: string, tokenHash: string): Promise<Doc<'schedule_publications'> | null> {
  const publicationId = ctx.db.normalizeId('schedule_publications', id);
  const publication = publicationId === null ? null : await ctx.db.get(publicationId);
  if (!publication || publication.reviewTokenHash === undefined || publication.reviewTokenHash !== tokenHash) return null;
  if ((publication.reviewTokenExpiresAt ?? 0) < Date.now()) return null;
  return publication;
}

export const reviewByToken = internalQuery({
  args: { id: v.string(), tokenHash: v.string() },
  handler: async (ctx, { id, tokenHash }) => {
    const publication = await publicationByToken(ctx, id, tokenHash);
    if (!publication) return null;
    const { schedule, changes, problem } = await reviewOf(ctx, publication);
    return {
      meet: publication.meet,
      status: publication.status,
      contactEmail: publication.contactEmail,
      userId: publication.userId,
      schedule,
      changes,
      problem,
      lastLiveAt: await lastLiveAt(ctx, publication.meet),
      hasSchedule: await hasSchedule(ctx, publication.meet),
    };
  },
});

export const decideByToken = internalMutation({
  args: { id: v.string(), tokenHash: v.string(), decision: v.union(v.literal('approve'), v.literal('reject')) },
  handler: async (ctx, { id, tokenHash, decision }): Promise<DecisionResult | null> => {
    const publication = await publicationByToken(ctx, id, tokenHash);
    return publication ? await decide(ctx, publication, decision) : null;
  },
});

async function requirePublication(ctx: QueryCtx, publicationId: Id<'schedule_publications'>): Promise<Doc<'schedule_publications'>> {
  const publication = await ctx.db.get(publicationId);
  if (!publication) throw new Error(`no schedule publication ${publicationId}`);
  return publication;
}

export const approve = internalMutation({
  args: { publicationId: v.id('schedule_publications') },
  handler: async (ctx, { publicationId }) => decide(ctx, await requirePublication(ctx, publicationId), 'approve'),
});

export const reject = internalMutation({
  args: { publicationId: v.id('schedule_publications') },
  handler: async (ctx, { publicationId }) => decide(ctx, await requirePublication(ctx, publicationId), 'reject'),
});

export const pending = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query('schedule_publications')
      .withIndex('by_status_and_createdAt', (q) => q.eq('status', 'pending'))
      .order('desc')
      .take(PENDING_LIST_MAX);
    return rows.map(({ _id, meet, userId, contactEmail, createdAt, reviewTokenExpiresAt }) => ({
      publicationId: _id,
      meet,
      userId,
      contactEmail: contactEmail ?? null,
      createdAt,
      linkExpiresAt: reviewTokenExpiresAt ?? null,
    }));
  },
});

export const expire = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const stale = await ctx.db
      .query('schedule_publications')
      .withIndex('by_status_and_createdAt', (q) => q.eq('status', 'pending').lt('createdAt', now - PENDING_PUBLICATION_DAYS * DAY_MS))
      .take(EXPIRE_BATCH);
    for (const row of stale) await ctx.db.patch(row._id, { status: 'expired', decidedAt: now, reviewTokenHash: undefined });
    if (stale.length === EXPIRE_BATCH) await ctx.scheduler.runAfter(0, internal.schedulePublications.expire, {});
    return { expired: stale.length };
  },
});

function apiErrorText(error: unknown): string {
  if (error instanceof ConvexError && isRecord(error.data) && typeof error.data.error === 'string') return error.data.error;
  return errorMessage(error);
}

function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
}

export const reviewPageHttp = httpAction(async (ctx, request) => {
  const params = new URL(request.url).searchParams;
  const id = params.get('id') ?? '';
  const token = params.get('token') ?? '';
  const content = await ctx.runQuery(internal.schedulePublications.reviewByToken, { id, tokenHash: await sha256Hex(token) });
  if (!content) return html(renderReviewResult('This review link is not valid any more.'), 404);
  return html(renderReviewPage({ ...content, publicationId: id, token }));
});

export const reviewDecisionHttp = httpAction(async (ctx, request) => {
  const form = new URLSearchParams(await request.text());
  const decision = form.get('decision');
  if (decision !== 'approve' && decision !== 'reject') return html(renderReviewResult('Choose Approve or Reject.'), 400);
  try {
    const result: DecisionResult | null = await ctx.runMutation(internal.schedulePublications.decideByToken, {
      id: form.get('id') ?? '',
      tokenHash: await sha256Hex(form.get('token') ?? ''),
      decision,
    });
    if (!result) return html(renderReviewResult('This review link is not valid any more.'), 404);
    return html(renderReviewResult(result.message));
  } catch (error) {
    const message = apiErrorText(error);
    console.error(`schedule review: ${message}`);
    return html(renderReviewResult(`The schedule could not go live: ${message}`), 409);
  }
});
