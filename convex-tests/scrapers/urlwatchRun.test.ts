import { getFunctionName } from 'convex/server';
import { sendEmail } from '../../convex/lib/email';
import { fetchPageText } from '../../convex/scrapers/lib/incompleteChain';
import { run } from '../../convex/scrapers/urlwatch';
import { handlerOf } from '../fakeDb';

jest.mock('../../convex/scrapers/lib/incompleteChain', () => ({ fetchPageText: jest.fn() }));
jest.mock('../../convex/lib/email', () => ({ ...jest.requireActual('../../convex/lib/email'), sendEmail: jest.fn(async () => 'sent') }));
jest.mock('../../convex/scrapers/parse/watchedPages', () => ({
  ...jest.requireActual('../../convex/scrapers/parse/watchedPages'),
  WATCHED_PAGES: [{ name: 'Events', url: 'https://example.test/events', selector: '.content' }],
}));

type Snapshot = { text: string; error?: string } | null;
type Save = { url: string; text?: string; error?: string };

function deployment(stored: Snapshot) {
  const saves: Save[] = [];
  const ctx = {
    runQuery: async () => stored,
    runMutation: async (ref: unknown, args: Save) => {
      if (getFunctionName(ref as never) === 'scrapers/watchedPageState:save') saves.push(args);
    },
  };
  return { saves, runOnce: () => handlerOf<Record<string, never>, { status: string }[]>(run)(ctx, {}) };
}

const pageSaying = (text: string) => `<div class="content"><p>${text}</p></div>`;
const addresses = ['URLWATCH_EMAIL', 'ALERT_EMAIL'] as const;
let before: Record<string, string | undefined>;

beforeEach(() => {
  before = Object.fromEntries(addresses.map((name) => [name, process.env[name]]));
  for (const name of addresses) delete process.env[name];
  jest.mocked(sendEmail).mockClear();
  jest.mocked(fetchPageText).mockResolvedValue(pageSaying('Nationals, April 21'));
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  for (const name of addresses) {
    if (before[name] === undefined) delete process.env[name];
    else process.env[name] = before[name];
  }
  jest.restoreAllMocks();
});

describe('urlwatch run (#576)', () => {
  it('records a page first read after failed runs without reporting it, even where a report would fail', async () => {
    process.env.ALERT_EMAIL = 'alerts@example.test';
    const { saves, runOnce } = deployment({ text: '', error: 'GET failed with 503' });
    expect((await runOnce()).map((page) => page.status)).toEqual(['new']);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(saves).toEqual([{ url: 'https://example.test/events', text: 'Nationals, April 21' }]);
  });

  it('logs a change and saves it where no alert address is set', async () => {
    const { saves, runOnce } = deployment({ text: 'Nationals, April 20' });
    expect((await runOnce()).map((page) => page.status)).toEqual(['changed']);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(saves).toEqual([{ url: 'https://example.test/events', text: 'Nationals, April 21' }]);
  });

  it('emails a change to URLWATCH_EMAIL, then saves it', async () => {
    process.env.URLWATCH_EMAIL = 'watch@example.test';
    const { saves, runOnce } = deployment({ text: 'Nationals, April 20' });
    await runOnce();
    expect(jest.mocked(sendEmail).mock.calls.map(([to]) => to)).toEqual(['watch@example.test']);
    expect(saves).toHaveLength(1);
  });

  it('fails and saves nothing where alerts are set up but the urlwatch address is missing, so the change is reported once it is set', async () => {
    process.env.ALERT_EMAIL = 'alerts@example.test';
    const { saves, runOnce } = deployment({ text: 'Nationals, April 20' });
    await expect(runOnce()).rejects.toThrow('URLWATCH_EMAIL is not set');
    expect(sendEmail).not.toHaveBeenCalled();
    expect(saves).toEqual([]);
  });

  it('reports a page that starts failing once, keeping its last text', async () => {
    jest.mocked(fetchPageText).mockRejectedValue(new Error('GET failed with 503'));
    const first = deployment({ text: 'Nationals, April 20' });
    expect((await first.runOnce()).map((page) => page.status)).toEqual(['error']);
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(first.saves).toEqual([{ url: 'https://example.test/events', error: 'GET failed with 503' }]);
    const stillFailing = deployment({ text: 'Nationals, April 20', error: 'GET failed with 503' });
    await stillFailing.runOnce();
    expect(console.warn).toHaveBeenCalledTimes(1);
  });
});
