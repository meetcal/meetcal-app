export type ProgressFetchOptions = {
  onProgress: () => void;
  createRequest?: () => XMLHttpRequest;
};

const HEADERS_RECEIVED = 2;
const LOADING = 3;
const DONE = 4;

function abortError(): Error {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
}

export function parseResponseHeaders(raw: string): Headers {
  const headers = new Headers();
  for (const line of raw.replace(/\r?\n[\t ]+/g, ' ').split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    const name = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (name.length > 0) headers.append(name, value);
  }
  return headers;
}

function requestHeaders(init: RequestInit | undefined): [string, string][] {
  const source = init?.headers;
  if (!source) return [];
  if (source instanceof Headers) {
    const pairs: [string, string][] = [];
    source.forEach((value, name) => pairs.push([name, value]));
    return pairs;
  }
  if (Array.isArray(source)) return source.map(([name, value]) => [String(name), String(value)]);
  return Object.entries(source).map(([name, value]) => [name, String(value)]);
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function requestBody(init: RequestInit | undefined): XMLHttpRequestBodyInit | null {
  const body = init?.body;
  if (body === undefined || body === null) return null;
  return body as XMLHttpRequestBodyInit;
}

export function createProgressFetch({ onProgress, createRequest }: ProgressFetchOptions): typeof fetch {
  return (input, init) =>
    new Promise<Response>((resolve, reject) => {
      const signal = init?.signal ?? null;
      if (signal?.aborted) {
        reject(abortError());
        return;
      }
      const xhr = createRequest ? createRequest() : new XMLHttpRequest();
      const abort = () => xhr.abort();
      const detach = () => signal?.removeEventListener('abort', abort);

      xhr.onreadystatechange = () => {
        if (xhr.readyState === HEADERS_RECEIVED || xhr.readyState === LOADING) onProgress();
        if (xhr.readyState === DONE) detach();
      };
      xhr.onprogress = () => onProgress();
      if (xhr.upload) xhr.upload.onprogress = () => onProgress();
      xhr.onload = () => {
        detach();
        const body = (xhr.response ?? xhr.responseText) as BodyInit | null;
        resolve(
          new Response(body, {
            status: xhr.status,
            statusText: xhr.statusText,
            headers: parseResponseHeaders(xhr.getAllResponseHeaders() || ''),
          }),
        );
      };
      xhr.onerror = () => {
        detach();
        reject(new TypeError('Network request failed'));
      };
      xhr.ontimeout = () => {
        detach();
        reject(new TypeError('Network request timed out'));
      };
      xhr.onabort = () => {
        detach();
        reject(abortError());
      };

      xhr.open(init?.method ?? 'GET', requestUrl(input), true);
      if (init?.credentials === 'include') xhr.withCredentials = true;
      else if (init?.credentials === 'omit') xhr.withCredentials = false;
      if ('responseType' in xhr) xhr.responseType = 'blob';
      for (const [name, value] of requestHeaders(init)) xhr.setRequestHeader(name, value);
      signal?.addEventListener('abort', abort);
      xhr.send(requestBody(init));
    });
}
