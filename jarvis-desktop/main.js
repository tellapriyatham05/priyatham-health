// JARVIS — local voice control for Windows. Say "Jarvis" and a command; Iron Man flies in and does it.
// Built on Stuffy (same listening engine, conversation flow and actions).
// main.js wires the pieces together: mic (overlay window) → speech engine
// (utility process) → assistant (brain/) → executor (system/) → overlay feedback.
const { app, BrowserWindow, ipcMain, screen, globalShortcut, Tray, Menu, nativeImage, utilityProcess, session, shell, Notification, dialog } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { WinHelper } = require('./system/helper');
const { Executor } = require('./system/executor');
const { setAutoStart } = require('./system/autostart');
const { Assistant } = require('./brain/assistant');
const { parseCommand } = require('./brain/parser');
const { Timers, describeDuration, describeTime } = require('./brain/timers');

const HOTKEYS = ['Control+Alt+J', 'Control+Shift+Alt+J', 'F9'];
const LANGUAGES = [
  ['en', 'English'],
  ['auto', 'Auto-detect (English / Hindi / Telugu)'],
  ['hi', 'Hindi'],
  ['te', 'Telugu'],
];
const DEFAULT_CUSTOM = {
  'work mode': ['open chrome', 'open slack', 'open gmail'],
  'music time': ['open youtube music', 'volume 40'],
};

const TEST = {
  clips: process.env.JARVIS_TEST_CLIPS, // JSON list of { file } played through the engine
  out: process.env.JARVIS_TEST_OUT,
  dryRun: process.env.JARVIS_DRY_RUN === '1',
};

let overlay = null;
let tray = null;
let engine = null;
let engineReady = false;
let hotkey = null;
let helper = null;
let executor = null;
let assistant = null;
let voice = null;
let voiceReady = false;
let timers = null;
let numbersWin = null;
let editorWin = null;
let settings = { language: 'en', sound: true, browser: 'chrome', wallpaperFolder: '', voice: 'chatty', voiceName: 'george', openAtLogin: true, hidden: false, size: 'medium', bubble: true, picture: null, homePos: null };
let custom = {};
const refineWaiters = new Map();
const testLog = [];

const dataFile = (name) => path.join(app.getPath('userData'), name);

// Files edited by hand (e.g. in Notepad) may start with a byte-order mark.
const readJson = (name) => JSON.parse(fs.readFileSync(dataFile(name), 'utf8').replace(/^﻿/, ''));

function loadSettings() {
  try { settings = { ...settings, ...readJson('settings.json') }; } catch { /* first run */ }
  if (fs.existsSync(dataFile('custom-commands.json'))) {
    try { custom = readJson('custom-commands.json'); } catch (err) { custom = {}; log(`custom-commands.json has a mistake: ${err.message}`); }
  } else {
    custom = DEFAULT_CUSTOM;
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(dataFile('custom-commands.json'), JSON.stringify(DEFAULT_CUSTOM, null, 2));
  }
  custom = Object.fromEntries(Object.entries(custom).map(([k, v]) => [k.toLowerCase().trim(), v]));
}

function saveSettings() {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(dataFile('settings.json'), JSON.stringify(settings, null, 2));
}

function log(line) {
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  fs.appendFile(dataFile('jarvis.log'), `${stamp}  ${line}\n`, () => {});
  if (!app.isPackaged) console.log(line);
}

function show(display) {
  // Calling "Jarvis" while he is off the screen brings him flying back.
  if (settings.hidden && ['listening', 'thinking', 'confirm'].includes(display.dot)) setHidden(false);
  if (overlay && !overlay.isDestroyed()) overlay.webContents.send('display', { soundOn: settings.sound, ...display });
  if (display.keep) return; // just a sound, nothing else changes
  const trayState = { listening: 'listening', speaking: 'listening', confirm: 'listening', thinking: 'thinking', error: 'error', paused: 'paused' }[display.dot] || 'idle';
  setTray(trayState);
}

