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

let revalidationsStarted = 0;

export function clearHttpValidatorCache(): void {
  validatorCache.clear();
}

function stableKey(fn: string, args: Record<string, unknown>): string {
  const sorted = Object.keys(args)
    .filter((key) => args[key] !== undefined)
    .sort()
    .map((key) => [key, args[key]]);
  return `${fn}:${JSON.stringify(sorted)}`;
}

export async function getRevalidated<T>(
  path: string,
  fn: string,
  args: Record<string, unknown>,
  validate: (json: unknown) => T,
  keyArgs: Record<string, unknown> = args,
): Promise<T> {
  const key = stableKey(fn, keyArgs);
  revalidationsStarted += 1;
  const started = revalidationsStarted;
  const held = validatorCache.get(key);
  const call = (ifNoneMatch: string | undefined): Promise<unknown> =>
    request({ path, fn, kind: 'query', args: { ...args, ifNoneMatch }, conditional: true });
  let answer = readConditional(await call(held?.etag), path);

  if (!answer.hasBody) {
    if (held && (answer.etag == null || answer.etag === held.etag)) {
      const current = validatorCache.get(key);
      if (current && current !== held) return validate(current.body);
      if (current === held) validatorCache.set(key, { ...held, started });
      return validate(held.body);
    }
    validatorCache.delete(key);
    answer = readConditional(await call(undefined), path);
    if (!answer.hasBody) throw new Error(`${path} answered without a body`);
  }

  const value = validate(answer.body);
  const current = validatorCache.get(key);
  if (current && (current.started ?? 0) > started) return validate(current.body);
  const etag = usableEtag(answer.etag);
  if (etag) {
    validatorCache.set(key, { etag, body: answer.body, started });
  } else {
    validatorCache.delete(key);
  }
  return value;
}
