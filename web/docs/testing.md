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
timing, and whole-number floats becoming integers.

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
- `retryableResponse(429 | 503, retryAfter?)` exercises the retries.
- `mockSubscribedUser(page)` replaces Clerk's and RevenueCat's scripts with a
  signed-in, subscribed user, so gated pages render.

Assert on what a user sees, and on the arguments a page sends when they
matter (`expect(args).toEqual({ federation: "USAMW", ... })`).

## Visual baselines

`tests/e2e/visual.spec.ts` compares screenshots per project and platform
(`tests/e2e/visual.spec.ts-snapshots/`). After an intended visual change,
update them with `npx playwright test tests/e2e/visual.spec.ts --update-snapshots`
on each platform whose baseline changed, and review the new images before
committing.