// ------------------------------------------------------------------ tray
function circleIcon(rgb, hollow = false) {
  const size = 32;
  const buf = Buffer.alloc(size * size * 4);
  const c = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - c, y + 0.5 - c);
      let a = Math.max(0, Math.min(1, 13 - d));
      if (hollow) a *= Math.max(0, Math.min(1, d - 8));
      const i = (y * size + x) * 4;
      buf[i] = rgb[2]; buf[i + 1] = rgb[1]; buf[i + 2] = rgb[0]; buf[i + 3] = Math.round(a * 255);
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

const ICONS = {};
const TRAY_TIPS = { idle: 'say "Jarvis" + a command', listening: 'listening', thinking: 'working', error: 'problem', paused: 'paused' };
function setTray(state) {
  if (!tray || tray.isDestroyed()) return;
  tray.setImage(ICONS[state] || ICONS.idle);
  tray.setToolTip(`Jarvis — ${TRAY_TIPS[state] || state}${settings.hidden ? ' (hidden)' : ''}`);
}

const prettyHotkey = () => (hotkey || '').replace('Control', 'Ctrl').replace(/\+/g, ' + ');

function buildTrayMenu() {
  const paused = assistant && assistant.paused;
  return Menu.buildFromTemplate([
    { label: `Listen for a command now (${prettyHotkey()})`, click: () => assistant && assistant.wake() },
    { label: settings.hidden ? 'Bring Jarvis back on screen' : 'Send Jarvis off the screen (keeps listening)', click: () => setHidden(!settings.hidden) },
    { label: paused ? 'Resume listening for "Jarvis"' : 'Pause listening', click: () => { assistant.setPaused(!paused); tray.setContextMenu(buildTrayMenu()); } },
    { type: 'separator' },
    {
      label: 'Language for typing & searches',
      submenu: LANGUAGES.map(([code, name]) => ({
        label: name,
        type: 'radio',
        checked: settings.language === code,
        click: () => {
          settings.language = code;
          saveSettings();
          engine.postMessage({ type: 'language', language: code });
        },
      })),
    },
    {
      label: 'Open websites in',
      submenu: [['chrome', 'Google Chrome'], ['default', 'Default browser']].map(([v, name]) => ({
        label: name, type: 'radio', checked: settings.browser === v,
        click: () => { settings.browser = v; saveSettings(); },
      })),
    },
    {
      label: "Jarvis's voice",
      submenu: [
        ...[['george', 'George — British (like the films)'], ['lewis', 'Lewis — British, deeper'], ['daniel', 'Daniel — British, calm'], ['fable', 'Fable — British, younger'], ['michael', 'Michael — American']].map(([v, name]) => ({
          label: name, type: 'radio', checked: settings.voiceName === v,
          click: () => { settings.voiceName = v; saveSettings(); if (voice) voice.postMessage({ type: 'voice', name: v }); speak('Voice changed, sir.', { level: 'answer' }); },
        })),
        { type: 'separator' },
        ...[['chatty', 'Talks every time'], ['short', 'Answers and questions only'], ['silent', 'Silent — beeps only']].map(([v, name]) => ({
          label: name, type: 'radio', checked: settings.voice === v,
          click: () => { settings.voice = v; saveSettings(); },
        })),
      ],
    },
    {
      label: 'Iron Man on screen',
      submenu: [
        { label: 'Choose my Iron Man picture…', click: choosePicture },
        { label: 'Use the built-in Iron Man', type: 'radio', checked: !settings.picture, click: () => { settings.picture = null; saveSettings(); sendLook({ picture: null }); } },
        { type: 'separator' },
        ...[['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']].map(([v, name]) => ({
          label: name, type: 'radio', checked: settings.size === v,
          click: () => { settings.size = v; saveSettings(); sendLook({ size: v }); },
        })),
        { type: 'separator' },
        { label: 'Show what I heard (text bubble)', type: 'checkbox', checked: settings.bubble !== false, click: (i) => { settings.bubble = i.checked; saveSettings(); sendLook({}); } },
      ],
    },
    { label: 'Sounds', type: 'checkbox', checked: settings.sound, click: (i) => { settings.sound = i.checked; saveSettings(); } },
    {
      label: 'Start with Windows',
      type: 'checkbox',
      checked: settings.openAtLogin !== false,
      enabled: app.isPackaged,
      click: (i) => { settings.openAtLogin = i.checked; saveSettings(); setAutoStart(app, i.checked, log); },
    },
    {
      label: 'Move Jarvis back to the corner',
      click: () => { settings.homePos = null; saveSettings(); sendLook({ home: null }); },
    },
    { type: 'separator' },
    { label: 'What can I say?', click: () => assistant && assistant.handleCommand('help', 0, {}) },
    { label: 'My commands & routines…', click: openEditor },
    { label: 'Open activity log', click: () => shell.openPath(dataFile('jarvis.log')) },
    { type: 'separator' },
    { label: 'Quit Jarvis (comes back at next sign-in)', click: quitByUser },
  ]);
}

