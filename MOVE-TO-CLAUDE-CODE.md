# Moving Big Blast to Claude Code

## 1. Check you have a paid plan

Claude Code needs Pro, Max, Team, Enterprise, or Console API credits. The free
Claude.ai tier does not include it. If you're on free, this step blocks
everything else.

## 2. Install Claude Code

Anthropic now recommends the **native installer** over npm — it auto-updates
and needs no separate runtime. Start here:

https://docs.claude.com/en/docs/claude-code/overview

If you'd rather manage it through npm (needs Node.js 18+):

```bash
npm install -g @anthropic-ai/claude-code
```

Do **not** prefix that with `sudo` — it's the most common cause of permission
errors. Verify with `node --version` first.

## 3. Set up the project folder

Download everything from this chat, then arrange it like this:

```
big-blast/
├── CLAUDE.md                    ← project context, read automatically
├── big-blast.html               ← the game
├── bigblast-test-suite.js       ← regression suite
├── legal/
│   ├── privacy-policy.html
│   └── terms-of-service.html
├── store-assets/
│   ├── icon-512.png
│   ├── feature-1024x500.png
│   ├── screen-*.png
│   └── STORE-LISTING.md
└── android/                     ← extract bigblast-android-setup.tar.gz here
    ├── www/index.html           ← copy of big-blast.html
    ├── capacitor.config.json
    └── package.json
```

`CLAUDE.md` is the important one. Claude Code reads it automatically at the
start of every session, so it inherits the architecture decisions, the bug
history, and the design system instead of starting cold.

## 4. Start it

```bash
cd big-blast
claude
```

Then say something like:

> Read CLAUDE.md. I want to build the Android APK and test it on my phone.

## 5. Make it a git repo (strongly recommended)

```bash
git init
git add .
git commit -m "Big Blast — initial import from Claude.ai"
```

Claude Code edits files directly on disk. Without git there's no undo. With
it, `git diff` shows exactly what changed and `git checkout .` reverts a bad
session instantly. This matters more than it sounds.

Add a `.gitignore`:

```
node_modules/
android/app/build/
android/.gradle/
*.keystore
*.jks
```

**Never commit the keystore.** It's the key to your app's identity.

## 6. Things Claude Code can do that I couldn't

- Actually run `npm install`, `npx cap add android`, and build the APK
- Install and run the ui-ux-pro-max skill you asked about:
  `/plugin marketplace add nextlevelbuilder/ui-ux-pro-max-skill`
- Install any npm package (real ad SDK, analytics, etc.)
- Run the game on a connected phone or emulator and iterate on real hardware
- Push to GitHub, set up GitHub Pages for the legal docs

## 7. First things worth doing there

1. Build and run on a real phone. Nothing has ever run outside headless
   Chromium — this is the biggest unknown in the project.
2. Check WebGL theme performance (Singularity, Supernova) on real hardware.
   They're the most likely thing to stutter or drain battery.
3. Decide the package ID before first publish. It's permanent.
4. Generate and back up the signing keystore.
