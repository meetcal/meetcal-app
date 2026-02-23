# Offline Mode Issue

## Base Issue (Data Scope)

Before the offline investigation, the initial problem was that **best columns** and **See all results** showed no data because the code was filtering results by the **current meet** instead of **history**.

- **Best columns** in `app/shared-screens/schedule-details.tsx` (via `SessionAthletes`) and `app/(tabs)/(start-list)/index.tsx` (via `AthleteItem`): These display an athlete's best snatch, C&J, and total. They must query results from **history** (past meets), not only the current meet.
- **See all results** button in `app/shared-screens/athlete-results.tsx`: The "See All Meet Results" button navigates to the athlete results screen. That screen must show the athlete's **full history** across all meets, not just results for the currently selected meet.

**Fix:** Query/check results from history (all past meets for the athlete), not scoped to the current meet.

**Affected files:**
- `app/shared-screens/schedule-details.tsx` — uses `SessionAthletes` which fetches bests via `getAthleteBestsBatch`
- `app/(tabs)/(start-list)/index.tsx` — uses `AthleteItem` which displays year bests via `preloadYearBests` / `getLastYearBests`
- `app/shared-screens/athlete-results.tsx` — "See All Meet Results" screen; must fetch all results by athlete name, not by meet

---

## Problem Summary

When `SIMULATE_OFFLINE: true` in `config/development.ts`, the app exhibits:

1. **Buttons/taps do not work** — User can scroll and change tabs, but no button presses register — **FIXED**
2. **Convex "received query results" log spam** — Messages like `received query results totaling 0MB which took more than 20s to arrive (1291550676ms)` flood the console
3. **Potential blocking** — Convex may block the JS thread when offline

## Environment

- Expo/React Native app with Convex, Clerk, RevenueCat
- `SIMULATE_OFFLINE: true` forces `isNetworkAvailableSync()` to return `false`
- iOS simulator (System Version 26.2)
- Uses FlashList, react-native-gesture-handler, NativeTabs on iOS 26+

## What We've Tried

### 1. Convex Logger Suppression

**Change:** Pass `{ logger: false }` to `ConvexReactClient` in `lib/convex.ts`

**Result:** Suppressed the "received query results" log spam. Did not fix button presses.

### 2. Custom WebSocket for Offline

**Change:** Pass custom `webSocketConstructor` to Convex that, when offline, connects to `ws://127.0.0.1:1` instead of Convex URL so connection fails immediately rather than hanging.

**Result:** Reduced Convex WebSocket retry behavior. Did not fix button presses.

### 3. requireAuth Null Handling

**Change:** 
- In `utils/authGuard.ts`: Only return `null` when `!isLoaded && cachedIsSignedIn === null` (use cached auth when available)
- In all callers: Change `if (authResult === null || authResult === false) return` to `if (authResult === false) return` so we don't block when auth cache is still loading

**Result:** Buttons that use requireAuth should no longer block on loading state. Did not fix the issue.

### 4. OfflineIndicator Touch Blocking

**Hypothesis:** `Animated.View` does not respect `pointerEvents="none"` on iOS, so the OfflineIndicator (which only appears when offline) was blocking touches.

**Change:** Wrapped the `Animated.View` in a regular `View` with `pointerEvents="none"` so the wrapper passes touches through.

**Result:** Did not fix button presses.

### 5. Custom Convex Fetch for Offline

**Change:** Custom fetch for `convexHttp` that rejects immediately with `"Offline: Convex request skipped"` when `!isNetworkAvailableSync()`.

**Result:** Convex HTTP requests skip when offline. Does not affect the WebSocket-based ConvexReactClient. Did not fix button presses.

### 6. Prefetch Error Handling

**Change:** In-flight deduplication for prefetch, softer logging for blob/server errors, `logPrefetchError` helper with rate limiting.

**Result:** Reduced console noise. Did not fix button presses.

### 7. OneSignal Ruled Out

**Change:** Commented out all OneSignal usage in `app/_layout.tsx` (import, initialize, requestPermission, login/logout useEffect).

**Result:** Same issue. OneSignal is not the cause of offline touch blocking.

### 8. ConvexHttpClient Reverted to ConvexReactClient

**Change:** Reverted all `convexHttp` (ConvexHttpClient) usage back to `convex` (ConvexReactClient) from c9087ff. Removed ConvexHttpClient from `lib/convex.ts`. Restored `convex.query` / `convex.mutation` in queries, meet-manager, athlete-results, attempt-estimator, athleteBests, start-list-api, fetch-*, notifications, useSavedSessions, weightlifting-wrapped.