function quitByUser() {
  // Stay closed until the next sign-in instead of the keep-alive task reopening it.
  settings.quitByUser = true;
  saveSettings();
  app.quit();
}

// ------------------------------------------------------------------ voice
// Jarvis's spoken replies. Chatty = everything, Short = answers & questions, Silent = none.
// The microphone is ignored while Jarvis talks so it doesn't hear itself.
let speakId = 0;
let micMutedUntil = 0;
const speakQueue = [];
let speaking = false;

function startVoice() {
  voice = utilityProcess.fork(path.join(__dirname, 'voice.js'), [], {
    serviceName: 'Jarvis voice',
    stdio: 'pipe',
    env: { ...process.env, JARVIS_MODELS: modelsDir(), JARVIS_VOICE: settings.voiceName || 'george' },
  });
  voice.stderr.on('data', (d) => log(`[voice] ${String(d).trim()}`));
  voice.on('message', (msg) => {
    if (msg.type === 'ready') {
      voiceReady = true;
      log(`voice ready in ${msg.ms} ms`);
      if (process.env.JARVIS_SAY) speak(process.env.JARVIS_SAY, { level: 'answer' }); // voice self-test
      nextSpeech();
    }
    else if (msg.type === 'audio') playSpeech(msg);
    else if (msg.type === 'log') log(`voice: ${msg.message}`);
    else if (msg.type === 'error') { log(`voice error: ${msg.message}`); speaking = false; nextSpeech(); }
  });
  voice.on('exit', (code) => {
    voiceReady = false;
    if (!app.isQuitting) { log(`voice stopped (${code}), restarting`); setTimeout(startVoice, 3000); }
  });
}

function speak(text, { level = 'chat' } = {}) {
  if (!text || !voice || TEST.clips) return;
  if (settings.voice === 'silent' || (settings.voice === 'short' && level !== 'answer')) return;
  speakQueue.push({ id: ++speakId, text });
  if (speakQueue.length > 3) speakQueue.splice(0, speakQueue.length - 3); // don't fall far behind
  nextSpeech();
}

function nextSpeech() {
  if (speaking || !speakQueue.length || !voiceReady) return;
  speaking = true;
  const { id, text } = speakQueue.shift();
  voice.postMessage({ type: 'say', id, text });
}

function playSpeech({ id, samples, sampleRate }) {
  const rate = sampleRate;
  micMutedUntil = Date.now() + (samples.length / rate) * 1000 + 600;
  if (overlay && !overlay.isDestroyed()) overlay.webContents.send('speak', { id, samples, sampleRate: rate });
  else { speaking = false; nextSpeech(); }
}

