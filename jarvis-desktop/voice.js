// JARVIS's voice: turns text into speech with the offline Kokoro model, British male
// ("George" by default, like the films). Runs in its own process so speaking never
// slows down listening. Nothing leaves this PC.
const fs = require('fs');
const path = require('path');
const sherpa = require('sherpa-onnx-node');

const DIR = path.join(process.env.JARVIS_MODELS || path.join(__dirname, 'models'), 'kokoro');
// Kokoro v1.0 speaker numbers.
const SPEAKERS = { george: 26, lewis: 27, daniel: 24, fable: 25, michael: 16, adam: 11 };
let speaker = SPEAKERS[process.env.JARVIS_VOICE] ?? SPEAKERS.george;
const SPEED = 1.0;
const CACHE_MAX = 80;
const WARM_UP = ['Yes, sir?', 'Right away, sir.', 'At your service, sir.', "Sorry sir, I didn't catch that.", 'As you wish, sir. Call me when you need me.'];

let tts = null;
const cache = new Map(); // speaker + text -> Float32Array
const queue = [];
let busy = false;

function send(msg) {
  process.parentPort.postMessage(msg);
}

async function generate(text) {
  const key = `${speaker}|${text}`;
  if (cache.has(key)) return cache.get(key);
  const audio = await tts.generateAsync({ text, sid: speaker, speed: SPEED, enableExternalBuffer: false });
  const samples = Float32Array.from(audio.samples);
  cache.set(key, samples);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return samples;
}

async function pump() {
  if (busy || !tts) return;
  busy = true;
  while (queue.length) {
    const { id, text } = queue.shift();
    const started = Date.now();
    try {
      const samples = await generate(text);
      send({ type: 'audio', id, samples, sampleRate: tts.sampleRate, ms: Date.now() - started });
    } catch (err) {
      send({ type: 'error', id, message: String(err) });
    }
  }
  busy = false;
}

function config(british) {
  const lexicon = path.join(DIR, british ? 'lexicon-gb-en.txt' : 'lexicon-us-en.txt');
  return {
    model: {
      kokoro: {
        model: path.join(DIR, 'model.onnx'),
        voices: path.join(DIR, 'voices.bin'),
        tokens: path.join(DIR, 'tokens.txt'),
        dataDir: path.join(DIR, 'espeak-ng-data'),
        lexicon,
        lang: british ? 'en-gb' : 'en-us',
      },
      numThreads: 4,
    },
    maxNumSentences: 1,
  };
}

async function init() {
  const started = Date.now();
  // British pronunciation when that word list is available, American otherwise.
  const british = fs.existsSync(path.join(DIR, 'lexicon-gb-en.txt'));
  try {
    tts = await sherpa.OfflineTts.createAsync(config(british));
  } catch (err) {
    if (!british) throw err;
    send({ type: 'log', message: `British setup failed (${err}), using American pronunciation` });
    tts = await sherpa.OfflineTts.createAsync(config(false));
  }
  send({ type: 'ready', ms: Date.now() - started });
  pump();
  for (const text of WARM_UP) await generate(text).catch(() => {});
}

process.parentPort.on('message', ({ data }) => {
  if (data.type === 'say') {
    queue.push({ id: data.id, text: data.text });
    pump();
  } else if (data.type === 'voice' && SPEAKERS[data.name] != null) {
    speaker = SPEAKERS[data.name];
  }
});

init().catch((err) => send({ type: 'error', message: `Voice failed to start: ${err}` }));
