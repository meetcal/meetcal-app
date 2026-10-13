import { refreshServerEntitlement } from '@/lib/api/meetcal-api';
import { refreshServerEntitlementOnce, resetServerEntitlementRefreshForTests } from './server-entitlement';

jest.mock('@/lib/api/meetcal-api', () => ({ refreshServerEntitlement: jest.fn(async () => ({ active: true })) }));

beforeEach(() => {
  resetServerEntitlementRefreshForTests();
  jest.mocked(refreshServerEntitlement).mockClear();
});

describe('refreshServerEntitlementOnce', () => {
  it('asks the server once per user per launch, sharing a call in flight', async () => {
    const token = async () => 'token';
    await Promise.all([refreshServerEntitlementOnce('user_a', token), refreshServerEntitlementOnce('user_a', token)]);
    await refreshServerEntitlementOnce('user_a', token);
    expect(refreshServerEntitlement).toHaveBeenCalledTimes(1);
    expect(refreshServerEntitlement).toHaveBeenCalledWith('token');
    await refreshServerEntitlementOnce('user_b', token);
    expect(refreshServerEntitlement).toHaveBeenCalledTimes(2);
  });

  it('tries again later after no token or a failure', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    await refreshServerEntitlementOnce('user_a', async () => null);
    expect(refreshServerEntitlement).not.toHaveBeenCalled();
    jest.mocked(refreshServerEntitlement).mockRejectedValueOnce(new Error('offline'));
    await refreshServerEntitlementOnce('user_a', async () => 'token');
    await refreshServerEntitlementOnce('user_a', async () => 'token');
    expect(refreshServerEntitlement).toHaveBeenCalledTimes(2);
  });
});