// ------------------------------------------------------------------ numbers on screen
function showNumbers(items) {
  if (!items.length) return hideNumbers();
  // UI Automation gives real pixels; Electron windows use scaled (DIP) coordinates.
  const first = screen.screenToDipPoint({ x: items[0].x, y: items[0].y });
  const display = screen.getDisplayNearestPoint(first);
  const b = display.bounds;
  if (!numbersWin || numbersWin.isDestroyed()) {
    numbersWin = new BrowserWindow({
      ...b, frame: false, transparent: true, resizable: false, skipTaskbar: true, focusable: false,
      alwaysOnTop: true, hasShadow: false, show: false,
      webPreferences: { preload: path.join(__dirname, 'preload-small.js') },
    });
    numbersWin.setAlwaysOnTop(true, 'screen-saver');
    numbersWin.setIgnoreMouseEvents(true);
    numbersWin.loadFile(path.join(__dirname, 'renderer', 'numbers.html'));
  } else {
    numbersWin.setBounds(b);
  }
  const placed = items.map((it) => {
    const p = screen.screenToDipPoint({ x: it.x, y: it.y });
    return { n: it.n, x: p.x - b.x, y: p.y - b.y };
  });
  const send = () => { numbersWin.webContents.send('numbers', placed); numbersWin.showInactive(); };
  if (numbersWin.webContents.isLoading()) numbersWin.webContents.once('did-finish-load', send);
  else send();
}

function hideNumbers() {
  if (numbersWin && !numbersWin.isDestroyed()) numbersWin.hide();
}

// ------------------------------------------------------------------ my commands & routines editor
function saveCustom(commands) {
  const copy = { ...commands }; // may be the same object as `custom`
  for (const k of Object.keys(custom)) delete custom[k];
  Object.assign(custom, copy);
  if (TEST.clips) return; // self-tests never change your saved commands
  fs.writeFileSync(dataFile('custom-commands.json'), JSON.stringify(custom, null, 2));
}

function openEditor() {
  if (editorWin && !editorWin.isDestroyed()) { editorWin.show(); editorWin.focus(); return; }
  editorWin = new BrowserWindow({
    width: 620, height: 680, minWidth: 460, minHeight: 400, title: 'Jarvis — my commands & routines',
    autoHideMenuBar: true, icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload-small.js') },
  });
  editorWin.loadFile(path.join(__dirname, 'renderer', 'editor.html'));
}

function wireEditor() {
  ipcMain.handle('editor-load', () => custom);
  ipcMain.handle('editor-save', (_e, commands) => { saveCustom(commands); return true; });
  ipcMain.handle('editor-test', (_e, line) => {
    const { actions, unknown } = parseCommand(line, { custom: {} });
    return { ok: !unknown.length && actions.length > 0 && !actions.some((a) => a.kind === 'incomplete'), say: actions.map((a) => a.say).join(', ') };
  });
  ipcMain.handle('editor-run', (_e, name) => assistant.handleCommand(name, 0, { heard: name }));
}

// ------------------------------------------------------------------ timers & reminders
function timerAction(a) {
  if (a.op === 'add' || a.op === 'remind') {
    const at = a.at || Date.now() + a.durationMs;
    const label = a.op === 'add' ? `${describeDuration(a.durationMs)} timer` : a.label;
    if (!TEST.dryRun) timers.add({ kind: a.op === 'add' ? 'timer' : 'reminder', at, label, durationMs: a.durationMs });
    const when = a.at ? describeTime(new Date(at)) : `in ${describeDuration(a.durationMs)}`;
    return a.op === 'add'
      ? { detail: `⏱ ${describeDuration(a.durationMs)} — rings at ${describeTime(new Date(at))}`, speak: `Timer set for ${describeDuration(a.durationMs)}.` }
      : { detail: `⏰ "${a.label}" — ${when}`, speak: `Okay, I'll remind you ${when}.` };
  }
  if (a.op === 'list') {
    const items = timers.list();
    if (!items.length) return { detail: 'No timers or reminders', speak: 'You have no timers or reminders.' };
    const lines = items.map((t) => `${t.kind === 'timer' ? '⏱' : '⏰'} ${t.label} — ${describeTime(new Date(t.at))} (${describeDuration(t.at - Date.now())} left)`);
    const first = items[0];
    return { detail: lines.join('\n'), speak: `You have ${items.length}. Next: ${first.label}, in ${describeDuration(first.at - Date.now())}.` };
  }
  if (a.op === 'cancel') {
    const gone = TEST.dryRun ? [] : timers.cancel({ kind: a.which, name: a.name });
    if (!gone.length && !TEST.dryRun) throw new Error(`There's no ${a.which} to cancel`);
    return { detail: `Cancelled ${gone.length || ''} ${a.which}${gone.length === 1 ? '' : 's'}`, speak: 'Cancelled.' };
  }
  throw new Error('Unknown timer command');
}

