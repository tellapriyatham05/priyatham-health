"""JARVIS's voice: Windows' built-in offline voices (SAPI) plus a robotic filter.
Reports loudness while talking so the suit's eyes and reactor pulse in sync."""
import os
import queue
import tempfile
import threading
import time
import wave

import numpy as np

PRESETS = {  # ring-mod mix, ring Hz, comb delay ms, comb feedback, pitch shift (semitones)
    "classic": (0.18, 68.0, 6.0, 0.32, -1.0),
    "robot": (0.55, 52.0, 9.0, 0.45, -3.0),
    "calm": (0.0, 0.0, 0.0, 0.0, 0.0),
    "professional": (0.0, 0.0, 0.0, 0.0, 0.0),
}
PREFERRED = ("ravi", "george", "david", "mark", "james", "richard")


def robotize(x, rate, mix, hz, comb_ms, fb):
    y = x.astype(np.float32) / 32768.0
    if mix > 0:
        n = np.arange(len(y))
        y = y * (1 - mix) + y * np.sin(2 * np.pi * hz * n / rate) * mix * 1.6
    if comb_ms > 0:
        d = int(rate * comb_ms / 1000)
        out = y.copy()
        for i in range(d, len(out), d):
            out[i:i + d] += out[i - d:i][: len(out[i:i + d])] * fb
        y = out
    peak = float(np.max(np.abs(y))) if len(y) else 1.0
    y = y * (0.95 / max(peak, 1e-6))
    return (y * 32767).astype(np.int16)


def envelope(x, block):
    n = max(1, (len(x) + block - 1) // block)
    pad = np.zeros(n * block, np.float32)
    pad[: len(x)] = x.astype(np.float32)
    env = np.sqrt(np.mean(pad.reshape(n, block) ** 2, axis=1))
    return np.minimum(1.0, env / max(float(env.max()), 1e-6) * 1.15)


class Voice:
    def __init__(self, store, on_level):
        self.store = store
        self.on_level = on_level
        self._q = queue.Queue()
        self._gen = 0
        self.voices = []
        threading.Thread(target=self._run, name="jarvis-voice", daemon=True).start()

    def say(self, text, done=None):
        """Speak text; done() is called from the voice thread when finished."""
        self._gen += 1
        self._q.put((self._gen, text, done))

    def stop(self):
        self._gen += 1
        try:
            import sounddevice as sd
            sd.stop()
        except Exception:
            pass

    def _engine(self):
        import pyttsx3
        eng = pyttsx3.init()
        voices = eng.getProperty("voices")
        self.voices = [v.name for v in voices]
        want = self.store.get("voice_name")
        chosen = next((v for v in voices if v.name == want), None)
        if chosen is None:
            for key in PREFERRED:
                chosen = next((v for v in voices if key in v.name.lower()), None)
                if chosen:
                    break
        if chosen:
            eng.setProperty("voice", chosen.id)
        return eng

    def _run(self):
        try:
            import pythoncom
            pythoncom.CoInitialize()
        except Exception:
            pass
        eng = None
        path = os.path.join(tempfile.gettempdir(), "jarvis_say.wav")
        while True:
            gen, text, done = self._q.get()
            if gen != self._gen:
                if done:
                    done()
                continue
            try:
                if eng is None or getattr(self, "_reload", False):
                    eng = self._engine()
                    self._reload = False
                rate = float(self.store.get("speech_rate"))
                eng.setProperty("rate", int(175 * rate))
                eng.save_to_file(text, path)
                eng.runAndWait()
                self._play(path, gen)
            except Exception:
                # Last resort: speak without the filter.
                try:
                    eng.say(text)
                    eng.runAndWait()
                except Exception:
                    pass
            self.on_level(0.0)
            if done:
                done()

    def reload(self):
        self._reload = True

    def _play(self, path, gen):
        import sounddevice as sd
        with wave.open(path, "rb") as w:
            rate = w.getframerate()
            ch = w.getnchannels()
            pcm = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
        if ch > 1:
            pcm = pcm.reshape(-1, ch)[:, 0]
        mix, hz, comb, fb, semis = PRESETS.get(self.store.get("voice_mode"), PRESETS["classic"])
        play_rate = int(rate * (2 ** (semis / 12.0)))  # lower pitch = deeper, slightly slower
        pcm = robotize(pcm, rate, mix, hz, comb, fb)
        env = envelope(pcm, 256)
        sd.play(pcm, play_rate)
        start = time.time()
        total = len(pcm) / play_rate
        while time.time() - start < total + 0.05:
            if gen != self._gen:
                sd.stop()
                return
            idx = int((time.time() - start) * play_rate / 256)
            self.on_level(float(env[min(idx, len(env) - 1)]))
            time.sleep(0.03)
        sd.wait()
