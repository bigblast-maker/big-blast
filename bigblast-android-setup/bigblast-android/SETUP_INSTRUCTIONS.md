# Big Blast — Android Build Setup

Written when this project was still on Claude.ai without shell access — that
part is now stale, since Claude Code *can* run these commands directly (and
has). Kept for the one-time machine setup steps below, which are still real.

## What you need installed first (one-time)

1. **Node.js** (v18+) — you likely already have this.
2. **Android Studio** — https://developer.android.com/studio
   Run it once after installing so it downloads the Android SDK.
3. **A JDK 17** to actually run Gradle — **not** Android Studio's own bundled
   JBR. As of Android Studio's late-2025+ releases that JBR is JDK 25, and
   this project's Gradle 8.2.1 (the version Capacitor 6 templates ship with)
   flat out cannot run on it — it crashes with an obscure
   `Unsupported class file major version 69` error deep in a settings script,
   not a helpful "wrong Java version" message. Confirmed on this machine: a
   real Eclipse Temurin JDK 17 install fixed it immediately, no other changes
   needed. (The alternative — bumping Gradle/AGP to versions that run on
   JDK 25 — cascades into `@capacitor-community/admob@6.2.0`'s own Android
   build script using Gradle APIs fully removed in Gradle 9, which only gets
   fixed by AdMob 8.x, which requires Capacitor 8. Getting one small version
   number right is much less work than that migration.)
   Point `JAVA_HOME` at the JDK 17 install (not Android Studio's JBR) before
   running any `./gradlew` command in this project.
4. That's it — no Mac needed for Android specifically.

## Setup — already done

`npm install`, `npx cap add android`, and `npx cap sync android` have already
been run — the `android/` folder in this directory is real, committed, and
builds successfully (confirmed: `./gradlew assembleDebug` → `BUILD SUCCESSFUL`
with JDK 17 as `JAVA_HOME`). If you ever need to regenerate it from scratch
(e.g. a corrupted checkout), those three commands in order are still correct.

`www/index.html` is a synced copy of the root `big-blast.html` — that file
stays the single source of truth. Re-run `cp ../../../big-blast.html www/index.html
&& npx cap sync android` (from this directory) any time the root file changes
and you want the native app to reflect it.

## Before you build — decided / still to decide

**1. The package/app ID: `com.bezaz.bigblast`, confirmed and locked in.** This
is now baked into `capacitor.config.json`, the generated `android/` project's
`applicationId`, and its Java package structure. Changing it now means
regenerating the native project from scratch; changing it after first
publishing means an entirely new Play Store listing.

**2. App icon and splash screen.** Capacitor ships a generic default icon.
Play Store submission requires a real one. Once you have a square logo image
(1024×1024px works well), the easiest path is:
```bash
npm install -g @capacitor/assets
npx capacitor-assets generate --android
```
This generates every required icon/splash size automatically from one source
image.

**3. The hidden dev console.** It's reachable by tapping the title 7 times —
genuinely hidden from casual play, but present in this build. Fine for a
friends test; worth deciding on purpose (keep, or strip out) before a wider
Play Store release.

## AdMob — wired up, running on Google's test IDs

`@capacitor-community/admob@6.2.0` is installed and synced. The rewarded ad
spots (keep-combo, keep-playing) and the interstitial (paced every 2-4
sessions returning to menu) all call the real AdMob SDK when running as this
native app — falling back to the old simulated placeholder only when the game
is opened in a plain browser (dev/testing), and granting the reward anyway
if a real ad can't be loaded (no fill, offline) rather than punishing the
player for an ad-inventory problem. See the "Ads (AdMob)" section in
big-blast.html for the actual logic.

Right now it's using **Google's public test IDs** — both the app ID in
`android/app/src/main/AndroidManifest.xml` (`com.google.android.gms.ads.APPLICATION_ID`)
and the two ad unit IDs (`AD_UNIT_IDS` near the top of the "Ads (AdMob)"
section in big-blast.html). These always serve a real test ad creative and
earn zero real revenue — that's intentional, it's what let this get built and
verified without needing your AdMob account yet. **Before a real release**:
1. Create an AdMob account at apps.admob.com if you don't have one, add the
   app, and create a rewarded and an interstitial ad unit.
2. Replace the test app ID in AndroidManifest.xml with your real one.
3. Replace `AD_UNIT_IDS.interstitial` / `.rewarded` in big-blast.html (then
   re-sync `www/index.html` and `cap sync android`) with your real unit IDs.
4. Add EEA/UK consent handling (Google's UMP SDK) — not implemented here,
   and Google requires it before serving ads to EU/UK users for real. Test
   ads don't need it, but don't launch there without it.
5. Privacy policy and Play Console's Data Safety form both need updating to
   disclose AdMob/Google's data collection — the current privacy-policy.html
   still says there's no advertising, which becomes false the moment real
   ads go live.

## Opening and building

```bash
npx cap open android
```

This opens the project in Android Studio. From there:
- **Testing on your own device/emulator:** just hit the Run button.
- **Building for Play Store closed testing:** Build → Generate Signed Bundle
  / APK → choose **Android App Bundle (AAB)**, not APK (Play Store requires
  AAB for new apps).

### The signing key — the one truly irreversible step

**Already generated** — `C:\Users\pleye\android-keystores\bigblast-release.jks`
(deliberately outside this repo, not inside `bigblast-android-setup/` at all,
so it can never accidentally get committed). RSA 2048, alias `bigblast`,
valid until 2054.

- Certificate SHA-1: `B0:71:D7:01:18:44:E7:0F:91:79:B8:D5:29:B4:9B:63:31:60:A7:10`
- Certificate SHA-256: `ED:26:AB:87:B2:B9:D1:AC:B3:08:1B:CD:E7:03:1C:30:D2:60:25:4E:02:7E:90:9F:41:6D:92:BC:BB:78:A1:34`
  (Google Play may ask for one of these fingerprints in various places —
  keep this note somewhere findable, it saves re-running `keytool -list -v`.)

**Back this file up right now, somewhere real** — a password manager's file
attachment, an encrypted drive, cloud storage with 2FA. Not just this
machine's Desktop. If it's lost, there is no recovery: you can never publish
an update to this app under the same listing ever again, and Play Store
would treat any future upload as a completely different app with zero
install history. This is the one piece of this whole process that couldn't
be done safely without a human holding the result — the actual password was
given to you directly in chat when this was generated, not written to any
file that gets committed.

`android/keystore.properties` (gitignored, sitting next to this file) has
the store path, alias, and both passwords in it already — `app/build.gradle`
reads it automatically, so **`./gradlew bundleRelease` or `assembleRelease`
just works**, no Android Studio signing dialog needed. If you ever set up
this project on a different machine, recreate that file there (same format)
pointing at wherever you restored the backed-up `.jks` to.

## After you have a signed AAB

The signed AAB is already sitting at
`android/app/build/outputs/bundle/release/app-release.aab` — built and
verified working. Upload it to Play Console → your app → Test and release →
Testing → Closed testing. Since your developer account is exempt from the
14-day/12-tester requirement (created before Nov 13, 2023), you can also go
straight to Production whenever you're ready — closed testing first is still
a good idea, just no longer mandatory.

## What I already fixed in the game file for this

- **Android back button** — previously would have exited the whole app
  instantly regardless of context. Now closes whatever popup is open first,
  leaves an active game safely (reusing the same confirmation the home
  button already has) before it ever exits, and only actually exits when
  you're at the plain menu with nothing open. Verified against a simulated
  Capacitor environment across all three cases.
- **Viewport / iOS input zoom fix** — already in place from earlier work,
  relevant if you build for iOS later too.
