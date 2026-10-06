// Finds things on screen by what they're called ("Subscribe", "the search box") using
// the names Windows UI Automation reports, and numbers them for "show numbers".
const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

const TEXT_BOXES = new Set(['Edit', 'ComboBox']);

// How well an on-screen element matches what was said (0 = not at all).
function score(el, spoken) {
  const want = norm(spoken);
  const name = norm(el.name);
  const help = norm(el.help);
  if (!want) return 0;

  // "search box", "search bar", "text box", "address bar"
  const boxWords = /\b(box|bar|field|input)\b/.test(want);
  const core = want.replace(/\b(box|bar|field|input|button|link)\b/g, '').trim();
  if (boxWords) {
    if (!TEXT_BOXES.has(el.type)) return 0;
    if (!core || core === 'text') return 40;
    if (/^(?:address|url|web address)$/.test(core)) return /address/.test(name) ? 100 : 0;
    return name.includes(core) || help.includes(core) ? 95 : 0;
  }
  if (!name) return 0;
  if (name === want) return 100;
  if (name.startsWith(`${want} `) || name.endsWith(` ${want}`)) return 85 - Math.min(20, name.length - want.length) / 2;
  const words = want.split(' ');
  if (words.every((w) => name.split(' ').includes(w))) return 70 - Math.min(20, name.length - want.length) / 4;
  if (name.includes(want)) return 60 - Math.min(20, name.length - want.length) / 4;
  if (want.length >= 5 && name.length <= want.length + 3) {
    const d = levenshtein(want, name);
    if (d <= (want.length >= 9 ? 2 : 1)) return 45 - d * 5;
  }
  if (help && help.includes(want)) return 40;
  return 0;
}

// Returns { match } for one clear winner, { choices } when several are equally good, or {}.
function findByName(elements, spoken) {
  const ranked = elements
    .map((el) => ({ el, s: score(el, spoken) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s);
  if (!ranked.length) return {};
  const best = ranked[0].s;
  const top = ranked.filter((r) => r.s >= best - 3);
  // Same thing reported twice (e.g. a link inside a list item) counts once.
  const distinct = [];
  for (const r of top) {
    const cx = r.el.x + r.el.w / 2;
    const cy = r.el.y + r.el.h / 2;
    if (!distinct.some((d) => Math.abs(d.x + d.w / 2 - cx) < 12 && Math.abs(d.y + d.h / 2 - cy) < 12)) distinct.push(r.el);
  }
  return distinct.length === 1 ? { match: distinct[0] } : { choices: distinct.slice(0, 9) };
}

// Numbers read in rows, top-left to bottom-right, skipping near-duplicates.
function numberElements(elements, max = 150) {
  const sorted = [...elements].sort((a, b) => (Math.abs(a.y - b.y) < 12 ? a.x - b.x : a.y - b.y));
  const out = [];
  for (const el of sorted) {
    const cx = el.x + el.w / 2;
    const cy = el.y + el.h / 2;
    if (out.some((d) => Math.abs(d.x + d.w / 2 - cx) < 10 && Math.abs(d.y + d.h / 2 - cy) < 10)) continue;
    out.push(el);
    if (out.length >= max) break;
  }
  return out.map((el, i) => ({ ...el, n: i + 1 }));
}

const centre = (el) => ({ x: Math.round(el.x + el.w / 2), y: Math.round(el.y + el.h / 2) });

module.exports = { findByName, numberElements, centre, score };
