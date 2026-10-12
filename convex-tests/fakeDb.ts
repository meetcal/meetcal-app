/**
 * An in-memory stand-in for a mutation's `ctx.db`, enough for the ingest
 * write paths: `query(table).withIndex(name, q => q.eq(...))` (indexes are
 * read as equality filters on their fields, in insertion order), `.filter`
 * with `q.field`/`q.eq`/`q.neq`, `collect`/`first`, and `insert`, `patch`,
 * `replace`, `delete`. Call a registered function's handler with it through
 * `handlerOf`.
 */
type Doc = Record<string, unknown> & { _id: string; _creationTime: number };
type Predicate = (doc: Doc) => boolean;

export function fakeDb(seed: Record<string, Record<string, unknown>[]> = {}) {
  const tables = new Map<string, Doc[]>();
  let next = 0;
  const table = (name: string) => {
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name)!;
  };
  const find = (id: string) => {
    for (const docs of tables.values()) {
      const at = docs.findIndex((doc) => doc._id === id);
      if (at !== -1) return { docs, at };
    }
    throw new Error(`no document ${id}`);
  };
  const insert = async (name: string, value: Record<string, unknown>) => {
    const _id = `${name}:${next++}`;
    table(name).push({ ...value, _id, _creationTime: next });
    return _id;
  };
  for (const [name, docs] of Object.entries(seed)) for (const doc of docs) void insert(name, doc);

  function query(name: string) {
    const predicates: Predicate[] = [];
    const results = () => table(name).filter((doc) => predicates.every((p) => p(doc)));
    const chain = {
      withIndex(_index: string, build?: (q: unknown) => unknown) {
        const q = {
          eq(field: string, value: unknown) {
            predicates.push((doc) => doc[field] === value);
            return q;
          },
        };
        build?.(q);
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
      collect: async () => results().map((doc) => ({ ...doc })),
      first: async () => {
        const [doc] = results();
        return doc ? { ...doc } : null;
      },
    };
    return chain;
  }

  const db = {
    query,
    insert,
    get: async (id: string) => {
      const { docs, at } = find(id);
      return { ...docs[at] };
    },
    patch: async (id: string, fields: Record<string, unknown>) => {
      const { docs, at } = find(id);
      const doc = { ...docs[at], ...fields };
      for (const key of Object.keys(doc)) if (doc[key] === undefined) delete doc[key];
      docs[at] = doc;
    },
    replace: async (id: string, value: Record<string, unknown>) => {
      const { docs, at } = find(id);
      docs[at] = { ...value, _id: docs[at]._id, _creationTime: docs[at]._creationTime };
    },
    delete: async (id: string) => {
      const { docs, at } = find(id);
      docs.splice(at, 1);
    },
  };
  /** A table's documents without their system fields. */
  const rows = (name: string) => table(name).map(({ _id: _i, _creationTime: _c, ...doc }) => doc);
  return { db, rows };
}

/** The handler Convex attaches to a registered function (left out of its public types). */
export function handlerOf<Args, Result>(registered: unknown): (ctx: unknown, args: Args) => Promise<Result> {
  if (typeof registered !== 'function' || !('_handler' in registered) || typeof registered._handler !== 'function') {
    throw new Error('Missing Convex handler');
  }
  return registered._handler as (ctx: unknown, args: Args) => Promise<Result>;
}
