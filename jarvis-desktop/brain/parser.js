// Turns what the user said into a list of actions. Pure rules, no AI:
// same sentence in, same actions out, so every command can be unit-tested.
const { parseDuration, parseClock, describeDuration, describeTime } = require('./timers');

// ---------------------------------------------------------------- wake word
// Whisper spells the made-up name "Jarvis" a few different ways.
// Whisper spells "Jarvis" a few different ways, especially with an Indian accent.
const WAKE_WORDS = [
  'jarvis', 'jarviss', 'jarvas', 'jarvus', 'jarves', 'jarvies', 'jarvi', 'jarvie', 'jarviz', 'jarvish', 'jarvice',
  'jarbis', 'jarwis', 'javis', 'jervis', 'jarwis', 'charvis', 'travis', 'jaarvis', 'jaarwis', 'jharvis',
];
const WAKE_PAIRS = ['jar vis', 'jar wis', 'jaar vis', 'char vis', 'jar viss', 'jarv is'];
const GREETINGS = new Set(['hey', 'hi', 'hello', 'ok', 'okay', 'yo', 'oh', 'a', 'ay', 'hay']);

// keepCase: typed text and search words keep their capital letters; commands are matched lowercase.
function cleanText(raw, keepCase = false) {
  const s = String(raw || '');
  return (keepCase ? s : s.toLowerCase())
    .replace(/[‘’]/g, "'")
    .replace(/wi-fi|wi fi|why fi|wifi's/gi, 'wifi')
    .replace(/\b([ap])\.\s?m\b\.?/gi, '$1m') // "6:30 p.m." -> "6:30 pm"
    .replace(/(\d),(\d{3})/g, '$1$2')
    .replace(/\.(?![a-z0-9])/gi, ' ') // drop sentence dots but keep "github.com"
    .replace(/[^\p{L}\p{M}\p{N}\s.'%+-]/gu, ' ')
    .replace(/(^|\s)[-']+|[-']+(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Finds "Jarvis" near the start of an utterance. Returns what was said after it.
function detectWake(raw) {
  const original = cleanText(raw, true).split(' ').filter(Boolean);
  const words = original.map((w) => w.toLowerCase());
  for (let i = 0; i < Math.min(words.length, 3); i++) {
    if (i > 0 && !GREETINGS.has(words[i - 1]) && !(i === 1 && words[0] === words[1])) break;
    const pair = words.slice(i, i + 2).join(' ');
    let used = 0;
    if (WAKE_WORDS.includes(words[i].replace(/'s$/, ''))) used = 1;
    else if (WAKE_PAIRS.includes(pair)) used = 2;
    if (used) {
      let start = i + used;
      // "Jarvis, Jarvis, open YouTube" — ignore repeats.
      while (start < words.length && WAKE_WORDS.includes(words[start])) start++;
      return { found: true, rest: original.slice(start).join(' ') };
    }
  }
  return { found: false, rest: original.join(' ') };
}

// Whisper sometimes loops on short clips: "Next tab Next tab Next". Keep one copy
// of any repeated 2–6 word phrase (single words like "Naatu Naatu" are left alone).
function dropRepeats(text) {
  let words = String(text || '').split(/\s+/).filter(Boolean);
  const key = (w) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  let changed = true;
  while (changed) {
    changed = false;
    search: for (let n = 2; n <= 6; n++) {
      for (let i = 0; i + n < words.length; i++) {
        const avail = Math.min(n, words.length - (i + n));
        let k = 0;
        while (k < avail && key(words[i + k]) === key(words[i + n + k])) k++;
        if (k === n) { words.splice(i + n, n); changed = true; break search; }
        if (k === avail && i + n + avail === words.length) { words = words.slice(0, i + n); changed = true; break search; }
      }
    }
  }
  return words.join(' ');
}

// ---------------------------------------------------------------- numbers
const SMALL = {
  zero: 0, one: 1, two: 2, to: 2, too: 2, three: 3, four: 4, for: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const ORDINALS = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, last: 9,
  '1st': 1, '2nd': 2, '3rd': 3, '4th': 4, '5th': 5, '6th': 6, '7th': 7, '8th': 8,
};

function toNumber(str) {
  if (str == null) return null;
  const s = String(str).trim().replace(/%|percent/g, '').trim();
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  if (s === 'hundred' || s === 'a hundred' || s === 'one hundred' || s === 'full' || s === 'max' || s === 'maximum') return 100;
  const parts = s.split(/[\s-]+/);
  if (parts.length === 1 && SMALL[parts[0]] !== undefined && !['to', 'too', 'for'].includes(parts[0])) return SMALL[parts[0]];
  if (parts.length === 1 && TENS[parts[0]] !== undefined) return TENS[parts[0]];
  if (parts.length === 2 && TENS[parts[0]] !== undefined && SMALL[parts[1]] !== undefined && SMALL[parts[1]] < 10) {
    return TENS[parts[0]] + SMALL[parts[1]];
  }
  return null;
}
const NUM = '(\\d+|[a-z]+(?:[ -][a-z]+)?)';
const NUMBER_WORDS = '(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[ -](?:one|two|three|four|five|six|seven|eight|nine))?';

// Focus Dot quadrant from words like "q1", "q one", "urgent"
function quadrant(word) {
  if (!word) return null;
  const w = word.replace(/\s+/g, ' ').trim();
  if (w === 'urgent') return 1;
  if (w === 'important') return 2;
  if (w === 'not important') return 4;
  const n = toNumber(w.replace(/^(?:q|quadrant) ?/, ''));
  return n >= 1 && n <= 4 ? n : null;
}

// ---------------------------------------------------------------- vocabulary
// Words that can start a new command inside a chained sentence.
const VERBS = new Set([
  'open', 'launch', 'start', 'run', 'close', 'quit', 'exit', 'search', 'google', 'find', 'look', 'play',
  'pause', 'resume', 'type', 'write', 'press', 'click', 'hit', 'enter', 'go', 'navigate', 'switch', 'change',
  'new', 'next', 'previous', 'reopen', 'refresh', 'reload', 'scroll', 'minimize', 'minimise', 'maximize',
  'maximise', 'restore', 'show', 'turn', 'enable', 'disable', 'volume', 'mute', 'unmute', 'set', 'increase',
  'decrease', 'raise', 'lower', 'lock', 'restart', 'reboot', 'shut', 'shutdown', 'take', 'select', 'copy',
  'paste', 'cut', 'undo', 'redo', 'save', 'zoom', 'bookmark', 'wifi', 'bluetooth', 'brightness', 'screenshot',
  'double', 'right', 'left', 'put', 'sleep', 'submit', 'back', 'forward', 'full', 'fullscreen', 'youtube', 'bring',
]);

const SITES = {
  youtube: 'https://www.youtube.com',
  'you tube': 'https://www.youtube.com',
  google: 'https://www.google.com',
  gmail: 'https://mail.google.com',
  'g mail': 'https://mail.google.com',
  'google mail': 'https://mail.google.com',
  'google drive': 'https://drive.google.com',
  drive: 'https://drive.google.com',
  'google docs': 'https://docs.google.com',
  'google sheets': 'https://sheets.google.com',
  'google maps': 'https://maps.google.com',
  maps: 'https://maps.google.com',
  'google calendar': 'https://calendar.google.com',
  'google meet': 'https://meet.google.com',
  'google photos': 'https://photos.google.com',
  'google translate': 'https://translate.google.com',
  facebook: 'https://www.facebook.com',
  instagram: 'https://www.instagram.com',
  'whatsapp web': 'https://web.whatsapp.com',
  whatsapp: 'https://web.whatsapp.com',
  twitter: 'https://x.com',
  x: 'https://x.com',
  linkedin: 'https://www.linkedin.com',
  'linked in': 'https://www.linkedin.com',
  reddit: 'https://www.reddit.com',
  github: 'https://github.com',
  'git hub': 'https://github.com',
  netflix: 'https://www.netflix.com',
  'prime video': 'https://www.primevideo.com',
  'amazon prime': 'https://www.primevideo.com',
  amazon: 'https://www.amazon.in',
  flipkart: 'https://www.flipkart.com',
  hotstar: 'https://www.hotstar.com',
  'jio hotstar': 'https://www.hotstar.com',
  spotify: 'https://open.spotify.com',
  chatgpt: 'https://chatgpt.com',
  'chat gpt': 'https://chatgpt.com',
  claude: 'https://claude.ai',
  gemini: 'https://gemini.google.com',
  slack: 'https://app.slack.com',
  discord: 'https://discord.com/app',
  telegram: 'https://web.telegram.org',
  wikipedia: 'https://www.wikipedia.org',
  'stack overflow': 'https://stackoverflow.com',
  stackoverflow: 'https://stackoverflow.com',
  outlook: 'https://outlook.live.com',
  notion: 'https://www.notion.so',
  canva: 'https://www.canva.com',
  figma: 'https://www.figma.com',
  'youtube music': 'https://music.youtube.com',
};

const ENGINES = {
  google: 'google', youtube: 'youtube', 'you tube': 'youtube', amazon: 'amazon', flipkart: 'flipkart',
  wikipedia: 'wikipedia', github: 'github', maps: 'maps', 'google maps': 'maps', bing: 'bing',
  spotify: 'spotify', images: 'images', 'google images': 'images',
};

// Spoken key names -> key ids understood by the executor.
const KEY_NAMES = {
  enter: 'enter', return: 'enter', escape: 'esc', esc: 'esc', tab: 'tab', backspace: 'backspace',
  'back space': 'backspace', delete: 'delete', space: 'space', spacebar: 'space', 'space bar': 'space',
  up: 'up', down: 'down', left: 'left', right: 'right', 'up arrow': 'up', 'down arrow': 'down',
  'left arrow': 'left', 'right arrow': 'right', 'arrow up': 'up', 'arrow down': 'down',
  'arrow left': 'left', 'arrow right': 'right', home: 'home', end: 'end', 'page up': 'pageup',
  'page down': 'pagedown', control: 'ctrl', ctrl: 'ctrl', shift: 'shift', alt: 'alt', windows: 'win',
  win: 'win', 'windows key': 'win', 'print screen': 'printscreen', insert: 'insert', 'caps lock': 'capslock',
};
for (let i = 1; i <= 12; i++) KEY_NAMES[`f${i}`] = `f${i}`;

const SELF = '(?:this|it|that|the window|this window|current window|the current window|the app|this app|window|everything)';

// ---------------------------------------------------------------- helpers
const FILLER_START = /^(?:(?:please|pls|can you|could you|would you|will you|kindly|just|now|quickly|go ahead and|i want to|i want you to|i need you to|i need to|i would like to|let's|lets|let us|and|also|then|so|um|uh|hmm|ok|okay|alright|hey)\s+)+/i;
const FILLER_END = /(?:\s+(?:please|pls|for me|now|right now|thank you|thanks|quickly|immediately))+$/i;

function stripFillers(s) {
  let out = s.trim();
  let prev;
  do {
    prev = out;
    out = out.replace(FILLER_START, '').replace(FILLER_END, '').trim();
  } while (out !== prev);
  return out;
}

const the = (s) => s.replace(/^(?:the|a|an|my)\s+/i, '').trim();

function keyAction(keys, say) {
  return { kind: 'key', keys, say };
}

// Splits "open YouTube and search songs" into parts, but keeps
// "search tom and jerry" together because "jerry" is not a command word.
function splitChain(text) {
  const originalWords = text.split(' ');
  const words = originalWords.map((w) => w.toLowerCase());
  const parts = [];
  let current = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const next = words[i + 1];
    const joiner = ['and', 'then', 'also', 'after'].includes(w);
    if (joiner && current.length) {
      // "and then", "then", "after that", "and also"
      let skip = 1;
      if ((w === 'and' && (next === 'then' || next === 'also')) || (w === 'after' && next === 'that')) skip = 2;
      if (w === 'after' && next !== 'that') { current.push(originalWords[i]); continue; }
      let after = words[i + skip];
      let j = i + skip;
      while (after && ['please', 'just', 'then', 'also'].includes(after)) { j++; after = words[j]; }
      if (after && (VERBS.has(PAST_TENSE[after] || after) || (w !== 'and' && after))) {
        parts.push(current.join(' '));
        current = [];
        i = j - 1;
        continue;
      }
    }
    current.push(originalWords[i]);
  }
  if (current.length) parts.push(current.join(' '));
  return parts.map((p) => p.trim()).filter(Boolean);
}

// A spoken reply with nothing to do on the PC.
const chat = (reply) => ({ kind: 'chat', reply, say: reply });

function greetingTime() {
  const t = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `It's ${t}.`;
}

// ---------------------------------------------------------------- rules
// Each rule: [regex, (match, context) => action]. First match wins.
const RULES = [
  // --- control words -------------------------------------------------------
  [/^(?:cancel|never ?mind|nothing|forget it|forget about it|no|nope)$/, () => ({ kind: 'cancel', say: 'Cancelled' })],
  // --- JARVIS himself ------------------------------------------------------
  [/^(?:hello|hi|hey|hey there|hello there|are you there|you there|wake up|daddy's home|i'm home|i am home)$/, () => chat('At your service, sir.')],
  [/^(?:good morning|morning)$/, () => chat(`Good morning, sir. ${greetingTime()}`)],
  [/^(?:good (?:afternoon|evening))$/, () => chat(`Good evening, sir. ${greetingTime()}`)],
  [/^(?:good night)$/, () => chat('Good night, sir. Sleep well.')],
  [/^(?:how are you|how are you doing|how's it going|how is it going|what's up|whats up|you okay|are you okay)$/, () => chat('All systems are running smoothly, sir.')],
  [/^(?:who are you|what are you|what is your name|what's your name|introduce yourself)$/, () => chat("I'm Jarvis, your personal assistant. Just say my name and tell me what you need.")],
  [/^(?:thank you|thanks|thank you so much|thanks a lot|good job|well done|nice work|great job|awesome|perfect)$/, () => chat('Always a pleasure, sir.')],
  [/^(?:are you (?:listening|awake|online)|you listening)$/, () => chat('Always, sir.')],
  [/^(?:(?:what(?:'s| is) (?:the |my )?)?battery(?: level| status| percentage)?|how much (?:battery|charge)(?: is left| do i have)?(?: left)?)$/, () => ({ kind: 'sysinfo', op: 'battery', say: 'Battery' })],
  [/^(?:(?:system|pc|laptop|computer) (?:status|report|health)|status report|how is (?:my|the) (?:system|pc|laptop|computer)|(?:cpu|ram|memory) usage|how much (?:ram|memory)(?: is used| am i using)?)$/, () => ({ kind: 'sysinfo', op: 'status', say: 'System status' })],
  [/^(?:(?:quit|exit|close|shut down|turn off|switch off)(?: (?:jarvis|yourself))?(?: app| application)? (?:completely|fully|for now)|(?:quit|exit|close|shut down) (?:the )?jarvis (?:app|application|program))$/, () => ({ kind: 'quitApp', say: 'Shutting down' })],

  [/^(?:stop listening|pause listening|go quiet|be quiet|shut up|mute yourself|stop jarvis|sleep jarvis)$/, () => ({ kind: 'stopListening', say: 'Stopped listening' })],
  [/^(?:help|what can you do|what can i say|show commands|commands|list commands)$/, () => ({ kind: 'help', say: 'Help' })],
  [/^(?:what(?:'s| is)? the time|what time is it|time|tell me the time|what(?:'s| is)? (?:the )?date|what(?:'s| is)? today(?:'s date)?|what day is (?:it|today)|date)$/, () => ({ kind: 'time', say: 'Time' })],

  // --- dictation: type everything said until "stop dictation" --------------
  [/^(?:start |star |stat |started |begin |turn on |enter |open )?(?:dictation|dictating|the dictation)(?: mode)?$|^(?:take|start taking) (?:a )?dictation$|^dictate$|^(?:start|star|begin) typing(?: what i say)?$|^type what i say$|^typing mode$/, () => ({ kind: 'dictation', say: 'Dictation' })],

  // --- numbered clicking ----------------------------------------------------
  [/^(?:show|display|give me|put|turn on)(?: me)? (?:the )?numbers(?: on (?:the )?screen)?$|^number (?:the )?(?:screen|buttons|links|everything)$|^numbers$/, () => ({ kind: 'numbers', op: 'show', say: 'Showing numbers' })],
  [/^(?:hide|remove|clear|close|turn off) (?:the )?numbers$|^no numbers$/, () => ({ kind: 'numbers', op: 'hide', say: 'Numbers hidden' })],

  // --- timers & reminders -----------------------------------------------------
  [/^(?:set|start|put|make|create)(?: me)?(?: a| an| the)? timer (?:for |of |to )?(.+)$|^timer (?:for )?(.+)$|^(.+?) timer$/, (m) => {
    const spoken = m[1] || m[2] || m[3];
    const ms = parseDuration(spoken);
    if (!ms) return null;
    return { kind: 'timer', op: 'add', durationMs: ms, say: `Timer for ${describeDuration(ms)}` };
  }],
  [/^(?:remind me|set a reminder|reminder) (?:in|after) (.+?) (?:to|that|about|for) (.+)$/, (m, o) => {
    const ms = parseDuration(m[1]);
    if (!ms) return null;
    return { kind: 'timer', op: 'remind', durationMs: ms, label: o[2], say: `Reminder in ${describeDuration(ms)}` };
  }],
  [/^(?:remind me|set a reminder|reminder) (?:to|that|about|for) (.+?) (?:in|after) (.+)$/, (m, o) => {
    const ms = parseDuration(m[2]);
    if (!ms) return null;
    return { kind: 'timer', op: 'remind', durationMs: ms, label: o[1], say: `Reminder in ${describeDuration(ms)}` };
  }],
  [/^(?:remind me|set a reminder|reminder) (?:at |by )?((?:tomorrow |tonight )?(?:at )?(?:\d{1,2}(?:[: ]\d{2})?|noon|midnight)(?: ?(?:a ?m|p ?m|o'?clock|in the morning|in the evening|in the afternoon|at night))?(?: tomorrow| tonight)?) (?:to|that|about|for) (.+)$/, (m, o) => {
    const at = parseClock(m[1]);
    if (!at) return null;
    return { kind: 'timer', op: 'remind', at: at.getTime(), label: o[2], say: `Reminder at ${describeTime(at)}` };
  }],
  [/^(?:remind me|set a reminder|reminder) (?:to|that|about|for) (.+?) (?:at|by) ((?:tomorrow |tonight )?(?:\d{1,2}(?:[: ]\d{2})?|noon|midnight)(?: ?(?:a ?m|p ?m|o'?clock|in the morning|in the evening|in the afternoon|at night))?(?: tomorrow| tonight)?)$/, (m, o) => {
    const at = parseClock(m[2]);
    if (!at) return null;
    return { kind: 'timer', op: 'remind', at: at.getTime(), label: o[1], say: `Reminder at ${describeTime(at)}` };
  }],
  [/^(?:what are|list|show|read|tell me)(?: me)? (?:my |the |all )?(?:timers|reminders|timers and reminders|alarms)$|^(?:any|do i have any) (?:timers|reminders)$|^how (?:much|long) (?:time )?(?:is )?left(?: on (?:the |my )?timer)?$/, () => ({ kind: 'timer', op: 'list', say: 'Your timers' })],
  [/^(?:cancel|stop|delete|remove|clear|turn off) (?:the |my |all |all the |all my )?(timers?|reminders?|alarms?)(?: (?:for|about|to) (.+))?$/, (m, o) => ({
    kind: 'timer', op: 'cancel', which: /timer|alarm/.test(m[1]) ? 'timer' : 'reminder', name: o[2] || '', say: 'Cancelled',
  })],

  // --- record a routine, run it later -------------------------------------------
  [/^(?:start|begin) recording(?: (?:a )?(?:new )?routine)?(?: (?:called|named) (.+))?$|^record (?:a )?(?:new )?routine(?: (?:called|named) (.+))?$/, (m) => ({ kind: 'record', op: 'start', name: m[1] || m[2] || '', say: 'Recording a routine' })],
  [/^(?:stop|end|finish) (?:the )?recording$|^that'?s (?:it|all)$/, () => ({ kind: 'record', op: 'stop', say: 'Stop recording' })],
  [/^save (?:it |this |that |the routine |routine )?as (.+)$|^call it (.+)$|^name it (.+)$/, (m) => ({ kind: 'record', op: 'save', name: (m[1] || m[2] || m[3]).replace(/^(?:the |my )/, ''), say: 'Saved' })],
  [/^(?:cancel|discard|forget|delete) (?:the |this )?recording$/, () => ({ kind: 'record', op: 'cancel', say: 'Recording cancelled' })],

  // --- hide / show Jarvis on screen (it keeps listening while hidden) -----------------
  [/^(?:hide|hide yourself|go hide|disappear|vanish|hide (?:from|off) (?:the )?screen|go invisible|quit|quit yourself|exit|exit yourself|close yourself|go away|fly away|leave|you can go|you may go|bye|bye bye|goodbye|good bye|see you|see you later|get lost|dismiss|dismissed)$/, () => ({ kind: 'visibility', show: false, say: 'Flying away' })],
  [/^(?:show yourself|come back|come here|appear|unhide|unhide yourself|show up|show jarvis|come out|be visible|where are you|suit up)$/, () => ({ kind: 'visibility', show: true, say: 'Flying in' })],

  // --- my commands editor ----------------------------------------------------------
  [/^(?:open |show |edit )?(?:my |the )?(?:custom )?(?:commands?|routines?)(?: and routines)? (?:editor|list|settings|window)$|^edit (?:my )?(?:custom )?(?:commands|routines)$|^(?:open |show )(?:my )?(?:commands|routines)$/, () => ({ kind: 'editor', say: 'Opening your commands' })],

  // --- Focus Dot tasks & notes -----------------------------------------------------
  [/^(?:add|create|make|new)(?: a| an)?(?: new)? (?:(q ?[1-4]|q one|q two|q three|q four|quadrant (?:[1-4]|one|two|three|four)|urgent|important|not important) )?task(?: to focus dot)?(?: called| named| for)?:? (.+?)(?: (?:in|to|as) (q ?[1-4]|q one|q two|q three|q four|quadrant (?:[1-4]|one|two|three|four)))?$/, (m, o) => ({
    kind: 'focusdot', op: 'add', q: quadrant(m[1] || m[3]), title: o[2], say: `Adding task "${o[2]}"`,
  })],
  [/^(?:what are|read|list|show|tell me|what's|what is)(?: me)? (?:my |the |on my )?(?:tasks|to ?dos?|to do list|task list|list)(?: today)?$|^what(?:'s| is) on my (?:list|plate)$/, () => ({ kind: 'focusdot', op: 'list', say: 'Your tasks' })],
  [/^(?:mark|set) (?:the )?(?:task )?(.+?) (?:as )?(?:done|complete|completed|finished)$|^(?:complete|finish) (?:the )?task (.+)$|^(?:i )?(?:finished|completed|am done with|done with) (?:the )?(?:task )?(.+)$/, (m) => ({
    kind: 'focusdot', op: 'done', title: m[1] || m[2] || m[3], say: 'Marking it done',
  })],
  [/^(?:pause|stop|hold) (?:the |my |this )?task(?: (.+))?$/, (m) => ({ kind: 'focusdot', op: 'pause', title: m[1] || '', say: 'Pausing the task' })],
  [/^(?:start|begin|resume|continue|work on) (?:the |my )?task (.+)$/, (m) => ({ kind: 'focusdot', op: 'start', title: m[1], say: 'Starting the task' })],
  [/^(?:add|make|take|write|create)(?: a| new)? note(?: to focus dot)?:? (.+)$|^note (?:down |that )?(.+)$/, (m, o) => ({ kind: 'focusdot', op: 'note', text: o[1] || o[2], say: 'Note saved' })],

  // --- snap & move windows -------------------------------------------------------------
  [/^snap (?:it |this |the window |this window |window )?(?:to (?:the )?)?(left|right|up|top|down|bottom)$/, (m) => {
    const dir = { left: 'left', right: 'right', up: 'up', top: 'up', down: 'down', bottom: 'down' }[m[1]];
    return keyAction(['win', dir], `Snapped ${m[1]}`);
  }],
  [/^(?:move|send|put|throw) (?:it |this |the window |this window )?(?:to |on )?(?:the )?(?:other|next|second|another) (?:screen|monitor|display)$/, () => keyAction(['win', 'shift', 'right'], 'Moved to the other screen')],
  [/^(?:make (?:it|this|the window) smaller|shrink (?:it|this|the window))$/, () => keyAction(['win', 'down'], 'Made it smaller')],
  [/^put (?:it|this) (?:on top|at the top)$/, () => keyAction(['win', 'up'], 'Snapped up')],

  // --- power (restart / shutdown ask for confirmation) ---------------------
  [/^(?:cancel|stop|abort) (?:the )?(?:shut ?down|restart|reboot)$/, () => ({ kind: 'power', op: 'cancel', say: 'Cancel shutdown' })],
  [/^(?:restart|reboot)(?: (?:the |my )?(?:computer|pc|system|windows|laptop|machine|device))?$/, () => ({ kind: 'power', op: 'restart', confirm: true, say: 'Restart the PC' })],
  [/^(?:shut ?down|shut off|power off|power down|switch off|turn off)(?: (?:the |my )?(?:computer|pc|system|windows|laptop|machine|device))$|^(?:shut ?down|power off|shut (?:the |my )?(?:computer|pc|system|laptop) down)$/, () => ({ kind: 'power', op: 'shutdown', confirm: true, say: 'Shut down the PC' })],
  [/^(?:sign out|log out|log off|logout|signout)$/, () => ({ kind: 'power', op: 'signout', confirm: true, say: 'Sign out' })],
  [/^lock(?: (?:the |my )?(?:computer|pc|screen|system|laptop|windows|device))?$/, () => ({ kind: 'power', op: 'lock', say: 'Locking the PC' })],
  [/^(?:sleep|go to sleep|put (?:the |my )?(?:computer|pc|system|laptop) to sleep|sleep mode|(?:computer|pc) sleep)$/, () => ({ kind: 'power', op: 'sleep', say: 'Putting the PC to sleep' })],

  // --- radios ---------------------------------------------------------------
  [/^(?:(turn|switch) )?(on|off)? ?(?:the )?(wifi|wireless|internet|bluetooth)(?: (on|off))?$/, (m) => {
    const state = m[2] || m[4];
    if (!state) return null;
    const radio = m[3] === 'bluetooth' ? 'Bluetooth' : 'WiFi';
    return { kind: 'radio', radio, state: state === 'on' ? 'On' : 'Off', say: `${radio === 'WiFi' ? 'Wi-Fi' : 'Bluetooth'} ${state}` };
  }],
  [/^(enable|disable|connect|disconnect|start|stop) (?:the )?(wifi|wireless|internet|bluetooth)$/, (m) => {
    const on = ['enable', 'connect', 'start'].includes(m[1]);
    const radio = m[2] === 'bluetooth' ? 'Bluetooth' : 'WiFi';
    return { kind: 'radio', radio, state: on ? 'On' : 'Off', say: `${radio === 'WiFi' ? 'Wi-Fi' : 'Bluetooth'} ${on ? 'on' : 'off'}` };
  }],

  // --- volume ----------------------------------------------------------------
  [/^(?:unmute|un mute)(?: (?:the )?(?:volume|sound|audio|computer|pc|video|it|this))?$/, () => ({ kind: 'volume', op: 'unmute', say: 'Unmuted' })],
  [/^mute(?: (?:the )?(?:volume|sound|audio|computer|pc|video|it|this|everything))?$/, () => ({ kind: 'volume', op: 'mute', say: 'Muted' })],
  [/^(?:max|maximum|full) (?:volume|sound)$|^(?:volume|sound) (?:to )?(?:max|maximum|full)$/, () => ({ kind: 'volume', op: 'set', value: 100, say: 'Volume 100%' })],
  [new RegExp(`^(?:set |change |make )?(?:the )?(?:volume|sound) (?:to |at )?${NUM}(?: ?(?:%|percent))?$`), (m) => {
    const v = toNumber(m[1]);
    if (v == null) return null;
    return { kind: 'volume', op: 'set', value: Math.min(100, v), say: `Volume ${Math.min(100, v)}%` };
  }],
  [new RegExp(`^(?:(?:turn|crank|pump) )?(?:the )?(?:volume|sound)(?: (?:is)?)? (up|down|higher|lower|louder|softer|quieter)(?: (?:by )?${NUM}(?: ?(?:%|percent))?)?(?: a (?:bit|little|lot))?$`), (m) => {
    const up = ['up', 'higher', 'louder'].includes(m[1]);
    const step = toNumber(m[2]) || 10;
    return { kind: 'volume', op: up ? 'up' : 'down', value: step, say: `Volume ${up ? 'up' : 'down'}` };
  }],
  [new RegExp(`^(?:turn|crank) (up|down) (?:the )?(?:volume|sound|music)(?: (?:by )?${NUM}(?: ?(?:%|percent))?)?$`), (m) => {
    const step = toNumber(m[2]) || 10;
    return { kind: 'volume', op: m[1], value: step, say: `Volume ${m[1]}` };
  }],
  [new RegExp(`^(increase|raise|decrease|lower|reduce) (?:the )?(?:volume|sound)(?: (?:by )?${NUM}(?: ?(?:%|percent))?)?$`), (m) => {
    const up = ['increase', 'raise'].includes(m[1]);
    const step = toNumber(m[2]) || 10;
    return { kind: 'volume', op: up ? 'up' : 'down', value: step, say: `Volume ${up ? 'up' : 'down'}` };
  }],
  [/^(?:make it |a bit )?(louder|quieter|softer)$/, (m) => ({ kind: 'volume', op: m[1] === 'louder' ? 'up' : 'down', value: 10, say: `Volume ${m[1] === 'louder' ? 'up' : 'down'}` })],

  // --- brightness ---------------------------------------------------------------
  [new RegExp(`^(?:set |change )?(?:the )?(?:screen )?brightness (?:to )?${NUM}(?: ?(?:%|percent))?$`), (m) => {
    const v = toNumber(m[1]);
    if (v == null) return null;
    return { kind: 'brightness', op: 'set', value: Math.min(100, v), say: `Brightness ${v}%` };
  }],
  [/^(?:(?:turn )?(?:the )?(?:screen )?brightness (up|down)|(increase|raise|decrease|lower|reduce) (?:the )?(?:screen )?brightness|(?:turn|make) (?:the )?screen (brighter|darker|dimmer))$/, (m) => {
    const w = m[1] || m[2] || m[3];
    const up = ['up', 'increase', 'raise', 'brighter'].includes(w);
    return { kind: 'brightness', op: up ? 'up' : 'down', value: 20, say: `Brightness ${up ? 'up' : 'down'}` };
  }],

  // --- wallpaper -------------------------------------------------------------------
  [/^(?:(?:change|switch|set|swap|update|next|new|different|another|shuffle|rotate)\b.*\b(?:wallpaper|background|backdrop)|(?:next|new|another|different) (?:desktop )?(?:wallpaper|background))(?: please)?$/, () => ({ kind: 'wallpaper', say: 'Changing the wallpaper' })],

  // --- screenshot ----------------------------------------------------------------
  [/^(?:take (?:a )?)?(?:screenshot|screen shot|screen capture|snapshot)(?: of (?:the |my )?screen)?$|^capture (?:the |my )?screen$/, () => ({ kind: 'screenshot', say: 'Screenshot saved' })],

  // --- browser tabs & navigation ------------------------------------------------------
  [/^(?:open |create |make )?(?:a )?new tab$/, () => keyAction(['ctrl', 't'], 'New tab')],
  [/^(?:close|shut) (?:this |the |current |that )?tab$/, () => keyAction(['ctrl', 'w'], 'Closed the tab')],
  [/^(?:re ?open|restore|bring back) (?:the )?(?:last |closed |last closed )?tab$/, () => keyAction(['ctrl', 'shift', 't'], 'Reopened the tab')],
  [/^(?:go to |switch to |move to )?(?:the )?next tab$|^switch tabs?$/, () => keyAction(['ctrl', 'tab'], 'Next tab')],
  [/^(?:go to |switch to |move to )?(?:the )?(?:previous|prev|last) tab$|^(?:go )?(?:one )?tab back$/, (m) => (
    /last tab$/.test(m[0]) && !/previous|prev/.test(m[0]) ? keyAction(['ctrl', '9'], 'Last tab') : keyAction(['ctrl', 'shift', 'tab'], 'Previous tab')
  )],
  [new RegExp(`^(?:go to |switch to |open |move to |show )?(?:the )?tab (?:number )?${NUM}$`), (m) => {
    const n = toNumber(m[1]);
    if (!n || n < 1) return null;
    return keyAction(['ctrl', String(Math.min(n, 9))], `Tab ${n}`);
  }],
  [/^(?:go to |switch to |open |move to |show )?(?:the )?(first|second|third|fourth|fifth|sixth|seventh|eighth|1st|2nd|3rd|4th|5th|6th|7th|8th) tab$/, (m) => keyAction(['ctrl', String(ORDINALS[m[1]])], `Tab ${ORDINALS[m[1]]}`)],
  [/^(?:open |create )?(?:a )?(?:new )?(?:incognito|private)(?: window| tab| mode)?$/, () => keyAction(['ctrl', 'shift', 'n'], 'Incognito window')],
  [/^(?:open |create )?(?:a )?new window$/, () => keyAction(['ctrl', 'n'], 'New window')],
  [/^(?:go |navigate )?back(?: a page| one page| to the previous page)?$|^previous page$/, () => keyAction(['alt', 'left'], 'Back')],
  [/^(?:go |navigate )?forward(?: a page| one page)?$|^next page$/, () => keyAction(['alt', 'right'], 'Forward')],
  [/^(?:refresh|reload)(?: (?:the |this )?(?:page|tab|website|site))?$/, () => keyAction(['f5'], 'Refreshed')],
  [/^bookmark(?: (?:this|the|it)(?: page)?)?$/, () => keyAction(['ctrl', 'd'], 'Bookmark')],

  // --- windows --------------------------------------------------------------
  [/^(?:show (?:the )?desktop|go to (?:the )?(?:desktop|home screen)|minimi[sz]e (?:all|everything|all windows)|home screen|show home screen)$/, () => keyAction(['win', 'd'], 'Showing the desktop')],
  [new RegExp(`^minimi[sz]e(?: ${SELF})?$`), () => ({ kind: 'window', op: 'minimize', say: 'Minimized' })],
  [new RegExp(`^(?:maximi[sz]e|make (?:it|this) (?:big|bigger|full size))(?: ${SELF})?$`), () => ({ kind: 'window', op: 'maximize', say: 'Maximized' })],
  [new RegExp(`^restore(?: ${SELF})?$`), () => ({ kind: 'window', op: 'restore', say: 'Restored' })],
  [/^(?:switch|change) (?:the )?windows?$|^(?:next|other) window$|^alt tab$/, () => keyAction(['alt', 'tab'], 'Switched window')],
  [/^(?:make it |go |enter |exit |leave |turn on |turn off )?full ?screen(?: mode)?$/, () => ({ kind: 'fullscreen', say: 'Full screen' })],
  [new RegExp(`^(?:close|quit|exit|shut)(?: ${SELF})?$`), () => ({ kind: 'window', op: 'close', say: 'Closed' })],
  [/^(?:close|quit|exit|kill|shut down|shut) (.+?)(?: app| application| window)?$/, (m) => ({ kind: 'closeApp', target: the(m[1]), say: `Closing ${the(m[1])}` })],
  [/^(?:switch to|bring up|bring|focus(?: on)?|go back to|show me|jump to) (.+?)(?: app| window| to front)?$/, (m) => ({ kind: 'focus', target: the(m[1]), say: `Switching to ${the(m[1])}` })],

  // --- media ----------------------------------------------------------------------
  [/^(?:play|pause|resume|unpause|play pause|stop)(?: (?:the |this )?(?:video|song|music|movie|track|it|that|playback|audio))?$|^continue (?:the )?(?:video|song|music|playing)$/, (m) => ({ kind: 'media', op: 'playpause', say: m[0].startsWith('pause') || m[0].startsWith('stop') ? 'Paused' : 'Play' })],
  [/^(?:next|skip)(?: (?:the |this )?(?:song|video|track|one))?$|^skip (?:this|it)$/, () => ({ kind: 'media', op: 'next', say: 'Next' })],
  [/^previous(?: (?:song|video|track))?$|^(?:last|go back to the previous) (?:song|video|track)$/, () => ({ kind: 'media', op: 'previous', say: 'Previous' })],

  // --- keyboard ------------------------------------------------------------------
  [/^(?:(?:click|press|hit|tap|push|do|type) )?(?:the )?(?:enter|return|ender|inter)(?: key| button)?(?: it)?$|^(?:enter|submit|send|search) it$|^submit$|^go$|^ok enter$/, () => keyAction(['enter'], 'Pressed Enter')],
  [/^select all(?: (?:the )?text)?$|^select everything$/, () => keyAction(['ctrl', 'a'], 'Selected all')],
  [/^copy(?: (?:this|that|it|the text|text|all|everything))?$/, () => keyAction(['ctrl', 'c'], 'Copied')],
  [/^paste(?: (?:this|that|it|here|the text|text))?$/, () => keyAction(['ctrl', 'v'], 'Pasted')],
  [/^cut(?: (?:this|that|it|the text|text))?$/, () => keyAction(['ctrl', 'x'], 'Cut')],
  [/^undo(?: (?:this|that|it|the last (?:thing|change)))?$/, () => keyAction(['ctrl', 'z'], 'Undone')],
  [/^redo(?: (?:this|that|it))?$/, () => keyAction(['ctrl', 'y'], 'Redone')],
  [/^save(?: (?:this|that|it|the file|file|the document|document|changes|my work))?$/, () => keyAction(['ctrl', 's'], 'Saved')],
  [/^(?:delete|remove|erase|clear) (?:the )?(?:last|previous) word$/, () => ({ kind: 'sequence', steps: [keyAction(['ctrl', 'shift', 'left']), keyAction(['delete'])], say: 'Deleted a word' })],
  [/^(?:delete|remove|erase|clear)(?: (?:this|that|it|the text|text|selection))?$/, () => keyAction(['delete'], 'Deleted')],
  [/^(?:clear|delete|erase) (?:everything|all(?: the text)?|the (?:box|field|search))$/, () => ({ kind: 'sequence', steps: [keyAction(['ctrl', 'a']), keyAction(['delete'])], say: 'Cleared' })],
  [/^(?:new line|next line|line break)$/, () => keyAction(['shift', 'enter'], 'New line')],
  [/^zoom in$/, () => keyAction(['ctrl', '='], 'Zoom in')],
  [/^zoom out$/, () => keyAction(['ctrl', '-'], 'Zoom out')],
  [/^(?:reset zoom|zoom reset|normal zoom|actual size)$/, () => keyAction(['ctrl', '0'], 'Zoom reset')],
  [/^(?:find|search for|look for) (.+?) (?:on|in) (?:this|the) page$/, (m, o) => ({ kind: 'sequence', steps: [keyAction(['ctrl', 'f']), { kind: 'type', text: o[1] }], freeText: true, say: `Finding "${o[1]}"` })],
  [/^(press|hit|tap|push|click) (.+)$/, (m) => {
    // "click 7" means the 7th numbered thing on screen, not the 7 key.
    if (/^(?:click|tap)$/.test(m[1]) && /^\d+$/.test(m[2])) return null;
    const spoken = m[2].replace(/ (?:key|button)$/, '').replace(/\bplus\b/g, ' ');
    const keys = [];
    const words = spoken.split(' ').filter(Boolean);
    for (let i = 0; i < words.length; i++) {
      const two = `${words[i]} ${words[i + 1] || ''}`.trim();
      if (KEY_NAMES[two]) { keys.push(KEY_NAMES[two]); i++; continue; }
      if (KEY_NAMES[words[i]]) { keys.push(KEY_NAMES[words[i]]); continue; }
      if (/^[a-z0-9]$/.test(words[i])) { keys.push(words[i]); continue; }
      return null;
    }
    if (!keys.length) return null;
    return keyAction(keys, `Pressed ${keys.join(' + ')}`);
  }],
  [/^(?:escape|esc)$/, () => keyAction(['esc'], 'Escape')],
  [/^(?:backspace|back space)$/, () => keyAction(['backspace'], 'Backspace')],
  [/^(?:space|spacebar|space bar)$/, () => keyAction(['space'], 'Space')],
  [/^(?:arrow )?(up|down|left|right)(?: arrow)?$/, (m) => keyAction([m[1]], `${m[1]} arrow`)],

  // --- scrolling -------------------------------------------------------------------
  [/^(?:scroll|go|move) (?:to (?:the )?)?(top|bottom|beginning|end|start)(?: of (?:the |this )?page)?$/, (m) => (
    ['top', 'beginning', 'start'].includes(m[1]) ? keyAction(['ctrl', 'home'], 'Top of page') : keyAction(['ctrl', 'end'], 'Bottom of page')
  )],
  [/^scroll (?:the page )?(down|up)(?: (a lot|a lot more|more|a little|a bit|little|slowly))?$|^scroll$/, (m) => {
    const dir = m[1] || 'down';
    const amount = !m[2] ? 5 : /lot/.test(m[2]) ? 15 : /little|bit|slowly/.test(m[2]) ? 2 : 8;
    return { kind: 'mouse', what: 'scroll', amount: dir === 'up' ? amount : -amount, say: `Scrolled ${dir}` };
  }],
  [/^page (down|up)$/, (m) => keyAction([`page${m[1]}`], `Page ${m[1]}`)],

  // --- mouse -------------------------------------------------------------------------
  [/^(?:left )?click(?: (?:here|it|this|that|there|on it|on this|on that|the mouse|mouse))?$/, () => ({ kind: 'mouse', what: 'left', say: 'Clicked' })],
  [/^double[ -]?click(?: (?:here|it|this|that|there|on it))?$/, () => ({ kind: 'mouse', what: 'double', say: 'Double-clicked' })],
  [/^right[ -]?click(?: (?:here|it|this|that|there|on it))?$/, () => ({ kind: 'mouse', what: 'right', say: 'Right-clicked' })],

  // --- click things on screen by their name (or number, when numbers are showing) ---------
  [new RegExp(`^type (?:into|in|on) (?:number |box |field )?(\\d+|${NUMBER_WORDS}) (.+)$`), (m, o) => {
    const n = toNumber(m[1]);
    if (!n) return null;
    return { kind: 'clickNumber', n, button: 'left', thenType: o[2], freeText: true, say: `Typing into ${n}` };
  }],
  [new RegExp(`^(?:(double|right)[ -]?)?(?:click|tap|press|hit|select|choose|push|open)(?: on)? (?:number )?(\\d+|${NUMBER_WORDS})$`), (m) => {
    const n = toNumber(m[2]);
    if (!n) return null;
    return { kind: 'clickNumber', n, button: m[1] || 'left', say: `${m[1] ? m[1] + '-c' : 'C'}licked ${n}` };
  }],
  [/^(?:(double|right)[ -]?)?(?:click|tap|press|hit|select|choose|push)(?: on)? (?:the )?(.+?)(?: button| link| tab| icon| option| menu| box| field| bar)?$/, (m, o) => ({
    kind: 'clickName', target: o[2].replace(/^(?:the)\s+/i, ''), button: m[1] || 'left', say: `Clicking "${o[2]}"`,
  })],

  // --- typing ---------------------------------------------------------------------------
  [/^(?:type|write|dictate|type in|type out|enter the text|write down)(?: the text| this)?:? (.+)$/, (m, o) => ({ kind: 'type', text: o[1], freeText: true, say: `Typing "${o[1]}"` })],

  // --- search & play --------------------------------------------------------------------
  [/^(?:play|put on|start playing)(?: the)? (?:song |video |music |movie )?(.+?)(?: (?:on|in|from) (?:youtube|you tube))?$/, (m, o) => ({ kind: 'play', query: o[1], freeText: true, say: `Playing "${o[1]}" on YouTube` })],
  [/^(?:youtube|you tube) (?:search )?(?:for )?(.+)$/, (m, o) => ({ kind: 'search', engine: 'youtube', query: o[1], freeText: true, say: `YouTube: ${o[1]}` })],
  [/^(?:search|look up|lookup|find|google|look for|search up)(?: for| about)? (.+?) (?:on|in|using|at|from) (google images|google maps|google|youtube|you tube|amazon|flipkart|wikipedia|github|maps|bing|spotify|images)$/, (m, o) => ({ kind: 'search', engine: ENGINES[m[2]], query: o[1], freeText: true, say: `Searching ${m[2]}: ${o[1]}` })],
  [/^(?:search|find|look up) (google images|google maps|google|youtube|you tube|amazon|flipkart|wikipedia|github|maps|bing|spotify|images) (?:for |about )?(.+)$/, (m, o) => ({ kind: 'search', engine: ENGINES[m[1]], query: o[2], freeText: true, say: `Searching ${m[1]}: ${o[2]}` })],
  [/^google (.+)$/, (m, o) => ({ kind: 'search', engine: 'google', query: o[1], freeText: true, say: `Google: ${o[1]}` })],
  [/^(?:search|look up|lookup|find|look for|search up|search the web)(?: for| about)? (.+)$/, (m, o) => ({ kind: 'search', engine: 'auto', query: o[1], freeText: true, say: `Searching: ${o[1]}` })],
  [/^(?:search|find|look up|google|type|write|play)(?: for)?$/, (m) => ({ kind: 'incomplete', verb: m[0], say: 'What should I ' + m[0].split(' ')[0] + '?' })],

  // --- change url / go to site ---------------------------------------------------------------
  [/^(?:change|switch|set) (?:the )?(?:url|link|address|website|site|page) (?:to )?(.+)$/, (m) => ({ kind: 'navigate', target: the(m[1]), say: `Going to ${the(m[1])}` })],
  [/^(?:go to|navigate to|visit|take me to|head to) (.+)$/, (m) => ({ kind: 'navigate', target: the(m[1]), say: `Going to ${the(m[1])}` })],

  // --- open ---------------------------------------------------------------------------------
  [/^(?:open|launch|start|run|show|load|fire up|bring up)(?: up)? (.+?)(?: app| application| website| site| page| for me)?$/, (m) => ({ kind: 'open', target: the(m[1]), say: `Opening ${the(m[1])}` })],
  [/^(?:open|launch|start)$/, (m) => ({ kind: 'incomplete', verb: m[0], say: 'Open what?' })],
];

// Rules are matched on lowercase text; the same rule run case-insensitively on the
// original gives free text (typing, searches) with its capital letters intact.
const RULES_ANY_CASE = RULES.map(([re]) => new RegExp(re.source, re.flags.includes('i') ? re.flags : re.flags + 'i'));

// Whisper often hears the command word in past tense: "closed tab", "turned off wifi".
const PAST_TENSE = {
  closed: 'close', opened: 'open', turned: 'turn', searched: 'search', typed: 'type', pressed: 'press',
  clicked: 'click', played: 'play', muted: 'mute', unmuted: 'unmute', switched: 'switch', minimized: 'minimize',
  maximized: 'maximize', locked: 'lock', restarted: 'restart', changed: 'change', launched: 'launch',
  started: 'start', paused: 'pause', resumed: 'resume', scrolled: 'scroll', selected: 'select', copied: 'copy',
  pasted: 'paste', saved: 'save', refreshed: 'refresh', reloaded: 'reload', googled: 'google', enabled: 'enable',
  disabled: 'disable', increased: 'increase', decreased: 'decrease', lowered: 'lower', raised: 'raise',
};

// Your own commands and recorded routines: "morning routine", "run morning routine",
// "start work mode" all find the saved "morning routine" / "work mode".
function findCustom(text, custom) {
  if (!custom) return null;
  const bare = text.replace(/^(?:run|do|start|begin|launch|activate|play|go into|switch to|turn on) (?:my |the )?/, '');
  for (const candidate of [text, bare, `${bare} routine`, bare.replace(/ routine$/, ''), `${bare} mode`, bare.replace(/ mode$/, '')]) {
    if (Object.hasOwn(custom, candidate)) return candidate;
  }
  return null;
}

function parsePart(part, custom) {
  const original = stripFillers(part).replace(/^(\S+)/, (w) => PAST_TENSE[w.toLowerCase()] || w);
  const text = original.toLowerCase();
  if (!text) return null;
  const own = findCustom(text, custom);
  if (own) return { kind: 'custom', name: own, say: `Running "${own}"`, heard: text };
  for (let r = 0; r < RULES.length; r++) {
    const [re, make] = RULES[r];
    const m = text.match(re);
    if (m) {
      const o = original.match(RULES_ANY_CASE[r]) || m;
      const action = make(m, o);
      if (action) return { ...action, heard: text };
    }
  }
  return { kind: 'unknown', heard: text };
}

// Main entry: text AFTER the wake word -> { actions, unknown }.
function parseCommand(raw, options = {}) {
  const text = stripFillers(cleanText(raw, true));
  if (!text) return { actions: [], unknown: [], empty: true };
  const parts = splitChain(text);
  const actions = [];
  const unknown = [];
  for (const part of parts) {
    const action = parsePart(part, options.custom);
    if (!action) continue;
    if (action.kind === 'unknown') unknown.push(action.heard);
    else actions.push(action);
  }
  // "type hello and search" / "type hello and enter": a bare "search" after typing means Enter.
  for (let i = 1; i < actions.length; i++) {
    if (actions[i].kind === 'incomplete' && actions[i - 1].kind === 'type') {
      actions[i] = { ...keyAction(['enter'], 'Pressed Enter'), heard: actions[i].heard };
    }
  }
  return { actions, unknown, text };
}

const isYes = (raw) => /^(?:yes|yeah|yep|yup|ya|yah|yes please|confirm|confirmed|do it|go ahead|sure|ok|okay|yes do it|absolutely|affirmative)$/.test(stripFillers(cleanText(raw)).replace(/^(?:hey |ok )?/, ''));

module.exports = { dropRepeats, cleanText, detectWake, parseCommand, splitChain, toNumber, isYes, SITES, ENGINES, VERBS };
