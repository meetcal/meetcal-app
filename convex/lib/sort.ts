/**
 * Sort key for a weight class: numeric order, the `+` class of a number after
 * the bounded one, and classes holding no integer at all last. Same rule as the
 * Rust API's `weight_class_key`.
 */
function weightClassKey(weightClass: string): [boolean, number, boolean] {
  let weight = weightClass;
  while (weight.endsWith('kg')) weight = weight.slice(0, -2);
  const isPlus = weight.endsWith('+');
  while (weight.endsWith('+')) weight = weight.slice(0, -1);
  // `str::parse::<i32>` accepts an optional sign and digits only.
  if (/^[+-]?\d+$/.test(weight)) {
    const parsed = Number(weight);
    if (Number.isSafeInteger(parsed) && Math.abs(parsed) <= 2 ** 31) {
      return [false, parsed, isPlus];
    }
  }
  return [true, 0, isPlus];
}

function compareKeys(a: [boolean, number, boolean], b: [boolean, number, boolean]): number {
  if (a[0] !== b[0]) return a[0] ? 1 : -1;
  if (a[1] !== b[1]) return a[1] - b[1];
  if (a[2] !== b[2]) return a[2] ? 1 : -1;
  return 0;
}

/** Stable sort by weight class (`sort_by_class`). */
export function sortByWeightClass<T>(items: T[], weightClass: (item: T) => string): T[] {
  const keyed = items.map((item, index) => ({ item, index, key: weightClassKey(weightClass(item)) }));
  keyed.sort((a, b) => compareKeys(a.key, b.key) || a.index - b.index);
  return keyed.map(({ item }) => item);
}

/**
 * Text order of the Postgres database (`en_US.utf8`), for the responses the
 * Rust API sorts with SQL `ORDER BY` on text rather than in Rust.
 */
const collator = new Intl.Collator('en-US');

export function compareCollated(a: string, b: string): number {
  return collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}

/** Byte order, for the responses the Rust API sorts with `str::cmp`. */
export function compareBytes(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
