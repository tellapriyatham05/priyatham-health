// JARVIS on your screen: Iron Man flies in when you call him, hovers in his corner with his
// boot jets firing, shows a hologram for each job, does a lap of the screen now and then,
// and flies away when you say "quit" or "hide".
//
// Usage: const suit = new IronMan(stage); suit.show('listen'); suit.show('work', 'search');
(function () {
  const SIZES = { small: 120, medium: 160, large: 210 }; // character height in pixels
  const MODES = ['listen', 'hearing', 'think', 'work', 'confirm', 'happy', 'confused', 'dictate', 'paused', 'talk', 'framed'];
  const ACTS = ['search', 'launch', 'type', 'music', 'signal', 'bell', 'scan'];

  const ease = {
    out: (t) => 1 - Math.pow(1 - t, 3),
    in: (t) => t * t * t,
    inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  };

  function bezier(p, t) {
    const u = 1 - t;
    return [0, 1].map((k) => u * u * u * p[0][k] + 3 * u * u * t * p[1][k] + 3 * u * t * t * p[2][k] + t * t * t * p[3][k]);
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Holograms JARVIS projects next to himself (cyan HUD style). Shown by CSS for the matching mode.
  const HOLO = `
    <div class="holo h-waves"><i></i><i></i><i></i></div>
    <div class="holo h-rings"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" class="dash"/><circle cx="50" cy="50" r="36" class="dash rev"/><circle cx="50" cy="50" r="26"/></svg></div>
    <div class="holo h-search"><svg viewBox="0 0 60 60"><circle cx="24" cy="24" r="15"/><path d="M35 35 L52 52"/><path d="M14 24 h20 M24 14 v20" class="thin"/></svg></div>
    <div class="holo h-launch"><svg viewBox="0 0 80 56"><rect x="3" y="3" width="74" height="50" rx="5"/><path d="M3 15 H77" class="thin"/><circle cx="10" cy="9" r="2"/><circle cx="17" cy="9" r="2"/><path d="M14 28 h40 M14 36 h52 M14 44 h30" class="thin"/></svg></div>
    <div class="holo h-type"><svg viewBox="0 0 120 40"><rect x="2" y="2" width="116" height="36" rx="5"/><path d="M10 12 h100 M10 21 h100 M28 30 h64" class="keys"/></svg></div>
    <div class="holo h-music"><span>♪</span><span>♫</span><span>♪</span></div>
    <div class="holo h-signal"><svg viewBox="0 0 60 60"><circle cx="30" cy="44" r="3"/><path d="M20 34 a14 14 0 0 1 20 0"/><path d="M13 27 a24 24 0 0 1 34 0"/><path d="M6 20 a34 34 0 0 1 48 0"/></svg></div>
    <div class="holo h-bell"><svg viewBox="0 0 60 60"><path d="M30 8 c-10 0 -16 8 -16 18 v10 l-5 7 h42 l-5 -7 v-10 c0 -10 -6 -18 -16 -18 z"/><path d="M25 48 a5 5 0 0 0 10 0"/></svg></div>
    <div class="holo h-scan"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="44" class="dash"/><path d="M50 50 L50 6" class="sweep"/><circle cx="50" cy="50" r="20" class="thin"/></svg></div>
    <div class="holo h-confirm"><div>Sure?</div></div>
    <div class="holo h-happy"><svg viewBox="0 0 60 60"><circle cx="30" cy="30" r="24"/><path d="M19 31 l8 8 l15 -17"/></svg></div>
    <div class="holo h-confused"><div>?</div></div>`;

  class IronMan {
    constructor(stage, { onMove = () => {} } = {}) {
      this.stage = stage;
      this.onMove = onMove;
      this.root = document.createElement('div');
      this.root.id = 'suit';
      this.root.innerHTML = `<div class="bob"><div class="body"><div class="art"></div>
        <div class="flame f0"></div><div class="flame f1"></div><div class="palm p0"></div><div class="palm p1"></div></div></div>${HOLO}`;
      stage.appendChild(this.root);
      this.body = this.root.querySelector('.body');
      this.art = this.root.querySelector('.art');
      this.flames = [...this.root.querySelectorAll('.flame')];
      this.ghosts = [0, 1, 2, 3].map(() => {
        const g = document.createElement('div');
        g.className = 'ghost';
        stage.insertBefore(g, this.root);
        return g;
      });
      this.trail = [];
      this.h = SIZES.medium;
      this.w = this.h * 0.5;
      this.x = -1000;
      this.y = -1000;
      this.home = null;
      this.customHome = null;
      this.phase = 'away';      // away | flying | home | landed
      this.mode = 'idle';
      this.gen = 0;
      this.face = 1;
      this.thrust = 0;
      this.idleTimer = null;
      this.settleTimer = null;
      this.useCharacter(null);
    }

    // ---------------------------------------------------------------- looks
    async useCharacter(pic) {
      // pic: { src, framed } for your picture, or null for the built-in suit.
      let ratio;
      if (pic && pic.src) {
        const img = new Image();
        img.src = pic.src;
        await img.decode().catch(() => {});
        ratio = img.naturalWidth / Math.max(1, img.naturalHeight) || 0.5;
        this.art.innerHTML = '';
        img.draggable = false;
        this.art.appendChild(img);
        this.feet = pic.framed ? [{ x: 0.4, y: 1.0 }, { x: 0.6, y: 1.0 }] : await window.JarvisCutout.feetOf(pic.src).catch(() => null);
        this.root.classList.toggle('framed', !!pic.framed);
        this.ghostSrc = pic.src;
      } else {
        this.art.innerHTML = window.IRONMAN_SVG;
        ratio = 0.5;
        this.feet = window.IRONMAN_FEET;
        this.root.classList.remove('framed');
        this.ghostSrc = null;
      }
      this.ratio = Math.min(1.1, Math.max(0.3, ratio));
      this.ghosts.forEach((g) => { g.innerHTML = this.ghostSrc ? `<img src="${this.ghostSrc}">` : window.IRONMAN_SVG; });
      (this.feet || window.IRONMAN_FEET).forEach((f, i) => {
        if (!this.flames[i]) return;
        this.flames[i].style.left = `${f.x * 100}%`;
        this.flames[i].style.top = `${f.y * 100}%`;
      });
      this.resize();
    }

    setSize(name) {
      this.h = SIZES[name] || SIZES.medium;
      this.resize();
    }

    resize() {
      this.w = Math.round(this.h * this.ratio);
      for (const el of [this.root, ...this.ghosts]) {
        el.style.width = `${this.w}px`;
        el.style.height = `${this.h}px`;
      }
      this.root.style.setProperty('--h', `${this.h}px`);
      this.home = this.homeSpot();
      if (this.phase === 'home' || this.phase === 'landed') this.place(this.home.x, this.home.y);
    }

    // Bottom-right corner, a little above the taskbar (room for the flames), or where you dragged him.
    homeSpot() {
      const W = window.innerWidth, H = window.innerHeight;
      if (this.customHome) {
        return { x: Math.min(W - this.w, Math.max(0, this.customHome.x)), y: Math.min(H - this.h * 1.25, Math.max(0, this.customHome.y)) };
      }
      return { x: W - this.w - 80, y: H - this.h * 1.3 };
    }

    setHome(pos) {
      this.customHome = pos;
      this.home = this.homeSpot();
      if (this.phase === 'home' || this.phase === 'landed') this.place(this.home.x, this.home.y);
    }

    // ---------------------------------------------------------------- drawing one frame
    place(x, y, { tilt = 0, scale = 1, thrust = null } = {}) {
      this.x = x;
      this.y = y;
      this.root.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      this.body.style.transform = `rotate(${tilt.toFixed(1)}deg) scale(${(scale * this.face).toFixed(3)}, ${scale.toFixed(3)})`;
      if (thrust != null) this.setThrust(thrust);
      this.onMove(this);
    }

    setThrust(v) {
      this.thrust = v;
      this.root.style.setProperty('--thrust', v.toFixed(2));
    }

    // Fly along a curve. Resolves false if something newer took over.
    fly(points, ms, { easing = ease.inOut, scale = () => 1, thrust = 1, maxTilt = 55, upright = 0.8 } = {}) {
      const gen = this.gen;
      this.phase = 'flying';
      this.root.classList.add('flying');
      this.trail = [];
      return new Promise((resolve) => {
        const start = performance.now();
        const step = (now) => {
          if (gen !== this.gen) { this.endFlight(); return resolve(false); }
          const t = Math.min(1, (now - start) / ms);
          const e = easing(t);
          const [x, y] = bezier(points, e);
          const [nx, ny] = bezier(points, Math.min(1, e + 0.02));
          const dx = nx - x, dy = ny - y;
          if (Math.abs(dx) > 0.6) this.face = dx < 0 ? -1 : 1;
          const heading = Math.hypot(dx, dy) > 0.5 ? (Math.atan2(dx, -dy) * 180) / Math.PI : 0;
          const straighten = t > upright ? (t - upright) / (1 - upright) : 0;
          const tilt = Math.max(-maxTilt, Math.min(maxTilt, heading)) * (1 - straighten);
          this.place(x, y, { tilt, scale: scale(t), thrust: typeof thrust === 'function' ? thrust(t) : thrust });
          this.drawTrail(x, y, tilt, scale(t));
          if (t < 1) requestAnimationFrame(step);
          else { this.endFlight(); resolve(true); }
        };
        requestAnimationFrame(step);
      });
    }

    endFlight() {
      this.root.classList.remove('flying');
      this.ghosts.forEach((g) => { g.style.opacity = 0; });
    }

    // Faded copies where he was a moment ago: a motion trail.
    drawTrail(x, y, tilt, scale) {
      this.trail.unshift([x, y, tilt, scale]);
      this.trail.length = Math.min(this.trail.length, 13);
      this.ghosts.forEach((g, i) => {
        const p = this.trail[(i + 1) * 3];
        if (!p) { g.style.opacity = 0; return; }
        g.style.opacity = (0.28 * (1 - i / this.ghosts.length)).toFixed(2);
        g.style.transform = `translate(${p[0]}px, ${p[1]}px) rotate(${p[2]}deg) scale(${p[3] * this.face}, ${p[3]})`;
      });
    }

    // ---------------------------------------------------------------- big moves
    async arrive() {
      if (this.arriving) return;
      this.arriving = true;
      this.leaving = false;
      try { await this._arrive(); } finally { this.arriving = false; }
    }

    async _arrive() {
      const gen = ++this.gen;
      this.stopIdle();
      const W = window.innerWidth, H = window.innerHeight;
      const home = this.home = this.homeSpot();
      const fromLeft = home.x > W / 2;
      this.root.classList.add('present');
      // Swoop in from the far top corner, dive across the middle of the screen, curl into his corner.
      const ok = await this.fly([
        [fromLeft ? -this.w * 2 : W + this.w, -this.h * 1.5],
        [W * 0.5 + (fromLeft ? -0.1 : 0.1) * W, H * 0.55],
        [home.x + (fromLeft ? -0.25 : 0.25) * W, home.y - H * 0.25],
        [home.x, home.y],
      ], 1900, { easing: ease.out, scale: (t) => 1 + 0.9 * Math.pow(1 - t, 1.6), thrust: (t) => 1 - 0.5 * Math.max(0, (t - 0.75) / 0.25) });
      if (!ok || gen !== this.gen) return;
      this.faceInward();
      this.phase = 'home';
      this.place(home.x, home.y, { thrust: 0.5 });
      this.scheduleIdle();
    }

    async leave() {
      const gen = ++this.gen;
      this.stopIdle();
      if (this.phase === 'away') return;
      this.leaving = true;
      const W = window.innerWidth;
      const right = this.x > W / 2;
      const sx = this.x, sy = this.y;
      this.root.classList.remove('landed');
      // Crouch, then blast off upward and out of the screen.
      this.place(sx, sy + 6, { thrust: 1 });
      await sleep(180);
      if (gen !== this.gen) return;
      const ok = await this.fly([[sx, sy], [sx, sy - window.innerHeight * 0.3], [sx + (right ? -1 : 1) * W * 0.15, -this.h * 0.5],
        [sx + (right ? -1 : 1) * W * 0.35, -this.h * 2.5]], 1300, { easing: ease.in, scale: (t) => 1 + 0.3 * t, upright: 1 });
      this.leaving = false;
      if (!ok || gen !== this.gen) return;
      this.phase = 'away';
      this.root.classList.remove('present');
      this.place(-2000, -2000, { thrust: 0 });
    }

    // Called while he is already here: a quick boost up and a loop back down.
    async hop() {
      const gen = ++this.gen;
      this.stopIdle();
      const home = this.home = this.homeSpot();
      const W = window.innerWidth, H = window.innerHeight;
      const side = home.x > W / 2 ? -1 : 1;
      const ok = await this.fly([[home.x, home.y], [home.x + side * W * 0.12, home.y - H * 0.32],
        [home.x - side * W * 0.04, home.y - H * 0.38], [home.x, home.y]], 1150,
      { scale: (t) => 1 + 0.15 * Math.sin(Math.PI * t), maxTilt: 40, upright: 0.75 });
      if (!ok || gen !== this.gen) return;
      this.faceInward();
      this.phase = 'home';
      this.place(home.x, home.y, { thrust: 0.6 });
    }

    // Opening something: fly out toward the middle of the screen, throw a hologram window, come back.
    async launch() {
      const gen = ++this.gen;
      const home = this.home;
      const W = window.innerWidth, H = window.innerHeight;
      const side = home.x > W / 2 ? -1 : 1;
      const tx = home.x + side * Math.min(W * 0.28, 420), ty = home.y - H * 0.22;
      if (!(await this.fly([[home.x, home.y], [home.x + side * 60, home.y - H * 0.3], [tx - side * 80, ty - 40], [tx, ty]], 750, { maxTilt: 45 }))) return;
      if (gen !== this.gen) return;
      this.place(tx, ty, { thrust: 0.7 });
      this.root.classList.add('throw');
      await sleep(900);
      this.root.classList.remove('throw');
      if (gen !== this.gen) return;
      await this.fly([[tx, ty], [tx, ty + 40], [home.x + side * 40, home.y - 30], [home.x, home.y]], 850, { maxTilt: 35 });
      if (gen !== this.gen) return;
      this.faceInward();
      this.phase = 'home';
      this.place(home.x, home.y, { thrust: 0.6 });
    }

    faceInward() {
      this.face = this.home && this.home.x > window.innerWidth / 2 ? -1 : 1;
      if (this.ghostSrc === null && this.face === -1) this.face = 1; // the drawn suit faces you; no need to mirror
    }

    // ---------------------------------------------------------------- moods
    // mode: idle | listen | hearing | think | work | confirm | happy | confused | dictate | paused | home
    async show(mode, activity) {
      clearTimeout(this.settleTimer);
      if (mode !== 'idle' && mode !== 'home') this.stopIdle();
      for (const c of [...MODES, ...ACTS.map((a) => `act-${a}`), 'landed']) if (c !== 'framed' && c !== 'talk') this.root.classList.remove(c);
      this.mode = mode;
      if (mode === 'home' || mode === 'idle') { this.settled(); return; }
      if (mode === 'paused') {
        this.root.classList.add('paused', 'landed');
        if (this.phase === 'home') this.place(this.home.x, this.home.y + this.h * 0.18, { thrust: 0 });
        return;
      }
      if (this.phase === 'away' || this.leaving) this.arrive();
      else if (mode === 'listen' && this.phase !== 'flying') this.hop();
      if (mode === 'hearing') this.root.classList.add('listen', 'hearing');
      else if (mode === 'work') {
        this.root.classList.add('work', `act-${activity || 'scan'}`);
        if (activity === 'launch' && this.phase === 'home') this.launch();
      } else this.root.classList.add(mode);
      if (this.phase === 'home') this.setThrust(mode === 'think' || mode === 'work' ? 0.75 : 0.6);
    }

    // After a result: hover calmly at home.
    settle(afterMs = 0) {
      clearTimeout(this.settleTimer);
      this.settleTimer = setTimeout(() => this.show('idle'), afterMs);
    }

    settled() {
      this.root.classList.remove('landed', 'paused');
      if (this.phase === 'home') {
        this.place(this.home.x, this.home.y, { thrust: 0.45 });
        this.scheduleIdle();
      }
    }

    setTalking(level) {
      this.root.classList.toggle('talk', level > 0.02);
      this.root.style.setProperty('--voice', Math.min(1, level * 6).toFixed(2));
    }

    // ---------------------------------------------------------------- his own little life
    // Every few minutes of quiet: a lap of the screen, a scan, or landing for a rest.
    scheduleIdle() {
      clearTimeout(this.idleTimer);
      this.idleTimer = setTimeout(() => this.idleLife(), (90 + Math.random() * 150) * 1000);
    }

    stopIdle() {
      clearTimeout(this.idleTimer);
    }

    async idleLife() {
      if (this.mode !== 'idle' || this.phase !== 'home' || this.dragging) return this.scheduleIdle();
      const gen = ++this.gen;
      const pick = Math.random();
      const home = this.home, W = window.innerWidth, H = window.innerHeight;
      if (pick < 0.45) {
        // Patrol: fly low along the screen, scan, come back.
        const side = home.x > W / 2 ? -1 : 1;
        const tx = home.x + side * W * (0.35 + Math.random() * 0.25), ty = home.y - H * (0.05 + Math.random() * 0.15);
        if (!(await this.fly([[home.x, home.y], [home.x + side * W * 0.1, home.y - H * 0.25], [tx - side * W * 0.1, ty - H * 0.1], [tx, ty]], 1600, { maxTilt: 50 }))) return;
        this.place(tx, ty, { thrust: 0.6 });
        this.root.classList.add('act-scan', 'work');
        await sleep(2600);
        this.root.classList.remove('act-scan', 'work');
        if (gen !== this.gen) return;
        if (!(await this.fly([[tx, ty], [tx, ty - H * 0.15], [home.x - side * W * 0.1, home.y - H * 0.2], [home.x, home.y]], 1600, { maxTilt: 50 }))) return;
      } else if (pick < 0.75) {
        // Land on the taskbar edge, rest with the jets off, take off again.
        this.root.classList.add('landed');
        this.place(home.x, home.y + this.h * 0.18, { thrust: 0 });
        await sleep(12000 + Math.random() * 10000);
        if (gen !== this.gen) return;
        this.root.classList.remove('landed');
        this.place(home.x, home.y, { thrust: 1 });
        await sleep(400);
      } else {
        // A quick loop in place.
        if (!(await this.fly([[home.x, home.y], [home.x - 120, home.y - H * 0.35], [home.x + 120, home.y - H * 0.35], [home.x, home.y]], 1700, { maxTilt: 70, upright: 0.85 }))) return;
      }
      if (gen !== this.gen) return;
      this.faceInward();
      this.phase = 'home';
      this.place(home.x, home.y, { thrust: 0.45 });
      this.scheduleIdle();
    }
  }

  window.IronMan = IronMan;
})();
