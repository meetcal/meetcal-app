import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const WIRE_FIXTURE_DIR = join(__dirname, '..', 'fixtures', 'wire');

export type WireEncoding = 'value' | 'jsonText';

export type WireAnswer = { args: Record<string, unknown>; body: unknown };

export type WireFixture = { function: string; encoding: WireEncoding; answers: WireAnswer[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isWireAnswer(value: unknown): value is WireAnswer {
  return isRecord(value) && isRecord(value.args) && 'body' in value;
}

export function isWireFixture(value: unknown): value is WireFixture {
  return (
    isRecord(value) &&
    typeof value.function === 'string' &&
    (value.encoding === 'value' || value.encoding === 'jsonText') &&
    Array.isArray(value.answers) &&
    value.answers.length > 0 &&
    value.answers.every(isWireAnswer)
  );
}

export function wireFixtureFile(fn: string): string {
  return `${fn.replace(':', '.')}.json`;
}

export function readWireFixture(fn: string): WireFixture {
  const parsed: unknown = JSON.parse(readFileSync(join(WIRE_FIXTURE_DIR, wireFixtureFile(fn)), 'utf8'));
  if (!isWireFixture(parsed) || parsed.function !== fn) throw new Error(`${wireFixtureFile(fn)} is not the wire fixture of ${fn}`);
  return parsed;
}

export function wireAnswer(fixture: WireFixture, body: unknown): unknown {
  return fixture.encoding === 'jsonText' ? { etag: '"wire-fixture"', json: JSON.stringify(body) } : body;
}
