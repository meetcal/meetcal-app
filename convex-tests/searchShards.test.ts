import { directoryText, foldForShards, queryBigrams, searchDirectory, shardDirectory } from '../convex/lib/directory';

describe('search directory shards', () => {
  const names = ['Ann Lee', 'Anna Smith', 'Bob Jones', 'JOHN SMITH', 'JoKe Kay', 'Roſa Chen', 'Zoë Adams'];

  it('fold ASCII case and the two non-ASCII letters that fold to ASCII', () => {
    expect(foldForShards('JOKE ſam Zoë')).toBe('joke sam zoë');
  });

  it('serve only ASCII queries of two or more characters', () => {
    expect(queryBigrams('smi')).toEqual(['sm', 'mi']);
    expect(queryBigrams('a')).toBeNull();
    expect(queryBigrams('zoë')).toBeNull();
  });

  it('answer every query exactly as the whole directory does', () => {
    const shards = shardDirectory(names);
    const full = directoryText(names);
    for (const query of ['smi', 'SMITH', 'ann', 'n s', 'joke', 'rosa', 'jo', 'zz', 'es']) {
      const bigrams = queryBigrams(query)!;
      const rarest = bigrams.reduce((best, b) => ((shards.get(b)?.length ?? 0) < (shards.get(best)?.length ?? 0) ? b : best));
      const shard = shards.get(rarest) ?? [];
      expect(searchDirectory(directoryText(shard), query, 8)).toEqual(searchDirectory(full, query, 8));
    }
  });
});
