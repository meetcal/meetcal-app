import { typedKeys } from '../lib/json';
import { MEET_ROSTER_MAX, MEET_SESSIONS_MAX, readAll } from '../lib/boundedRead';
import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import type { Doc } from '../_generated/dataModel';
import { normalizeGender } from '../lib/normalize';
import { hasNoMemberId, ONE_OFF_MEMBER_ID, placeholderMemberId } from '../lib/memberIds';
import { normalizeName } from '../lib/names';
import { exceedsShrink } from '../lib/shrinkGuard';
import { halfSession, hasSession, isJunkEntrant, isStoredMemberId, rosterProblems } from '../lib/roster';
import { athletesFields, sessionScheduleFields } from '../schema';
import { recordWrite } from './hints';

/**
 * An empty start list or schedule is a failed load, not a meet without
 * one: refused unless the caller says it means to clear it.
 */
function refuseEmptyReplace(what: string, meet: string, rows: readonly unknown[], allowEmpty: boolean | undefined): void {
  if (rows.length === 0 && !allowEmpty) {
    throw new Error(`refusing to replace ${meet}'s ${what} with an empty payload; pass '{"allowEmpty":true}' to clear it`);
  }
}

/**
 * Replaces a meet's start list (by hand, from a published start list). Gender
 * is stored normalized, as the entries sync stores and matches it
 * (`upsertEntryAthletes`), and a blank membership number as the entries
 * sync's placeholder for the name. An empty list is refused unless
 * `allowEmpty`. A row with a session number and no platform, or a platform
 * and no number, is always refused (it would read as unscheduled, #219).
 * A list with the problems `rosterProblems` finds (ages of 0 or category
 * buckets, `+` classes dropped, women stored as men, #388) is refused,
 * listing them, unless `allowUnchecked` after checking it by hand.
 */
export const replaceMeetAthletes = internalMutation({
  args: { meet: v.string(), rows: v.array(v.object(athletesFields)), allowEmpty: v.optional(v.boolean()), allowUnchecked: v.optional(v.boolean()) },
  handler: async (ctx, { meet, rows, allowEmpty, allowUnchecked }) => {
    if (rows.some((row) => row.meet !== meet)) throw new Error('every row must belong to `meet`');
    refuseEmptyReplace('start list', meet, rows, allowEmpty);
    const half = rows.filter(halfSession);
    if (half.length) {
      throw new Error(
        `refusing ${meet}'s start list: ${half.length} row(s) set only one of sessionNumber and sessionPlatform, or a blank platform ` +
          `(${half.slice(0, 5).map((row) => JSON.stringify(row.name)).join(', ')}${half.length > 5 ? ', …' : ''})`,
      );
    }
    const problems = rosterProblems(rows);
    if (problems.length && !allowUnchecked) {
      throw new Error(`refusing ${meet}'s start list: ${problems.join('; ')}. If it really is so, pass '{"allowUnchecked":true}'`);
    }
    const existing = await readAll(
      ctx.db
        .query('athletes')
        .withIndex('by_meet', (q) => q.eq('meet', meet)),
      MEET_ROSTER_MAX,
      'athletes of one meet',
    );
    for (const row of existing) await ctx.db.delete(row._id);
    for (const row of rows) {
      const memberId = row.memberId.trim() === '' ? placeholderMemberId(row.name) : row.memberId;
      await ctx.db.insert('athletes', { ...row, memberId, gender: normalizeGender(row.gender) });
    }
    await recordWrite(ctx, 'athletes', [
      { kind: 'meet', key: meet },
      { kind: 'table', key: 'athletes' },
    ]);
    return { deleted: existing.length, inserted: rows.length };
  },
});

/**
 * Replaces a meet's session schedule (by hand). Its values are stored as
 * given: nothing in a schedule row has a normalized spelling. An empty
 * schedule is refused unless `allowEmpty`.
 */
export const replaceMeetSchedule = internalMutation({
  args: { meet: v.string(), rows: v.array(v.object(sessionScheduleFields)), allowEmpty: v.optional(v.boolean()) },
  handler: async (ctx, { meet, rows, allowEmpty }) => {
    if (rows.some((row) => row.meet !== meet)) throw new Error('every row must belong to `meet`');
    refuseEmptyReplace('schedule', meet, rows, allowEmpty);
    const existing = await readAll(
      ctx.db
        .query('session_schedule')
        .withIndex('by_meet', (q) => q.eq('meet', meet)),
      MEET_SESSIONS_MAX,
      'sessions of one meet',
    );
    for (const row of existing) await ctx.db.delete(row._id);
    for (const row of rows) await ctx.db.insert('session_schedule', row);
    await recordWrite(ctx, 'session_schedule', [{ kind: 'meet', key: meet }]);
    return { deleted: existing.length, inserted: rows.length };
  },
});

const entryRow = v.object({
  memberId: v.string(),
  name: v.string(),
  age: v.number(),
  club: v.string(),
  gender: v.string(),
  weightClass: v.string(),
  entryTotal: v.number(),
  meet: v.string(),
  // The member's WSO from their other registrations (Sport80's entries list
  // has none, #345); absent when none is known, which never clears one.
  wso: v.optional(v.string()),
});

