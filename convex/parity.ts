import { v } from 'convex/values';
import { internalAction, internalQuery } from './_generated/server';
import { api, internal } from './_generated/api';
import { computeHistory } from './lib/history';
import {
  addMonths,
  clubAthleteCount,
  clubStats,
  computeScheduleRows,
  computeStatsRows,
  meetByName,
  toApiMeet,
} from './lib/meetData';
import { distinctNameKeys } from './lib/names';
import {
  computeAdaptiveRecords,
  computeClubs,
  computeIntlRankings,
  computeNationalRankings,
  computeQualifyingTotals,
  computeRecords,
  computeStandards,
  computeWsoList,
  computeWsoRows,
  filterWsoRows,
  wsoAgeGroups,
} from './lib/referenceData';
import { compareBytes } from './lib/sort';
import { liveAthletesJson, livePackageJson, liveSessionsJson } from './meets';
import { answerBests, answerByNames, answerRecent } from './results';

/**
 * Parity between the fast paths (views, history documents) and the live
 * computations they replace, on the deployment's own data:
 *
 *   npx convex run parity:run '{"meets": 60, "classes": 60}'
 *
 * Each check runs the public query as a client would and the live
 * computation (the port of the Rust route's SQL) directly, and compares the
 * parsed answers. Run it after a rebuild; it reads a lot, so not on a timer.
 */

/** The live answer of one endpoint, as JSON text. */
export const live = internalQuery({
  args: { endpoint: v.string(), args: v.any() },
  handler: async (ctx, { endpoint, args }): Promise<string> => {
    const a = args as Record<string, any>;
    switch (endpoint) {
      case 'schedule':
        return JSON.stringify(await computeScheduleRows(ctx, a.meet));
      case 'athletes':
        return await liveAthletesJson(ctx, a.meet);
      case 'sessions':
        return await liveSessionsJson(ctx, a.meet, a.sessionNumber, a.platform);
      case 'package': {
        const meetRow = await meetByName(ctx, a.meet);
        if (!meetRow) return 'null';
        const since = a.historyCutoffDate === undefined ? undefined : addMonths(a.historyCutoffDate, 12);
        return await livePackageJson(ctx, a.meet, toApiMeet(meetRow), since, true);
      }
      case 'nat':
        return JSON.stringify(await computeNationalRankings(ctx, a.federation, a.ageCategory));
      case 'records':
        return JSON.stringify(await computeRecords(ctx));
      case 'standards':
        return JSON.stringify(await computeStandards(ctx));
      case 'qualifyingTotals':
        return JSON.stringify(await computeQualifyingTotals(ctx));
      case 'intlRankings':
        return JSON.stringify(await computeIntlRankings(ctx));
      case 'clubs':
        return JSON.stringify(await computeClubs(ctx));
      case 'wsoList':
        return JSON.stringify(await computeWsoList(ctx));
      case 'wsoRecords':
        return JSON.stringify(filterWsoRows(await computeWsoRows(ctx, a.wso), a.ageCategory, a.gender));
      case 'wsoAgeGroups':
        return JSON.stringify(wsoAgeGroups(await computeWsoRows(ctx, a.wso)));
      case 'adaptive':
        return JSON.stringify(await computeAdaptiveRecords(ctx, a.gender, a.excludeFederation, '2026'));
      case 'clubMeetStats': {
        const roster = await ctx.db
          .query('athletes')
          .withIndex('by_club_and_meet', (q) => q.eq('club', a.club).eq('meet', a.meet))
          .collect();
        return JSON.stringify(clubStats(await computeStatsRows(ctx, a.meet, a.club), a.club, clubAthleteCount(roster, a.club)));
      }
      case 'byNames':
      case 'recent':
      case 'bests': {
        const keys = distinctNameKeys(a.names as string[]);
        const histories = new Map(await Promise.all(keys.map(async (k) => [k, await computeHistory(ctx, k)] as const)));
        if (endpoint === 'byNames') return answerByNames(histories, a.latestOnly ?? false, a.limitPerName);
        if (endpoint === 'recent') return answerRecent(histories, a.cutoffDate);
        return JSON.stringify(answerBests(histories, a.names, a.cutoffDate));
      }
      default:
        throw new Error(`unknown endpoint ${endpoint}`);
    }
  },
});

