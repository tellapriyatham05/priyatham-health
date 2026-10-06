// End-to-end test: plays recorded voice clips through the REAL app (mic path,
// voice detection, wake word, both Whisper models, parser, assistant, executor)
// with the executor in dry-run mode, so nothing is actually opened or restarted.
// Run: node tests/e2e.test.js   (clips are made with Windows' built-in voices)
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const clipDir = path.join(os.tmpdir(), 'jarvis-e2e');
const outFile = path.join(os.tmpdir(), 'jarvis-e2e-results.json');
const listFile = path.join(os.tmpdir(), 'jarvis-e2e-clips.json');

const act = (c, i = 0) => (c.commands[0] && c.commands[0].actions[i]) || {};
const noCommand = (c) => c.commands.length === 0;

// name, expectation, optional wait before playing (to let earlier windows expire)
const PLAN = [
  ['open_yt', (c) => act(c).kind === 'open' && act(c).target === 'youtube'],
  ['wake_only', (c) => noCommand(c) && c.mode === 'awake'],
  ['then_notepad', (c) => act(c).kind === 'open' && act(c).target === 'notepad'],
  ['search_yt', (c) => act(c).kind === 'search' && act(c).engine === 'youtube' && /blockbuster tel[eu]gu songs/i.test(act(c).query)],
  ['enter', (c) => act(c).kind === 'key' && act(c).keys.join('+') === 'enter'],
  ['click_enter', (c) => act(c).kind === 'key' && act(c).keys.join('+') === 'enter'],
  ['restart', (c) => c.mode === 'confirm' && act(c).op === 'restart' && !(c.commands[0].results || []).length],
  ['yes', (c) => c.commands[0] && c.commands[0].text === 'yes' && act(c).op === 'restart' && c.commands[0].results[0].ok],
  ['shutdown', (c) => c.mode === 'confirm' && act(c).op === 'shutdown'],
  ['no', (c) => c.commands[0] && c.commands[0].cancelled],
  ['follow_open', (c) => act(c).kind === 'open' && act(c).target === 'gmail', 3500],
  ['follow_next', (c) => act(c).kind === 'key' && act(c).keys.join('+') === 'ctrl+tab'],
  ['neg_stuff', noCommand, 9000],
  ['neg_study', noCommand],
  ['neg_open', noCommand],
  ['browser_slack', (c) => act(c).target === 'browser' && act(c, 1).target === 'slack'],
  ['wifi', (c) => act(c).kind === 'radio' && act(c).state === 'Off'],
  ['type', (c) => act(c).kind === 'type' && act(c).text === 'Hello World' && act(c, 1).kind === 'key'],
  ['volume', (c) => act(c).kind === 'volume' && act(c).op === 'up'],
  ['wallpaper', (c) => act(c).kind === 'wallpaper'],
  ['nexttab', (c) => act(c).kind === 'key' && act(c).keys.join('+') === 'ctrl+tab'],
  ['search_only', (c) => c.mode === 'awake' && act(c).kind === 'incomplete', 9000],
  ['search_rest', (c) => act(c).kind === 'search' && /cricket scores/i.test(act(c).query)],
  ['chrome_search', (c) => act(c).target === 'chrome' && act(c, 1).kind === 'search' && /weather in hyderabad/i.test(act(c, 1).query)],
  ['play', (c) => act(c).kind === 'play' && /believer/i.test(act(c).query)],

  // v2 features
  ['v2_time', (c) => act(c).kind === 'time' && ok0(c), 9000],
  ['v2_timer', (c) => act(c).kind === 'timer' && act(c).op === 'add' && ok0(c)],
  ['v2_remind', (c) => act(c).kind === 'timer' && act(c).op === 'remind' && /drink water/i.test(act(c).label) && ok0(c)],
  ['v2_timers', (c) => act(c).kind === 'timer' && act(c).op === 'list'],
  ['v2_dict_start', (c) => act(c).kind === 'dictation' && c.mode === 'dictating', 9000],
  ['v2_dict_text', (c) => c.mode === 'dictating' && /dictation.*hello, this is a dictation test/i.test((c.commands[0] && c.commands[0].text) || '')],
  ['v2_dict_stop', (c) => c.mode === 'sleeping' && noCommand(c)],
  ['v2_click', (c) => act(c).kind === 'clickName' && /subscribe/i.test(act(c).target), 9000],
  ['v2_numbers', (c) => act(c).kind === 'numbers' && act(c).op === 'show' && c.mode === 'choosing', 9000],
  ['v2_pick', (c) => act(c).kind === 'clickNumber' && act(c).n === 2 && ok0(c)],
  ['v2_rec_start', (c) => act(c).kind === 'record' && act(c).op === 'start', 9000],
  ['v2_rec_1', (c) => act(c).kind === 'open' && ok0(c)],
  ['v2_rec_2', (c) => act(c).kind === 'volume' && ok0(c)],
  ['v2_rec_save', (c) => act(c).kind === 'record' && act(c).op === 'save' && /test routine/i.test(act(c).name)],
  ['v2_rec_run', (c) => act(c).kind === 'custom' && ok0(c), 9000],
  ['v2_task', (c) => act(c).kind === 'focusdot' && act(c).op === 'add' && /finish editing/i.test(act(c).title), 9000],
  ['v2_tasks', (c) => act(c).kind === 'focusdot' && act(c).op === 'list'],
  ['v2_snap', (c) => act(c).kind === 'key' && act(c).keys.join('+') === 'win+left'],

  // hide / show on screen: the window really goes invisible, then comes back
  ['v3_hide', (c) => act(c).kind === 'visibility' && c.hidden === true, 9000],
  ['v3_show', (c) => act(c).kind === 'visibility' && c.hidden === false, 9000],

  // JARVIS: chat, apps, battery, "quit" flies him off the screen, and he still answers every call after that
  ['v4_hello', (c) => act(c).kind === 'chat', 9000],
  ['v4_whatsapp', (c) => act(c).kind === 'open' && act(c).target === 'whatsapp', 9000],
  ['v4_battery', (c) => act(c).kind === 'sysinfo' && ok0(c), 9000],
  ['v4_quit', (c) => act(c).kind === 'visibility' && c.hidden === true, 9000],
  ['v4_again', (c) => act(c).kind === 'time' && c.hidden === false, 9000],
  ['v4_again2', (c) => act(c).kind === 'volume' && act(c).op === 'down', 9000],
];

