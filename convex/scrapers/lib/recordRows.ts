import type { UpsertOutcome } from '../../ingest';
import type { RecordHolder } from '../parse/holder';

type Lift = number | null | undefined;

export type ScrapedLifts = {
  snatchRecord?: Lift;
  cjRecord?: Lift;
  totalRecord?: Lift;
  snatchBy?: RecordHolder;
  cjBy?: RecordHolder;
  totalBy?: RecordHolder;
};

type StoredLifts = { snatchRecord?: number; cjRecord?: number; totalRecord?: number; snatchBy?: RecordHolder; cjBy?: RecordHolder; totalBy?: RecordHolder };

export function storedLifts(record: ScrapedLifts, { zeroMeansNoRecord = false } = {}): StoredLifts {
  const lift = (value: Lift) => (value === null || value === undefined || (zeroMeansNoRecord && value === 0) ? undefined : value);
  return {
    snatchRecord: lift(record.snatchRecord),
    cjRecord: lift(record.cjRecord),
    totalRecord: lift(record.totalRecord),
    snatchBy: record.snatchBy,
    cjBy: record.cjBy,
    totalBy: record.totalBy,
  };
}

export type RowOutcome = Pick<UpsertOutcome, 'wasInsert' | 'wasChanged'>;

export function tally(outcomes: readonly RowOutcome[]): { inserted: number; updated: number; unchanged: number } {
  const inserted = outcomes.filter((outcome) => outcome.wasInsert).length;
  const updated = outcomes.filter((outcome) => !outcome.wasInsert && outcome.wasChanged).length;
  return { inserted, updated, unchanged: outcomes.length - inserted - updated };
}
