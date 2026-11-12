export function bareWeightClass(text: string): string {
  const bare = text.replace(/kg/gi, '').replace(/\s+/g, '');
  return bare.startsWith('+') ? `${bare.slice(1)}+` : bare;
}

export function classLimit(weightClass: string): { limit: number; open: boolean } | null {
  const match = /^\s*(\+)?\s*(\d+(?:\.\d+)?)\s*(\+)?\s*(?:kg)?\s*$/i.exec(weightClass);
  if (!match) return null;
  return { limit: Number(match[2]), open: match[1] !== undefined || match[3] !== undefined };
}

export type WeightClassSortKey = [unsortable: boolean, kilos: number, plus: boolean];

export function weightClassKey(weightClass: string): WeightClassSortKey {
  let weight = weightClass;
  while (weight.endsWith('kg')) weight = weight.slice(0, -2);
  const isPlus = weight.endsWith('+');
  while (weight.endsWith('+')) weight = weight.slice(0, -1);
  if (/^[+-]?\d+$/.test(weight)) {
    const parsed = Number(weight);
    if (Number.isSafeInteger(parsed) && parsed >= -(2 ** 31) && parsed < 2 ** 31) {
      return [false, parsed, isPlus];
    }
  }
  return [true, 0, isPlus];
}

export type ClassPlace = 'atTheEnd' | 'firstOutsideParentheses';

const isInsideParentheses = (text: string, index: number): boolean => {
  const before = text.slice(0, index);
  const open = before.lastIndexOf('(');
  return open !== -1 && !before.slice(open).includes(')');
};

export function classNamedIn(label: string, place: ClassPlace): string | null {
  if (place === 'atTheEnd') return /(\d+\+?)\s*kg\s*$/i.exec(label)?.[1] ?? null;
  for (const match of label.matchAll(/\b(\d+\+?)kg/gi)) {
    if (!isInsideParentheses(label, match.index)) return match[1] ?? null;
  }
  return null;
}
