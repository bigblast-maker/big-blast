# Big Blast — Project Context

Read this before touching anything. It captures decisions and hard-won bug
knowledge from prior work, so you don't rediscover them the slow way.

## What this is

A Block Blast-style 8×8 grid puzzle game. **One single HTML file**, ~6,600
lines (69% JS, 23% CSS, 8% HTML). No build step, no dependencies, no network
calls. Destined to be wrapped with Capacitor and published to Google Play.

## Files

```
big-blast.html              the entire game — this IS the project
bigblast-test-suite.js      Playwright regression suite, run before shipping
privacy-policy.html         legal page, needs hosting (placeholders to fill)
terms-of-service.html       same
store-assets/               icon, feature graphic, screenshots, listing copy
bigblast-android-setup/     Capacitor scaffold (www/, capacitor.config.json)
```

## Non-negotiable constraints

- **Single file.** All JS/CSS/HTML stays in `big-blast.html`. This makes
  Capacitor wrapping trivial and keeps zero build tooling. Do not split it
  into modules without an explicit decision to take on a build step.
- **Zero network calls.** No fetch, no XHR, no CDN links, no Google Fonts, no
  analytics. This is what makes the privacy story ("collects nothing") true
  and the Data Safety declaration simple. Adding *any* network call breaks
  that and requires updating both legal pages.
- **Must work offline.** It's a Capacitor app. Anything loaded over the
  network will silently fail on a plane.

## Workflow that actually works here

0. **It's a git repo now** (`master`, baseline commit `f53ce44`). Branch for
   anything substantial. This is the undo that the "work on a copy" rule below
   was standing in for.
1. Work on a copy, validate, *then* overwrite the real file.
2. **Always validate after edits:**
   - brace/paren balance across the file AND within `<style>` alone
   - duplicate HTML IDs
   - every `getElementById` target exists
   - every `data-icon` name exists in `ICON_SVGS`
   - `node --check` on the extracted `<script>` contents
3. **Screenshot to verify visuals.** DOM checks alone have repeatedly missed
   real bugs (see below). If it's a visual change, look at it.
4. Run `node bigblast-test-suite.js --runs 1 --max-placements 20` before
   calling anything done. Expect `9/9 overlays` and no JS errors. Needs
   `npm install playwright && npx playwright install chromium` once.
5. To preview, serve over http — `file://` loads it as a static snapshot in
   some viewers and the JS never runs, so it hangs on the splash screen.
   `.claude/launch.json` has a `big-blast` server config on port 4173.

## Bug classes that have bitten us before

**Negative z-index gets swallowed.** `#ambientBg` at `z-index:-2` was
invisible for weeks — the app's own stacking context painted over it. Every
theme's falling particles never rendered. Fix was a low positive z-index. Same
class of bug hit the Singularity and Supernova WebGL canvases; those needed
`body { background: transparent }` for those themes. **If something should be
visible and isn't, suspect stacking before anything else.**

**DOM-correct ≠ visually correct.** The particle bug survived because
verification checked "are the right elements in the DOM" instead of "can a
human see them." Screenshot.

**iOS Safari auto-zoom.** Any input under 16px font-size triggers a zoom on
focus, and `user-scalable=no` in the viewport meta means there's no gesture to
zoom back out. All inputs must be ≥16px.

**Overlays hide clipping.** A responsive audit of the menu/game screens came
back clean while the Daily Rewards overlay clipped at every width. Overlays
are only measurable while open — test them explicitly.

**Ambient particles pollute overflow audits.** They intentionally start below
the fold and drift up. Filter `#ambientBg` out of any overflow detection or
you'll get ~30 false positives.

**Test-harness bugs masquerade as game bugs.** Playwright's `page.$()` returns
hidden elements, so force-clicking "until the button is gone" can click
through to whatever is underneath. Check `.classList.contains('show')`
instead. Several "failures" have been the harness, not the game.

**Icons that look fine at 40px can read as a completely different symbol at
14px.** The `bomb` icon in `ICON_SVGS` — a circle with a diagonal fuse and a
two-line spark — was checked on a contact sheet at 28–64px and looked like a
bomb. In an actual reward chip at ~14px (only found by running on a real
device, not headless Chromium) it read unambiguously as the Mars symbol (♂):
the spark detail was too fine to survive the scale-down, leaving just
circle+diagonal-line, which *is* that symbol. Fixed by making the fuse
vertical instead of diagonal — no diagonal line means no arrow for the eye to
find. **Check any new small icon at the actual size it ships at, not just on
a big contact sheet — a shape that reads as intended at 40px can collide with
an unrelated real-world symbol once shrunk.**

## Architecture notes

- `trayPieces` is a 3-slot nullable array. `slotIndex` conventions:
  `>= 0` tray, `-1` inventory piece, `-2` the hold slot.
- **Solvability guarantee:** every dealt tray is verified placeable in *some*
  order via backtracking, retried up to 8 times. Unsolvable rate went from
  ~2% to ~0.013%. This is a genuine differentiator — don't regress it.
