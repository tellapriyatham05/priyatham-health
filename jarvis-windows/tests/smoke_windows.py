"""End-to-end check on a real Windows machine (run by CI after the models are downloaded).

Synthesises speech with the Windows voice, then runs it through the wake word, Vosk and Whisper,
and through the brain, printing what JARVIS heard and would do."""
import json, os, sys, tempfile, wave
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ["APPDATA"] = tempfile.mkdtemp()
import numpy as np


def synth(text, path):
    from jarvis.voice import synth_to_wav
    synth_to_wav(text, path)
    with wave.open(path, "rb") as w:
        rate, pcm = w.getframerate(), np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
        if w.getnchannels() > 1:
            pcm = pcm.reshape(-1, w.getnchannels())[:, 0]
    assert len(pcm) > rate // 4, f"Windows voice produced no audio for {text!r}"
    # Resample to 16 kHz.
    n = int(len(pcm) * 16000 / rate)
    return np.interp(np.linspace(0, len(pcm) - 1, n), np.arange(len(pcm)), pcm).astype(np.int16)


from jarvis.audio import WakeWord, resource, FRAME
from jarvis.store import Store
from jarvis.brain import Brain
from jarvis import winactions as wa
from jarvis.voice import robotize, envelope
from vosk import Model, KaldiRecognizer, SetLogLevel

SetLogLevel(-1)
fails = 0
tmp = os.path.join(tempfile.gettempdir(), "jv.wav")

ww = WakeWord()
for phrase, want in (("Hey Jarvis", True), ("Hey Jarvis, open notepad", True), ("What time is it", False), ("Open the window", False)):
    pcm = np.concatenate([np.zeros(16000, np.int16), synth(phrase, tmp), np.zeros(16000, np.int16)])
    ww.reset()
    best = max(ww.process(pcm[i:i + FRAME]) for i in range(0, len(pcm) - FRAME, FRAME))
    ok = (best >= 0.45) == want
    fails += not ok
    print(f"[wake] {'ok ' if ok else 'BAD'} {phrase!r}: score {best:.3f}")

from faster_whisper import WhisperModel
whisper = WhisperModel(resource("models", "whisper-base.en"), device="cpu", compute_type="int8")
apps = wa.Apps()
apps.ready.wait(30)
print(f"[apps] indexed {len(apps.items)} start-menu apps; notepad -> {apps.find('notepad')}; vs code -> {apps.find('vs code')}")
brain = Brain(Store(), apps, None, lambda *a: None)
for model_name in ("vosk-model-small-en-in-0.4", "vosk-model-small-en-us-0.15"):
    model = Model(resource("models", model_name))
    for phrase in ("open notepad", "volume up", "what time is it", "set a timer for five minutes", "remind me tomorrow at ten am to submit the report"):
        pcm = synth(phrase, tmp)
        rec = KaldiRecognizer(model, 16000)
        rec.AcceptWaveform(pcm.tobytes())
        heard = json.loads(rec.FinalResult())["text"]
        segs, _ = whisper.transcribe(pcm.astype(np.float32) / 32768.0, language="en", beam_size=3, without_timestamps=True)
        heard_w = " ".join(s.text for s in segs).strip()
        reply = brain.handle(heard_w or heard)
        print(f"[{model_name[17:22]}] said {phrase!r} | vosk {heard!r} | whisper {heard_w!r} -> {reply.speech!r}")

pcm = synth("Good evening, sir. All systems are online.", tmp)
out = robotize(pcm, 16000, 0.18, 68.0, 6.0, 0.32)
print(f"[voice] robotized {len(out)} samples, peak {int(np.abs(out).max())}, envelope {len(envelope(out, 256))} blocks")
radio = wa.powershell("[Windows.Devices.Radios.Radio,Windows.System.Devices,ContentType=WindowsRuntime] | Out-Null; 'ok'")
print(f"[radio] WinRT radio API available -> {radio}")
# Voices: classic SAPI + OneCore.
from jarvis.voice import list_voices
print(f"[voices] {list_voices()}")

# Background removal: the built-in suit painted on a busy background, then cut out.
from PySide6.QtGui import QGuiApplication, QImage, QPainter, QColor, QLinearGradient, QBrush
from jarvis.suit import draw_suit
from jarvis.cutout import remove_background
qapp = QGuiApplication.instance() or QGuiApplication([])
src = os.path.join(tempfile.gettempdir(), "char_src.png")
img = QImage(600, 1000, QImage.Format_RGB32)
p = QPainter(img)
g = QLinearGradient(0, 0, 600, 1000); g.setColorAt(0, QColor(60, 70, 85)); g.setColorAt(1, QColor(150, 165, 180))
p.fillRect(img.rect(), QBrush(g))
draw_suit(p, 300, 520, 900)
p.end()
img.save(src)
dst = remove_background(src, os.path.join(tempfile.gettempdir(), "char_cut.png"))
cut = QImage(dst)
corner_alpha = cut.pixelColor(2, 2).alpha()
centre = cut.pixelColor(cut.width() // 2, cut.height() // 2).alpha()
ok = cut.hasAlphaChannel() and corner_alpha < 60 and centre > 200
fails += not ok
print(f"[cutout] {'ok ' if ok else 'BAD'} {cut.width()}x{cut.height()}, corner alpha {corner_alpha}, centre alpha {centre}")

# Speed: quick path (understood straight away) vs Whisper double-check.
import time as _t
from jarvis.parser import parse
for phrase in ("open notepad", "set a timer for five minutes", "volume up", "pause"):
    pcm = synth(phrase, tmp)
    t0 = _t.time()
    rec = KaldiRecognizer(Model(resource("models", "vosk-model-small-en-in-0.4")), 16000)
    t_load = _t.time() - t0
    t0 = _t.time()
    rec.AcceptWaveform(pcm.tobytes())
    quick = json.loads(rec.FinalResult())["text"]
    t_quick = _t.time() - t0
    t0 = _t.time()
    segs, _ = whisper.transcribe(pcm.astype(np.float32) / 32768.0, language="en", beam_size=3, without_timestamps=True)
    accurate = " ".join(s.text for s in segs).strip()   # segments are lazy: consuming them does the work
    t_whisper = _t.time() - t0
    from jarvis.main import quick_enough
    print(f"[speed] {phrase!r}: quick {t_quick*1000:.0f} ms ({quick!r}, trusted={quick_enough(quick)}), "
          f"accurate {t_whisper*1000:.0f} ms ({accurate!r})")

print("SMOKE", "FAILED" if fails else "PASSED")
sys.exit(1 if fails else 0)
