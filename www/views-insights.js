/* Insights: screen time (phone + laptops via ActivityWatch), devices, sleep, body/weight. */
(function () {
  const { H, S, B, T } = PH;
  const { I, ring, toast, sheet, closeSheet, header, routes, actions, changes, go, refresh, seg } = UI;
  const st = () => S.state;
  const D = window.PH_DATA;

  // ------------------------------------------------ categories
  function cat(name) {
    const n = String(name || "").toLowerCase();
    const o = st().appCats[n]; if (o) return o;
    if (D.leisure.some((x) => n.includes(x))) return "leisure";
    if (D.work.some((x) => n.includes(x))) return "work";
    if (/chrome|msedge|edge|firefox|brave|opera|browser/.test(n)) return "work";
    return "other";
  }

  // ------------------------------------------------ ActivityWatch (laptops)
  async function fetchJSON(url, opts, ms = 6000) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await fetch(url, Object.assign({ signal: ctl.signal, headers: { "Content-Type": "application/json" } }, opts || {}));
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } finally { clearTimeout(t); }
  }
  function iso(ms) {
    const d = new Date(ms), off = -d.getTimezoneOffset(), sg = off >= 0 ? "+" : "-";
    return H.dkey(ms) + "T" + H.pad(d.getHours()) + ":" + H.pad(d.getMinutes()) + ":00" + sg + H.pad(Math.floor(Math.abs(off) / 60)) + ":" + H.pad(Math.abs(off) % 60);
  }
  async function laptopDay(dev, k) {
    const base = "http://" + dev.ip + ":" + (dev.port || 5600) + "/api/0";
    const start = H.fromKey(k).getTime(), end = start + PH.DAY;
    const q = {
      timeperiods: [iso(start) + "/" + iso(end)],
      query: [
        'afk = flood(query_bucket(find_bucket("aw-watcher-afk_")));',
        'win = flood(query_bucket(find_bucket("aw-watcher-window_")));',
        'win = filter_period_intersect(win, filter_keyvals(afk, "status", ["not-afk"]));',
        'apps = sort_by_duration(merge_events_by_keys(win, ["app"]));',
        "RETURN = apps;",
      ],
    };
    const res = await fetchJSON(base + "/query/", { method: "POST", body: JSON.stringify(q) }, 12000);
    const all = (res[0] || []).map((e) => ({ label: (e.data.app || "?").replace(/\.exe$/i, ""), ms: e.duration * 1000 }));
    // total counts every app; the list keeps only apps used for 30 s or more
    return { total: H.sum(all, (a) => a.ms), apps: all.filter((a) => a.ms >= 30000), at: Date.now() };
  }

  async function loadScreen(k) {
    const s = st(); const day = (s.screen[k] = s.screen[k] || {});
    const start = H.fromKey(k).getTime();
    try { const u = await N.usage(start, Math.min(Date.now(), start + PH.DAY)); day.phone = { total: u.total, lateNight: u.lateNight, apps: u.apps.map((a) => ({ label: a.label, ms: a.ms })), at: Date.now() }; }
    catch (e) { day.phoneErr = String(e.message || e); }
    await Promise.all(s.devices.map(async (d) => {
      try { day[d.id] = await laptopDay(d, k); d.lastOk = Date.now(); d.err = ""; }
      catch (e) { d.err = e.name === "AbortError" ? "Not reachable (same Wi-Fi? laptop awake?)" : String(e.message || e); }
    }));
    S.save();
  }

  // ------------------------------------------------ insights / screen time
  let loading = false;
  routes.insights = () => {
    const s = st(), k = H.dkey(), day = s.screen[k] || {};
    const sources = [{ id: "phone", name: "OnePlus phone", icon: "phone" }, ...s.devices.map((d) => ({ id: d.id, name: d.name, icon: "laptop", err: d.err }))];
    const merged = {};
    let total = 0, work = 0, leisure = 0;
    sources.forEach((src) => {
      const x = day[src.id]; if (!x) return;
      total += x.total;
      x.apps.forEach((a) => {
        const key = a.label.toLowerCase(); merged[key] = merged[key] || { label: a.label, ms: 0, src: new Set() };
        merged[key].ms += a.ms; merged[key].src.add(src.icon);
        const c = cat(a.label); if (c === "work") work += a.ms; else if (c === "leisure") leisure += a.ms;
      });
    });
    const other = Math.max(0, total - work - leisure);
    const late = day.phone ? day.phone.lateNight || 0 : 0;
    const top = Object.values(merged).sort((a, b) => b.ms - a.ms).slice(0, 8);
    const maxMs = top.length ? top[0].ms : 1;
    const verdicts = [];
    if (late > 20 * 60e3) verdicts.push(["warn", "Phone after 11 pm", H.dur(late) + " · delays sleep"]);
    else if (day.phone) verdicts.push(["ok", "Phone after 11 pm", late ? H.dur(late) : "none, great"]);
    if (leisure > 3 * 3600e3) verdicts.push(["warn", "Leisure screen time", H.dur(leisure) + " · try under 2 h"]);
    else if (total) verdicts.push(["ok", "Leisure screen time", H.dur(leisure) + " · in a healthy range"]);
    if (work > 9 * 3600e3) verdicts.push(["warn", "Work on screens", H.dur(work) + " · long day, take eye breaks"]);
    else if (work) verdicts.push(["ok", "Work on screens", H.dur(work)]);
    const standDone = s.stands[k] || 0;
    verdicts.push([standDone >= 4 ? "ok" : "warn", "Stand breaks today", standDone + " logged"]);
    const needUsage = !day.phone && day.phoneErr;
    return {
      nav: "insights",
      html: '<div class="page"><div class="rise row between"><div><div class="eyebrow m">Insights · today</div><h1 style="margin-top:4px">Screen time</h1></div><button class="chip" data-a="reloadScreen" aria-label="Refresh">' + (loading ? '<span style="width:14px;height:14px;border:2px solid #C9A45C;border-top-color:transparent;border-radius:7px;animation:spin .8s linear infinite"></span> Syncing' : I("refresh", 16) + " Refresh") + "</button></div>" +
        (needUsage ? '<div class="rise card blue row small">' + I("phone", 20) + '<div class="grow">Allow <b>Usage access</b> to see your phone screen time.</div><button class="btn sm" data-a="perm" data-x="settings|usage">Allow</button></div>' : "") +
        '<div class="rise card col" style="gap:12px"><div class="row between" style="align-items:flex-end"><div class="display" style="font-size:42px;font-weight:700;line-height:1">' + H.dur(total).replace(/([hm])/g, '<span class="muted" style="font-size:18px">$1</span>') + '</div><div class="small muted" style="text-align:right">' + sources.length + " device" + (sources.length > 1 ? "s" : "") + "</div></div>" +
        '<div class="row" style="height:12px;border-radius:6px;overflow:hidden;gap:3px">' + (total ? '<div style="width:' + work / total * 100 + '%;background:#C9A45C"></div><div style="width:' + leisure / total * 100 + '%;background:#F5F3EE"></div><div style="width:' + other / total * 100 + '%;background:#4A4A4F"></div>' : '<div style="width:100%;background:#232326"></div>') + "</div>" +
        '<div class="row wrap small muted" style="gap:14px"><span><span class="gold">■</span> Work ' + H.dur(work) + '</span><span><span style="color:#F5F3EE">■</span> Leisure ' + H.dur(leisure) + '</span><span><span style="color:#4A4A4F">■</span> Other ' + H.dur(other) + "</span></div>" +
        '<div class="grid2">' + sources.map((src) => { const x = day[src.id]; return '<div class="card tight" style="background:#1C1C1F;border:0"><div class="row tiny muted" style="gap:6px">' + I(src.icon, 14) + H.esc(src.name) + '</div><div class="b" style="font-size:17px">' + (x ? H.dur(x.total) : "–") + "</div>" + (src.err ? '<div class="tiny warn">' + H.esc(src.err) + "</div>" : x ? '<div class="tiny dim">synced ' + H.time(x.at) + "</div>" : '<div class="tiny dim">tap Refresh</div>') + "</div>"; }).join("") + "</div>" +
        '<a class="small gold b" href="#/devices">' + (s.devices.length ? "Manage laptops" : "+ Connect your 2 laptops (ActivityWatch)") + "</a></div>" +
        (top.length ? '<div class="rise card col" style="gap:10px"><div class="row between"><h2 style="font-size:15px">Top apps</h2><span class="tiny muted">tap to change work/leisure</span></div>' + top.map((a) => {
          const c = cat(a.label);
          return '<button style="background:none;border:0;padding:0;text-align:left" data-a="toggleCat" data-x="' + H.esc(a.label.toLowerCase()) + '"><div class="row between small"><span class="b">' + H.esc(a.label) + ' <span class="tiny dim">· ' + c + " " + [...a.src].map((ic) => I(ic, 11)).join("") + '</span></span><span class="b">' + H.dur(a.ms) + '</span></div><div class="bar" style="height:5px;margin-top:5px"><i style="width:' + a.ms / maxMs * 100 + "%;background:" + (c === "work" ? "#C9A45C" : c === "leisure" ? "#F5F3EE" : "#4A4A4F") + '"></i></div></button>';
        }).join("") + "</div>" : "") +
        '<div class="rise card col" style="gap:8px"><h2 style="font-size:15px">Is this healthy?</h2>' + verdicts.map(([t, l, v]) => '<div class="row between small"><span class="muted">' + l + '</span><b class="' + (t === "warn" ? "warn" : "gold2") + '">' + v + "</b></div>").join("") + "</div>" +
        '<div class="rise grid2"><a class="card tight row" href="#/sleep">' + I("moon", 20) + '<span class="b small">Sleep</span></a><a class="card tight row" href="#/body">' + I("scale", 20) + '<span class="b small">Weight & body</span></a></div>' +
        '<div class="rise grid2"><a class="card tight row" href="#/water">' + I("drop", 20) + '<span class="b small">Water</span></a><a class="card tight row" href="#/food">' + I("food", 20) + '<span class="b small">Calories</span></a></div></div>',
      mount() {
        const old = (x) => !x || Date.now() - x.at > 60000;
        const stale = old(day.phone) || s.devices.some((d) => old(day[d.id]));
        if (stale && !loading) actions.reloadScreen();
      },
    };
  };
  actions.reloadScreen = async () => { if (loading) return; loading = true; refresh(); await loadScreen(H.dkey()); loading = false; if (UI.current().name === "insights") refresh(); };
  actions.toggleCat = (name) => {
    const order = ["work", "leisure", "other"]; const c = cat(name);
    st().appCats[name] = order[(order.indexOf(c) + 1) % 3]; S.save(); refresh();
  };

  // ------------------------------------------------ devices (laptops)
  routes.devices = () => {
    const s = st();
    return {
      nav: "insights",
      html: '<div class="page">' + header("Laptops", "insights") +
        '<p class="rise muted small" style="margin:0;line-height:1.5">Your laptops run <b>ActivityWatch</b> (free, open source). When your phone and laptop are on the same Wi-Fi, this app reads each laptop\'s screen time. Full steps are in your install guide.</p>' +
        (s.devices.length ? '<div class="rise card tight list">' + s.devices.map((d) => '<div class="row"><span class="gold">' + I("laptop", 22) + '</span><div class="grow"><div class="b">' + H.esc(d.name) + '</div><div class="tiny muted">' + H.esc(d.ip) + ":" + (d.port || 5600) + (d.host ? " · " + H.esc(d.host) : "") + "</div>" + (d.err ? '<div class="tiny warn">' + H.esc(d.err) + "</div>" : d.lastOk ? '<div class="tiny gold2">Synced ' + H.time(d.lastOk) + "</div>" : "") + "</div>" +
          '<button class="btn sm ghost" data-a="testDevice" data-x="' + d.id + '">Test</button><button class="iconbtn" data-a="delDevice" data-x="' + d.id + '" aria-label="Remove">' + I("trash", 16) + "</button></div>").join("") + "</div>" : "") +
        '<div class="rise card col" style="gap:10px"><div class="eyebrow m">Add a laptop</div><label class="field">Name<input id="dvName" placeholder="Laptop 1 (work)"></label>' +
        '<div class="grid2"><label class="field">IP address<input id="dvIp" placeholder="192.168.1.20" inputmode="decimal"></label><label class="field">Port<input id="dvPort" value="5600" inputmode="numeric"></label></div>' +
        '<button class="btn block" data-a="addDevice">Test &amp; add</button><p class="tiny muted" style="margin:0">Find the IP on the laptop: open Command Prompt and type <b>ipconfig</b>, then look for "IPv4 Address" under Wi-Fi.</p></div></div>',
    };
  };
  async function probe(ip, port) {
    const info = await fetchJSON("http://" + ip + ":" + port + "/api/0/info", null, 5000);
    return info.hostname || "ActivityWatch";
  }
  actions.addDevice = async () => {
    const name = document.getElementById("dvName").value.trim() || "Laptop " + (st().devices.length + 1);
    const ip = document.getElementById("dvIp").value.trim(); const port = +document.getElementById("dvPort").value || 5600;
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return toast("Enter an IP like 192.168.1.20");
    toast("Connecting…");
    try { const host = await probe(ip, port); st().devices.push({ id: "dev_" + H.uid(), name, ip, port, host, lastOk: Date.now() }); S.save(); toast("Connected to " + host); go("insights"); }
    catch (e) { sheet('<h2>Couldn\'t reach ' + H.esc(ip) + '</h2><div class="small muted" style="line-height:1.6">Check these on the laptop:<br>1. ActivityWatch is running (icon near the clock).<br>2. Its config has <b>address = "0.0.0.0"</b> and it was restarted.<br>3. Windows Firewall allows port 5600 on Private networks.<br>4. Phone and laptop are on the same Wi-Fi.<br>5. The Wi-Fi is set to Private on the laptop.</div><button class="btn ghost block" data-a="forceAdd" data-x="' + H.esc(name + "|" + ip + "|" + port) + '">Add anyway</button>'); }
  };
  actions.forceAdd = (x) => { const [name, ip, port] = x.split("|"); st().devices.push({ id: "dev_" + H.uid(), name, ip, port: +port }); S.save(); closeSheet(); refresh(); };
  actions.testDevice = async (id) => {
    const d = st().devices.find((x) => x.id === id);
    try { d.host = await probe(d.ip, d.port || 5600); d.err = ""; d.lastOk = Date.now(); toast("Connected to " + d.host); }
    catch (e) { d.err = "Not reachable"; toast("Not reachable. See the guide"); }
    S.save(); refresh();
  };
  actions.delDevice = (id) => { st().devices = st().devices.filter((x) => x.id !== id); S.save(); refresh(); };

  // ------------------------------------------------ sleep
  let sq = null;
  routes.sleep = () => {
    const s = st(), k = H.dkey(), cur = s.sleep[k];
    sq = sq && sq.k === k ? sq : Object.assign({ k, bed: s.profile.sleep, wake: s.profile.wake, q: 3, tags: [] }, cur || {});
    const days = [...Array(7)].map((_, i) => H.addDays(k, i - 6));
    const bars = days.map((d, i) => {
      const h = T.sleepHours(d); const hh = Math.min(h, 10) * 11; const x = 12 + i * 45;
      return (h ? '<rect class="vbar" x="' + x + '" y="' + (120 - hh) + '" width="28" height="' + hh + '" rx="6" fill="' + (h >= 7 ? "#C9A45C" : "#5A5A60") + '" style="animation-delay:' + i * 0.06 + 's"/>' : '<rect x="' + x + '" y="116" width="28" height="4" rx="2" fill="#2A2A2E"/>') +
        '<text x="' + (x + 14) + '" y="137" text-anchor="middle" font-size="11" fill="#A3A09A" font-family="Manrope">' + H.dayName(d)[0] + "</text>";
    }).join("");
    const logged = days.map((d) => T.sleepHours(d)).filter(Boolean);
    const avg = logged.length ? H.sum(logged) / logged.length : 0;
    const beds = days.map((d) => s.sleep[d] && H.hm(s.sleep[d].bed)).filter((x) => x != null).map((m) => (m < 720 ? m + 1440 : m));
    const spread = beds.length > 1 ? Math.max(...beds) - Math.min(...beds) : 0;
    const late = s.screen[k] && s.screen[k].phone ? s.screen[k].phone.lateNight : 0;
    const TAGS = ["Phone in bed", "Late coffee", "Late dinner", "Stress", "Workout", "Noise"];
    return {
      nav: "today",
      html: '<div class="page">' + header("Sleep") +
        '<div class="rise card col" style="gap:12px"><div class="eyebrow">Morning check-in</div><div class="display" style="font-size:20px;font-weight:600">How did you sleep, ' + H.esc(s.profile.name) + "?</div>" +
        '<div class="grid2"><label class="field">Slept at<input type="time" data-c="sq" data-x="bed" value="' + sq.bed + '"></label><label class="field">Woke at<input type="time" data-c="sq" data-x="wake" value="' + sq.wake + '"></label></div>' +
        seg([["1", "Awful"], ["2", "Poor"], ["3", "Okay"], ["4", "Good"], ["5", "Great"]], String(sq.q), "sqQ") +
        '<div class="row wrap" style="gap:6px">' + TAGS.map((t) => '<button class="chip ' + (sq.tags.includes(t) ? "on" : "") + '" style="height:32px;font-size:12px" data-a="sqTag" data-x="' + t + '">' + t + "</button>").join("") + "</div>" +
        '<button class="btn block" data-a="saveSleep">' + (cur ? "Update" : "Save") + "</button></div>" +
        '<div class="rise card col" style="gap:6px"><div class="row between"><h2 style="font-size:16px">Last 7 nights</h2><span class="small muted">' + (avg ? "avg " + H.dur(avg * 3600e3) : "no data yet") + "</span></div>" +
        '<svg width="100%" height="142" viewBox="0 0 318 142" aria-label="Sleep hours for 7 nights"><rect x="0" y="21" width="318" height="22" fill="#C9A45C" fill-opacity=".10"/><text x="316" y="35" text-anchor="end" font-size="10" fill="#C9A45C" font-family="Manrope">7–9 h</text>' + bars + "</svg>" +
        (spread ? '<div class="small" style="line-height:1.45">Your bedtime moved by <b>' + H.dur(spread * 60e3) + "</b> this week. " + (spread > 45 ? "Keeping it within 30 min fixes a messy sleep cycle faster than sleeping in." : "Nice and steady. Keep it up.") + "</div>" : "") + "</div>" +
        (late > 10 * 60e3 ? '<div class="rise card blue row top small">' + I("phone", 18) + "<div>You used your phone <b>" + H.dur(late) + " after 11 pm</b> last night. Put it on charge outside arm's reach at wind-down.</div></div>" : "") +
        '<div class="rise card tight row between"><span class="muted">Tonight: screens off</span><b class="gold2">' + H.time(H.at(k, s.profile.sleep) - 30 * 60e3) + '</b><span class="muted">lights out</span><b class="gold2">' + H.hmLabel(s.profile.sleep) + "</b></div></div>",
    };
  };
  changes.sq = (v, el) => { sq[el.dataset.x] = v; };
  actions.sqQ = (v) => { sq.q = +v; document.querySelectorAll('[data-a="sqQ"]').forEach((b) => b.classList.toggle("on", b.dataset.x === v)); };
  actions.sqTag = (t, el) => { const i = sq.tags.indexOf(t); if (i >= 0) sq.tags.splice(i, 1); else sq.tags.push(t); el.classList.toggle("on"); };
  actions.saveSleep = () => {
    st().sleep[sq.k] = { bed: sq.bed, wake: sq.wake, q: sq.q, tags: sq.tags.slice() }; S.save();
    toast("Logged " + T.sleepHours(sq.k).toFixed(1) + " h"); refresh();
  };

  // ------------------------------------------------ body / weight
  routes.body = () => {
    const s = st(), p = s.profile, w = s.weights.slice(-16), cur = B.weight(), bmi = B.bmi();
    let chart = '<div class="small muted">Log a few weigh-ins to see your trend.</div>';
    let eta = "";
    if (w.length >= 2) {
      const kgs = w.map((x) => +x.kg), mn = Math.min(...kgs) - 0.5, mx = Math.max(...kgs) + 0.5;
      const X = (i) => 16 + i * (286 / (w.length - 1)), Y = (v) => 14 + (mx - v) / (mx - mn) * 90;
      const pts = w.map((x, i) => X(i).toFixed(1) + " " + Y(+x.kg).toFixed(1));
      chart = '<svg width="100%" height="130" viewBox="0 0 318 130" aria-label="Weight trend"><line x1="0" y1="30" x2="318" y2="30" stroke="#1F1F22"/><line x1="0" y1="65" x2="318" y2="65" stroke="#1F1F22"/><line x1="0" y1="100" x2="318" y2="100" stroke="#1F1F22"/>' +
        '<path d="M' + pts.join(" L") + " L " + X(w.length - 1).toFixed(1) + " 110 L 16 110 Z" + '" fill="#C9A45C" fill-opacity=".10"/>' +
        '<path d="M' + pts.join(" L") + '" fill="none" stroke="#C9A45C" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1" style="animation:dash 1.6s ease-out forwards"/>' +
        '<circle cx="' + X(w.length - 1) + '" cy="' + Y(cur) + '" r="6" fill="#C9A45C" stroke="#0A0A0B" stroke-width="2"/>' +
        '<text x="0" y="126" font-size="11" fill="#A3A09A" font-family="Manrope">' + H.fromKey(w[0].d).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) + '</text><text x="318" y="126" text-anchor="end" font-size="11" fill="#A3A09A" font-family="Manrope">Today</text></svg>';
      const days = (H.fromKey(w[w.length - 1].d) - H.fromKey(w[0].d)) / PH.DAY;
      const rate = days > 6 ? (kgs[0] - kgs[kgs.length - 1]) / (days / 7) : 0;
      if (p.goalKg && cur > p.goalKg && rate > 0.05) {
        const weeks = (cur - p.goalKg) / rate; const when = new Date(Date.now() + weeks * 7 * PH.DAY);
        eta = "Losing " + H.round(rate, 2) + " kg/week. Goal <b>" + p.goalKg + " kg</b> around <b>" + when.toLocaleDateString("en-IN", { month: "long", year: "numeric" }) + "</b>." + (rate > 1 ? " That's fast. Aim for 0.25–0.75 kg a week." : "");
      } else if (p.goalKg && cur > p.goalKg) eta = "A safe pace is 0.25–0.5 kg a week. Goal: <b>" + p.goalKg + " kg</b>.";
    }
    const first = w.length ? +w[0].kg : cur;
    const wk = T.weekActive(), lw = T.weekActive(H.addDays(H.dkey(), -7));
    const waist = [...s.weights].reverse().find((x) => x.waist);
    return {
      nav: "insights",
      html: '<div class="page">' + header("Body", "insights") +
        '<div class="rise card col" style="gap:10px"><div class="row between" style="align-items:flex-end"><div><div class="eyebrow">Weight trend</div><div class="display" style="font-size:40px;font-weight:700;line-height:1.05">' + (cur ? H.round(cur, 1) : "–") + '<span class="muted" style="font-size:18px"> kg</span></div></div>' +
        '<div style="text-align:right"><div class="b gold2" style="font-size:16px">' + (first && cur ? (cur - first > 0 ? "+" : "−") + H.round(Math.abs(cur - first), 1) + " kg" : "") + '</div><div class="small muted">' + (w.length > 1 ? "since " + H.fromKey(w[0].d).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "") + "</div></div></div>" + chart +
        (eta ? '<div class="small muted" style="line-height:1.45">' + eta + "</div>" : "") + "</div>" +
        '<div class="rise grid3"><div class="card tight"><div class="tiny muted">BMI</div><div class="b" style="font-size:20px">' + (bmi ? H.round(bmi, 1) : "–") + '</div><div class="tiny gold2">healthy 18.5–24.9</div></div>' +
        '<div class="card tight"><div class="tiny muted">Waist</div><div class="b" style="font-size:20px">' + (waist ? waist.waist + " cm" : "–") + '</div><div class="tiny muted">optional</div></div>' +
        '<div class="card tight"><div class="tiny muted">Height</div><div class="b" style="font-size:20px">' + (p.heightCm || "–") + ' cm</div><div class="tiny muted">set once</div></div></div>' +
        '<div class="rise card col" style="gap:9px"><h2 style="font-size:15px">This week vs last</h2>' +
        cmp("Active minutes", wk.min, lw.min, "") + cmp("Km cycled", H.round(wk.km, 1), H.round(lw.km, 1), "") + cmp("Calories burned", wk.kcal, lw.kcal, "") + "</div>" +
        '<button class="rise btn block" data-a="addWeight">Log today\'s weight</button>' +
        '<p class="small dim" style="margin:0">BMI is a rough guide. Your trend and waist size tell you more.</p></div>',
    };
    function cmp(l, a, b) { const d = H.round(a - b, 1); return '<div class="row between small"><span class="muted">' + l + "</span><b>" + a + ' <span class="' + (d >= 0 ? "gold2" : "warn") + '">' + (d >= 0 ? "+" : "") + d + "</span></b></div>"; }
  };
  actions.addWeight = () => sheet('<h2>Log weight</h2><div class="grid2"><label class="field">Weight (kg)<input id="wKg" type="number" inputmode="decimal" step="0.1" value="' + (B.weight() || "") + '"></label><label class="field">Waist (cm, optional)<input id="wWaist" type="number" inputmode="decimal"></label></div><button class="btn block" data-a="saveWeight">Save</button>');
  actions.saveWeight = () => {
    const kg = +document.getElementById("wKg").value; if (!kg) return toast("Enter your weight");
    const waist = +document.getElementById("wWaist").value || undefined;
    const k = H.dkey(); const list = st().weights.filter((x) => x.d !== k); list.push({ d: k, kg, waist });
    list.sort((a, b) => (a.d < b.d ? -1 : 1)); st().weights = list; st().profile.weightKg = kg; S.save(); closeSheet(); refresh(); toast("Saved " + kg + " kg");
  };
})();
