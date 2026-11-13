# Architecture

meetcal.app is a client-side rendered Leptos app. Trunk compiles it to WebAssembly, as two apps
built from one crate (below); Vercel serves the static output and a small HTML shell per route. There is no server of its own: data comes from
Convex and sign-in from Clerk, both called from the browser. Convex alone decides who sees the
subscription data, through its access pass.

## Two apps: the site and the Schedule Builder

`/schedule-builder` is its own WebAssembly app, so its code never adds to the download of any other
page. Both apps are binaries of the one `meetcal-web` crate and share everything else through its
library (`src/lib.rs`): the header, footer, route metadata, auth, `utils/api` and `styles.css`.

| App | Binary | Trunk page | Routes |
|---|---|---|---|
| The site | `meetcal-web` (`src/main.rs`, `SiteRoutes`) | `index.html` | Every route except `/schedule-builder` |
| The Schedule Builder | `meetcal-web-schedule-builder` (`src/bin/meetcal-web-schedule-builder.rs`, `ScheduleBuilderRoutes`) | `schedule-builder.html` | `/schedule-builder` |

- Both route sets sit in the same frame (`SiteFrame` in `src/app.rs`: the router, route metadata,
  header, `<main>` and footer). `WasmApp::serving(path)` names the app that serves a path, and each
  app provides its `WasmApp` as context.
- A link into the other app is a whole-page load: `link_rel` gives it `rel="external"`, which the
  router leaves to the browser. The header, footer and Not Found page use it on every link to a
  page of the site, so the site's Schedule Builder link and the builder's links back to the site
  load the other app's document and Wasm.
- Trunk builds one app per page, so `trunk build` builds the site from `index.html`, and its
  post-build hook (`scripts/generate-bootstrap.sh`) builds the builder from `schedule-builder.html`
  into a temporary folder and copies its loader, Wasm, bootstrap, shell and snippets into the
  site's `dist/`. The two pages differ only in their `data-bin` (a config test compares them).
  Every `trunk build --release --locked` (CI, `scripts/vercel-build.sh`, `mise run build`) builds
  both.
- `mise run run` serves the site alone: it sets `MEETCAL_WEB_SITE_ONLY=1`, so the hook skips the
  builder's build on every rebuild, and `trunk serve` answers `/schedule-builder` with the site's
  `index.html`, which has no builder route. `mise run run-schedule-builder` serves the builder on
  port 3001. A config test runs the hook with and without the variable.

## Data: Convex over HTTP

Every read goes through `src/utils/api/`, which posts to Convex's HTTP API:

```text
POST https://disciplined-hare-790.convex.cloud/api/query
{ "path": "reference:records", "args": {}, "format": "json" }
```

- `queries` lists every Convex function the site reads, each with the Rust API route it replaced
  (the site read `api.meetcal.app` before Convex). Pages call `query(queries::RECORDS)` or
  `query_with(queries::WSO_RECORDS, &args)`; they never build a URL.
- A query's answer carries its body one of two ways, recorded on the `Query`:
  - `Body::JsonText`: `{ json }` or `{ etag, json }`, the body as JSON text. Most list answers
    (records, rankings, rosters, results) come this way because Convex serves text faster than the
    same rows as values.
  - `Body::Value`: the answer is the body (`results:search`, `reference:clubMeetStats`). Convex
    writes its numbers as floats (`2.0`); `utils/api` turns whole numbers back into integers before
    parsing.
- A query whose Convex function takes `ifNoneMatch` (`Query::tagged`; a test reads `../convex/` to
  keep the list right) is revalidated. `api/kept_answers.rs` keeps its last `{ etag, json }` under the function
  and its arguments (the pass and the tag left out): in memory for the session (the
  `MAX_ANSWERS_KEPT_IN_MEMORY` most recently used), and in IndexedDB (`src/answer_store.js`, at
  most 200 answers) for the next visit. The database opens as the page loads, and a read from it
  (an answer, or the stored pass) is given up after `STORE_READ_WAIT` (300 ms): the request then
  goes without the tag, and the store is skipped for a minute, so a store that never opens (as on
  WebKit 14) delays no page. The next read sends the tag as
  `ifNoneMatch`; Convex answers `{ etag }` alone when nothing changed, and the kept text is read
  instead of downloading it again. A premium answer is kept only while a pass is held and only
  until that pass's `rotatesAt`; signing out, or another user signing in, drops every premium
  answer and the stored pass.
