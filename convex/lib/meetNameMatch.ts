import { normalizeName } from './names';

export const MAX_MATCHING_WORDS = 20;
export const MAX_MATCHED_MEETS_ANSWERED = 200;

const NOT_LETTER_OR_DIGIT = /[^\p{Alphabetic}\p{N}]+/gu;
const FOUR_DIGIT_YEAR = /^[0-9]{4}$/;

export function parseMeetNames(text: string): string[] {
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed) || !parsed.every((name) => typeof name === 'string')) throw new Error('malformed meet name index');
  return parsed;
}

export function foldedWords(value: string): string {
  return normalizeName(value).replace(NOT_LETTER_OR_DIGIT, ' ').split(' ').filter(Boolean).join(' ');
}

export function meetNameWords(meet: string): string {
  return foldedWords(meet)
    .split(' ')
    .filter((word) => word !== '' && word !== 'the' && !FOUR_DIGIT_YEAR.test(word))
    .join(' ');
}

export function meetNameMatches(meet: string, words: readonly string[], exclude: readonly string[]): boolean {
  const name = meetNameWords(meet);
  const included = words.every((word) => {
    const wanted = meetNameWords(word);
    return wanted === '' || name.includes(wanted);
  });
  return (
    included &&
    !exclude.some((text) => {
      const unwanted = meetNameWords(text);
      return unwanted !== '' && name.includes(unwanted);
    })
  );
}

export function matchingMeetNames(names: readonly string[], words: readonly string[], exclude: readonly string[]): { meets: string[]; count: number } {
  const matched = names.filter((meet) => meetNameMatches(meet, words, exclude));
  return { meets: matched.slice(0, MAX_MATCHED_MEETS_ANSWERED), count: matched.length };
}
