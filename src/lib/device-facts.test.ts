import { networkTypeOf } from '@/lib/device-facts';

describe('networkTypeOf', () => {
  it.each([
    [{ type: 'wifi', isConnected: true, details: {} }, 'wifi'],
    [{ type: 'cellular', isConnected: true, details: { cellularGeneration: '3g' } }, 'cellular-3g'],
    [{ type: 'cellular', isConnected: true, details: { cellularGeneration: null } }, 'cellular'],
    [{ type: 'cellular', isConnected: true, details: null }, 'cellular'],
    [{ type: 'wifi', isConnected: false, details: null }, 'none'],
    [{ type: 'unknown', isConnected: null, details: null }, 'unknown'],
  ])('%j is %s', (state, expected) => {
    expect(networkTypeOf(state as never)).toBe(expected);
  });
});