**Result:** Revert attempted on HEAD; user reported still not working. Bisect confirms c9087ff is the breaking commit; Convex/data changes (convexHttp) are the likely cause.

## Current State

- Convex: Using ConvexReactClient only (convexHttp reverted)
- Convex WebSocket: Uses custom constructor that fails fast when offline
- Convex logging: Disabled via `logger: false`
- Auth guard: Proceeds when `requireAuth` returns `null` (loading)
- OfflineIndicator: Wrapped in `View` with `pointerEvents="none"`

**Buttons/taps now respond when offline.** (Previously blocked; root cause addressed.)

## Observations

- Works fine when online — component implementation is not the issue
- Scroll and tab switching work when offline — touch events reach ScrollView and tab bar
- Pressable/button taps do not fire when offline — something intercepts or prevents them
- OfflineIndicator only appears when offline — it was the prime suspect for touch blocking

### New: Delayed Recovery After ~Few Minutes

**Observation:** After staying offline for several minutes, the app "finally routed" — navigation to schedule-details succeeded and logs showed normal flow (loadMeetSnapshot, getMeetData completing).

**Confirmed:** The UI was visible the whole time — normal schedule screen with list of sessions. Not a blank/loading screen. So we're not stuck on `isUserLoaded` or any ready gate. The app is fully rendered; something is blocking touches specifically, and that block clears after a few minutes.

**Implication:** Some process or component has a long timeout/retry. When it completes (or times out) after several minutes, touch handling starts working. Possible causes:

1. **RevenueCat** — Multiple "Purchases instance already set" suggests duplicate React trees or providers mounting. One might overlay and block touches until it settles.
2. **Clerk / ConvexProviderWithClerk** — When offline, these may retry for minutes. When they finally give up, the render tree could change (e.g. a loading overlay unmounts) and touches start working.
3. **Convex WebSocket** — Long retry backoff; when it stops or changes state, something in the tree could update.
4. **NativeTabs** — iOS 26+ native tab implementation might have a touch-handling quirk that resolves after some internal timeout.

## Possible Remaining Causes

1. **Another overlay** — Something else we haven't identified that renders when offline
2. **Gesture handler conflict** — FlashList or GestureHandlerRootView behaving differently when offline
3. **NativeTabs (iOS 26+)** — Tab implementation may handle touches differently when offline
4. **Clerk/Convex provider** — When offline, Clerk or ConvexProviderWithClerk may render something that blocks
5. **SubscriptionContext** — Different state when offline could trigger different render tree
6. **RevenueCat** — Multiple "Purchases instance already set" suggests multiple mounts; could affect touch handling
7. **iOS / React Native bug** — Platform-specific behavior with `pointerEvents` or touch handling when network state changes

## Files Modified

- `lib/convex.ts` — logger: false, custom webSocketConstructor, custom fetch
- `lib/networkUtils.ts` — isOfflineModeSimulated integration
- `utils/authGuard.ts` — isLoaded check when cachedIsSignedIn is null
- `components/offline/OfflineIndicator.tsx` — View wrapper with pointerEvents none
- `components/start-list/AthleteItem.tsx` — authResult === false only
- `components/schedule-details/HeaderSection.tsx` — authResult === false only
- `components/schedule-details/SessionAthletes.tsx` — authResult === false only
- `components/profile/NotificationSettings.tsx` — authResult === false only
- `app/(tabs)/(start-list)/StartListContent.tsx` — authResult === false only
- `app/(tabs)/(saved)/index.tsx` — authResult === false only
- `lib/database/queries.ts` — offline skip handling
- `lib/database/meet-manager.ts` — prefetch deduplication, error handling
- `lib/debug.ts` — isOfflineSkipError, devLog, devTime, devBlocking

## Attempt Estimator Offline Issue

**What it does:** The attempt estimator predicts suggested attempt weights (openers, second attempts, etc.) using each athlete’s historical results — make rates, typical increases, averages across meets.

**Online flow:** Uses `getByNamesSince` (Convex) to load the last 2 years of results for all athletes in the session. This gives enough history to compute meaningful estimates.

**Offline flow:** Uses `getMeetLiftingResults(meetId)`, which is meet-scoped — it only returns results from that specific meet.