/**
 * An entries sync may delete at most this share of a meet's stored entrants
 * (and always this many) in one run without `allowShrink`: withdrawals are a
 * few lifters, not a quarter of a meet.
 */
const ENTRY_PRUNE_LIMIT = { share: 0.25, min: 5 };

/**
 * The one stored athlete whose folded name is a leading run of whole words of
 * the entrant's (`nameKey`) with the same membership number, or, for an
 * entrant without one, a placeholder id, the same gender (either stored
 * spelling, `normalizeGender`) and age: the row the old
 * entries scraper wrote after cutting the surname at its first space. A name
 * the incoming list still carries as an entrant of its own is never taken.
 */
export function truncatedEntryRow<T extends { memberId: string; name: string; gender: string; age: number }>(
  existing: readonly T[],
  row: { memberId: string; age: number },
  nameKey: string,
  gender: string,
  incomingKeys: ReadonlySet<string>,
): T | undefined {
  const idless = hasNoMemberId(row.memberId);
  const candidates = existing.filter((a) => {
    // The cheap checks first: this runs for each new entrant over the meet's rows.
    const same = idless ? hasNoMemberId(a.memberId) && normalizeGender(a.gender) === gender && a.age === row.age : a.memberId === row.memberId;
    if (!same) return false;
    const key = normalizeName(a.name);
    return key !== '' && nameKey.startsWith(`${key} `) && !incomingKeys.has(key);
  });
  return candidates.length === 1 ? candidates[0] : undefined;
}

/**
 * One meet's Sport80 entries (`upsert_athlete(..., preserve_assigned_session=True)`).
 * An athlete with a membership number is the row with that number and name
 * (names compared case- and space-insensitively) at the meet; failing that,
 * the unplaced row with that number under another name (a name Sport80
 * corrected, #251), or the unplaced row of that name and gender carrying a
 * one-off nine-digit id the old scraper minted per run (#386). One without
 * is the row with the same name and gender carrying a blank or placeholder
 * id, or an older row with a one-off id and the same age. Rows already given
 * a session are left alone, and once any athlete of the meet has a session
 * (its start list is published) no entry is added: an entrant the start list
 * left out (scratched, withdrawn) stays out, so entries never undo a
 * published start list. Placeholder rows (`isJunkEntrant`) and membership
 * numbers that are neither digits nor a placeholder are not stored (#384).
 *
 * `complete`: the rows are the whole list (the sync checked it against the
 * list's total). Then, while no start list is published, a stored entrant
 * the list no longer has (withdrawn) is deleted, unless that is more than
 * ENTRY_PRUNE_LIMIT of the meet's entrants without `allowShrink` (#251).
 */
