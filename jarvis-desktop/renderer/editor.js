// Editor for your own commands and recorded routines (saved in custom-commands.json).
const list = document.getElementById('list');
const rowTpl = document.getElementById('row');
const status = document.getElementById('status');
let dirty = false;

function setStatus(text) {
  status.textContent = text;
}

async function check(section) {
  const out = section.querySelector('.check');
  const lines = section.querySelector('.steps').value.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) { out.textContent = ''; return; }
  const results = await Promise.all(lines.map((l) => window.jarvisEditor.test(l)));
  out.innerHTML = '';
  results.forEach((r, i) => {
    const span = document.createElement('div');
    span.className = r.ok ? 'ok' : 'bad';
    span.textContent = r.ok ? `✓ ${lines[i]} → ${r.say}` : `✗ "${lines[i]}" — Jarvis doesn't understand this line`;
    out.appendChild(span);
  });
}

function addRow(name = '', steps = []) {
  const node = rowTpl.content.firstElementChild.cloneNode(true);
  node.querySelector('.name').value = name;
  node.querySelector('.steps').value = steps.join('\n');
  node.querySelector('.del').onclick = () => { node.remove(); dirty = true; setStatus('Not saved yet'); };
  node.querySelector('.run').onclick = async () => {
    await save();
    const n = node.querySelector('.name').value.trim().toLowerCase();
    if (n) window.jarvisEditor.run(n);
  };
  node.addEventListener('input', () => { dirty = true; setStatus('Not saved yet'); });
  node.querySelector('.steps').addEventListener('change', () => check(node));
  list.appendChild(node);
  if (steps.length) check(node);
  return node;
}

async function save() {
  const commands = {};
  for (const node of list.querySelectorAll('.cmd')) {
    const name = node.querySelector('.name').value.trim().toLowerCase().replace(/[.!?]+$/, '');
    const steps = node.querySelector('.steps').value.split('\n').map((l) => l.trim()).filter(Boolean);
    if (name && steps.length) commands[name] = steps;
  }
  await window.jarvisEditor.save(commands);
  dirty = false;
  setStatus(`Saved ${Object.keys(commands).length} command${Object.keys(commands).length === 1 ? '' : 's'}`);
}

document.getElementById('add').onclick = () => addRow().querySelector('.name').focus();
document.getElementById('save').onclick = save;
window.addEventListener('keydown', (e) => { if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); save(); } });
window.addEventListener('beforeunload', () => { if (dirty) save(); });

window.jarvisEditor.load().then((commands) => {
  const names = Object.keys(commands);
  if (!names.length) addRow();
  for (const n of names) addRow(n, commands[n]);
  setStatus(names.length ? `${names.length} command${names.length === 1 ? '' : 's'}` : 'No commands yet');
});
