// Carries out parsed actions on Windows. Plain Node (no Electron) so it can be tested directly.
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SITES } = require('../brain/parser');
const clicker = require('./clicker');
const focusdot = require('./focusdot');

const VK = {
  ctrl: 0x11, shift: 0x10, alt: 0x12, win: 0x5b, enter: 0x0d, esc: 0x1b, tab: 0x09, backspace: 0x08,
  delete: 0x2e, insert: 0x2d, space: 0x20, up: 0x26, down: 0x28, left: 0x25, right: 0x27, home: 0x24,
  end: 0x23, pageup: 0x21, pagedown: 0x22, printscreen: 0x2c, capslock: 0x14, '=': 0xbb, '-': 0xbd,
  playpause: 0xb3, next: 0xb0, previous: 0xb1, volup: 0xaf, voldown: 0xae, volmute: 0xad,
};
for (let i = 1; i <= 12; i++) VK[`f${i}`] = 0x6f + i;
for (let i = 0; i <= 9; i++) VK[String(i)] = 0x30 + i;
for (let c = 65; c <= 90; c++) VK[String.fromCharCode(c + 32)] = c;

const BROWSERS = ['chrome', 'msedge', 'firefox', 'brave', 'opera', 'vivaldi'];
const IMAGE_EXT = /\.(jpe?g|png|bmp|webp)$/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Things people say that aren't in the Start menu under that name.
const SPECIAL = {
  settings: 'ms-settings:', 'windows settings': 'ms-settings:', 'pc settings': 'ms-settings:',
  'wifi settings': 'ms-settings:network-wifi', 'network settings': 'ms-settings:network',
  'bluetooth settings': 'ms-settings:bluetooth', 'display settings': 'ms-settings:display',
  'sound settings': 'ms-settings:sound', 'wallpaper settings': 'ms-settings:personalization-background',
  'background settings': 'ms-settings:personalization-background', 'update settings': 'ms-settings:windowsupdate',
  'windows update': 'ms-settings:windowsupdate', 'apps settings': 'ms-settings:appsfeatures',
  'file explorer': 'explorer', explorer: 'explorer', files: 'explorer', 'my files': 'explorer',
  'file manager': 'explorer', 'this pc': 'shell:MyComputerFolder', 'my computer': 'shell:MyComputerFolder',
  computer: 'shell:MyComputerFolder', downloads: 'shell:Downloads', 'downloads folder': 'shell:Downloads',
  documents: 'shell:Personal', 'documents folder': 'shell:Personal', desktop: 'shell:Desktop',
  'desktop folder': 'shell:Desktop', pictures: 'shell:My Pictures', photos: 'shell:My Pictures',
  'pictures folder': 'shell:My Pictures', music: 'shell:My Music', videos: 'shell:My Video',
  'recycle bin': 'shell:RecycleBinFolder', trash: 'shell:RecycleBinFolder',
  'task manager': 'taskmgr', 'control panel': 'control', 'command prompt': 'cmd', cmd: 'cmd',
  terminal: 'wt', 'windows terminal': 'wt', powershell: 'powershell', 'snipping tool': 'ms-screenclip:',
  calculator: 'calc', calc: 'calc', paint: 'mspaint',
};
const BROWSER_WORDS = ['browser', 'web browser', 'the browser', 'internet', 'web', 'chrome', 'google chrome'];
const APP_ALIASES = {
  'vs code': 'visual studio code', vscode: 'visual studio code', code: 'visual studio code',
  'visual code': 'visual studio code', word: 'word', excel: 'excel', powerpoint: 'powerpoint',
  'power point': 'powerpoint', edge: 'microsoft edge', 'microsoft edge': 'microsoft edge',
  'note pad': 'notepad', 'davinci': 'davinci resolve', resolve: 'davinci resolve', 'da vinci resolve': 'davinci resolve',
};

function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

function findChrome() {
  const candidates = [
    path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
  ];
  return candidates.find((p) => { try { return fs.existsSync(p); } catch { return false; } }) || null;
}

