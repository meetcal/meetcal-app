/**
 * An in-memory stand-in for Convex's `ctx.db`, enough for the view and
 * reference code: index ranges (`eq`, `gt`, `gte`, `lt`, `lte`) in index
 * order, `order`, `first`, `unique`, `take`, `collect`, `paginate` (the
 * cursor is an offset), and `get` / `insert` / `patch` / `replace` / `delete`.
 * Not a test file: the suites import it.
 */

export type FakeDoc = Record<string, unknown> & { _id: string; _creationTime: number };

/** Index fields per `table.index`; an index not listed sorts by creation time alone. */
const INDEXES: Record<string, string[]> = {
  'views.by_key': ['key'],
  'view_chunks.by_key_index': ['key', 'index'],
  'view_hints.by_kind_key': ['kind', 'key'],
  'view_hints.by_updatedAt': ['updatedAt'],
  'view_state.by_name': ['name'],
  'data_versions.by_table': ['table'],
  'athletes.by_meet': ['meet'],
  'athletes.by_club': ['club'],
  'athletes.by_club_and_meet': ['club', 'meet'],
  'athletes.by_wso': ['wso'],
  'meets.by_name': ['name'],
  'lifting_results.by_adaptive_and_date': ['adaptive', 'date'],
  'lifting_results.by_federation_and_age': ['federation', 'age'],
};

function rank(value: unknown): number {
  if (value === undefined) return 0;
  if (value === null) return 1;
  if (typeof value === 'number') return 2;
  if (typeof value === 'boolean') return 3;
  return 4;
}

function compareValues(a: unknown, b: unknown): number {
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (ra < 2) return 0;
  const x = a as string | number | boolean;
  const y = b as string | number | boolean;
  return x < y ? -1 : x > y ? 1 : 0;
}

export function fakeDb(initial: Record<string, Record<string, unknown>[]> = {}) {
  let nextId = 0;
  let clock = 0;
  const tables = new Map<string, FakeDoc[]>();
  const reads = { count: 0 };
  const table = (name: string) => {
    let rows = tables.get(name);
    if (!rows) tables.set(name, (rows = []));
    return rows;
  };
  const insert = (name: string, fields: Record<string, unknown>): string => {
    const _id = `${name}:${nextId++}`;
    table(name).push({ ...fields, _id, _creationTime: (clock += 1) });
    return _id;
  };
  for (const [name, rows] of Object.entries(initial)) for (const row of rows) insert(name, row);
  const find = (id: string) => {
    for (const rows of tables.values()) {
      const index = rows.findIndex((row) => row._id === id);
      if (index >= 0) return { rows, index };
    }
    return null;
  };

  const query = (name: string) => {
    let fields: string[] = [];
    const filters: ((row: FakeDoc) => boolean)[] = [];
    let descending = false;
    const ordered = () => {
      const rows = table(name)
        .filter((row) => filters.every((f) => f(row)))
        .sort((a, b) => {
          for (const field of fields) {
            const c = compareValues(a[field], b[field]);
            if (c !== 0) return c;
          }
          return a._creationTime - b._creationTime;
        });
      return descending ? rows.reverse() : rows;
    };
    const counted = (rows: FakeDoc[]) => {
      reads.count += rows.length;
      return rows.map((row) => ({ ...row }));
    };
    const chain = {
      withIndex(index: string, build?: (q: unknown) => unknown) {
        fields = INDEXES[`${name}.${index}`] ?? [];
        const q = {
          eq: (field: string, value: unknown) => (filters.push((row) => compareValues(row[field], value) === 0), q),
          gt: (field: string, value: unknown) => (filters.push((row) => compareValues(row[field], value) > 0), q),
          gte: (field: string, value: unknown) => (filters.push((row) => compareValues(row[field], value) >= 0), q),
          lt: (field: string, value: unknown) => (filters.push((row) => compareValues(row[field], value) < 0), q),
          lte: (field: string, value: unknown) => (filters.push((row) => compareValues(row[field], value) <= 0), q),
        };
        build?.(q);
        return chain;
      },
      order(direction: 'asc' | 'desc') {
        descending = direction === 'desc';
        return chain;
      },
      filter() {
        throw new Error('fakeDb: filter is not supported');
      },
      async first() {
        return counted(ordered().slice(0, 1))[0] ?? null;
      },
      async unique() {
        const rows = ordered();
        if (rows.length > 1) throw new Error(`fakeDb: unique() found ${rows.length} rows in ${name}`);
        return counted(rows)[0] ?? null;
      },
      async take(n: number) {
        return counted(ordered().slice(0, n));
      },
      async collect() {
        return counted(ordered());
      },
      async paginate({ cursor, numItems }: { cursor: string | null; numItems: number }) {
        const rows = ordered();
        const offset = Number(cursor ?? 0);
        const end = Math.min(offset + numItems, rows.length);
        return { page: counted(rows.slice(offset, end)), continueCursor: String(end), isDone: end === rows.length };
      },
    };
    return chain;
  };

  const db = {
    query,
    async get(id: string) {
      const found = find(id);
      if (found) reads.count += 1;
      return found ? { ...found.rows[found.index] } : null;
    },
    normalizeId(name: string, id: string) {
      return table(name).some((row) => row._id === id) ? id : null;
    },
    async insert(name: string, fields: Record<string, unknown>) {
      return insert(name, fields);
    },
    async patch(id: string, fields: Record<string, unknown>) {
      const found = find(id);
      if (!found) throw new Error(`fakeDb: no document ${id}`);
      const row = found.rows[found.index];
      for (const [field, value] of Object.entries(fields)) {
        if (value === undefined) delete row[field];
        else row[field] = value;
      }
    },
    async replace(id: string, fields: Record<string, unknown>) {
      const found = find(id);
      if (!found) throw new Error(`fakeDb: no document ${id}`);
      const { _id, _creationTime } = found.rows[found.index];
      found.rows[found.index] = { ...fields, _id, _creationTime };
    },
    async delete(id: string) {
      const found = find(id);
      if (!found) throw new Error(`fakeDb: no document ${id}`);
      found.rows.splice(found.index, 1);
    },
  };

  return { db, reads, rows: (name: string) => table(name).map((row) => ({ ...row })) };
}

/** A registered Convex function's handler (Convex attaches it at runtime but leaves it out of the public types). */
export function handlerOf<Args, Result = unknown>(fn: unknown): (ctx: unknown, args: Args) => Promise<Result> {
  if (typeof fn !== 'function' && (typeof fn !== 'object' || fn === null)) throw new Error('not a Convex function');
  const handler = (fn as { _handler?: unknown })._handler;
  if (typeof handler !== 'function') throw new Error('missing Convex handler');
  return handler as (ctx: unknown, args: Args) => Promise<Result>;
}
