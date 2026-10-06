// Checks that spoken sentences turn into the right actions. Run: node tests/parser.test.js
const { detectWake, parseCommand, isYes } = require('../brain/parser');

// [what Whisper might hear, expected summary]. Summary format: kind:detail, joined by " | ".
const CASES = [
  // wake word variations
  ['Jarvis, open YouTube', 'open:youtube'],
  // JARVIS himself
  ['Jarvis, hello', 'chat'], ['Jarvis how are you', 'chat'], ['Jarvis, who are you?', 'chat'], ['Thank you Jarvis', 'NOWAKE'],
  ['Jarvis thank you', 'chat'], ['Jarvis, battery', 'sysinfo:battery'], ['Jarvis system status', 'sysinfo:status'],
  ['Jarvis, quit.', 'visibility:hide'], ['Jarvis exit', 'visibility:hide'], ['Jarvis bye', 'visibility:hide'],
  ['Jarvis go away', 'visibility:hide'], ['Jarvis come here', 'visibility:show'], ['Jarvis open WhatsApp', 'open:whatsapp'],
  ['Jarvis, quit Jarvis completely', 'quitApp'], ['Jarvis what is the time', 'time'],
  ['jarvis open YouTube.', 'open:youtube'],
  ['Hey Jarvis, open the browser and open Slack.', 'open:browser | open:slack'],
  ['Jarvas, open notepad', 'open:notepad'],
  ['Javis open Chrome', 'open:chrome'],
  ['Jervis Volume Up', 'volume:up'],
  ['Okay jarvis, next tab', 'key:ctrl+tab'],
  ['Jarvis, jarvis, open YouTube', 'open:youtube'],
  ['Jar vis open YouTube', 'open:youtube'],

  // the user's own examples
  ['Jarvis enter', 'key:enter'],
  ['Jarvis please click enter', 'key:enter'],
  ['Jarvis, press enter.', 'key:enter'],
  ['Jarvis hit enter', 'key:enter'],
  ['Jarvis open the browser and open Slack', 'open:browser | open:slack'],
  ['Jarvis open YouTube and search blockbuster Telugu songs', 'open:youtube | search:auto:blockbuster telugu songs'],
  ['Jarvis search blockbuster Telugu songs on YouTube', 'search:youtube:blockbuster telugu songs'],
  ['Jarvis go to the next tab', 'key:ctrl+tab'],
  ['Jarvis turn off the Wi-Fi', 'radio:WiFi:Off'],
  ['Jarvis turn on wifi', 'radio:WiFi:On'],
  ['Jarvis wifi off', 'radio:WiFi:Off'],
  ['Jarvis restart the computer', 'power:restart:confirm'],
  ['Jarvis shut down the computer.', 'power:shutdown:confirm'],
  ['Jarvis shutdown', 'power:shutdown:confirm'],
  ['Jarvis change the background of the wallpaper', 'wallpaper'],
  ['Jarvis change the URL to github.com', 'navigate:github.com'],
  ['Jarvis open Chrome and search for cricket scores', 'open:chrome | search:auto:cricket scores'],

  // apps & windows
  ['Jarvis launch VS Code', 'open:vs code'],
  ['Jarvis open file explorer', 'open:file explorer'],
  ['Jarvis open settings', 'open:settings'],
  ['Jarvis open my downloads', 'open:downloads'],
  ['Jarvis close this', 'window:close'],
  ['Jarvis close the window', 'window:close'],
  ['Jarvis close Chrome', 'closeApp:chrome'],
  ['Jarvis minimize', 'window:minimize'],
  ['Jarvis minimize this window', 'window:minimize'],
  ['Jarvis maximize it', 'window:maximize'],
  ['Jarvis show desktop', 'key:win+d'],
  ['Jarvis go to the home screen', 'key:win+d'],
  ['Jarvis minimize everything', 'key:win+d'],
  ['Jarvis switch to Chrome', 'focus:chrome'],
  ['Jarvis switch windows', 'key:alt+tab'],
  ['Jarvis full screen', 'fullscreen'],

  // browser
  ['Jarvis new tab', 'key:ctrl+t'],
  ['Jarvis open a new tab', 'key:ctrl+t'],
  ['Jarvis close tab', 'key:ctrl+w'],
  ['Jarvis close this tab', 'key:ctrl+w'],
  ['Jarvis previous tab', 'key:ctrl+shift+tab'],
  ['Jarvis tab 3', 'key:ctrl+3'],
  ['Jarvis go to tab three', 'key:ctrl+3'],
  ['Jarvis switch to the second tab', 'key:ctrl+2'],
  ['Jarvis last tab', 'key:ctrl+9'],
  ['Jarvis reopen closed tab', 'key:ctrl+shift+t'],
  ['Jarvis go back', 'key:alt+left'],
  ['Jarvis go forward', 'key:alt+right'],
  ['Jarvis refresh', 'key:f5'],
  ['Jarvis reload the page', 'key:f5'],
  ['Jarvis incognito', 'key:ctrl+shift+n'],
  ['Jarvis go to YouTube', 'navigate:youtube'],
  ['Jarvis go to gmail', 'navigate:gmail'],
  ['Jarvis search for weather in Hyderabad', 'search:auto:weather in hyderabad'],
  ['Jarvis google best laptop under 60000', 'search:google:best laptop under 60000'],
  ['Jarvis YouTube search lofi music', 'search:youtube:lofi music'],
  ['Jarvis search Amazon for wireless mouse', 'search:amazon:wireless mouse'],
  ['Jarvis search tom and jerry on YouTube', 'search:youtube:tom and jerry'],
  ['Jarvis play Naatu Naatu on YouTube', 'play:naatu naatu'],
  ['Jarvis play believer', 'play:believer'],
  ['Jarvis search', 'incomplete'],

  // keyboard & mouse
  ['Jarvis type hello world', 'type:hello world'],
  ['Jarvis type hello world and press enter', 'type:hello world | key:enter'],
  ['Jarvis type good morning and search', 'type:good morning | key:enter'],
  ['Jarvis select all', 'key:ctrl+a'],
  ['Jarvis copy', 'key:ctrl+c'],
  ['Jarvis copy that', 'key:ctrl+c'],
  ['Jarvis paste', 'key:ctrl+v'],
  ['Jarvis undo', 'key:ctrl+z'],
  ['Jarvis save', 'key:ctrl+s'],
  ['Jarvis delete that', 'key:delete'],
  ['Jarvis delete the last word', 'sequence'],
  ['Jarvis clear everything', 'sequence'],
  ['Jarvis press escape', 'key:esc'],
  ['Jarvis press tab', 'key:tab'],
  ['Jarvis press control shift T', 'key:ctrl+shift+t'],
  ['Jarvis press F5', 'key:f5'],
  ['Jarvis scroll down', 'mouse:scroll:-5'],
  ['Jarvis scroll up a lot', 'mouse:scroll:15'],
  ['Jarvis page down', 'key:pagedown'],
  ['Jarvis go to the top', 'key:ctrl+home'],
  ['Jarvis scroll to the bottom', 'key:ctrl+end'],
  ['Jarvis click', 'mouse:left'],
  ['Jarvis double click', 'mouse:double'],
  ['Jarvis right click', 'mouse:right'],
  ['Jarvis zoom in', 'key:ctrl+='],

  // media
  ['Jarvis pause', 'media:playpause'],
  ['Jarvis pause the video', 'media:playpause'],
  ['Jarvis play', 'media:playpause'],
  ['Jarvis resume', 'media:playpause'],
  ['Jarvis stop', 'media:playpause'],
  ['Jarvis next song', 'media:next'],
  ['Jarvis skip', 'media:next'],

  // system
  ['Jarvis volume up', 'volume:up:10'],
  ['Jarvis volume down by 20', 'volume:down:20'],
  ['Jarvis turn up the volume', 'volume:up:10'],
  ['Jarvis increase the volume', 'volume:up:10'],
  ['Jarvis set volume to 50', 'volume:set:50'],
  ['Jarvis volume fifty', 'volume:set:50'],
  ['Jarvis volume 30%', 'volume:set:30'],
  ['Jarvis max volume', 'volume:set:100'],
  ['Jarvis mute', 'volume:mute'],
  ['Jarvis unmute', 'volume:unmute'],
  ['Jarvis louder', 'volume:up:10'],
  ['Jarvis brightness up', 'brightness:up'],
  ['Jarvis turn off bluetooth', 'radio:Bluetooth:Off'],
  ['Jarvis disable bluetooth', 'radio:Bluetooth:Off'],
  ['Jarvis next wallpaper', 'wallpaper'],
  ['Jarvis change wallpaper', 'wallpaper'],
  ['Jarvis take a screenshot', 'screenshot'],
  ['Jarvis lock the computer', 'power:lock'],
  ['Jarvis lock', 'power:lock'],
  ['Jarvis put the computer to sleep', 'power:sleep'],
  ['Jarvis reboot', 'power:restart:confirm'],
  ['Jarvis cancel shutdown', 'power:cancel'],
  ['Jarvis log out', 'power:signout:confirm'],
  ['Jarvis what time is it', 'time'],
  ['Jarvis what can you do', 'help'],
  ['Jarvis never mind', 'cancel'],
  ['Jarvis stop listening', 'stopListening'],
  ['Jarvis can you please open YouTube for me', 'open:youtube'],
  ['Jarvis open YouTube then search songs then press enter', 'open:youtube | search:auto:songs | key:enter'],
  ['Jarvis open notepad and type hello', 'open:notepad | type:hello'],

  // not for Jarvis: no wake word
  ['I need to buy some stuff today', 'NOWAKE'],
  ['Let me study for the exam', 'NOWAKE'],
  ['Steve, can you open the door', 'NOWAKE'],
  ['open YouTube', 'NOWAKE'],
  ['This song is a blockbuster hit', 'NOWAKE'],
  ['The jarvis room needs air', 'NOWAKE'],

  // wake word but nonsense after it
  ['Jarvis banana helicopter', 'UNKNOWN'],

  // v2: dictation
  ['Jarvis dictation', 'dictation'],
  ['Jarvis start dictation', 'dictation'],
  ['Jarvis take dictation', 'dictation'],
  ['Jarvis type what I say', 'dictation'],

  // v2: clicking by name / number
  ['Jarvis click Subscribe', 'clickName:subscribe:left'],
  ['Jarvis click the search box', 'clickName:search:left'],
  ['Jarvis click on sign in', 'clickName:sign in:left'],
  ['Jarvis double click my documents', 'clickName:my documents:double'],
  ['Jarvis right click the file', 'clickName:file:right'],
  ['Jarvis show numbers', 'numbers:show'],
  ['Jarvis hide numbers', 'numbers:hide'],
  ['Jarvis click 7', 'clickNumber:7:left'],
  ['Jarvis click number twelve', 'clickNumber:12:left'],
  ['Jarvis double click 3', 'clickNumber:3:double'],
  ['Jarvis type into 3 hello', 'clickNumber:3:left'],
  ['Jarvis click enter', 'key:enter'],
  ['Jarvis click', 'mouse:left'],

  // v2: timers & reminders
  ['Jarvis set a timer for 5 minutes', 'timer:add:300000'],
  ['Jarvis timer for ten minutes', 'timer:add:600000'],
  ['Jarvis 25 minute timer', 'timer:add:1500000'],
  ['Jarvis set a timer for an hour and a half', 'timer:add:5400000'],
  ['Jarvis set a timer for half an hour', 'timer:add:1800000'],
  ['Jarvis remind me in 20 minutes to drink water', 'timer:remind:drink water'],
  ['Jarvis remind me to call mom in 1 hour', 'timer:remind:call mom'],
  ['Jarvis remind me at 6 pm to go to the gym', 'timer:remind:go to the gym'],
  ['Jarvis remind me at 6:30 p.m. to call mom', 'timer:remind:call mom'],
  ['Jarvis remind me tomorrow at 9 am to submit the form', 'timer:remind:submit the form'],
  ['Jarvis remind me to feed the hamster at 8', 'timer:remind:feed the hamster'],
  ['Jarvis what are my timers', 'timer:list'],
  ['Jarvis cancel the timer', 'timer:cancel:timer'],
  ['Jarvis cancel all reminders', 'timer:cancel:reminder'],
  ['Jarvis stop the timer', 'timer:cancel:timer'],

  // v2: routines & editor
  ['Jarvis start recording', 'record:start'],
  ['Jarvis stop recording', 'record:stop'],
  ['Jarvis save it as morning routine', 'record:save:morning routine'],
  ['Jarvis cancel recording', 'record:cancel'],
  ['Jarvis open my commands', 'editor'],
  ['Jarvis edit my commands', 'editor'],

  // v2: Focus Dot
  ['Jarvis add a Q1 task finish editing', 'focusdot:add:1:finish editing'],
  ['Jarvis add task buy hamster food', 'focusdot:add::buy hamster food'],
  ['Jarvis add an urgent task call the bank', 'focusdot:add:1:call the bank'],
  ['Jarvis new task clean the cage in q three', 'focusdot:add:3:clean the cage'],
  ['Jarvis what are my tasks', 'focusdot:list'],
  ['Jarvis mark finish editing as done', 'focusdot:done:finish editing'],
  ['Jarvis pause the task', 'focusdot:pause'],
  ['Jarvis start task finish editing', 'focusdot:start:finish editing'],
  ['Jarvis add a note buy hamster food', 'focusdot:note:buy hamster food'],

  // v2: snap windows
  ['Jarvis snap left', 'key:win+left'],
  ['Jarvis snap it to the right', 'key:win+right'],
  ['Jarvis move it to the other screen', 'key:win+shift+right'],
  ['Jarvis make it smaller', 'key:win+down'],

  // hide / show Jarvis on screen
  ['Jarvis hide', 'visibility:hide'],
  ['Jarvis hide yourself', 'visibility:hide'],
  ['Jarvis disappear', 'visibility:hide'],
  ['Jarvis show yourself', 'visibility:show'],
  ['Jarvis come back', 'visibility:show'],
  ['Jarvis unhide', 'visibility:show'],
  ['Jarvis hide numbers', 'numbers:hide'],

  // past tense mis-hearings
  ['Jarvis, closed tab', 'key:ctrl+w'],
  ['Jarvis turned off the wifi', 'radio:WiFi:Off'],
  ['Jarvis opened YouTube and searched cats', 'open:youtube | search:auto:cats'],
];

