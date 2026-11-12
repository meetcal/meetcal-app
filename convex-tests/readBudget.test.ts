import { DOCUMENTS_BEFORE_THE_OVERFLOW_PROBE, DOCUMENTS_ONE_QUERY_MAY_READ, takeWithinBudget } from '../convex/lib/readBudget';

describe('reading within a document budget', () => {
  const rows = (count: number) => Array.from({ length: count }, (_, i) => i);
  const reader = (available: number) => {
    const asked: number[] = [];
    const take = async (limit: number) => {
      asked.push(limit);
      return rows(Math.min(limit, available));
    };
    return { asked, take };
  };

  it('takes rows that fit and charges them to the budget', async () => {
    const budget = { left: 5 };
    expect(await takeWithinBudget(budget, reader(3).take)).toEqual([0, 1, 2]);
    expect(budget.left).toBe(2);
  });

  it('takes exactly what is left, and refuses one row more, reading at most one row past the budget', async () => {
    const exact = reader(4);
    expect(await takeWithinBudget({ left: 4 }, exact.take)).toHaveLength(4);
    const over = reader(100);
    const budget = { left: 4 };
    expect(await takeWithinBudget(budget, over.take)).toBeNull();
    expect(over.asked).toEqual([5]);
    expect(budget.left).toBe(4);
  });

  it('leaves the overflow probe room inside what one query may read', () => {
    expect(DOCUMENTS_BEFORE_THE_OVERFLOW_PROBE + 1).toBe(DOCUMENTS_ONE_QUERY_MAY_READ);
  });
});