function searchUrl(engine, query) {
  const q = encodeURIComponent(query);
  switch (engine) {
    case 'youtube': return `https://www.youtube.com/results?search_query=${q}`;
    case 'amazon': return `https://www.amazon.in/s?k=${q}`;
    case 'flipkart': return `https://www.flipkart.com/search?q=${q}`;
    case 'wikipedia': return `https://en.wikipedia.org/w/index.php?search=${q}`;
    case 'github': return `https://github.com/search?q=${q}`;
    case 'maps': return `https://www.google.com/maps/search/${q}`;
    case 'bing': return `https://www.bing.com/search?q=${q}`;
    case 'spotify': return `https://open.spotify.com/search/${q}`;
    case 'images': return `https://www.google.com/search?tbm=isch&q=${q}`;
    default: return `https://www.google.com/search?q=${q}`;
  }
}

class Executor {
  // hooks: { timers(action), openEditor(), showNumbers(items), hideNumbers() } — provided by main.js
  constructor({ helper, dryRun = false, settings = {}, custom = {}, parse = null, log = () => {}, hooks = {} }) {
    this.hooks = hooks;
    this.numbered = [];
    this.helper = helper;
    this.dryRun = dryRun;
    this.settings = settings;
    this.custom = custom;
    this.parse = parse; // for custom commands
    this.log = log;
    this.apps = null;
    this.chrome = findChrome();
  }

  async loadApps() {
    try {
      const list = await this.helper.call('start-apps', {}, 30000);
      this.apps = (list || []).filter((a) => a && a.name && !/uninstall|readme|help|documentation|release notes|website/i.test(a.name));
    } catch (err) {
      this.log(`Could not read Start menu apps: ${err.message}`);
      this.apps = [];
    }
    return this.apps.length;
  }

  // ------------------------------------------------------------------ low level
  async keys(keys) {
    const codes = keys.map((k) => {
      const code = VK[k];
      if (code === undefined) throw new Error(`Unknown key "${k}"`);
      return code;
    });
    if (this.dryRun) return;
    await this.helper.call('combo', { keys: codes });
  }

  async typeText(text) {
    if (this.dryRun) return;
    await this.helper.call('type', { b64: Buffer.from(text, 'utf8').toString('base64') });
  }

  async foreground() {
    try { return await this.helper.call('foreground'); } catch { return { hwnd: '0', process: '', title: '' }; }
  }

  launch(target, args = []) {
    if (this.dryRun) return;
    // Explorer opens shell: folders, Start-menu app ids and ms-settings: pages;
    // plain program names (calc, taskmgr, wt…) go through "start" so PATH is searched.
    const child = /^[a-z-]+:/i.test(target) && !args.length
      ? spawn('explorer.exe', [target], { detached: true, stdio: 'ignore' })
      : spawn('cmd.exe', ['/d', '/c', `start "" ${[target, ...args].map((x) => (/\s/.test(x) ? `"${x}"` : x)).join(' ')}`], {
        detached: true, windowsHide: true, stdio: 'ignore', windowsVerbatimArguments: true,
      });
    child.unref();
  }

