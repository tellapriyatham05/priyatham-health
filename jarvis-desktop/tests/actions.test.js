// Real, on-screen test of the things Jarvis does. Run: node tests/actions.test.js
// It types only into its own throwaway test window (never into your apps), opens
// Chrome/Calculator/Settings, changes volume/wallpaper and puts everything back.
const { execFileSync } = require('child_process');
const { WinHelper } = require('../system/helper');
const { Executor } = require('../system/executor');
const { parseCommand } = require('../brain/parser');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
const ps = (cmd) => execFileSync('powershell.exe', ['-NoProfile', '-Command', cmd], { encoding: 'utf8', windowsHide: true }).trim();

async function say(ex, sentence) {
  const { actions, unknown } = parseCommand(sentence);
  if (unknown.length) throw new Error(`not understood: ${unknown}`);
  const res = await ex.run(actions);
  const bad = res.find((r) => !r.ok);
  if (bad) throw new Error(bad.error);
  return res;
}

async function waitFor(ex, test, ms = 8000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const fg = await ex.foreground();
    if (test(fg)) return fg;
    await sleep(200);
  }
  return null;
}

(async () => {
  const helper = new WinHelper();
  const ex = new Executor({ helper, settings: { browser: 'chrome' }, log: console.log });
  const appCount = await ex.loadApps();
  check('reads Start menu apps', appCount > 50, `${appCount} apps`);

  for (const name of ['notepad', 'chrome', 'calculator', 'microsoft edge', 'chatgpt', 'davinci resolve', 'settings', 'vs code', 'slack', 'whatsapp']) {
    const app = ex.resolveApp(name);
    console.log(`      app "${name}" -> ${app ? app.name : '(not installed — site or special)'}`);
  }

  const savedClipboard = (() => { try { return ps('Get-Clipboard -Raw'); } catch { return ''; } })();

  // --- Typing & editing, ONLY inside our own throwaway test window ---------------
  const { spawn } = require('child_process');
  const fsx = require('fs');
  const outFile = require('path').join(require('os').tmpdir(), 'jarvis-target.txt');
  const form = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', require('path').join(__dirname, 'target.ps1'), outFile], { stdio: 'ignore' });
  const isTarget = (f) => f.title === 'Jarvis Test Target';
  const boxText = () => fsx.readFileSync(outFile, 'utf8').replace(/^﻿/, '');
  // Refuses to send anything unless our test window is the one in front.
  const sayInTarget = async (sentence) => {
    if (!isTarget(await ex.foreground())) throw new Error(`test window not in front before "${sentence}"`);
    await say(ex, sentence);
    await sleep(250);
  };
  try {
    const tw = await waitFor(ex, isTarget, 10000);
    check('test window opened', !!tw);
    if (tw) {
      await sayInTarget('type Jarvis test 123 తెలుగు हिंदी');
      check('"type …" types English + Telugu + Hindi exactly', boxText() === 'Jarvis test 123 తెలుగు हिंदी', JSON.stringify(boxText()));
      await sayInTarget('delete the last word');
      check('"delete the last word"', boxText() === 'Jarvis test 123 తెలుగు ', JSON.stringify(boxText()));
      await sayInTarget('undo');
      check('"undo"', boxText().startsWith('Jarvis test 123'), JSON.stringify(boxText()));
      await sayInTarget('select all');
      await sayInTarget('copy');
      await sayInTarget('press end');
      await sayInTarget('press enter');
      await sayInTarget('paste');
      check('"select all" + "copy" + "press enter" + "paste"', boxText().trim().split(/\r?\n/).length === 2, JSON.stringify(boxText()));
      await sayInTarget('clear everything');
      check('"clear everything"', boxText() === '', JSON.stringify(boxText()));
      await sayInTarget('type hello and press enter');
      check('"type hello and press enter" (chain)', /^hello\r?\n$/.test(boxText()), JSON.stringify(boxText()));
      // v2: click by name, then by number
      await sayInTarget('clear everything');
      await sayInTarget('click hamster button');
      await sleep(300);
      check('"click hamster button" clicks it by name', boxText().includes('[clicked]'), JSON.stringify(boxText()));
      await sayInTarget('clear everything');
      const shown = await ex.run(parseCommand('show numbers').actions);
      const btn = ex.numbered.find((e) => /hamster button/i.test(e.name));
      check('"show numbers" numbers the things you can click', shown[0].ok && !!btn, shown[0].detail || shown[0].error);
      if (btn) {
        const clicks = () => boxText().split('[clicked]').length - 1;
        const before = clicks();
        await sayInTarget(`click ${btn.n}`);
        await sleep(300);
        check(`"click ${btn.n}" clicks the numbered button`, clicks() === before + 1, `${before} -> ${clicks()} clicks`);
      }
      await sayInTarget('clear everything');
      await sayInTarget('minimize');
      await sleep(500);
      check('"minimize"', !isTarget(await ex.foreground()), `front is now ${(await ex.foreground()).process}`);
      await say(ex, 'switch to jarvis test target');
      check('"switch to <window>" brings it back', !!(await waitFor(ex, isTarget, 4000)));
      await sayInTarget('close this');
      await sleep(800);
      check('"close this" closes the front window', !(await helper.call('windows')).some((w) => w.title === 'Jarvis Test Target'));
    }
  } catch (err) {
    check('typing flow', false, err.message);
  } finally {
    try { form.kill(); } catch {}
  }

  // --- Volume ---------------------------------------------------------------------
  const vol = await helper.call('volume-get');
  try {
    await say(ex, 'set volume to 30');
    check('"set volume to 30"', (await helper.call('volume-get')).volume === 30);
    await say(ex, 'volume up');
    check('"volume up" (+10)', (await helper.call('volume-get')).volume === 40);
    await say(ex, 'turn down the volume by 20');
    check('"turn down the volume by 20"', (await helper.call('volume-get')).volume === 20);
    await say(ex, 'mute');
    check('"mute"', (await helper.call('volume-get')).muted === true);
    await say(ex, 'unmute');
    check('"unmute"', (await helper.call('volume-get')).muted === false);
  } catch (err) {
    check('volume flow', false, err.message);
  } finally {
    await helper.call('volume-set', { volume: vol.volume });
    await helper.call('mute-set', { muted: vol.muted });
    check('volume restored', (await helper.call('volume-get')).volume === vol.volume, `${vol.volume}%`);
  }

  // --- Wallpaper --------------------------------------------------------------------
  const originalWallpaper = await ex.currentWallpaper();
  try {
    const res = await say(ex, 'change the background of the wallpaper');
    const nowWallpaper = await ex.currentWallpaper();
    check('"change the background of the wallpaper"', nowWallpaper !== originalWallpaper, res[0].detail);
  } catch (err) {
    check('wallpaper change', false, err.message);
  } finally {
    await helper.call('wallpaper-set', { path: originalWallpaper });
    check('wallpaper restored', (await ex.currentWallpaper()) === originalWallpaper);
  }

  // --- Radios (safe: set to the state they are already in) -------------------------
  try {
    const wifi = await helper.call('radio-get', { kind: 'WiFi' });
    const res = await ex.run([{ kind: 'radio', radio: 'WiFi', state: wifi }]);
    check('Wi-Fi control works (set to current state)', res[0].ok, res[0].detail || res[0].error);
    const bt = await helper.call('radio-get', { kind: 'Bluetooth' });
    const res2 = await ex.run([{ kind: 'radio', radio: 'Bluetooth', state: bt }]);
    check('Bluetooth control works (set to current state)', res2[0].ok, res2[0].detail || res2[0].error);
  } catch (err) {
    check('radios', false, err.message);
  }

  // --- Brightness: expected to be unsupported on a desktop monitor -------------------
  const br = await ex.run(parseCommand('brightness up').actions);
  check('"brightness up" gives a clear answer', br[0].ok || /monitor/.test(br[0].error), br[0].detail || br[0].error);

  // --- Chrome: open site, search, tabs ---------------------------------------------
  try {
    await say(ex, 'open youtube and search blockbuster telugu songs');
    const yt = await waitFor(ex, (f) => f.process === 'chrome' && /youtube/i.test(f.title) && /telugu/i.test(f.title), 12000);
    const fg = await ex.foreground();
    check('"open YouTube and search blockbuster Telugu songs"', !!yt, fg.title);
    if (yt) {
      await say(ex, 'new tab');
      const nt = await waitFor(ex, (f) => f.process === 'chrome' && /new tab/i.test(f.title), 4000);
      check('"new tab" opens a tab', !!nt, (await ex.foreground()).title);
      await say(ex, 'go to github.com');
      const gh = await waitFor(ex, (f) => f.process === 'chrome' && /github/i.test(f.title), 10000);
      check('"go to github.com" changes the URL', !!gh, (await ex.foreground()).title);
      await say(ex, 'previous tab');
      const prev = await waitFor(ex, (f) => /telugu/i.test(f.title), 4000);
      check('"previous tab" switches back', !!prev, (await ex.foreground()).title);
      await say(ex, 'next tab');
      const nxt = await waitFor(ex, (f) => /github/i.test(f.title), 4000);
      check('"next tab" switches forward', !!nxt, (await ex.foreground()).title);
      if (/github/i.test((await ex.foreground()).title)) await say(ex, 'close tab');
      await sleep(500);
      if (/telugu/i.test((await ex.foreground()).title)) await say(ex, 'close tab');
      await sleep(500);
    }
    const play = await ex.run(parseCommand('play naatu naatu').actions);
    const video = await waitFor(ex, (f) => f.process === 'chrome' && /naatu/i.test(f.title), 12000);
    check('"play naatu naatu" opens a video', play[0].ok && /watch\?v=/.test(play[0].detail) && !!video, play[0].detail);
    await sleep(1500);
    await say(ex, 'pause');
    await sleep(300);
    if (/naatu/i.test((await ex.foreground()).title)) await say(ex, 'close tab');
  } catch (err) {
    check('chrome flow', false, err.message);
  }

  // --- Open by name ------------------------------------------------------------------
  try {
    await say(ex, 'open calculator');
    const calc = await waitFor(ex, (f) => /calculator/i.test(f.title), 8000);
    check('"open calculator"', !!calc);
    if (calc) await say(ex, 'close calculator');
    await sleep(800);
    const gone = !(await helper.call('windows')).some((w) => /^calculator$/i.test(w.title));
    check('"close calculator"', gone);
    await say(ex, 'open downloads');
    const dl = await waitFor(ex, (f) => /downloads/i.test(f.title), 8000);
    check('"open downloads" opens the folder', !!dl, (await ex.foreground()).title);
    if (dl) await say(ex, 'close downloads');
    await say(ex, 'open settings');
    const st = await waitFor(ex, (f) => /settings/i.test(f.title), 8000);
    check('"open settings"', !!st, (await ex.foreground()).title);
    if (st) await say(ex, 'close settings');
  } catch (err) {
    check('open-by-name flow', false, err.message);
  }

  try { execFileSync('powershell.exe', ['-NoProfile', '-Command', 'Set-Clipboard -Value $args[0]', savedClipboard || ' '], { windowsHide: true }); } catch {}
  helper.stop();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} real action checks passed`);
  process.exit(failed ? 1 : 0);
})();
