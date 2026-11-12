import { genderOr, isGender } from './gender';

describe('gender', () => {
  it('accepts the two genders the data uses and nothing else', () => {
    expect(isGender('Men')).toBe(true);
    expect(isGender('Women')).toBe(true);
    expect(isGender('men')).toBe(false);
    expect(isGender('')).toBe(false);
    expect(isGender(undefined)).toBe(false);
  });

  it('falls back for a value that is not a gender', () => {
    expect(genderOr('Women', 'Men')).toBe('Women');
    expect(genderOr('', 'Men')).toBe('Men');
    expect(genderOr('female', 'Women')).toBe('Women');
  });
});