function summarize(action) {
  switch (action.kind) {
    case 'key': return `key:${action.keys.join('+')}`;
    case 'open': case 'navigate': case 'focus': case 'closeApp': return `${action.kind}:${action.target}`;
    case 'search': return `search:${action.engine}:${action.query}`;
    case 'play': return `play:${action.query}`;
    case 'type': return `type:${action.text}`;
    case 'window': return `window:${action.op}`;
    case 'radio': return `radio:${action.radio}:${action.state}`;
    case 'volume': return `volume:${action.op}${action.value != null && action.op !== 'mute' && action.op !== 'unmute' ? ':' + action.value : ''}`;
    case 'brightness': return `brightness:${action.op}`;
    case 'power': return `power:${action.op}${action.confirm ? ':confirm' : ''}`;
    case 'mouse': return `mouse:${action.what}${action.what === 'scroll' ? ':' + action.amount : ''}`;
    case 'media': return `media:${action.op}`;
    case 'clickName': return `clickName:${action.target}:${action.button}`;
    case 'clickNumber': return `clickNumber:${action.n}:${action.button}`;
    case 'numbers': return `numbers:${action.op}`;
    case 'chat': return 'chat';
    case 'sysinfo': return `sysinfo:${action.op}`;
    case 'visibility': return `visibility:${action.show ? 'show' : 'hide'}`;
    case 'timer':
      if (action.op === 'add') return `timer:add:${action.durationMs}`;
      if (action.op === 'remind') return `timer:remind:${action.label}`;
      if (action.op === 'cancel') return `timer:cancel:${action.which}`;
      return `timer:${action.op}`;
    case 'record': return `record:${action.op}${action.name ? ':' + action.name : ''}`;
    case 'focusdot':
      if (action.op === 'add') return `focusdot:add:${action.q || ''}:${action.title}`;
      if (action.op === 'note') return `focusdot:note:${action.text}`;
      return `focusdot:${action.op}${action.title ? ':' + action.title : ''}`;
    default: return action.kind;
  }
}

