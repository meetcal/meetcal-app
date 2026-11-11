# Device Testing Gotchas

What each platform does that its documentation does not say. Read the section for the machine you are on.

## MacBook iOS

- **Driving:** Maestro taps reach the app; `axe tap` reports success and never does. Run a flow on a given simulator with `scripts/mac-maestro.sh <udid> <flow.yaml> <local output dir>` from this skill, which copies the flow over, runs `~/.maestro/bin/maestro --device <udid> test` with its own output dir, and copies the screenshots back. A shared output dir means reading another agent's run.
- **Flows:** `openLink: meetcal:///<route>` navigates (`meetcal:///shared-screens/schedule-details`; `.maestro/` has more). Tap native toolbar buttons and tabs with `point: "x%,y%"`, whole numbers only (a decimal fails to parse, pointing at the next line). `takeScreenshot` names must start with a letter. A text assertion can miss a row whose text wraps; screenshot instead.
- **Auth:** the E2E switch (`EXPO_PUBLIC_MAESTRO_E2E=1`, set by `bun run maestro:test`) bypasses sign-in and the paywall in dev builds only. Checking a real auth or subscription path needs a signed-in dev account, not the switch.
- **iPhone Duo:** two displays; screenshot each with `xcrun simctl io <udid> screenshot --display=<n>` (`--display=1` is the folded screen). Never toggle its displays with `simctl io … screenConfig`, which crashes SpringBoard.
- **SSH:** the Mac's login shell is fish. Heredocs, `$(…)`, `^` and loops break or silently succeed, and `ssh` always exits 0, so put logic in a bash script, copy it over and run `ssh maddisenmohnsen@macbook 'bash /tmp/x.sh'`; wait on printed markers, not exit codes. Backgrounding Metro over SSH hangs the session: run it as a background job from here (`ssh … 'bash -lc "cd <worktree> && bun run start"'`).
- **Builds:** CocoaPods needs `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8`. Never run `mise run setup` or the gate in the worktree your Metro serves; the reinstall makes the app drop taps. No device (phone) builds over SSH: the Mac has no development signing identity there.
- **Simulator limits:** it cannot deliver real push notifications or complete RevenueCat purchases; say so and check those on a phone.

## Android On Linux

- **Device:** AVD `Medium_Phone_API_37.0`. `device_list`, then `device_open`, which boots it and returns the `agent-device` command; drive taps, text and screenshots only through that command.
- **Native build** (only when native code changed): never run Gradle and the emulator together on this machine; `./gradlew --stop` in `android/` afterwards frees several GB.
- **Shell:** the Bash tool's zsh does not word-split `$VAR`; put multi-flag commands in a bash script.
- **Memory:** watchman, left from Jest or Metro runs, can hold 2 GB; `watchman shutdown-server` frees it once no Metro is running.

## Shared Dev Backend

A change that adds or changes Convex functions needs them on the dev deployment (`dev:utmost-retriever-826`) before the app can call them. Push with an env file holding only that `CONVEX_DEPLOYMENT`, never the repository's `.env*` files: `bunx convex dev --once --env-file <env> --typecheck disable --codegen disable`. Other sessions push their branches to the same deployment, so confirm your functions are live (`bunx convex function-spec --env-file <env>`) right before driving the app, and push `origin/master` back from a clean detached worktree when you are done.
