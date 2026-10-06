// Timers ring on time, survive a restart, and can be cancelled. Run: node tests/timers.test.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Timers } = require('../brain/timers');
const { dictationText } = require('../brain/assistant');

const file = path.join(os.tmpdir(), `jarvis-timers-test-${process.pid}.json`);
let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const rang = [];
  const a = new Timers({ file, onDue: (t) => rang.push({ ...t, when: Date.now() }) });
  a.load();
  const start = Date.now();
  a.add({ kind: 'timer', at: start + 1200, label: 'short timer' });
  a.add({ kind: 'reminder', at: start + 60000, label: 'drink water' });
  a.add({ kind: 'reminder', at: start + 120000, label: 'call mom' });
  check('three items listed', a.list().length === 3);
  await sleep(1600);
  check('timer rang on time', rang.length === 1 && rang[0].label === 'short timer' && Math.abs(rang[0].when - (start + 1200)) < 250,
    rang[0] ? `${rang[0].when - start} ms` : 'did not ring');
  check('rung timer removed', a.list().length === 2);

  // "Restart": a new Timers reads the same file.
  for (const h of a.handles.values()) clearTimeout(h);
  const b = new Timers({ file, onDue: () => {} });
  check('reminders survive a restart', b.load() === 2 && b.list().map((t) => t.label).join(',') === 'drink water,call mom');
  const gone = b.cancel({ kind: 'reminder', name: 'water' });
  check('cancel by name', gone.length === 1 && b.list().length === 1 && b.list()[0].label === 'call mom');
  b.cancel({ kind: 'all' });
  check('cancel all', b.list().length === 0);

  // Reminders that came due while the PC was off are announced after start-up.
  fs.writeFileSync(file, JSON.stringify([{ id: 'x', kind: 'reminder', at: Date.now() - 60000, label: 'missed one' }]));
  const missed = [];
  const c = new Timers({ file, onDue: (t) => missed.push(t) });
  c.load();
  await sleep(8300);
  check('missed reminder announced after start', missed.length === 1 && missed[0].missed === true && missed[0].label === 'missed one');

  // Dictation turns spoken punctuation into symbols.
  const d = dictationText('hello comma how are you question mark new line see you full stop');
  check('dictation punctuation', d === 'hello, how are you?\nsee you. ', JSON.stringify(d));

  try { fs.unlinkSync(file); } catch {}
  console.log(`\n${failed ? 'SOME FAILED' : 'all timer checks passed'}`);
  process.exit(failed ? 1 : 0);
})();
