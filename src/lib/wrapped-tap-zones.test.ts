import { wrappedTapDirection } from '@/lib/wrapped-tap-zones';

const phone = { windowWidth: 400, insetLeft: 0, insetRight: 0 };

describe('wrappedTapDirection', () => {
  it('goes back on the left 30%, forward on the right 30%, nowhere in the middle', () => {
    expect(wrappedTapDirection({ ...phone, pageX: 10 })).toBe(-1);
    expect(wrappedTapDirection({ ...phone, pageX: 119 })).toBe(-1);
    expect(wrappedTapDirection({ ...phone, pageX: 120 })).toBe(0);
    expect(wrappedTapDirection({ ...phone, pageX: 200 })).toBe(0);
    expect(wrappedTapDirection({ ...phone, pageX: 280 })).toBe(0);
    expect(wrappedTapDirection({ ...phone, pageX: 281 })).toBe(1);
    expect(wrappedTapDirection({ ...phone, pageX: 390 })).toBe(1);
  });

  it('measures the zones on the usable width between the side insets', () => {
    // iPhone Duo: an 84pt band on the left. Usable width 316, starting at 84.
    const duo = { windowWidth: 400, insetLeft: 84, insetRight: 0 };
    // 84 + 0.3 * 316 = 178.8
    expect(wrappedTapDirection({ ...duo, pageX: 170 })).toBe(-1);
    expect(wrappedTapDirection({ ...duo, pageX: 180 })).toBe(0);
    // 84 + 0.7 * 316 = 305.2
    expect(wrappedTapDirection({ ...duo, pageX: 300 })).toBe(0);
    expect(wrappedTapDirection({ ...duo, pageX: 310 })).toBe(1);
  });

  it('does nothing with no usable width or no position', () => {
    expect(wrappedTapDirection({ windowWidth: 100, insetLeft: 60, insetRight: 40, pageX: 10 })).toBe(0);
    expect(wrappedTapDirection({ ...phone, pageX: Number.NaN })).toBe(0);
  });
});