- The hold slot persists across tray refills and **counts as a legal move in
  the game-over check**. Forgetting that strands a playable piece.
- Rank thresholds were calibrated by simulation, not intuition.
- `SCORE_PERCENTILE_CURVE` is modelled, not real player data. The UI says
  "estimated" for that reason. If real telemetry ever exists, rebuild it.

## Design system (established, follow it)

A prior pass over-corrected against "looks AI-generated" by stripping color,
gradients, emoji and exclamation marks down to almost nothing, and it made the
game read as a flat SaaS dashboard instead of a puzzle game — bland, not
tasteful. Real hits in this exact genre (Block Blast!, Woodoku, Candy Crush)
are colorful, glossy, and loud at the right moments. The actual AI tell was
never "color" or "excitement" — it's **decoration with no reason behind it**:
an arbitrary rainbow gradient on a settings toggle, emoji standing in for an
icon nobody drew, exclamation marks on mundane copy. Purposeful color and
excitement are the genre norm and are back.

- **Palette:** slate base (`--bg2:#0d1117`, `--panel:#212a38`), amber as the
  one **brand/CTA** color (`--accent:#f0913a` — Play, primary actions). But
  `--gold`, `--pink`, `--cyan`, `--green`, `--red` are genuine distinct hues
  used *with meaning*: gold/pink for celebration text, cyan for currency,
  green for "on"/success, red for danger. Don't collapse these back to one
  color — that's the mistake that made everything look flat last time.
- **Gradients:** fine, even encouraged, in two specific forms — (1) a lighter
  tint of an element's *own* color for a glossy highlight (the classic "candy
  button" sheen — see `.btn`'s white-to-transparent overlay), and (2) a
  same-purpose multi-hue sweep on *celebration* text specifically (milestone
  banner, perfect-clear, rank-up, legendary/godlike streak titles all use a
  gold→pink→cyan text-clip gradient, some animated). What to still avoid: an
  arbitrary multi-hue gradient on ordinary chrome (a settings row, a card
  background) that has no reason to be there.
- **Radii:** `--r-sm:9px / --r-md:16px / --r-lg:22px / --r-pill`. Chunkier
  than a typical UI kit on purpose — matches the genre.
- **Font:** `--font-display` (`ui-rounded` → Apple's SF Rounded, zero network,
  graceful fallback to system-ui elsewhere) on headline elements — the
  wordmark, `#score`, modal `h2`, streak titles, rank-up title. Body copy
  stays on the plain system stack for readability.
- **Icons:** inline SVG via `ICON_SVGS` + `renderIcons()`, 39 icons in one
  24×24 stroke style, used for *functional* chrome (nav, settings, mode
  picker). Emoji are back for *flavor and celebration* — theme names, streak
  titles, milestone/perfect-clear banners, combo-lost, tutorial slides, plus
  all falling/ambient game content (🎃🦇) and the rank-up rain. The line: an
  icon a player *acts on* is SVG; a moment being *celebrated* can be emoji.
  `ICON_SVGS` lives at the **top** of the script IIFE because it's a `const`
  and start-up code calls `iconMarkup()` — moving it down reintroduces a
  temporal-dead-zone crash that hangs the splash screen.
  `iconMarkup()` output carries its own `.icoSvg` sizing class, so it can be
  dropped into any container; an unclassed inline `<svg>` blows up to 300×150.
- **Motion:** a button press is a single settle, not a wobble — that part of
  the earlier calm-down pass was correct and stays. Shake is reserved for
  where the shake *is* the information (board shake on clear, tension effect,
  the combo-risk counter shaking as a miss-streak climbs).
- **Copy:** exclamation marks and a little shout are earned on genuine
  celebration/warning moments (a streak title, "RANK UP!", "Combo at risk!")
  and wrong on mundane chrome (settings labels, shop descriptions stay
  sentence-case, no exclamation). The tell was never punctuation — it was
  using celebration-register language on things that aren't celebrations.
- **First-time explainers:** any new visual language a first-time player
  hasn't seen before (a shake, a color shift, an escalating effect) gets a
  one-time toast the first time it happens, gated by its own
  `localStorage.getItem('blastgrid_seen_*')` flag — see `showOnceToast()`.
  Board tension and combo-risk both use this; it's the pattern to follow for
  the next one, rather than assuming a first-time player will infer meaning
  from an animation alone.

## Ergonomics

Menu nav sits at the *bottom* (thumb zone, ~93% down). In-game Settings/Home
stay at the *top* on purpose — they're rare, destructive actions and you don't
want them near where the thumb drags pieces.

## State of play

Done: gameplay, 7 modes, hold slot, 23 themes, ranks, economy, achievements,
challenges, stats, score history, reduced-motion, SVG icons, responsive audit
(7 sizes clean), legal pages, store assets, native Android project (builds
successfully), real AdMob wiring (test IDs — see below).

