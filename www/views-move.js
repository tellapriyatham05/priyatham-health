/* Move: workouts, routine editor, workout timer, GPS ride. */
(function () {
  const { H, S, B, T } = PH;
  const { I, ring, toast, sheet, closeSheet, header, routes, actions, changes, go, refresh } = UI;
  const st = () => S.state;

  // ------------------------------------------------ move home
  routes.move = () => {
    const s = st(), w = T.weekActive();
    const recent = [...s.rides.map((r) => ({ t: r.start, kind: "ride", title: H.round(r.km, 2) + " km ride", sub: H.clock(r.sec) + " · " + Math.round(r.kcal) + " kcal", id: r.id })),
      ...s.workouts.map((x) => ({ t: x.t, kind: "workout", title: x.name, sub: Math.round(x.min) + " min · " + Math.round(x.kcal) + " kcal" }))]
      .sort((a, b) => b.t - a.t).slice(0, 6);
    return {
      nav: "move",
      html: '<div class="page"><div class="rise"><div class="eyebrow m">This week</div><h1 style="margin-top:4px">Move</h1></div>' +
        '<div class="rise grid3">' + stat(w.min, "of 150 active min", true) + stat(H.round(w.km, 1), "km cycled") + stat(w.kcal.toLocaleString("en-IN"), "kcal burned") + "</div>" +
        '<div class="rise bar"><i style="width:' + Math.min(100, w.min / 1.5) + '%"></i></div>' +
        '<a class="rise card solidgold row" href="#/ride" style="gap:14px;padding:18px">' + I("bike", 44, 1.8) + '<div class="grow"><div class="display b" style="font-size:20px">' + (PH.rideLive ? "Ride in progress" : "Start a ride") + '</div><div class="small b" style="opacity:.8">GPS tracks km, speed &amp; calories</div></div>' + I("next", 22, 2.4) + "</a>" +
        '<div class="rise row between"><h2>My routines</h2><button class="chip add" data-a="editRoutine" data-x="">+ New</button></div>' +
        '<div class="rise col">' + s.routines.map((r) => {
          const secs = r.rounds * H.sum(r.items, (i) => i.work + i.rest);
          return '<div class="card tight row"><div class="grow" data-a="editRoutine" data-x="' + r.id + '"><div class="b" style="font-size:16px">' + H.esc(r.name) + '</div><div class="small muted">' + Math.round(secs / 60) + " min · " + r.items.length + " exercises" + (r.rounds > 1 ? " × " + r.rounds : "") + "</div></div>" +
            '<a class="iconbtn gold" href="#/timer/' + r.id + '" aria-label="Start ' + H.esc(r.name) + '">' + I("play", 18) + "</a></div>";
        }).join("") + "</div>" +
        (recent.length ? '<h2 class="rise">Recent</h2><div class="rise card tight list">' + recent.map((x) => '<div class="row"><span class="gold">' + I(x.kind === "ride" ? "bike" : "move", 20) + '</span><div class="grow"><div class="b small">' + H.esc(x.title) + '</div><div class="tiny muted">' + new Date(x.t).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }) + " · " + x.sub + "</div></div></div>").join("") + "</div>" : "") +
        '<div class="rise small b muted">My exercises</div><div class="rise row wrap" style="gap:6px">' + s.exercises.map((e) => '<span class="chip" style="height:34px">' + H.esc(e) + "</span>").join("") + '<button class="chip add" style="height:34px" data-a="addExercise">+ Add</button></div></div>',
    };
    function stat(v, l, gold) { return '<div class="card tight stat"><div class="v' + (gold ? " gold" : "") + '">' + v + '</div><div class="l">' + l + "</div></div>"; }
  };
  actions.addExercise = () => sheet('<h2>New exercise</h2><input id="newEx" placeholder="e.g. Skipping, Yoga flow"><button class="btn block" data-a="saveExercise">Add</button>', (el) => el.querySelector("input").focus());
  actions.saveExercise = () => { const v = document.getElementById("newEx").value.trim(); if (v && !st().exercises.includes(v)) { st().exercises.push(v); S.save(); } closeSheet(); refresh(); };

  // ------------------------------------------------ routine editor
  let draft = null;
  actions.editRoutine = (id) => {
    const r = st().routines.find((x) => x.id === id);
    draft = r ? JSON.parse(JSON.stringify(r)) : { id: "r_" + H.uid(), name: "", rounds: 1, items: [{ ex: "Squats", work: 40, rest: 15 }], isNew: true };
    renderRoutine();
  };
  function renderRoutine() {
    const ex = st().exercises;
    sheet('<h2>' + (draft.isNew ? "New routine" : "Edit routine") + "</h2>" +
      '<label class="field">Name<input data-c="rName" value="' + H.esc(draft.name) + '" placeholder="Morning burner"></label>' +
      '<label class="field">Rounds<select data-c="rRounds">' + [1, 2, 3, 4].map((n) => "<option " + (draft.rounds === n ? "selected" : "") + ">" + n + "</option>").join("") + "</select></label>" +
      '<div class="col">' + draft.items.map((it, i) => '<div class="card tight col" style="gap:8px"><div class="row"><select data-c="rEx" data-x="' + i + '" class="grow">' + ex.map((e) => "<option " + (e === it.ex ? "selected" : "") + ">" + H.esc(e) + "</option>").join("") + "</select>" +
        '<button class="iconbtn" data-a="rDel" data-x="' + i + '" aria-label="Remove">' + I("trash", 18) + "</button></div>" +
        '<div class="grid2"><label class="field">Work (sec)<input type="number" inputmode="numeric" data-c="rWork" data-x="' + i + '" value="' + it.work + '"></label><label class="field">Rest (sec)<input type="number" inputmode="numeric" data-c="rRest" data-x="' + i + '" value="' + it.rest + '"></label></div></div>').join("") + "</div>" +
      '<button class="btn ghost block" data-a="rAdd">+ Add exercise</button>' +
      '<button class="btn block" data-a="rSave">Save routine</button>' + (draft.isNew ? "" : '<button class="btn danger block" data-a="rRemove">Delete routine</button>'));
  }
  changes.rName = (v) => { draft.name = v; };
  changes.rRounds = (v) => { draft.rounds = +v; };
  changes.rEx = (v, el) => { draft.items[+el.dataset.x].ex = v; };
  changes.rWork = (v, el) => { draft.items[+el.dataset.x].work = Math.max(5, +v || 30); };
  changes.rRest = (v, el) => { draft.items[+el.dataset.x].rest = Math.max(0, +v || 0); };
  actions.rAdd = () => { draft.items.push({ ex: st().exercises[0], work: 40, rest: 15 }); renderRoutine(); };
  actions.rDel = (i) => { draft.items.splice(+i, 1); renderRoutine(); };
  actions.rSave = () => {
    if (!draft.name.trim()) return toast("Give it a name");
    if (!draft.items.length) return toast("Add at least one exercise");
    const isNew = draft.isNew; delete draft.isNew;
    const list = st().routines; const i = list.findIndex((x) => x.id === draft.id);
    if (i >= 0) list[i] = draft; else list.push(draft);
    S.save(); closeSheet(); refresh(); toast(isNew ? "Routine added" : "Saved");
  };
  actions.rRemove = () => { st().routines = st().routines.filter((x) => x.id !== draft.id); S.save(); closeSheet(); refresh(); };

  // ------------------------------------------------ workout timer
  let TM = null;
  function phasesFor(r) {
    const out = [{ type: "ready", ex: r.items[0].ex, sec: 5 }];
    for (let k = 0; k < r.rounds; k++) r.items.forEach((it, i) => {
      out.push({ type: "work", ex: it.ex, sec: it.work, idx: i, round: k });
      const last = k === r.rounds - 1 && i === r.items.length - 1;
      if (it.rest > 0 && !last) out.push({ type: "rest", ex: "Rest", sec: it.rest, idx: i, round: k });
    });
    return out;
  }
  let actx = null;
  function beep(freq, len) {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const o = actx.createOscillator(), g = actx.createGain();
      o.frequency.value = freq; o.connect(g); g.connect(actx.destination);
      g.gain.setValueAtTime(0.25, actx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + len);
      o.start(); o.stop(actx.currentTime + len);
    } catch (e) {}
  }
  routes.timer = (id) => {
    const r = st().routines.find((x) => x.id === id) || st().routines[0];
    if (!TM || TM.routine.id !== r.id) TM = { routine: r, phases: phasesFor(r), i: 0, endsAt: 0, left: 5, paused: true, active: 0, started: false, done: false, lastWhole: null };
    const workCount = TM.phases.filter((p) => p.type === "work").length;
    const segs = TM.phases.filter((p) => p.type === "work").map((p, k) => '<div class="grow" style="height:5px;border-radius:3px;background:#2A2A2E" id="seg' + k + '"></div>').join("");
    return {
      html: '<div class="page nonav" style="min-height:100vh">' + header(H.esc(r.name), "move", '<span class="small b muted" id="tCount"></span>') +
        '<div class="row" style="gap:5px">' + segs + "</div>" +
        '<div style="position:relative;width:300px;height:300px;align-self:center;margin-top:6px"><svg width="300" height="300" viewBox="0 0 300 300"><circle cx="150" cy="150" r="130" fill="none" stroke="#1C1C1F" stroke-width="16"/>' +
        '<circle id="tRing" cx="150" cy="150" r="130" fill="none" stroke="#C9A45C" stroke-width="16" stroke-linecap="round" stroke-dasharray="816.8" stroke-dashoffset="0" transform="rotate(-90 150 150)" style="transition:stroke-dashoffset .25s linear"/></svg>' +
        '<div class="ringwrap" style="position:absolute;inset:0"><div class="in" style="gap:4px"><div class="eyebrow" id="tKind">Get ready</div><div class="display" id="tClock" style="font-size:76px;font-weight:600;line-height:1">0:05</div><div class="b" id="tName" style="font-size:22px"></div></div></div></div>' +
        '<div class="card tight row between"><div><div class="tiny b muted" style="letter-spacing:.1em">UP NEXT</div><div class="b" id="tNext"></div></div><div style="text-align:right"><div class="tiny muted">burned</div><div class="b gold2" id="tKcal">0 kcal</div></div></div>' +
        '<div class="row small muted" style="justify-content:center">' + I("sound", 16) + " Voice coach on · beeps at 3, 2, 1 · " + workCount + " sets</div>" +
        '<div class="row" style="justify-content:center;gap:22px;margin-top:auto;padding-top:10px">' +
        '<button class="iconbtn" style="width:58px;height:58px;border-radius:29px" data-a="tPrev" aria-label="Previous">' + I("prev", 22) + "</button>" +
        '<button id="tMain" style="width:86px;height:86px;border-radius:43px;border:0;background:#C9A45C;color:#0A0A0B;display:flex;align-items:center;justify-content:center;animation:glow 2.4s ease-in-out infinite" data-a="tToggle" aria-label="Start or pause">' + I("play", 30) + "</button>" +
        '<button class="iconbtn" style="width:58px;height:58px;border-radius:29px" data-a="tSkip" aria-label="Skip">' + I("skip", 22) + "</button></div>" +
        '<button class="btn ghost block" data-a="tFinish">End workout</button></div>',
      mount() {
        paint();
        const iv = setInterval(tick, 200);
        let lock = null;
        if (navigator.wakeLock) navigator.wakeLock.request("screen").then((l) => { lock = l; }).catch(() => {});
        return () => { clearInterval(iv); if (lock) lock.release().catch(() => {}); };
      },
    };
  };
  function cur() { return TM.phases[TM.i]; }
  function announce() {
    const p = cur(); if (!p) return;
    const next = TM.phases[TM.i + 1];
    if (p.type === "work") N.speak(p.ex + ". " + p.sec + " seconds. Go!");
    else if (p.type === "rest") N.speak("Rest. Next, " + (next ? next.ex : "done"));
    else N.speak("Get ready. First, " + p.ex);
  }
  function tick() {
    if (!TM || TM.paused || TM.done) return;
    const now = Date.now();
    TM.left = (TM.endsAt - now) / 1000;
    if (cur().type === "work") TM.active += 0.2;
    const whole = Math.ceil(TM.left);
    if (whole !== TM.lastWhole && whole <= 3 && whole >= 1) { beep(880, 0.12); N.vibrate(60); }
    TM.lastWhole = whole;
    if (TM.left <= 0) {
      beep(1320, 0.3);
      if (TM.i >= TM.phases.length - 1) return finish();
      TM.i++; TM.left = cur().sec; TM.endsAt = now + TM.left * 1000; announce();
    }
    paint();
  }
  function paint() {
    const p = cur(); if (!p) return;
    const $ = (id) => document.getElementById(id);
    if (!$("tClock")) return;
    const left = Math.max(0, TM.paused && !TM.started ? p.sec : TM.left);
    $("tClock").textContent = H.clock(Math.ceil(left));
    $("tKind").textContent = p.type === "work" ? "Work" : p.type === "rest" ? "Rest" : "Get ready";
    $("tKind").style.color = p.type === "rest" ? "#A3A09A" : "#C9A45C";
    $("tName").textContent = p.type === "rest" ? "Breathe" : p.ex;
    $("tRing").style.strokeDashoffset = (816.8 * (1 - left / p.sec)).toFixed(1);
    $("tRing").style.stroke = p.type === "rest" ? "#5A5A60" : "#C9A45C";
    const rest = TM.phases.slice(TM.i + 1, TM.i + 3).map((x) => (x.type === "rest" ? "Rest " + x.sec + "s" : x.ex + " " + x.sec + "s")).join(" → ");
    $("tNext").textContent = rest || "Last one. Finish strong!";
    const works = TM.phases.filter((x) => x.type === "work"); const doneWorks = TM.phases.slice(0, TM.i).filter((x) => x.type === "work").length;
    works.forEach((_, k) => { const el = $("seg" + k); if (el) el.style.background = k < doneWorks ? "#C9A45C" : k === doneWorks && p.type === "work" ? "#E6CD94" : "#2A2A2E"; });
    $("tCount").textContent = Math.min(works.length, doneWorks + (p.type === "work" ? 1 : 0)) + " of " + works.length;
    $("tKcal").textContent = Math.round(kcalNow()) + " kcal";
    $("tMain").innerHTML = I(TM.paused ? "play" : "pause", 30);
  }
  function kcalNow() { return 5.5 * (B.weight() || 75) * (TM.active / 3600); }
  actions.tToggle = () => {
    if (!TM) return;
    if (TM.paused) {
      if (!TM.started) { TM.started = true; TM.left = cur().sec; announce(); }
      TM.paused = false; TM.endsAt = Date.now() + TM.left * 1000;
    } else { TM.paused = true; TM.left = (TM.endsAt - Date.now()) / 1000; }
    paint();
  };
  actions.tSkip = () => { if (!TM) return; if (TM.i >= TM.phases.length - 1) return finish(); TM.i++; TM.left = cur().sec; TM.endsAt = Date.now() + TM.left * 1000; if (!TM.paused) announce(); paint(); };
  actions.tPrev = () => { if (!TM) return; TM.i = Math.max(0, TM.i - 1); TM.left = cur().sec; TM.endsAt = Date.now() + TM.left * 1000; if (!TM.paused) announce(); paint(); };
  actions.tFinish = () => finish(true);
  function finish(early) {
    if (!TM || TM.done) return;
    TM.done = true;
    const min = TM.active / 60;
    if (min >= 1) {
      st().workouts.push({ d: H.dkey(), t: Date.now(), name: TM.routine.name, min: H.round(min, 1), kcal: Math.round(kcalNow()) });
      S.save(); N.markEvent("stand");
      N.speak(early ? "Workout saved." : "Workout complete. Great job, " + (st().profile.name || "Priyatham") + "!");
      toast(Math.round(min) + " min · " + Math.round(kcalNow()) + " kcal saved");
    }
    TM = null; go("move");
  }

  // ------------------------------------------------ GPS ride
  let ride = null;
  function routeSvg(pts, w, h) {
    if (!pts || pts.length < 2) return "";
    const lat0 = pts[0][0] * Math.PI / 180, k = Math.cos(lat0);
    const xs = pts.map((p) => p[1] * k), ys = pts.map((p) => -p[0]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const sc = Math.min((w - 60) / Math.max(maxX - minX, 1e-6), (h - 80) / Math.max(maxY - minY, 1e-6));
    const ox = (w - (maxX - minX) * sc) / 2, oy = (h - (maxY - minY) * sc) / 2 + 20;
    const P = xs.map((x, i) => [(x - minX) * sc + ox, (ys[i] - minY) * sc + oy]);
    const d = "M" + P.map((p) => p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" L");
    const e = P[P.length - 1], s = P[0];
    return '<path d="' + d + '" fill="none" stroke="#C9A45C" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<circle cx="' + s[0] + '" cy="' + s[1] + '" r="7" fill="#0A0A0B" stroke="#C9A45C" stroke-width="3"/>' +
      '<circle cx="' + e[0] + '" cy="' + e[1] + '" r="20" fill="#4C82FF" opacity=".25" style="transform-origin:' + e[0] + "px " + e[1] + 'px;animation:pulse 1.8s ease-out infinite"/>' +
      '<circle cx="' + e[0] + '" cy="' + e[1] + '" r="8" fill="#4C82FF" stroke="#fff" stroke-width="3"/>';
  }
  const grid = '<g stroke="#1B1B1F" stroke-width="10" fill="none" stroke-linecap="round"><path d="M-10 90 L420 60"/><path d="M-10 250 L420 290"/><path d="M80 -10 L120 460"/><path d="M270 -10 L240 460"/><path d="M-10 380 L420 350"/></g><g stroke="#161619" stroke-width="4" fill="none"><path d="M-10 170 L420 160"/><path d="M175 -10 L185 460"/><path d="M20 -10 L40 460"/><path d="M340 -10 L370 460"/></g>';

  routes.ride = () => {
    const s = st();
    return {
      html: '<div id="rideRoot" style="min-height:100vh;display:flex;flex-direction:column"></div>',
      mount(root) {
        let alive = true;
        const draw = (r) => {
          ride = r;
          PH.rideLive = !!(r && r.running);
          const el = document.getElementById("rideRoot"); if (!el || !alive) return;
          if (!r || !r.running) {
            const last = s.rides.slice(-3).reverse();
            el.innerHTML = '<div class="page nonav">' + header("Ride", "move") +
              '<div class="rise card" style="height:260px;padding:0;overflow:hidden;position:relative"><svg width="100%" height="100%" viewBox="0 0 400 260" preserveAspectRatio="xMidYMid slice">' + grid + '<circle cx="200" cy="130" r="22" fill="#4C82FF" opacity=".25" style="transform-origin:200px 130px;animation:pulse 1.8s ease-out infinite"/><circle cx="200" cy="130" r="9" fill="#4C82FF" stroke="#fff" stroke-width="3"/></svg></div>' +
              '<p class="rise small muted" style="margin:0;line-height:1.5">Go outdoors, wait a few seconds for GPS, then start. Recording keeps going with the screen off. Calories use your weight (' + (B.weight() || "?") + " kg) and speed.</p>" +
              '<button class="rise btn block" style="height:62px;font-size:18px" data-a="rideStart">' + I("bike", 24) + " Start ride</button>" +
              (last.length ? '<h2 class="rise">Recent rides</h2><div class="rise card tight list">' + last.map((x) => '<div class="row"><div class="grow"><div class="b">' + H.round(x.km, 2) + ' km</div><div class="tiny muted">' + new Date(x.start).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }) + " · " + H.clock(x.sec) + " · " + H.round(x.km / Math.max(x.movingSec / 3600, 1e-6), 1) + ' km/h</div></div><span class="gold2 b">' + Math.round(x.kcal) + " kcal</span></div>").join("") + "</div>" : "") + "</div>";
            return;
          }
          el.innerHTML = '<div style="position:relative;height:430px;background:#111113;overflow:hidden"><svg width="100%" height="430" viewBox="0 0 400 430" preserveAspectRatio="xMidYMid slice">' + grid + routeSvg(r.points, 400, 430) + "</svg>" +
            '<div class="row between" style="position:absolute;top:calc(16px + var(--safe-t));left:16px;right:16px"><a class="iconbtn" href="#/move" aria-label="Back">' + I("back", 20, 2) + "</a>" +
            '<span class="row small b" style="gap:8px;padding:0 14px;height:36px;border-radius:18px;background:rgba(10,10,11,.85);border:1px solid rgba(76,130,255,.5);color:#C9D6FF"><span style="width:8px;height:8px;border-radius:4px;background:#4C82FF;animation:blink 1.2s infinite"></span>' +
            (r.accuracy < 0 ? "Finding GPS…" : r.paused ? "Paused" : "GPS ±" + r.accuracy + " m · recording") + "</span></div></div>" +
            '<div style="margin-top:-30px;position:relative;background:#0A0A0B;border-radius:28px 28px 0 0;border-top:1px solid #242427;padding:22px 18px calc(24px + var(--safe-b));display:flex;flex-direction:column;gap:16px;flex:1">' +
            '<div class="row between" style="align-items:flex-end"><div><div class="eyebrow">Distance</div><div class="display" style="font-size:58px;font-weight:700;line-height:1">' + r.km.toFixed(2) + '<span style="font-size:20px" class="muted"> km</span></div></div>' +
            '<div style="text-align:right"><div class="tiny b muted" style="letter-spacing:.1em">TIME</div><div class="display" style="font-size:26px;font-weight:600">' + H.clock(r.elapsedSec) + "</div></div></div>" +
            '<div class="grid3"><div class="card tight"><div class="tiny muted">Speed</div><div class="b" style="font-size:20px">' + (r.speed || 0).toFixed(1) + '<span class="tiny muted"> km/h</span></div></div>' +
            '<div class="card tight"><div class="tiny muted">Calories</div><div class="b gold2" style="font-size:20px">' + Math.round(r.kcal) + '</div></div><div class="card tight"><div class="tiny muted">Climb</div><div class="b" style="font-size:20px">' + Math.round(r.climb) + '<span class="tiny muted"> m</span></div></div></div>' +
            '<div class="small muted center">Auto-pauses when you stop · avg ' + (r.movingSec ? (r.km / (r.movingSec / 3600)).toFixed(1) : "0.0") + " km/h</div>" +
            '<div class="grid2" style="margin-top:auto"><button class="btn ghost" style="height:58px" data-a="ridePause">' + (r.paused ? "Resume" : "Pause") + '</button><button class="btn" style="height:58px" data-a="rideFinish">Finish</button></div></div>';
        };
        const poll = () => N.rideState().then(draw).catch(() => draw(null));
        poll();
        const iv = setInterval(() => { if (ride && ride.running) poll(); }, 1000);
        return () => { alive = false; clearInterval(iv); };
      },
    };
  };
  actions.rideStart = async () => {
    let s = await N.status();
    if (!s.location) s = await N.request("location");
    if (!s.location) return toast("Allow location to record rides");
    if (!s.notifications) await N.request("notifications");
    try { await N.startRide(B.weight() || 75); N.speak("Ride started. Have a good one."); UI.render(); }
    catch (e) { toast("Couldn't start GPS: " + (e.message || e)); }
  };
  actions.ridePause = async () => { if (!ride) return; await N.pauseRide(!ride.paused); N.speak(ride.paused ? "Resumed" : "Paused"); ride = await N.rideState(); UI.refresh(); };
  actions.rideFinish = () => sheet('<h2>Finish this ride?</h2><p class="muted" style="margin:0">' + (ride ? ride.km.toFixed(2) + " km · " + H.clock(ride.elapsedSec) : "") + '</p><button class="btn block" data-a="rideSave">Finish &amp; save</button><button class="btn ghost block" data-a="closeSheet">Keep riding</button>');
  actions.closeSheet = () => closeSheet();
  actions.rideSave = async () => {
    const r = await N.stopRide(); closeSheet(); PH.rideLive = false;
    const pts = r.points || []; const step = Math.max(1, Math.ceil(pts.length / 300));
    const rec = { id: H.uid(), d: H.dkey(r.start || Date.now()), start: r.start || Date.now(), km: r.km || 0, sec: r.elapsedSec || 0, movingSec: r.movingSec || 0,
      kcal: r.kcal || 0, climb: r.climb || 0, maxSpeed: r.maxSpeed || 0, pts: pts.filter((_, i) => i % step === 0) };
    if (rec.km >= 0.05) { st().rides.push(rec); S.save(); N.markEvent("stand"); }
    N.speak("Ride saved. " + rec.km.toFixed(1) + " kilometres, " + Math.round(rec.kcal) + " calories.");
    sheet('<div class="eyebrow">Ride saved</div><div class="display" style="font-size:48px;font-weight:700">' + rec.km.toFixed(2) + ' <span class="muted" style="font-size:20px">km</span></div>' +
      '<div class="grid3"><div class="card tight stat"><div class="v">' + H.clock(rec.sec) + '</div><div class="l">time</div></div><div class="card tight stat"><div class="v">' + (rec.movingSec ? (rec.km / (rec.movingSec / 3600)).toFixed(1) : "0") + '</div><div class="l">avg km/h</div></div><div class="card tight stat"><div class="v gold">' + Math.round(rec.kcal) + '</div><div class="l">kcal</div></div></div>' +
      '<button class="btn block" data-a="closeSheet">Done</button>');
    UI.render();
  };
})();
