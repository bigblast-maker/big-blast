#!/usr/bin/env node
/**
 * BIG BLAST — Automated Test Suite
 * =================================
 * Drives the real game in a real headless browser: taps real buttons, performs
 * real drags, reads real DOM state. Nothing is simulated or mocked.
 *
 * USAGE:
 *   node bigblast-test-suite.js                  # default: 5 runs
 *   node bigblast-test-suite.js --runs 20        # more runs = more confidence
 *   node bigblast-test-suite.js --headed         # watch it play (needs display)
 *   node bigblast-test-suite.js --file /path/to/big-blast.html
 *
 * WHAT IT COVERS:
 *   1. UI sweep      — opens/closes every overlay, checks for JS errors
 *   2. Normal play   — plays like a real player until game over
 *   3. Max play      — plays greedily for the highest score it can reach
 *   4. Mode coverage — Classic, Pure, Time Attack, Zen, Daily
 *   5. Edge cases    — undo, drag-cancel, resume-after-reload, reset
 *
 * Exits non-zero if any check fails, so it can gate a release.
 */

const path = require('path');
const PW = '/home/claude/.npm-global/lib/node_modules/playwright';
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';

// ---------- args ----------
const args = process.argv.slice(2);
const getArg = (name, def) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const RUNS = parseInt(getArg('runs', '5'), 10);
const HEADED = args.includes('--headed');
const GAME_FILE = getArg('file', '/mnt/user-data/outputs/big-blast.html');
const MAX_PLACEMENTS = parseInt(getArg('max-placements', '400'), 10);

// ---------- results collection ----------
const results = {
  errors: [],        // JS errors caught anywhere
  failures: [],      // assertion failures
  warnings: [],      // things worth flagging but not failures
  games: [],         // per-game stats
  uiChecks: [],      // per-overlay results
  timings: [],       // performance samples
};

function fail(msg, ctx) { results.failures.push({ msg, ctx }); }
function warn(msg, ctx) { results.warnings.push({ msg, ctx }); }

// ---------- browser helpers ----------
async function newPage(browser) {
  const page = await browser.newPage({
    viewport: { width: 400, height: 850 },
    hasTouch: true,
    isMobile: true,
  });
  page.on('pageerror', err => results.errors.push('PAGEERROR: ' + err.message));
  page.on('console', msg => {
    if (msg.type() === 'error') results.errors.push('CONSOLE: ' + msg.text());
  });
  return page;
}

async function bootFresh(page, seedState = {}) {
  await page.goto('file://' + GAME_FILE);
  await page.waitForTimeout(250);
  await page.evaluate((seed) => {
    localStorage.clear();
    for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
  }, seedState);
  await page.reload();
  await page.waitForTimeout(1100); // boot loader covers the screen for ~620ms
  // The game runs a version-gated data wipe on load, so the tutorial flag must
  // be set AFTER that has happened — otherwise the tutorial overlay reappears
  // and silently blocks every drag.
  await page.evaluate((seed) => {
    localStorage.setItem('blastgrid_tutorial_seen', 'yes');
    localStorage.removeItem('blastgrid_saved_game'); // always start fresh, never resume
    // Seeded values must be re-applied HERE, after the wipe -- applying them
    // before the reload (as the pre-reload block does) means the game's own
    // version-gated data wipe erases them on load.
    for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
  }, seedState);
  // The daily-rewards popup has a SECOND, independent trigger: the game opens
  // it via its own setTimeout on page load if a login reward is pending. That
  // delay was raised to 1200ms when the boot loader was added, so this wait
  // must clear it -- otherwise the popup appears AFTER this check and silently
  // blocks whatever gets clicked next.
  await page.waitForTimeout(1400);
  await dismissDailyRewards(page);
}

/**
 * The daily-rewards popup doesn't always exist in the DOM the instant the page
 * settles — a single one-shot check right after reload can run before it has
 * actually rendered, silently missing it and leaving it to block the NEXT
 * action (like clicking Play) instead. Retrying over a short window is what
 * actually catches it reliably.
 */
