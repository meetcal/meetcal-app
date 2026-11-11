import { chunks, mapInBatches, mapLimited } from '../convex/lib/concurrency';
import { genderNamedByWords, genderOfWord, genderWords } from '../convex/lib/gender';
import { registrationGender } from '../convex/lib/elite';
import { parseDivision, plausible } from '../convex/lib/leaderboard';
import { normalizeGender } from '../convex/lib/normalize';
import { isPlausibleResult, LEADERBOARD_GUARD, RANKINGS_GUARD, resultProblems } from '../convex/lib/plausible';
import { bareWeightClass, classLimit, classNamedIn, weightClassKey } from '../convex/lib/weightClass';

describe('one home for each reader (#572)', () => {
  describe('work done a few at a time', () => {
    it('cuts a list into chunks of a size, the last one short, and refuses a size under 1', () => {
      expect(chunks([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
      expect(chunks([], 3)).toEqual([]);
      expect(() => chunks([1], 0)).toThrow('size must be at least 1');
    });

    it('runs one batch at a time, every item of a batch at once, answers in order', async () => {
      let running = 0;
      let most = 0;
      const answers = await mapInBatches([1, 2, 3, 4, 5], 2, async (n) => {
        running += 1;
        most = Math.max(most, running);
        await Promise.resolve();
        running -= 1;
        return n * 10;
      });
      expect(answers).toEqual([10, 20, 30, 40, 50]);
      expect(most).toBe(2);
    });

    it('runs at most the limit at once and starts nothing new after a failure', async () => {
      const started: number[] = [];
      const work = mapLimited([1, 2, 3, 4, 5, 6], 2, async (n) => {
        started.push(n);
        await Promise.resolve();
        if (n === 2) throw new Error('second failed');
        return n;
      });
      await expect(work).rejects.toThrow('second failed');
      expect(started.length).toBeLessThan(6);
    });
  });

  describe('gender words', () => {
    it('reads a stored value, a registration and a division from one table, each with its own words', () => {
      expect(['men', 'male', 'm', 'women', 'female', 'f'].map((word) => genderOfWord(word, 'stored'))).toEqual(['Men', 'Men', 'Men', 'Women', 'Women', 'Women']);
      expect(['w', 'woman', 'man'].map((word) => genderOfWord(word, 'stored'))).toEqual([null, null, null]);
      expect(['w', 'woman', 'man'].map((word) => genderOfWord(word, 'registration'))).toEqual(['Women', 'Women', 'Men']);
      expect(['m', 'f', 'w'].map((word) => genderOfWord(word, 'division'))).toEqual([null, null, null]);
      expect(['boys', 'girls', 'mens', 'womens'].map((word) => genderOfWord(word, 'division'))).toEqual(['Men', 'Women', 'Men', 'Women']);
      expect([genderWords('Men', 'label'), genderWords('Women', 'label')]).toEqual([['men'], ['women']]);
    });

    it('keeps what each reader answered', () => {
      expect(['Male', ' f ', 'Woman', 'Mixed team'].map(normalizeGender)).toEqual(['Men', 'Women', 'Woman', 'Mixed Team']);
      expect(['Woman', ' W ', 'man', 'boys'].map(registrationGender)).toEqual(['Women', 'Women', 'Men', null]);
      expect(["Open Men's 89kg", "Women's Masters (40-44) 69kg", 'Youth Girls 44kg', 'Mixed Men and Women', 'M 89kg'].map((division) => parseDivision(division).gender)).toEqual([
        'Men',
        'Women',
        'Women',
        null,
        null,
      ]);
      expect(genderNamedByWords('junior mens 89kg', 'label')).toBeNull();
    });
  });

  describe('weight classes', () => {
    it('reads the class a label names at its end, or the first one outside parentheses', () => {
      expect(classNamedIn("Open Men's 89 kg", 'atTheEnd')).toBe('89');
      expect(classNamedIn("Women's 86+kg", 'atTheEnd')).toBe('86+');
      expect(classNamedIn("Men's 89kg Adaptive", 'atTheEnd')).toBeNull();
      expect(classNamedIn("Men's 89kg Adaptive", 'firstOutsideParentheses')).toBe('89');
      expect(classNamedIn('Women (was 71kg) 69kg', 'firstOutsideParentheses')).toBe('69');
      expect(classNamedIn("Open Men's 89 kg", 'firstOutsideParentheses')).toBeNull();
    });

    it('reads a bare class, a limit and a sort key from the one module', () => {
      expect(['+109kg', '86 kg', '94+'].map(bareWeightClass)).toEqual(['109+', '86', '94+']);
      expect(classLimit('+86kg')).toEqual({ limit: 86, open: true });
      expect(weightClassKey('86+kg')).toEqual([false, 86, true]);
      expect(weightClassKey('abc')).toEqual([true, 0, false]);
    });
  });

  describe('source-error guards', () => {
    const row = (snatch: number[], cj: number[], total: number) => ({
      snatch1: snatch[0],
      snatch2: snatch[1],
      snatch3: snatch[2],
      snatchBest: Math.max(0, ...snatch),
      cj1: cj[0],
      cj2: cj[1],
      cj3: cj[2],
      cjBest: Math.max(0, ...cj),
      total,
    });

    it('judges one row by either guard, which differ only in their named limits', () => {
      const overTheLeaderboardCeiling = row([235, 0, 0], [270, 0, 0], 505);
      expect(isPlausibleResult(overTheLeaderboardCeiling, RANKINGS_GUARD)).toBe(true);
      expect(isPlausibleResult(overTheLeaderboardCeiling, LEADERBOARD_GUARD)).toBe(false);

      const smallJump = row([10, 16, 0], [20, 0, 0], 36);
      expect(isPlausibleResult(smallJump, RANKINGS_GUARD)).toBe(true);
      expect(isPlausibleResult(smallJump, LEADERBOARD_GUARD)).toBe(false);

      const oneLiftTotal = row([0, 0, 0], [90, 0, 0], 90);
      expect(isPlausibleResult(oneLiftTotal, RANKINGS_GUARD)).toBe(false);
      expect(isPlausibleResult(oneLiftTotal, LEADERBOARD_GUARD)).toBe(true);

      const missedAttemptOverTheCeiling = { ...row([100, 0, 0], [120, 0, 0], 220), snatch2: -300 };
      expect(isPlausibleResult(missedAttemptOverTheCeiling, RANKINGS_GUARD)).toBe(false);
      expect(isPlausibleResult(missedAttemptOverTheCeiling, LEADERBOARD_GUARD)).toBe(true);
    });

    it('uses the rankings guard unless told, and the leaderboard its own', () => {
      const oneLiftTotal = row([0, 0, 0], [90, 0, 0], 90);
      expect(resultProblems(oneLiftTotal)).toEqual(['total 90 is not snatch 0 + clean & jerk 90']);
      expect(
        plausible({ federation: 'USAW', meet: 'M', date: '2026-01-01', name: 'A', age: "Open Men's 89kg", body_weight: 88, adaptive: false, snatch1: 0, snatch2: 0, snatch3: 0, snatch_best: 0, cj1: 90, cj2: 0, cj3: 0, cj_best: 90, total: 90 }),
      ).toBe(true);
    });
  });
});
