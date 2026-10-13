import { directoryText, foldForShards, nameMatcher, queryBigrams, searchDirectory, shardDirectory } from '../convex/lib/directory';

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

  it('fold runs of spaces and apostrophes, so a query typed either way reads a shard holding the name (#387, #348)', () => {
    expect(foldForShards("  Colin  O’Neal ")).toBe("colin o'neal");
    expect(queryBigrams("o’n")).toEqual(["o'", "'n"]);
    expect(queryBigrams('2026 IMWA')).toEqual(queryBigrams('2026 imwa'));
    const folded = ['Nick  Eudy', 'Colin O’Neal', "Brandyn O'Neal", '2026 IMWA Worlds', 'Ty’Sun Howard'];
    const shards = shardDirectory(folded);
    const full = directoryText(folded);
    for (const query of ['Nick Eudy', 'nick eud', "O'Neal", 'O’Neal', '2026 IMWA', "Ty'Sun"]) {
      const bigrams = queryBigrams(query)!;
      const rarest = bigrams.reduce((best, b) => ((shards.get(b)?.length ?? 0) < (shards.get(best)?.length ?? 0) ? b : best));
      const shard = shards.get(rarest) ?? [];
      expect(searchDirectory(full, query, 8).length).toBeGreaterThan(0);
      expect(searchDirectory(directoryText(shard), query, 8)).toEqual(searchDirectory(full, query, 8));
    }
  });
});

describe('search matching (#387, #348)', () => {
  const directory = directoryText([
    'Brandyn O\'Neal',
    'Colin O’Neal',
    'Georgia  Jenkinson',
    'Mikaela O’Barr',
    'Nick  Eudy',
    'Nick Eudy',
    'NICK EUDY',
    'Silas O’Neal',
    'Ty’Sun Howard',
  ]);

  it('matches a single space against a stored doubled one, and lists one spelling per athlete', () => {
    expect(searchDirectory(directory, 'Nick Eudy', 8)).toEqual(['Nick  Eudy']);
    expect(searchDirectory(directory, ' georgia   jenkinson ', 8)).toEqual(['Georgia  Jenkinson']);
    expect(searchDirectory(directory, 'Nick Eud', 8)).toEqual(['Nick  Eudy']);
    expect(nameMatcher('Nick Eud')('Nick  Eudy')).toBe(true);
  });

  it('matches every apostrophe against every other', () => {
    expect(searchDirectory(directory, "O'Neal", 8)).toEqual(["Brandyn O'Neal", 'Colin O’Neal', 'Silas O’Neal']);
    expect(searchDirectory(directory, 'O’Neal', 8)).toEqual(searchDirectory(directory, "O'Neal", 8));
    expect(searchDirectory(directory, "Mikaela O'Barr", 8)).toEqual(['Mikaela O’Barr']);
    expect(searchDirectory(directory, 'tyʼsun', 8)).toEqual(['Ty’Sun Howard']);
    expect(nameMatcher("o'barr")('Mikaela O’Barr')).toBe(true);
  });

  it('never matches across two names, and finds nothing for a blank query', () => {
    expect(searchDirectory(directory, 'Eudy Silas', 8)).toEqual([]);
    expect(searchDirectory(directory, 'Howard Brandyn', 8)).toEqual([]);
    expect(searchDirectory(directory, '   ', 8)).toEqual([]);
    expect(nameMatcher(' ')('Anyone')).toBe(false);
  });
});
