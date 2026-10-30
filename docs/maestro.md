# Maestro E2E Tests

MeetCal uses Maestro for route-level mobile smoke coverage.

## Prerequisites

- Maestro CLI: `maestro --version`
- Java 17+
- An installed iOS or Android native build
- `bun run maestro:test` starts its own Metro with the E2E switch (`EXPO_PUBLIC_MAESTRO_E2E=1`) on its simgate slot's port, runs the flows on the simulator the session claimed, and stops it (`scripts/maestro-session.ts`). It is a simgate session for the whole run, so stop your own Metro first.

The E2E switch is dev-only. It skips onboarding/version modals and bypasses auth/subscription gates so route coverage does not require Clerk or RevenueCat credentials.

## Commands

```sh
bun run maestro:test
APP_ID=com.memohnsen.meetcal.dev bun run maestro:test
DEV_CLIENT_URL="exp+meetcal://expo-development-client/?url=http%3A%2F%2F<host>%3A<session port>" bun run maestro:test
bun run maestro:bootstrap
bun run maestro:test:flow .maestro/00-main-tabs.yaml
```

The default `APP_ID` is `com.memohnsen.meetcal`. `bun run maestro:test` waits until its Metro serves, then bootstraps the Expo development client with `xcrun simctl openurl` on the session's simulator (`SIMGATE_UDID`) and port (`SIMGATE_PORT`). The default `DEV_CLIENT_URL` matches the LAN URL printed by Expo on this machine, with the session's port; override it if Expo prints a different host, and keep the session's port (8081 in slot 1, 8082 in slot 2).

## Coverage Map

- `00-main-tabs.yaml`: schedule shell, meet selector modal, saved tab empty state, start-list search, info menu.
- `01-competition-data.yaml`: records, WSO records, adaptive records, national rankings, qualifying totals, A/B standards, international rankings, filters, and data table states.
- `02-search-and-clubs.yaml`: all meet results search, Weightlifting Wrapped search, club list search, club meet list, and club results report route.
- `03-shared-and-settings.yaml`: offline data, profile/settings, sign-in, athlete results empty state, attempt estimator missing-param state, and partners screen.

## Cold-Start Deep Links

`cold-start/cold-start-deep-link.yaml` kills the app, opens a `meetcal:///shared-screens/schedule-details` link (as a widget row or calendar event does) and checks that Back returns to the Schedule tab. A development client cold-started by a link shows its launcher instead of the app, so the flow is outside the default `.maestro` run; run it against a preview or release build:

```sh
maestro test -e APP_ID=com.memohnsen.meetcal .maestro/cold-start/cold-start-deep-link.yaml
```

## States Still Needing Seeded Test Data

- Full signed-in Clerk flows.
- RevenueCat purchase/restore behavior.
- Calendar permission write flows.
- Airplane-mode cached-data assertions.
- Specific athlete/session result assertions that depend on stable seeded API fixtures.