export const sample = internalQuery({
  args: {},
  handler: async (ctx) => {
    const meets = [...new Set((await ctx.db.query('meets').collect()).map((m) => m.name))].sort(compareBytes);
    const classes = (await ctx.db.query('views').collect())
      .map((h) => h.key)
      .filter((k) => k.startsWith('nat|'))
      .map((k) => k.slice(4).split('|'))
      .map(([federation, ...age]) => ({ federation, ageCategory: age.join('|') }));
    return { meets, classes };
  },
});

export const meetSample = internalQuery({
  args: { meet: v.string() },
  handler: async (ctx, { meet }) => {
    const athletes = await ctx.db
      .query('athletes')
      .withIndex('by_meet', (q) => q.eq('meet', meet))
      .collect();
    const sessions = [...new Set(athletes.map((a) => a.sessionNumber).filter((n): n is number => n !== undefined))];
    const platforms = [...new Set(athletes.map((a) => a.sessionPlatform).filter((p): p is string => p !== undefined))];
    const clubs = [...new Set(athletes.map((a) => a.club))].slice(0, 3);
    const names = [...new Set(athletes.map((a) => a.name))].slice(0, 100);
    return { sessions: sessions.slice(0, 4), platforms: platforms.slice(0, 2), clubs, names };
  },
});

/** Unwraps `{ json }` / `{ etag, json }` answers into parsed values. */
function decode(answer: unknown): unknown {
  if (answer && typeof answer === 'object' && 'json' in answer) {
    return JSON.parse((answer as { json: string }).json);
  }
  return answer;
}

/**
 * JSON with object keys sorted: Convex returns structured objects with their
 * keys in its own order, and key order is not part of any answer's meaning.
 * Array order is compared as is.
 */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, (v as Record<string, unknown>)[k]]))
      : v,
  );
}

function firstDifference(a: unknown, b: unknown, path = '$'): string | null {
  if (canonical(a) === canonical(b)) return null;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${path}.length ${a.length} != ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const d = firstDifference(a[i], b[i], `${path}[${i}]`);
      if (d) return d;
    }
  }
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
    for (const key of keys) {
      const d = firstDifference((a as any)[key], (b as any)[key], `${path}.${key}`);
      if (d) return d;
    }
  }
  return `${path}: ${canonical(a)?.slice(0, 160)} != ${canonical(b)?.slice(0, 160)}`;
}

