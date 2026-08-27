# Big Blast — Android Build Setup

Everything here is prepared and ready to drop in. These exact commands need to
run on your own machine (not in this chat) — they need internet access to
download packages, and a full Android SDK to actually build, neither of which
this environment has.

## What you need installed first (one-time)

1. **Node.js** (v18+) — you likely already have this.
2. **Android Studio** — https://developer.android.com/studio
   Run it once after installing so it downloads the Android SDK.
3. That's it — no Mac needed for Android specifically.

## Setup (run these in order, inside this `bigblast-android` folder)

```bash
npm install
npx cap add android
npx cap sync android
```

`npx cap add android` generates the actual native Android project (a folder
called `android/`) — this is the piece that can't be pre-built without
internet access, since it pulls Capacitor's native templates live.

## Before you build — three things worth deciding now

**1. The package/app ID.** I set a placeholder in `capacitor.config.json`:
`com.bezaz.bigblast`. This becomes permanent the moment you first publish —
it can never be changed later without creating an entirely new listing. Open
that file and change it now if you want something different, before running
`npx cap add android`.

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

Android Studio will prompt you to create a new keystore the first time you
generate a signed build. Whatever you do here:

- **Back up the `.jks` file and its passwords somewhere safe** (password
  manager, encrypted drive — not just your Desktop). If you lose it, you
  cannot publish updates to this app ever again under the same listing —
  Play Store would treat any future upload as a completely different app.
- This is the one piece of this whole process I genuinely cannot do for you
  or safely generate on your behalf — it has to be something only you hold.

## After you have a signed AAB

Upload it to Play Console → your app → Test and release → Testing → Closed
testing. Since your developer account is exempt from the 14-day/12-tester
requirement (created before Nov 13, 2023), you can also go straight to
Production whenever you're ready — closed testing first is still a good idea,
just no longer mandatory.

## What I already fixed in the game file for this

- **Android back button** — previously would have exited the whole app
  instantly regardless of context. Now closes whatever popup is open first,
  leaves an active game safely (reusing the same confirmation the home
  button already has) before it ever exits, and only actually exits when
  you're at the plain menu with nothing open. Verified against a simulated
  Capacitor environment across all three cases.
- **Viewport / iOS input zoom fix** — already in place from earlier work,
  relevant if you build for iOS later too.
