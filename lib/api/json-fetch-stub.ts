/**
 * Test-only transport stub for `lib/api/meetcal-api.ts`.
 *
 * Fetcher tests that stub this instead of mocking the API module keep the real
 * boundary validators in the path, so a malformed row in a test payload is
 * handled exactly as it would be in the app. Replies are `200` with no `ETag`,
 * so nothing is remembered between calls.
 */
export type JsonResponder = (
  path: string,
  query: Record<string, string>,
) => unknown | Promise<unknown>;

export function jsonFetchStub(respond: JsonResponder) {
  return async (input: string) => {
    const url = new URL(input);
    const body = await respond(url.pathname, Object.fromEntries(url.searchParams));
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify(body),
    };
  };
}
