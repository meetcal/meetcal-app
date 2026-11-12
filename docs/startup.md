# Cold start

What happens between the JS bundle starting and the Schedule tab showing the selected meet's sessions, and how to measure it.

## The path

1. `src/app/_layout.tsx` module scope: `lib/startup-timing.ts` is imported first and its clock starts (0 ms in every mark below). Sentry, NetInfo, RevenueCat (`Purchases.configure`, which returns nothing) and OneSignal are set up synchronously here, before any component runs, because providers below call them from effects and child effects run before a parent's. Right after `OneSignal.initialize`, and again after every `OneSignal.login` and `OneSignal.logout`, the app tags the current OneSignal user `app_meetcal=true` (`utils/oneSignalAppTag.ts`). Atlas shares this OneSignal app and Clerk instance and tags its users `app_atlas`, `atlas_coach` and `atlas_athlete` from its own backend, so emails can target either app's users; neither app ever removes the other's tags (Atlas `docs/email-audiences.md`). The splash cap is armed here too (see below).
2. The root renders on its first pass. Nothing gates it: no font load, no awaited SDK setup.
3. `SelectedMeetProvider`'s first `loadMeets` reads the meets list cache, `@selected_meet` and `@selected_meet_details` together. As soon as the stored meet's name is read, both of its schedule reads start: the offline copy (`primeScheduleCache` in `lib/database/schedule-resource.ts`), so the Schedule tab's first cache read finds it ready instead of starting a second disk read after the meets list has painted, and the network read (`primeScheduleFetch`, a `scheduleResource` revalidation), so on a fresh install or a cold cache the schedule request goes out with the meets list and the by-name lookup instead of after them. The tab's own revalidation joins that request while it is in flight, and the warm-up's `fetchSchedule` joins it in `getRevalidated`, so a launch sends one schedule request. A primed read is used only while no write to that meet was queued or landed since it started (`getMeetWriteGeneration`), and for at most `SCHEDULE_PRIME_TTL_MS`. A network answer published meanwhile still wins in `useMutableResource`.
4. The chosen meet is warmed (`warmMeetData`): its schedule is fetched at once; its roster (`meets:athletesSessions`, about 0.5 MB, plus `saveMeetAthletes`) waits for the first screen plus `ROSTER_PREFETCH_AFTER_FIRST_SCREEN_MS`, and never longer than `ROSTER_PREFETCH_MAX_DEFER_MS` (`lib/database/meet-manager.ts`). A forced sync releases it at once. A roster the Start List stored meanwhile is not downloaded again, and one cleared meanwhile (Clear Cache, a delete) is not written back. The roster is read with the tag stored next to it (`getMeetAthletesTag`, tied to the bundle that stored it and gone with the meet's data), so an unchanged roster costs a bodiless answer instead of the whole roster; the Start List revalidates the same way. A meet the user picks is never deferred.
5. API requests send the server clock sample alongside, and do not wait for it (`request()` in `lib/api/meetcal-api.ts`; the sampler is `lib/api/server-clock.ts`). Until it lands, `getTrustedNow()` is null; callers already skip or fall back. Decisions that can delete or forget something wait for it, bounded by `SERVER_CLOCK_DECISION_GRACE_MS` (`awaitServerClock`): the expiry sweep after a meets refresh (`loadMeets` and `refreshAvailableMeets`), Clear Cache's choice of which ended downloads not to bring back, and whether a stored meet that left the list is over (which forgets the selection). For that last one only the forgetting waits: the by-name lookup (`lookUpMeetForLaunch` in `contexts/SelectedMeetContext.tsx`) opens the meet as soon as it answers when the clock at hand says the meet is not over, and waits for a sample only when that clock says it is. Choosing which listed meet to open on a cold cache only picks a screen and reads whichever clock is there (`launchNow`).

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
| `device_model` | `expo-device`'s model id (`iPhone12,8`), or its model name where there is no id (Android). |
| `device_memory_mb` | The device's total memory in MB (`expo-device`'s `totalMemory`). |
| `network_type` | NetInfo's connection when the launch started: `wifi`, `cellular-4g` (`cellular` with no generation reported), `none`, `unknown` or NetInfo's other types. |
| `reported_at_ms` | When the event was built. |

All times are ms since `_layout.tsx` started evaluating; native launch and bundle load come before 0 and are not included.

To read it: in PostHog, build a trend on `startup_timing` with `complete = true`, `app_state_at_start = active` and `backgrounded` not `true`, and chart the median and p90 of `schedule_content_ms` (time to the schedule) and `splash_hidden_ms`, broken down by `platform`, `schedule_cache_hit` and `native_tabs`. Compare `splash_hide_reason` shares: a high `cap` share on warm starts (`schedule_cache_hit = true`) means the cache read is slower than the hold; `needed_meet_lookup = true` launches wait on the network before a meet can show. Break `schedule_content_ms` down by `network_type`, and filter on `device_memory_mb` to see the oldest phones (3 GB and under).

## The `screen_timing` event

One PostHog event per sampled screen visit: a visit is sampled with probability `SCREEN_TIMING_SAMPLE_RATE` (10 %) when the screen mounts (`lib/screen-timing.ts`). It is sent once the screen's data arrives from the network, when its load fails, or, with `complete: false`, when the user leaves first. The reference screens report through `useMutableResource`'s `screen` option; Athlete Results through `useScreenTiming`. Development builds log it as `[perf] screen timing`.

| Property | Meaning |
|---|---|
| `screen` | The route, as `comp-data/` names it (`records`, `wso-records`, `club-results/clubs-list`, `athlete-results`). |
| `time_to_first_content_ms` | Mount to the first rows on screen, cached or fresh. |
| `time_to_data_ms` | Mount to the network's answer; null if it never came. |
| `round_trips` | API requests the app sent between the mount and the answer (every request, so a background read in that window counts too). |
| `cache_hit` | The first rows came from the offline copy. |
| `failed` | The load failed with nothing on screen. |
| `complete` | The answer arrived, or the load failed, before the user left. |
| `platform`, `device_model`, `device_memory_mb`, `network_type` | As on `startup_timing`, read when the event is sent. |

To read it: chart the median and p90 of `time_to_data_ms` by `screen`, broken down by `network_type`, with `cache_hit = false` for first visits. A screen whose `round_trips` sits at 2 or more on first visits chains its requests.

## Network policy

Every request times out only when nothing has arrived for `REQUEST_INACTIVITY_TIMEOUT_MS` (10 s): headers, upload progress and every downloaded chunk reset the timer (`lib/api/progress-fetch.ts`, `lib/api/network-policy.ts`), so a large download on a slow link keeps going while bytes arrive. Queries retry a network failure, a timeout or a busy answer (408, 429, 502-504) up to `READ_MAX_ATTEMPTS` (3) times, `READ_RETRY_BASE_DELAY_MS` doubling to `READ_RETRY_MAX_DELAY_MS`, jittered, and fail at once while NetInfo says the device is offline; writes never retry (the outbox does). `useMutableResource` and `useRetryOnReconnect` ask again when the connection comes back. A screen with nothing to show says Waiting for Connection after `WAITING_FOR_CONNECTION_AFTER_MS` (3 s) (`LoadingLabel`, `useWaitingForConnection`); its error and Try Again appear once the retries are spent or the device is offline.
