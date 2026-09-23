import { clearMeetConfigCache, getMeetConfig } from '@/data/meets/config';
import { fetchMeetByName } from '@/lib/database/meet-manager';

jest.mock('@/lib/database/meet-manager', () => ({
  fetchMeetByName: jest.fn(),
}));

const mockFetchMeetByName = fetchMeetByName as jest.MockedFunction<
  typeof fetchMeetByName
>;

function meet(timeZoneIdentifier: string) {
  return {
    id: 'm1',
    name: 'Test Open',
    venue: {
      name: 'Hall',
      address: { street: '1 St', city: 'C', state: 'ST', zip: '00000' },
    },
    venueMapPdfUrl: null,
    venueMapAppleUrl: null,
    time: {
      timeZone: timeZoneIdentifier,
      timeZoneIdentifier,
      abbreviation: 'MST',
      utcOffset: 7,
    },
    dates: { start: '2026-06-20', end: '2026-06-22' },
    status: 'upcoming',
  } as unknown as Awaited<ReturnType<typeof fetchMeetByName>>;
}

describe('getMeetConfig', () => {
  beforeEach(() => {
    clearMeetConfigCache();
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('reuses a config within the TTL', async () => {
    mockFetchMeetByName.mockResolvedValue(meet('America/Denver'));

    await getMeetConfig('Test Open');
    await getMeetConfig('Test Open');

    expect(mockFetchMeetByName).toHaveBeenCalledTimes(1);
  });

  it('picks up a server-side timezone correction after the TTL', async () => {
    // Regression: the cache was process-lifetime with no invalidation, so a
    // corrected timezone reached the schedule (which re-reads meets every five
    // minutes) but never reached calendar exports or notification instants.
    const start = Date.UTC(2026, 5, 1, 12);
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(start);

    mockFetchMeetByName.mockResolvedValue(meet('America/Denver'));
    const first = await getMeetConfig('Test Open');
    expect(first.time.timeZoneIdentifier).toBe('America/Denver');

    mockFetchMeetByName.mockResolvedValue(meet('America/Phoenix'));
    nowSpy.mockReturnValue(start + 6 * 60 * 1000);

    const second = await getMeetConfig('Test Open');
    expect(second.time.timeZoneIdentifier).toBe('America/Phoenix');
  });

  it('falls back to the stale config when the meet cannot be re-read', async () => {
    // Offline after the TTL lapses: auto-unsave and the calendar export still
    // need a timezone, and the last known one beats throwing.
    const start = Date.UTC(2026, 5, 1, 12);
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(start);

    mockFetchMeetByName.mockResolvedValue(meet('America/Denver'));
    await getMeetConfig('Test Open');

    mockFetchMeetByName.mockResolvedValue(null);
    nowSpy.mockReturnValue(start + 6 * 60 * 1000);

    await expect(getMeetConfig('Test Open')).resolves.toMatchObject({
      time: { timeZoneIdentifier: 'America/Denver' },
    });
  });

  it('throws when there is no meet and nothing cached', async () => {
    mockFetchMeetByName.mockResolvedValue(null);
    await expect(getMeetConfig('Unknown')).rejects.toThrow(
      'Meet not found: Unknown',
    );
  });
});
