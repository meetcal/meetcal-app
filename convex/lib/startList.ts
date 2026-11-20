export type LifterAtRow<Athlete, Row> = { athlete: Athlete; row: Row | undefined; j: number };

export function liftersAtRows<Athlete, Row>(athletes: readonly Athlete[], rowsOf: (athlete: Athlete) => readonly Row[]): LifterAtRow<Athlete, Row>[] {
  return athletes.flatMap((athlete) => {
    const rows = rowsOf(athlete);
    return (rows.length === 0 ? [undefined] : rows).map((row, j) => ({ athlete, row, j }));
  });
}