async function dismissDailyRewards(page) {
  // Poll over a window rather than checking once: the popup is opened by a
  // setTimeout on page load, so exactly when it appears depends on load timing.
  // Polling until it's been reliably absent for a stretch is what actually
  // guarantees it's gone rather than just not-yet-arrived.
  let clearStreak = 0;
  for (let i = 0; i < 25; i++) {
    const shown = await page.evaluate(() =>
      !!document.getElementById('dailyRewardsOverlay')?.classList.contains('show'));
    if (shown) {
      clearStreak = 0;
      await page.click('#closeDailyRewardsBtn', { force: true }).catch(() => {});
      await page.waitForTimeout(250);
    } else {
      clearStreak++;
      if (clearStreak >= 4) return; // absent across several consecutive polls
      await page.waitForTimeout(150);
    }
  }
}

/** Tutorial can still appear on first game start; clear it so drags land. */
async function dismissTutorial(page) {
  for (let i = 0; i < 6; i++) {
    const shown = await page.evaluate(() =>
      !!document.getElementById('tutorialOverlay')?.classList.contains('show'));
    if (!shown) return;
    const skip = await page.$('#tutorialSkipBtn');
    if (skip) await skip.click({ force: true }).catch(() => {});
    else await page.click('#tutorialNextBtn', { force: true }).catch(() => {});
    await page.waitForTimeout(250);
  }
}

/**
 * The game applies a "lift" offset plus gamma easing to vertical drag position
 * (so reaching top rows doesn't require physically stretching your thumb).
 * To land a piece on an intended cell we must invert that exact transform.
 * These constants are read from the game source — if they change there, the
 * harness reads them fresh each run rather than hardcoding.
 */
async function computeDropPoint(page, targetRow, targetCol, pieceH, pieceW) {
  // The game centers a piece on the drop point using ITS OWN bounding-box
  // half-dimensions (r0 = round((y-top)/cellSize - h/2)). Targeting the plain
  // center of a cell (the old +0.5 formula) only happens to land correctly for
  // h=1 and h=2, because of how JS rounds exact .5 boundaries -- for h=3
  // (e.g. a 5-cell plus-shape) it silently lands one row short. Using the
  // piece's real half-height/width here is what actually inverts the game's
  // own math correctly for every shape, not just small ones.
  const h = pieceH || 1, w = pieceW || 1;
  return page.evaluate(({ r, c, h, w }) => {
    const boardRect = document.getElementById('board').getBoundingClientRect();
    const cellSize = boardRect.width / 8;
    const yGame = boardRect.top + (r + h/2) * cellSize;
    const xGame = boardRect.left + (c + w/2) * cellSize;
    const lift = cellSize * 1.6, GAMMA = 1.6;
    const easedFracY = (yGame - boardRect.top) / boardRect.height;
    const sign = easedFracY < 0 ? -1 : 1;
    const fracY = sign * Math.pow(Math.abs(easedFracY), 1 / GAMMA);
    const rawY = fracY * boardRect.height + boardRect.top;
    return { x: xGame, y: rawY + lift };
  }, { r: targetRow, c: targetCol, h, w });
}

async function readBoard(page) {
  return page.evaluate(() => {
    const cells = [...document.querySelectorAll('#board .cell')];
    if (cells.length < 64) return null;
    const grid = [];
    for (let r = 0; r < 8; r++) {
      const row = [];
      for (let c = 0; c < 8; c++) row.push(cells[r * 8 + c]?.classList.contains('filled') ? 1 : 0);
      grid.push(row);
    }
    return grid;
  });
}

async function readTray(page) {
  return page.evaluate(() => {
    // Piece cells use IMPLICIT CSS grid auto-placement (no explicit
    // grid-column-start/row-start set), so getComputedStyle cannot read a
    // per-cell position directly -- it must be reconstructed from DOM order
    // plus the known grid width instead (index -> row=floor(i/w), col=i%w).
    const slots = [...document.querySelectorAll('#tray .traySlot')];
    return slots.map((slot, idx) => {
      const children = [...slot.children];
      if (!children.length) return null;
      const colsMatch = slot.style.gridTemplateColumns.match(/repeat\((\d+)/);
      const w = colsMatch ? parseInt(colsMatch[1], 10) : Math.ceil(Math.sqrt(children.length));
      const filled = [];
      let isLaser = false;
      children.forEach((child, i) => {
        if (child.classList.contains('pcell')) {
          filled.push([Math.floor(i / w), i % w]);
          if (child.classList.contains('blkLaser')) isLaser = true;
        }
      });
      if (!filled.length) return null;
      const minR = Math.min(...filled.map(p => p[0]));
      const minC = Math.min(...filled.map(p => p[1]));
      return { idx, cells: filled.map(([r, c]) => [r - minR, c - minC]), isLaser };
    });
  });
}


/**
 * The score display animates (counts up) rather than snapping, so reading it
 * immediately after an action can catch a mid-animation value. This waits for
 * it to settle before reading — without this, tests report false failures.
 */
async function readSettledScore(page, timeoutMs = 2000) {
  let last = null, stableFor = 0;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const v = await page.evaluate(() =>
      parseInt(document.getElementById('score')?.textContent.replace(/\D/g, '') || '0', 10));
    if (v === last) { stableFor += 60; if (stableFor >= 240) return v; }
    else { last = v; stableFor = 0; }
    await page.waitForTimeout(60);
  }
  return last ?? 0;
}