- Each answer is read once: the HTTP body is text, its `value` stays raw JSON
  (`serde_json::value::RawValue`), and only the inner `json` text is parsed into the page's rows.
- Requests go through the browser's `fetch` (`src/utils/http.rs`), with an `AbortController` that
  ends a request at its timeout, body included, and when the request is dropped (a newer choice
  replaced it).
- The Club Dashboard's Meet picker reads `reference:clubMeets`, the club's distinct meets in one
  bounded answer, not the club's registrations (`reference:clubAthletes`, which the site no longer
  reads).
- A function that ran and failed answers `{ status: "error", errorMessage, errorData }`, over HTTP
  200 or 560. Our functions throw `{ status, error }` as `errorData`; the site shows `error`.
- 429 and 503 are retried twice, honoring `Retry-After` (1 to 10 seconds). Every query is a read,
  so a retry is safe. The site's only mutations, `deviceLogin:approve`, `deviceLogin:deny` and
  `apiTokens:revokeAllCli` (`POST /api/mutation`, from `/link`), and
  `meetSubmissions:generateUploadUrl` and `meetSubmissions:submit` (from `/submit-meet`), and
  `scheduleBuilder:saveDraft`, `scheduleBuilder:deleteDraft` and `schedulePublications:publish`
  (from `/schedule-builder`), are never retried by themselves: the user taps again.
