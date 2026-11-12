import { HTTP_VALIDATOR_CACHE_LIMIT, usableEtag, ValidatorCache } from '@/lib/api/http-cache';
import { assertObject } from '@/lib/api/api-validators';
import { decodeJsonText, request } from '@/lib/api/meetcal-api';

type ConditionalAnswer = { etag: string | null; body: unknown; hasBody: boolean };

export function readConditional(value: unknown, path: string): ConditionalAnswer {
  assertObject(value, path);
  const etag = typeof value.etag === 'string' ? value.etag : null;
  if ('json' in value && value.json !== undefined) {
    return { etag, body: decodeJsonText({ json: value.json }, path), hasBody: true };
  }
  const hasBody = 'body' in value && value.body !== undefined;
  return { etag, body: value.body, hasBody };
}

const validatorCache = new ValidatorCache(HTTP_VALIDATOR_CACHE_LIMIT);
const revalidationsInFlight = new Map<string, Promise<SharedAnswer>>();

let revalidationsStarted = 0;

export function clearHttpValidatorCache(): void {
  validatorCache.clear();
  revalidationsInFlight.clear();
}

function stableKey(fn: string, args: Record<string, unknown>): string {
  const sorted = Object.keys(args)
    .filter((key) => args[key] !== undefined)
    .sort()
    .map((key) => [key, args[key]]);
  return `${fn}:${JSON.stringify(sorted)}`;
}

export type TaggedAnswer<T> = { status: 'fresh'; value: T; tag: string | null } | { status: 'unchanged'; tag: string };

type SharedAnswer = { status: 'fresh'; body: unknown; tag: string | null } | { status: 'unchanged'; tag: string };

type ReadOutcome<T> = { answer: TaggedAnswer<T>; shared: SharedAnswer };

type RevalidateOptions = {
  keyArgs?: Record<string, unknown>;
  knownTag?: string | null;
};

export function revalidateTagged<T>(
  path: string,
  fn: string,
  args: Record<string, unknown>,
  validate: (json: unknown) => T,
  { keyArgs = args, knownTag = null }: RevalidateOptions = {},
): Promise<TaggedAnswer<T>> {
  const key = stableKey(fn, keyArgs);
  const flightKey = `${key}\u0000${knownTag ?? ''}`;
  const joined = revalidationsInFlight.get(flightKey);
  if (joined) return joined.then((shared) => validatedShare(shared, validate));
  const run = revalidateOnce(key, path, fn, args, validate, knownTag).finally(() => {
    revalidationsInFlight.delete(flightKey);
  });
  const shared = run.then((outcome) => outcome.shared);
  shared.catch(() => undefined);
  revalidationsInFlight.set(flightKey, shared);
  return run.then((outcome) => outcome.answer);
}

function validatedShare<T>(shared: SharedAnswer, validate: (json: unknown) => T): TaggedAnswer<T> {
  if (shared.status === 'unchanged') return shared;
  return { status: 'fresh', value: validate(shared.body), tag: shared.tag };
}

function answered<T>(body: unknown, value: T, tag: string | null, knownTag: string | null): ReadOutcome<T> {
  if (knownTag !== null && tag === knownTag) {
    const unchanged = { status: 'unchanged', tag: knownTag } as const;
    return { answer: unchanged, shared: unchanged };
  }
  return { answer: { status: 'fresh', value, tag }, shared: { status: 'fresh', body, tag } };
}

async function revalidateOnce<T>(
  key: string,
  path: string,
  fn: string,
  args: Record<string, unknown>,
  validate: (json: unknown) => T,
  knownTag: string | null,
): Promise<ReadOutcome<T>> {
  revalidationsStarted += 1;
  const started = revalidationsStarted;
  const held = validatorCache.get(key);
  const call = (ifNoneMatch: string | undefined): Promise<unknown> =>
    request({ path, fn, kind: 'query', args: { ...args, ifNoneMatch }, conditional: true });
  const sentTag = held?.etag ?? knownTag ?? undefined;
  let answer = readConditional(await call(sentTag), path);

  if (!answer.hasBody) {
    if (held && (answer.etag == null || answer.etag === held.etag)) {
      const current = validatorCache.get(key);
      if (current && current !== held) return answered(current.body, validate(current.body), current.etag, knownTag);
      if (current === held) validatorCache.set(key, { ...held, started });
      return answered(held.body, validate(held.body), held.etag, knownTag);
    }
    if (!held && knownTag !== null && (answer.etag == null || answer.etag === knownTag)) {
      const unchanged = { status: 'unchanged', tag: knownTag } as const;
      return { answer: unchanged, shared: unchanged };
    }
    validatorCache.delete(key);
    answer = readConditional(await call(undefined), path);
    if (!answer.hasBody) throw new Error(`${path} answered without a body`);
  }

  const value = validate(answer.body);
  const current = validatorCache.get(key);
  if (current && (current.started ?? 0) > started) {
    return answered(current.body, validate(current.body), current.etag, knownTag);
  }
  const etag = usableEtag(answer.etag);
  if (etag) {
    validatorCache.set(key, { etag, body: answer.body, started });
  } else {
    validatorCache.delete(key);
  }
  return answered(answer.body, value, etag, knownTag);
}

function freshValue<T>(answer: TaggedAnswer<T>, path: string): T {
  if (answer.status === 'unchanged') throw new Error(`${path} answered unchanged to a read that held no tag`);
  return answer.value;
}

export async function getRevalidated<T>(
  path: string,
  fn: string,
  args: Record<string, unknown>,
  validate: (json: unknown) => T,
  keyArgs: Record<string, unknown> = args,
): Promise<T> {
  return freshValue(await revalidateTagged(path, fn, args, validate, { keyArgs }), path);
}