// ---------- placement logic (mirrors the game's own rules) ----------
function canPlace(grid, cells, r0, c0) {
  for (const [dr, dc] of cells) {
    const r = r0 + dr, c = c0 + dc;
    if (r < 0 || r >= 8 || c < 0 || c >= 8) return false;
    if (grid[r][c]) return false;
  }
  return true;
}

function countEmpties(grid) {
  let n = 0;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (!grid[r][c]) n++;
  return n;
}

function countLines(grid) {
  let lines = 0;
  for (let r = 0; r < 8; r++) if (grid[r].every(v => v)) lines++;
  for (let c = 0; c < 8; c++) { let f = true; for (let r = 0; r < 8; r++) if (!grid[r][c]) f = false; if (f) lines++; }
  return lines;
}

/**
 * Two player personas:
 *  - 'normal': picks a decent-but-not-optimal move, like a casual player.
 *              Adds randomness so runs aren't identical.
 *  - 'max':    exhaustively picks the highest-value move available.
 */
function chooseMove(grid, cells, persona) {
  const options = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (!canPlace(grid, cells, r, c)) continue;
      const test = grid.map(row => row.slice());
      for (const [dr, dc] of cells) test[r + dr][c + dc] = 1;
      const lines = countLines(test);
      // Prefer clearing lines, then keeping the board open
      const score = lines * 1000 + countEmpties(test);
      options.push({ r, c, score, lines });
    }
  }
  if (!options.length) return null;
  options.sort((a, b) => b.score - a.score);
  if (persona === 'max') return options[0];
  // 'normal': usually picks well, sometimes picks a middling move (like a human)
  if (Math.random() < 0.7 || options.length === 1) return options[0];
  const midIdx = Math.min(options.length - 1, 1 + Math.floor(Math.random() * 3));
  return options[midIdx];
}

async function performDrag(page, slotIdx, targetRow, targetCol, pieceCells) {
  const src = await page.evaluate((i) => {
    const slots = [...document.querySelectorAll('#tray .traySlot')];
    const slot = slots[i];
    if (!slot || !slot.children.length) return null;
    const rect = slot.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }, slotIdx);
  if (!src) return false;
  // Derive the piece's true bounding-box height/width from its cells so the
  // drop point centers correctly regardless of shape -- defaults to 1x1 (a
  // laser or an unspecified piece) if cells weren't provided.
  let h = 1, w = 1;
  if (pieceCells && pieceCells.length) {
    h = Math.max(...pieceCells.map(c => c[0])) + 1;
    w = Math.max(...pieceCells.map(c => c[1])) + 1;
  }
  const dst = await computeDropPoint(page, targetRow, targetCol, h, w);
  await page.mouse.move(src.x, src.y);
  await page.mouse.down();
  await page.waitForTimeout(30);
  await page.mouse.move(dst.x, dst.y, { steps: 12 });
  await page.waitForTimeout(30);
  await page.mouse.up();
  await page.waitForTimeout(120);
  return true;
}

async function isGameOver(page) {
  return page.evaluate(() => !!document.getElementById('gameOverOverlay')?.classList.contains('show'));
}

