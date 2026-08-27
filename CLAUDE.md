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

- **Palette:** neutral slate (`--bg2:#0d1117`, `--panel:#212a38`,
  `--line:#323d4d`), single amber accent `--accent:#f0913a`. Deliberately not
  purple — purple gradients read as AI-generated.
- **Principle:** the UI recedes so the game blocks are the only saturated
  thing on screen. PLAY is the only solid-amber element.
- **Type scale:** `--fs-xs` through `--fs-5xl`. No raw rem font sizes.
- **Radii:** `--r-sm/md/lg` only.
- **Icons:** inline SVG via `ICON_SVGS` + `renderIcons()`, 39 icons in one
  24×24 stroke style. Emoji render as different artwork per device, so chrome
  uses SVG — this is now actually enforced, not just aspirational. Emoji in
  *game content* (falling 🎃🦇, block glyphs, the rank-up rain) is fine and
  intentional; that's the only place any emoji survive.
  `ICON_SVGS` lives at the **top** of the script IIFE because it's a `const`
  and start-up code calls `iconMarkup()` — moving it down reintroduces a
  temporal-dead-zone crash that hangs the splash screen.
  `iconMarkup()` output carries its own `.icoSvg` sizing class, so it can be
  dropped into any container; an unclassed inline `<svg>` blows up to 300×150.
- Solid fills and 1px borders. No glassmorphism, no decorative glow.
- **Motion:** a press is a single settle, not a wobble. Shake is reserved for
  where the shake *is* the information (board shake on clear, tension effect).
- **Copy:** no exclamation marks, no `— em-dash explainer` clauses, no
  staccato three-word taglines, sentence case for labels. Those are the
  loudest tells that a machine wrote the interface.

## Ergonomics

Menu nav sits at the *bottom* (thumb zone, ~93% down). In-game Settings/Home
stay at the *top* on purpose — they're rare, destructive actions and you don't
want them near where the thumb drags pieces.

## State of play

Done: gameplay, 7 modes, hold slot, 23 themes, ranks, economy, achievements,
challenges, stats, score history, reduced-motion, SVG icons, responsive audit
(7 sizes clean), legal pages, store assets.

Not done / known open:
- **Never tested on a real device.** All verification is headless Chromium.
- WebGL themes (Singularity/Supernova) run at ~half the frame rate of the rest
  of the game even after halving shader resolution. Unverified on real GPUs.
- Ads are a placeholder (`adSimOverlay`), no real SDK. Adding AdMob changes
  the privacy/Data Safety story completely.
- Dev console (tap title 7×) ships in the build. Decide deliberately.
- Open design question: 23 themes may be breadth substituting for a point of
  view. Fewer, stronger themes might read as more authored.
- Game-over screen is functional but not memorable (peak-end rule).

## Next steps

1. `npm install && npx cap add android && npx cap sync android`
2. Set the package ID in `capacitor.config.json` — **permanent after first
   publish**.
3. Generate the signing keystore and **back it up**. Losing it means never
   updating the app under the same listing again.
4. Fill placeholders in the legal pages, host them, put the URL in Play
   Console.
5. Real-device testing.
