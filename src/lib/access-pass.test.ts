import { fetchAccessPass, MeetCalApiError, refreshServerEntitlement } from '@/lib/api/meetcal-api';
import { loadAccessPass } from './access-pass';

jest.mock('@/lib/api/meetcal-api', () => ({
  ...jest.requireActual('@/lib/api/meetcal-api'),
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
