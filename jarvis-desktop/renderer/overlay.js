// Overlay: draws JARVIS (Iron Man) + his HUD bubble across the screen, owns the microphone,
// plays his voice, and lets you drag / click / right-click him.
const stage = document.getElementById('stage');
const bubble = document.getElementById('bubble');
const label = document.getElementById('label');
const text = document.getElementById('text');

let showBubble = true;
const suit = new window.IronMan(stage, { onMove: placeBubble });

let hideTimer = null;
let audioCtx = null;
const ctx = () => {
  if (!audioCtx || audioCtx.state === 'closed') {
    audioCtx = new AudioContext();
    // e.g. headphones unplugged: make a fresh one next time
    audioCtx.onerror = () => { audioCtx = null; };
  }
  return audioCtx;
};

// ------------------------------------------------------------------ sounds (soft HUD beeps)
function tone(freq, ms, delay = 0, vol = 0.05, type = 'sine') {
  const c = ctx();
  const t = c.currentTime + delay;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
  osc.connect(gain).connect(c.destination);
  osc.start(t);
  osc.stop(t + ms / 1000 + 0.02);
}

const SOUNDS = {
  wake: () => { tone(1046, 70); tone(1568, 110, 0.07); },
  ok: () => { tone(1318, 70); tone(1760, 90, 0.08); },
  squeak: () => tone(1568, 60),
  error: () => { tone(392, 120, 0, 0.05, 'triangle'); tone(262, 160, 0.12, 0.05, 'triangle'); },
  bell: () => { for (let i = 0; i < 4; i++) tone(1760, 200, i * 0.28, 0.05); },
};

// ------------------------------------------------------------------ what main asks us to show
function modeFor(d) {
  switch (d.dot) {
    case 'loading': return ['idle'];
    case 'listening': return ['listen'];
    case 'speaking': return ['hearing'];
    case 'thinking': return d.activity ? ['work', d.activity] : ['think'];
    case 'confirm': return ['confirm'];
    case 'done': return ['happy'];
    case 'error': return ['confused'];
    case 'paused': return ['paused'];
    case 'dictate': return ['dictate'];
    case 'reminder': return ['work', 'bell'];
    default: return ['idle'];
  }
}

window.jarvis.onDisplay((d) => {
  if (d.sound && d.soundOn && SOUNDS[d.sound]) SOUNDS[d.sound]();
  if (d.keep) return; // sound only
  const [mode, activity] = modeFor(d);
  if ((suit.phase !== 'away' && !suit.leaving) || ['listen', 'hearing', 'work', 'think', 'confirm'].includes(mode)) suit.show(mode, activity);

  label.textContent = d.label || '';
  text.textContent = d.text || '';
  bubble.classList.toggle('hidden', !showBubble || (!d.label && !d.text) || suit.phase === 'away');
  placeBubble();
  clearTimeout(hideTimer);
  if (d.hideAfter) {
    hideTimer = setTimeout(() => {
      bubble.classList.add('hidden');
      if (mode !== 'paused') suit.settle();
    }, d.hideAfter);
  }
  if (d.dot === 'sleeping' && !d.hideAfter) suit.settle(1500);
});

// The bubble floats above JARVIS and stays on screen.
function placeBubble() {
  if (suit.phase === 'flying' || suit.phase === 'away') { bubble.style.visibility = 'hidden'; return; }
  bubble.style.visibility = 'visible';
  const bw = bubble.offsetWidth, bh = bubble.offsetHeight;
  const x = Math.max(8, Math.min(window.innerWidth - bw - 8, suit.x + suit.w / 2 - bw / 2));
  const y = Math.max(8, suit.y - bh - 14);
  bubble.style.transform = `translate(${x}px, ${y}px)`;
}

// ------------------------------------------------------------------ his look, size, place
window.jarvis.onLook(async (look) => {
  showBubble = look.bubble !== false;
  if (look.home !== undefined) suit.setHome(look.home);
  if (look.size) suit.setSize(look.size);
  if (look.picture !== undefined) await suit.useCharacter(look.picture);
  if (look.arrive && suit.phase === 'away') suit.arrive();
});

window.jarvis.onVisibility((hidden) => {
  bubble.classList.add('hidden');
  if (hidden) suit.leave();
  else if (suit.phase === 'away' || suit.leaving) suit.arrive();
});

