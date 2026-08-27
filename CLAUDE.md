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
