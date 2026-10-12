import AsyncStorage from '@react-native-async-storage/async-storage';
import * as fc from 'fast-check';

import { corruptedArb, hostileStringArb, hostileValueArb } from '@/test-support/arbitraries';
import { faultPlanArb, installStorageChaos, storageFaultArb } from '@/test-support/chaos';
import {
  defaultWidgetSettings,
  loadWidgetSettings,
  mergeWidgetSettings,
  WIDGET_SETTINGS_STORAGE_KEY,
  type WidgetSettings,
} from '@/utils/dataWidgets';

/**
 * Widget settings come back from AsyncStorage as whatever an older build, a
 * migration or a corrupt write left there. `mergeWidgetSettings` must turn any
 * value into settings the native widget can look up: every field present, every
 * enum one of its values, and every field that was already valid kept.
 */

const GENDERS = ['Men', 'Women'] as const;
const STANDARDS_GENDERS = ['men', 'women'] as const;
const RANKING_GENDERS = ['Men', 'Women', ''] as const;

const validSettingsArb: fc.Arbitrary<WidgetSettings> = fc.record({
  qualifyingTotals: fc.record({
    event: fc.string(),
    gender: fc.constantFrom(...GENDERS),
    ageGroup: fc.string(),
  }),
  standards: fc.record({ gender: fc.constantFrom(...STANDARDS_GENDERS), ageGroup: fc.string() }),
  intlRankings: fc.record({
    meet: fc.string(),
    ageCategory: fc.string(),
    gender: fc.constantFrom(...RANKING_GENDERS),
  }),
});

const storedValueArb: fc.Arbitrary<unknown> = fc.oneof(
  hostileValueArb,
  fc.anything(),
  validSettingsArb,
  validSettingsArb.chain((valid) => corruptedArb(valid)),
  corruptedArb(defaultWidgetSettings),
);

function field(value: unknown, section: string, key: string): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const inner = (value as Record<string, unknown>)[section];
  if (!inner || typeof inner !== 'object' || Array.isArray(inner)) return undefined;
  return (inner as Record<string, unknown>)[key];
}

function assertWellFormed(settings: WidgetSettings): void {
  expect(Object.keys(settings).sort()).toEqual(['intlRankings', 'qualifyingTotals', 'standards']);
  expect(typeof settings.qualifyingTotals.event).toBe('string');
  expect(GENDERS).toContain(settings.qualifyingTotals.gender);
  expect(typeof settings.qualifyingTotals.ageGroup).toBe('string');
  expect(STANDARDS_GENDERS).toContain(settings.standards.gender);
  expect(typeof settings.standards.ageGroup).toBe('string');
  expect(typeof settings.intlRankings.meet).toBe('string');
  expect(typeof settings.intlRankings.ageCategory).toBe('string');
  expect(RANKING_GENDERS).toContain(settings.intlRankings.gender);
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('mergeWidgetSettings', () => {
  it('turns any value into well-formed settings, keeping each field that was valid', () => {
    fc.assert(
      fc.property(storedValueArb, (value) => {
        const merged = mergeWidgetSettings(value);
        assertWellFormed(merged);

        const keep = (section: keyof WidgetSettings, key: string, valid: (v: unknown) => boolean) => {
          const input = field(value, section, key);
          const fallback = (defaultWidgetSettings[section] as Record<string, unknown>)[key];
          expect((merged[section] as Record<string, unknown>)[key]).toBe(valid(input) ? input : fallback);
        };
        const isString = (v: unknown) => typeof v === 'string';
        const oneOf = (values: readonly string[]) => (v: unknown) => values.includes(v as string);
        keep('qualifyingTotals', 'event', isString);
        keep('qualifyingTotals', 'gender', oneOf(GENDERS));
        keep('qualifyingTotals', 'ageGroup', isString);
        keep('standards', 'gender', oneOf(STANDARDS_GENDERS));
        keep('standards', 'ageGroup', isString);
        keep('intlRankings', 'meet', isString);
        keep('intlRankings', 'ageCategory', isString);
        keep('intlRankings', 'gender', oneOf(RANKING_GENDERS));
      }),
    );
  });

  it('is idempotent and leaves valid settings alone', () => {
    fc.assert(
      fc.property(storedValueArb, validSettingsArb, (value, valid) => {
        const once = mergeWidgetSettings(value);
        expect(mergeWidgetSettings(once)).toEqual(once);
        expect(mergeWidgetSettings(valid)).toEqual(valid);
        expect(mergeWidgetSettings(JSON.parse(JSON.stringify(valid)))).toEqual(valid);
      }),
    );
  });

  it('never shares a section object with its input', () => {
    fc.assert(
      fc.property(validSettingsArb, (valid) => {
        const merged = mergeWidgetSettings(valid);
        expect(merged.qualifyingTotals).not.toBe(valid.qualifyingTotals);
        expect(merged.standards).not.toBe(valid.standards);
        expect(merged.intlRankings).not.toBe(valid.intlRankings);
      }),
    );
  });
});

describe('loadWidgetSettings', () => {
  beforeEach(() => AsyncStorage.clear());

  it('reads any stored bytes as well-formed settings; only a storage rejection reaches the caller', async () => {
    const storedBytesArb = fc.oneof(
      hostileStringArb,
      storedValueArb.map((value) => JSON.stringify(value) ?? ''),
    );
    await fc.assert(
      fc.asyncProperty(storedBytesArb, faultPlanArb(storageFaultArb, 1), async (bytes, plan) => {
        await AsyncStorage.clear();
        await AsyncStorage.setItem(WIDGET_SETTINGS_STORAGE_KEY, bytes);
        const chaos = installStorageChaos(plan);
        let settings: WidgetSettings | 'rejected';
        try {
          // The settings screen catches a rejection and shows the defaults.
          settings = await loadWidgetSettings().catch(() => 'rejected' as const);
        } finally {
          chaos.restore();
        }
        if (settings === 'rejected') {
          expect(['reject', 'quota']).toContain(plan[0]?.kind);
          return;
        }
        assertWellFormed(settings);
      }),
    );
  });
});
