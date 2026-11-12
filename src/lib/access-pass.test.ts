import { fetchAccessPass, refreshServerEntitlement } from '@/lib/api/entitlement-api';
import { MeetCalApiError } from '@/lib/api/meetcal-api';
import * as SecureStore from 'expo-secure-store';

import { ACCESS_PASS_STORAGE_KEY, loadAccessPass, parseStoredAccessPass, storedAccessPassFor } from './access-pass';

jest.mock('@/lib/api/entitlement-api', () => ({
  fetchAccessPass: jest.fn(),
  refreshServerEntitlement: jest.fn(),
}));

const PASS = { pass: 'p1', rotatesAt: 1 };
const refused = () => new MeetCalApiError('access pass failed with 403', 403, '');

beforeEach(() => jest.clearAllMocks());

describe('loadAccessPass', () => {
  it('gets the pass with the Clerk token', async () => {
    jest.mocked(fetchAccessPass).mockResolvedValueOnce(PASS);
    await expect(loadAccessPass(async () => 'token')).resolves.toEqual(PASS);
    expect(fetchAccessPass).toHaveBeenCalledWith('token');
    expect(refreshServerEntitlement).not.toHaveBeenCalled();
  });

  it('has none without a token', async () => {
    await expect(loadAccessPass(async () => null)).resolves.toBeNull();
    expect(fetchAccessPass).not.toHaveBeenCalled();
  });

  it('asks the server to check RevenueCat when it knows of no subscription, then asks once more', async () => {
    jest.mocked(fetchAccessPass).mockRejectedValueOnce(refused()).mockResolvedValueOnce(PASS);
    jest.mocked(refreshServerEntitlement).mockResolvedValueOnce({ active: true });
    await expect(loadAccessPass(async () => 'token')).resolves.toEqual(PASS);
    expect(fetchAccessPass).toHaveBeenCalledTimes(2);
  });

  it('has none when RevenueCat finds no subscription either', async () => {
    jest.mocked(fetchAccessPass).mockRejectedValueOnce(refused());
    jest.mocked(refreshServerEntitlement).mockResolvedValueOnce({ active: false });
    await expect(loadAccessPass(async () => 'token')).resolves.toBeNull();
    expect(fetchAccessPass).toHaveBeenCalledTimes(1);
  });

  it('passes on any other failure', async () => {
    jest.mocked(fetchAccessPass).mockRejectedValueOnce(new Error('offline'));
    await expect(loadAccessPass(async () => 'token')).rejects.toThrow('offline');
    expect(refreshServerEntitlement).not.toHaveBeenCalled();
  });
});

describe('the stored pass', () => {
  const stored = (value: unknown) => JSON.stringify(value);

  it('reads a pass stored for the same user', () => {
    expect(parseStoredAccessPass(stored({ owner: 'user_a', pass: 'p', rotatesAt: 5 }), 'user_a')).toEqual({ pass: 'p', rotatesAt: 5 });
  });

  it.each([
    ['nothing stored', null],
    ['not JSON', '{'],
    ['an array', stored([])],
    ['another user', stored({ owner: 'user_b', pass: 'p', rotatesAt: 5 })],
    ['an empty pass', stored({ owner: 'user_a', pass: '', rotatesAt: 5 })],
    ['no rotation time', stored({ owner: 'user_a', pass: 'p' })],
    ['a rotation time that is not a number', stored({ owner: 'user_a', pass: 'p', rotatesAt: 'soon' })],
  ])('reads %s as no pass', (_label, raw) => {
    expect(parseStoredAccessPass(raw, 'user_a')).toBeNull();
  });

  it('writes, reads back and forgets the pass in SecureStore', async () => {
    const values = new Map<string, string>();
    jest.spyOn(SecureStore, 'setItemAsync').mockImplementation(async (key, value) => {
      values.set(key, value);
    });
    jest.spyOn(SecureStore, 'getItemAsync').mockImplementation(async (key) => values.get(key) ?? null);
    jest.spyOn(SecureStore, 'deleteItemAsync').mockImplementation(async (key) => {
      values.delete(key);
    });
    const store = storedAccessPassFor('user_a');
    await store.write({ pass: 'p', rotatesAt: 9 });
    expect(values.has(ACCESS_PASS_STORAGE_KEY)).toBe(true);
    await expect(store.read()).resolves.toEqual({ pass: 'p', rotatesAt: 9 });
    await expect(storedAccessPassFor('user_b').read()).resolves.toBeNull();
    await store.forget();
    await expect(store.read()).resolves.toBeNull();
  });
});
