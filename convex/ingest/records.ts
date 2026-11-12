import { RECORDS_MAX, WSO_RECORDS_MAX, readAll } from '../lib/boundedRead';
import { v, type Infer } from 'convex/values';
import { internalMutation, type MutationCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import { classKey, normalizeAgeCategory, normalizeGender } from '../lib/normalize';
import { clearedLifts, exceedsShrink, liftCount } from '../lib/shrinkGuard';
import { recordHolder } from '../schema';
import { recordWrite } from './hints';
import { type UpsertOutcome, bySpellingOf, classArg, droppedClasses, groupKey, onePerKey } from './shared';

type Holder = { name: string; date?: string; location?: string };

type Lifts = { snatchRecord?: number; cjRecord?: number; totalRecord?: number; snatchBy?: Holder; cjBy?: Holder; totalBy?: Holder };

const holderKey = (holder: Holder | undefined) => (holder ? JSON.stringify([holder.name, holder.date ?? null, holder.location ?? null]) : '');

/** Whether a record's lifts or their holders differ from what is stored. */
function liftsChanged(stored: Lifts, next: Lifts): boolean {
  return (
    stored.snatchRecord !== next.snatchRecord ||
    stored.cjRecord !== next.cjRecord ||
    stored.totalRecord !== next.totalRecord ||
    holderKey(stored.snatchBy) !== holderKey(next.snatchBy) ||
    holderKey(stored.cjBy) !== holderKey(next.cjBy) ||
    holderKey(stored.totalBy) !== holderKey(next.totalBy)
  );
}

const holderArgs = { snatchBy: v.optional(recordHolder), cjBy: v.optional(recordHolder), totalBy: v.optional(recordHolder) };

const recordRow = v.object({
  recordType: v.string(),
  ageCategory: v.string(),
  gender: v.string(),
  weightClass: v.string(),
  snatchRecord: v.optional(v.number()),
  cjRecord: v.optional(v.number()),
  totalRecord: v.optional(v.number()),
  ...holderArgs,
});

export const upsertRecords = internalMutation({
  args: { rows: v.array(recordRow), allowShrink: v.optional(v.boolean()) },
  handler: async (ctx, { rows, allowShrink }): Promise<UpsertOutcome[]> => {
    const pairs = [];
    for (const row of rows) {
      const doc = { recordType: row.recordType, ...recordClassDoc(row) };
      const existing = (
        await bySpellingOf(doc.gender, (gender) =>
          readAll(
            ctx.db
              .query('records')
              .withIndex('by_type_age_gender', (q) => q.eq('recordType', doc.recordType).eq('ageCategory', doc.ageCategory).eq('gender', gender)),
            RECORDS_MAX,
            'records',
          ),
        )
      ).find((r) => r.weightClass === doc.weightClass);
      pairs.push({ key: JSON.stringify([doc.recordType, doc.ageCategory, doc.gender, doc.weightClass]), doc, existing });
    }
    if (!allowShrink) {
      const final = new Map(pairs.map((pair) => [pair.key, pair]));
      const matched = [...final.values()].filter((pair) => pair.existing !== undefined);
      const storedLifts = matched.reduce((sum, { existing }) => sum + liftCount(existing!), 0);
      const cleared = matched.reduce((sum, { doc, existing }) => sum + clearedLifts(existing!, doc), 0);
      if (exceedsShrink(cleared, storedLifts)) {
        throw new Error(
          `refusing to clear ${cleared} of ${storedLifts} stored record lifts (the source may be partly broken). ` +
            `If it really cleared them, rerun its sync with '{"allowShrink":true}'`,
        );
      }
    }
    const outcomes: UpsertOutcome[] = [];
    const written = new Map<string, Lifts & { gender: string; ageCategory: string; _id: Id<'records'> }>();
    for (const { key, doc, existing } of pairs) {
      const current = written.get(key) ?? existing;
      if (!current) {
        written.set(key, { ...doc, _id: await ctx.db.insert('records', doc) });
        outcomes.push({ wasInsert: true, wasChanged: true });
      } else if (recordChanged(current, doc)) {
        await ctx.db.replace(current._id, doc);
        written.set(key, { ...doc, _id: current._id });
        outcomes.push({ wasInsert: false, wasChanged: true });
      } else {
        outcomes.push({ wasInsert: false, wasChanged: false });
      }
    }
    if (outcomes.some((o) => o.wasChanged)) await recordWrite(ctx, 'records', [{ kind: 'table', key: 'records' }]);
    return outcomes;
  },
});

/**
 * Deletes the classes of `recordType` its source no longer lists (`keep` is
 * every class the sync just wrote), within `groups` (age and gender) when
 * given: a source read in parts (UMWF's tabs) prunes only the parts it read,
 * so a tab that failed keeps its classes.
 */
export const pruneRecords = internalMutation({
  args: {
    recordType: v.string(),
    keep: v.array(classArg),
    groups: v.optional(v.array(v.object({ ageCategory: v.string(), gender: v.string() }))),
    allowShrink: v.optional(v.boolean()),
    // Check the guard and list what would be deleted, deleting nothing.
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, { recordType, keep, groups, allowShrink, dryRun }) => {
    if (keep.some((row) => groups !== undefined && !groups.some((g) => groupKey(g) === groupKey(row)))) {
      throw new Error(`a ${recordType} class to keep is outside the groups pruned`);
    }
    const scope = groups === undefined ? null : new Set(groups.map(groupKey));
    const stored = (await readAll(ctx.db.query('records').withIndex('by_record_type', (q) => q.eq('recordType', recordType)), RECORDS_MAX, 'records')).filter(
      (row) => scope === null || scope.has(groupKey(row)),
    );
    const dropped = droppedClasses(`${recordType} record`, stored, keep, allowShrink);
    if (dryRun) return { deleted: dropped.map((r) => `${r.ageCategory} ${r.gender} ${r.weightClass}`) };
    for (const row of dropped) await ctx.db.delete(row._id);
    if (dropped.length) await recordWrite(ctx, 'records', [{ kind: 'table', key: 'records' }]);
    return { deleted: dropped.map((r) => `${r.ageCategory} ${r.gender} ${r.weightClass}`) };
  },
});

type ExactSetTable = 'records' | 'wso_records' | 'qualifying_totals';

type ExactSetCounts = { inserted: number; updated: number; deleted: number; unchanged: number };

type StoredClass = { ageCategory: string; gender: string; weightClass: string };

export async function replaceExactSet<Stored extends StoredClass & { _id: Id<ExactSetTable> }, Incoming extends StoredClass>(
  ctx: MutationCtx,
  {
    stored,
    docs,
    changed,
    duplicate,
    insert,
    replace,
    onUpdate = () => {},
  }: {
    stored: readonly Stored[];
    docs: readonly Incoming[];
    changed: (stored: Stored, doc: Incoming) => boolean;
    duplicate: (key: string) => string;
    insert: (doc: Incoming) => Promise<unknown>;
    replace: (stored: Stored, doc: Incoming) => Promise<unknown>;
    onUpdate?: (stored: Stored, doc: Incoming) => void;
  },
): Promise<ExactSetCounts> {
  const { byKey: existing, deleted: duplicates } = await onePerKey(ctx, stored, classKey);
  const counts = { inserted: 0, updated: 0, deleted: duplicates, unchanged: 0 };
  const seen = new Set<string>();
  for (const doc of docs) {
    const key = classKey(doc);
    if (seen.has(key)) throw new Error(duplicate(key));
    seen.add(key);
    const current = existing.get(key);
    if (!current) {
      await insert(doc);
      counts.inserted += 1;
    } else if (changed(current, doc)) {
      await replace(current, doc);
      counts.updated += 1;
      onUpdate(current, doc);
    } else counts.unchanged += 1;
  }
  for (const [key, row] of existing) {
    if (seen.has(key)) continue;
    await ctx.db.delete(row._id);
    counts.deleted += 1;
  }
  return counts;
}

type RecordRow = Infer<typeof recordRow>;

function recordClassDoc(row: Omit<RecordRow, 'recordType'>) {
  return {
    ageCategory: normalizeAgeCategory(row.ageCategory),
    gender: normalizeGender(row.gender),
    weightClass: row.weightClass,
    snatchRecord: row.snatchRecord,
    cjRecord: row.cjRecord,
    totalRecord: row.totalRecord,
    snatchBy: row.snatchBy,
    cjBy: row.cjBy,
    totalBy: row.totalBy,
  };
}

const recordChanged = (stored: Lifts & { gender: string; ageCategory: string }, doc: Lifts & { gender: string; ageCategory: string }) =>
  liftsChanged(stored, doc) || stored.gender !== doc.gender || stored.ageCategory !== doc.ageCategory;

export const replaceRecordSet = internalMutation({
  args: { recordType: v.string(), rows: v.array(recordRow) },
  handler: async (ctx, { recordType, rows }) => {
    if (!recordType) throw new Error('recordType is required');
    if (!rows.length) throw new Error(`refusing to replace ${recordType} records with an empty payload`);
    const mistyped = rows.find((row) => row.recordType !== recordType);
    if (mistyped) throw new Error(`row of type ${mistyped.recordType} in a ${recordType} replace`);
    const changes: string[] = [];
    const counts = await replaceExactSet(ctx, {
      insert: (doc) => ctx.db.insert('records', doc),
      replace: (current, doc) => ctx.db.replace(current._id, doc),
      stored: await readAll(ctx.db.query('records').withIndex('by_record_type', (q) => q.eq('recordType', recordType)), RECORDS_MAX, 'records'),
      docs: rows.map((row) => ({ recordType, ...recordClassDoc(row) })),
      changed: recordChanged,
      duplicate: (key) => `Duplicate ${recordType} record in payload: ${key}`,
      onUpdate: (current, doc) => {
        if (!liftsChanged(current, doc)) return;
        changes.push(`${doc.ageCategory} ${doc.gender} ${doc.weightClass}: ${current.snatchRecord}/${current.cjRecord}/${current.totalRecord} -> ${doc.snatchRecord}/${doc.cjRecord}/${doc.totalRecord}`);
      },
    });
    if (counts.inserted + counts.updated + counts.deleted > 0) await recordWrite(ctx, 'records', [{ kind: 'table', key: 'records' }]);
    return { ...counts, changes };
  },
});

const wsoRecordRow = v.object({
  wso: v.string(),
  ageCategory: v.string(),
  gender: v.string(),
  weightClass: v.string(),
  snatchRecord: v.optional(v.number()),
  cjRecord: v.optional(v.number()),
  totalRecord: v.optional(v.number()),
  ...holderArgs,
});

export const replaceWsoRecordSet = internalMutation({
  args: { wso: v.string(), rows: v.array(wsoRecordRow), allowShrink: v.optional(v.boolean()) },
  handler: async (ctx, { wso, rows, allowShrink }) => {
    if (!wso) throw new Error('wso is required');
    if (!rows.length) throw new Error(`refusing to replace ${wso} WSO records with an empty payload`);
    const storedRows = await readAll(ctx.db.query('wso_records').withIndex('by_wso', (q) => q.eq('wso', wso)), WSO_RECORDS_MAX, 'WSO records');
    if (!allowShrink) {
      const incoming = new Map(rows.map((row) => [classKey(row), row]));
      const stored = new Map(storedRows.map((row) => [classKey(row), row]));
      const dropped = [...stored.keys()].filter((key) => !incoming.has(key)).length;
      const storedLifts = [...stored.values()].reduce((sum, row) => sum + liftCount(row), 0);
      const cleared = [...stored].reduce((sum, [key, row]) => sum + (incoming.has(key) ? clearedLifts(row, incoming.get(key)!) : 0), 0);
      const rerun = `npx convex run scrapers/wsoRecords:run '{"only":["${wso}"],"allowShrink":true}' (add --prod for production)`;
      if (exceedsShrink(dropped, stored.size)) {
        throw new Error(`refusing to delete ${dropped} of ${wso}'s ${stored.size} WSO record classes (the source may be partly broken). If it really dropped them: ${rerun}`);
      }
      if (exceedsShrink(cleared, storedLifts)) {
        throw new Error(`refusing to clear ${cleared} of ${wso}'s ${storedLifts} stored WSO record lifts (the source may be partly broken). If it really cleared them: ${rerun}`);
      }
    }
    const counts = await replaceExactSet(ctx, {
      insert: (doc) => ctx.db.insert('wso_records', doc),
      replace: (current, doc) => ctx.db.replace(current._id, doc),
      stored: storedRows,
      docs: rows.map((row) => ({ wso, ...recordClassDoc(row) })),
      changed: recordChanged,
      duplicate: (key) => `Duplicate WSO record in payload: ${key}`,
    });
    if (counts.inserted + counts.updated + counts.deleted > 0) await recordWrite(ctx, 'wso_records', [{ kind: 'table', key: 'wso_records' }]);
    return counts;
  },
});
