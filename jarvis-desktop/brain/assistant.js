// Jarvis's conversation flow, independent of Electron so it can be tested:
//
//   sleeping ──"Jarvis"──► awake ──command──► doing ──► following (8 s) ──► sleeping
//      ▲                     │                             │ more commands work
//      │                     ├─ "restart" ──► confirm ──"yes"──► doing
//      │                     ├─ "dictation" ──► dictating (everything is typed) ──"stop dictation"
//      │                     ├─ "show numbers" / same-named buttons ──► choosing ("click 7")
//      │                     └─ "stop recording" ──► naming ("morning routine")
//      └──────────────────────── timeouts / "cancel" ◄──────┘
const { detectWake, parseCommand, isYes, cleanText, toNumber } = require('./parser');

const AWAKE_MS = 8000;       // after "Jarvis", how long to wait for the command
const FOLLOW_MS = 8000;      // after a command, how long plain follow-ups work
const CONFIRM_MS = 10000;    // how long to wait for "yes"
const CHOOSE_MS = 30000;     // how long numbers stay on screen
const DICTATION_IDLE_MS = 20000;
const NAMING_MS = 12000;

const HELP = [
  'open YouTube / Chrome / any app · search … · play …',
  'type … · enter · dictation · click Subscribe · show numbers',
  'new tab · next tab · snap left · volume 50 · wifi off',
  'timer 5 minutes · remind me in 20 minutes to …',
  'add Q1 task … · what are my tasks · what time is it',
  'start recording … save as morning routine',
];

// Actions that are about Jarvis itself, not recorded into routines.
const NOT_RECORDED = new Set(['record', 'editor', 'visibility', 'numbers', 'clickNumber', 'dictation', 'time', 'help', 'cancel', 'stopListening', 'chat', 'sysinfo', 'quitApp']);
// Commands that only count when you say "Jarvis" first (never as a follow-up).
const STRICT_NEEDS_NAME = new Set(['incomplete', 'cancel', 'stopListening', 'dictation', 'chat', 'visibility', 'quitApp', 'power', 'record']);
// Small actions that just get a squeak instead of words.
const QUIET = new Set(['key', 'mouse', 'sequence', 'type', 'clickNumber', 'media', 'window', 'fullscreen']);

