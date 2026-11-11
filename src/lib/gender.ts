import type { Gender } from '@/types/records';

export function isGender(value: unknown): value is Gender {
  return value === 'Men' || value === 'Women';
}

export function genderOr(value: unknown, fallback: Gender): Gender {
  return isGender(value) ? value : fallback;
}