**Problem:** For upcoming meets there are no meet results yet, so `getMeetLiftingResults` returns nothing. The estimator then has no history and shows no estimates. Even for past meets, offline data is limited to that meet’s results instead of the full 2-year history used online, so estimates can be worse or missing.

**Edge case:** If the user opened the attempt estimator while online, `saveMeetLiftingResults` may have stored `getByNamesSince` data under the meet key. In that case, offline can work later, but it depends on user flow and is inconsistent.

**Fix (implemented):** When offline, use `getAllCachedLiftingResultsForAthlete` per athlete and filter by date (last 2 years) instead of `getMeetLiftingResults`, so offline estimates use the same history scope as online.

---

## Bisect Results (Post–PR #34 Merge)

Testing: `SIMULATE_OFFLINE: true` in `config/development.ts`. Each checkout: server shut down, `bun run ios` rerun.

| Commit | Message | Result |
|--------|---------|--------|
| `c82c520` | migrate to convex | OK — delay, presses route |
| `8ab7fbd` | tsc and react doctor fixes | OK — some JS blocking, presses route |
| `3af3e5b` | fixes | OK — same as above |
| `3987704` | fix | OK — same as above |
| **`c9087ff`** | **one signal** | **BROKEN** — offline: JS thread blocks taps |
| `49f28ec` | one signal | (not tested; app.config only) |

### c9087ff (one signal) — CONFIRMED BREAKING COMMIT

**Bisect results:** Commits c82c520 through 3987704 work (some delay/thread blocking, but presses route). c9087ff breaks offline: JS thread blocks taps for routing.

**1. OneSignal — RULED OUT**

- Commented out all OneSignal code; offline touch blocking persisted.

**2. Convex/data changes — LIKELY CAUSE**

c9087ff introduced ConvexHttpClient and switched all imperative data fetches from `convex.query` (WebSocket) to `convexHttp.query` (HTTP). When offline, ConvexHttpClient HTTP requests behave differently than ConvexReactClient WebSocket — likely causing the JS thread blocking.

**Changes in c9087ff (excluding OneSignal):**

| Category | Files | Change |
|----------|-------|--------|
| Convex client | `lib/convex.ts` | Added ConvexHttpClient |
| Data fetching | `lib/database/queries.ts` | convex → convexHttp (schedule, athletes, lifting results) |
| | `lib/database/meet-manager.ts` | convex → convexHttp (meets list, getByName), MEETS_LIST_CACHE_KEY v1→v4, utcOffset try/catch |
| | `lib/start-list-api.ts` | convex → convexHttp, getAthleteLiftingResults → getAllCachedLiftingResultsForAthlete, isNetworkAvailable check |
| | `components/schedule-details/athleteBests.ts` | convex → convexHttp, getAthleteLiftingResults → getAllCachedLiftingResultsForAthlete |
| | `app/shared-screens/athlete-results.tsx` | convex → convexHttp |
| | `app/shared-screens/attempt-estimator.tsx` | convex → convexHttp |
| | `app/comp-data/weightlifting-wrapped.tsx` | convex → convexHttp |
| | `lib/database/fetch-*.ts` (8 files) | convex → convexHttp |
| | `lib/notifications.ts` | convex → convexHttp, removed expoPushToken |
| | `hooks/useSavedSessions.ts` | convex → convexHttp |
| Offline store | `lib/database/offline-store.ts` | Added getAllCachedLiftingResultsForAthlete |
| Layout | `app/_layout.tsx` | Removed expo-notifications flow, early permission request, 1s delay |
| Utils | `utils/notifications.ts` | Removed registerForPushNotificationsAsync, updateExpoPushToken |
| Convex backend | `convex/meets.ts`, `pushNotifications.ts`, `notificationPreferences.ts`, `schema.ts` | OneSignal/push changes |

**Recommendation: Branch off 3987704, reapply OneSignal only**

- **Why:** 3987704 is verified working. OneSignal changes are isolated. The Convex/data changes (convexHttp, query switches) are the culprit.
- **Data-scope fix:** Add `getAllCachedLiftingResultsForAthlete` and the history-based bests/results logic as a separate commit on top, using `convex` not `convexHttp`.

**Alternative: Edit current HEAD** — Revert the Convex/data parts while keeping OneSignal. More error-prone (many files, risk of missing one). Branch-from-clean is safer.

---