// --live really opens Calculator and a YouTube tab, then closes them again.
function ok0(c) { return okFirst(c); }
const okFirst = (c) => c.commands[0] && (c.commands[0].results || []).length && c.commands[0].results.every((r) => r.ok);
const LIVE_PLAN = [
  ['live_calc', (c) => act(c).kind === 'open' && ok0(c)],
  ['live_calc_close', (c) => act(c).kind === 'closeApp' && ok0(c), 2500],
  ['live_yt', (c) => act(c).kind === 'search' && /lofi music/i.test(act(c).query) && ok0(c), 9000],
  ['live_close_tab', (c) => act(c).kind === 'key' && ok0(c), 5000],
];
const LIVE = process.argv.includes('--live');
const plan = LIVE ? LIVE_PLAN : PLAN;

if (!fs.existsSync(path.join(clipDir, 'open_yt.wav'))) {
  console.log(`Missing clips in ${clipDir}. Generate them first (see tests/make-clips.ps1).`);
  process.exit(1);
}
fs.writeFileSync(listFile, JSON.stringify(plan.map(([name, , waitMs]) => ({ name, file: path.join(clipDir, `${name}.wav`), waitMs }))));
try { fs.unlinkSync(outFile); } catch {}

// --exe=<path> tests a packaged build instead of the source folder.
const exeArg = process.argv.find((a) => a.startsWith('--exe='));
const [cmd, args] = exeArg ? [exeArg.slice(6), []] : [require(path.join(root, 'node_modules', 'electron')), ['.']];
const run = spawnSync(cmd, args, {
  cwd: root,
  env: { ...process.env, JARVIS_TEST_CLIPS: listFile, JARVIS_TEST_OUT: outFile, JARVIS_DRY_RUN: LIVE ? '0' : '1' },
  encoding: 'utf8',
  timeout: 600000, // 57 clips with pauses between them take about 6 minutes
});
if (!fs.existsSync(outFile)) {
  console.log('App did not produce results.\n', (run.stdout || '').slice(-3000), (run.stderr || '').slice(-3000));
  process.exit(1);
}
const results = JSON.parse(fs.readFileSync(outFile, 'utf8'));
let failed = 0;
for (const [name, expect] of plan) {
  const c = results.find((r) => r.name === name);
  const ok = !!c && (() => { try { return expect(c); } catch { return false; } })();
  if (!ok) failed++;
  const what = c ? c.commands.map((cmd) => (cmd.cancelled ? 'cancelled' : cmd.actions.map((a) => [a.kind, a.target || a.query || a.text || (a.keys && a.keys.join('+')) || a.op || a.state || ''].filter(Boolean).join(':')).join(' | '))).join(' / ') || '(no command)' : 'missing';
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(14)} heard: ${JSON.stringify(c ? c.heard.join(' / ') : '')}  →  ${what}  [mode after: ${c && c.mode}]`);
}
console.log(`\n${plan.length - failed}/${plan.length} end-to-end ${LIVE ? 'LIVE ' : ''}voice checks passed`);
process.exit(failed ? 1 : 0);

