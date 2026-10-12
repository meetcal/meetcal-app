import { getFunctionName } from 'convex/server';
import schema from '../convex/schema';

/**
 * An in-memory stand-in for a mutation's `ctx.db`, enough for the ingest
 * write paths, the migrations and the refresh bookkeeping:
 * `query(table).withIndex(name, q => q.eq(...).gt(...))` (a schema index
 * orders its rows by its fields, then creation, as Convex does; ranges are
 * filters on those fields), `.order`, `.filter` with
 * `q.field`/`q.eq`/`q.neq`, `collect`/`first`/`unique`/`take`/`paginate`, and
 * `get`, `normalizeId`, `insert`, `patch`, `replace`, `delete`. Call a
 * registered function's handler with it through `handlerOf`; `fakeMutationCtx`
 * adds a scheduler that records what was scheduled.
 */
type Doc = Record<string, unknown> & { _id: string; _creationTime: number };
type Predicate = (doc: Doc) => boolean;

/** Convex's order of values across types (undefined first), then within one. */
function compareValues(a: unknown, b: unknown): number {
  const rank = (value: unknown) =>
    value === undefined ? 0 : value === null ? 1 : typeof value === 'number' ? 3 : typeof value === 'boolean' ? 4 : typeof value === 'string' ? 5 : 6;
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  if (typeof a === 'number' || typeof a === 'boolean') return Number(a) - Number(b);
  if (typeof a === 'string') return a < (b as string) ? -1 : a > (b as string) ? 1 : 0;
  return 0;
}

const compareTuples = (a: readonly unknown[], b: readonly unknown[]) => {
  for (let i = 0; i < a.length; i++) {
    const order = compareValues(a[i], b[i]);
    if (order !== 0) return order;
  }
  return 0;
};

function indexFields(table: string, index: string): string[] {
  const definition = (schema.tables as Record<string, { ' indexes'(): { indexDescriptor: string; fields: string[] }[] }>)[table];
  return definition?.[' indexes']().find((i) => i.indexDescriptor === index)?.fields ?? [];
}