  openUrl(url) {
    if (this.dryRun) return;
    if (this.settings.browser !== 'default' && this.chrome) {
      spawn(this.chrome, [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      this.launch(url);
    }
  }

  // Waits until a different window (or a new title) comes to the front, so the
  // next keystroke lands in the app that was just opened.
  async waitForNewWindow(before, timeoutMs = 7000) {
    if (this.dryRun) return;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      await sleep(250);
      const now = await this.foreground();
      if (now.hwnd !== before.hwnd || now.title !== before.title) {
        await sleep(700);
        return now;
      }
    }
    return null;
  }

  // ------------------------------------------------------------------ resolving names
  resolveApp(spoken) {
    const want = norm(APP_ALIASES[spoken] || spoken);
    if (!want || !this.apps) return null;
    let best = null;
    let bestScore = Infinity;
    for (const app of this.apps) {
      const name = norm(app.name);
      let score;
      if (name === want) score = 0;
      else if (name.startsWith(want) && want.length >= 3) score = 1 + (name.length - want.length) / 100;
      else if (want.length >= 4 && name.includes(want)) score = 2 + (name.length - want.length) / 100;
      else {
        const d = levenshtein(want, name);
        const limit = want.length <= 4 ? 0 : want.length <= 7 ? 1 : 2;
        if (d > limit) continue;
        score = 3 + d;
      }
      if (score < bestScore) { bestScore = score; best = app; }
    }
    return best;
  }

  resolveSite(spoken) {
    const s = spoken.replace(/\s+dot\s+/g, '.').replace(/\s+/g, ' ').trim();
    if (SITES[s]) return SITES[s];
    const compact = s.replace(/\s/g, '');
    for (const [name, url] of Object.entries(SITES)) if (name.replace(/\s/g, '') === compact) return url;
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/.*)?$/.test(compact)) return `https://${compact}`;
    return null;
  }

  // ------------------------------------------------------------------ actions
  async run(actions, report = () => {}) {
    const results = [];
    let context = {};
    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      const before = await this.foreground();
      let result;
      try {
        result = await this.runOne(action, context, before);
        result = { ok: true, say: action.say, ...result };
      } catch (err) {
        result = { ok: false, say: action.say, error: err.message };
      }
      results.push(result);
      report(result, i, actions.length);
      if (!result.ok) break; // later steps depend on earlier ones
      context = { ...context, ...(result.context || {}) };
      // Give a freshly opened app or page time to appear before typing into it.
      const next = actions[i + 1];
      if (next && result.opened && ['key', 'type', 'mouse', 'sequence', 'navigate', 'fullscreen', 'media', 'window', 'search', 'play', 'clickName', 'numbers'].includes(next.kind)) {
        await this.waitForNewWindow(before);
      } else if (next) {
        await sleep(this.dryRun ? 0 : 250);
      }
    }
    return results;
  }

  async runOne(a, context, fg) {
    switch (a.kind) {
      case 'key':
        await this.keys(a.keys);
        return {};
      case 'type':
        await this.typeText(a.text);
        return {};
      case 'sequence':
        for (const step of a.steps) {
          await this.runOne(step, context, fg);
          await sleep(this.dryRun ? 0 : 150);
        }
        return {};
      case 'mouse':
        if (!this.dryRun) await this.helper.call('mouse', { what: a.what, amount: a.amount || 0 });
        return {};
      case 'media':
        // Media keys reach YouTube, Spotify and players even when a text box has focus.
        await this.keys([a.op]);
        return {};
      case 'fullscreen':
        await this.keys(/youtube/i.test(fg.title) ? ['f'] : ['f11']);
        return {};
      case 'open':
        return this.open(a.target, context);
      case 'navigate':
        return this.navigate(a.target, fg);
      case 'search': {
        let engine = a.engine;
        if (engine === 'auto') {
          engine = context.site === 'youtube' || (/youtube/i.test(fg.title) && BROWSERS.includes(fg.process.toLowerCase())) ? 'youtube' : 'google';
        }
        const url = searchUrl(engine, a.query);
        // Inside an open browser, search in the current tab; otherwise open a new one.
        if (BROWSERS.includes(fg.process.toLowerCase()) || context.site) await this.goInCurrentTab(url);
        else this.openUrl(url);
        return { opened: true, detail: url, context: { site: engine === 'youtube' ? 'youtube' : context.site } };
      }
      case 'play':
        return this.playOnYouTube(a.query, fg, context);
      case 'window':
        return this.windowOp(a.op, fg);
      case 'closeApp':
        return this.closeApp(a.target);
      case 'focus':
        return this.focus(a.target, context);
      case 'volume':
        return this.volume(a);
      case 'brightness':
        return this.brightness(a);
      case 'radio': {
        if (this.dryRun) return {};
        const state = await this.helper.call('radio-set', { kind: a.radio, state: a.state });
        return { detail: `${a.radio} is now ${state}` };
      }
      case 'wallpaper':
        return this.nextWallpaper();
      case 'screenshot':
        await this.keys(['win', 'printscreen']);
        return { detail: 'Saved in Pictures > Screenshots' };
      case 'power':
        return this.power(a.op);
      case 'time': {
        const now = new Date();
        const time = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        const day = now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
        return { detail: `${time} · ${day}`, speak: `It's ${time}, ${day}.` };
      }
      case 'chat':
        return { detail: a.reply, speak: a.reply };
      case 'sysinfo':
        return this.sysinfo(a.op);
      case 'quitApp':
        if (!this.dryRun && this.hooks.quitApp) setTimeout(() => this.hooks.quitApp(), 2500);
        return { speak: 'Shutting down. Goodbye, sir.' };
      case 'custom': {
        const steps = this.custom[a.name] || [];
        const actions = [];
        for (const line of steps) actions.push(...this.parse(line, { custom: {} }).actions);
        const results = await this.run(actions);
        const failed = results.find((r) => !r.ok);
        if (failed) throw new Error(failed.error);
        return {};
      }
      case 'clickName':
        return this.clickName(a);
      case 'clickNumber':
        return this.clickNumber(a);
      case 'numbers':
        return this.numbers(a.op);
      case 'focusdot':
        if (this.dryRun) return { detail: `(test mode: Focus Dot ${a.op})` };
        return focusdot.run(a);
      case 'timer':
        if (!this.hooks.timers) throw new Error('Timers are not available');
        return this.hooks.timers(a);
      case 'visibility':
        // Not a dry-run concern: it only changes whether the hamster is drawn.
        if (this.hooks.setHidden) this.hooks.setHidden(!a.show);
        return {};
      case 'editor':
        if (!this.dryRun && this.hooks.openEditor) this.hooks.openEditor();
        return { opened: true };
      default:
        throw new Error(`I don't know how to do "${a.kind}"`);
    }
  }

  async sysinfo(op) {
    const os = require('os');
    let battery = null;
    if (process.platform === 'win32') {
      try {
        const out = await new Promise((resolve) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
          '$b = Get-CimInstance Win32_Battery | Select-Object -First 1; if ($b) { "$($b.EstimatedChargeRemaining) $($b.BatteryStatus)" }'],
        { windowsHide: true, timeout: 8000 }, (_e, stdout) => resolve(String(stdout || '').trim())));
        const [pct, status] = out.split(/\s+/).map(Number);
        if (pct >= 0 && out) battery = { pct, charging: status === 2 || status >= 6 };
      } catch { /* no battery info */ }
    }
    const ramUsed = Math.round((1 - os.freemem() / os.totalmem()) * 100);
    const ramGb = (os.totalmem() / 1024 ** 3).toFixed(0);
    const cpu = await cpuPercent();
    const batteryText = battery ? `Battery is at ${battery.pct} percent${battery.charging ? ' and charging' : ''}.` : 'This PC has no battery.';
    if (op === 'battery') return { detail: battery ? `🔋 ${battery.pct}%${battery.charging ? ' ⚡ charging' : ''}` : 'No battery', speak: `${batteryText.replace(/\.$/, '')}, sir.` };
    return {
      detail: `CPU ${cpu}% · RAM ${ramUsed}% of ${ramGb} GB${battery ? ` · 🔋 ${battery.pct}%` : ''}`,
      speak: `CPU at ${cpu} percent, memory at ${ramUsed} percent. ${battery ? batteryText : ''} All systems normal, sir.`.replace(/\s+/g, ' ').trim(),
    };
  }

  async open(target, context) {
    const t = target.toLowerCase().trim();
    if (BROWSER_WORDS.includes(t)) {
      if (this.settings.browser !== 'default' && this.chrome) {
        if (!this.dryRun) spawn(this.chrome, [], { detached: true, stdio: 'ignore' }).unref();
        return { opened: true, detail: 'Chrome' };
      }
      this.openUrl('https://www.google.com');
      return { opened: true, detail: 'Browser' };
    }
    // Folders and Settings pages first, then installed apps by exact name (launched
    // through Explorer so their window comes to the front), then plain program names.
    if (SPECIAL[t] && SPECIAL[t].includes(':')) {
      this.launch(SPECIAL[t]);
      return { opened: true, detail: SPECIAL[t] };
    }
    const apps = this.apps || [];
    const exact = apps.find((a) => norm(a.name) === norm(APP_ALIASES[t] || t));
    if (exact) {
      this.launch(`shell:AppsFolder\\${exact.id}`);
      return { opened: true, detail: exact.name };
    }
    if (SPECIAL[t]) {
      this.launch(SPECIAL[t]);
      return { opened: true, detail: SPECIAL[t] };
    }
    const site = this.resolveSite(t);
    if (site) {
      this.openUrl(site);
      const siteName = Object.keys(SITES).find((k) => SITES[k] === site);
      return { opened: true, detail: site, context: { site: siteName === 'you tube' ? 'youtube' : siteName || site } };
    }
    const app = this.resolveApp(t);
    if (app) {
      this.launch(`shell:AppsFolder\\${app.id}`);
      return { opened: true, detail: app.name };
    }
    throw new Error(`I couldn't find an app or website called "${target}"`);
  }

  async goInCurrentTab(url) {
    const fg = await this.foreground();
    if (!BROWSERS.includes(fg.process.toLowerCase())) {
      this.openUrl(url);
      return;
    }
    await this.keys(['ctrl', 'l']);
    await sleep(this.dryRun ? 0 : 120);
    await this.typeText(url);
    await sleep(this.dryRun ? 0 : 60);
    await this.keys(['enter']);
  }

  async navigate(target, fg) {
    const site = this.resolveSite(target.toLowerCase());
    if (!site) {
      // "go to Chrome" — not a website, so treat it as switching to an app.
      return this.focus(target, {});
    }
    if (BROWSERS.includes(fg.process.toLowerCase())) await this.goInCurrentTab(site);
    else this.openUrl(site);
    return { opened: true, detail: site };
  }

  async playOnYouTube(query, fg, context) {
    let url = searchUrl('youtube', query);
    try {
      const res = await fetch(url, { headers: { 'Accept-Language': 'en-IN,en;q=0.9', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36' } });
      const html = await res.text();
      const m = html.match(/"videoRenderer":\{"videoId":"([\w-]{11})"/) || html.match(/"videoId":"([\w-]{11})"/);
      if (m) url = `https://www.youtube.com/watch?v=${m[1]}`;
    } catch (err) {
      this.log(`YouTube lookup failed, opening results instead: ${err.message}`);
    }
    if (BROWSERS.includes(fg.process.toLowerCase()) || context.site) await this.goInCurrentTab(url);
    else this.openUrl(url);
    return { opened: true, detail: url, context: { site: 'youtube' } };
  }

  // What can be clicked in the front window. Chrome only starts describing web pages
  // after the first request, so an almost-empty first answer gets one retry.
  async clickables(panes = false) {
    let list = await this.helper.call('clickables', { max: 300, panes }, 20000);
    if (list.length < 40) {
      await sleep(this.dryRun ? 0 : 700);
      const again = await this.helper.call('clickables', { max: 300, panes }, 20000);
      if (again.length > list.length) list = again;
    }
    return list;
  }

  async clickName(a) {
    let found = clicker.findByName(await this.clickables(true), a.target);
    if (!found.match && !found.choices) {
      await sleep(this.dryRun ? 0 : 800);
      found = clicker.findByName(await this.clickables(true), a.target);
    }
    if (found.choices) {
      // Several things share that name: number them and let the user pick.
      this.numbered = found.choices.map((el, i) => ({ ...el, n: i + 1 }));
      if (this.hooks.showNumbers) this.hooks.showNumbers(this.numbered);
      return { choose: true, detail: `${found.choices.length} things are called "${a.target}" — say the number`, speak: `Which one? Say a number.` };
    }
    if (!found.match) throw new Error(`I can't see "${a.target}" on the screen`);
    const { x, y } = clicker.centre(found.match);
    if (!this.dryRun) await this.helper.call('click-at', { x, y, button: a.button || 'left' });
    return { detail: found.match.name || a.target };
  }

  async numbers(op) {
    if (op === 'hide') {
      this.numbered = [];
      if (this.hooks.hideNumbers) this.hooks.hideNumbers();
      return {};
    }
    this.numbered = clicker.numberElements(await this.clickables(true));
    if (!this.numbered.length) throw new Error('I found nothing to click in this window');
    if (this.hooks.showNumbers) this.hooks.showNumbers(this.numbered);
    return { numbers: true, detail: `${this.numbered.length} things numbered — say "click" and a number` };
  }

  async clickNumber(a) {
    const el = this.numbered.find((e) => e.n === a.n);
    if (!el) throw new Error(this.numbered.length ? `There's no number ${a.n}` : 'Say "show numbers" first');
    this.numbered = [];
    if (this.hooks.hideNumbers) this.hooks.hideNumbers();
    const { x, y } = clicker.centre(el);
    if (!this.dryRun) {
      await sleep(80); // let the numbers disappear before clicking under them
      await this.helper.call('click-at', { x, y, button: a.button || 'left' });
      if (a.thenType) {
        await sleep(200);
        await this.typeText(a.thenType);
      }
    }
    return { detail: el.name || `number ${a.n}` };
  }

  async windowOp(op, fg) {
    if (!fg.hwnd || fg.hwnd === '0') throw new Error('No window is in front');
    if (this.dryRun) return { detail: fg.title };
    if (op === 'close') await this.helper.call('close', { hwnd: fg.hwnd });
    else await this.helper.call('show', { hwnd: fg.hwnd, cmd: { minimize: 6, maximize: 3, restore: 9 }[op] });
    return { detail: fg.title };
  }

  async findWindows(target) {
    const want = norm(APP_ALIASES[target] || target);
    const aliases = { chrome: 'chrome', googlechrome: 'chrome', edge: 'msedge', microsoftedge: 'msedge', fileexplorer: 'explorer', explorer: 'explorer', visualstudiocode: 'code', vscode: 'code' };
    const proc = aliases[want] || want;
    const list = (await this.helper.call('windows')) || [];
    return list.filter((w) => {
      if (/^jarvis$/i.test(w.title) || /textinputhost/i.test(w.process)) return false;
      return norm(w.process) === proc || norm(w.process).startsWith(proc) || (want.length >= 3 && norm(w.title).includes(want));
    });
  }

  async closeApp(target) {
    const wins = await this.findWindows(target);
    if (!wins.length) throw new Error(`${target} isn't open`);
    if (!this.dryRun) for (const w of wins) await this.helper.call('close', { hwnd: w.hwnd });
    return { detail: `${wins.length} window${wins.length > 1 ? 's' : ''}` };
  }

  async focus(target, context) {
    const wins = await this.findWindows(target);
    if (!wins.length) return this.open(target, context); // not running yet: open it
    if (!this.dryRun) await this.helper.call('focus', { hwnd: wins[0].hwnd });
    return { detail: wins[0].title };
  }

  async volume(a) {
    const now = await this.helper.call('volume-get');
    let target = now.volume;
    if (a.op === 'mute' || a.op === 'unmute') {
      if (!this.dryRun) await this.helper.call('mute-set', { muted: a.op === 'mute' });
      return { detail: a.op === 'mute' ? 'Muted' : `Unmuted (${now.volume}%)` };
    }
    if (a.op === 'set') target = a.value;
    if (a.op === 'up') target = now.volume + a.value;
    if (a.op === 'down') target = now.volume - a.value;
    target = Math.max(0, Math.min(100, target));
    if (!this.dryRun) {
      await this.helper.call('volume-set', { volume: target });
      if (now.muted && a.op !== 'down') await this.helper.call('mute-set', { muted: false });
    }
    return { detail: `Volume ${target}%` };
  }

  async brightness(a) {
    let current;
    try {
      current = await this.helper.call('brightness-get');
    } catch {
      throw new Error("This monitor doesn't let Windows change its brightness (use the monitor's buttons)");
    }
    let target = a.op === 'set' ? a.value : current + (a.op === 'up' ? a.value : -a.value);
    target = Math.max(0, Math.min(100, target));
    if (!this.dryRun) await this.helper.call('brightness-set', { level: target });
    return { detail: `Brightness ${target}%` };
  }

  currentWallpaper() {
    return new Promise((resolve) => {
      execFile('reg', ['query', 'HKCU\\Control Panel\\Desktop', '/v', 'WallPaper'], { windowsHide: true }, (err, out) => {
        const m = !err && out.match(/WallPaper\s+REG_SZ\s+(.+)/i);
        resolve(m ? m[1].trim() : '');
      });
    });
  }

  async nextWallpaper() {
    const current = await this.currentWallpaper();
    const folders = [this.settings.wallpaperFolder, current && path.dirname(current), path.join(os.homedir(), 'Pictures', 'Wallpapers'), path.join(os.homedir(), 'Pictures')].filter(Boolean);
    let images = [];
    let folder = null;
    for (const f of folders) {
      try {
        images = fs.readdirSync(f).filter((n) => IMAGE_EXT.test(n)).sort().map((n) => path.join(f, n));
      } catch { images = []; }
      if (images.length > 1 || (images.length === 1 && images[0] !== current)) { folder = f; break; }
    }
    if (!folder) throw new Error('No wallpaper pictures found (put some in Pictures > Wallpapers)');
    const index = images.findIndex((p) => p.toLowerCase() === current.toLowerCase());
    const next = images[(index + 1) % images.length];
    if (!this.dryRun) {
      const ok = await this.helper.call('wallpaper-set', { path: next });
      if (!ok) throw new Error('Windows refused to change the wallpaper');
    }
    return { detail: path.basename(next), wallpaper: next, previous: current };
  }

  async power(op) {
    if (this.dryRun) return { detail: `(test mode: would ${op})` };
    const run = (args) => execFile('shutdown', args, { windowsHide: true }, () => {});
    switch (op) {
      case 'lock': this.launch('rundll32.exe', ['user32.dll,LockWorkStation']); return {};
      case 'sleep':
        spawn('powershell.exe', ['-NoProfile', '-Command', 'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState("Suspend", $false, $false)'], { detached: true, windowsHide: true, stdio: 'ignore' }).unref();
        return {};
      case 'restart': run(['/r', '/t', '10']); return { detail: 'Restarting in 10 seconds — say "Jarvis cancel shutdown" to stop' };
      case 'shutdown': run(['/s', '/t', '10']); return { detail: 'Shutting down in 10 seconds — say "Jarvis cancel shutdown" to stop' };
      case 'signout': run(['/l']); return {};
      case 'cancel': run(['/a']); return { detail: 'Shutdown cancelled' };
      default: throw new Error(`Unknown power action ${op}`);
    }
  }
}

module.exports = { Executor, searchUrl, VK };

// CPU use over a short moment, in percent.
function cpuPercent() {
  const os = require('os');
  const snap = () => os.cpus().reduce((t, c) => {
    const all = Object.values(c.times).reduce((x, y) => x + y, 0);
    return { idle: t.idle + c.times.idle, all: t.all + all };
  }, { idle: 0, all: 0 });
  const a = snap();
  return new Promise((resolve) => setTimeout(() => {
    const b = snap();
    resolve(Math.round(100 * (1 - (b.idle - a.idle) / Math.max(1, b.all - a.all))));
  }, 400));
}
