/* Core: state, helpers, reminder + prep scheduling, scoring. */
(function () {
  const D = window.PH_DATA;
  const DAY = 86400000, MIN = 60000;

  // ---------------- helpers ----------------
  const H = {
    esc: (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
    pad: (n) => String(n).padStart(2, "0"),
    dkey(d) { d = d ? new Date(d) : new Date(); return d.getFullYear() + "-" + H.pad(d.getMonth() + 1) + "-" + H.pad(d.getDate()); },
    fromKey(k) { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); },
    addDays(k, n) { const d = H.fromKey(k); d.setDate(d.getDate() + n); return H.dkey(d); },
    hm(s) { const [h, m] = (s || "0:0").split(":").map(Number); return h * 60 + (m || 0); },
    at(k, hmStr) { const d = H.fromKey(k); const m = H.hm(hmStr); d.setHours(Math.floor(m / 60), m % 60, 0, 0); return d.getTime(); },
    time(ms) {
      const d = new Date(ms); let h = d.getHours(); const m = d.getMinutes(); const ap = h >= 12 ? "pm" : "am";
      h = h % 12 || 12; return h + ":" + H.pad(m) + " " + ap;
    },
    hmLabel(s) { return H.time(H.at(H.dkey(), s)); },
    dur(ms) {
      const t = Math.max(0, Math.round(ms / MIN)); const h = Math.floor(t / 60), m = t % 60;
      return h ? h + "h " + H.pad(m) + "m" : m + "m";
    },
    clock(sec) { sec = Math.max(0, Math.round(sec)); const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60; return (h ? h + ":" + H.pad(m) : m) + ":" + H.pad(s); },
    dayName(k, long) { return H.fromKey(k).toLocaleDateString("en-IN", { weekday: long ? "long" : "short" }); },
    dateLabel(k) { return H.fromKey(k).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short" }); },
    monday(k) { const d = H.fromKey(k); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); return H.dkey(d); },
    hash(str) { let h = 0; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0; return (Math.abs(h) % 50000000) + 1000; },
    uid: () => Math.random().toString(36).slice(2, 9),
    round: (n, d = 0) => { const p = Math.pow(10, d); return Math.round(n * p) / p; },
    clamp: (n, a, b) => Math.max(a, Math.min(b, n)),
    sum: (arr, f) => arr.reduce((s, x) => s + (f ? f(x) : x), 0),
  };

  // ---------------- state ----------------
  const defaults = () => ({
    v: 1,
    profile: { name: "Priyatham", sex: "", age: "", heightCm: "", weightKg: "", goalKg: "", wake: "07:00", sleep: "23:00",
      workStart: "09:30", workEnd: "18:30", workoutTime: "18:30", goals: ["weight", "sleep", "fit", "cook"], onboarded: false, setupDone: false },
    mealTimes: { breakfast: "08:00", lunch: "13:30", dinner: "20:30" },
    alerts: { prep: "alarm", workout: "alarm", plan: "alarm", water: "notify", stand: "vibrate", bedtime: "notify", checkin: "notify" },
    reminders: { water: { on: true, every: 90 }, stand: { on: true, every: 30 }, workout: { on: true, days: [1, 2, 3, 4, 5, 6] },
      bedtime: { on: true }, checkin: { on: true }, planWeek: { on: true, day: 6, time: "18:00" }, weighIn: { on: true, day: 0, time: "08:00" } },
    water: {}, food: {}, sleep: {}, weights: [], workouts: [], rides: [], stands: {},
    plan: {}, prepDone: {}, steps: {}, screen: {}, appCats: {},
    foods: D.foods.map(([id, name, serving, kcal, protein]) => ({ id, name, serving, kcal, protein })),
    recipes: JSON.parse(JSON.stringify(D.recipes)),
    exercises: D.exercises.slice(),
    routines: D.routines.map((r) => ({ id: r.id, name: r.name, rounds: r.rounds, items: r.items.map(([ex, work, rest]) => ({ ex, work, rest })) })),
    devices: [],
  });

  const S = { state: defaults(), _t: null };
  S.load = async function () {
    const raw = await N.prefGet("ph_state");
    if (raw) {
      try {
        const saved = JSON.parse(raw);
        const def = defaults();
        S.state = Object.assign(def, saved);
        S.state.profile = Object.assign(def.profile, saved.profile || {});
        S.state.alerts = Object.assign(def.alerts, saved.alerts || {});
        S.state.reminders = Object.assign(def.reminders, saved.reminders || {});
        S.state.mealTimes = Object.assign(def.mealTimes, saved.mealTimes || {});
      } catch (e) { console.warn("state parse", e); }
    }
  };
  S.save = function () {
    clearTimeout(S._t);
    S._t = setTimeout(() => N.prefSet("ph_state", JSON.stringify(S.state)), 250);
  };

  // ---------------- body math ----------------
  const B = {
    bmi() { const p = S.state.profile; const h = +p.heightCm / 100, w = B.weight(); return h && w ? w / (h * h) : 0; },
    weight() { const w = S.state.weights; return w.length ? +w[w.length - 1].kg : +S.state.profile.weightKg || 0; },
    kcalTarget() {
      const p = S.state.profile; const w = B.weight(), h = +p.heightCm, a = +p.age || 25;
      if (!w || !h) return 1900;
      const bmr = 10 * w + 6.25 * h - 5 * a + (p.sex === "female" ? -161 : 5);
      const floor = p.sex === "female" ? 1200 : 1500;
      return Math.max(floor, Math.round((bmr * 1.4 - 400) / 10) * 10);
    },
    proteinTarget() { const g = +S.state.profile.goalKg || B.weight() || 70; return Math.round(g * 1.6); },
    waterGoal(k) {
      const w = B.weight() || 70; let ml = Math.round(w * 33 / 50) * 50;
      k = k || H.dkey();
      if (S.state.rides.some((r) => r.d === k) || S.state.workouts.some((x) => x.d === k)) ml += 500;
      return ml;
    },
    met(kmh) { return kmh < 10 ? 3.5 : kmh < 16 ? 5.8 : kmh < 19 ? 6.8 : kmh < 22 ? 8 : kmh < 25 ? 10 : kmh < 30 ? 12 : 15.8; },
  };

  // ---------------- day totals ----------------
  const T = {
    water(k) { return H.sum(S.state.water[k || H.dkey()] || [], (x) => x.ml); },
    food(k) {
      const items = S.state.food[k || H.dkey()] || [];
      return { kcal: H.sum(items, (x) => x.kcal), protein: H.sum(items, (x) => x.protein), items };
    },
    activeMin(k) {
      k = k || H.dkey();
      return H.sum(S.state.workouts.filter((w) => w.d === k), (w) => w.min) + H.sum(S.state.rides.filter((r) => r.d === k), (r) => r.movingSec / 60);
    },
    weekActive(k) {
      const mon = H.monday(k || H.dkey()); let m = 0, km = 0, kcal = 0, strength = 0;
      for (let i = 0; i < 7; i++) {
        const d = H.addDays(mon, i);
        m += T.activeMin(d);
        S.state.rides.filter((r) => r.d === d).forEach((r) => { km += r.km; kcal += r.kcal; });
        S.state.workouts.filter((w) => w.d === d).forEach((w) => { kcal += w.kcal; if (/strength/i.test(w.name)) strength++; });
      }
      return { min: Math.round(m), km, kcal: Math.round(kcal), strength };
    },
    sleepHours(k) {
      const s = S.state.sleep[k || H.dkey()]; if (!s) return 0;
      let m = H.hm(s.wake) - H.hm(s.bed); if (m <= 0) m += 1440; return m / 60;
    },
  };

  // ---------------- sleep window ----------------
  function asleep(ms) {
    const p = S.state.profile; const d = new Date(ms); const m = d.getHours() * 60 + d.getMinutes();
    const s = H.hm(p.sleep), w = H.hm(p.wake);
    return s > w ? (m >= s || m < w) : (m >= s && m < w);
  }
  function sleepStartBefore(ms) {
    const p = S.state.profile;
    for (let back = 0; back < 3; back++) {
      const k = H.dkey(ms - back * DAY); const t = H.at(k, p.sleep);
      if (t <= ms) return t;
    }
    return ms;
  }
  function wakeAfter(ms) {
    const p = S.state.profile;
    for (let f = 0; f < 3; f++) { const t = H.at(H.dkey(ms + f * DAY), p.wake); if (t >= ms) return t; }
    return ms;
  }

  // ---------------- prep planner ----------------
  const MEALS = ["breakfast", "lunch", "dinner"];
  const Prep = {
    recipe(id) { return S.state.recipes.find((r) => r.id === id); },
    /** Works backwards from the meal time. Steps that land in your sleep hours move to before bed. */
    stepsFor(dateKey, meal, recipe) {
      const mealAt = H.at(dateKey, S.state.mealTimes[meal]);
      const out = [];
      let next = mealAt;
      for (let i = recipe.steps.length - 1; i >= 0; i--) {
        const st = recipe.steps[i];
        const latest = next - st.wait * MIN;
        let deadline = latest;
        if (asleep(latest)) deadline = sleepStartBefore(latest) - 15 * MIN;
        const lead = st.wait >= 240 ? 180 : st.wait >= 60 ? 45 : 20;
        let planned = deadline - lead * MIN;
        if (asleep(planned)) planned = Math.min(wakeAfter(planned), deadline);
        const key = "prep:" + dateKey + ":" + meal + ":" + i;
        out.unshift({ key, i, label: st.label, wait: st.wait, planned, deadline, mealAt, meal, dateKey, recipe: recipe.name, recipeId: recipe.id, total: recipe.steps.length });
        next = deadline;
      }
      return out;
    },
    upcoming(days = 9) {
      const today = H.dkey(); const tasks = [];
      for (let i = -1; i < days; i++) {
        const k = H.addDays(today, i); const day = S.state.plan[k] || {};
        MEALS.forEach((meal) => {
          const cell = day[meal];
          if (cell && cell.r) {
            const r = Prep.recipe(cell.r);
            if (r && r.steps && r.steps.length) tasks.push(...Prep.stepsFor(k, meal, r));
          }
        });
      }
      return tasks.filter((t) => t.mealAt > Date.now() - 12 * 3600e3).sort((a, b) => a.planned - b.planned);
    },
    status(t) {
      if (S.state.prepDone[t.key]) return "done";
      const now = Date.now();
      if (now > t.deadline) return "missed";
      if (now >= t.planned - 30 * MIN) return "now";
      return "next";
    },
    async sync() {
      await N.cancelPrefix("prep:");
      const a = S.state.alerts.prep; const now = Date.now();
      const alarms = Prep.upcoming().filter((t) => !S.state.prepDone[t.key] && t.deadline > now).map((t) => ({
        id: H.hash(t.key), key: t.key, kind: "prep", title: t.label,
        body: "For " + H.dayName(t.dateKey, true) + " " + t.meal + " · " + t.recipe + ".",
        at: Math.max(t.planned, now + 30000), until: t.deadline, repeatMin: 15, mode: a,
        actions: ["done", "snooze"], route: "prep",
      }));
      await N.schedule(alarms);
    },
  };

  // ---------------- daily reminders ----------------
  function nextAt(hmStr, dayFilter) {
    const now = Date.now();
    for (let i = 0; i < 8; i++) {
      const k = H.addDays(H.dkey(), i); const t = H.at(k, hmStr);
      if (t > now && (!dayFilter || dayFilter.includes(H.fromKey(k).getDay()))) return t;
    }
    return H.at(H.addDays(H.dkey(), 1), hmStr);
  }
  function minus(hmStr, m) { let x = H.hm(hmStr) - m; if (x < 0) x += 1440; return H.pad(Math.floor(x / 60)) + ":" + H.pad(x % 60); }
  function plus(hmStr, m) { return minus(hmStr, -m); }

  const Rem = {
    build() {
      const s = S.state, r = s.reminders, al = s.alerts, p = s.profile; const out = [];
      if (r.water.on) out.push({ id: 101, key: "rem:water", kind: "water", title: "Time for water", body: "A glass now keeps you on track. Tap +250 ml to log it.",
        recur: "interval", everyMin: r.water.every, winStart: plus(p.wake, 30), winEnd: minus(p.sleep, 60), at: 0,
        skipKey: "water", skipMin: 45, mode: al.water, actions: ["water", "snooze"], route: "water" });
      if (r.stand.on) out.push({ id: 102, key: "rem:stand", kind: "stand", title: "Stand up for 2 minutes", body: "You've been sitting a while. Walk, stretch or refill water.",
        recur: "interval", everyMin: r.stand.every, winStart: p.workStart, winEnd: p.workEnd, at: 0, skipKey: "stand", skipMin: 20,
        mode: al.stand, actions: ["done", "snooze"], route: "today" });
      if (r.workout.on) (r.workout.days || [1, 2, 3, 4, 5, 6]).forEach((wd) => out.push({ id: 110 + wd, key: "rem:workout" + wd, kind: "workout",
        title: "Workout time", body: "Your routine or a ride is waiting. Even 15 minutes counts.", recur: "weekly",
        at: nextAt(p.workoutTime, [wd]), mode: al.workout, actions: ["done", "snooze"], route: "move" }));
      if (r.bedtime.on) {
        out.push({ id: 103, key: "rem:winddown", kind: "bedtime", title: "Wind down", body: "Screens away. Lights out at " + H.hmLabel(p.sleep) + ".",
          recur: "daily", at: nextAt(minus(p.sleep, 30)), mode: al.bedtime, actions: ["done"], route: "sleep" });
      }
      if (r.checkin.on) out.push({ id: 104, key: "rem:checkin", kind: "checkin", title: "Good morning, " + (p.name || "Priyatham"),
        body: "How did you sleep? It takes 5 seconds.", recur: "daily", at: nextAt(plus(p.wake, 15)), mode: al.checkin, actions: ["done"], route: "sleep" });
      if (r.planWeek.on) out.push({ id: 105, key: "rem:planweek", kind: "plan", title: "Plan next week's meals",
        body: "10 minutes now = breakfast, lunch and dinner sorted, with prep alarms set for you.", recur: "weekly",
        at: nextAt(r.planWeek.time, [r.planWeek.day]), mode: al.plan, actions: ["done", "snooze"], route: "meals" });
      if (r.weighIn.on) out.push({ id: 106, key: "rem:weighin", kind: "weigh", title: "Weekly weigh-in", body: "Before breakfast, after the bathroom. Same time each week.",
        recur: "weekly", at: nextAt(r.weighIn.time, [r.weighIn.day]), mode: "notify", actions: ["done"], route: "body" });
      out.push({ id: 107, key: "rem:steps", kind: "steps", title: "", body: "", recur: "daily", at: nextAt("23:58"), mode: "notify" });
      const now = Date.now();
      out.forEach((a) => { if (a.recur === "interval") a.at = Rem.firstInWindow(a, now + a.everyMin * MIN); });
      return out;
    },
    firstInWindow(a, t) {
      const k = H.dkey(t); const s = H.at(k, a.winStart), e = H.at(k, a.winEnd);
      if (t < s) return s; if (t > e) return H.at(H.addDays(k, 1), a.winStart); return t;
    },
    async sync() {
      await N.cancelPrefix("rem:");
      await N.schedule(Rem.build());
    },
  };

  // ---------------- events coming back from notifications ----------------
  async function drain() {
    const evs = await N.drainEvents();
    let changed = false;
    evs.forEach((e) => {
      const k = H.dkey(e.ts);
      if (e.type === "water") { (S.state.water[k] = S.state.water[k] || []).push({ t: e.ts, ml: e.ml || 250 }); changed = true; }
      if (e.type === "done" && e.key && e.key.startsWith("prep:")) { S.state.prepDone[e.key] = e.ts; changed = true; }
      if (e.type === "done" && e.key === "rem:stand") { S.state.stands[k] = (S.state.stands[k] || 0) + 1; changed = true; }
    });
    if (changed) S.save();
    return evs.length;
  }

  // ---------------- score ----------------
  function score(k) {
    k = k || H.dkey();
    const w = H.clamp(T.water(k) / B.waterGoal(k), 0, 1);
    const st = H.clamp((S.state.steps[k] || 0) / 8000, 0, 1);
    const f = T.food(k); const pr = H.clamp(f.protein / B.proteinTarget(), 0, 1);
    const kc = f.kcal ? (f.kcal <= B.kcalTarget() * 1.05 ? 1 : 0.4) : 0.5;
    const sl = H.clamp(T.sleepHours(k) / 7.5, 0, 1) || 0.5;
    const act = H.clamp(T.activeMin(k) / 25, 0, 1);
    return Math.round((w * 22 + st * 18 + pr * 15 + kc * 10 + sl * 17 + act * 18));
  }

  window.PH = { H, S, B, T, Prep, Rem, MEALS, drain, score, asleep, DAY, MIN };
})();
