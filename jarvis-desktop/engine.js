// Speech engine: runs in its own process so decoding never freezes the UI.
// Listens all the time: Silero VAD cuts the mic stream into utterances, a tiny
// English Whisper model turns each one into text in ~0.15 s (enough to spot
// "Jarvis" and short commands), and the bigger Whisper "small" model re-reads an
// utterance on request when exact words matter (typing, searches, other languages).
// Everything stays on this PC.
const path = require('path');
const sherpa = require('sherpa-onnx-node');
const { dropRepeats } = require('./brain/parser');

const MODELS = process.env.JARVIS_MODELS || path.join(__dirname, 'models');
const SAMPLE_RATE = 16000;
const WINDOW = 512;
const KEEP_SEGMENTS = 8;

let fast = null;      // tiny.en — every utterance
let accurate = null;  // small — only when asked
let accurateLoading = null;
let vad = null;
let language = process.env.JARVIS_LANG || 'en';
let pending = new Float32Array(0);
let wasSpeaking = false;
// The voice detector only notices speech a moment after it starts, which clips the
// "St" of "Jarvis". We keep the last few seconds of raw audio and cut each
// utterance from here with a little extra before and after it.
const HISTORY = SAMPLE_RATE * 30;
const history = new Float32Array(HISTORY);
let fed = 0; // total samples given to the detector since start
const PRE_ROLL = Math.round(SAMPLE_RATE * 0.3);
const POST_ROLL = Math.round(SAMPLE_RATE * 0.15);

function remember(samples) {
  for (let i = 0; i < samples.length; i++) history[(fed + i) % HISTORY] = samples[i];
  fed += samples.length;
}

function cut(start, length) {
  const from = Math.max(0, fed - HISTORY + 1, start - PRE_ROLL);
  const to = Math.min(fed, start + length + POST_ROLL);
  const out = new Float32Array(Math.max(0, to - from));
  for (let i = 0; i < out.length; i++) out[i] = history[(from + i) % HISTORY];
  return out;
}
let nextId = 1;
const segments = new Map(); // id -> samples, for re-reading with the accurate model
const queue = [];
let decoding = false;

function send(msg) {
  process.parentPort.postMessage(msg);
}

function whisper(name, lang, threads) {
  return {
    featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
    modelConfig: {
      whisper: {
        encoder: path.join(MODELS, `${name}-encoder.int8.onnx`),
        decoder: path.join(MODELS, `${name}-decoder.int8.onnx`),
        language: name.endsWith('.en') ? '' : lang === 'auto' ? '' : lang,
        task: 'transcribe',
      },
      tokens: path.join(MODELS, `${name}-tokens.txt`),
      numThreads: threads,
      provider: 'cpu',
    },
  };
}

function loadAccurate() {
  accurateLoading = sherpa.OfflineRecognizer.createAsync(whisper('small', language, 6)).then((r) => {
    accurate = r;
    return r;
  });
  return accurateLoading;
}

async function init() {
  const started = Date.now();
  fast = await sherpa.OfflineRecognizer.createAsync(whisper('tiny.en', 'en', 2));
  vad = new sherpa.Vad({
    sileroVad: {
      model: path.join(MODELS, 'silero_vad.onnx'),
      threshold: 0.5,
      minSilenceDuration: 0.7, // this much quiet ends a sentence
      minSpeechDuration: 0.15, // short replies like "no" still count
      maxSpeechDuration: 12,
      windowSize: WINDOW,
    },
    sampleRate: SAMPLE_RATE,
    numThreads: 1,
    provider: 'cpu',
  }, 30);
  send({ type: 'ready', ms: Date.now() - started });
  loadAccurate()
    .then(() => send({ type: 'accurate-ready' }))
    .catch((err) => send({ type: 'error', message: `Accurate model failed to load: ${err}` }));
}

async function decode(recognizer, samples) {
  const stream = recognizer.createStream();
  stream.acceptWaveform({ samples, sampleRate: SAMPLE_RATE });
  const result = await recognizer.decodeAsync(stream);
  return dropRepeats((result.text || '').trim());
}

async function pump() {
  if (decoding) return;
  decoding = true;
  while (queue.length) {
    const { id, samples } = queue.shift();
    const started = Date.now();
    try {
      const text = await decode(fast, samples);
      send({ type: 'segment', id, text, sec: +(samples.length / SAMPLE_RATE).toFixed(1), ms: Date.now() - started });
    } catch (err) {
      send({ type: 'error', message: `Decode failed: ${err}` });
    }
  }
  decoding = false;
}

function onAudio(chunk) {
  if (!vad) return;
  const merged = new Float32Array(pending.length + chunk.length);
  merged.set(pending);
  merged.set(chunk, pending.length);
  let offset = 0;
  while (offset + WINDOW <= merged.length) {
    const window = merged.subarray(offset, offset + WINDOW);
    remember(window);
    vad.acceptWaveform(window);
    offset += WINDOW;
  }
  pending = merged.slice(offset);

  const speaking = vad.isDetected();
  if (speaking !== wasSpeaking) {
    wasSpeaking = speaking;
    send({ type: speaking ? 'speech-start' : 'speech-end' });
  }

  while (!vad.isEmpty()) {
    const seg = vad.front(false);
    vad.pop();
    const id = nextId++;
    const samples = cut(seg.start, seg.samples.length);
    segments.set(id, samples);
    if (segments.size > KEEP_SEGMENTS) segments.delete(segments.keys().next().value);
    // If speech keeps pouring in (a video playing near the mic), skip the backlog.
    if (queue.length >= 4) queue.shift();
    queue.push({ id, samples });
  }
  pump();
}

async function refine(id) {
  const samples = segments.get(id);
  if (!samples) return send({ type: 'refined', id, text: null });
  const started = Date.now();
  try {
    const model = accurate || (await (accurateLoading || loadAccurate()));
    const text = await decode(model, samples);
    send({ type: 'refined', id, text, ms: Date.now() - started });
  } catch (err) {
    send({ type: 'refined', id, text: null, error: String(err) });
  }
}

process.parentPort.on('message', async ({ data }) => {
  try {
    switch (data.type) {
      case 'audio':
        onAudio(data.samples);
        break;
      case 'refine':
        refine(data.id);
        break;
      case 'language':
        language = data.language;
        accurate = null;
        loadAccurate()
          .then(() => send({ type: 'language', language }))
          .catch((err) => send({ type: 'error', message: String(err) }));
        break;
      case 'test-wav': {
        // Self-test: push a recording through exactly the same path as the mic.
        const wave = sherpa.readWave(data.file, false);
        const all = new Float32Array(wave.samples.length + SAMPLE_RATE * 1.2);
        all.set(wave.samples);
        for (let i = 0; i < all.length; i += 1600) onAudio(all.slice(i, i + 1600));
        break;
      }
    }
  } catch (err) {
    send({ type: 'error', message: String((err && err.stack) || err) });
  }
});

init().catch((err) => send({ type: 'error', message: 'Speech engine failed to start: ' + String(err) }));