### OneSignal changes to apply (from c9087ff + 49f28ec)

When branching from 3987704, apply only these changes. Use `convex` not `convexHttp` in `lib/notifications.ts`.

#### c9087ff

| File | Change |
|------|--------|
| `app.config.js` | Add `onesignal-expo-plugin` to plugins array with `{ mode: "production" }` |
| `app/_layout.tsx` | Replace expo-notifications with OneSignal: import OneSignal/LogLevel; remove `registerForPushNotificationsAsync`, `requestNotificationPermissions`, `* Notifications`; add `OneSignal.Debug.setLogLevel`, `OneSignal.initialize("184c93ff-546a-4db8-945c-203091782fc9")`, `OneSignal.Notifications.requestPermission(false)`; in prepare(), remove Android channel setup and hasCheckedNotifications flow; replace push registration useEffect with OneSignal.login(user.id), OneSignal.User.addEmail(email), OneSignal.logout() |
| `package.json` | Add `onesignal-expo-plugin: ^2.0.4`, `react-native-onesignal: ^5.3.1`; add `update:prod` script |
| `utils/notifications.ts` | Remove `registerForPushNotificationsAsync`, `updateExpoPushToken`; simplify `scheduleNotification`, `cancelNotification`; keep `scheduleNotification`, `cancelAllNotifications`, `getScheduledNotifications` |
| `lib/notifications.ts` | Remove `expoPushToken` from interface and `updateExpoPushToken`; update `getNotificationPreferences` and `toggleNotifications` to match new schema; **use `convex` not `convexHttp`** |
| `ios/MeetCal/MeetCal.entitlements` | Add `group.com.memohnsen.meetcal.onesignal` to application-groups; change `aps-environment` to `production` |
| `ios/Podfile` | Add OneSignalNotificationServiceExtension target with `OneSignalXCFramework` pod |
| `ios/MeetCal/Info.plist` | Formatting/order changes; update NSCalendarsUsageDescription string |
| `ios/MeetCal.xcodeproj/project.pbxproj` | Add OneSignalNotificationServiceExtension target, build phases, frameworks |
| `ios/OneSignalNotificationServiceExtension/NotificationService.h` | New file |
| `ios/OneSignalNotificationServiceExtension/NotificationService.m` | New file |
| `ios/OneSignalNotificationServiceExtension/OneSignalNotificationServiceExtension-Info.plist` | New file |
| `ios/OneSignalNotificationServiceExtension/OneSignalNotificationServiceExtension.entitlements` | New file |
| `convex/notificationPreferences.ts` | Rename `getAllEnabledTokens` → `getAllEnabledUserIds`; return userIds not tokens; remove `expoPushToken` from upsert |
| `convex/pushNotifications.ts` | Replace Expo push with OneSignal REST API; use `getAllEnabledUserIds`; target by external_id |
| `convex/schema.ts` | Remove `expoPushToken` from notification_preferences; add schema comment (do not add `by_status_and_start_date` — that is from meets changes) |

**Do NOT bring from c9087ff:** `convex/meets.ts` (listActive/deleteByName changes), `eas.json` (prebuildCommand, env), `lib/convex.ts`, any convex→convexHttp switches, `lib/database/*`, `hooks/useSavedSessions.ts`, `app/comp-data/weightlifting-wrapped.tsx`, etc.

#### 49f28ec

| File | Change |
|------|--------|
| `app.config.js` | Add `group.com.memohnsen.meetcal.onesignal` to entitlements `com.apple.security.application-groups` array |

**After applying:** `bun install`, `cd ios && pod install`, `npx expo prebuild --clean` (or full rebuild). Set `ONESIGNAL_APP_ID` and `ONESIGNAL_REST_API_KEY` in Convex environment variables for push to work.

## Debugging Suggestions (Historical — touch issue fixed)

1. ~~**Temporarily hide OfflineIndicator** when `SIMULATE_OFFLINE` — if buttons work, the indicator is still the cause~~
2. **Add onPressIn/onPressOut logs** to a Pressable — confirm whether touches reach the component at all
3. **Test with SIMULATE_OFFLINE: false** but actual airplane mode — rule out simulated vs real offline
4. **Test on Android** — see if issue is iOS-specific
5. **Test without NativeTabs** — force standard Tabs on iOS 26+ to rule out native tab implementation
6. **Inspect view hierarchy** — use React DevTools or Flipper to see what overlays the content when offline
