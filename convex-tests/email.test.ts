import { sendEmail } from '../convex/lib/email';

describe("OneSignal's answer to an email", () => {
  const originalFetch = global.fetch;
  const answer = (status: number, body: unknown) => {
    global.fetch = jest.fn(async () => ({ ok: status < 300, status, json: async () => body })) as never;
  };

  beforeEach(() => {
    process.env.ONESIGNAL_APP_ID = 'app';
    process.env.ONESIGNAL_REST_API_KEY = 'key';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.ONESIGNAL_APP_ID;
    delete process.env.ONESIGNAL_REST_API_KEY;
  });

  it("gives the notification's id", async () => {
    answer(200, { id: 'n_1' });
    await expect(sendEmail('a@example.com', 'Subject', '<p>Hi</p>')).resolves.toBe('n_1');
  });

  it('fails naming OneSignal for an answer with no text id, a null body, or a refusal', async () => {
    answer(200, null);
    await expect(sendEmail('a@example.com', 'Subject', '<p>Hi</p>')).rejects.toThrow('OneSignal email failed (200): null');
    answer(200, { id: 7 });
    await expect(sendEmail('a@example.com', 'Subject', '<p>Hi</p>')).rejects.toThrow('OneSignal email failed (200)');
    answer(400, { errors: ['bad address'] });
    await expect(sendEmail('a@example.com', 'Subject', '<p>Hi</p>')).rejects.toThrow('OneSignal email failed (400): ["bad address"]');
  });
});
