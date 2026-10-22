'use node';

import { request } from 'node:https';
import { rootCertificates } from 'node:tls';
import { fetchText, HttpStatusError, USER_AGENT } from './http';

/**
 * Pages on sites that send an incomplete certificate chain. A browser
 * downloads the missing intermediate itself (from the certificate's AIA
 * URL), so the site looks fine there, but Node's fetch fails with "fetch
 * failed" (UNABLE_TO_VERIFY_LEAF_SIGNATURE). These requests add the
 * intermediate the site leaves out to Node's roots: the chain must still end
 * at a root Node trusts, so nothing new is trusted. Node-only (`node:https`),
 * so it is kept out of `http.ts`, which the default runtime bundles too.
 */
const MISSING_INTERMEDIATES: Record<string, string> = {
  // RapidSSL TLS RSA CA G1, issued by DigiCert Global Root G2, valid until
  // 2027-11-02 (http://cacerts.rapidssl.com/RapidSSLTLSRSACAG1.crt). Since
  // its October 2026 renewal usamasters.net sends its RapidSSL certificate
  // with its old Network Solutions chain instead.
  'usamasters.net': `-----BEGIN CERTIFICATE-----
MIIEszCCA5ugAwIBAgIQCyWUIs7ZgSoVoE6ZUooO+jANBgkqhkiG9w0BAQsFADBh
MQswCQYDVQQGEwJVUzEVMBMGA1UEChMMRGlnaUNlcnQgSW5jMRkwFwYDVQQLExB3
d3cuZGlnaWNlcnQuY29tMSAwHgYDVQQDExdEaWdpQ2VydCBHbG9iYWwgUm9vdCBH
MjAeFw0xNzExMDIxMjI0MzNaFw0yNzExMDIxMjI0MzNaMGAxCzAJBgNVBAYTAlVT
MRUwEwYDVQQKEwxEaWdpQ2VydCBJbmMxGTAXBgNVBAsTEHd3dy5kaWdpY2VydC5j
b20xHzAdBgNVBAMTFlJhcGlkU1NMIFRMUyBSU0EgQ0EgRzEwggEiMA0GCSqGSIb3
DQEBAQUAA4IBDwAwggEKAoIBAQC/uVklRBI1FuJdUEkFCuDL/I3aJQiaZ6aibRHj
ap/ap9zy1aYNrphe7YcaNwMoPsZvXDR+hNJOo9gbgOYVTPq8gXc84I75YKOHiVA4
NrJJQZ6p2sJQyqx60HkEIjzIN+1LQLfXTlpuznToOa1hyTD0yyitFyOYwURM+/CI
8FNFMpBhw22hpeAQkOOLmsqT5QZJYeik7qlvn8gfD+XdDnk3kkuuu0eG+vuyrSGr
5uX5LRhFWlv1zFQDch/EKmd163m6z/ycx/qLa9zyvILc7cQpb+k7TLra9WE17YPS
n9ANjG+ECo9PDW3N9lwhKQCNvw1gGoguyCQu7HE7BnW8eSSFAgMBAAGjggFmMIIB
YjAdBgNVHQ4EFgQUDNtsgkkPSmcKuBTuesRIUojrVjgwHwYDVR0jBBgwFoAUTiJU
IBiV5uNu5g/6+rkS7QYXjzkwDgYDVR0PAQH/BAQDAgGGMB0GA1UdJQQWMBQGCCsG
AQUFBwMBBggrBgEFBQcDAjASBgNVHRMBAf8ECDAGAQH/AgEAMDQGCCsGAQUFBwEB
BCgwJjAkBggrBgEFBQcwAYYYaHR0cDovL29jc3AuZGlnaWNlcnQuY29tMEIGA1Ud
HwQ7MDkwN6A1oDOGMWh0dHA6Ly9jcmwzLmRpZ2ljZXJ0LmNvbS9EaWdpQ2VydEds
b2JhbFJvb3RHMi5jcmwwYwYDVR0gBFwwWjA3BglghkgBhv1sAQEwKjAoBggrBgEF
BQcCARYcaHR0cHM6Ly93d3cuZGlnaWNlcnQuY29tL0NQUzALBglghkgBhv1sAQIw
CAYGZ4EMAQIBMAgGBmeBDAECAjANBgkqhkiG9w0BAQsFAAOCAQEAGUSlOb4K3Wtm
SlbmE50UYBHXM0SKXPqHMzk6XQUpCheF/4qU8aOhajsyRQFDV1ih/uPIg7YHRtFi
CTq4G+zb43X1T77nJgSOI9pq/TqCwtukZ7u9VLL3JAq3Wdy2moKLvvC8tVmRzkAe
0xQCkRKIjbBG80MSyDX/R4uYgj6ZiNT/Zg6GI6RofgqgpDdssLc0XIRQEotxIZcK
zP3pGJ9FCbMHmMLLyuBd+uCWvVcF2ogYAawufChS/PT61D9rqzPRS5I2uqa3tmIT
44JhJgWhBnFMb7AGQkvNq9KNS9dd3GWc17H/dXa1enoxzWjE0hBdFjxPhUb0W3wi
8o34/m8Fxw==
-----END CERTIFICATE-----
`,
};

/** The intermediate `url`'s site leaves out of its chain, if it is listed. */
export function missingIntermediate(url: string): string | undefined {
  return MISSING_INTERMEDIATES[new URL(url).hostname.replace(/^www\./, '')];
}

/**
 * `fetchText`, but for a listed site with the intermediate it leaves out.
 * A listed site's redirects are not followed: a 3xx fails like any other
 * status that is not 2xx.
 */
export async function fetchPageText(url: string, timeoutMs: number): Promise<string> {
  const intermediate = missingIntermediate(url);
  if (!intermediate) return await fetchText(url, timeoutMs);
  return await new Promise<string>((resolve, reject) => {
    const req = request(url, { headers: { 'User-Agent': USER_AGENT }, ca: [...rootCertificates, intermediate], signal: AbortSignal.timeout(timeoutMs) }, (response) => {
      const status = response.statusCode ?? 0;
      if (status < 200 || status > 299) {
        response.resume();
        reject(new HttpStatusError(url, status));
        return;
      }
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      response.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}
