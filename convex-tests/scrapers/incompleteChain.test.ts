import { X509Certificate } from 'node:crypto';
import { rootCertificates } from 'node:tls';
import { fetchPageText, missingIntermediate } from '../../convex/scrapers/lib/incompleteChain';

describe('sites with an incomplete certificate chain', () => {
  it("supplies usamasters.net's missing intermediate, a CA a trusted root issued", () => {
    const pem = missingIntermediate('https://usamasters.net/events');
    expect(missingIntermediate('https://www.usamasters.net/events')).toBe(pem);
    const intermediate = new X509Certificate(pem!);
    expect(intermediate.ca).toBe(true);
    expect(intermediate.subject).toContain('CN=RapidSSL TLS RSA CA G1');
    const issuers = rootCertificates.map((root) => new X509Certificate(root)).filter((root) => intermediate.checkIssued(root));
    expect(issuers.some((root) => intermediate.verify(root.publicKey))).toBe(true);
  });

  it('fetches other sites with the default fetch', async () => {
    const realFetch = global.fetch;
    const fetchMock = jest.fn(async () => new Response('page', { status: 200 }));
    global.fetch = fetchMock as typeof fetch;
    try {
      expect(missingIntermediate('https://storage.googleapis.com/a.pdf')).toBeUndefined();
      expect(await fetchPageText('https://example.test/a', 1_000)).toBe('page');
      expect(fetchMock).toHaveBeenCalledWith('https://example.test/a', expect.anything());
    } finally {
      global.fetch = realFetch;
    }
  });
});
