import { isRecord } from '@/lib/is-record';

export function toFiniteNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${label} expected an object response`);
  }
}

export function assertArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} expected an array response`);
  }
  return value;
}

export function assertStringArray(value: unknown, label: string): string[] {
  const rows = assertArray(value, label);
  if (!rows.every((row) => typeof row === 'string')) {
    throw new Error(`${label} expected a string array response`);
  }
  return rows;
}

export function assertHasFields(value: unknown, label: string, fields: string[]): Record<string, unknown> {
  assertObject(value, label);
  const missing = fields.filter((field) => !(field in value));
  if (missing.length > 0) {
    throw new Error(`${label} missing fields: ${missing.join(', ')}`);
  }
  return value;
}

export function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function validateRows<T extends object>(
  json: unknown,
  label: string,
  readRow: (row: Record<string, unknown>) => T,
): readonly Readonly<T>[] {
  const rows: Readonly<T>[] = [];
  for (const row of assertArray(json, label)) {
    if (!isRecord(row)) continue;
    rows.push(Object.freeze(readRow(row)));
  }
  return Object.freeze(rows);
}

export function validateStringList(json: unknown, label: string): readonly string[] {
  return Object.freeze([...assertStringArray(json, label)]);
}
