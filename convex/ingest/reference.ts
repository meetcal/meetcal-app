import { INTL_RANKINGS_MAX, QUALIFYING_TOTALS_MAX, STANDARDS_MAX, readAll } from '../lib/boundedRead';
import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { normalizeAgeCategory, normalizeGender } from '../lib/normalize';
import { exceedsShrink } from '../lib/shrinkGuard';
import { recordWrite } from './hints';
import { replaceExactSet } from './records';
import { type UpsertOutcome, bySpellingOf, classArg, droppedClasses, onePerKey } from './shared';

/** A stored, possibly absent, gender compared as `normalizeGender` writes it. */
const storedGender = (gender: string | undefined) => (gender === undefined ? null : normalizeGender(gender));

/**
 * Inserts or updates standards matched on (age category, gender, weight
 * class), normalized like `upsert_standard`. Deletes nothing: the standards
 * sync then deletes the classes the PDF no longer lists (`pruneStandards`).
 */
export const upsertStandards = internalMutation({
  args: {
    rows: v.array(
      v.object({ ageCategory: v.string(), gender: v.string(), weightClass: v.string(), standardA: v.number(), standardB: v.number() }),
    ),
  },
  handler: async (ctx, { rows }): Promise<UpsertOutcome[]> => {
    const outcomes: UpsertOutcome[] = [];
    for (const row of rows) {
      const doc = {
        ageCategory: normalizeAgeCategory(row.ageCategory),
        gender: normalizeGender(row.gender),
        weightClass: row.weightClass,
        standardA: row.standardA,
        standardB: row.standardB,
      };
      const existing = (
        await bySpellingOf(doc.gender, (gender) =>
          readAll(
            ctx.db
              .query('standards')
              .withIndex('by_age_gender', (q) => q.eq('ageCategory', doc.ageCategory).eq('gender', gender)),
            STANDARDS_MAX,
            'standards',
          ),
        )
      ).find((s) => s.weightClass === doc.weightClass);
      if (!existing) {
        await ctx.db.insert('standards', doc);
        outcomes.push({ wasInsert: true, wasChanged: true });
      } else if (existing.standardA !== doc.standardA || existing.standardB !== doc.standardB || existing.gender !== doc.gender) {
        await ctx.db.patch(existing._id, doc);
        outcomes.push({ wasInsert: false, wasChanged: true });
      } else {
        outcomes.push({ wasInsert: false, wasChanged: false });
      }
    }
    if (outcomes.some((o) => o.wasChanged)) await recordWrite(ctx, 'standards', [{ kind: 'table', key: 'standards' }]);
    return outcomes;
  },
});

/**
 * Deletes the standards classes the PDF no longer lists (`keep` is every
 * class the sync just wrote), so retired classes are not listed beside the
 * current ones. The standards sync is one PDF for every class: an exact set.
 */
export const pruneStandards = internalMutation({
  // `dryRun`: check the guard and list what would be deleted, deleting nothing.
  args: { keep: v.array(classArg), allowShrink: v.optional(v.boolean()), dryRun: v.optional(v.boolean()) },
  handler: async (ctx, { keep, allowShrink, dryRun }) => {
    const dropped = droppedClasses('standards', await readAll(ctx.db.query('standards'), STANDARDS_MAX, 'standards'), keep, allowShrink);
    if (dryRun) return { deleted: dropped.map((r) => `${r.ageCategory} ${r.gender} ${r.weightClass}`) };
    for (const row of dropped) await ctx.db.delete(row._id);
    if (dropped.length) await recordWrite(ctx, 'standards', [{ kind: 'table', key: 'standards' }]);
    return { deleted: dropped.map((r) => `${r.ageCategory} ${r.gender} ${r.weightClass}`) };
  },
});

const qualifyingTotalRow = v.object({
  ageCategory: v.string(),
  gender: v.string(),
  weightClass: v.string(),
  qualifyingTotal: v.number(),
});

export const replaceQualifyingTotalSet = internalMutation({
  args: { eventName: v.string(), rows: v.array(qualifyingTotalRow) },
  handler: async (ctx, { eventName, rows }) => {
    if (!eventName.trim()) throw new Error('eventName is required');
    if (!rows.length) throw new Error(`refusing to replace ${eventName} qualifying totals with an empty payload`);
    const counts = await replaceExactSet(ctx, {
      insert: (doc) => ctx.db.insert('qualifying_totals', doc),
      replace: (current, doc) => ctx.db.replace(current._id, doc),
      stored: await readAll(
        ctx.db
          .query('qualifying_totals')
          .withIndex('by_event', (q) => q.eq('eventName', eventName)),
        QUALIFYING_TOTALS_MAX,
        'qualifying totals',
      ),
      docs: rows.map((row) => ({
        eventName,
        ageCategory: normalizeAgeCategory(row.ageCategory),
        gender: normalizeGender(row.gender),
        weightClass: row.weightClass,
        qualifyingTotal: row.qualifyingTotal,
      })),
      changed: (current, doc) => current.qualifyingTotal !== doc.qualifyingTotal || current.gender !== doc.gender || current.ageCategory !== doc.ageCategory,
      duplicate: (key) => `Duplicate ${eventName} qualifying total in payload: ${key}`,
    });
    if (counts.inserted + counts.updated + counts.deleted > 0) {
      await recordWrite(ctx, 'qualifying_totals', [{ kind: 'table', key: 'qualifying_totals' }]);
    }
    return counts;
  },
});

