// Timers and reminders: understands spoken times, keeps them in a file so they
// survive restarts, and calls back when one is due.
const fs = require('fs');

const WORD_NUMS = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, ninety: 90, couple: 2, few: 3,
};
const UNIT_MS = { second: 1000, sec: 1000, minute: 60000, min: 60000, hour: 3600000, hr: 3600000 };

// "5 minutes", "an hour", "half an hour", "1 hour 30 minutes", "twenty five minutes", "90 seconds"
function parseDuration(raw) {
  let s = String(raw || '').toLowerCase().replace(/[.,!?]/g, ' ').replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (/^(?:a |one )?half (?:an |a )?hour$|^half hour$/.test(s)) return 30 * 60000;
  if (/^(?:a |one )?quarter (?:of )?(?:an |a )?hour$/.test(s)) return 15 * 60000;
  s = s.replace(/\band a half\b/g, 'and half');
  let total = 0;
  let found = false;
  const re = /(\d+(?:\.\d+)?|[a-z]+(?: [a-z]+)?)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?)(?: and half)?/g;
  let m;
  while ((m = re.exec(s))) {
    let n = Number(m[1]);
    if (Number.isNaN(n)) {
      const words = m[1].split(' ');
      n = 0;
      for (const w of words) {
        if (WORD_NUMS[w] === undefined) { n = NaN; break; }
        n += WORD_NUMS[w];
      }
      if (Number.isNaN(n) && WORD_NUMS[words[words.length - 1]] !== undefined) n = WORD_NUMS[words[words.length - 1]];
    }
    if (Number.isNaN(n)) continue;
    const unit = m[2].replace(/s$/, '');
    let ms = n * UNIT_MS[unit];
    if (/and half$/.test(m[0])) ms += 0.5 * UNIT_MS[unit];
    total += ms;
    found = true;
  }
  if (!found || total <= 0 || total > 7 * 24 * 3600000) return null;
  return Math.round(total);
}

// "6 pm", "6:30 pm", "18:30", "6", "tomorrow at 9 am", "noon" -> Date of the next such moment
function parseClock(raw, now = new Date()) {
  let s = String(raw || '').toLowerCase().replace(/[,!?]/g, ' ').replace(/\./g, ' ').replace(/\s+/g, ' ').trim();
  let dayOffset = 0;
  if (/\btomorrow\b/.test(s)) { dayOffset = 1; s = s.replace(/\btomorrow\b/, '').trim(); }
  if (/\btonight\b/.test(s)) { s = s.replace(/\btonight\b/, '').trim(); if (!/[ap] ?m/.test(s)) s += ' pm'; }
  s = s.replace(/^at /, '').replace(/ o'?clock/, '').replace(/\bp m\b/, 'pm').replace(/\ba m\b/, 'am').trim();
  if (s === 'noon' || s === 'midday') s = '12 pm';
  if (s === 'midnight') s = '12 am';
  const m = s.match(/^(\d{1,2})(?:[: ](\d{2}))? ?(am|pm|in the morning|in the evening|in the afternoon|at night)?$/);
  if (!m) return null;
  let hour = Number(m[1]);
  const min = Number(m[2] || 0);
  if (hour > 23 || min > 59) return null;
  const part = m[3] || '';
  const pm = /pm|evening|afternoon|night/.test(part);
  const am = /am|morning/.test(part);
  if (pm && hour < 12) hour += 12;
  if (am && hour === 12) hour = 0;
  const at = new Date(now);
  at.setDate(at.getDate() + dayOffset);
  at.setHours(hour, min, 0, 0);
  if (!am && !pm && !dayOffset && hour <= 12) {
    // "at 6": the next 6 o'clock, morning or evening
    while (at <= now) at.setTime(at.getTime() + 12 * 3600000);
  } else if (!dayOffset && at <= now) {
    at.setDate(at.getDate() + 1);
  }
  return at;
}

function describeDuration(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.round((ms % 60000) / 1000);
  const parts = [];
  if (h) parts.push(`${h} hour${h > 1 ? 's' : ''}`);
  if (m) parts.push(`${m} minute${m > 1 ? 's' : ''}`);
  if (s && !h) parts.push(`${s} second${s > 1 ? 's' : ''}`);
  return parts.join(' ') || 'a moment';
}

function describeTime(date, now = new Date()) {
  const t = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const sameDay = date.toDateString() === now.toDateString();
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  if (sameDay) return t;
  if (date.toDateString() === tomorrow.toDateString()) return `tomorrow at ${t}`;
  return `${date.toLocaleDateString('en-US', { weekday: 'long' })} at ${t}`;
}

class Timers {
  constructor({ file, onDue, log = () => {} }) {
    this.file = file;
    this.onDue = onDue;
    this.log = log;
    this.items = [];
    this.handles = new Map();
  }

  load() {
    try { this.items = JSON.parse(fs.readFileSync(this.file, 'utf8').replace(/^﻿/, '')); } catch { this.items = []; }
    const now = Date.now();
    const missed = this.items.filter((t) => t.at <= now);
    this.items = this.items.filter((t) => t.at > now);
    this.save();
    for (const t of this.items) this.arm(t);
    // Reminders that came due while the PC was off: tell the user (if not ancient).
    for (const t of missed) if (now - t.at < 12 * 3600000) setTimeout(() => this.onDue({ ...t, missed: true }), 8000);
    return this.items.length;
  }

  save() {
    try { fs.writeFileSync(this.file, JSON.stringify(this.items, null, 2)); } catch (err) { this.log(`timers save failed: ${err.message}`); }
  }

  arm(t) {
    const delay = t.at - Date.now();
    // setTimeout can't wait more than ~24.8 days; re-check in chunks for long ones.
    const handle = setTimeout(() => {
      if (t.at - Date.now() > 1000) return this.arm(t);
      this.handles.delete(t.id);
      this.items = this.items.filter((x) => x.id !== t.id);
      this.save();
      this.onDue(t);
    }, Math.min(Math.max(0, delay), 2 ** 31 - 1));
    this.handles.set(t.id, handle);
  }

  add({ kind, at, label, durationMs }) {
    const t = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), kind, at, label: label || '', durationMs };
    this.items.push(t);
    this.items.sort((a, b) => a.at - b.at);
    this.save();
    this.arm(t);
    return t;
  }

  list() {
    return [...this.items];
  }

  // kind: 'timer' | 'reminder' | 'all'; name: optional words from the reminder ("drink water")
  cancel({ kind = 'all', name = '' } = {}) {
    const want = name.toLowerCase().trim();
    let gone = this.items.filter((t) => kind === 'all' || t.kind === kind);
    if (want) gone = gone.filter((t) => (t.label || '').toLowerCase().includes(want));
    for (const t of gone) { clearTimeout(this.handles.get(t.id)); this.handles.delete(t.id); }
    const ids = new Set(gone.map((t) => t.id));
    this.items = this.items.filter((t) => !ids.has(t.id));
    this.save();
    return gone;
  }
}

module.exports = { Timers, parseDuration, parseClock, describeDuration, describeTime };