export const run = internalAction({
  args: { meets: v.optional(v.number()), classes: v.optional(v.number()) },
  handler: async (ctx, args): Promise<{ checks: number; mismatches: string[] }> => {
    const mismatches: string[] = [];
    let checks = 0;
    const compare = async (label: string, fast: Promise<unknown>, endpoint: string, liveArgs: Record<string, unknown>) => {
      checks += 1;
      try {
        const [f, l] = await Promise.all([fast, ctx.runQuery(internal.parity.live, { endpoint, args: liveArgs })]);
        const diff = firstDifference(decode(f), JSON.parse(l));
        if (diff) mismatches.push(`${label}: ${diff}`);
      } catch (error) {
        mismatches.push(`${label}: threw ${(error as Error).message.slice(0, 200)}`);
      }
    };

    const cutoff = (() => {
      const d = new Date();
      d.setUTCFullYear(d.getUTCFullYear() - 2);
      return d.toISOString().slice(0, 10);
    })();
    const yearAgo = addMonths(cutoff, 12);
    const { meets, classes }: { meets: string[]; classes: { federation: string; ageCategory: string }[] } =
      await ctx.runQuery(internal.parity.sample, {});

    for (const meet of meets.slice(0, args.meets ?? meets.length)) {
      const s = await ctx.runQuery(internal.parity.meetSample, { meet });
      await compare(`schedule ${meet}`, ctx.runQuery(api.meets.schedule, { meet }), 'schedule', { meet });
      await compare(`athletes ${meet}`, ctx.runQuery(api.meets.athletes, { meet }), 'athletes', { meet });
      await compare(`sessions ${meet}`, ctx.runQuery(api.meets.athletesSessions, { meet }), 'sessions', { meet });
      for (const sessionNumber of s.sessions) {
        await compare(`session ${sessionNumber} ${meet}`, ctx.runQuery(api.meets.athletesSessions, { meet, sessionNumber }), 'sessions', { meet, sessionNumber });
      }
      for (const platform of s.platforms) {
        await compare(`platform ${platform} ${meet}`, ctx.runQuery(api.meets.athletesSessions, { meet, platform: platform.toUpperCase() }), 'sessions', { meet, platform: platform.toUpperCase() });
      }
      await compare(
        `package ${meet}`,
        ctx.runQuery(api.meets.packageForMeet, { meet, historyCutoffDate: cutoff, include: ['year_bests'] }),
        'package',
        { meet, historyCutoffDate: cutoff },
      );
      for (const club of s.clubs) {
        await compare(`clubMeetStats ${club} @ ${meet}`, ctx.runQuery(api.reference.clubMeetStats, { club, meet }), 'clubMeetStats', { club, meet });
      }
      if (s.names.length > 0) {
        const names = s.names.slice(0, 40);
        await compare(`byNames ${meet}`, ctx.runQuery(api.results.byNames, { names }), 'byNames', { names });
        await compare(`latest ${meet}`, ctx.runQuery(api.results.byNames, { names: s.names, latestOnly: true }), 'byNames', { names: s.names, latestOnly: true });
        await compare(`recent ${meet}`, ctx.runQuery(api.results.recent, { names, cutoffDate: cutoff }), 'recent', { names, cutoffDate: cutoff });
        await compare(`bests ${meet}`, ctx.runQuery(api.results.bests, { names: s.names, cutoffDate: yearAgo }), 'bests', { names: s.names, cutoffDate: yearAgo });
      }
    }

    const classSample = classes.slice(0, args.classes ?? 60);
    if (!classSample.some((c) => c.ageCategory === "Open Men's 85 kg")) classSample.push({ federation: 'USAW', ageCategory: "Open Men's 85 kg" });
    for (const c of classSample) {
      await compare(`nat ${c.federation}|${c.ageCategory}`, ctx.runQuery(api.reference.nationalRankings, c), 'nat', c);
    }

    for (const [endpoint, fn] of [
      ['records', api.reference.records],
      ['standards', api.reference.standards],
      ['qualifyingTotals', api.reference.qualifyingTotals],
      ['intlRankings', api.reference.intlRankings],
      ['clubs', api.reference.clubs],
      ['wsoList', api.reference.wsoList],
    ] as const) {
      await compare(endpoint, ctx.runQuery(fn, {}), endpoint, {});
    }
    for (const gender of ['men', 'women']) {
      await compare(`adaptive ${gender}`, ctx.runQuery(api.reference.adaptiveRecords, { gender, excludeFederation: 'BWL' }), 'adaptive', { gender, excludeFederation: 'BWL' });
    }
    const wsos = decode(await ctx.runQuery(api.reference.wsoList, {})) as string[];
    for (const wso of wsos) {
      await compare(`wsoAgeGroups ${wso}`, ctx.runQuery(api.reference.wsoAgeGroups, { wso }), 'wsoAgeGroups', { wso });
      await compare(`wsoRecords ${wso}`, ctx.runQuery(api.reference.wsoRecords, { wso }), 'wsoRecords', { wso });
      const ages = decode(await ctx.runQuery(api.reference.wsoAgeGroups, { wso })) as string[];
      if (ages[0]) {
        await compare(`wsoRecords ${wso} ${ages[0]} Men`, ctx.runQuery(api.reference.wsoRecords, { wso, ageCategory: ages[0], gender: 'Men' }), 'wsoRecords', { wso, ageCategory: ages[0], gender: 'Men' });
      }
    }
    return { checks, mismatches: mismatches.slice(0, 50) };
  },
});

/** Stored `lifting_results` rows of the given events, for comparing a scraper port with Postgres. */
export const resultRowsForEvents = internalQuery({
  args: { eventIds: v.array(v.string()) },
  handler: async (ctx, { eventIds }) => {
    const rows = [];
    for (const eventId of eventIds) {
      rows.push(
        ...(await ctx.db
          .query('lifting_results')
          .withIndex('by_event_and_name', (q) => q.eq('eventId', eventId))
          .collect()),
      );
    }
    return rows.map(({ _id, _creationTime, nameKey, ...row }) => row);
  },
});
