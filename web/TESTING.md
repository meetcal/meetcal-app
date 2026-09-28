# Frontend testing

MeetCal Web uses complementary Rust and browser test layers.

## Rust checks

```bash
cargo fmt --all -- --check
cargo clippy --all-targets --locked -- -D warnings
cargo test --locked
```

The Rust suite covers competition-data filtering helpers, API query serialization,
nullable values, and response-shape contracts.

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