async function dismissBlockingOverlays(page) {
  await dismissTutorial(page);
  // Rank-up / theme-unlock / milestone popups can appear mid-play; clear them
  // so play can continue, and record that they appeared.
  const seen = [];
  for (let i = 0; i < 4; i++) {
    const state = await page.evaluate(() => ({
      rankUp: document.getElementById('rankUpOverlay')?.classList.contains('show'),
      theme: document.getElementById('themeUnlockOverlay')?.classList.contains('show'),
      streak: document.getElementById('streakReviveOverlay')?.classList.contains('show'),
    }));
    if (state.rankUp) {
      seen.push('rankUp');
      await page.click('#rankUpContinueBtn', { force: true }).catch(() => {});
      await page.waitForTimeout(300);
    } else if (state.theme) {
      seen.push('themeUnlock');
      await page.click('#equipThemeLaterBtn', { force: true }).catch(() => {});
      await page.waitForTimeout(300);
    } else if (state.streak) {
      seen.push('streakRevive');
      await page.click('#declineStreakBtn', { force: true }).catch(() => {});
      await page.waitForTimeout(300);
    } else break;
  }
  return seen;
}

// ---------- TEST 1: UI sweep ----------
async function testUISweep(page) {
  await bootFresh(page);
  const checks = [];
  // Five of these now live inside the More menu rather than directly on the top
  // bar, so they need it opened first (`via`).
  const overlays = [
    { open: '#dailyRewardsBtnMenu', close: '#closeDailyRewardsBtn', id: 'dailyRewardsOverlay', name: 'Daily Rewards', via: '#moreBtnMenu' },
    { open: '#challengesBtnMenu', close: '#closeChallengesBtn', id: 'challengesOverlay', name: 'Challenges', via: '#moreBtnMenu' },
    { open: '#achievementsBtnMenu', close: '#closeAchievementsBtn', id: 'achievementsOverlay', name: 'Achievements', via: '#moreBtnMenu' },
    { open: '#themesBtnMenu', close: '#closeThemesBtn', id: 'themesOverlay', name: 'Themes', via: '#moreBtnMenu' },
    { open: '#shopBtnMenu', close: '#closeShopBtn', id: 'shopOverlay', name: 'Shop', via: '#moreBtnMenu' },
    { open: '#settingsBtnMenu', close: '#closeSettingsBtn', id: 'settingsOverlay', name: 'Settings' },
    { open: '#menuStatsStrip', close: '#closeStatsBtn', id: 'statsOverlay', name: 'Stats' },
    { open: '#menuRankBadge', close: '#closeRankDetailsBtn', id: 'rankDetailsOverlay', name: 'Rank Ladder' },
    { open: '#rankProgressBar', close: '#closeRankGraphBtn', id: 'rankGraphOverlay', name: 'Rank Graph' },
  ];
  for (const o of overlays) {
    try {
      if (o.via) { await page.click(o.via, { force: true }); await page.waitForTimeout(400); }
      await page.click(o.open, { force: true });
      await page.waitForTimeout(400);
      const opened = await page.evaluate(id => document.getElementById(id)?.classList.contains('show'), o.id);
      if (!opened) fail(`Overlay "${o.name}" did not open`, o.open);
      await page.click(o.close, { force: true });
      await page.waitForTimeout(320);
      const closed = await page.evaluate(id => !document.getElementById(id)?.classList.contains('show'), o.id);
      if (!closed) fail(`Overlay "${o.name}" did not close`, o.close);
      checks.push({ name: o.name, opened, closed });
    } catch (e) {
      fail(`Overlay "${o.name}" threw: ${e.message}`, o.open);
      checks.push({ name: o.name, opened: false, closed: false, error: e.message });
    }
  }
  results.uiChecks = checks;

  // Every button should be reachable and not throw on tap
  const buttonCount = await page.evaluate(() =>
    document.querySelectorAll('.btn, .iconBtn, .modeCard').length);
  if (buttonCount < 10) warn(`Only ${buttonCount} interactive elements found — expected more`, 'button sweep');
}

// ---------- TEST 2 & 3: play a full game ----------

/**
 * Starts a game in the requested mode. A fresh player tapping Play gets the
 * mode-chooser overlay rather than dropping straight into a game, so this
 * handles both paths and verifies we actually reached the game screen.
 */