// Main sends a picture you chose; we cut out its background here and send the result back.
window.jarvis.onPrepareImage(async (src) => {
  try {
    const pic = await window.JarvisCutout.prepareCharacter(src);
    window.jarvis.imagePrepared({ ok: true, ...pic });
  } catch (err) {
    window.jarvis.imagePrepared({ ok: false, error: String(err.message || err) });
  }
});

// ------------------------------------------------------------------ JARVIS's voice
// Main sends the audio of a sentence; we play it and make his glow pulse with the loudness.
window.jarvis.onSpeak(async ({ id, samples, sampleRate }) => {
  try {
    const c = ctx();
    const buffer = c.createBuffer(1, samples.length, sampleRate);
    buffer.copyToChannel(samples instanceof Float32Array ? samples : Float32Array.from(samples), 0);
    const src = c.createBufferSource();
    src.buffer = buffer;
    const analyser = c.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser).connect(c.destination);
    const data = new Float32Array(analyser.fftSize);
    let playing = true;
    const glow = () => {
      if (!playing) return suit.setTalking(0);
      analyser.getFloatTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
      suit.setTalking(Math.sqrt(sum / data.length));
      setTimeout(glow, 60);
    };
    src.onended = () => { playing = false; suit.setTalking(0); window.jarvis.spoke(id); };
    src.start();
    glow();
  } catch (err) {
    window.jarvis.spoke(id, String(err));
  }
});

// ------------------------------------------------------------------ drag, click, right-click
// The window ignores the mouse except over JARVIS, so clicks pass through to your apps.
const body = suit.root;
body.addEventListener('mouseenter', () => window.jarvis.pointerOver(true));
body.addEventListener('mouseleave', () => { if (!drag) window.jarvis.pointerOver(false); });

let drag = null;
body.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || suit.phase === 'flying') return;
  body.setPointerCapture(e.pointerId);
  drag = { sx: e.clientX, sy: e.clientY, ox: e.clientX - suit.x, oy: e.clientY - suit.y, moved: false };
});
body.addEventListener('pointermove', (e) => {
  if (!drag) return;
  if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4) return;
  drag.moved = true;
  suit.dragging = true;
  body.classList.add('dragging');
  suit.setHome({ x: e.clientX - drag.ox, y: e.clientY - drag.oy });
});
body.addEventListener('pointerup', (e) => {
  if (!drag) return;
  const wasDrag = drag.moved;
  drag = null;
  suit.dragging = false;
  body.classList.remove('dragging');
  body.releasePointerCapture(e.pointerId);
  if (wasDrag) window.jarvis.homeMoved({ x: Math.round(suit.home.x), y: Math.round(suit.home.y) });
  else window.jarvis.clicked();
});
body.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  window.jarvis.menu();
});

window.addEventListener('resize', () => suit.resize());

// ------------------------------------------------------------------ microphone
let micLevelTimer = null;
async function startMic() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const micCtx = new AudioContext({ sampleRate: 16000 });
    // e.g. the mic or headset was unplugged: start over in a moment
    micCtx.onerror = () => { micCtx.close().catch(() => {}); stream.getTracks().forEach((t) => t.stop()); setTimeout(startMic, 2000); };
    stream.getAudioTracks()[0].onended = () => { micCtx.close().catch(() => {}); setTimeout(startMic, 2000); };
    await micCtx.audioWorklet.addModule('mic-worklet.js');
    const source = micCtx.createMediaStreamSource(stream);
    const collector = new AudioWorkletNode(micCtx, 'mic-collector');
    let peak = 0;
    collector.port.onmessage = (e) => {
      window.jarvis.sendAudio(e.data);
      for (let i = 0; i < e.data.length; i += 16) peak = Math.max(peak, Math.abs(e.data[i]));
    };
    // Chromium only pulls audio through nodes that reach the speakers; a muted
    // gain keeps the collector running without playing the mic back.
    const mute = micCtx.createGain();
    mute.gain.value = 0;
    source.connect(collector).connect(mute).connect(micCtx.destination);
    window.jarvis.micStatus({ ok: true, device: stream.getAudioTracks()[0].label });
    // A mic level line in the log once a minute helps diagnose "it doesn't hear me".
    clearInterval(micLevelTimer);
    micLevelTimer = setInterval(() => { window.jarvis.micLevel(peak.toFixed(3)); peak = 0; }, 60000);
  } catch (err) {
    window.jarvis.micStatus({ ok: false, message: String(err) });
    setTimeout(startMic, 10000); // try again (mic plugged in later, permission fixed…)
  }
}

startMic();