export function fakeDb(seed: Record<string, Record<string, unknown>[]> = {}) {
  const tables = new Map<string, Doc[]>();
  let next = 0;
  const table = (name: string) => {
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name)!;
  };
  const locate = (id: string) => {
    for (const docs of tables.values()) {
      const at = docs.findIndex((doc) => doc._id === id);
      if (at !== -1) return { docs, at };
    }
    return null;
  };
  const find = (id: string) => {
    const found = locate(id);
    if (!found) throw new Error(`no document ${id}`);
    return found;
  };
  const insert = async (name: string, value: Record<string, unknown>) => {
    const _id = `${name}:${next++}`;
    const doc: Doc = { ...value, _id, _creationTime: next };
    for (const key of Object.keys(doc)) if (doc[key] === undefined) delete doc[key];
    table(name).push(doc);
    return _id;
  };
  for (const [name, docs] of Object.entries(seed)) for (const doc of docs) void insert(name, doc);

  function query(name: string) {
    const predicates: Predicate[] = [];
    let fields: string[] = [];
    let descending = false;
    const keyOf = (doc: Doc) => [...fields.map((field) => doc[field]), doc._creationTime];
    const results = () => {
      const rows = table(name)
        .filter((doc) => predicates.every((p) => p(doc)))
        .sort((a, b) => compareTuples(keyOf(a), keyOf(b)));
      return descending ? rows.reverse() : rows;
    };
    const copy = (doc: Doc) => ({ ...doc });
    const chain = {
      withIndex(index: string, build?: (q: unknown) => unknown) {
        fields = indexFields(name, index);
        const range = (test: (order: number) => boolean) => (field: string, value: unknown) => {
          predicates.push((doc) => test(compareValues(doc[field], value)));
          return q;
        };
        const q = {
          eq: range((order) => order === 0),
          gt: range((order) => order > 0),
          gte: range((order) => order >= 0),
          lt: range((order) => order < 0),
          lte: range((order) => order <= 0),
        };
        build?.(q);
        return chain;
      },
      order(direction: 'asc' | 'desc') {
        descending = direction === 'desc';
        return chain;
      },
      filter(build: (q: unknown) => Predicate) {
        const value = (operand: unknown, doc: Doc) => (typeof operand === 'object' && operand !== null && 'field' in operand ? doc[(operand as { field: string }).field] : operand);
        const q = {
          field: (field: string) => ({ field }),
          eq: (a: unknown, b: unknown) => (doc: Doc) => value(a, doc) === value(b, doc),
          neq: (a: unknown, b: unknown) => (doc: Doc) => value(a, doc) !== value(b, doc),
        };
        predicates.push(build(q));
        return chain;
      },
      collect: async () => results().map(copy),
      take: async (n: number) => results().slice(0, n).map(copy),
      first: async () => {
        const [doc] = results();
        return doc ? copy(doc) : null;
      },
      unique: async () => {
        const rows = results();
        if (rows.length > 1) throw new Error(`unique() matched ${rows.length} ${name} documents`);
        return rows[0] ? copy(rows[0]) : null;
      },
      /** Cursors are the last row's index key, so rows deleted between pages do not shift the next one. */
      paginate: async ({ cursor, numItems }: { cursor: string | null; numItems: number }) => {
        const after = cursor === null ? null : (JSON.parse(cursor) as unknown[]);
        const rows = results().filter((doc) => after === null || compareTuples(keyOf(doc), after) * (descending ? -1 : 1) > 0);
        const page = rows.slice(0, numItems);
        const last = page[page.length - 1];
        return {
          page: page.map(copy),
          isDone: rows.length <= numItems,
          continueCursor: last ? JSON.stringify(keyOf(last)) : (cursor ?? JSON.stringify([])),
        };
      },
    };
    return chain;
  }

  const db = {
    query,
    insert,
    get: async (id: string) => {
      const found = locate(id);
      return found ? { ...found.docs[found.at] } : null;
    },
    normalizeId: (name: string, id: string) => (id.startsWith(`${name}:`) ? id : null),
    patch: async (id: string, fields: Record<string, unknown>) => {
      const { docs, at } = find(id);
      const doc = { ...docs[at], ...fields };
      for (const key of Object.keys(doc)) if (doc[key] === undefined) delete doc[key];
      docs[at] = doc;
    },
    replace: async (id: string, value: Record<string, unknown>) => {
      const { docs, at } = find(id);
      const doc: Doc = { ...value, _id: docs[at]._id, _creationTime: docs[at]._creationTime };
      for (const key of Object.keys(doc)) if (doc[key] === undefined) delete doc[key];
      docs[at] = doc;
    },
    delete: async (id: string) => {
      const { docs, at } = find(id);
      docs.splice(at, 1);
    },
  };
  /** A table's documents without their system fields. */
  const rows = (name: string) => table(name).map(({ _id: _i, _creationTime: _c, ...doc }) => doc);
  /** A table's documents with their system fields. */
  const docs = (name: string) => table(name).map((doc) => ({ ...doc }));
  return { db, rows, docs };
}

/** A mutation context over `fakeDb`, whose scheduler records each call by function name. */
export function fakeMutationCtx(seed: Record<string, Record<string, unknown>[]> = {}) {
  const store = fakeDb(seed);
  const scheduled: { name: string; delayMs: number; args: unknown }[] = [];
  const scheduler = {
    runAfter: async (delayMs: number, fn: unknown, args: unknown) => {
      scheduled.push({ name: getFunctionName(fn as never), delayMs, args });
    },
  };
  return { ...store, ctx: { db: store.db, scheduler }, scheduled };
}

/** The handler Convex attaches to a registered function (left out of its public types). */
export function handlerOf<Args, Result>(registered: unknown): (ctx: unknown, args: Args) => Promise<Result> {
  if (typeof registered !== 'function' || !('_handler' in registered) || typeof registered._handler !== 'function') {
    throw new Error('Missing Convex handler');
  }
  return registered._handler as (ctx: unknown, args: Args) => Promise<Result>;
}
