/* Boot: load data, pull in actions taken from notifications, keep reminders scheduled. */
(function () {
  const { H, S, Rem, Prep, drain } = PH;

  PH.refreshSteps = async function () {
    try {
      const r = await N.steps();
      if (r && r.allowed !== false && r.steps != null) {
        const k = H.dkey();
        if (r.steps > (S.state.steps[k] || 0) || N.isNative) { S.state.steps[k] = r.steps; S.save(); }
        return S.state.steps[k];
      }
    } catch (e) {}
    return null;
  };

  async function daily() {
    const k = H.dkey();
    if (S.state._synced === k) return;
    S.state._synced = k; S.save();
    await Rem.sync();
    await Prep.sync();
  }

  async function onResume() {
    const n = await drain();
    await daily();
    if (n || ["today", "water", "prep", "food"].includes(UI.current().name)) UI.refresh();
  }

  async function boot() {
    await S.load();
    await drain();
    UI.render();
    N.onResume(onResume);
    N.onBack(() => {
      if (UI.closeSheet()) return;
      const r = UI.current().name;
      if (r === "today" || r === "welcome") N.exitApp(); else history.back();
    });
    if (S.state.profile.onboarded && S.state.profile.setupDone) daily();
    try { const rs = await N.rideState(); PH.rideLive = !!(rs && rs.running); if (PH.rideLive && UI.current().name === "today") UI.go("ride"); } catch (e) {}
    setInterval(() => { if (UI.current().name === "today" && !UI.isSheetOpen()) UI.refresh(); }, 60000);
  }
  document.addEventListener("DOMContentLoaded", boot);
})();
