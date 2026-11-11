---
name: device-testing
description: Run a MeetCal app change on the iOS simulators and Android emulators and show it. Use for any change that affects app behavior, before the full gate; for checking a mobile fix live; or when asked for app screenshots.
---

# Device Testing

A change that affects app behavior is done when it has run on a device and, for a UI change, its screenshots are in your chat reply. Run it as soon as it runs, before `mise run check`, so the user can judge it early. Documentation-, tooling-, website- and CLI-only changes skip this; say so in the test plan.

## 1. Pick The Machine

The MacBook's iOS simulators come first: `ssh -o ConnectTimeout=5 maddisenmohnsen@macbook true`. When it answers, run iOS there. Android runs too, on this Linux machine's emulator or the MacBook's: finish-work's merge gate 7 needs both platforms whenever the change reaches both. iOS-only code (`targets/`, `widget/`, `plugins/ios-app-intents/`, iPhone Duo layout) needs the MacBook; when it is unreachable, say in your reply and the pull request that iOS is untested, and the merge gate for running live stays failed until iOS runs.

T3 Code's device tools see only this machine's devices. iOS on the MacBook is driven with Maestro over SSH ([GOTCHAS.md](GOTCHAS.md#macbook-ios)).

## 2. Get The Code There

- **MacBook:** the checkout is `~/dev/meetcal-llc/meetcal`. Push from here (`git fetch` from GitHub fails in an SSH session there): `git push maddisenmohnsen@macbook:dev/meetcal-llc/meetcal <commit>:refs/heads/<branch> origin/master:refs/remotes/origin/master`. Add a worktree from that branch, never switch the main checkout's branch, run `mise run setup`, and copy `.env` and `.env.local` from the main checkout without reading them. A branch checked out in a Mac worktree cannot be pushed to, so for a follow-up push a temporary ref and `git reset --hard` to it. Remove the worktree, branch and pushed refs when you are done.
- **Linux:** copy the main checkout's `.env` and `.env.local` into your worktree without reading them; without the client keys the app opens to a blank screen.

## 3. Run It

Every simulator, emulator and Metro port goes through [simgate](https://github.com/memohnsen/simgate) (AGENTS.md, [Simulator lock](../../../AGENTS.md#simulator-lock)). Atlas and t3code share it, so agents in every repository take turns.

- **JavaScript-only change:** reuse the installed dev client. `bun run start` claims a simulator that has a current build and opens the app on it against your Metro (`SIMGATE_DEVICE="<name>"` picks one). A native build (`bun run ios` / `bun run android`) is for native changes (`plugins/`, `targets/`, `widget/`, `app.config.js`, native dependencies) or a device with no MeetCal install, and never while another agent is building.
- Start Metro only through `bun run start` / `bun run ios` / `bun run android` / `mise run app:*`. Bare `expo start` or `expo run:*` skip the gate.
- When both slots are busy the command waits and starts by itself when one frees. Do something else meanwhile. Never kill another worktree's Metro.
- Maestro runs through `bun run maestro:test` or `bun run maestro:test:flow <flow>`, which start their own E2E Metro; stop yours first (`docs/maestro.md`).

## 4. Cover The Form Factors

An iOS check runs on iPhone Duo folded, iPhone Duo unfolded, and one regular iPhone, one at a time; shut down the ones you are not using. The Duo folds and unfolds only from Device Hub, so ask the user to switch it. The Duo build needs the iOS 27.1 SDK (`docs/iphone-duo.md`); built against an older SDK, the Duo letterboxes whatever the code does. Layout changes are judged at each width, never by orientation. An Android check runs on a phone emulator.

## 5. Show It

Screenshot each changed screen and state and embed the images in your reply as Markdown images with absolute paths: `xcrun simctl io <udid> screenshot --display=<n> <file>` on the MacBook (copied back with `scp`), or T3's `device_screenshot` on Linux. Drive the check yourself; open a Linux device in T3's device panel (`device_open`) so the user can watch.

## 6. Stop

Stop your Metro the moment the screenshots are taken, by port or PID (`lsof -nP -iTCP:<port> -sTCP:LISTEN`), and revert any local-only workaround. Close a Linux emulator you booted with `device_close` and `shutdown: true`. The step is done when `simgate status` shows no slot held by your worktree.
