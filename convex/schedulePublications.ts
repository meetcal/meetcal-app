import { ConvexError, v } from 'convex/values';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { httpAction, internalAction, internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import { writeBuiltSchedule } from './ingest/rosters';
import { requireUserId } from './lib/access';
import { DAY_MS } from './lib/dates';
import { EMAIL_RETRY_DELAYS_MS, sendEmail } from './lib/email';
import { checkContactEmail } from './lib/meetSubmissions';
import { buildSchedule, type BuiltSchedule } from './lib/scheduleBuilder';
import { builderEditValidator, builderOptionsValidator } from './lib/scheduleBuilderOptions';
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
  type PublicationStatus,
} from './lib/schedulePublishing';
import { randomHex, sha256Hex } from './lib/tokens';
import { apiError } from './lib/validation';
import { errorMessage } from './lib/errors';
import { isRecord } from './lib/json';
import { checked, entrantsOf, requireMeet } from './scheduleBuilder';

const USER_PUBLICATIONS_READ = 50;
const PENDING_LIST_MAX = 50;
const MEET_PUBLICATIONS_READ = 50;
const EXPIRE_BATCH = 100;

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
  const live = recent.find((p) => p.status === 'live' || p.status === 'approved');
  return live ? (live.decidedAt ?? live.createdAt) : null;
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

async function scheduleOf(ctx: QueryCtx, publication: Pick<Doc<'schedule_publications'>, 'meet' | 'options' | 'edits'>): Promise<BuiltSchedule> {
  return buildSchedule(await entrantsOf(ctx, publication.meet), publication.options, publication.edits);
}

export const publish = mutation({
  args: { meet: v.string(), options: builderOptionsValidator, edits: v.array(builderEditValidator), contactEmail: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, { meet, options, edits, contactEmail }): Promise<{ status: 'live' | 'pending'; sessions: number; athletes: number }> => {
    const userId = await requireUserId(ctx);
    checked(options, edits);
    const email = checkContactEmail(contactEmail);
    const row = await requireOpenMeet(ctx, meet);
    const now = Date.now();
    const recent = await recentOfUser(ctx, userId);
    if (recent.filter((p) => p.createdAt > now - DAY_MS).length >= MAX_PUBLISHES_PER_DAY) {
      throw apiError(429, `at most ${MAX_PUBLISHES_PER_DAY} schedule publishes a day`, { max: MAX_PUBLISHES_PER_DAY });
    }
    const schedule = await scheduleOf(ctx, { meet: row.name, options, edits });
    const problem = publishProblem(schedule, row);
    if (problem) throw apiError(400, problem);
    const live = await isOrganizer(ctx, row.name, userId);
    if (live) await writeBuiltSchedule(ctx, row.name, publishedSchedule(schedule));
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
      status,
      createdAt: now,
      ...(live ? { decidedAt: now } : {}),
    });
    await ctx.scheduler.runAfter(0, internal.schedulePublications.email, { publicationId, attempt: 0 });
    return { status, sessions: schedule.sessions.length, athletes: schedule.athletes };
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
    return { meet, status, contactEmail, userId, emailedAt, schedule: await scheduleOf(ctx, publication), lastLiveAt: await lastLiveAt(ctx, meet), hasSchedule: await hasSchedule(ctx, meet) };
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
  const schedule = await scheduleOf(ctx, publication);
  const problem = publishProblem(schedule, meet);
  if (problem) throw apiError(409, `it can't go live now: ${problem}`);
  await writeBuiltSchedule(ctx, publication.meet, publishedSchedule(schedule));
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
    return {
      meet: publication.meet,
      status: publication.status,
      contactEmail: publication.contactEmail,
      userId: publication.userId,
      schedule: await scheduleOf(ctx, publication),
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