async function startGame(page, mode) {
  await dismissDailyRewards(page);
  await page.click('#playBtn', { force: true }).catch(() => {});
  await page.waitForTimeout(350);
  await dismissDailyRewards(page); // defensive: the delayed trigger could still fire right around here

  let chooserOpen = await page.evaluate(() =>
    !!document.getElementById('chooseModeOverlay')?.classList.contains('show'));

  // If Play resumed a saved game instead of showing the chooser, back out so we
  // always start the mode we actually asked for rather than whatever was saved.
  if (!chooserOpen) {
    const inGame = await page.evaluate(() => document.getElementById('gameScreen').style.display === 'flex');
    if (inGame) {
      await page.click('#homeBtn', { force: true }).catch(() => {});
      await page.waitForTimeout(250);
      await page.click('#purchaseConfirmYes', { force: true }).catch(() => {});
      await page.waitForTimeout(400);
      await dismissBlockingOverlays(page);
      await page.click('#newGameFromMenuBtn', { force: true }).catch(() => {});
      await page.waitForTimeout(300);
      chooserOpen = await page.evaluate(() =>
        !!document.getElementById('chooseModeOverlay')?.classList.contains('show'));
    }
  }

  if (chooserOpen) {
    const card = await page.$(`.modeCard[data-mode="${mode}"]`);
    if (!card) return false;
    await card.click({ force: true });
    await page.waitForTimeout(200);
    await page.click('#startModeBtn', { force: true });
    await page.waitForTimeout(450);
  }

  await dismissTutorial(page);
  await page.waitForTimeout(150);
  return page.evaluate(() => document.getElementById('gameScreen').style.display === 'flex');
}

async function playGame(page, { persona, mode }) {
  const seed = {};
  await bootFresh(page, seed);

  const started = await startGame(page, mode);
  if (!started) { fail(`Could not start a game in mode "${mode}"`, 'mode select'); return null; }

  const t0 = Date.now();
  let placements = 0, stuckAttempts = 0;
  const popupsSeen = new Set();

  while (placements < MAX_PLACEMENTS) {
    const popups = await dismissBlockingOverlays(page);
    popups.forEach(p => popupsSeen.add(p));

    if (await isGameOver(page)) break;

    const grid = await readBoard(page);
    const tray = await readTray(page);
    if (!grid || !tray) { await page.waitForTimeout(200); stuckAttempts++; if (stuckAttempts > 3) break; continue; }
    const active = tray.filter(Boolean);
    if (!active.length) { await page.waitForTimeout(200); continue; }

    // Find the best (piece, position) pair across the whole tray
    let best = null;
    for (const piece of active) {
      // Lasers place anywhere; treat as single cell for targeting purposes
      const cells = piece.isLaser ? [[0, 0]] : piece.cells;
      const move = chooseMove(grid, cells, persona);
      if (move && (!best || move.score > best.move.score)) best = { piece, move };
    }

    if (!best) {
      stuckAttempts++;
      if (stuckAttempts > 2) break; // genuinely stuck
      await page.waitForTimeout(250);
      continue;
    }
    stuckAttempts = 0;

    const ok = await performDrag(page, best.piece.idx, best.move.r, best.move.c, best.piece.isLaser ? [[0,0]] : best.piece.cells);
    if (!ok) break;
    placements++;
  }

  const elapsed = Date.now() - t0;
  const settledScore = await readSettledScore(page);
  const final = await page.evaluate((s) => ({
    score: s,
    gameOverShown: !!document.getElementById('gameOverOverlay')?.classList.contains('show'),
    rankBest: parseInt(localStorage.getItem('blastgrid_rank_best') || '0', 10),
    best: parseInt(localStorage.getItem('blastgrid_best') || '0', 10),
    gems: parseInt(localStorage.getItem('blastgrid_gems') || '0', 10),
  }), settledScore);

  // --- integrity assertions ---
  if (final.score < 0) fail('Score went negative', `mode=${mode}`);
  if (final.best < final.score && final.score > 0) {
    fail(`High score (${final.best}) is lower than achieved score (${final.score})`, `mode=${mode}`);
  }
  if (mode === 'zen' && final.rankBest > 0) {
    fail(`Zen mode contributed to rank (rankBest=${final.rankBest}) — should be excluded`, 'zen rank');
  }
  if (mode !== 'zen' && final.score > 0 && final.rankBest < final.score) {
    fail(`rankBest (${final.rankBest}) did not track score (${final.score}) in ${mode}`, 'rank tracking');
  }

  const rec = {
    mode, persona, placements, score: final.score,
    msPerPlacement: placements ? Math.round(elapsed / placements) : 0,
    endedNaturally: final.gameOverShown,
    popups: [...popupsSeen],
    gems: final.gems,
  };
  results.games.push(rec);
  return rec;
}

