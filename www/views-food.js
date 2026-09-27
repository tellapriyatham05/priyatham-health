/* Meals: weekly planner, prep countdown, recipes, food log (calories + protein), water. */
(function () {
  const { H, S, B, T, Prep, MEALS } = PH;
  const { I, ring, toast, sheet, closeSheet, header, routes, actions, changes, go, refresh, seg } = UI;
  const st = () => S.state;
  const cap = (s) => s[0].toUpperCase() + s.slice(1);

  // ------------------------------------------------ weekly planner
  routes.meals = (arg) => {
    const s = st(), today = H.dkey();
    const which = arg === "next" ? "next" : "this";
    const mon = H.addDays(H.monday(today), which === "next" ? 7 : 0);
    const days = [...Array(7)].map((_, i) => H.addDays(mon, i));
    let planned = 0, prepCount = 0, protein = 0, pDays = 0;
    const rows = days.map((k) => {
      const day = s.plan[k] || {}; let dp = 0, has = false;
      const cells = MEALS.map((m) => {
        const c = day[m];
        if (!c) return '<button class="c empty" data-a="cell" data-x="' + k + "|" + m + '">+ add</button>';
        planned++; has = true;
        const r = c.r ? Prep.recipe(c.r) : null;
        if (r && r.steps && r.steps.length) prepCount++;
        if (r) dp += H.sum(r.foods, ([fid, q]) => ((s.foods.find((f) => f.id === fid) || {}).protein || 0) * q);
        return '<button class="c" data-a="cell" data-x="' + k + "|" + m + '">' + (r && r.steps && r.steps.length ? '<span class="pd"></span>' : "") + H.esc(r ? r.name : c.t) + "</button>";
      }).join("");
      if (has) { protein += dp; pDays++; }
      return '<div class="r"><div class="d ' + (k === today ? "today" : "") + '">' + H.dayName(k) + '<span class="tiny dim" style="font-weight:600">' + H.fromKey(k).getDate() + "</span></div>" + cells + "</div>";
    }).join("");
    return {
      nav: "meals",
      html: '<div class="page"><div class="rise row between" style="align-items:flex-end"><div><div class="eyebrow m">Week of ' + H.fromKey(mon).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) + '</div><h1 style="margin-top:4px">Meal plan</h1></div>' +
        '<a class="chip" href="#/recipes">' + I("list", 16) + " Recipes</a></div>" +
        '<div class="rise">' + seg([["this", "This week"], ["next", "Next week"]], which, "weekSwitch") + "</div>" +
        '<div class="rise card gold row small" style="line-height:1.45">' + I("clock", 20) + "<div><b>" + planned + " of 21 meals planned</b> · " + prepCount + " need prep. Prep alarms are set automatically and ring until you tick them.</div></div>" +
        '<div class="rise week"><div class="r tiny b dim" style="letter-spacing:.1em"><div></div><div>BREAKFAST</div><div>LUNCH</div><div>DINNER</div></div>' + rows + "</div>" +
        '<div class="rise row small muted wrap" style="gap:14px"><span><span class="pd" style="display:inline-block;width:6px;height:6px;border-radius:3px;background:#C9A45C;margin-right:5px"></span>needs prep</span>' + (pDays ? "<span>~" + Math.round(protein / pDays) + " g protein / day from plan</span>" : "") + "</div>" +
        '<div class="rise grid2"><a class="btn ghost sm" href="#/prep">' + I("clock", 16) + ' Prep tasks</a><button class="btn ghost sm" data-a="shopping" data-x="' + mon + '">' + I("list", 16) + " Shopping list</button></div>" +
        '<button class="rise btn ghost sm block" data-a="copyWeek" data-x="' + mon + '">Copy previous week into this one</button></div>',
    };
  };
  actions.weekSwitch = (v) => go(v === "next" ? "meals/next" : "meals");
  actions.cell = (x) => {
    const [k, m] = x.split("|");
    const cur = (st().plan[k] || {})[m];
    const list = st().recipes.map((r) => '<button class="chip ' + (cur && cur.r === r.id ? "on" : "") + '" style="height:auto;min-height:40px;padding:8px 12px;text-align:left" data-a="pick" data-x="' + k + "|" + m + "|" + r.id + '">' + (r.steps.length ? '<span class="gold">●</span>' : "") + H.esc(r.name) + "</button>").join("");
    sheet('<div class="eyebrow m">' + H.dateLabel(k) + "</div><h2>" + cap(m) + " at " + H.hmLabel(st().mealTimes[m]) + "</h2>" +
      '<input id="recSearch" placeholder="Search recipes" data-c="recSearch">' +
      '<div class="row wrap" id="recList" style="gap:6px">' + list + "</div>" +
      '<div class="divider"></div><div class="small muted">Or type something else (eat out, leftovers…)</div><div class="row"><input id="customMeal" placeholder="e.g. Eat out" value="' + H.esc(cur && cur.t ? cur.t : "") + '"><button class="btn sm" data-a="pickText" data-x="' + k + "|" + m + '">Save</button></div>' +
      (cur ? '<button class="btn danger block" data-a="pickClear" data-x="' + k + "|" + m + '">Remove this meal</button>' : "") +
      '<a class="small gold b center" href="#/recipes" style="padding:6px">+ Create a new recipe with prep steps</a>');
  };
  changes.recSearch = (v) => {
    document.querySelectorAll("#recList .chip").forEach((c) => { c.style.display = c.textContent.toLowerCase().includes(v.toLowerCase()) ? "" : "none"; });
  };
  function setCell(k, m, val) {
    const p = st().plan; p[k] = p[k] || {};
    if (val) p[k][m] = val; else delete p[k][m];
    Object.keys(st().prepDone).forEach((key) => { if (key.startsWith("prep:" + k + ":" + m + ":")) delete st().prepDone[key]; });
    S.save(); Prep.sync(); closeSheet(); refresh();
  }
  actions.pick = (x) => {
    const [k, m, r] = x.split("|"); setCell(k, m, { r });
    const rec = Prep.recipe(r);
    if (rec && rec.steps.length) {
      const first = Prep.stepsFor(k, m, rec)[0];
      toast(first.label + " · " + H.dayName(H.dkey(first.planned)) + " " + H.time(first.planned));
    }
  };
  actions.pickText = (x) => { const [k, m] = x.split("|"); const t = document.getElementById("customMeal").value.trim(); if (t) setCell(k, m, { t }); };
  actions.pickClear = (x) => { const [k, m] = x.split("|"); setCell(k, m, null); };
  actions.copyWeek = (mon) => {
    let n = 0;
    for (let i = 0; i < 7; i++) {
      const from = H.addDays(mon, i - 7), to = H.addDays(mon, i);
      if (st().plan[from]) { st().plan[to] = JSON.parse(JSON.stringify(st().plan[from])); n++; }
    }
    if (!n) return toast("Nothing planned last week");
    S.save(); Prep.sync(); refresh(); toast("Copied " + n + " days");
  };
  actions.shopping = (mon) => {
    const count = {};
    for (let i = 0; i < 7; i++) {
      const day = st().plan[H.addDays(mon, i)] || {};
      MEALS.forEach((m) => { const c = day[m]; const r = c && c.r && Prep.recipe(c.r); if (r) (r.ingredients || []).forEach((g) => { count[g] = (count[g] || 0) + 1; }); });
    }
    const items = Object.entries(count).sort((a, b) => b[1] - a[1]);
    sheet("<h2>Shopping list</h2>" + (items.length ? '<div class="card tight list">' + items.map(([g, n]) => '<label class="row"><input type="checkbox" style="width:22px;min-height:22px;accent-color:#C9A45C"><span class="grow">' + H.esc(g) + '</span><span class="small muted">' + n + " meal" + (n > 1 ? "s" : "") + "</span></label>").join("") + "</div>" : '<p class="muted">Plan some meals first.</p>'));
  };

  // ------------------------------------------------ prep countdown
  routes.prep = () => {
    const tasks = Prep.upcoming(8);
    const active = tasks.find((t) => ["now", "next"].includes(Prep.status(t)));
    const now = Date.now();
    let hero = '<div class="rise card center muted">No prep needed right now. Plan meals like dosa, idli or biryani and prep steps appear here.</div>';
    if (active) {
      const left = active.deadline - now, span = active.deadline - active.planned + 1;
      const pct = H.clamp(1 - left / Math.max(span, 1), 0, 1);
      const group = tasks.filter((t) => t.dateKey === active.dateKey && t.meal === active.meal);
      const lastWait = group[group.length - 1];
      hero = '<div class="rise card col center" style="align-items:center;gap:10px"><div class="eyebrow">' + (now < active.planned ? "Starts at " + H.time(active.planned) : "Time left for this step") + "</div>" +
        '<div class="display" style="font-size:52px;font-weight:700;line-height:1">' + (now < active.planned ? H.dur(active.planned - now) : H.dur(left)) + "</div>" +
        '<div class="b" style="font-size:18px">' + H.esc(active.label) + "</div>" +
        '<div class="bar" style="width:100%"><i style="width:' + Math.round(pct * 100) + '%;animation:blink 2s ease-in-out infinite"></i></div>' +
        '<div class="small muted">Final call <b style="color:#F5F3EE">' + H.time(active.deadline) + "</b>, or " + H.esc(active.recipe.toLowerCase()) + " won't be ready for " + H.dayName(active.dateKey, true) + " " + active.meal + ".</div>" +
        '<button class="btn block" data-a="prepDone" data-x="' + active.key + '">' + I("check", 20, 2.6) + " Mark as done</button></div>" +
        '<div class="rise card col" style="gap:12px"><div class="row between"><h2>' + H.esc(active.recipe) + '</h2><span class="small muted">' + H.dayName(active.dateKey) + " " + active.meal + " " + H.time(lastWait.mealAt) + "</span></div>" +
        group.map((t, n) => step(t, n + 1)).join('<div style="width:2px;height:10px;background:#2A2A2E;margin-left:17px"></div>') +
        step({ label: "Eat! " + active.recipe, planned: lastWait.mealAt, deadline: lastWait.mealAt, wait: 0, key: "" }, group.length + 1, true) + "</div>" +
        '<div class="rise row wrap small" style="gap:6px;color:#A3A09A"><span class="chip" style="height:30px">' + H.time(active.planned) + ' ring</span>→<span class="chip" style="height:30px">every 15 min</span>→<span class="chip" style="height:30px;background:#3A1E17;color:#F2A58E;border-color:#5A2E22">' + H.time(active.deadline) + " final call</span></div>";
    }
    const later = tasks.filter((t) => t !== active && Prep.status(t) !== "done" && t.deadline > now).slice(0, 8);
    const missed = tasks.filter((t) => Prep.status(t) === "missed" && now - t.deadline < 12 * 3600e3);
    return {
      nav: "meals",
      html: '<div class="page">' + header("Prep tasks", "meals") + hero +
        (missed.length ? '<div class="rise card warn col"><b>Missed</b>' + missed.map((t) => '<div class="row between small"><span>' + H.esc(t.label) + " · " + H.dayName(t.dateKey) + " " + t.meal + '</span><button class="btn sm ghost" data-a="cell" data-x="' + t.dateKey + "|" + t.meal + '">Change meal</button></div>').join("") + "</div>" : "") +
        (later.length ? '<h2 class="rise">Coming up</h2><div class="rise card tight list">' + later.map((t) => '<div class="row"><div class="grow"><div class="b small">' + H.esc(t.label) + '</div><div class="tiny muted">' + H.dayName(H.dkey(t.planned)) + " " + H.time(t.planned) + " · final " + H.time(t.deadline) + " · " + H.esc(t.recipe) + '</div></div><button class="btn sm ghost" data-a="prepDone" data-x="' + t.key + '">Done</button></div>').join("") + "</div>" : "") +
        '<p class="rise small muted" style="margin:0;line-height:1.5">Times count back from your meal times, and any step that would land while you sleep (' + H.hmLabel(st().profile.sleep) + "–" + H.hmLabel(st().profile.wake) + ") moves to before bed.</p></div>",
      mount() { const iv = setInterval(refresh, 30000); return () => clearInterval(iv); },
    };
    function step(t, n, last) {
      const s = last ? "next" : Prep.status(t);
      const badge = s === "done" ? '<span style="width:34px;height:34px;border-radius:17px;background:#2A2A2E;display:flex;align-items:center;justify-content:center;flex-shrink:0" class="gold">' + I("check", 16, 3) + "</span>"
        : s === "now" ? '<span style="position:relative;width:36px;height:36px;flex-shrink:0"><span style="position:absolute;inset:0;border-radius:18px;background:#C9A45C;animation:pulse 1.8s ease-out infinite"></span><span style="position:relative;width:36px;height:36px;border-radius:18px;background:#C9A45C;color:#0A0A0B;display:flex;align-items:center;justify-content:center;font-weight:800">' + n + "</span></span>"
        : '<span style="width:34px;height:34px;border-radius:17px;border:2px solid #3A3A3F;color:#A3A09A;display:flex;align-items:center;justify-content:center;font-weight:800;flex-shrink:0">' + n + "</span>";
      return '<div class="row top">' + badge + '<div class="grow" style="padding-top:4px"><div class="row between"><span class="b" style="' + (s === "done" ? "color:#77746F;text-decoration:line-through" : "") + '">' + H.esc(t.label) + '</span><span class="small b gold">' + (t.wait ? (t.wait >= 60 ? H.round(t.wait / 60, 1) + " h" : t.wait + " min") : "") + "</span></div>" +
        '<div class="small muted">' + H.dayName(H.dkey(t.planned)) + " " + H.time(t.planned) + (last ? "" : " · final " + H.time(t.deadline)) + "</div></div></div>";
    }
  };
  actions.prepDone = async (key) => {
    st().prepDone[key] = Date.now(); S.save();
    await N.cancel([H.hash(key)]); await PH.Prep.sync();
    N.vibrate(40); toast("Done. Next step is scheduled"); refresh();
  };

  // ------------------------------------------------ recipes
  routes.recipes = () => ({
    nav: "meals",
    html: '<div class="page">' + header("Recipes", "meals", '<button class="chip add" data-a="editRecipe" data-x="">+ New</button>') +
      '<p class="rise small muted" style="margin:0">Add prep steps (soak, grind, marinate…) with how long each needs. The app times the alarms for you.</p>' +
      '<div class="rise card tight list">' + st().recipes.map((r) => {
        const k = H.sum(r.foods, ([f, q]) => ((st().foods.find((x) => x.id === f) || {}).kcal || 0) * q), p = H.sum(r.foods, ([f, q]) => ((st().foods.find((x) => x.id === f) || {}).protein || 0) * q);
        return '<button class="row" style="width:100%;background:none;border:0;text-align:left" data-a="editRecipe" data-x="' + r.id + '"><div class="grow"><div class="b">' + H.esc(r.name) + '</div><div class="tiny muted">' + Math.round(k) + " kcal · " + Math.round(p) + " g protein" + (r.steps.length ? " · " + r.steps.map((s) => s.label.split(" (")[0]).join(" → ") : "") + "</div></div>" + I("next", 18) + "</button>";
      }).join("") + "</div></div>",
  });
  let rd = null;
  actions.editRecipe = (id) => {
    const r = st().recipes.find((x) => x.id === id);
    rd = r ? JSON.parse(JSON.stringify(r)) : { id: "rc_" + H.uid(), name: "", foods: [], steps: [], ingredients: [], isNew: true };
    renderRecipe();
  };
  function renderRecipe() {
    const foods = st().foods;
    sheet("<h2>" + (rd.isNew ? "New recipe" : "Edit recipe") + '</h2><label class="field">Name<input data-c="rdName" value="' + H.esc(rd.name) + '" placeholder="e.g. Dosa & chutney"></label>' +
      '<div class="eyebrow m">What one serving contains</div>' +
      rd.foods.map(([f, q], i) => '<div class="row"><select class="grow" data-c="rdFood" data-x="' + i + '">' + foods.map((x) => '<option value="' + x.id + '" ' + (x.id === f ? "selected" : "") + ">" + H.esc(x.name) + " (" + x.serving + ")</option>").join("") + '</select><input type="number" inputmode="decimal" style="width:74px" data-c="rdQty" data-x="' + i + '" value="' + q + '"><button class="iconbtn" data-a="rdFoodDel" data-x="' + i + '" aria-label="Remove">' + I("trash", 16) + "</button></div>").join("") +
      '<button class="btn ghost sm" data-a="rdFoodAdd">+ Add food</button>' +
      '<div class="eyebrow m">Prep steps, in order</div><p class="small muted" style="margin:0">"Wait" is how long must pass after this step before the next step (or eating). Dosa: soak → wait 6 h → grind → wait 6 h.</p>' +
      rd.steps.map((s, i) => '<div class="card tight col" style="gap:8px"><div class="row"><input class="grow" data-c="rdStep" data-x="' + i + '" value="' + H.esc(s.label) + '" placeholder="e.g. Soak rice & urad dal"><button class="iconbtn" data-a="rdStepDel" data-x="' + i + '" aria-label="Remove">' + I("trash", 16) + "</button></div>" +
        '<div class="grid2"><label class="field">Wait hours<input type="number" inputmode="numeric" data-c="rdWaitH" data-x="' + i + '" value="' + Math.floor(s.wait / 60) + '"></label><label class="field">+ minutes<input type="number" inputmode="numeric" data-c="rdWaitM" data-x="' + i + '" value="' + (s.wait % 60) + '"></label></div></div>').join("") +
      '<button class="btn ghost sm" data-a="rdStepAdd">+ Add prep step</button>' +
      '<label class="field">Ingredients (for the shopping list, comma separated)<input data-c="rdIng" value="' + H.esc((rd.ingredients || []).join(", ")) + '"></label>' +
      '<button class="btn block" data-a="rdSave">Save recipe</button>' + (rd.isNew ? "" : '<button class="btn danger block" data-a="rdDelete">Delete recipe</button>'));
  }
  changes.rdName = (v) => { rd.name = v; };
  changes.rdFood = (v, el) => { rd.foods[+el.dataset.x][0] = v; };
  changes.rdQty = (v, el) => { rd.foods[+el.dataset.x][1] = Math.max(0.25, +v || 1); };
  changes.rdStep = (v, el) => { rd.steps[+el.dataset.x].label = v; };
  changes.rdWaitH = (v, el) => { const s = rd.steps[+el.dataset.x]; s.wait = Math.max(0, +v || 0) * 60 + (s.wait % 60); };
  changes.rdWaitM = (v, el) => { const s = rd.steps[+el.dataset.x]; s.wait = Math.floor(s.wait / 60) * 60 + Math.max(0, Math.min(59, +v || 0)); };
  changes.rdIng = (v) => { rd.ingredients = v.split(",").map((x) => x.trim()).filter(Boolean); };
  actions.rdFoodAdd = () => { rd.foods.push([st().foods[0].id, 1]); renderRecipe(); };
  actions.rdFoodDel = (i) => { rd.foods.splice(+i, 1); renderRecipe(); };
  actions.rdStepAdd = () => { rd.steps.push({ label: "", wait: 60 }); renderRecipe(); };
  actions.rdStepDel = (i) => { rd.steps.splice(+i, 1); renderRecipe(); };
  actions.rdSave = () => {
    document.querySelectorAll(".sheet [data-c]").forEach((el) => changes[el.dataset.c] && changes[el.dataset.c](el.value, el));
    if (!rd.name.trim()) return toast("Give it a name");
    rd.steps = rd.steps.filter((s) => s.label.trim());
    delete rd.isNew;
    const i = st().recipes.findIndex((x) => x.id === rd.id);
    if (i >= 0) st().recipes[i] = rd; else st().recipes.push(rd);
    S.save(); Prep.sync(); closeSheet(); refresh(); toast("Recipe saved");
  };
  actions.rdDelete = () => { st().recipes = st().recipes.filter((x) => x.id !== rd.id); S.save(); Prep.sync(); closeSheet(); refresh(); };

  // ------------------------------------------------ food log
  routes.food = () => {
    const s = st(), k = H.dkey(), f = T.food(k), kt = B.kcalTarget(), pt = B.proteinTarget();
    const day = s.plan[k] || {};
    const sections = [...MEALS, "snack"].map((m) => {
      const items = f.items.filter((x) => x.meal === m);
      const plan = day[m] && day[m].r ? Prep.recipe(day[m].r) : null;
      const body = items.map((x) => '<div class="row"><div class="grow"><div class="b small">' + H.esc(x.name) + '</div><div class="tiny muted">' + x.qty + " × " + H.esc(x.serving || "") + '</div></div><div style="text-align:right"><div class="b small">' + Math.round(x.kcal) + ' kcal</div><div class="tiny gold2">' + H.round(x.protein, 1) + ' g</div></div><button class="iconbtn" style="width:36px;height:36px" data-a="foodDel" data-x="' + x.id + '" aria-label="Remove">' + I("trash", 15) + "</button></div>").join("");
      const planned = !items.length && plan ? '<div class="row" style="border:1px dashed #3A3A3F;border-radius:14px;padding:10px 12px"><div class="grow"><div class="b small">' + H.esc(plan.name) + '</div><div class="tiny muted">planned · ~' + Math.round(recipeTotals(plan).kcal) + " kcal · " + Math.round(recipeTotals(plan).protein) + ' g</div></div><button class="btn sm" data-a="confirmPlan" data-x="' + m + "|" + plan.id + '">Ate it</button></div>' : "";
      return '<div class="card tight col" style="gap:10px"><div class="row between"><span class="tiny b dim" style="letter-spacing:.1em">' + m.toUpperCase() + '</span><button class="chip" style="height:30px;font-size:12px" data-a="addFood" data-x="' + m + '">+ Add</button></div>' + (body || planned || '<div class="tiny dim">Nothing yet</div>') + "</div>";
    }).join("");
    const gap = pt - f.protein;
    return {
      nav: "meals",
      html: '<div class="page">' + header("Food", "meals") +
        '<div class="rise card row" style="justify-content:space-around">' +
        ring(f.kcal / kt, 128, 10, "#F5F3EE", '<div class="display" style="font-size:22px;font-weight:700">' + Math.round(f.kcal).toLocaleString("en-IN") + '</div><div class="tiny muted">of ' + kt + " kcal</div>") +
        ring(f.protein / pt, 128, 10, "#C9A45C", '<div class="display gold2" style="font-size:22px;font-weight:700">' + Math.round(f.protein) + ' g</div><div class="tiny muted">of ' + pt + " g protein</div>") + "</div>" +
        (gap > 15 && new Date().getHours() >= 15 ? '<div class="rise card gold row top small">' + I("spark", 18) + "<div>You're " + Math.round(gap) + " g short on protein. Try <b>" + (gap > 25 ? "150 g chicken" : "2 boiled eggs") + "</b> or <b>a cup of curd</b>.</div></div>" : "") +
        '<div class="rise col" style="gap:10px">' + sections + "</div>" +
        '<div class="rise row wrap" style="gap:6px">' + ["egg", "chicken_grill", "curd", "banana", "tea"].map((id) => { const x = s.foods.find((y) => y.id === id); return x ? '<button class="chip" data-a="quickFood" data-x="' + id + '">+ ' + H.esc(x.name) + "</button>" : ""; }).join("") + "</div>" +
        '<p class="small dim" style="margin:0">Targets: ' + kt + " kcal (a gentle deficit for steady weight loss) and " + pt + " g protein. Values are home-cooking estimates. Edit any food to match your portions.</p></div>",
    };
  };
  function recipeTotals(r) {
    let kcal = 0, protein = 0;
    r.foods.forEach(([fid, q]) => { const x = st().foods.find((y) => y.id === fid); if (x) { kcal += x.kcal * q; protein += x.protein * q; } });
    return { kcal, protein };
  }
  function logFood(meal, food, qty) {
    const k = H.dkey(); const list = (st().food[k] = st().food[k] || []);
    list.push({ id: H.uid(), meal, fid: food.id, name: food.name, serving: food.serving, qty, kcal: food.kcal * qty, protein: food.protein * qty, t: Date.now() });
    S.save();
  }
  function autoMeal() { const h = new Date().getHours(); return h < 11 ? "breakfast" : h < 16 ? "lunch" : h < 18 ? "snack" : "dinner"; }
  actions.confirmPlan = (x) => {
    const [m, rid] = x.split("|"); const r = Prep.recipe(rid);
    r.foods.forEach(([fid, q]) => { const f = st().foods.find((y) => y.id === fid); if (f) logFood(m, f, q); });
    toast(r.name + " logged"); refresh();
  };
  actions.quickFood = (id) => { const f = st().foods.find((y) => y.id === id); logFood(autoMeal(), f, 1); toast("+ " + f.name); refresh(); };
  actions.foodDel = (id) => { const k = H.dkey(); st().food[k] = (st().food[k] || []).filter((x) => x.id !== id); S.save(); refresh(); };
  let fq = { meal: "breakfast", qty: 1 };
  actions.addFood = (meal) => {
    fq = { meal: meal || autoMeal(), qty: 1 };
    sheet('<h2>Add food</h2>' + seg([["breakfast", "Bfast"], ["lunch", "Lunch"], ["dinner", "Dinner"], ["snack", "Snack"]], fq.meal, "fqMeal") +
      '<div class="row"><span class="small muted grow">Quantity (servings)</span><button class="iconbtn" data-a="fqQty" data-x="-0.5">−</button><span class="b" id="fqQty" style="min-width:36px;text-align:center">1</span><button class="iconbtn" data-a="fqQty" data-x="0.5">+</button></div>' +
      '<input placeholder="Search: dosa, chicken, egg…" data-c="foodSearch">' +
      '<div class="card tight list" id="foodList">' + st().foods.map((x) => '<button class="row" style="width:100%;background:none;border:0;text-align:left" data-a="pickFood" data-x="' + x.id + '"><div class="grow"><div class="b small">' + H.esc(x.name) + '</div><div class="tiny muted">' + H.esc(x.serving) + '</div></div><div style="text-align:right"><div class="small b">' + x.kcal + ' kcal</div><div class="tiny gold2">' + x.protein + " g</div></div></button>").join("") + "</div>" +
      '<button class="btn ghost block" data-a="newFood">+ Create a food</button>');
  };
  actions.fqMeal = (m) => { fq.meal = m; document.querySelectorAll(".sheet .seg button").forEach((b) => b.classList.toggle("on", b.dataset.x === m)); };
  actions.fqQty = (d) => { fq.qty = Math.max(0.5, fq.qty + +d); document.getElementById("fqQty").textContent = fq.qty; };
  changes.foodSearch = (v) => { document.querySelectorAll("#foodList > button").forEach((b) => { b.style.display = b.textContent.toLowerCase().includes(v.toLowerCase()) ? "" : "none"; }); };
  actions.pickFood = (id) => { const f = st().foods.find((y) => y.id === id); logFood(fq.meal, f, fq.qty); closeSheet(); toast(fq.qty + " × " + f.name + " added"); refresh(); };
  actions.newFood = () => sheet('<h2>Create a food</h2><label class="field">Name<input id="nfName" placeholder="e.g. Chicken 65"></label><label class="field">Serving<input id="nfServ" placeholder="e.g. 100 g, 1 bowl"></label>' +
    '<div class="grid2"><label class="field">Calories (kcal)<input id="nfK" type="number" inputmode="decimal"></label><label class="field">Protein (g)<input id="nfP" type="number" inputmode="decimal"></label></div><button class="btn block" data-a="saveNewFood">Save food</button>');
  actions.saveNewFood = () => {
    const name = document.getElementById("nfName").value.trim(); if (!name) return toast("Name it first");
    st().foods.push({ id: "f_" + H.uid(), name, serving: document.getElementById("nfServ").value.trim() || "1 serving", kcal: +document.getElementById("nfK").value || 0, protein: +document.getElementById("nfP").value || 0 });
    S.save(); actions.addFood(fq.meal);
  };

  // ------------------------------------------------ water
  PH.addWater = (ml) => {
    const k = H.dkey(); (st().water[k] = st().water[k] || []).push({ t: Date.now(), ml }); S.save(); N.markEvent("water");
  };
  routes.water = () => {
    const k = H.dkey(), w = T.water(k), g = B.waterGoal(k), pct = H.clamp(w / g, 0, 1);
    const log = (st().water[k] || []).slice().reverse();
    const wave = pct < 0.02 ? "" : '<svg width="560" height="30" viewBox="0 0 560 30" style="position:absolute;left:0;bottom:calc(' + (pct * 100) + '% - 2px);animation:wave 3.5s linear infinite" aria-hidden="true"><path d="M0 15 Q 35 0 70 15 T 140 15 T 210 15 T 280 15 T 350 15 T 420 15 T 490 15 T 560 15 V30 H0Z" fill="#F5F3EE"/></svg>' +
      '<svg width="560" height="30" viewBox="0 0 560 30" style="position:absolute;left:0;bottom:calc(' + (pct * 100) + '% + 2px);animation:wave 6s linear infinite reverse;opacity:.35" aria-hidden="true"><path d="M0 15 Q 35 0 70 15 T 140 15 T 210 15 T 280 15 T 350 15 T 420 15 T 490 15 T 560 15 V30 H0Z" fill="#C9A45C"/></svg>';
    const extra = g > Math.round((B.weight() || 70) * 33 / 50) * 50;
    return {
      nav: "today",
      html: '<div class="page">' + header("Water") +
        '<div class="rise row" style="gap:22px"><div style="position:relative;width:140px;height:240px;border-radius:70px;border:2px solid #2E2E32;overflow:hidden;background:#111113;flex-shrink:0">' +
        '<div style="position:absolute;left:0;right:0;bottom:0;height:' + pct * 100 + '%;background:#F5F3EE;transition:height .6s"></div>' + wave +
        '<div style="position:absolute;left:0;right:0;bottom:16px;text-align:center;color:' + (pct > 0.1 ? "#0A0A0B" : "#A3A09A") + ';font-weight:800;font-size:13px">' + Math.round(pct * 100) + "%</div></div>" +
        '<div class="col"><div class="display" style="font-size:44px;font-weight:700;line-height:1">' + H.round(w / 1000, 2) + '<span class="muted" style="font-size:20px"> L</span></div><div class="muted">of your ' + H.round(g / 1000, 1) + " L goal</div>" +
        (extra ? '<div class="small gold2" style="padding:8px 10px;border-radius:10px;background:var(--goldbg)">+500 ml added for today\'s workout</div>' : '<div class="small muted">Based on ' + (B.weight() || "your") + " kg × 33 ml</div>") + "</div></div>" +
        '<div class="rise grid4">' + [[150, "glass"], [250, "cup"], [500, "bottle"], [750, "large"]].map(([ml, l], i) => '<button class="card tight col center" style="gap:2px;align-items:center;' + (i === 1 ? "background:#C9A45C;color:#0A0A0B;border:0" : "") + '" data-a="addWater" data-x="' + ml + '"><span class="b" style="font-size:18px">' + ml + '</span><span class="tiny" style="opacity:.75">' + l + "</span></button>").join("") + "</div>" +
        (log.length ? '<div class="rise card tight list">' + log.map((x, i) => '<div class="row between small"><span class="muted">' + H.time(x.t) + '</span><span class="row"><b>' + x.ml + ' ml</b><button class="iconbtn" style="width:34px;height:34px" data-a="waterDel" data-x="' + (log.length - 1 - i) + '" aria-label="Remove">' + I("trash", 14) + "</button></span></div>").join("") + "</div>" : "") +
        '<p class="rise small muted center" style="margin:0">Water nudges come every ' + st().reminders.water.every + " min while you're awake, and skip if you drank in the last 45 min.</p></div>",
    };
  };
  actions.addWater = (ml) => { PH.addWater(+ml); N.vibrate(30); toast("+" + ml + " ml"); refresh(); };
  actions.waterDel = (i) => { const k = H.dkey(); st().water[k].splice(+i, 1); S.save(); refresh(); };
})();