function onTimerDue(item) {
  log(`due: ${item.kind} ${item.label}`);
  if (assistant) assistant.announce(item);
  if (Notification.isSupported()) {
    new Notification({ title: item.kind === 'timer' ? "⏰ Jarvis: time's up" : '⏰ Jarvis reminder', body: item.label, silent: true }).show();
  }
}

function createTray() {
  ICONS.idle = circleIcon([90, 98, 110]);
  ICONS.listening = circleIcon([34, 197, 94]);
  ICONS.thinking = circleIcon([59, 130, 246]);
  ICONS.error = circleIcon([239, 68, 68]);
  ICONS.paused = circleIcon([120, 120, 120], true);
  tray = new Tray(ICONS.idle);
  setTray('idle');
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', () => assistant && assistant.wake());
}

// ------------------------------------------------------------------ overlay (also owns the mic)
// One see-through window over the whole screen (above the taskbar) is JARVIS's sky: he can fly
// anywhere. It ignores the mouse except when the pointer is over him.
function skyBounds() {
  return screen.getPrimaryDisplay().workArea;
}

function createOverlay() {
  overlay = new BrowserWindow({
    ...skyBounds(),
    frame: false, transparent: true, backgroundColor: '#00000000', resizable: false, skipTaskbar: true,
    focusable: false, // never steal focus from the app you're talking to
    alwaysOnTop: true, hasShadow: false, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false },
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setIgnoreMouseEvents(true, { forward: true });
  overlay.loadFile(path.join(__dirname, 'renderer', 'overlay.html'));
  // Page errors go to jarvis.log, which is the only place to see them.
  overlay.webContents.on('console-message', (e) => {
    if ((e.level === 'error' || e.level === 'warning') && !app.isQuitting) log(`[overlay] ${e.message}`);
  });
  overlay.webContents.on('preload-error', (_e, file, err) => log(`[overlay preload] ${file}: ${err}`));
  overlay.once('ready-to-show', () => {
    overlay.showInactive();
    sendLook({ picture: loadPicture(), size: settings.size, home: settings.homePos || null, arrive: !settings.hidden });
    show({ dot: 'loading', label: 'JARVIS is starting up…', text: 'Loading the speech engine' });
  });
  const fit = () => { if (overlay && !overlay.isDestroyed()) overlay.setBounds(skyBounds()); };
  screen.on('display-metrics-changed', fit);
  screen.on('display-added', fit);
  screen.on('display-removed', fit);
}

// Tell the overlay how JARVIS should look (picture, size, where he lives, text bubble).
function sendLook(look) {
  if (overlay && !overlay.isDestroyed()) overlay.webContents.send('look', { bubble: settings.bubble !== false, ...look });
}

function loadPicture() {
  const pic = settings.picture;
  if (!pic || !pic.file) return null;
  try {
    const data = fs.readFileSync(dataFile(pic.file));
    return { src: `data:image/png;base64,${data.toString('base64')}`, framed: !!pic.framed };
  } catch {
    return null;
  }
}

// Your own Iron Man picture: the overlay removes a plain background, we keep the result.
async function choosePicture() {
  const res = await dialog.showOpenDialog({
    title: 'Choose your Iron Man picture (a plain or white background works best)',
    properties: ['openFile'],
    filters: [{ name: 'Pictures', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }],
  });
  if (res.canceled || !res.filePaths.length) return;
  const file = res.filePaths[0];
  const ext = path.extname(file).slice(1).toLowerCase().replace('jpg', 'jpeg');
  const src = `data:image/${ext};base64,${fs.readFileSync(file).toString('base64')}`;
  show({ dot: 'thinking', label: 'Preparing your Iron Man…', text: 'Removing the background', activity: 'scan' });
  overlay.webContents.send('prepare-image', src);
}

function savePicture({ ok, src, framed, error }) {
  if (!ok) {
    show({ dot: 'error', label: "Couldn't use that picture", text: error, hideAfter: 6000, sound: 'error' });
    return;
  }
  fs.writeFileSync(dataFile('character.png'), Buffer.from(src.split(',')[1], 'base64'));
  settings.picture = { file: 'character.png', framed: !!framed };
  saveSettings();
  sendLook({ picture: loadPicture() });
  show({ dot: 'done', label: 'Looking sharp, sir', text: framed ? 'The background was busy, so I kept it in a frame. A picture on a plain background looks best.' : 'Background removed', hideAfter: 6000, sound: 'ok' });
  if (tray && !tray.isDestroyed()) tray.setContextMenu(buildTrayMenu());
}

// The older Python JARVIS kept its background-free picture here: reuse it on first start.
function importOldPicture() {
  if (settings.picture || settings.importedOld) return;
  settings.importedOld = true;
  try {
    const old = JSON.parse(fs.readFileSync(dataFile('config.json'), 'utf8'));
    const cut = old.char_cutout && fs.existsSync(old.char_cutout) ? old.char_cutout : null;
    if (cut) {
      fs.copyFileSync(cut, dataFile('character.png'));
      settings.picture = { file: 'character.png', framed: false };
      log(`using your picture from the old JARVIS: ${cut}`);
    }
  } catch { /* no old JARVIS */ }
  saveSettings();
}

// Make sure the old Python JARVIS isn't running too (two JARVISes would both answer).
function retireOldJarvis() {
  if (process.platform !== 'win32' || !app.isPackaged || TEST.clips) return;
  execFile('taskkill', ['/F', '/IM', 'JARVIS.exe'], { windowsHide: true }, () => {});
  execFile('reg', ['delete', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', 'JARVIS', '/f'], { windowsHide: true }, () => {});
}

// Hide / show JARVIS. Hidden = he flies off the screen but keeps listening; saying
// "Jarvis" (or the hotkey, or the tray icon) brings him back.
function setHidden(hidden) {
  settings.hidden = !!hidden;
  if (!TEST.clips) saveSettings();
  if (overlay && !overlay.isDestroyed()) overlay.webContents.send('visibility', settings.hidden);
  log(settings.hidden ? 'Jarvis flew off the screen' : 'Jarvis is back on screen');
  if (tray && !tray.isDestroyed()) { tray.setContextMenu(buildTrayMenu()); setTray('idle'); }
}

function wireOverlay() {
  ipcMain.on('pointer-over', (_e, over) => {
    if (overlay && !overlay.isDestroyed()) overlay.setIgnoreMouseEvents(!over, { forward: true });
  });
  ipcMain.on('home-moved', (_e, pos) => {
    settings.homePos = pos;
    saveSettings();
  });
  ipcMain.on('image-prepared', (_e, result) => savePicture(result));
  ipcMain.on('jarvis-click', () => assistant && assistant.wake());
  ipcMain.on('jarvis-menu', () => buildTrayMenu().popup({ window: overlay }));
}

// ------------------------------------------------------------------ speech engine
function startEngine() {
  engine = utilityProcess.fork(path.join(__dirname, 'engine.js'), [], {
    serviceName: 'Jarvis speech engine',
    stdio: 'pipe',
    env: { ...process.env, JARVIS_LANG: settings.language, JARVIS_MODELS: modelsDir() },
  });
  engine.stdout.on('data', (d) => log(`[engine] ${String(d).trim()}`));
  engine.stderr.on('data', (d) => log(`[engine] ${String(d).trim()}`));
  engine.on('message', onEngineMessage);
  engine.on('exit', (code) => {
    engineReady = false;
    if (!app.isQuitting) {
      show({ dot: 'error', label: 'Speech engine stopped', text: `Restarting… (code ${code})` });
      setTimeout(startEngine, 2000);
    }
  });
}

function modelsDir() {
  return app.isPackaged ? path.join(process.resourcesPath, 'models') : path.join(__dirname, 'models');
}

function refine(id) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { refineWaiters.delete(id); resolve(null); }, 10000);
    refineWaiters.set(id, (text) => { clearTimeout(timer); resolve(text); });
    engine.postMessage({ type: 'refine', id });
  });
}