- The premium functions (`SUBSCRIPTION_FUNCTIONS` in `api/catalog.rs`, Convex's `PREMIUM_FUNCTIONS`) take
  the access pass as their `pass` argument; `utils/api` adds it to their arguments. A search
  (`results:search`) takes it only with `startDate` and `endDate`: name suggestions are public.
  Every other query goes out without it, `results:wrapped` (Athlete Wrapped, below) included. No query carries the user's session token except
  `accessPass:pass`, `deviceLogin:describe` (one user's own CLI sign-in, below) and the Schedule
  Builder's `scheduleBuilder:draft`, `scheduleBuilder:drafts` and
  `schedulePublications:publications` (one user's own drafts and publishes, below): a query that reads its caller is cached per user, while every subscriber sends
  the same pass, so premium answers stay in Convex's shared query cache.
- The pass comes from `accessPass:pass` (`POST /api/query` with `Authorization: Bearer <Clerk
  session token>`, Clerk's default token, as the app sends), which answers `{ pass, rotatesAt }`.
  `utils/api` fetches it before the first premium read, only for a signed-in user, and holds it in
  memory, and in IndexedDB under the Clerk user's id so the next page load skips the fetch, until `rotatesAt`, or at least five minutes so a fast device clock cannot
  make every read fetch it; concurrent reads share one fetch. Convex accepts a pass until the
  rotation after the one that replaced it, so a slightly stale pass still works. Signing in, out
  or as another user forgets it.
- When `accessPass:pass` answers 403 (Convex has no active entitlement for the user), `utils/api`
  calls the `entitlements:refresh` action (`POST /api/action`, same token), which asks RevenueCat
  and records the entitlement, and, if it answers `{ active: true }`, asks for the pass once more.
  This is how Convex learns of a subscriber its RevenueCat webhook never reported (a lifetime
  purchase never renews).
- A data page opens only once its gate holds a pass (below), so its reads carry one. Should the
  pass be lost while the page is open (offline, Clerk slow to hand over a token), a premium read
  goes out without one, and a failed fetch is not tried again for a minute. If Convex refuses
  a premium read for its pass (a function error with status 401, "access pass required", or 403,
  "access pass expired"), `utils/api` drops the held pass, fetches a fresh one, and sends the read
  once more with it.
- `MEETCAL_CONVEX_URL` (compile time) points a build at another deployment. Production's CSP allows
  only the production deployment, so a preview built against dev is blocked on Vercel.

The queries themselves are in `../convex/` (`reference.ts`, `meets.ts`, `results.ts`). Many are
served from materialized views; `../docs/backend.md` explains when a view needs rebuilding after a
deploy.

## Tables

Every long table renders through `RowsTable` (`src/pages/comp_data/ui.rs`): the first
`ROWS_SHOWN_FIRST` (100) rows of the current filter and sort, and a Show More button that adds
`ROWS_ADDED_BY_SHOW_MORE` (100) more; a new filter or sort starts again from the first rows. Rows
are keyed by their place in the answer (`<For>`), so a new sort moves the rows already drawn
instead of rewriting each cell. The reference tables (`reference_table.rs`) build their filter
selects once per answer, outside the rows' reactive closure. A filter select commits a choice made
with the keyboard (arrow keys, Home, End, typing) once the keys pause (`SELECT_STEP_SETTLE`), so
stepping through a closed select is one query or one re-render, not one per step; a pick with the
mouse or a tap commits at once. Records and Qualifying Totals ask Convex for the rows of the chosen organization (or event), gender
and age (`reference:records` with `federation`, `gender`, `ageCategory`; `reference:qualifyingTotals`
with `event`, `gender`, `ageCategory`), and fill those three selects from
`reference:recordCategories` / `reference:qualifyingTotalCategories` (`narrowed.rs`), so a filtered
address downloads only its rows; the weight class and the sort stay on the page. A choice the
categories do not offer reads as no filter. The Meet Center shows one of Schedule, Start List and Full Results
at a time, chosen by a segmented control and kept in the address (`section`), and folds the meet
names for search once per catalog, not per keystroke.

## Sign-in and the subscription gate

`src/auth.rs` loads Clerk's web SDK through `src/auth_bridge.js`, from pinned versions on
jsDelivr. Clerk loads only when it is needed: on a route that needs an
account (the data routes behind the gate, `/link`, `/submit-meet`), when Clerk's `__client_uat`
cookie says this browser has a session, or when the visitor taps Sign in; its two files download
in parallel. Every other visitor sees a plain Sign in button and downloads no Clerk at all. The
sign-in card's container keeps its height before Clerk draws into it, so the page does not shift. Each file loads with a Subresource Integrity hash, and the CSP
allows only those versions' directories. The chunks Clerk loads later from those directories
carry no integrity hash (Clerk's chunk loader doesn't set one), so only the CSP pin covers them.
Upgrading Clerk means changing its version and hash in `auth_bridge.js` and its path in
`vercel.json` (`tests/config/vercel.test.mjs` checks they agree). The publishable key is compiled
in from `CLERK_PUBLISHABLE_KEY`. The site loads no RevenueCat SDK.

`SubscriptionGate` (`src/components/subscription_gate.rs`) wraps each competition data route in
`src/app.rs` except the free `/wrapped`: signed out, it mounts Clerk's sign-in, which returns to
the same page; signed in, it asks Convex for the access pass (`check_access` in
`utils/api/pass.rs`), using a pass already held in memory or IndexedDB while it is current. Convex's
answer decides what the gate shows:

| Pass answer | The gate shows |
|---|---|
| A pass | The page |
| 403 after `entitlements:refresh` finds no subscription | The subscription handoff (Continue in the MeetCal app) |
| 401 | Clerk's sign-in |
| 503, a network error, or a malformed answer | The error card, with Try again |

The site makes no entitlement decision of its own. Purchases happen in the mobile app only
(`/subscription` sends users there); when the tab is shown again over the handoff, the gate asks
again (pass, then `entitlements:refresh`, then the pass), so a user who just subscribed in the app
gets in without a reload.

While it checks, the gate shows the page's own heading and intro from `catalog.rs` over its first
view (`FirstView`): a table skeleton, or for a page that opens on a search (Meet Center) the
search field, disabled until its list loads, and the prompt under it. That is the same first frame
the route's static shell paints, so nothing moves when the app mounts or when the check passes.
Every data page is at least a screen tall (`.data-page`), so the footer, which only the app
draws, arrives below the first screen: a table or a meet arriving after mount never moves it,
and it is never the page's largest paint. The Meet Center shows a meet's sections only once the
meet list has loaded, so the meet's details and its sections appear together.

Every route's gate reads one shared answer (`provide_access`, next to `provide_auth`), so moving
between data pages neither checks again nor rebuilds the page. It is checked again when the
Clerk user changes, when a page opens after a refusal or an error, and in the background when a
page opens more than ten minutes after the last grant; that background check asks Convex only once
the held pass has run out, and an error there keeps the open page.

The gate decides what the page shows; Convex enforces the subscription through the pass. For now
Convex only logs a premium read without a current pass, answering everyone; later it will refuse
it. Until then the data the gate guards is still public in Convex.

## Athlete Wrapped: `/wrapped`

Weightlifting Wrapped is free on the app and the site, so a shared Wrapped opens for anyone,
signed out included. `src/pages/comp_data/wrapped.rs` sends one `results:wrapped` query per search
(`POST /api/query`, args `{ query, year }`, plus `picked: true` after a pick; no pass, no token) and
shows its answer, which the server scores from the year's results (`../convex/lib/wrapped.ts`, the
app's rules). The answer never carries the results themselves, which is what lets it be free.

- `athlete`: the report (meets, make rate, best lifts, average total, weight lifted,
  first-to-last change, longest make streak, favorite attempt, top meet), headed with the
  athlete's own spelling.
- `ambiguous`: the names to pick from ("Several athletes match…", or "Many athletes match…, or
  type more of the name" when `truncated`). A pick asks again with `picked: true`, which the server
  answers only for that exact name.
- `narrow`, `tooManyResults` and `none` (with name `suggestions`): a line saying why there is no
  Wrapped.

The athlete field's suggestions come from `results:search` without dates, which is public.

## Approving a CLI sign-in: `/link`

`meetcal login` (the CLI in `../cli/`) prints a code such as `WXYZ-BCDF`, a link to
`https://meetcal.app/link?code=WXYZ-BCDF` and a QR code of it, and waits. `src/pages/link.rs`
is the page the link opens. It needs a signed-in user but no subscription, so its route in
`src/app.rs` sits outside `SubscriptionGate`, and it is in no navigation menu or sitemap
(`noindex, nofollow`).

- The URL holds the code. Signed out, the page mounts the same Clerk sign-in as the gate, which
  returns to the current URL, `/link?code=…`, query included. Without a code (or with only part
  of one) it asks for it: the field keeps letters only (codes have no digits, and the server drops
  them), uppercases them, caps them at eight and adds the dash (`ABCD-EFGH`); Continue moves to
  `/link?code=ABCD-EFGH`.
- With a whole code it asks `deviceLogin:describe` (`POST /api/query`), which answers
  `{ deviceName, createdAt, expiresAt }` or `null`, and shows the device, the code and how long ago
  it asked, with a warning to approve only a `meetcal login` the user just ran. The device name is
  the requester's own claim, so it is shown in quotes as "the name the device gave itself": a
  requester cannot pass for the MeetCal app. Approve and Deny call `deviceLogin:approve` and
  `deviceLogin:deny` (`POST /api/mutation`), which answer `{ ok: true }`. Approve answers a
  function error with status 404 for a code no login is waiting on. Deny also turns down a login
  this user approved whose token the CLI has not collected yet (second thoughts in another tab),
  and answers 404 when nothing is left to turn down (expired, or the CLI already has its token):
  the page then shows the code as expired or used, never "denied", since the CLI may be signed in. All three carry `Authorization: Bearer <Clerk session token>`, and a 401 shows "MeetCal
  couldn't confirm you're signed in; please sign in again", with a Try again button that asks again
  with a fresh token. The calls are in `utils/api` (`describe_device_login`,
  `approve_device_login`, `deny_device_login`, `revoke_all_cli_logins`).
- States: checking sign-in, sign-in, code entry, looking up, the request (Approve / Deny),
  approved ("Done — you can return to your terminal."), denied, expired or used (a `null`
  describe or a 404 approve: run `meetcal login` again; a 404 deny: it could not be denied), and
  an error with Try again, which repeats the call that failed.
- Recovery: below the card, whenever the user is signed in (done and denied included), "Sign out
  all CLI logins" asks "Sign out every computer signed in with meetcal login?", then calls the
  mutation `apiTokens:revokeAllCli` (`POST /api/mutation`, args `{}`, the same bearer token), which
  answers `{ ended }`, and shows "Signed out N CLI logins." A failure shows the error with Try
  again; like the other mutations, it is never sent again without a tap.

## Submitting a meet: `/submit-meet`

Users send the schedule and start lists of a meet MeetCal does not cover yet. `src/pages/submit_meet.rs`
needs a signed-in user but no subscription, so its route sits outside `SubscriptionGate`; signed out,
it mounts the same Clerk sign-in as the gate. The header links to it ("Submit a Meet", next to
Contact Us, in the desktop and the mobile menu); its metadata is `noindex, nofollow`, and it is not
in the sitemap.

- The form takes the meet's name, its start date, an optional end date (`<input type="date">`,
  `YYYY-MM-DD`) and 1 to 10 files, each listed with a Remove button. `check_submission` makes the
  server's checks (`../convex/lib/meetSubmissions.ts`) before anything uploads: a name of 1 to 200
  characters once trimmed, real dates with the end on or after the start, and files that are PDFs,
  photos, spreadsheets or Word documents by extension (`FILE_EXTENSIONS`, which a test keeps equal
  to the server's), at most 20 MB each, with names of 1 to 200 characters. A file that fails is
  marked in the list.
- Submitting uploads the files one at a time ("Uploading 2 of 5…"): `meetSubmissions:generateUploadUrl`
  (`POST /api/mutation`, args `{}`, the user's Clerk session token) answers `{ uploadUrl }`, a
  one-time URL on the deployment; the file's bytes are posted to it with the file's
  `Content-Type` (from its extension when the browser gives none) and no token, within
  `UPLOAD_TIMEOUT`, and it answers `{ storageId }`. Then `meetSubmissions:submit` (same token) takes
  `{ meetName, startDate, endDate, contactEmail, files: [{ storageId, name }] }` and answers
  `{ submitted: true }`; the server stores it and emails the owner. `contactEmail` is the Clerk
  user's primary email (`auth::primary_email`), or `null`.
- A function error's `{ status, error }` is shown as a sentence: 400 (invalid input) and 413 (a file
  over 20 MB) show the server's `error`, 429 (5 submissions, or the upload URLs, a day) adds "Please
  try again tomorrow.", and 401 says MeetCal couldn't confirm the sign-in and asks the user to sign in again, as
  `/link` does. A submit refused with `code: "already_submitted"` (the files are already in a
  submission) counts as sent when it is a retry that reused files an earlier try uploaded: that try
  was stored after all. On a first try it shows the server's `error`. On any error the form keeps
  what the user entered. Done, the page thanks the user and offers to send another meet.
- Upload URLs are on the Convex deployment's own origin, which the CSP's `connect-src` already allows.

## Building a meet's schedule: `/schedule-builder`

Meet organizers build a meet's sessions from its Sport80 entries (`src/pages/schedule_builder/`,
calls in `src/utils/api/schedule_builder.rs`, backend in `../convex/scheduleBuilder.ts`,
`../convex/scheduleBuilderLoad.ts` and `../convex/schedulePublications.ts`). The page is public and
indexable, in the sitemap, and linked as "Schedule Builder" in the header; signing in adds drafts
and publishing. It is its own Wasm app ([Two apps](#two-apps-the-site-and-the-schedule-builder)),
downloaded only when someone opens `/schedule-builder`, with its own size budget. Like every public page, it loads Clerk only when the browser has a Clerk session or
the visitor taps Sign in, and its shell is the empty Load a Meet form. The page computes nothing about a schedule: it sends options and edits and shows
Convex's answer.

- Pasting the meet's Sport80 link (its entries list, public page or registration link; Convex
  alone decides which links it takes) calls the action `scheduleBuilderLoad:load` (`{ url }`, within
  `SPORT80_LOAD_TIMEOUT`), which answers `{ meet }`; the page then moves to
  `/schedule-builder?meet=<name>`, the address the drafts list and a shared link open.
- `scheduleBuilder:defaults` answers the meet's days and default options, which fill the options
  form. The form's checks (`checked_options` in `models.rs`) give each limit a readable sentence,
  and refuse, as `checkBuilderOptions` does, a day whose first start leaves no time for the
  two-hour weigh-in or whose first session would end after midnight; the limits are the server's
  `BUILDER_LIMITS`, maximums, `WEIGH_IN_MINUTES` and `MINUTES_PER_DAY`, which a test keeps equal.
  The weigh-in is not an option: every session weighs in two hours before its start. Building sends the
  options, with the edits made so far, to `scheduleBuilder:preview`, which answers the sessions,
  each group's `label` (the one the export and a published schedule use) and the warnings. A new
  build with changed options drops the edits after the user confirms, and only once `preview`
  accepts the new options: a refused build brings the previous options and edits back.
- Edits come from disclosure lists, with no drag and drop and no menu roles: Move To… on each
  athlete, a class chip's Move Class To…, and Swap With… on each session each open a list of
  plain buttons (the toolbar's Export list is the same disclosure), and Edit Time opens a small dialog. Escape or a click outside closes one and
  returns focus to its button; after an edit, focus goes to the button in the same place on the
  new board, or to Undo. Each edit is appended to the list sent to `preview` (at most
  `MAX_BUILDER_EDITS`, the server's), and Undo drops the last. While the next answer loads, the
  previous board stays on screen dimmed and `inert`.
- Signed out, the options and edits of each meet are kept in `localStorage`
  (`meetcal.scheduleBuilder:<meet>`, every access guarded, so the page works without it). Signed
  in, Save Draft calls `scheduleBuilder:saveDraft`, and the landing page lists
  `scheduleBuilder:drafts` with Delete (`scheduleBuilder:deleteDraft`). Opening a meet starts from
  the newer of the saved draft (`scheduleBuilder:draft`) and the browser's copy, or from the
  defaults, unbuilt.
- Export opens a list of CSV, Excel and PDF. CSV and Excel save `scheduleBuilder:exportFile`'s
  answer as a file (an Excel workbook arrives as base64). PDF prints the page: the print styles in
  `styles.css` hide the header, footer, options and every control (`.no-print`) and keep each
  session's date, weigh-in, start, platforms, group labels and athletes.
- Publishing needs sign-in: `schedulePublications:publish` takes the options, edits and the contact
  email (prefilled with the Clerk user's primary email) and answers `live` or `pending`, shown as
  "Live on MeetCal" or "Sent for Review" until the options or edits change, when the form returns
  for the next publish; `schedulePublications:publications` lists the user's publishes of the meet
  and whether they organize it.
- A meet with a published schedule (`defaults.published`) opens on it: the page sends
  `base: 'published'` with every preview, export, draft and publish, and the options form's button
  reads Rebuild From Scratch, which asks first (the same confirmation as Build Again, saying that it
  regroups the start list with Sport80's new lifters and without the ones it no longer lists) and
  then builds with `base: 'entries'`, keeping the schedule's version (`defaults.version`), which
  every publish sends. Drafts and the browser copy keep their base and version (`basis`).
  Saved work reopens when it was made on the meet's current version, from scratch or not, or, for a
  meet with no schedule, when it was built from the entries (it then takes the meet's current
  version); otherwise the page opens on the schedule as it is now (or
  the entries) with a line saying why the saved work was set aside. Any live publish makes the
  answered `version` the new base and clears the edits.
- On the published schedule a Sport80 Changes section reads `preview`'s `changes`: when Sport80
  was last checked, Check Sport80 Now (the action `scheduleBuilderLoad:load` on `defaults.sport80Link`,
  then the preview again; inside the load's cooldown it says when Sport80 was checked and when it
  can be checked again, from the answer's `checkedAt` and `nextCheckAt`, and still fetches the
  preview again so the board shows that check), and each new lifter with
  "Add to Session N · Platform" (the server's suggestion) and Add To…, the same disclosure list as
  Move To…, both sending `addAthlete`, plus Convex's `addedNote` on how many stay off the start list. A
  platform whose own times differ from its session's shows the lines `preview` answers for it
  (`ownTimes`: one line, or one per published row when its rows start at different times) in its
  heading, on the board and in print. A platform Convex answers as `locked` (several published
  rows in one session) offers no Move To, class chips or Remove, a `locked` session no Swap With…
  or Edit Time, and neither is a Move To, Add To or Swap target; a warning from Convex says to use
  Rebuild From Scratch for withdrawn lifters there. While a publish is on its
  way the board and the Sport80 panel are inert, and Undo and both Rebuild From Scratch buttons are
  disabled, so no edit or rebuild is made that its answer would discard. Lifters no
  longer on Sport80 are marked on the board, each with Remove (`removeAthlete`), and the section
  shows Convex's `withdrawnNote`, which counts only the lifters Remove can take off.
- A function error's `error` is shown as the sentence the server wrote, and a 401 asks the user to
  sign in again.

## Routes and metadata

Each route needs a document that search engines and link previews can read before the Wasm loads:

- Every route's first frame is in its HTML: `tests/shells.rs` renders the route set of the app
  that serves it (`WasmAppRoutes`: `SiteRoutes`, or `ScheduleBuilderRoutes` for `/schedule-builder`)
  natively (Leptos' `ssr` feature, on in native tests only) for each route, as the app's first
  frame shows it before Clerk answers (the header, and for a gated route the page's heading, intro
  and a table skeleton from `catalog.rs`), and keeps `shells/<route>.html` and `shells/routes.txt`
  (each route's title, description and robots) equal to it. After a change to a page, the header
  or the catalog, run `UPDATE_SHELLS=1 cargo test --test shells`; the test fails until the
  committed shells match.
- `scripts/generate-bootstrap.sh` runs after every Trunk build. wasm-bindgen names the snippet
  folder (`snippets/meetcal-web-<crate hash>/`) after the crate, not its files, so the script adds
  the files' content hash to the folder's name, rewrites the glue's imports to match, and names the
  glue by its own content hash again; both can then be cached for a year. It writes the content-hashed
  `app-bootstrap-<hash>.js` (which loads the Wasm, then removes the prerendered page and
  `#app-loading`, or turns `#app-loading` into an error with a retry when the load fails, and
  starts PostHog once the app has mounted), adds `modulepreload` for the glue and the auth bridge
  and `preload` for the Wasm, so all three download with the HTML, and renders every line of
  `shells/routes.txt` into its document (`index.html`, `404.html`, `dist/seo/<name>.html`), each
  with its own title, description, canonical URL and robots directive and its route's shell. The
  script runs once per app (`TRUNK_HTML_FILE` names which): the site's run renders every line but
  `schedule-builder`, then builds the Schedule Builder, whose run writes its own bootstrap and
  preloads (`meetcal-web-schedule-builder-<hash>.js` and `_bg.wasm`) into
  `dist/seo/schedule-builder.html`; the site's run copies them into `dist/`. Competition data pages are
  `noindex, nofollow`, except the free `/wrapped`, which is `index, follow`, has its own
  description and is in `public/sitemap.xml`, as is `/schedule-builder`.
- `vercel.json` rewrites each route to its shell (`/records` to `/seo/records.html`).
- Once the app runs, `RouteMetadata` (`src/components/seo.rs`) keeps the title and meta tags in
  step as the user navigates. Data pages take theirs from `DATA_PAGES` in
  `src/pages/comp_data/catalog.rs`.

### Adding a page

For a new competition data page, all of these change together:

1. `src/pages/comp_data/<page>.rs` (and `mod.rs`).
2. `src/app.rs`: the route, inside `SubscriptionGate page=catalog::<PAGE>`.
3. `src/pages/comp_data/catalog.rs`: a `const` for the page (its label, heading, intro,
   description and SEO title, `access: Access::Subscription`) listed in `DATA_PAGES`. The page
   reads its heading and intro from it (`<DataPage page=catalog::<PAGE>>`), and so do the gate and
   the page's prerendered shell; it also adds the page to the header menu, the data home and the
   route metadata.
4. `shells/`: run `UPDATE_SHELLS=1 cargo test --test shells`, which adds its shell and its line in `routes.txt`.
5. `vercel.json`: the rewrite to its shell.
6. `tests/e2e/support/routes.ts`: `protectedDataRoutes`, so the route, gate and metadata tests
   cover it; and a test for the page itself in `tests/e2e/competition.spec.ts`.

A free data page (`Access::Free { seo_description }`, like `/wrapped`) has no gate, its own
`render_page` call (`index, follow`, its description) instead of a line in the list, a sitemap
entry, and a place in `publicRoutes`; the catalog's tests check each of these against its access.
A public page follows the same steps without the gate, with its own entry in
`metadata_for_path` and `render_page` instead of the catalog, and in `publicRoutes`. A page that
needs a signed-in user but no subscription and is in no menu (`/link`) goes in `signedInRoutes`
instead; `/submit-meet`, which the header links to, has its own spec.

## Deploying

Vercel's project `meetcal-web` builds this folder (project root `web/`) with
`scripts/vercel-build.sh`: it installs Rust and Trunk, writes `public/posthog-env.js` from
`POSTHOG_API_KEY`, and runs `trunk build --release --locked` into `dist/`, which builds both apps. Production deploys from
`master`; every pull request gets a preview. `vercel.json` also sets the security headers,
including the CSP, for every response.

Analytics: once the app has mounted, the bootstrap loads `public/posthog-env.js` and
`public/posthog-init.js` when the browser is idle, which start PostHog with the key the build
wrote: autocapture, pageviews and web vitals, without surveys or dead-click capture.

Caching (`vercel.json`): every content-hashed file (both apps' glue and Wasm, which
`/meetcal-web-(.*)` covers, the stylesheet, the bootstraps and everything under `/snippets/`) is `immutable` for a year, and a config test checks
each hashed file in `dist/` against the rules. Images, icons and the manifest are cached for a day,
the PostHog files for an hour, and the HTML revalidates on every visit.