const STOP_DICTATION = /^(?:stop|end|finish|quit|exit|close|done|cancel)(?: the)? (?:dictation|dictating|typing)$|^(?:stop|done|that's all|that is all|finished)$/;
const PUNCTUATION = [
  [/\s*\b(?:full stop|period)\b\s*/gi, '. '], [/\s*\bcomma\b\s*/gi, ', '], [/\s*\bquestion mark\b\s*/gi, '? '],
  [/\s*\bexclamation (?:mark|point)\b\s*/gi, '! '], [/\s*\bcolon\b\s*/gi, ': '], [/\s*\bsemicolon\b\s*/gi, '; '],
  [/\s*\bnew paragraph\b\s*/gi, '\n\n'], [/\s*\bnew line\b\s*/gi, '\n'],
];

// Spoken punctuation words -> symbols, and a space so the next sentence joins nicely.
function dictationText(raw) {
  let t = String(raw || '').trim();
  for (const [re, sym] of PUNCTUATION) t = t.replace(re, sym);
  t = t.replace(/\s+([.,?!:;])/g, '$1').replace(/[ \t]+\n/g, '\n').replace(/([.,?!:;])\1+/g, '$1');
  if (!t) return '';
  return /\n$/.test(t) ? t : `${t.trimEnd()} `;
}

class Assistant {
  constructor({ executor, refine, ui, speak = () => {}, log = () => {}, custom = {}, saveCustom = () => {}, onCalled = () => {} }) {
    this.onCalled = onCalled;  // he was called by name (or clicked): bring him back on screen
    this.executor = executor;
    this.refine = refine;       // (segmentId) => Promise<string|null> using the accurate model
    this.ui = ui;               // (display) => void
    this.speak = speak;         // (text, { level: 'answer' | 'chat' }) => void
    this.log = log;
    this.custom = custom;
    this.saveCustom = saveCustom;
    this.mode = 'sleeping';
    this.until = 0;
    this.prefix = '';
    this.pendingActions = null;
    this.paused = false;
    this.busy = false;
    this.timer = null;
    this.recording = null;      // { steps: [], name } while recording a routine
    this.history = [];          // for tests: every command handled
  }

  now() { return Date.now(); }

  setMode(mode, ms = 0) {
    this.mode = mode;
    this.until = ms ? this.now() + ms : 0;
    clearTimeout(this.timer);
    if (ms) this.timer = setTimeout(() => this.expire(mode), ms);
  }

  expire(mode) {
    if (this.mode !== mode) return;
    if (mode === 'confirm') {
      this.pendingActions = null;
      this.ui({ dot: 'sleeping', label: 'Cancelled', text: 'No "yes" heard, so nothing was done', hideAfter: 3000 });
    } else if (mode === 'awake') {
      this.ui({ dot: 'sleeping', label: 'Going back to sleep', text: '', hideAfter: 1500 });
    } else if (mode === 'choosing') {
      this.executor.run([{ kind: 'numbers', op: 'hide' }]);
      this.ui({ dot: 'sleeping', label: 'Numbers hidden', text: '', hideAfter: 1500 });
    } else if (mode === 'dictating') {
      this.ui({ dot: 'done', label: 'Dictation stopped', text: 'No speech for a while', hideAfter: 3000, sound: 'squeak' });
    } else if (mode === 'naming') {
      this.ui({ dot: 'confirm', label: this.recordingLabel(), text: 'Say "save as" and a name, or "cancel recording"', hideAfter: 5000 });
    }
    this.mode = 'sleeping';
    this.prefix = '';
  }

  recordingLabel() {
    return this.recording ? `⏺ Recording (${this.recording.steps.length} step${this.recording.steps.length === 1 ? '' : 's'})` : '';
  }

  // Hotkey / tray / clicking JARVIS: same as saying "Jarvis".
  wake() {
    if (this.paused) this.setPaused(false);
    this.goAwake();
  }

  goAwake(prefix = '', prompt = '') {
    this.prefix = prefix;
    this.onCalled();
    this.setMode('awake', AWAKE_MS);
    this.ui({ dot: 'listening', label: prompt || this.recordingLabel() || 'Listening…', text: prompt ? '' : 'Say a command', sound: 'wake' });
    if (prompt) this.speak(prompt, { level: 'answer' });
  }

  setPaused(paused) {
    this.paused = paused;
    this.setMode('sleeping');
    this.ui(paused
      ? { dot: 'paused', label: 'Jarvis is paused', text: 'Click me or press Ctrl + Alt + S to listen again', hideAfter: 5000 }
      : { dot: 'done', label: 'Jarvis is listening again', text: 'Say "Jarvis" and a command', hideAfter: 3000 });
    if (paused) this.speak('Going offline, sir. Press Control Alt J when you need me.', { level: 'chat' });
  }

  onSpeechStart() {
    if (this.mode === 'awake' || this.mode === 'confirm' || this.mode === 'naming') {
      this.ui({ dot: 'speaking', label: this.mode === 'confirm' ? 'Say yes or no…' : 'Listening…', text: '🎙 hearing you' });
    }
  }

  inWindow(mode) {
    return this.mode === mode && this.now() < this.until;
  }

  // A reminder or timer came due (called by main.js).
  announce(item) {
    const text = item.kind === 'timer'
      ? `Your ${item.label || 'timer'} is done!`
      : `${item.missed ? 'You missed a reminder: ' : 'Reminder! '}${item.label}`;
    this.ui({ dot: 'reminder', label: item.kind === 'timer' ? '⏰ Time is up' : '⏰ Reminder', text, hideAfter: 15000, sound: 'bell' });
    this.speak(text, { level: 'answer' });
  }

  // Every utterance the fast model transcribed ends up here.
  async onSegment({ id, text, sec }) {
    if (this.paused || !text) return;
    if (this.mode === 'dictating') return this.dictate(id, text);
    if (this.busy) return; // ignore talk while a command is running

    const wake = detectWake(text);
    const said = wake.found ? wake.rest : text;

    if (this.inWindow('confirm')) return this.handleConfirm(said);
    if (this.inWindow('choosing') && said) {
      const choice = this.numberChoice(said);
      if (choice) return this.handleCommand(choice, id, { heard: text, sec });
    }
    if (this.inWindow('naming') && !wake.found) return this.handleCommand(`save as ${said}`, id, { heard: text, sec });
    if (wake.found) {
      if (!wake.rest) return this.goAwake();
      return this.handleCommand(wake.rest, id, { heard: text, sec });
    }
    if (this.inWindow('awake')) return this.handleCommand(`${this.prefix}${text}`, id, { heard: text, sec });
    // "Jarvis" in the middle of a longer stretch of sound (a TV or fan made the voice detector
    // join it to what came before): use what follows his name if it is a clear command.
    const later = findWakeLater(text);
    if (later) return this.handleCommand(later, id, { heard: text, strict: true, sec });
    if ((this.inWindow('following') || this.inWindow('choosing')) && sec <= 6) {
      return this.handleCommand(text, id, { heard: text, strict: true, sec });
    }
    this.log(`not for Jarvis: ${text}`);
  }

  // While numbers are showing, "7", "number 7", "seven" all mean "click 7".
  numberChoice(said) {
    const t = cleanText(said).replace(/^(?:number|no|option) /, '');
    if (/^(?:hide|remove|clear|close|cancel|no)(?: (?:the )?numbers)?$|^never ?mind$/.test(t)) return 'hide numbers';
    const n = toNumber(t);
    if (n) return `click ${n}`;
    if (/^(?:click|double click|right click|type into|type in|tap|open) /.test(t)) return t;
    return null;
  }

  async handleConfirm(text) {
    const actions = this.pendingActions;
    this.pendingActions = null;
    this.setMode('sleeping');
    if (actions && isYes(text)) {
      this.history.push({ text: 'yes', actions });
      return this.execute(actions);
    }
    this.history.push({ text, actions: [], cancelled: true });
    this.ui({ dot: 'sleeping', label: 'Cancelled', text: 'Nothing was done', hideAfter: 3000, sound: 'error' });
    this.speak('Very well, sir. Cancelled.', { level: 'chat' });
  }

  async handleCommand(text, id, { heard, strict = false, sec = 99 } = {}) {
    let parsed = parseCommand(text, { custom: this.custom });

    // Follow-ups without "Jarvis" must be a clean, known command; anything else
    // (people talking, a video playing) is ignored silently.
    // Talking to JARVIS himself (hello, thanks, bye, quit, hide…) always needs his name: the
    // speech model sometimes turns a cough or room noise into "Thank you." or "Bye."
    if (strict && (parsed.unknown.length || !parsed.actions.length || parsed.actions.some((a) => STRICT_NEEDS_NAME.has(a.kind)))) {
      this.log(`ignored (no "Jarvis"): ${text}`);
      return;
    }
    if (parsed.empty) return this.goAwake();

    // He's been called: if he flew off the screen, he comes back (unless you told him to go).
    if (!parsed.actions.some((a) => a.kind === 'visibility' && !a.show)) this.onCalled();

    // Typed text must be exact: re-read the audio with the accurate model. Searches and songs
    // are re-read only when short (about 2 s); long ones use the fast transcript so JARVIS
    // answers straight away.
    if (parsed.actions.some((a) => a.freeText && (!['search', 'play'].includes(a.kind) || sec <= 2.5)) && this.refine) {
      this.ui({ dot: 'thinking', label: 'Getting the exact words…', text: heard });
      this.refining = true;
      let better;
      try { better = await this.refine(id); } finally { this.refining = false; }
      if (better) {
        const w = detectWake(better);
        let candidate = w.found ? w.rest : better;
        if (!w.found && this.prefix) candidate = `${this.prefix}${candidate}`;
        const reparsed = parseCommand(candidate, { custom: this.custom });
        const sameShape = !reparsed.unknown.length && reparsed.actions.length === parsed.actions.length &&
          reparsed.actions.every((a, i) => a.kind === parsed.actions[i].kind);
        if (sameShape) parsed = reparsed;
        this.log(`refined: "${better}" -> ${sameShape ? 'used' : 'kept fast version'}`);
      }
    }
    this.prefix = '';
    const { actions, unknown } = parsed;
    this.history.push({ text, actions, unknown });

    if (unknown.length) {
      this.setMode('sleeping');
      this.ui({ dot: 'error', label: "Sorry, I didn't get that", text: `"${unknown.join(' / ')}"`, hideAfter: 5000, sound: 'error' });
      this.speak("Sorry sir, I didn't catch that.", { level: 'answer' });
      return;
    }
    if (actions.length === 1 && actions[0].kind === 'incomplete') {
      const verb = actions[0].verb.split(' ')[0];
      return this.goAwake(`${verb} `, actions[0].say);
    }

    const control = actions.find((a) => ['cancel', 'stopListening', 'help', 'dictation', 'record'].includes(a.kind));
    if (control) return this.handleControl(control);

    const risky = actions.find((a) => a.confirm);
    if (risky) {
      this.pendingActions = actions;
      this.setMode('confirm', CONFIRM_MS);
      this.ui({ dot: 'confirm', label: `${risky.say}?`, text: 'Say "yes" to confirm, or "no" to cancel', sound: 'wake' });
      this.speak(`Are you sure you want me to ${risky.say.toLowerCase().replace(/ the pc$/, '')}, sir? Say yes.`, { level: 'answer' });
      return;
    }
    return this.execute(actions, text);
  }

  handleControl(a) {
    switch (a.kind) {
      case 'stopListening':
        return this.setPaused(true);
      case 'help':
        this.setMode('sleeping');
        this.ui({ dot: 'done', label: 'Say "Jarvis" and then…', text: HELP.join('\n'), hideAfter: 15000 });
        return this.speak("Here's what I can do, sir.", { level: 'answer' });
      case 'cancel':
        this.setMode('sleeping');
        this.ui({ dot: 'sleeping', label: 'Okay, cancelled', text: '', hideAfter: 2000 });
        return this.speak('As you wish, sir.', { level: 'chat' });
      case 'dictation':
        this.setMode('dictating', DICTATION_IDLE_MS);
        this.ui({ dot: 'dictate', label: '✍ Dictation — everything you say is typed', text: 'Say "stop dictation" when you\'re done', sound: 'wake' });
        return this.speak('Go ahead, I\'m typing.', { level: 'chat' });
      case 'record':
        return this.handleRecording(a);
      default:
        return null;
    }
  }

  // ------------------------------------------------------------------ routines
  handleRecording(a) {
    if (a.op === 'start') {
      this.recording = { steps: [], name: a.name || '' };
      this.setMode('following', FOLLOW_MS);
      this.ui({ dot: 'confirm', label: '⏺ Recording a routine', text: 'Give me commands as usual, then say "Jarvis, save as" and a name', hideAfter: 6000, sound: 'wake' });
      return this.speak('Recording. Tell me the steps.', { level: 'answer' });
    }
    if (a.op === 'cancel') {
      this.recording = null;
      this.setMode('sleeping');
      this.ui({ dot: 'sleeping', label: 'Recording cancelled', text: '', hideAfter: 2500 });
      return this.speak('Okay, forgotten.', { level: 'chat' });
    }
    if (!this.recording) {
      this.ui({ dot: 'error', label: 'Not recording', text: 'Say "Jarvis, start recording" first', hideAfter: 4000, sound: 'error' });
      return this.speak('I\'m not recording anything.', { level: 'answer' });
    }
    if (!this.recording.steps.length) {
      this.ui({ dot: 'error', label: 'Nothing recorded yet', text: 'Give me a few commands first', hideAfter: 4000, sound: 'error' });
      return this.speak('I haven\'t recorded any steps yet.', { level: 'answer' });
    }
    const name = (a.op === 'save' ? a.name : this.recording.name || '').toLowerCase().replace(/[.!?]+$/, '').trim();
    if (!name) {
      this.setMode('naming', NAMING_MS);
      this.ui({ dot: 'confirm', label: this.recordingLabel(), text: 'What should I call it?' });
      return this.speak('What should I call it?', { level: 'answer' });
    }
    this.custom[name] = [...this.recording.steps];
    this.saveCustom(this.custom);
    const count = this.recording.steps.length;
    this.recording = null;
    this.setMode('sleeping');
    this.ui({ dot: 'done', label: `Saved "${name}"`, text: `${count} steps · say "Jarvis, ${name}" to run it`, hideAfter: 6000, sound: 'ok' });
    return this.speak(`Saved. Say Jarvis, ${name}, to run it.`, { level: 'answer' });
  }

  // ------------------------------------------------------------------ dictation
  async dictate(id, fastText) {
    const t = cleanText(detectWake(fastText).rest || fastText);
    if (STOP_DICTATION.test(t)) {
      this.setMode('sleeping');
      this.ui({ dot: 'done', label: 'Dictation stopped', text: '', hideAfter: 3000, sound: 'ok' });
      this.speak('Done typing.', { level: 'chat' });
      return;
    }
    this.setMode('dictating', DICTATION_IDLE_MS);
    this.refining = true;
    let exact;
    try { exact = (this.refine && (await this.refine(id))) || fastText; } finally { this.refining = false; }
    const typed = dictationText(exact);
    if (!typed.trim()) return;
    this.ui({ dot: 'dictate', label: '✍ Dictation — say "stop dictation" to finish', text: typed.trim() });
    const results = await this.executor.run([{ kind: 'type', text: typed }]);
    this.history.push({ text: `(dictation) ${typed}`, actions: [{ kind: 'type', text: typed }], results });
    if (!results[0].ok) this.log(`dictation typing failed: ${results[0].error}`);
  }

  // ------------------------------------------------------------------ doing things
  async execute(actions, spokenText = '') {
    this.busy = true;
    this.setMode('doing');
    const lines = actions.map((a) => `… ${a.say || a.kind}`);
    this.ui({ dot: 'thinking', label: 'Working…', text: lines.join('\n'), activity: activityFor(actions[0]) });
    // Say what we're doing while doing it (words for real jobs, a squeak for tiny ones).
    const first = actions[0];
    const answersLater = actions.some((a) => ['time', 'timer', 'focusdot', 'clickName', 'numbers', 'chat', 'sysinfo', 'quitApp'].includes(a.kind));
    if (!answersLater) {
      if (QUIET.has(first.kind) && actions.length === 1) this.ui({ sound: 'squeak', keep: true });
      else this.speak(spokenFor(first), { level: 'chat' });
    }

    let results = [];
    try {
      results = await this.executor.run(actions, (result, i) => {
        lines[i] = `${result.ok ? '✓' : '✗'} ${result.say || actions[i].kind}${result.detail && result.ok ? ` — ${short(result.detail)}` : ''}${result.ok ? '' : `: ${result.error}`}`;
        const next = actions[i + 1] || actions[i];
        this.ui({ dot: 'thinking', label: 'Working…', text: lines.join('\n'), activity: activityFor(next) });
      });
    } finally {
      this.busy = false;
    }
    const failed = results.find((r) => !r.ok);
    const last = this.history[this.history.length - 1];
    if (last) last.results = results;
    for (let i = results.length; i < actions.length; i++) lines[i] = `– ${actions[i].say || actions[i].kind} (skipped)`;

    // Remember successful steps while recording a routine.
    if (this.recording && !failed && spokenText && !actions.some((a) => NOT_RECORDED.has(a.kind))) {
      this.recording.steps.push(spokenText);
    }

    const chooser = results.find((r) => r.ok && (r.choose || r.numbers));
    const detailText = results.length === 1 && results[0].ok && results[0].detail && /time|timer|focusdot/.test(actions[0].kind) ? results[0].detail : null;
    this.ui({
      dot: failed ? 'error' : chooser ? 'listening' : 'done',
      label: failed ? 'Something went wrong' : chooser ? 'Say a number' : this.recording ? this.recordingLabel() : 'Done',
      text: detailText || lines.join('\n'),
      hideAfter: chooser ? CHOOSE_MS : failed ? 8000 : detailText ? 9000 : 4000,
      sound: failed ? 'error' : chooser ? 'wake' : 'ok',
    });
    const spoken = results.map((r) => r.speak).filter(Boolean).join(' ');
    if (failed) this.speak(sayError(failed.error), { level: 'answer' });
    else if (spoken) this.speak(spoken, { level: 'answer' });

    if (chooser) this.setMode('choosing', CHOOSE_MS);
    else this.setMode('following', FOLLOW_MS);
    return results;
  }
}

// "… the weather is nice Jarvis open WhatsApp" → "open WhatsApp".
function findWakeLater(text) {
  const words = cleanText(text, true).split(' ');
  for (let i = 1; i < words.length - 1; i++) {
    const rest = detectWake(words.slice(i).join(' '));
    if (rest.found && rest.rest) return rest.rest;
  }
  return null;
}

// What Jarvis says while starting a job.
function spokenFor(action) {
  switch (action.kind) {
    case 'open': return `Opening ${action.target}, sir.`;
    case 'search': return `Searching for ${action.query}.`;
    case 'play': return `Playing ${action.query}, sir.`;
    case 'navigate': return `Going to ${action.target}.`;
    case 'closeApp': return `Closing ${action.target}.`;
    case 'focus': return `Switching to ${action.target}.`;
    case 'custom': return `Running ${action.name}, sir.`;
    case 'wallpaper': return 'New wallpaper, sir.';
    case 'screenshot': return 'Screenshot taken.';
    case 'radio': return `Turning ${action.radio === 'WiFi' ? 'Wi-Fi' : 'Bluetooth'} ${action.state.toLowerCase()}.`;
    case 'volume': return action.op === 'mute' ? 'Muted.' : action.op === 'unmute' ? 'Sound is back on.' : '';
    case 'brightness': return '';
    case 'power': return action.op === 'lock' ? 'Locking up, sir.' : action.op === 'sleep' ? 'Good night, sir.' : action.op === 'cancel' ? 'Cancelled.' : 'Very well, sir.';
    case 'editor': return 'Here are your commands, sir.';
    case 'visibility': return action.show ? 'Right here, sir.' : 'As you wish, sir. Call me when you need me.';
    default: return 'Right away, sir.';
  }
}

function sayError(message) {
  const m = String(message || '').replace(/["“”]/g, '');
  return m.length < 90 ? `Sorry sir. ${m}.` : 'Sorry sir, that didn\'t work.';
}

// Which hologram JARVIS shows while doing a job (see renderer/ironman/ironman.css).
function activityFor(action) {
  switch (action && action.kind) {
    case 'search': case 'play': case 'navigate': case 'clickName': case 'numbers': return 'search';
    case 'open': case 'focus': case 'closeApp': case 'custom': case 'editor': case 'focusdot': return 'launch';
    case 'type': case 'key': case 'sequence': case 'clickNumber': return 'type';
    case 'media': case 'volume': return 'music';
    case 'radio': return 'signal';
    case 'timer': return 'bell';
    default: return 'scan';
  }
}

function short(s) {
  const str = String(s);
  return str.length > 60 ? `${str.slice(0, 57)}…` : str;
}

module.exports = { Assistant, HELP, dictationText };