/**
 * Renames one event's qualifying totals, as when a season's sets gain their
 * year ("Virus Series" -> "2026 Virus Series"). Refuses a missing source or
 * a name already in use, so two sets never merge.
 *
 *   npx convex run ingest:renameQualifyingTotalSet '{"from":"…","to":"…"}'
 */
export const renameQualifyingTotalSet = internalMutation({
  args: { from: v.string(), to: v.string() },
  handler: async (ctx, { from, to }) => {
    if (!to.trim()) throw new Error('to is required');
    if (from === to) throw new Error(`${from} already has that name`);
    const taken = await ctx.db
      .query('qualifying_totals')
      .withIndex('by_event', (q) => q.eq('eventName', to))
      .first();
    if (taken) throw new Error(`refusing to rename ${from} qualifying totals onto existing event ${to}`);
    const rows = await readAll(
      ctx.db
        .query('qualifying_totals')
        .withIndex('by_event', (q) => q.eq('eventName', from)),
      QUALIFYING_TOTALS_MAX,
      'qualifying totals',
    );
    if (!rows.length) throw new Error(`no ${from} qualifying totals to rename`);
    for (const row of rows) await ctx.db.patch(row._id, { eventName: to });
    await recordWrite(ctx, 'qualifying_totals', [{ kind: 'table', key: 'qualifying_totals' }]);
    return { renamed: rows.length };
  },
});

/**
 * Deletes one event's qualifying totals, for a set that no longer qualifies
 * anyone (its classes retired, its events over). Refuses an unknown event, so
 * a misspelled name is an error rather than a no-op.
 *
 *   npx convex run ingest:deleteQualifyingTotalSet '{"eventName":"…"}'
 */
export const deleteQualifyingTotalSet = internalMutation({
  args: { eventName: v.string() },
  handler: async (ctx, { eventName }) => {
    const rows = await readAll(
      ctx.db
        .query('qualifying_totals')
        .withIndex('by_event', (q) => q.eq('eventName', eventName)),
      QUALIFYING_TOTALS_MAX,
      'qualifying totals',
    );
    if (!rows.length) throw new Error(`no ${eventName} qualifying totals to delete`);
    for (const row of rows) await ctx.db.delete(row._id);
    await recordWrite(ctx, 'qualifying_totals', [{ kind: 'table', key: 'qualifying_totals' }]);
    return { deleted: rows.length };
  },
});

const intlRankingRow = v.object({
  ranking: v.number(),
  name: v.string(),
  weightClass: v.optional(v.string()),
  total: v.optional(v.number()),
  percentA: v.optional(v.number()),
});

type SyncCounts = { inserted: number; updated: number; unchanged: number; deleted: number };

/**
 * Exact-set sync of one international rankings group (meet, gender, age),
 * `replace_intl_rankings_group` in the Python writer: rows are keyed by
 * (rank, name); a row missing from the payload is deleted, an unchanged one
 * left alone. The whole payload is checked before anything is written, so a
 * duplicate key aborts with no change, and an empty payload (a failed scrape,
 * not an empty group) is refused.
 */
