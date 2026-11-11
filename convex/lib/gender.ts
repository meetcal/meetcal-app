export type Gender = 'Men' | 'Women';

export type GenderWords = 'stored' | 'registration' | 'division' | 'label';

const WORDS: readonly (readonly [string, Gender, readonly GenderWords[]])[] = [
  ['men', 'Men', ['stored', 'registration', 'division', 'label']],
  ['women', 'Women', ['stored', 'registration', 'division', 'label']],
  ['male', 'Men', ['stored', 'registration', 'division']],
  ['female', 'Women', ['stored', 'registration', 'division']],
  ['m', 'Men', ['stored', 'registration']],
  ['f', 'Women', ['stored', 'registration']],
  ['man', 'Men', ['registration', 'division']],
  ['woman', 'Women', ['registration', 'division']],
  ['w', 'Women', ['registration']],
  ['mens', 'Men', ['division']],
  ['womens', 'Women', ['division']],
  ['males', 'Men', ['division']],
  ['females', 'Women', ['division']],
  ['boy', 'Men', ['division']],
  ['boys', 'Men', ['division']],
  ['girl', 'Women', ['division']],
  ['girls', 'Women', ['division']],
];

export function genderOfWord(lowercased: string, words: GenderWords): Gender | null {
  const found = WORDS.find(([word, , accepted]) => word === lowercased && accepted.includes(words));
  return found ? found[1] : null;
}

export const genderWords = (gender: Gender, words: GenderWords): string[] =>
  WORDS.filter(([, of, accepted]) => of === gender && accepted.includes(words)).map(([word]) => word);

export function genderNamedByWords(lowercased: string, words: GenderWords): Gender | null {
  const named = new Set(
    lowercased
      .split(/[^A-Za-z]+/)
      .map((word) => genderOfWord(word, words))
      .filter((gender) => gender !== null),
  );
  if (named.size !== 1) return null;
  return named.has('Men') ? 'Men' : 'Women';
}