export const upsertEntryAthletes = internalMutation({
  args: { meet: v.string(), rows: v.array(entryRow), complete: v.optional(v.boolean()), allowShrink: v.optional(v.boolean()) },
  handler: async (ctx, { meet, rows, complete, allowShrink }) => {
    if (rows.some((row) => row.meet !== meet)) throw new Error('every row must belong to `meet`');
    const existing = await readAll(
      ctx.db
        .query('athletes')
        .withIndex('by_meet', (q) => q.eq('meet', meet)),
      MEET_ROSTER_MAX,
      'athletes of one meet',
    );
    const stored = [...existing];
    const published = existing.some(hasSession);
    const counts = { inserted: 0, updated: 0, unchanged: 0, sessionSkipped: 0, notOnStartList: 0, rejected: 0, deleted: 0 };
    const valid = rows.filter((row) => !isJunkEntrant(row) && isStoredMemberId(row.memberId));
    counts.rejected = rows.length - valid.length;
    // One entrant listed twice (two source rows for one member and name) is
    // one roster row, as it was when the second updated the first: the last
    // listing wins.
    const byIdentity = new Map<string, (typeof rows)[number]>();
    for (const row of valid) byIdentity.set(JSON.stringify([row.memberId, normalizeName(row.name)]), row);
    const accepted = [...byIdentity.values()];
    if (counts.rejected) console.warn(`upsertEntryAthletes: ${meet}: ${counts.rejected} placeholder row(s) not stored`);
    const incomingKeys = new Set(accepted.map((row) => normalizeName(row.name)));
    // Stored rows an incoming entrant is: kept, and not taken by another.
    const claimed = new Set<string>();
    const oneOffIds = new Map<string, boolean>();
    const isOneOff = async (memberId: string) => {
      if (!ONE_OFF_MEMBER_ID.test(memberId)) return false;
      if (!oneOffIds.has(memberId)) {
        const elsewhere = await ctx.db
          .query('athletes')
          .withIndex('by_memberId', (q) => q.eq('memberId', memberId))
          .filter((q) => q.neq(q.field('meet'), meet))
          .first();
        oneOffIds.set(memberId, elsewhere === null);
      }
      return oneOffIds.get(memberId)!;
    };
    const unclaimed = (a: Doc<'athletes'>) => !claimed.has(a._id);
    for (const row of accepted) {
      const gender = normalizeGender(row.gender);
      const nameKey = normalizeName(row.name);
      const idless = hasNoMemberId(row.memberId);
      let match: Doc<'athletes'> | undefined;
      if (idless) {
        const sameName = existing.filter((a) => unclaimed(a) && normalizeName(a.name) === nameKey && normalizeGender(a.gender) === gender);
        match = sameName.find((a) => hasNoMemberId(a.memberId));
        for (const a of sameName) {
          if (match) break;
          if (a.age === row.age && (await isOneOff(a.memberId))) match = a;
        }
      } else {
        match = existing.find((a) => unclaimed(a) && a.memberId === row.memberId && normalizeName(a.name) === nameKey);
      }
      // A row the old scraper stored with the surname cut at its first space
      // ("Maria De" for "Maria De La Cruz", its placeholder id minted from
      // that name) is this entrant: repair it rather than add a second row.
      match ??= truncatedEntryRow(existing.filter(unclaimed), row, nameKey, gender, incomingKeys);
      if (!match && !idless) {
        // The same member under a name Sport80 has since corrected (#251).
        const renamed = existing.filter((a) => unclaimed(a) && !hasSession(a) && a.memberId === row.memberId && !incomingKeys.has(normalizeName(a.name)));
        if (renamed.length === 1) match = renamed[0];
      }
      if (!match && !idless) {
        // The same athlete under an id the old scraper minted per run (#386):
        // only when exactly one row fits, as for a rename; with two, either
        // could be another athlete of the name.
        const minted: Doc<'athletes'>[] = [];
        for (const a of existing) {
          if (!unclaimed(a) || hasSession(a) || normalizeName(a.name) !== nameKey || normalizeGender(a.gender) !== gender) continue;
          // The same age, give or take the year it turns over: another
          // athlete of the same name keeps their row.
          if (Math.abs(a.age - row.age) > 1) continue;
          if (await isOneOff(a.memberId)) minted.push(a);
        }
        if (minted.length === 1) match = minted[0];
      }
      if (match) claimed.add(match._id);
      const values = {
        // An adopted older row keeps its id rather than take a placeholder.
        memberId: idless && match && !hasNoMemberId(match.memberId) ? match.memberId : row.memberId,
        name: row.name,
        age: row.age,
        club: row.club,
        gender,
        weightClass: row.weightClass,
        entryTotal: row.entryTotal,
        // Set when known, never cleared: a start list loaded by hand can
        // carry a WSO the entries list does not.
        ...(row.wso?.trim() ? { wso: row.wso.trim() } : {}),
      };
      if (!match && published) {
        counts.notOnStartList += 1;
        continue;
      }
      if (!match) {
        const doc = { ...values, meet, adaptive: false };
        const inserted = { ...doc, _id: await ctx.db.insert('athletes', doc), _creationTime: Date.now() };
        existing.push(inserted);
        claimed.add(inserted._id);
        counts.inserted += 1;
        continue;
      }
      if (hasSession(match)) {
        // A placed entrant keeps its start list, but gains a WSO it lacks:
        // that undoes nothing the start list said.
        if (values.wso && (match.wso ?? '').trim() === '') {
          await ctx.db.patch(match._id, { wso: values.wso });
          match.wso = values.wso;
          counts.updated += 1;
        } else {
          counts.sessionSkipped += 1;
        }
        continue;
      }
      const changed = typedKeys(values).some((key) => match[key] !== values[key]);
      if (!changed) {
        counts.unchanged += 1;
        continue;
      }
      await ctx.db.patch(match._id, values);
      Object.assign(match, values);
      counts.updated += 1;
    }
    // Any session information at all (even half a session, which reads as
    // unscheduled) means a start list was loaded: its athletes need not be
    // on Sport80's entries list, so nothing is pruned.
    const startListLoaded = existing.some((a) => a.sessionNumber !== undefined || (a.sessionPlatform ?? '').trim() !== '');
    if (complete && !startListLoaded && accepted.length > 0) {
      // Entrants the whole list no longer has: withdrawn before the meet.
      const withdrawn = stored.filter((a) => !claimed.has(a._id) && !hasSession(a) && !a.adaptive);
      if (!allowShrink && exceedsShrink(withdrawn.length, stored.length, ENTRY_PRUNE_LIMIT)) {
        throw new Error(
          `refusing to delete ${withdrawn.length} of ${meet}'s ${stored.length} entrants no longer on its entries list ` +
            `(${withdrawn.slice(0, 10).map((a) => a.name).join(', ')}${withdrawn.length > 10 ? ', …' : ''}). ` +
            `If they really withdrew: npx convex run scrapers/entries:run '{"only":["<target label>"],"allowShrink":true}' (add --prod for production)`,
        );
      }
      for (const a of withdrawn) await ctx.db.delete(a._id);
      counts.deleted = withdrawn.length;
    }
    // The club list is built from every athlete, so it needs the table hint too.
    if (counts.inserted + counts.updated + counts.deleted > 0) {
      await recordWrite(ctx, 'athletes', [
        { kind: 'meet', key: meet },
        { kind: 'table', key: 'athletes' },
      ]);
    }
    return counts;
  },
});
