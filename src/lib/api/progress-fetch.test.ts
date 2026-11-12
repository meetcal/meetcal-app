import { createProgressFetch, parseResponseHeaders } from './progress-fetch';

type Listener = (() => void) | null;

class FakeRequest {
  readyState = 0;
  status = 0;
  statusText = '';
  response: unknown = null;
  responseText = '';
  responseType = '';
  withCredentials = true;
  upload: { onprogress: Listener } = { onprogress: null };
  onreadystatechange: Listener = null;
  onprogress: Listener = null;
  onload: Listener = null;
  onerror: Listener = null;
  ontimeout: Listener = null;
  onabort: Listener = null;
  opened: { method: string; url: string } | null = null;
  headers: [string, string][] = [];
  sentBody: unknown = undefined;
  aborted = false;
  rawHeaders = '';

  open(method: string, url: string) {
    this.opened = { method, url };
  }
  setRequestHeader(name: string, value: string) {
    this.headers.push([name, value]);
  }
  send(body: unknown) {
    this.sentBody = body;
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
  getAllResponseHeaders() {
    return this.rawHeaders;
  }
  advance(state: number) {
    this.readyState = state;
    this.onreadystatechange?.();
  }
  finish(status: number, body: string, rawHeaders = '') {
    this.status = status;
    this.response = body;
    this.rawHeaders = rawHeaders;
    this.advance(4);
    this.onload?.();
  }
}

function setUp() {
  const onProgress = jest.fn();
  const request = new FakeRequest();
  const progressFetch = createProgressFetch({
    onProgress,
    createRequest: () => request as unknown as XMLHttpRequest,
  });
  return { onProgress, request, progressFetch };
}

describe('createProgressFetch', () => {
  it('sends the method, url, headers and body, and answers with the status, headers and text', async () => {
    const { request, progressFetch } = setUp();
    const pending = progressFetch('https://example.convex.cloud/api/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Convex-Client': 'npm-1' },
      body: '{"path":"meets:list"}',
    });
    expect(request.opened).toEqual({ method: 'POST', url: 'https://example.convex.cloud/api/query' });
    expect(request.headers).toEqual([
      ['Content-Type', 'application/json'],
      ['Convex-Client', 'npm-1'],
    ]);
    expect(request.sentBody).toBe('{"path":"meets:list"}');
    expect(request.responseType).toBe('blob');
    request.finish(200, '{"status":"success"}', 'Date: Mon, 12 Oct 2026 11:12:00 GMT\r\nContent-Type: application/json');
    const response = await pending;
    expect(response.status).toBe(200);
    expect(response.headers.get('date')).toBe('Mon, 12 Oct 2026 11:12:00 GMT');
    expect(await response.json()).toEqual({ status: 'success' });
  });

  it('reports progress for the headers, every downloaded chunk and the upload', async () => {
    const { request, onProgress, progressFetch } = setUp();
    const pending = progressFetch('https://example.convex.cloud/api/query', { method: 'POST' });
    request.upload.onprogress?.();
    request.advance(2);
    request.advance(3);
    request.onprogress?.();
    request.onprogress?.();
    expect(onProgress).toHaveBeenCalledTimes(5);
    request.finish(200, '{}');
    await pending;
  });

  it('rejects with a network TypeError when the request fails', async () => {
    const { request, progressFetch } = setUp();
    const pending = progressFetch('https://example.convex.cloud/api/query');
    request.onerror?.();
    await expect(pending).rejects.toBeInstanceOf(TypeError);
  });

  it('aborts the request when its signal aborts, and refuses an already aborted signal', async () => {
    const { request, progressFetch } = setUp();
    const controller = new AbortController();
    const pending = progressFetch('https://example.convex.cloud/api/query', { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(request.aborted).toBe(true);

    const second = setUp();
    const already = new AbortController();
    already.abort();
    await expect(second.progressFetch('https://example.convex.cloud', { signal: already.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(second.request.opened).toBeNull();
  });

  it('honours the credentials mode', () => {
    const omitted = setUp();
    void omitted.progressFetch('https://example.convex.cloud', { credentials: 'omit' });
    expect(omitted.request.withCredentials).toBe(false);
    const included = setUp();
    included.request.withCredentials = false;
    void included.progressFetch('https://example.convex.cloud', { credentials: 'include' });
    expect(included.request.withCredentials).toBe(true);
  });
});

describe('parseResponseHeaders', () => {
  it('reads every header line, folding continuation lines and skipping malformed ones', () => {
    const headers = parseResponseHeaders('Date: Mon\r\nX-Long: one\r\n two\r\nbroken line\r\n: no name\r\nETag: "abc"');
    expect(headers.get('date')).toBe('Mon');
    expect(headers.get('x-long')).toBe('one two');
    expect(headers.get('etag')).toBe('"abc"');
    expect([...headers.keys()]).toHaveLength(3);
  });

  it('is empty for an empty header block', () => {
    expect([...parseResponseHeaders('').keys()]).toEqual([]);
  });
});
