/* Shared UI pieces: icons, rings, sheets, toasts, nav, router. */
(function () {
  const { H } = PH;

  const P = {
    today: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    move: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    meals: '<path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M17 3c-2 0-3 2-3 5v5h3v8"/>',
    insights: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    next: '<path d="M9 5l7 7-7 7"/>',
    bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    drop: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
    scale: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M8 10a4 4 0 0 1 8 0"/><path d="M12 10l1.5-2"/>',
    bike: '<circle cx="5.5" cy="17" r="3.5"/><circle cx="18.5" cy="17" r="3.5"/><path d="M5.5 17l4-8h6l3 8M9.5 9L8 6H6M15.5 9l-3 8"/>',
    play: '<path d="M7 4l13 8-13 8z" fill="currentColor"/>',
    pause: '<rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/>',
    skip: '<path d="M16 5h2v14h-2zM4 5v14l11-7z" fill="currentColor"/>',
    prev: '<path d="M6 5h2v14H6zM20 5v14L9 12z" fill="currentColor"/>',
    check: '<path d="M5 12l5 5 9-10"/>',
    spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    laptop: '<rect x="4" y="5" width="16" height="11" rx="2"/><path d="M2 19h20"/>',
    phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
    shield: '<path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z"/><path d="M9 12l2 2 4-4"/>',
    sound: '<path d="M11 5L6 9H3v6h3l5 4z"/><path d="M16 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12"/>',
    vib: '<rect x="8" y="3" width="8" height="18" rx="2"/><path d="M4 8v8M20 8v8"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.9-3.9M4 4v4h4M4 13a8 8 0 0 0 14.9 3.9M20 20v-4h-4"/>',
    body: '<circle cx="12" cy="4.5" r="2"/><path d="M12 7v7M8 10h8M9 21l3-7 3 7"/>',
    food: '<path d="M4 11h16a8 8 0 0 1-16 0zM8 7c0-2 2-2 2-4M12 7c0-2 2-2 2-4"/>',
  };
  function I(name, size = 22, sw = 1.8) {
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + sw +
      '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (P[name] || "") + "</svg>";
  }

  function ring(pct, size, stroke, color, inner, track) {
    const r = 50 - stroke / 2 - 1, c = 2 * Math.PI * r, off = c * (1 - H.clamp(pct, 0, 1));
    return '<div class="ringwrap" style="width:' + size + 'px;height:' + size + 'px"><svg width="' + size + '" height="' + size +
      '" viewBox="0 0 100 100"><circle cx="50" cy="50" r="' + r + '" fill="none" stroke="' + (track || "#232326") + '" stroke-width="' + stroke +
      '"/><circle class="ring-anim" cx="50" cy="50" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="' + stroke +
      '" stroke-linecap="round" stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '" transform="rotate(-90 50 50)" style="--c:' +
      c.toFixed(1) + '"/></svg><div class="in">' + inner + "</div></div>";
  }

  function toast(msg) {
    document.querySelectorAll(".toast").forEach((t) => t.remove());
    const t = document.createElement("div");
    t.className = "toast"; t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }

  let sheetOpen = null;
  function sheet(html, onMount) {
    closeSheet();
    const scrim = document.createElement("div"); scrim.className = "scrim";
    const el = document.createElement("div"); el.className = "sheet"; el.innerHTML = '<div class="grab"></div>' + html;
    scrim.addEventListener("click", closeSheet);
    document.body.appendChild(scrim); document.body.appendChild(el);
    sheetOpen = { scrim, el };
    el.addEventListener("click", onClick);
    el.addEventListener("change", onChange);
    if (onMount) onMount(el);
    return el;
  }
  function closeSheet() {
    if (!sheetOpen) return false;
    sheetOpen.scrim.remove(); sheetOpen.el.remove(); sheetOpen = null; return true;
  }

  function header(title, back, right) {
    return '<div class="row rise">' + (back !== false ? '<a class="iconbtn" href="#/' + (back || "today") + '" aria-label="Back">' + I("back", 20, 2) + "</a>" : "") +
      '<h1 class="grow" style="font-size:24px">' + title + "</h1>" + (right || "") + "</div>";
  }

  function nav(active) {
    const item = (k, route, label) => '<a href="#/' + route + '" class="' + (active === k ? "on" : "") + '">' + I(k) + label + '<span class="dot"></span></a>';
    return '<nav class="tabs" aria-label="Main">' + item("today", "today", "Today") + item("move", "move", "Move") +
      '<button class="plus" data-a="quick" aria-label="Quick log">' + I("plus", 26, 2.4) + "</button>" +
      item("meals", "meals", "Meals") + item("insights", "insights", "Insights") + "</nav>";
  }

  // --------------- router + event delegation ---------------
  const routes = {};
  const actions = {};
  const changes = {};
  let cleanup = null;

  function current() {
    const h = (location.hash || "#/today").slice(2).split("/");
    return { name: h[0] || "today", arg: h.slice(1).join("/") };
  }
  function go(path) { if (location.hash === "#/" + path) render(); else location.hash = "#/" + path; }

  function resolve() {
    const { name, arg } = current();
    let r = routes[name] ? name : "today";
    if (!PH.S.state.profile.onboarded && r !== "welcome") r = "welcome";
    return { r, arg };
  }
  function draw(scrollY) {
    if (cleanup) { try { cleanup(); } catch (e) {} cleanup = null; }
    const { r, arg } = resolve();
    const out = routes[r](arg) || {};
    document.getElementById("app").innerHTML = (out.html || "") + (out.nav ? nav(out.nav) : "");
    window.scrollTo(0, scrollY);
    if (out.mount) cleanup = out.mount(document.getElementById("app")) || null;
  }
  function render() { draw(0); }
  function refresh() { draw(window.scrollY); }

  function onClick(e) {
    const t = e.target.closest("[data-a]");
    if (!t) return;
    const fn = actions[t.dataset.a];
    if (fn) { e.preventDefault(); fn(t.dataset.x, t, e); }
  }
  function onChange(e) {
    const t = e.target.closest("[data-c]");
    if (!t) return;
    const fn = changes[t.dataset.c];
    if (fn) fn(t.value, t, e);
  }
  document.addEventListener("click", (e) => { if (!e.target.closest(".sheet")) onClick(e); });
  document.addEventListener("change", (e) => { if (!e.target.closest(".sheet")) onChange(e); });
  window.addEventListener("hashchange", () => { closeSheet(); render(); });

  function seg(options, value, act, extra) {
    return '<div class="seg" role="group">' + options.map(([v, l]) => '<button class="' + (v === value ? "on" : "") + '" data-a="' + act + '" data-x="' +
      H.esc((extra ? extra + "|" : "") + v) + '">' + l + "</button>").join("") + "</div>";
  }
  function sw(on, act, x, label) {
    return '<button class="switch ' + (on ? "on" : "") + '" role="switch" aria-checked="' + !!on + '" aria-label="' + H.esc(label || "") + '" data-a="' + act + '" data-x="' + H.esc(x || "") + '"></button>';
  }

  window.UI = { I, ring, toast, sheet, closeSheet, header, nav, routes, actions, changes, render, refresh, go, current, seg, sw, isSheetOpen: () => !!sheetOpen };
})();