function onEngineMessage(msg) {
  switch (msg.type) {
    case 'ready':
      engineReady = true;
      log(`engine ready in ${msg.ms} ms`);
      show({ dot: 'done', label: 'JARVIS online', text: `Say "Jarvis" and a command — or press ${prettyHotkey()}`, hideAfter: 5000 });
      if (!process.argv.includes('--background')) speak('Jarvis online. At your service, sir.', { level: 'answer' });
      if (TEST.clips) runTestClips();
      break;
    case 'accurate-ready':
      log('accurate model ready');
      break;
    case 'speech-start':
      if (assistant) assistant.onSpeechStart();
      break;
    case 'segment':
      log(`heard (${msg.sec}s, ${msg.ms} ms): ${msg.text}`);
      if (TEST.clips) testLog.push({ heard: msg.text });
      if (assistant) assistant.onSegment(msg).catch((err) => log(`assistant error: ${err.stack || err}`));
      break;
    case 'refined': {
      log(`refined (${msg.ms} ms): ${msg.text}${msg.error ? ' error ' + msg.error : ''}`);
      const waiter = refineWaiters.get(msg.id);
      if (waiter) { refineWaiters.delete(msg.id); waiter(msg.text); }
      break;
    }
    case 'language':
      show({ dot: 'done', label: 'Language changed', text: (LANGUAGES.find(([c]) => c === msg.language) || [])[1] || msg.language, hideAfter: 2500 });
      break;
    case 'error':
      log(`engine error: ${msg.message}`);
      show({ dot: 'error', label: 'Problem', text: msg.message, hideAfter: 10000, sound: 'error' });
      break;
  }
}