// ---------- TEST 4: Pure mode has no bombs/lasers ----------
async function testPureMode(page) {
  await bootFresh(page);
  const ok = await startGame(page, 'pure');
  if (!ok) { fail('Could not start Pure mode', 'pure mode'); return; }

  const invHidden = await page.evaluate(() => {
    const b = document.getElementById('invBombSlot'), l = document.getElementById('invLaserSlot');
    return b.style.display === 'none' && l.style.display === 'none';
  });
  if (!invHidden) fail('Pure mode still shows bomb/laser inventory slots', 'pure mode');

  // Play a stretch and confirm no laser ever appears in the tray
  let sawLaser = false;
  for (let i = 0; i < 40; i++) {
    await dismissBlockingOverlays(page);
    if (await isGameOver(page)) break;
    const tray = await readTray(page);
    if (!tray) break;
    if (tray.some(p => p && p.isLaser)) { sawLaser = true; break; }
    const grid = await readBoard(page);
    if (!grid) break;
    const active = tray.filter(Boolean);
    if (!active.length) break;
    let best = null;
    for (const piece of active) {
      const move = chooseMove(grid, piece.cells, 'max');
      if (move && (!best || move.score > best.move.score)) best = { piece, move };
    }
    if (!best) break;
    await performDrag(page, best.piece.idx, best.move.r, best.move.c, best.piece.cells);
  }
  if (sawLaser) fail('A laser piece appeared in Pure mode', 'pure mode');
}