function run(sentence) {
  const wake = detectWake(sentence);
  if (!wake.found) return 'NOWAKE';
  const { actions, unknown } = parseCommand(wake.rest);
  if (unknown.length) return 'UNKNOWN';
  return actions.map(summarize).join(' | ');
}

let failed = 0;
for (const [sentence, expected] of CASES) {
  const got = run(sentence);
  // Allow "volume:up" style expectations to ignore the step value.
  const ok = got.toLowerCase() === expected.toLowerCase() || (expected.split(':').length === 2 && got.startsWith(expected + ':') && !got.includes('|'));
  if (!ok) {
    failed++;
    console.log(`FAIL  "${sentence}"\n      expected: ${expected}\n      got:      ${got}`);
  }
}

// Typed text and search words must keep their capital letters.
const caseChecks = [
  ['Jarvis type Hello World', 'Hello World', (a) => a.text],
  ['Jarvis search Naatu Naatu on YouTube', 'Naatu Naatu', (a) => a.query],
  ['Jarvis, type Good Morning and press enter', 'Good Morning', (a) => a.text],
];
for (const [sentence, want, pick] of caseChecks) {
  const got = pick(parseCommand(detectWake(sentence).rest).actions[0]);
  if (got !== want) { failed++; console.log(`FAIL  case kept for "${sentence}": got "${got}"`); }
}