export const replaceIntlRankingsGroup = internalMutation({
  args: { meet: v.string(), gender: v.string(), ageCategory: v.string(), rankings: v.array(intlRankingRow) },
  handler: async (ctx, args): Promise<SyncCounts> => {
    const meet = args.meet;
    const gender = normalizeGender(args.gender);
    const ageCategory = normalizeAgeCategory(args.ageCategory);
    for (const [field, value] of [['meet', meet], ['gender', gender], ['ageCategory', ageCategory]] as const) {
      if (!value.trim()) throw new Error(`${field} is required`);
    }
    if (args.rankings.length === 0) {
      throw new Error(`refusing to replace intl rankings for ${meet}/${gender}/${ageCategory} with an empty payload`);
    }
    const existing = (
      await bySpellingOf(gender, (spelling) =>
        readAll(
          ctx.db
            .query('intl_rankings')
            .withIndex('by_gender_age', (q) => q.eq('gender', spelling).eq('ageCategory', ageCategory)),
          INTL_RANKINGS_MAX,
          'international rankings',
        ),
      )
    ).filter((row) => row.meet === meet);
    const keyOf = (ranking: number | undefined, name: string | undefined) => JSON.stringify([ranking, name]);
    const incoming = new Set<string>();
    const writes: { id: (typeof existing)[number]['_id'] | null; doc: Omit<(typeof existing)[number], '_id' | '_creationTime'> }[] = [];
    // Checked before any write: a duplicate key in the payload aborts cleanly.
    for (const row of args.rankings) {
      const key = keyOf(row.ranking, row.name);
      if (incoming.has(key)) throw new Error(`Duplicate intl ranking in payload: ${meet}/${gender}/${ageCategory}/${row.ranking}/${row.name}`);
      incoming.add(key);
    }
    const { byKey: existingByKey, deleted: duplicates } = await onePerKey(ctx, existing, (row) => keyOf(row.ranking, row.name));
    const counts: SyncCounts = { inserted: 0, updated: 0, unchanged: 0, deleted: 0 };
    for (const row of args.rankings) {
      const key = keyOf(row.ranking, row.name);
      const doc = { meet, ranking: row.ranking, name: row.name, weightClass: row.weightClass, total: row.total, percentA: row.percentA, gender, ageCategory };
      const current = existingByKey.get(key);
      if (!current) {
        counts.inserted += 1;
        writes.push({ id: null, doc });
      } else if (
        current.legacyId !== undefined ||
        current.gender !== doc.gender ||
        current.weightClass !== doc.weightClass ||
        current.total !== doc.total ||
        current.percentA !== doc.percentA
      ) {
        counts.updated += 1;
        writes.push({ id: current._id, doc });
      } else {
        counts.unchanged += 1;
      }
    }
    const deletions = [...existingByKey.entries()].filter(([key]) => !incoming.has(key)).map(([, row]) => row);
    counts.deleted = deletions.length + duplicates;
    for (const row of deletions) await ctx.db.delete(row._id);
    for (const { id, doc } of writes) {
      if (id) await ctx.db.replace(id, doc);
      else await ctx.db.insert('intl_rankings', doc);
    }
    if (counts.inserted + counts.updated + counts.deleted > 0) {
      await recordWrite(ctx, 'intl_rankings', [{ kind: 'table', key: 'intl_rankings' }]);
    }
    return counts;
  },
});

/**
 * At most this share of the stored groups (and always this many) may be
 * pruned in one run without `allowShrink`. The standings page lists a few
 * dozen groups, so the WSO limits (20 classes) would never apply here.
 */
const INTL_GROUP_PRUNE_LIMIT = { share: 0.25, min: 2 };

/**
 * Deletes every international rankings group not in `groups` (the ones the
 * page still links), `delete_missing_intl_ranking_groups` in the Python
 * writer. An empty list deletes nothing. Without `allowShrink`, more than
 * INTL_GROUP_PRUNE_LIMIT of the stored groups is refused (nothing deleted):
 * groups vanish from the page when its cards change wording, not only when
 * they retire.
 */
export const deleteMissingIntlRankingGroups = internalMutation({
  args: { groups: v.array(v.object({ meet: v.string(), gender: v.string(), ageCategory: v.string() })), allowShrink: v.optional(v.boolean()) },
  handler: async (ctx, { groups, allowShrink }) => {
    const active = new Set(
      groups
        .map((g) => ({ meet: g.meet, gender: normalizeGender(g.gender), ageCategory: normalizeAgeCategory(g.ageCategory) }))
        .filter((g) => g.meet && g.gender && g.ageCategory)
        .map((g) => JSON.stringify([g.meet, g.gender, g.ageCategory])),
    );
    if (active.size === 0) return { deletedGroups: [], deleted: 0 };
    const byGroup = new Map<string, { meet: string; gender: string; ageCategory: string; ids: (typeof rows)[number]['_id'][] }>();
    const rows = await readAll(ctx.db.query('intl_rankings'), INTL_RANKINGS_MAX, 'international rankings');
    for (const row of rows) {
      const key = JSON.stringify([row.meet ?? null, storedGender(row.gender), row.ageCategory ?? null]);
      if (active.has(key)) continue;
      const group = byGroup.get(key) ?? { meet: row.meet ?? '', gender: row.gender ?? '', ageCategory: row.ageCategory ?? '', ids: [] };
      group.ids.push(row._id);
      byGroup.set(key, group);
    }
    const storedGroups = new Set(rows.map((row) => JSON.stringify([row.meet ?? null, storedGender(row.gender), row.ageCategory ?? null]))).size;
    if (!allowShrink && exceedsShrink(byGroup.size, storedGroups, INTL_GROUP_PRUNE_LIMIT)) {
      throw new Error(
        `refusing to prune ${byGroup.size} of ${storedGroups} international rankings groups no longer on the standings page ` +
          `(${[...byGroup.values()].map((g) => `${g.meet}/${g.gender}/${g.ageCategory}`).join(', ')}). ` +
          `If the page really retired them: npx convex run scrapers/intlRankings:run '{"allowShrink":true}' (add --prod for production)`,
      );
    }
    const deletedGroups = [];
    for (const group of byGroup.values()) {
      for (const id of group.ids) await ctx.db.delete(id);
      deletedGroups.push({ meet: group.meet, gender: group.gender, ageCategory: group.ageCategory, deleted: group.ids.length });
    }
    const deleted = deletedGroups.reduce((sum, g) => sum + g.deleted, 0);
    if (deleted > 0) await recordWrite(ctx, 'intl_rankings', [{ kind: 'table', key: 'intl_rankings' }]);
    return { deletedGroups, deleted };
  },
});
