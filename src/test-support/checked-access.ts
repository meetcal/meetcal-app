export function itemAt<T>(items: readonly T[], index: number): T {
  const item = items.at(index);
  if (item === undefined) {
    throw new Error(`Expected an item at index ${index}, but the list has ${items.length}`);
  }
  return item;
}

export function valueAt<T>(record: Readonly<Partial<Record<string, T>>>, key: string): T {
  const value = record[key];
  if (value === undefined) {
    throw new Error(`Expected a value for ${JSON.stringify(key)}, but it is missing`);
  }
  return value;
}

export function defined<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new Error(`Expected ${what} to be defined`);
  }
  return value;
}
