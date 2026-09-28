# MeetCal 📅

USA Weightlifting meet schedules, start lists, results, rankings and records, as a mobile app, a
website and a command line tool, all reading one Convex backend.

- iOS: https://apps.apple.com/us/app/meetcal/id6741133286
- Android: https://play.google.com/store/apps/details?id=com.memohnsen.meetcal
- Web: https://meetcal.app
- CLI: `brew install meetcal/tap/meetcal`

## What's in this repo

| Path | What it is | Built with |
|---|---|---|
| [`src/`](src/) (with `assets/`, `plugins/`, `targets/` and `widget/` at the root) | The mobile app | React Native, Expo (Bun) |
| [`convex/`](convex/) | The backend: queries, materialized views, ingest, and the scheduled scrapers that keep the data current | Convex (TypeScript) |
| [`web/`](web/) | meetcal.app: the marketing site and the competition data pages | Rust, Leptos (WebAssembly), Trunk, deployed on Vercel |
| [`cli/`](cli/) | `meetcal`, the command line tool | Rust, released through Homebrew |

All live data comes from Convex. The app, the website and the CLI call the same queries (the app
through `src/lib/api/meetcal-api.ts`, the website and the CLI over Convex's HTTP API), so a change to a
query's answer reaches all three. How the backend keeps its derived data current is in
[docs/backend.md](docs/backend.md).

For agent and contributor workflow, see [AGENTS.md](AGENTS.md). Tool versions and local tasks are in [mise.toml](mise.toml): `mise run setup`, `mise run app:start`, and `mise run check` cover the usual setup, development, and verification path for the app. The website and the CLI have their own toolchains; see their sections below.

## CI and releases

| Workflow | Runs on | Does |
|---|---|---|
| `.github/workflows/ci.yml` | App changes | Lint, typecheck, Jest with coverage |
| `.github/workflows/web.yml` | Changes to `web/` or `convex/` | Rust checks, production build, Playwright (Chromium and WebKit, desktop and mobile) |
| `.github/workflows/cli.yml` | Changes to `cli/` or `convex/` | `cargo fmt`, `clippy`, tests |
| `.github/workflows/cli-release.yml` | A `cli-vX.Y.Z` tag | Builds the CLI for macOS and Linux and publishes the release |

Convex deploys with `npx convex deploy`, the website deploys on Vercel from `master` (project root
`web/`), and the app ships through EAS Build and EAS Update.

# The app

[![MeetCal Demo](https://youtube.com/shorts/4xoIoYox3C0?feature=share)](https://youtube.com/shorts/4xoIoYox3C0?feature=share)

## Features

- Schedule management for athletes and meets
- Athlete data management
- Convex backend with offline-first app caching
- Cross-platform support (iOS, Android)

## Tech Stack

| Category | Technology |
|---|---|
| **Framework** | React Native 0.88, React 19 |
| **Platform** | Expo SDK 58 (preview), Expo Router |
| **Language** | TypeScript |
| **Backend** | Convex (queries, materialized views, scheduled scrapers) |
| **Authentication** | Clerk (JWT, secure token storage) |
| **Subscriptions** | RevenueCat (in-app purchases, subscription tiers) |
| **Analytics** | PostHog & Sentry (event tracking, remote config) |
| **Animations** | React Native Reanimated, Gesture Handler |
| **Notifications** | Expo Notifications (local + scheduled), OneSignal (remote push) |
| **Build & Deploy** | EAS Build, EAS Update (OTA) |

## Architecture

- **Offline-first data layer** — Multi-layer caching (in-memory, AsyncStorage) with API-backed sync when online and graceful degradation when offline
- **Context-based state management** — Custom providers and hooks for theme, subscriptions, saved sessions, and selected meet state
- **File-based routing** — Expo Router with feature-grouped folders, tab navigation, and modal screen stacks
- **Push notification system** — Scheduled reminders for weigh-ins and competition sessions with user-configurable timing; remote messaging via OneSignal
- **Home screen widgets** — Native iOS and Android widget support with app group data sharing

## Key Features

- Competition schedule browsing with timezone-aware session times
- Athlete start list lookup with real-time updates
- National and international rankings and records
- Save and track sessions across meets
- Device calendar integration for session reminders
- Dark mode support with system theme detection
- Subscription management (free, quarterly, lifetime tiers)

## Environment

Copy `.env.example` to `.env.local` and fill in values. `EXPO_PUBLIC_CONVEX_URL` is the data backend:

- **Local development:** run `mise run convex:dev`; it writes the dev deployment's URL (`CONVEX_DEPLOYMENT`, `EXPO_PUBLIC_CONVEX_URL`) into `.env.local`.
- **EAS builds:** `eas.json` sets it per profile: the dev deployment for `development*`, production for `preview` and `production*`.

Convex deployment variables (set with `bunx convex env set … --prod` when authorized): `ALERT_EMAIL` (scheduled-job failure emails), `URLWATCH_EMAIL` (usamasters.net page changes), `ONESIGNAL_APP_ID` and `ONESIGNAL_REST_API_KEY` (how those emails are sent), and the Clerk variables for signed-in calls.

## Native API Integration

The app leverages several native device capabilities through Expo modules:

- **expo-calendar** — Add sessions directly to the device calendar
- **expo-haptics** — Tactile feedback on tab interactions
- **expo-secure-store** — Encrypted credential and token storage
- **expo-file-system** — Local file operations for caching
- **expo-notifications** — Local and scheduled notification handling
- **expo-updates** — Over-the-air updates via EAS
- **expo-blur / expo-glass-effect** — Native blur and liquid glass UI effects

## iPhone Duo

The app targets the iOS 27.1 SDK so it runs in full compatibility mode on iPhone Duo's
inner display. Building it requires Xcode 27.1 locally — see [docs/iphone-duo.md](docs/iphone-duo.md).

# The website (`web/`)

meetcal.app: the marketing pages, and the competition data pages (results, meet center, club and
WSO dashboards, rankings, records, standards, qualifying totals, Wrapped) behind the subscription.
Written in Rust with Leptos and compiled to WebAssembly; every data call is in
[`web/src/utils/api.rs`](web/src/utils/api.rs).

```sh
cd web
mise run run                 # trunk serve on http://localhost:3000
mise run check-all           # cargo fmt, clippy, tests
```

How the site fits together (data, sign-in, routes, deploys) is in
[web/docs/architecture.md](web/docs/architecture.md); browser tests (Playwright) are in
[web/docs/testing.md](web/docs/testing.md), and the build's environment variables in
[web/.env.example](web/.env.example). Agents: [web/AGENTS.md](web/AGENTS.md). A build reads the
production Convex deployment unless `MEETCAL_CONVEX_URL` names another. Vercel builds the site
from `web/` with `web/vercel.json`, which also holds its security headers and route rewrites.

# The CLI (`cli/`)

`meetcal` answers the same questions from a terminal: athlete search and Wrapped, meet start lists
and results, club and WSO reports, rankings, records, standards and qualifying totals.

```sh
brew install meetcal/tap/meetcal
meetcal search "Maddisen Mohnsen"
meetcal --help
```

Development runs from `cli/` (`just check-all`, `cargo run -- <command>`); every Convex query it
reads is in [`cli/src/utils/backend.rs`](cli/src/utils/backend.rs), and `MEETCAL_CONVEX_URL`
points it at another deployment. The full command reference is in [cli/README.md](cli/README.md),
and releasing a new version (tag `cli-vX.Y.Z`, then update the
[Homebrew tap](https://github.com/meetcal/homebrew-tap)) is in
[cli/docs/releasing.md](cli/docs/releasing.md). How it works is in
[cli/docs/architecture.md](cli/docs/architecture.md), testing in
[cli/docs/testing.md](cli/docs/testing.md), and agent guidance in [cli/AGENTS.md](cli/AGENTS.md).
