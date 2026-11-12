export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export function rowCount(total: unknown): number | null {
  const count = typeof total === 'string' && /^\d+$/.test(total.trim()) ? Number(total) : total;
  return typeof count === 'number' && Number.isInteger(count) && count >= 0 ? count : null;
}

export const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export const isString = (value: unknown): value is string => typeof value === 'string';

export const isNumber = (value: unknown): value is number => typeof value === 'number';

export const isStringOrNull = (value: unknown): value is string | null => value === null || typeof value === 'string';

export const isListOf =
  <Item>(isItem: (item: unknown) => item is Item) =>
  (value: unknown): value is Item[] => {
    if (!Array.isArray(value)) return false;
    const items: unknown[] = value;
    return items.every(isItem);
  };

export const isPairOf =
  <First, Second>(isFirst: (item: unknown) => item is First, isSecond: (item: unknown) => item is Second) =>
  (value: unknown): value is [First, Second] => {
    if (!Array.isArray(value) || value.length !== 2) return false;
    const [first, second]: unknown[] = value;
    return isFirst(first) && isSecond(second);
  };

export function parsedAs<Shape>(text: string, isShape: (value: unknown) => value is Shape, what: string): Shape {
  const value: unknown = JSON.parse(text);
  if (!isShape(value)) throw new Error(`${what} is not stored in the shape it is read in`);
  return value;
}

export const isStringList = isListOf(isString);

export const isMember =
  <Value extends string>(values: readonly Value[]) =>
  (value: unknown): value is Value =>
    values.some((known) => known === value);

export const typedKeys = <Shape extends object>(object: Shape): Extract<keyof Shape, string>[] => {
  const keys: Extract<keyof Shape, string>[] = [];
  for (const key in object) if (Object.prototype.hasOwnProperty.call(object, key)) keys.push(key);
  return keys;
};

export const isOwnKey = <Shape extends object>(object: Shape, key: PropertyKey): key is keyof Shape => Object.prototype.hasOwnProperty.call(object, key);

export const textOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : value === null || value === undefined ? null : String(value));

export function changedFields<Shape extends object>(next: Shape, current: { [Key in keyof Shape]?: unknown }): Partial<Shape> {
  const changed: Partial<Shape> = {};
  for (const key of typedKeys(next)) if (current[key] !== next[key]) changed[key] = next[key];
  return changed;
}

export const isAnything = (value: unknown): value is unknown => value !== undefined;

const hasEveryKey = <Key extends string, Value>(record: Partial<Record<Key, Value>>, keys: readonly Key[]): record is Record<Key, Value> => keys.every((key) => key in record);

export function completeRecord<Key extends string, Value>(keys: readonly Key[], valueOf: (key: Key) => Value): Record<Key, Value> {
  const built: Partial<Record<Key, Value>> = {};
  for (const key of keys) built[key] = valueOf(key);
  if (!hasEveryKey(built, keys)) throw new Error('a record was built without one of its keys');
  return built;
}

export const isTextPair = isPairOf(isString, isString);

export function itemAt<Item>(items: readonly Item[], index: number): Item {
  if (Number.isInteger(index) && index >= 0) for (const item of items.slice(index, index + 1)) return item;
  throw new RangeError(`no item ${index} in a list of ${items.length}`);
}

export const last = <Item>(items: readonly Item[]): Item => itemAt(items, items.length - 1);

export const groupOf = (match: RegExpMatchArray, group: number): string => match[group] ?? '';
