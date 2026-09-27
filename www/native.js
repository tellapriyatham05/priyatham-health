/* Thin wrapper over the native Companion plugin, with browser fallbacks so the UI can be previewed on a laptop. */
(function () {
  const Cap = window.Capacitor;
  const isNative = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
  const P = isNative ? Cap.Plugins : {};
  const C = P.Companion;

  let fakeRide = null;

  const N = {
    isNative,
    async prefGet(key) {
      if (isNative && P.Preferences) return (await P.Preferences.get({ key })).value;
      try { return localStorage.getItem(key); } catch (e) { return null; }
    },
    async prefSet(key, value) {
      if (isNative && P.Preferences) return P.Preferences.set({ key, value });
      try { localStorage.setItem(key, value); } catch (e) {}
    },
    onResume(fn) {
      if (isNative && P.App) P.App.addListener("appStateChange", (s) => { if (s.isActive) fn(); });
      else document.addEventListener("visibilitychange", () => { if (!document.hidden) fn(); });
    },
    onBack(fn) {
      if (isNative && P.App) P.App.addListener("backButton", fn);
    },
    exitApp() { if (isNative && P.App) P.App.exitApp(); },

    async schedule(alarms) { if (C && alarms.length) await C.schedule({ alarms }); },
    async cancelPrefix(prefix) { if (C) await C.cancelPrefix({ prefix }); },
    async cancel(ids) { if (C) await C.cancel({ ids }); },
    async listAlarms() { return C ? (await C.list()).alarms : []; },
    async drainEvents() { return C ? (await C.drainEvents()).events || [] : []; },
    async markEvent(key) { if (C) await C.markEvent({ key }); },
    async testAlarm(mode) { if (C) await C.testAlarm({ mode, title: "Test reminder" }); },

    async status() {
      if (!C) return { notifications: true, location: true, activity: true, exactAlarm: true, fullScreen: true, battery: false, usage: false, sdk: 0, model: "Browser preview" };
      return C.status();
    },
    async request(alias) { return C ? C.request({ alias }) : N.status(); },
    async openSettings(which) { if (C) await C.openSettings({ which }); },

    async steps() {
      if (!C) return { steps: 5120, allowed: true };
      return C.steps();
    },
    async usage(start, end) {
      if (!C) return { total: 4 * 3600e3 + 12 * 60e3, lateNight: 48 * 60e3, apps: [
        { label: "Instagram", pkg: "com.instagram.android", ms: 85 * 60e3 },
        { label: "YouTube", pkg: "com.google.android.youtube", ms: 58 * 60e3 },
        { label: "WhatsApp", pkg: "com.whatsapp", ms: 52 * 60e3 },
        { label: "Chrome", pkg: "com.android.chrome", ms: 57 * 60e3 }] };
      return C.usage({ start, end });
    },
    async speak(text) {
      if (C) return C.speak({ text });
      try { speechSynthesis.speak(new SpeechSynthesisUtterance(text)); } catch (e) {}
    },
    async vibrate(ms) { if (C) return C.vibrate({ ms }); if (navigator.vibrate) navigator.vibrate(ms); },

    async startRide(weightKg) {
      if (C) return C.startRide({ weightKg });
      fakeRide = { start: Date.now(), paused: false };
      return N.rideState();
    },
    async pauseRide(paused) { if (C) return C.pauseRide({ paused }); if (fakeRide) fakeRide.paused = paused; },
    async rideState() {
      if (C) return C.rideState();
      if (!fakeRide) return { running: false };
      const s = (Date.now() - fakeRide.start) / 1000;
      const km = s * 18.6 / 3600;
      const pts = [];
      for (let i = 0; i < Math.min(200, s); i++) pts.push([17.44 + i * 0.0002, 78.38 + Math.sin(i / 15) * 0.001 + i * 0.00015]);
      return { running: true, paused: fakeRide.paused, km, kcal: km * 34, climb: s / 40, speed: 18.6, maxSpeed: 27.2, elapsedSec: Math.round(s), movingSec: Math.round(s), accuracy: 6, points: pts };
    },
    async stopRide() {
      if (C) return C.stopRide();
      const st = await N.rideState();
      fakeRide = null;
      return st;
    },
  };
  window.N = N;
})();
