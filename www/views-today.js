/* Welcome, setup, Today, alarms & alerts, settings, quick-log sheet. */
(function () {
  const { H, S, B, T, Prep, Rem, MEALS, score } = PH;
  const { I, ring, toast, sheet, closeSheet, header, routes, actions, changes, go, refresh, seg, sw } = UI;
  const st = () => S.state;

  // ------------------------------------------------ welcome
  const GOALS = [["weight", "Lose weight"], ["sleep", "Fix my sleep"], ["fit", "Get fit"], ["cook", "Cook at home"], ["screen", "Less screen time"]];
  routes.welcome = () => {
    const p = st().profile;
    const f = (id, label, type, val, ph, extra) => '<label class="field">' + label + '<input data-c="prof" data-x="' + id + '" id="f_' + id + '" type="' + type + '" value="' + H.esc(val) + '" placeholder="' + (ph || "") + '" ' + (extra || "") + "></label>";
    return {
      html: '<div class="page nonav">' +
        '<div class="rise" style="position:relative;height:190px;display:flex;align-items:center;justify-content:center">' +
        '<svg width="300" height="300" viewBox="0 0 300 300" style="position:absolute;animation:spin 60s linear infinite" aria-hidden="true"><circle cx="150" cy="150" r="140" fill="none" stroke="#C9A45C" stroke-opacity=".12"/><circle cx="150" cy="150" r="110" fill="none" stroke="#C9A45C" stroke-opacity=".18" stroke-dasharray="2 10"/><circle cx="150" cy="40" r="4" fill="#C9A45C"/></svg>' +
        '<img src="logo.svg" width="96" height="96" alt="Priyatham Health logo" style="border-radius:24px;position:relative"></div>' +
        '<div class="rise eyebrow">Your daily companion</div>' +
        '<h1 class="rise" style="font-size:34px;line-height:1.1">Hi ' + H.esc(p.name || "Priyatham") + '.<br><span class="gold">Let\'s build your</span><br>best routine.</h1>' +
        '<p class="rise muted" style="margin:0;line-height:1.5">Water, workouts, rides, meals, sleep and screen time. One app that remembers everything for you.</p>' +
        '<div class="rise row wrap" style="gap:8px">' + GOALS.map(([k, l]) => '<button class="chip ' + (p.goals.includes(k) ? "on" : "") + '" data-a="goal" data-x="' + k + '">' + l + "</button>").join("") + "</div>" +
        '<div class="rise card col" style="gap:12px">' +
        '<div class="eyebrow m">About you</div>' +
        f("name", "Name", "text", p.name, "Priyatham") +
        '<div class="grid2">' + '<label class="field">Sex<select data-c="prof" data-x="sex"><option value="">Choose</option><option value="male"' + (p.sex === "male" ? " selected" : "") + '>Male</option><option value="female"' + (p.sex === "female" ? " selected" : "") + ">Female</option></select></label>" +
        f("age", "Age", "number", p.age, "25", 'inputmode="numeric"') + "</div>" +
        '<div class="grid3">' + f("heightCm", "Height (cm)", "number", p.heightCm, "170", 'inputmode="decimal"') + f("weightKg", "Weight (kg)", "number", p.weightKg, "78", 'inputmode="decimal"') + f("goalKg", "Goal (kg)", "number", p.goalKg, "70", 'inputmode="decimal"') + "</div>" +
        '<div class="eyebrow m" style="margin-top:6px">Your routine</div>' +
        '<div class="grid2">' + f("wake", "Wake up", "time", p.wake) + f("sleep", "Sleep", "time", p.sleep) + "</div>" +
        '<div class="grid2">' + f("workStart", "Work starts", "time", p.workStart) + f("workEnd", "Work ends", "time", p.workEnd) + "</div>" +
        '<div class="grid2">' + f("workoutTime", "Workout time", "time", p.workoutTime) + "<div></div></div>" +
        "</div>" +
        '<button class="rise btn block" data-a="finishWelcome">Continue ' + I("next", 20, 2.4) + "</button></div>",
    };
  };
  changes.prof = (v, el) => {
    const k = el.dataset.x; const num = ["age", "heightCm", "weightKg", "goalKg"].includes(k);
    st().profile[k] = num ? (v === "" ? "" : +v) : v; S.save();
  };
  actions.goal = (k, el) => {
    const g = st().profile.goals; const i = g.indexOf(k);
    if (i >= 0) g.splice(i, 1); else g.push(k);
    el.classList.toggle("on"); S.save();
  };
  actions.finishWelcome = () => {
    document.querySelectorAll('[data-c="prof"]').forEach((el) => changes.prof(el.value, el));
    const p = st().profile;
    if (!p.heightCm || !p.weightKg) return toast("Add your height and weight first");
    if (!p.name) p.name = "Priyatham";
    p.onboarded = true;
    if (!st().weights.length) st().weights.push({ d: H.dkey(), kg: +p.weightKg });
    S.save(); go("setup");
  };

  // ------------------------------------------------ setup (permissions)
  let perm = null;
  routes.setup = () => {
    const items = [
      ["notifications", "Notifications", "So reminders can reach you", "request", "notifications"],
      ["exactAlarm", "Exact alarms", "Rings exactly on time, even when the phone sleeps", "settings", "exactAlarm"],
      ["fullScreen", "Full-screen alarms", "Shows the ringing alarm screen over the lock screen", "settings", "fullScreen"],
      ["battery", "Ignore battery optimisation", "OnePlus closes apps in the background. This keeps alarms alive.", "settings", "battery"],
      ["activity", "Physical activity", "Counts your steps with the phone's sensor", "request", "activity"],
      ["location", "Location (GPS)", "Records your rides: km, speed, route", "request", "location"],
      ["usage", "Usage access", "Reads your phone screen time. Stays on your phone.", "settings", "usage"],
    ];
    const s = perm || {};
    const done = items.filter(([k]) => s[k]).length;
    return {
      html: '<div class="page nonav">' + header("Set up your phone", st().profile.setupDone ? "settings" : false) +
        '<p class="rise muted" style="margin:0;line-height:1.5">Tap each one and allow it. Come back here after each setting screen. ' + done + " of " + items.length + " done.</p>" +
        '<div class="rise card tight list">' + items.map(([k, t, d, how, x]) => '<div class="row"><div class="grow"><div class="b">' + t + '</div><div class="small muted">' + d + "</div></div>" +
          (s[k] ? '<span class="gold2 row" style="gap:4px;font-weight:800;font-size:13px">' + I("check", 18, 2.6) + "On</span>" : '<button class="btn sm" data-a="perm" data-x="' + how + "|" + x + '">Allow</button>') + "</div>").join("") + "</div>" +
        '<div class="rise card blue small" style="line-height:1.5">' + I("shield", 18) + ' <b>OnePlus tip:</b> also open <b>Settings → Apps → Priyatham Health → Battery</b> and choose <b>Unrestricted</b>. Then lock the app in Recent apps (swipe down on its card).</div>' +
        '<div class="rise grid2"><button class="btn ghost" data-a="testAlarm" data-x="alarm">' + I("sound", 18) + ' Test alarm</button><button class="btn ghost" data-a="testAlarm" data-x="notify">' + I("bell", 18) + " Test nudge</button></div>" +
        '<p class="small muted" style="margin:0">The test rings in 5 seconds. Try it with sound on, then on silent: it vibrates instead.</p>' +
        '<button class="rise btn block" data-a="finishSetup">' + (st().profile.setupDone ? "Save" : "Start using the app") + "</button></div>",
      mount() {
        let alive = true;
        N.status().then((x) => { if (alive && JSON.stringify(x) !== JSON.stringify(perm)) { perm = x; refresh(); } });
        const onFocus = () => N.status().then((x) => { if (alive) { perm = x; refresh(); } });
        window.addEventListener("focus", onFocus);
        return () => { alive = false; window.removeEventListener("focus", onFocus); };
      },
    };
  };
  actions.perm = async (x) => {
    const [how, which] = x.split("|");
    if (how === "request") perm = await N.request(which);
    else await N.openSettings(which);
    refresh();
  };
  actions.testAlarm = async (mode) => { await N.testAlarm(mode); toast(mode === "alarm" ? "Alarm rings in 5 seconds" : "Nudge in 5 seconds"); };
  actions.finishSetup = async () => {
    st().profile.setupDone = true; S.save();
    await Rem.sync(); await Prep.sync();
    toast("Reminders are set"); go("today");
  };

  // ------------------------------------------------ today
  function timeline() {
    const s = st(), k = H.dkey(), now = Date.now(), items = [];
    const p = s.profile;
    const day = s.plan[k] || {};
    MEALS.forEach((m) => {
      const cell = day[m]; if (!cell) return;
      const name = cell.r ? (Prep.recipe(cell.r) || {}).name : cell.t;
      const logged = (s.food[k] || []).some((f) => f.meal === m);
      const t = H.at(k, s.mealTimes[m]);
      items.push({ t, title: m[0].toUpperCase() + m.slice(1) + " · " + H.esc(name || ""), sub: logged ? "logged" : "tap to log", state: logged ? "done" : "plan", href: "food" });
    });
    Prep.upcoming(2).forEach((x) => {
      const status = Prep.status(x);
      if (H.dkey(x.planned) !== k && !(status === "now" || status === "missed")) return;
      if (status === "missed" && now - x.deadline > 6 * 3600e3) return;
      items.push({ t: x.planned, title: H.esc(x.label), sub: "for " + H.dayName(x.dateKey) + " " + x.meal + " · " + (status === "missed" ? "missed the final call" : status === "done" ? "done" : "final call " + H.time(x.deadline)),
        state: status === "done" ? "done" : status === "missed" ? "missed" : "plan", tag: s.alerts.prep === "alarm" ? "ALARM" : "", href: "prep" });
    });
    if (s.reminders.workout.on && (s.reminders.workout.days || []).includes(new Date().getDay())) {
      const did = T.activeMin(k) >= 10;
      items.push({ t: H.at(k, p.workoutTime), title: "Workout or ride", sub: did ? Math.round(T.activeMin(k)) + " active min today" : "15+ minutes", state: did ? "done" : "plan", tag: s.alerts.workout === "alarm" ? "ALARM" : "", href: "move" });
    }
    const w = T.water(k), g = B.waterGoal(k);
    if (s.reminders.water.on && w < g) {
      const nxt = Rem.firstInWindow({ winStart: p.wake, winEnd: p.sleep }, now + 20 * 60e3);
      items.push({ t: nxt, title: "Drink water · 250 ml", sub: (Math.round((g - w) / 100) / 10) + " L to go today", state: "plan", href: "water" });
    }
    const hadCheckin = !!s.sleep[k];
    items.push({ t: H.at(k, p.wake) + 15 * 60e3, title: "Sleep check-in", sub: hadCheckin ? T.sleepHours(k).toFixed(1) + " h logged" : "5 seconds", state: hadCheckin ? "done" : "plan", href: "sleep" });
    if (s.reminders.planWeek.on && new Date().getDay() === s.reminders.planWeek.day) {
      const nextMon = H.addDays(H.monday(k), 7); const planned = Object.keys(s.plan).some((d) => d >= nextMon && d < H.addDays(nextMon, 7));
      items.push({ t: H.at(k, s.reminders.planWeek.time), title: "Plan next week's meals", sub: planned ? "planned" : "10 minutes", state: planned ? "done" : "plan", tag: s.alerts.plan === "alarm" ? "ALARM" : "", href: "meals/next" });
    }
    items.push({ t: H.at(k, p.sleep) - 30 * 60e3, title: "Screens off · wind down", sub: "bed by " + H.hmLabel(p.sleep), state: "plan", href: "sleep" });
    items.sort((a, b) => a.t - b.t);
    let nowSet = false;
    items.forEach((it) => {
      if (it.state === "plan" && !nowSet && it.t <= now + 30 * 60e3) { it.state = "now"; nowSet = true; }
    });
    return items;
  }

  routes.today = () => {
    const s = st(), p = s.profile, k = H.dkey();
    const hr = new Date().getHours();
    const greet = hr < 12 ? "Good morning" : hr < 17 ? "Good afternoon" : "Good evening";
    const sc = score(k); const f = T.food(k);
    const items = timeline();
    const left = items.filter((i) => i.state !== "done").length;
    const tl = items.map((it) => {
      const dot = it.state === "done" ? '<span class="d1">' + I("check", 12, 3.5).replace('stroke="currentColor"', 'stroke="#C9A45C"') + "</span>"
        : it.state === "now" ? '<span class="d2"></span>' : it.state === "missed" ? '<span class="d3"></span>' : '<span class="d0"></span>';
      return '<a class="tl ' + (it.state === "done" ? "done" : it.state === "now" ? "now" : "") + '" href="#/' + it.href + '"><span class="dotw">' + dot + '</span><span class="box"><span class="row between"><span class="t">' + it.title + "</span>" +
        (it.tag && it.state !== "done" ? '<span class="tag">' + it.tag + "</span>" : "") + '</span><span class="s">' + H.time(it.t) + " · " + it.sub + "</span></span></a>";
    }).join("");
    const bmi = B.bmi();
    const tip = s.sleep[k] && T.sleepHours(k) < 6.5 ? "Short sleep last night. An early night today will lift tomorrow's score more than anything else."
      : T.water(k) < B.waterGoal(k) / 3 && hr > 13 ? "You're behind on water. Keep a bottle on your desk and sip every stand break."
      : f.protein < B.proteinTarget() / 3 && hr > 15 ? "Protein is low today. Add eggs, chicken or curd at dinner."
      : "Small wins add up: water, a walk after lunch and bed on time.";
    return {
      nav: "today",
      html: '<div class="page">' +
        '<div class="row between rise"><div><div class="eyebrow m">' + H.dateLabel(k) + '</div><h1 style="font-size:25px;margin-top:4px">' + greet + ', <span class="gold">' + H.esc(p.name) + "</span></h1></div>" +
        '<a class="iconbtn" href="#/settings" aria-label="Settings">' + I("gear", 20) + "</a></div>" +
        '<div class="rise card row" style="gap:16px">' + ring(sc / 100, 108, 10, "#C9A45C", '<div class="display" style="font-size:32px;font-weight:700;line-height:1">' + sc + '</div><div class="tiny muted">day score</div>') +
        '<div class="grid2 grow" style="gap:10px 14px">' +
        '<a href="#/water"><div class="tiny muted">Water</div><div class="b" style="font-size:16px">' + H.round(T.water(k) / 1000, 1) + ' <span class="small muted">/ ' + H.round(B.waterGoal(k) / 1000, 1) + " L</span></div></a>" +
        '<a href="#/move"><div class="tiny muted">Steps</div><div class="b" style="font-size:16px" id="stepsNow">' + (s.steps[k] || 0).toLocaleString("en-IN") + "</div></a>" +
        '<a href="#/food"><div class="tiny muted">Calories</div><div class="b" style="font-size:16px">' + Math.round(f.kcal).toLocaleString("en-IN") + ' <span class="small muted">/ ' + B.kcalTarget() + "</span></div></a>" +
        '<a href="#/food"><div class="tiny muted">Protein</div><div class="b" style="font-size:16px">' + Math.round(f.protein) + ' <span class="small muted">/ ' + B.proteinTarget() + " g</span></div></a></div></div>" +
        '<div class="rise row between"><h2>Your day</h2><span class="small muted">' + left + " left</span></div>" +
        '<div class="rise col" style="gap:8px">' + tl + "</div>" +
        '<div class="rise card gold row top small" style="line-height:1.45">' + I("spark", 18) + '<div><b class="gold">Coach: </b>' + tip + "</div></div>" +
        (bmi ? '<a class="rise card tight row between" href="#/body"><span class="row">' + I("scale", 20) + '<span><span class="b">' + H.round(B.weight(), 1) + ' kg</span> <span class="small muted">· BMI ' + H.round(bmi, 1) + "</span></span></span>" + I("next", 18) + "</a>" : "") +
        "</div>",
      mount() {
        PH.refreshSteps().then((n) => { const el = document.getElementById("stepsNow"); if (el && n != null) el.textContent = n.toLocaleString("en-IN"); });
      },
    };
  };

  // ------------------------------------------------ alerts & reminders settings
  routes.alerts = () => {
    const s = st(), a = s.alerts, r = s.reminders;
    const modes = [["alarm", "Alarm"], ["notify", "Notification"], ["vibrate", "Vibrate"]];
    const row = (key, title, sub) => '<div class="col" style="gap:8px"><div><div class="b">' + title + '</div><div class="small muted">' + sub + "</div></div>" + seg(modes, a[key], "alertMode", key) + "</div>";
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return {
      nav: "today",
      html: '<div class="page">' + header("Alarms & reminders", "settings") +
        '<div class="rise card grid3 center" style="gap:8px">' +
        '<div class="col" style="align-items:center;gap:6px"><span class="iconbtn" style="background:#C9A45C;color:#0A0A0B;border:0">' + I("sound", 20) + '</span><span class="small b">Sound on</span><span class="tiny muted">rings</span></div>' +
        '<div class="col" style="align-items:center;gap:6px"><span class="iconbtn gold2">' + I("vib", 20) + '</span><span class="small b">Silent/vibrate</span><span class="tiny muted">vibrates</span></div>' +
        '<div class="col" style="align-items:center;gap:6px"><span class="iconbtn gold2">' + I("moon", 20) + '</span><span class="small b">Do not disturb</span><span class="tiny muted">alarms only</span></div></div>' +
        '<div class="rise card list">' +
        row("prep", "Cooking prep", "Soak, grind, marinate · every 15 min until you tick it") +
        row("workout", "Workout & ride", "At " + H.hmLabel(s.profile.workoutTime) + " on your workout days") +
        row("plan", "Plan your week", dayNames[r.planWeek.day] + " " + H.hmLabel(r.planWeek.time) + " · meals for next week") +
        row("water", "Water", "Every " + r.water.every + " min while awake · skips if you just drank") +
        row("stand", "Stand breaks", "Every " + r.stand.every + " min during work hours") +
        row("bedtime", "Bedtime wind-down", "30 min before " + H.hmLabel(s.profile.sleep)) +
        row("checkin", "Morning sleep check-in", "15 min after you wake") + "</div>" +
        '<h2 class="rise">Turn on or off</h2>' +
        '<div class="rise card list">' +
        tog("water", "Water reminders", '<select data-c="remEvery" data-x="water" style="width:auto;min-height:36px;padding:6px 10px">' + [60, 90, 120].map((m) => "<option " + (r.water.every === m ? "selected" : "") + ' value="' + m + '">every ' + m + " min</option>").join("") + "</select>") +
        tog("stand", "Stand breaks", '<select data-c="remEvery" data-x="stand" style="width:auto;min-height:36px;padding:6px 10px">' + [30, 45, 60].map((m) => "<option " + (r.stand.every === m ? "selected" : "") + ' value="' + m + '">every ' + m + " min</option>").join("") + "</select>") +
        tog("workout", "Workout reminder", '<div class="row wrap" style="gap:4px">' + dayNames.map((d, i) => '<button class="chip ' + ((r.workout.days || []).includes(i) ? "on" : "") + '" style="height:32px;padding:0 9px;font-size:12px" data-a="wday" data-x="' + i + '">' + d[0] + "</button>").join("") + "</div>") +
        tog("bedtime", "Bedtime wind-down", "") + tog("checkin", "Morning check-in", "") +
        tog("planWeek", "Weekly meal planning", '<div class="grid2"><select data-c="planDay">' + dayNames.map((d, i) => "<option " + (r.planWeek.day === i ? "selected" : "") + ' value="' + i + '">' + d + "</option>").join("") + '</select><input type="time" data-c="planTime" value="' + r.planWeek.time + '"></div>') +
        tog("weighIn", "Weekly weigh-in", "") + "</div>" +
        '<div class="rise grid2"><button class="btn ghost" data-a="testAlarm" data-x="alarm">' + I("sound", 18) + ' Test alarm</button><a class="btn ghost" href="#/setup">' + I("shield", 18) + " Permissions</a></div></div>",
    };
    function tog(key, title, extra) {
      return '<div class="col" style="gap:8px"><div class="row between"><span class="b">' + title + "</span>" + sw(r[key].on, "remToggle", key, title) + "</div>" + (r[key].on && extra ? extra : "") + "</div>";
    }
  };
  async function resync() { S.save(); await Rem.sync(); await Prep.sync(); }
  actions.alertMode = (x) => { const [k, v] = x.split("|"); st().alerts[k] = v; resync(); refresh(); };
  actions.remToggle = (k) => { st().reminders[k].on = !st().reminders[k].on; resync(); refresh(); };
  actions.wday = (d) => { const a = st().reminders.workout.days = st().reminders.workout.days || []; const i = a.indexOf(+d); if (i >= 0) a.splice(i, 1); else a.push(+d); resync(); refresh(); };
  changes.remEvery = (v, el) => { st().reminders[el.dataset.x].every = +v; resync(); };
  changes.planDay = (v) => { st().reminders.planWeek.day = +v; resync(); };
  changes.planTime = (v) => { st().reminders.planWeek.time = v; resync(); };

  // ------------------------------------------------ settings
  routes.settings = () => {
    const s = st(), p = s.profile, m = s.mealTimes;
    const f = (c, id, label, type, val) => '<label class="field">' + label + '<input data-c="' + c + '" data-x="' + id + '" type="' + type + '" value="' + H.esc(val) + '"></label>';
    return {
      nav: "today",
      html: '<div class="page">' + header("Settings") +
        '<div class="rise card row" style="gap:14px"><img src="logo.svg" width="56" height="56" alt="" style="border-radius:14px"><div><div class="display b" style="font-size:18px">Priyatham Health</div><div class="small muted">Version 1.1 · your data stays on this phone</div></div></div>' +
        '<a class="rise card tight row between" href="#/alerts"><span class="row">' + I("bell", 20) + '<span class="b">Alarms & reminders</span></span>' + I("next", 18) + "</a>" +
        '<a class="rise card tight row between" href="#/setup"><span class="row">' + I("shield", 20) + '<span class="b">Phone permissions</span></span>' + I("next", 18) + "</a>" +
        '<a class="rise card tight row between" href="#/devices"><span class="row">' + I("laptop", 20) + '<span class="b">Laptops (ActivityWatch)</span></span><span class="row small muted">' + s.devices.length + " " + I("next", 18) + "</span></a>" +
        '<div class="rise card col" style="gap:12px"><div class="eyebrow m">Profile</div>' + f("prof", "name", "Name", "text", p.name) +
        '<div class="grid3">' + f("prof", "heightCm", "Height cm", "number", p.heightCm) + f("prof", "goalKg", "Goal kg", "number", p.goalKg) + f("prof", "age", "Age", "number", p.age) + "</div>" +
        '<div class="grid2">' + f("profT", "wake", "Wake up", "time", p.wake) + f("profT", "sleep", "Sleep", "time", p.sleep) + "</div>" +
        '<div class="grid2">' + f("profT", "workStart", "Work starts", "time", p.workStart) + f("profT", "workEnd", "Work ends", "time", p.workEnd) + "</div>" +
        '<div class="grid2">' + f("profT", "workoutTime", "Workout time", "time", p.workoutTime) + "<div></div></div></div>" +
        '<div class="rise card col" style="gap:12px"><div class="eyebrow m">Meal times (prep alarms count back from these)</div><div class="grid3">' +
        f("mealT", "breakfast", "Breakfast", "time", m.breakfast) + f("mealT", "lunch", "Lunch", "time", m.lunch) + f("mealT", "dinner", "Dinner", "time", m.dinner) + "</div></div>" +
        '<div class="rise card col" style="gap:10px"><div class="eyebrow m">Backup</div><p class="small muted" style="margin:0">Copy a backup and keep it in your notes or email. Paste it back here on a new phone.</p>' +
        '<div class="grid2"><button class="btn ghost sm" data-a="backup">Copy backup</button><button class="btn ghost sm" data-a="restore">Restore</button></div></div>' +
        '<p class="small dim center" style="margin:0">Tips and targets are general guidance, not medical advice.</p></div>',
    };
  };
  changes.profT = (v, el) => { st().profile[el.dataset.x] = v; resync(); };
  changes.mealT = (v, el) => { st().mealTimes[el.dataset.x] = v; resync(); };
  actions.backup = async () => {
    const txt = JSON.stringify(st());
    try { await navigator.clipboard.writeText(txt); toast("Backup copied (" + Math.round(txt.length / 1024) + " KB)"); }
    catch (e) { sheet('<h2>Your backup</h2><textarea rows="8" readonly>' + H.esc(txt) + "</textarea>"); }
  };
  actions.restore = () => sheet('<h2>Restore a backup</h2><p class="small muted" style="margin:0">Paste the backup text. This replaces everything in the app.</p><textarea id="restoreTxt" rows="8"></textarea><button class="btn block" data-a="doRestore">Restore</button>');
  actions.doRestore = async () => {
    try { const obj = JSON.parse(document.getElementById("restoreTxt").value); S.state = Object.assign(S.state, obj); S.save(); closeSheet(); await resync(); toast("Restored"); go("today"); }
    catch (e) { toast("That doesn't look like a backup"); }
  };

  // ------------------------------------------------ quick log (+)
  actions.quick = () => sheet('<h2>Quick log</h2><div class="grid2">' +
    q("water250", "drop", "+250 ml water") + q("gofood", "food", "Log food") + q("goride", "bike", "Start a ride") + q("goworkout", "move", "Start workout") +
    q("goweight", "scale", "Log weight") + q("gosleep", "moon", "Sleep check-in") + q("gostand", "body", "Stand break done") + q("goprep", "clock", "Prep tasks") + "</div>");
  function q(a, icon, label) { return '<button class="card tight row" style="gap:10px;text-align:left" data-a="' + a + '"><span class="gold">' + I(icon, 22) + '</span><span class="b small">' + label + "</span></button>"; }
  actions.water250 = () => { PH.addWater(250); closeSheet(); toast("+250 ml logged"); refresh(); };
  actions.gofood = () => { closeSheet(); go("food"); setTimeout(() => actions.addFood && actions.addFood(), 50); };
  actions.goride = () => { closeSheet(); go("ride"); };
  actions.goworkout = () => { closeSheet(); go("move"); };
  actions.goweight = () => { closeSheet(); go("body"); setTimeout(() => actions.addWeight && actions.addWeight(), 50); };
  actions.gosleep = () => { closeSheet(); go("sleep"); };
  actions.goprep = () => { closeSheet(); go("prep"); };
  actions.gostand = () => { const k = H.dkey(); st().stands[k] = (st().stands[k] || 0) + 1; N.markEvent("stand"); S.save(); closeSheet(); toast("Nice. Stand break logged"); };
})();
