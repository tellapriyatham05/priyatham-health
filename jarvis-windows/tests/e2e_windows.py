"""End-to-end: the real JARVIS app (wake word → command → reply), three times in a row,
with room noise, fed with synthesised speech instead of a microphone. Fails if JARVIS
stops responding after the first command or takes too long."""
import os
import sys
import tempfile
import threading
import time
import wave

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ["APPDATA"] = tempfile.mkdtemp()
import numpy as np

from jarvis.audio import FRAME, Listener
from jarvis.voice import synth_to_wav

Listener.start = lambda self: None      # no microphone on the build server: we feed audio ourselves


def speech(text):
    path = os.path.join(tempfile.gettempdir(), "e2e.wav")
    synth_to_wav(text, path)
    with wave.open(path, "rb") as w:
        rate, pcm = w.getframerate(), np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
    n = int(len(pcm) * 16000 / rate)
    return np.interp(np.linspace(0, len(pcm) - 1, n), np.arange(len(pcm)), pcm).astype(np.int16)


from PySide6.QtWidgets import QApplication
app = QApplication([])
from jarvis.main import Jarvis
j = Jarvis(app, background=True)
j.listener.load()
j.listener.on_status("listening")
rng = np.random.default_rng(7)


def noise(seconds):
    return rng.normal(0, 250, int(16000 * seconds)).astype(np.int16)   # a quiet room with a fan


def feed(pcm):
    pcm = np.clip(pcm.astype(np.float32) + rng.normal(0, 250, len(pcm)), -32768, 32767).astype(np.int16)
    for i in range(0, len(pcm) - FRAME, FRAME):
        j.listener._handle(pcm[i:i + FRAME])
        time.sleep(FRAME / 16000)


def pump(seconds, until=None):
    end = time.time() + seconds
    while time.time() < end:
        app.processEvents()
        if until and until():
            return True
        time.sleep(0.02)
    return False


fails = 0
for wake, command, expect in (("Hey Jarvis", "what is the time", "It's"),
                              ("Hey Jarvis", "open notepad", "Opening Notepad"),
                              ("Jarvis", "hide", "Going")):
    pump(1.0)
    before = len(j.store.get("log"))
    audio = np.concatenate([noise(1.0), speech(wake), noise(0.4), speech(command), noise(3.0)])
    t_end_of_speech = None
    feeder = threading.Thread(target=feed, args=(audio,), daemon=True)
    started = time.time()
    feeder.start()
    t_end_of_speech = started + (len(audio) / 16000) - 3.0
    got = pump(25, until=lambda: len(j.store.get("log")) > before)
    reply = j.store.get("log")[-1] if got else None
    latency = time.time() - t_end_of_speech
    # Back to waiting for the wake word, ready for the next round.
    ready = pump(25, until=lambda: j.listener.mode == "wake" and not j.active)
    feeder.join(timeout=30)
    ok = got and reply and reply["reply"].startswith(expect) and ready
    fails += not ok
    print(f"[e2e] {'ok ' if ok else 'BAD'} {wake!r} + {command!r}: heard {reply and reply['heard']!r} -> "
          f"{reply and reply['reply']!r}; reply {latency:.1f}s after you stopped talking; ready again: {ready}")
    print(f"      recognisers: {j.listener.__dict__.get('last_candidates')}")

log_path = os.path.join(os.environ["APPDATA"], "JARVIS", "jarvis.log")
if os.path.exists(log_path):
    print("---- jarvis.log ----")
    print(open(log_path, encoding="utf-8").read()[-4000:])
print("E2E", "FAILED" if fails else "PASSED")
os._exit(1 if fails else 0)