// Whisper's repeat loops are cleaned, real text is left alone.
const { dropRepeats } = require('../brain/parser');
const repeatChecks = [
  ['Next tab Next tab Next tab Next', 'Next tab'],
  ['Open YouTube Open YouTube Open YouTube Open', 'Open YouTube'],
  ['Jarvis, volume up.', 'Jarvis, volume up.'],
  ['Jarvis play Naatu Naatu', 'Jarvis play Naatu Naatu'],
  ['search tom and jerry', 'search tom and jerry'],
  ['Hello World', 'Hello World'],
];
for (const [input, want] of repeatChecks) {
  const got = dropRepeats(input);
  if (got !== want) { failed++; console.log(`FAIL  dropRepeats("${input}") = "${got}", want "${want}"`); }
}

const yes = ['yes', 'Yes.', 'yeah', 'Yes please', 'confirm', 'do it', 'Okay.'];
const notYes = ['no', 'cancel', 'wait', 'yes and no', 'maybe'];
for (const y of yes) if (!isYes(y)) { failed++; console.log(`FAIL  isYes("${y}") should be true`); }
for (const n of notYes) if (isYes(n)) { failed++; console.log(`FAIL  isYes("${n}") should be false`); }

const total = CASES.length + repeatChecks.length + caseChecks.length + yes.length + notYes.length;
console.log(`\n${total - failed}/${total} parser checks passed`);
process.exit(failed ? 1 : 0);