// ------------------------------------------------------------------ self-test mode
async function runTestClips() {
  const clips = JSON.parse(fs.readFileSync(TEST.clips, 'utf8'));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const results = [];
  for (const clip of clips) {
    if (clip.waitMs) await sleep(clip.waitMs);
    const before = assistant.history.length;
    const heardBefore = testLog.length;
    engine.postMessage({ type: 'test-wav', file: clip.file });
    // Wait for the utterance to be heard and fully handled.
    const start = Date.now();
    while (Date.now() - start < 15000) {
      await sleep(100);
      if (testLog.length > heardBefore && !assistant.busy && Date.now() - start > 1500) break;
    }
    await sleep(clip.settleMs || 1200);
    const handled = assistant.history.slice(before);
    results.push({
      name: clip.name,
      heard: testLog.slice(heardBefore).map((h) => h.heard),
      mode: assistant.mode,
      hidden: !!settings.hidden,
      commands: handled.map((h) => ({
        text: h.text,
        cancelled: !!h.cancelled,
        unknown: h.unknown || [],
        actions: (h.actions || []).map((a) => ({ kind: a.kind, keys: a.keys, target: a.target, query: a.query, text: a.text, op: a.op, state: a.state, engine: a.engine, label: a.label, n: a.n, name: a.name, title: a.title })),
        results: (h.results || []).map((r) => ({ ok: r.ok, error: r.error })),
      })),
    });
  }
  fs.writeFileSync(TEST.out, JSON.stringify(results, null, 2));
  app.quit();
}

// ------------------------------------------------------------------ startup
// Startup trace (synchronous, so it survives crashes): shows how each launch went.
function trace(...parts) {
  try {
    const file = path.join(app.getPath('userData'), 'startup.log');
    if (fs.existsSync(file) && fs.statSync(file).size > 100000) fs.rmSync(file);
    fs.appendFileSync(file, `${new Date().toISOString()} pid ${process.pid} ${parts.join(' ')}
`);
  } catch { /* never block startup on logging */ }
}
trace('launch', JSON.stringify(process.argv.slice(1)));

