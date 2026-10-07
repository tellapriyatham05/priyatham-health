// Talks to the Focus Dot app over its private local connection (127.0.0.1 only, with a
// secret token Focus Dot writes to its own data folder), so Jarvis can manage tasks by voice.
const fs = require('fs');
const path = require('path');

const LINK_FILE = process.env.JARVIS_FOCUSDOT_LINK || path.join(process.env.APPDATA || '', 'Focus Dot', 'voice-link.json');
const Q_NAMES = { 1: 'Q1 (urgent)', 2: 'Q2', 3: 'Q3', 4: 'Q4' };

const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

async function call(route, body) {
  let link;
  try { link = JSON.parse(fs.readFileSync(LINK_FILE, 'utf8')); } catch {
    throw new Error("Focus Dot isn't running (or needs updating)");
  }
  let res;
  try {
    res = await fetch(`http://127.0.0.1:${link.port}${route}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json', 'x-voice-token': link.token },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    throw new Error("Focus Dot isn't running");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || `Focus Dot said no (${res.status})`);
  return data;
}

// The task whose title best matches what was said.
function findTask(tasks, spoken, statuses) {
  const want = norm(spoken);
  const pool = tasks.filter((t) => statuses.includes(t.status));
  if (!want) return pool.find((t) => t.status === 'active') || null;
  let best = null;
  let bestScore = 0;
  for (const t of pool) {
    const title = norm(t.title);
    let s = 0;
    if (title === want) s = 100;
    else if (title.includes(want) || want.includes(title)) s = 70;
    else {
      const words = want.split(' ').filter((w) => w.length > 2);
      const hits = words.filter((w) => title.includes(w)).length;
      if (words.length && hits) s = 30 + (40 * hits) / words.length;
    }
    if (s > bestScore) { bestScore = s; best = t; }
  }
  return bestScore >= 45 ? best : null;
}

async function run(a) {
  if (a.op === 'add') {
    await call('/op', { name: 'addTask', payload: { title: a.title, q: a.q || undefined } });
    return { detail: `Added "${a.title}"${a.q ? ` to ${Q_NAMES[a.q]}` : ''}`, speak: `Added ${a.title}.` };
  }
  if (a.op === 'note') {
    const title = a.text.split(' ').slice(0, 6).join(' ');
    await call('/op', { name: 'addNote', payload: { title, body: a.text } });
    return { detail: 'Note saved in Focus Dot', speak: 'Note saved.' };
  }
  const { tasks } = await call('/state');
  if (a.op === 'list') {
    const active = tasks.filter((t) => t.status === 'active');
    const waiting = tasks.filter((t) => t.status === 'waiting');
    if (!active.length && !waiting.length) return { detail: 'No tasks right now', speak: 'You have no tasks right now.' };
    const lines = [
      ...active.map((t) => `▶ ${t.title} (Q${t.q})`),
      ...waiting.slice(0, 5).map((t) => `• ${t.title} (Q${t.q})`),
    ];
    const say = active.length
      ? `You're working on ${active.map((t) => t.title).join(', and ')}.${waiting.length ? ` ${waiting.length} more waiting.` : ''}`
      : `Nothing active. ${waiting.length} waiting, starting with ${waiting[0].title}.`;
    return { detail: lines.join('\n'), speak: say };
  }
  const statuses = a.op === 'start' ? ['waiting'] : a.op === 'pause' ? ['active'] : ['active', 'waiting'];
  const task = findTask(tasks, a.title, statuses);
  if (!task) throw new Error(a.title ? `I couldn't find a task called "${a.title}"` : 'No active task to pause');
  const name = { done: 'doneTask', pause: 'pauseTask', start: 'startTask' }[a.op];
  await call('/op', { name, payload: { id: task.id } });
  const verb = { done: 'Done', pause: 'Paused', start: 'Started' }[a.op];
  return { detail: `${verb}: ${task.title}`, speak: `${verb}: ${task.title}.` };
}

module.exports = { run, findTask };
