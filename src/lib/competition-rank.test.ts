import { competitionRanks } from '@/lib/competition-rank';

describe('competitionRanks', () => {
  it('is empty for an empty list', () => {
    expect(competitionRanks([])).toEqual([]);
  });

  it('numbers distinct totals 1, 2, 3', () => {
    expect(competitionRanks([300, 280, 250])).toEqual([1, 2, 3]);
  });

  it('gives tied totals the same rank and skips the places they share', () => {
    // Two athletes on 250 kg used to be ranks 5 and 6, decided by name.
    expect(competitionRanks([300, 280, 280, 250])).toEqual([1, 2, 2, 4]);
    expect(competitionRanks([320, 300, 290, 270, 250, 250, 240])).toEqual([
      1, 2, 3, 4, 5, 5, 7,
    ]);
  });

  it('ties the leaders and a run of three', () => {
    expect(competitionRanks([300, 300, 280, 280, 280, 200])).toEqual([
      1, 1, 3, 3, 3, 6,
    ]);
  });

  it('ranks every row 1 when all totals are equal', () => {
    expect(competitionRanks([250, 250, 250])).toEqual([1, 1, 1]);
  });
});
