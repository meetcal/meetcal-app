# Testing

MeetCal Web uses complementary Rust and browser test layers. Run every command
below from `web/`. CI (`.github/workflows/web.yml` at the repository root) runs
all of them on every change to `web/` or `convex/`.

## Rust checks

```bash
cargo fmt --all -- --check
cargo clippy --all-targets --locked -- -D warnings
cargo test --locked
```

The Rust suite covers competition-data filtering helpers, query arguments (the
camelCase JSON each Convex query takes), nullable values, and answer-shape
contracts. Put unit tests in a `#[cfg(test)] mod tests` at the bottom of the
module they cover. A new answer type gets a test that parses a real answer's
shape, including fields that may be absent or `null`.

`src/utils/api.rs` tests the transport without a network: request bodies, both
answer forms (`Body::Value` and `Body::JsonText`), function errors, retry
timing, whole-number floats becoming integers, which queries (and which
searches) carry the access pass, reading `accessPass:pass`'s answer, how long a
pass is held, and which function errors renew it, and reading the `deviceLogin`
answers (a pending login or `null`; `{ ok: true }` or a 404) and
`apiTokens:revokeAllCli`'s `{ ended }`. `src/pages/link.rs`
tests the code's formatting, the caret while it formats, and the page's states.
`api.rs` also tests the meet-submission calls: their camelCase arguments (absent
fields as `null`), reading `{ uploadUrl }`, `{ storageId }` and
`{ submitted: true }`, and the sentence each error status shows.
`src/pages/submit_meet.rs` tests the form's checks (name, dates, file count,
type, size and name, against the server's extension list), the Content-Type
of a file the browser gives none, the progress text and file sizes.
`src/pages/comp_data/wrapped.rs` tests reading every `results:wrapped` answer
kind through `read_body` (so its whole-number floats, such as `totalMeets: 3.0`,
are covered), the arguments it sends, and the messages for answers with no
Wrapped. `src/pages/comp_data/catalog.rs` checks each data page's route, shell
and sitemap entry against its `Access`.

`tests/e2e/wrapped.spec.ts` covers `/wrapped` against a mocked
`results:wrapped`: a report, a pick from several athletes (the second request
carries `picked: true`), a cut list, the `narrow`, `tooManyResults` and `none`
messages, and a signed-out visitor building a Wrapped without the gate or a
pass.

`tests/e2e/link.spec.ts` covers `/link` against mocked `deviceLogin` calls:
sign-in returning to the code, approve, deny, a deny the server turns down
(404, including after another tab approved and the CLI took its token), an
expired or unknown code, a code typed by hand, failures with Try again, signing
out all CLI logins (confirm, success, failure), a small phone, and
accessibility.

`tests/e2e/submit-meet.spec.ts` covers `/submit-meet` against mocked
`meetSubmissions` mutations and upload URL: the sign-in prompt when signed out,
the header links, uploading each file in turn (with the progress and the
disabled button while an upload is held) and the submission's arguments and
token, a blank end date as `null`, the form's checks before anything uploads, a
refused submission keeping the form filled, accessibility, and a small phone.

## Browser checks

Build the WebAssembly application, install the browser-test dependencies, and run
the Playwright suite:

```bash
env -u NO_COLOR \
  CLERK_PUBLISHABLE_KEY=pk_test_e2e \
  REVENUECAT_PUBLIC_API_KEY=rcb_e2e \
  mise exec -- trunk build --release --locked
npm ci --ignore-scripts
npx playwright install chromium webkit
npm run test:config
npm run typecheck
npm run test:e2e
```

The non-secret placeholder keys compile the authenticated test path into the
Wasm build; Playwright intercepts the provider scripts and never sends them to
Clerk or RevenueCat.

The suite exercises every route in Chromium and WebKit, including Pixel, iPhone,
and small-phone viewports. It also checks deep links, subscription handoffs,
route metadata, mobile navigation, text zoom, landscape layouts, viewport
overflow, touch-target sizing, semantic HTML, and serious or critical WCAG
issues.

Failed CI runs upload Playwright screenshots, traces, and the HTML report as a
workflow artifact.

Run one project while iterating (`npm run test:e2e:desktop`,
`npm run test:e2e:mobile`, or `npx playwright test --project=desktop-chromium`).
WebKit needs system libraries that `npx playwright install --with-deps webkit`
installs; where that is not possible, leave WebKit to CI.

## Mocking Convex

No browser test reaches a real deployment. Every read is a `POST` to
`https://disciplined-hare-790.convex.cloud/api/query` naming the function, so
tests answer by function name with the helpers in `tests/e2e/support/api.ts`:

```ts
await routeQuery(page, "reference:records", (route) => route.fulfill(textAnswer(rows)));
await routeQuery(page, "results:search", (route, args) =>
  route.fulfill(valueAnswer({ matched_name: null, suggestions: [String(args.query)], results: [] })),
);
```

- `routeQuery(page, fn, handler)` handles one function and passes its `args`
  to the handler; other functions fall through to earlier routes. It also
  answers the CORS preflight every JSON `POST` triggers.
- Answer the way the real query does: `textAnswer(body)` for `Body::JsonText`
  queries, `valueAnswer(body)` for `Body::Value` ones (see `queries` in
  `src/utils/api.rs`). `errorAnswer(message)` is a function that ran and failed.
- `routeMutation(page, fn, handler)` does the same for a mutation (`POST /api/mutation`):
  `deviceLogin:approve`, `deviceLogin:deny`, `apiTokens:revokeAllCli` and `meetSubmissions:*`.
- `retryableResponse(429 | 503, retryAfter?)` exercises the retries.
- `mockSubscribedUser(page)` puts stand-ins for Clerk's and RevenueCat's SDKs
  on the page (through `page.addInitScript`) as a signed-in, subscribed user,
  so gated pages render. The auth bridge uses an SDK already on the page
  instead of loading it. Don't mock the CDN files with `page.route`: they load
  with Subresource Integrity, so the browser refuses any other body. The
  signed-in stand-in's session token is `token_<user id>`. `mockAuth` also
  answers Convex's `accessPass:pass` (the pass `pass_test` for
  `Bearer token_user_ci`, 403 for another user or while its `serverEntitled`
  option is false) and the `entitlements:refresh` action (`refreshGrants`), so
  a premium read's `args` include `pass: "pass_test"`. It returns `server` (the
  pass it hands out, which a test may change to simulate a rotation) and the
  Authorization header of each call, `passRequests` and `entitlementRefreshes`.
  Any other Convex call a test does not route fails with an `errorAnswer`
  naming the function, instead of reaching production (gated pages read only
  after `mockAuth`, so this covers every read).

Assert on what a user sees, and on the arguments a page sends when they
matter (`expect(args).toEqual({ federation: "USAMW", ... })`).

## Visual baselines

`tests/e2e/visual.spec.ts` compares screenshots per project and platform
(`tests/e2e/visual.spec.ts-snapshots/`). After an intended visual change,
update them with `npx playwright test tests/e2e/visual.spec.ts --update-snapshots`
on each platform whose baseline changed, and review the new images before
committing.