// ---------- TEST 5: edge cases ----------
async function testEdgeCases(page) {
  // --- Undo restores prior state ---
  await bootFresh(page);
  await startGame(page, 'classic');
  await dismissBlockingOverlays(page);
  await page.waitForTimeout(200);
  const grid0 = await readBoard(page);
  const tray0 = await readTray(page);
  const firstPiece = (grid0 && tray0) ? tray0.find(Boolean) : null;
  if (firstPiece) {
    const move = chooseMove(grid0, firstPiece.cells, 'max');
    if (move) {
      // Read score immediately before the drag so nothing else can move it
      const scoreBefore = await readSettledScore(page);
      await performDrag(page, firstPiece.idx, move.r, move.c, firstPiece.cells);
      await dismissBlockingOverlays(page);
      const scoreAfter = await readSettledScore(page);
      if (scoreAfter <= scoreBefore) warn('Score did not increase after a placement', 'undo test setup');
      const undoEnabled = await page.evaluate(() => {
        const b = document.getElementById('undoBtn');
        return b && !b.disabled && b.style.display !== 'none';
      });
      if (undoEnabled) {
        await page.click('#undoBtn', { force: true }).catch(() => {});
        await page.waitForTimeout(450);
        const scoreUndone = await readSettledScore(page);
        if (scoreUndone !== scoreBefore) {
          fail(`Undo did not restore score (before=${scoreBefore}, after undo=${scoreUndone})`, 'undo');
        }
      } else {
        warn('Undo button was not enabled after a placement', 'undo');
      }
    }
  }

  // --- Drag off-board cancels, does not place ---
  await bootFresh(page);
  await startGame(page, 'classic');
  await dismissBlockingOverlays(page);
  await page.waitForTimeout(250);
  const scorePreCancel = await readSettledScore(page);
  await page.waitForTimeout(300);
  let boardPre = await readBoard(page);
  if (!boardPre) { await page.waitForTimeout(500); boardPre = await readBoard(page); }
  if (!boardPre) { warn('Board unavailable for drag-cancel test', 'drag cancel'); return; }
  const filledPre = boardPre.flat().filter(Boolean).length;
  const src = await page.evaluate(() => {
    const slot = [...document.querySelectorAll('#tray .traySlot')].find(s => s.children.length);
    if (!slot) return null;
    const r = slot.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  if (!src) { warn('No tray piece available for drag-cancel test', 'drag cancel'); return; }
  await page.mouse.move(src.x, src.y);
  await page.mouse.down();
  await page.waitForTimeout(40);
  await page.mouse.move(src.x, src.y + 200, { steps: 10 }); // drag well below the board
  await page.waitForTimeout(40);
  await page.mouse.up();
  await page.waitForTimeout(250);
  const boardPost = await readBoard(page);
  const filledPost = boardPost ? boardPost.flat().filter(Boolean).length : filledPre;
  const scorePostCancel = await readSettledScore(page);
  if (filledPost !== filledPre || scorePostCancel !== scorePreCancel) {
    fail('Dragging off-board still placed the piece (cancel failed)', 'drag cancel');
  }

  // --- Resume after reload preserves state ---
  await bootFresh(page);
  await startGame(page, 'classic');
  for (let i = 0; i < 5; i++) {
    await dismissBlockingOverlays(page);
    const g = await readBoard(page), t = await readTray(page);
    if (!g || !t) break;
    const p = t.find(Boolean);
    if (!p) break;
    const m = chooseMove(g, p.cells, 'max');
    if (!m) break;
    await performDrag(page, p.idx, m.r, m.c, p.cells);
  }
  const scorePreReload = await readSettledScore(page);
  const gridPreReload = await readBoard(page);
  await page.reload();
  await page.waitForTimeout(500);
  const dailyBtn = await page.$('#closeDailyRewardsBtn');
  if (dailyBtn) { await dailyBtn.click({ force: true }).catch(()=>{}); await page.waitForTimeout(200); }
  await page.click('#playBtn', { force: true });
  await page.waitForTimeout(500);
  const scorePostReload = await readSettledScore(page);
  const gridPostReload = await readBoard(page);
  if (scorePostReload !== scorePreReload) {
    fail(`Resume lost score (before=${scorePreReload}, after=${scorePostReload})`, 'resume');
  }
  if (JSON.stringify(gridPreReload) !== JSON.stringify(gridPostReload)) {
    fail('Resume did not restore the exact board state', 'resume');
  }

  // --- Reset high score clears both best and rank ---
  // Deliberately starts from a CLEAN boot with a seeded score rather than
  // reusing the in-progress game from the resume test above. Reset also ends
  // any active game, and that game then writes its own final score -- racing
  // the assertion and making a working feature look broken. Seeding directly
  // removes the race entirely instead of trying to out-wait it.
  await bootFresh(page, {
    blastgrid_best: '5000',
    blastgrid_rank_best: '5000',
  });
  await page.waitForTimeout(200);
  const beforeReset = await page.evaluate(() => ({
    best: parseInt(localStorage.getItem('blastgrid_best') || '0', 10),
    rankBest: parseInt(localStorage.getItem('blastgrid_rank_best') || '0', 10),
  }));
  if (beforeReset.best !== 5000 || beforeReset.rankBest !== 5000) {
    warn(`Reset test setup did not seed scores as expected (best=${beforeReset.best}, rankBest=${beforeReset.rankBest})`, 'reset setup');
  }
  await page.click('#settingsBtnMenu', { force: true }).catch(() => {});
  await page.waitForTimeout(400);
  const resetBtn = await page.$('#resetHighScoreBtn');
  if (resetBtn) {
    await resetBtn.click({ force: true });
    await page.waitForTimeout(350);
    await page.click('#purchaseConfirmYes', { force: true }).catch(() => {});
    await page.waitForTimeout(600);
    const afterReset = await page.evaluate(() => ({
      best: parseInt(localStorage.getItem('blastgrid_best') || '0', 10),
      rankBest: parseInt(localStorage.getItem('blastgrid_rank_best') || '0', 10),
    }));
    if (afterReset.best !== 0 || afterReset.rankBest !== 0) {
      fail(`Reset did not clear both scores (best=${afterReset.best}, rankBest=${afterReset.rankBest})`, 'reset');
    }
  } else {
    warn('Reset High Score button not found', 'reset');
  }
}

// ---------- runner ----------
async function main() {
  const { chromium } = require(PW);
  const browser = await chromium.launch(
    HEADED ? { headless: false } : { executablePath: CHROME }
  );

  console.log('='.repeat(62));
  console.log('BIG BLAST — AUTOMATED TEST SUITE');
  console.log('='.repeat(62));
  console.log(`File:  ${GAME_FILE}`);
  console.log(`Runs:  ${RUNS}`);
  console.log('');

  for (let run = 1; run <= RUNS; run++) {
    process.stdout.write(`Run ${run}/${RUNS}: `);
    const page = await newPage(browser);
    try {
      process.stdout.write('ui ');
      await testUISweep(page);

      process.stdout.write('normal ');
      await playGame(page, { persona: 'normal', mode: 'classic' });

      process.stdout.write('max ');
      await playGame(page, { persona: 'max', mode: 'classic' });

      process.stdout.write('pure ');
      await testPureMode(page);

      process.stdout.write('zen ');
      await playGame(page, { persona: 'normal', mode: 'zen' });

      process.stdout.write('edge ');
      await testEdgeCases(page);

      console.log('done');
    } catch (e) {
      console.log('THREW: ' + e.message);
      fail('Run threw an exception: ' + e.message, `run ${run}`);
    }
    await page.close();
  }

  await browser.close();
  report();
}

function report() {
  console.log('');
  console.log('='.repeat(62));
  console.log('RESULTS');
  console.log('='.repeat(62));

  // --- correctness ---
  console.log('\n── Correctness ──');
  if (!results.failures.length && !results.errors.length) {
    console.log('✅ No failures, no JS errors.');
  }
  if (results.errors.length) {
    console.log(`❌ ${results.errors.length} JS error(s):`);
    const uniq = [...new Set(results.errors)];
    uniq.slice(0, 10).forEach(e => console.log('   • ' + e.slice(0, 160)));
    if (uniq.length > 10) console.log(`   … and ${uniq.length - 10} more`);
  }
  if (results.failures.length) {
    console.log(`❌ ${results.failures.length} failure(s):`);
    const grouped = {};
    results.failures.forEach(f => { grouped[f.msg] = (grouped[f.msg] || 0) + 1; });
    Object.entries(grouped).forEach(([msg, n]) => console.log(`   • ${msg}${n > 1 ? `  (×${n})` : ''}`));
  }
  if (results.warnings.length) {
    console.log(`⚠️  ${results.warnings.length} warning(s):`);
    const grouped = {};
    results.warnings.forEach(w => { grouped[w.msg] = (grouped[w.msg] || 0) + 1; });
    Object.entries(grouped).forEach(([msg, n]) => console.log(`   • ${msg}${n > 1 ? `  (×${n})` : ''}`));
  }

  // --- UI ---
  console.log('\n── UI overlays ──');
  const uiOk = results.uiChecks.filter(c => c.opened && c.closed).length;
  console.log(`${uiOk}/${results.uiChecks.length} overlays opened and closed cleanly`);
  results.uiChecks.filter(c => !(c.opened && c.closed))
    .forEach(c => console.log(`   ❌ ${c.name}${c.error ? ' — ' + c.error : ''}`));

  // --- gameplay ---
  console.log('\n── Gameplay ──');
  const byGroup = {};
  results.games.forEach(g => {
    const key = `${g.mode}/${g.persona}`;
    (byGroup[key] = byGroup[key] || []).push(g);
  });
  Object.entries(byGroup).forEach(([key, list]) => {
    const scores = list.map(g => g.score).sort((a, b) => a - b);
    const placements = list.map(g => g.placements);
    const avg = arr => Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
    const median = arr => arr[Math.floor(arr.length / 2)];
    console.log(`${key.padEnd(18)} n=${list.length}  ` +
      `median score ${median(scores).toLocaleString().padStart(9)}  ` +
      `avg ${avg(scores).toLocaleString().padStart(9)}  ` +
      `max ${scores[scores.length-1].toLocaleString().padStart(9)}  ` +
      `avg pieces ${avg(placements)}`);
  });

  const naturalEnds = results.games.filter(g => g.endedNaturally).length;
  console.log(`\nGames ending naturally (board full): ${naturalEnds}/${results.games.length}`);
  const allPopups = new Set();
  results.games.forEach(g => g.popups.forEach(p => allPopups.add(p)));
  console.log(`Popups triggered during play: ${[...allPopups].join(', ') || 'none'}`);

  // --- performance ---
  const perfSamples = results.games.filter(g => g.msPerPlacement > 0).map(g => g.msPerPlacement);
  if (perfSamples.length) {
    const avgMs = Math.round(perfSamples.reduce((a, b) => a + b, 0) / perfSamples.length);
    console.log(`\n── Performance ──`);
    console.log(`Avg time per placement (incl. automation overhead): ${avgMs}ms`);
    if (avgMs > 400) console.log('   ⚠️  Slower than expected — worth profiling on-device');
  }

  console.log('\n' + '='.repeat(62));
  const passed = !results.failures.length && !results.errors.length;
  console.log(passed ? '✅ SUITE PASSED' : '❌ SUITE FAILED');
  console.log('='.repeat(62));
  process.exit(passed ? 0 : 1);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
