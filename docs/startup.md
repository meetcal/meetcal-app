# Cold start

What happens between the JS bundle starting and the Schedule tab showing the selected meet's sessions, and how to measure it.

## The path

1. `src/app/_layout.tsx` module scope: `lib/startup-timing.ts` is imported first and its clock starts (0 ms in every mark below). Sentry, NetInfo, RevenueCat (`Purchases.configure`, which returns nothing) and OneSignal are set up synchronously here, before any component runs, because providers below call them from effects and child effects run before a parent's. The splash cap is armed here too (see below).
2. The root renders on its first pass. Nothing gates it: no font load, no awaited SDK setup.
3. `SelectedMeetProvider`'s first `loadMeets` reads the meets list cache, `@selected_meet` and `@selected_meet_details` together. As soon as the stored meet's name is read, its schedule read starts too (`primeScheduleCache` in `lib/database/schedule-resource.ts`), so the Schedule tab's first cache read finds it ready instead of starting a second disk read after the meets list has painted. A primed read is used only while no write to that meet was queued or landed since it started (`getMeetWriteGeneration`), and for at most `SCHEDULE_PRIME_TTL_MS`. A network answer published meanwhile still wins in `useMutableResource`.
4. The chosen meet is warmed (`warmMeetData`): its schedule is fetched at once; its roster (`meets:athletesSessions`, about 0.5 MB, plus `saveMeetAthletes`) waits for the first screen plus `ROSTER_PREFETCH_AFTER_FIRST_SCREEN_MS`, and never longer than `ROSTER_PREFETCH_MAX_DEFER_MS` (`lib/database/meet-manager.ts`). A forced sync releases it at once. A roster the Start List stored meanwhile is not downloaded again, and one cleared meanwhile (Clear Cache, a delete) is not written back. A meet the user picks is never deferred.
5. API requests send the server clock sample alongside, and do not wait for it (`request()` in `lib/api/meetcal-api.ts`). Until it lands, `getTrustedNow()` is null; callers already skip or fall back. Decisions that can delete or forget something wait for it, bounded by `SERVER_CLOCK_DECISION_GRACE_MS` (`awaitServerClock`): the expiry sweep after a meets refresh (`loadMeets` and `refreshAvailableMeets`), Clear Cache's choice of which ended downloads not to bring back, and whether a stored meet that left the list is over (which forgets the selection). Choosing which listed meet to open on a cold cache only picks a screen and reads whichever clock is there (`launchNow`).

The Schedule tab mounts before a meet is chosen. `useMutableResource` reports `isInitialLoading` on the render where its params first arrive (before its load effect has run); without that the tab read "loaded, no days" for one frame and drew "No schedule yet", and the splash came down on it.

## The splash

`lib/startup-splash.ts` holds the native splash until the first screen has settled, so a warm start goes from the splash straight to the schedule, without the "Loading meets..." and "Loading schedule..." skeletons. It hides on the first of:

| Reason (`splash_hide_reason`) | When |
|---|---|
| `screen` | The Schedule tab settled: its day list laid out (first `onLayout`), or it shows no meet, an empty schedule, a load error, or the onboarding tour (`scheduleScreenOutcome` in `lib/startup-timing.ts`). While the stored meet is being looked up by name (`isResolvingStoredMeet`), "no meet" is not settled yet. |
| `other-route` | The visible route is not the Schedule tab (a deep link, sign-in, another tab). Judged from expo-router's segments by `SplashRouteReporter` (`components/navigation/`), a leaf of the root layout: every tab's screen is an `index` in its group, so the pathname is "/" for all four. |
| `overlay` | The update prompt (`UpdateNotification`) wants to show. |
| `cap` | `SPLASH_HOLD_MAX_MS` (1500 ms) after JS start. A fresh install or a cold cache then shows the skeletons as before. |

The cap's timer is armed at module scope, outside React, so a render that throws or a load that hangs cannot keep the splash up. Only the process's first screen counts; later screens never touch the splash.

## The `startup_timing` event

One PostHog event per process, sent once the splash is down and the first screen has settled, or after `STARTUP_TIMING_MAX_WAIT_MS` (30 s) with whatever was collected (`complete: false`). A launch the OS kills before then sends nothing. A build without a PostHog key sends nothing; development builds log it as `[perf] startup timing`.

| Property | Meaning |
|---|---|
| `splash_hidden_ms` | Splash asked to hide. |
| `meets_cached_ms` | Cached meets list handed to the screens (null on a cold cache). |
| `schedule_cached_ms` | Schedule tab rendered its day list from the offline copy. |
| `schedule_content_ms` | Day list laid out (first `onLayout`), from cache or network. |
| `first_screen_ms` | First settled screen, whatever it was. |
| `outcome` | `schedule`, `empty-schedule`, `no-meet`, `error`, `onboarding`, `other-route` (opened on a deep link or sign-in), or null if none settled in 30 s. |
| `complete` | Splash hidden and first screen settled before the event went out. |
| `splash_hide_reason` | See the table above. |
| `meets_cache_hit`, `schedule_cache_hit` | Whether each came from disk. |
| `needed_meet_lookup` | The stored meet was not in the cached list and had to be looked up by name first. |
| `native_tabs` | iOS 26+ `NativeTabs` (`lib/tab-bar-layout.ts`). |
| `platform` | `ios` or `android`. |
| `update_launch` | Running a downloaded OTA update rather than the embedded bundle. |
| `app_state_at_start`, `backgrounded` | Filter out background launches and launches put in the background before they settled. |
| `reported_at_ms` | When the event was built. |

All times are ms since `_layout.tsx` started evaluating; native launch and bundle load come before 0 and are not included.

To read it: in PostHog, build a trend on `startup_timing` with `complete = true`, `app_state_at_start = active` and `backgrounded` not `true`, and chart the median and p90 of `schedule_content_ms` (time to the schedule) and `splash_hidden_ms`, broken down by `platform`, `schedule_cache_hit` and `native_tabs`. Compare `splash_hide_reason` shares: a high `cap` share on warm starts (`schedule_cache_hit = true`) means the cache read is slower than the hold; `needed_meet_lookup = true` launches wait on the network before a meet can show.