if (!app.requestSingleInstanceLock()) {
  trace('already running, exiting');
  app.quit();
} else {
  // The keep-alive task starts Jarvis every few minutes with --background: if it is
  // already running that must do nothing. Opening it from the Start menu wakes it.
  app.on('second-instance', (_e, argv) => {
    if (!argv.includes('--background') && assistant) assistant.wake();
  });
  app.whenReady().then(async () => {
    trace('ready');
    app.setAppUserModelId('com.priyatham.jarvis');
    loadSettings();
    importOldPicture();
    retireOldJarvis();

    // The keep-alive task must not bring Jarvis back after "Quit Jarvis"; signing in again does.
    const background = process.argv.includes('--background');
    const atLogin = process.argv.includes('--login');
    if (background && !atLogin && settings.quitByUser && !TEST.clips) return app.exit(0);
    if (settings.quitByUser) { settings.quitByUser = false; saveSettings(); }

    // Start with Windows + keep running (re-registered every start, which repairs it if removed).
    if (app.isPackaged && !TEST.clips && settings.openAtLogin !== false) setAutoStart(app, true, log);

    // Only our own overlay asks for the microphone; allow it without a prompt.
    session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'media'));

    trace('settings loaded');
    timers = new Timers({ file: dataFile('timers.json'), onDue: onTimerDue, log });
    helper = new WinHelper(app.isPackaged ? path.join(process.resourcesPath, 'system', 'helper.ps1') : undefined);
    executor = new Executor({
      helper, dryRun: TEST.dryRun, settings, custom, parse: parseCommand, log,
      hooks: { timers: timerAction, openEditor, showNumbers, hideNumbers, setHidden, quitApp: quitByUser },
    });
    assistant = new Assistant({ executor, refine, ui: show, speak, log, custom, saveCustom });
    helper.start().then(() => executor.loadApps()).then((n) => log(`found ${n} Start menu apps`)).catch((e) => log(`helper failed: ${e.message}`));

    trace('helpers created');
    hotkey = HOTKEYS.find((accel) => globalShortcut.register(accel, () => assistant.wake())) || null;
    trace('hotkey', hotkey);
    createTray();
    trace('tray');
    createOverlay();
    wireOverlay();
    wireEditor();
    trace('windows');
    startEngine();
    startVoice();
    trace('engines started');
    if (!TEST.clips) log(`${timers.load()} timers/reminders waiting`);
    trace('started ok');

    ipcMain.on('audio', (_e, samples) => {
      // Ignore the mic while Jarvis itself is talking.
      if (engine && engineReady && !TEST.clips && !assistant.paused && Date.now() > micMutedUntil) engine.postMessage({ type: 'audio', samples });
    });
    ipcMain.on('spoke', (_e, { error }) => {
      log(error ? `speech playback failed: ${error}` : 'spoke');
      micMutedUntil = Math.min(micMutedUntil, Date.now() + 400);
      speaking = false;
      nextSpeech();
    });
    let micProblem = false;
    ipcMain.on('mic-status', (_e, status) => {
      if (!status.ok) {
        log(`mic not available: ${status.message}`);
        if (!micProblem) show({ dot: 'error', label: 'Microphone not available', text: 'I\'ll keep trying — check that a mic is plugged in', hideAfter: 10000, sound: 'error' });
        micProblem = true;
      } else {
        log(`mic: ${status.device}`);
        if (micProblem) show({ dot: 'done', label: 'Microphone is back', text: '', hideAfter: 3000 });
        micProblem = false;
      }
    });
    ipcMain.on('mic-level', (_e, level) => log(`mic level (last minute peak): ${level}`));
  });

  app.on('before-quit', () => { app.isQuitting = true; });
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    if (engine) engine.kill();
    if (voice) voice.kill();
    if (helper) helper.stop();
  });
  app.on('window-all-closed', (e) => e.preventDefault());
}