Not done / known open:
- **Run on an Android emulator for the first time, not yet a physical phone.**
  A Pixel 6 / API 34 AVD (`BigBlastTest`) confirmed the app installs, boots,
  and plays correctly — menu, mode picker, tutorial, live board, all
  rendering right, no JS errors in logcat. Needed Windows Hypervisor Platform
  enabled (`Enable-WindowsOptionalFeature -Online -FeatureName
  HypervisorPlatform -All`, admin + restart) before the emulator could use
  hardware acceleration. Real hardware — different GPU, different WebView
  build, touch instead of a mouse — is still meaningfully untested.
- WebGL themes (Singularity/Supernova) run at ~half the frame rate of the rest
  of the game even after halving shader resolution. Unverified on real GPUs.
- **AdMob is wired and confirmed working end-to-end on-device** — connected
  Chrome DevTools directly to the running WebView (`adb forward` to the
  `webview_devtools_remote_<pid>` socket) and triggered the real rewarded-ad
  button; a genuine "Test Ad" video played, reward granted, cleanly dismissed.
  Caught one real bug this way: `AdMob.addListener(...).then(...)` threw
  `TypeError: ... .then is not a function` — the raw `Capacitor.Plugins.AdMob`
  bridge (no npm wrapper, since this project has no bundler) doesn't return a
  real thenable from `addListener()` the way the TS types imply, and the
  failure was silently leaking listener handles (cleanup depended on a handle
  the crashed `.then()` never assigned). Fixed by using `await` uniformly
  instead of `.then()`/`.catch()` chaining, which handles both a real promise
  and a plain return value safely. Still running Google's public test ad unit
  IDs, not real ones — see
  `bigblast-android-setup/bigblast-android/SETUP_INSTRUCTIONS.md` for the
  exact swap-in steps before a real release. EEA/UK consent (Google's UMP
  SDK) is explicitly not implemented yet — required before serving ads to
  EU/UK users for real, not needed for test ads.
- **privacy-policy.html still says there's no advertising.** This is now
  false the moment real (non-test) ads go live and must be rewritten before
  that — Google checks Play Console's Data Safety declaration against actual
  app behavior.
- Real in-app purchases (Remove Ads, gem packs) are still fully simulated
  (`simulatePayment()`) — a separate integration from AdMob, not done.
- Dev console (tap title 7×) ships in the build. Decide deliberately.
- Open design question: 23 themes may be breadth substituting for a point of
  view. Fewer, stronger themes might read as more authored.
- Game-over screen is functional but not memorable (peak-end rule).

## Building the Android app

The native project already exists and is committed:
`bigblast-android-setup/bigblast-android/android/`. To rebuild after changing
big-blast.html:
```bash
cp big-blast.html bigblast-android-setup/bigblast-android/www/index.html
cd bigblast-android-setup/bigblast-android
npx cap sync android
cd android && ./gradlew assembleDebug
```
**Gradle needs `JAVA_HOME` pointed at a real JDK 17** — a JDK 17 got installed
at `C:\Users\pleye\.jdks\jdk-17.0.20.1+1` for this. Do **not** point it at
Android Studio's own bundled JBR (`Android Studio\jbr`) — as of Android
Studio's late-2025+ releases that's JDK 25, and Gradle 8.2.1 (what Capacitor 6
templates ship with) crashes on it with an opaque
`Unsupported class file major version 69` error. The tempting fix — bumping
Gradle/AGP to versions that run on JDK 25 — cascades into
`@capacitor-community/admob@6.2.0`'s own Android build script using Gradle
APIs removed entirely in Gradle 9, which only gets fixed by AdMob 8.x, which
needs Capacitor 8. Pointing `JAVA_HOME` at a JDK 17 instead is a five-minute
fix; the version-bump path is a multi-hour migration. Don't relitigate this
without a real reason to.

## Next steps

1. ~~Get this running on a real device~~ — done, on a Pixel 6 / API 34
   emulator. A physical phone (different GPU, real WebView build, touch
   instead of mouse) is still untested.
2. ~~Generate the signing keystore~~ — done, see SETUP_INSTRUCTIONS.md for
   location/fingerprints. **Confirm it's actually backed up somewhere off
   this machine** — that part only the user can do.
3. ~~Fill legal page placeholders, rewrite ads claims~~ — done. Publisher is
   "Bezaz Games", contact is `contact.bigblast@gmail.com` (make sure that
   inbox actually gets created — it didn't exist as of this writing), governing
   law is Hungary. **Still need to host these pages somewhere with a public
   URL** and put that URL in Play Console — not done yet.
4. Swap AdMob's test IDs for real ones (see SETUP_INSTRUCTIONS.md) once ready
   to earn real revenue, and add UMP consent for EEA/UK before launching there.
5. Retake the store-assets screenshots — the current ones predate the recent
   design pass.
6. Real Play Billing integration (Remove Ads, gem packs) — still fully
   simulated, a separate task from AdMob.
