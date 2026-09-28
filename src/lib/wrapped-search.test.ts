import type { SupabaseLiftResult } from '@/data/types/athletes';
import {
  MAX_WRAPPED_NAME_CHOICES,
  MAX_WRAPPED_RESULTS,
  selectWrappedRows,
} from './wrapped-search';

let nextId = 1;
function row(name: string, date: string, total = 200): SupabaseLiftResult {
  return {
    id: nextId++,
    event_id: `e${nextId}`,
    meet: `Meet ${date}`,
    date,
    name,
    age: "Open Men's 89kg",
    body_weight: 88,
    snatch1: 90,
    snatch2: null,
    snatch3: null,
    snatch_best: 90,
    cj1: 110,
    cj2: null,
    cj3: null,
    cj_best: 110,
    total,
  };
}

describe('selectWrappedRows', () => {
  it('uses every row of an exact match, in date order', () => {
    const rows = [row('John Smith', '2025-06-01'), row('John Smith', '2025-02-01')];
    const selection = selectWrappedRows({ matchedName: 'john smith', results: rows });
    expect(selection).toEqual({
      kind: 'athlete',
      name: 'John Smith',
      rows: [rows[1], rows[0]],
    });
  });

  it('does not merge several athletes from the name-contains fallback', () => {
    const rows = [
      row('John Smith', '2025-03-01', 300),
      row('Jane Smith', '2025-01-01', 150),
      row('JOHN  SMITH', '2025-05-01', 310),
      row('Adam Smithers', '2025-04-01', 250),
    ];
    const selection = selectWrappedRows({ matchedName: null, results: rows });
    expect(selection).toEqual({
      kind: 'ambiguous',
      names: ['Adam Smithers', 'Jane Smith', 'John Smith'],
    });
  });

  it('accepts the fallback when its rows are one athlete (spelling variants included)', () => {
    const rows = [row('Jane Doe', '2025-05-01'), row('jane  doe ', '2025-01-01')];
    const selection = selectWrappedRows({ matchedName: null, results: rows });
    expect(selection).toEqual({ kind: 'athlete', name: 'Jane Doe', rows: [rows[1], rows[0]] });
  });

  it('drops blank-named rows rather than scoring them with the one athlete', () => {
    const rows = [row('Jane Doe', '2025-05-01'), row('', '2025-01-01')];
    const selection = selectWrappedRows({ matchedName: null, results: rows });
    expect(selection).toEqual({ kind: 'athlete', name: 'Jane Doe', rows: [rows[0]] });
  });

  it('answers none for no rows, or only blank names', () => {
    expect(selectWrappedRows({ matchedName: null, results: [] })).toEqual({ kind: 'none' });
    expect(selectWrappedRows({ matchedName: 'x', results: [] })).toEqual({ kind: 'none' });
    expect(selectWrappedRows({ matchedName: null, results: [row('  ', '2025-01-01')] })).toEqual({
      kind: 'none',
    });
  });

  it('caps the name choices and the scored rows', () => {
    const many = Array.from({ length: MAX_WRAPPED_NAME_CHOICES + 3 }, (_, i) =>
      row(`Athlete ${String(i).padStart(2, '0')} Smith`, '2025-01-01'),
    );
    const ambiguous = selectWrappedRows({ matchedName: null, results: many });
    expect(ambiguous.kind === 'ambiguous' && ambiguous.names).toHaveLength(MAX_WRAPPED_NAME_CHOICES);

    const year = Array.from({ length: MAX_WRAPPED_RESULTS + 1 }, (_, i) =>
      row('John Smith', `2025-01-${String((i % 28) + 1).padStart(2, '0')}`),
    );
    const one = selectWrappedRows({ matchedName: 'John Smith', results: year });
    expect(one.kind === 'athlete' && one.rows).toHaveLength(MAX_WRAPPED_RESULTS);
  });
});
