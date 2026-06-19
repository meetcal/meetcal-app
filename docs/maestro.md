# Maestro E2E Tests

MeetCal uses Maestro for route-level mobile smoke coverage.

## Prerequisites

- Maestro CLI: `maestro --version`
- Java 17+
- An installed iOS or Android native build
- Metro running with the E2E switch:

```sh
EXPO_PUBLIC_MAESTRO_E2E=1 bunx expo start
```

The E2E switch is dev-only. It skips onboarding/version modals and bypasses auth/subscription gates so route coverage does not require Clerk or RevenueCat credentials.

## Commands

```sh
bun run maestro:test
APP_ID=com.memohnsen.meetcal.dev bun run maestro:test
DEV_CLIENT_URL="exp+meetcal://expo-development-client/?url=http%3A%2F%2F192.168.0.114%3A8081" bun run maestro:test
bun run maestro:bootstrap
bun run maestro:test:flow .maestro/00-main-tabs.yaml
```

The default `APP_ID` is `com.memohnsen.meetcal`. `bun run maestro:test` first bootstraps the Expo development client with `xcrun simctl openurl booted`. The default `DEV_CLIENT_URL` matches the LAN URL printed by Expo on this machine; override it if Expo prints a different host.

## Coverage Map

- `00-main-tabs.yaml`: schedule shell, meet selector modal, saved tab empty state, start-list search, info menu.
- `01-competition-data.yaml`: records, WSO records, adaptive records, national rankings, qualifying totals, A/B standards, international rankings, filters, and data table states.
- `02-search-and-clubs.yaml`: all meet results search, Weightlifting Wrapped search, club list search, club meet list, and club results report route.
- `03-shared-and-settings.yaml`: offline data, profile/settings, sign-in, athlete results empty state, attempt estimator missing-param state, and partners screen.

## States Still Needing Seeded Test Data

- Full signed-in Clerk flows.
- RevenueCat purchase/restore behavior.
- Calendar permission write flows.
- Airplane-mode cached-data assertions.
- Specific athlete/session result assertions that depend on stable seeded API fixtures.
