const { fastCheckParameters } = jest.requireActual('./fast-check-config.js') as {
  fastCheckParameters: (env: Record<string, string | undefined>) => Record<string, unknown>;
};

describe('fastCheckParameters', () => {
  it("leaves fast-check's defaults alone when nothing is set", () => {
    expect(fastCheckParameters({})).toEqual({});
  });

  it('reads the case count, seed and shrink path', () => {
    expect(fastCheckParameters({ FC_NUM_RUNS: '5000', FC_SEED: '-42', FC_PATH: '3:1:0' })).toEqual({
      numRuns: 5000,
      seed: -42,
      path: '3:1:0',
    });
  });

  it('rejects values that would silently run nothing', () => {
    expect(() => fastCheckParameters({ FC_NUM_RUNS: '0' })).toThrow(/FC_NUM_RUNS/);
    expect(() => fastCheckParameters({ FC_NUM_RUNS: 'lots' })).toThrow(/FC_NUM_RUNS/);
    expect(() => fastCheckParameters({ FC_SEED: '1.5' })).toThrow(/FC_SEED/);
    expect(() => fastCheckParameters({ FC_PATH: '0' })).toThrow(/FC_SEED/);
  });
});
