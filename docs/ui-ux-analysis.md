# MeetCal UI/UX Analysis & Experience Roadmap

*July 2026*

MeetCal wins on usefulness: schedules, start lists, athlete history, offline-first reliability. This analysis identifies where the app can become more catching and experiential **without trading away any usability**. The guiding rule for every item below: motion and beauty only where they carry meaning — never decoration for its own sake.

**One-line strategy:** extend the proven motion language of Weightlifting Wrapped to the rest of the app, and make competition day feel like the hero experience it already is functionally.

---

## 1. Current-state audit

### What's strong
- **Color theming is fully centralized** (`constants/Colors.ts` + `hooks/useAppColors.ts`), with complete light/dark coverage and semantic keys (success, fail, gold/silver/bronze, platform colors).
- **Weightlifting Wrapped** (`app/comp-data/weightlifting-wrapped.tsx`) proves the app can do delight well: Reanimated springs, animated counters, gradients, staged reveals, shareable output.
- The **filter subsystem** (`components/ui/filters/`) and **session sort controls** are genuinely polished, with proper iOS/Android platform splits.
- Offline-first architecture, home-screen widgets on both platforms, and a working share pipeline (`react-native-view-shot` → `ImagePreviewModal`).

### Where the experience is utilitarian
| Gap | Evidence |
|---|---|
| No spacing/typography/radius/shadow tokens | Inline literals (`padding: 16`, `borderRadius: 12`) duplicated across ~35 screens; identical shadow blocks copy-pasted in at least 3 components |
| No shared primitives | No `Button`, `Card`, `EmptyState`, or toast — every screen re-implements `TouchableOpacity` buttons and hand-rolled empty text |
| Feedback is blocking | ~12 `Alert.alert` sites used for transient success/error notices that interrupt the user |
| Motion is absent outside Wrapped | Reanimated 4 is installed but used in exactly one screen; tab transitions are `animation: "none"`; list expansion, saves, and page changes are instant cuts |
| Haptics barely used | Only tab presses (`HapticTab`) and two save actions (`HeaderSection`) — filters, saves, calendar adds, shares are all silent |
| Loading states fragmented | Two bespoke skeletons with duplicated pulse logic + ~40 raw `ActivityIndicator`s |
| Installed-but-unused polish deps | `expo-blur` and `expo-glass-effect` ship in the binary and are never rendered; `expo-linear-gradient` appears only in Wrapped |
| Empty states are dead ends | Plain text ("No saved sessions") with no next step offered |

### Small flags found during the audit
- `app/shared-screens/paywall.tsx:41` hardcodes the RevenueCat offering id `"new image test"` — likely a leftover experiment name now acting as the production selector.
- PostHog has no `session_saved` event — the app's single most important engagement action is uninstrumented.

---

## 2. Tier 1 — Foundation polish (high value, low risk)

1. **Design tokens + shared primitives.** `constants/Layout.ts` (spacing/radius/shadow/type scale codifying the app's existing de-facto conventions) and `components/ui/` primitives: `Button`, `Card`, `EmptyState`, `Skeleton`. Consolidates the two bespoke skeletons and gives future screens a consistent starting point.
2. **Unified toast.** A Reanimated top banner (modeled on `OfflineIndicator`'s positioning) with success/error/info types, paired haptics, auto-dismiss. Replaces the blocking `Alert.alert` for transient notices — e.g. saving a session shows "Saved · reminder 1hr before" without interrupting flow. Destructive confirmations stay as alerts.
3. **Haptics at moments of meaning.** Save/unsave, filter apply, add-to-calendar success, share complete. Light impacts only, matching the existing `HapticTab`/`HeaderSection` idioms. Never on scroll.
4. **Micro-motion.** Bookmark bounce on save, pressed-scale springs on session cards, a layout transition for the expanding start-list `AthleteItem`, animated `PageIndicator` dots, skeleton→content crossfade. Each of these confirms an action or explains a state change — none are decorative.
5. **Empty states with a next step.** "No saved sessions" becomes logo + "Save sessions from the schedule to see them here" + a *Browse Schedule* button. Same pattern for start-list no-results and schedule no-data.

## 3. Tier 2 — Competition day & data storytelling

6. **Countdown to your session.** On meet day, a pinned card on the Schedule and Saved screens: *"Session 4 · weigh-in 8:00 AM · starts in 2h 14m."* All the timing math already exists (`calculateWeighInTime`, the reminder scheduler in `useSavedSessions`). This is the single most useful-plus-experiential item in the roadmap.
7. **Athlete results, visualized.** The data is already computed — this is purely presentational: attempt dots (green/red/—) per meet, success-rate rings with animated counters, PR highlight rows. Turns a wall of numbers into something a coach can read at a glance.
8. **Material surfaces, platform-split.** `expo-glass-effect` (GlassView) on **iOS**, `BlurView` on **Android** — applied to the meet-selection pill, filter modals, and the start-list ActionModal, following the codebase's established `.ios.tsx` platform-split idiom. Both dependencies already ship in the binary.

**Explicitly excluded (owner decision):**
- No "happening now"/LIVE schedule treatment.
- No motion added to the Attempt Estimator — its speed as a coaching tool is the feature.

## 4. Tier 3 — Meet Badges (ON HOLD)

Recorded as a future direction only, not a current recommendation:
- A collectible badge for **national meets only** — earned when a user has saved sessions at a national meet during its date window (both signals already exist client-side). Rendered in Wrapped's visual language, shareable through the existing view-shot pipeline, AsyncStorage-first storage mirroring the saved-sessions pattern.
- Deliberately scarce and earnest: attendance-based only, no streaks, no guilt mechanics.

## 5. Anti-recommendations

To protect "usefulness #1", explicitly avoid:
- Heavy screen-transition animations (slows navigation in a tool people use ringside).
- Any animation on `FlashList` row render paths (start list performance is load-bearing).
- Lottie/splash-screen bloat.
- Gamifying core navigation or paywalling delight.
- Confetti and celebration overuse — save it for genuine moments (a PR in athlete history, maybe).
- Dark-pattern engagement mechanics (streak shame, FOMO badges).

## 6. Sequencing & measurement

Order: Tier 1 (tokens → toast → haptics/motion/empty states) → countdown card → athlete-results visuals → material surfaces. Tier 3 stays on hold.

Instrumentation to add alongside: `session_saved`, `toast_shown` — so the impact of this work is measurable in PostHog rather than assumed.
