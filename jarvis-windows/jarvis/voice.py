"""JARVIS's voice: Windows' built-in offline voices (SAPI, including the newer "OneCore" voices such
as Microsoft Ravi, Indian English male), with an optional robotic filter. Reports loudness while
talking so the character glows in sync."""
import os
import queue
import tempfile
import threading
import time
import wave

import numpy as np

from .logs import log

PRESETS = {  # ring-mod mix, ring Hz, comb delay ms, comb feedback, pitch shift (semitones)
    "classic": (0.18, 68.0, 6.0, 0.32, -1.0),
    "robot": (0.55, 52.0, 9.0, 0.45, -3.0),
    "natural": (0.0, 0.0, 0.0, 0.0, 0.0),
    "calm": (0.0, 0.0, 0.0, 0.0, 0.0),
    "professional": (0.0, 0.0, 0.0, 0.0, 0.0),
}
PREFERRED = ("ravi", "prabhat", "hemant", "george", "mark", "david", "james", "richard")
ONECORE = r"HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Speech_OneCore\Voices"


def _tokens():
    """(token, description) for every installed voice: classic SAPI voices and OneCore voices."""
    import win32com.client
    out, seen = [], set()
    cats = [None, ONECORE]
    for cat_id in cats:
        try:
            if cat_id is None:
                toks = win32com.client.Dispatch("SAPI.SpVoice").GetVoices()
            else:
                cat = win32com.client.Dispatch("SAPI.SpObjectTokenCategory")
                cat.SetId(cat_id, False)
                toks = cat.EnumerateTokens()
            for i in range(toks.Count):
                t = toks.Item(i)
                d = t.GetDescription()
                if d not in seen:
                    seen.add(d)
                    out.append((t, d))
        except Exception:
            continue
    return out


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


def _sapi_voice(name=""):
    import win32com.client
    voice = win32com.client.Dispatch("SAPI.SpVoice")
    descs = _tokens()
    chosen = next((t for t, d in descs if d == name), None) if name else None
    if chosen is None:
        for key in PREFERRED:
            chosen = next((t for t, d in descs if key in d.lower()), None)
            if chosen is not None:
                break
    if chosen is not None:
        try:
            voice.Voice = chosen
        except Exception:
            pass
    return voice


def list_voices():
    return [d for _t, d in _tokens()]


def synth_to_wav(text, path, voice_name="", rate=1.0):
    """Renders text to a 22 kHz 16-bit mono WAV with Windows' built-in offline voice (SAPI)."""
    import win32com.client
    voice = _sapi_voice(voice_name)
    voice.Rate = max(-10, min(10, int(round((rate - 1.0) * 10))))
    fmt = win32com.client.Dispatch("SAPI.SpAudioFormat")
    fmt.Type = 22                      # SAFT22kHz16BitMono
    stream = win32com.client.Dispatch("SAPI.SpFileStream")
    stream.Format = fmt
    stream.Open(path, 3, False)        # SSFMCreateForWrite
    try:
        voice.AudioOutputStream = stream
        voice.Speak(text, 1)                       # SVSFlagsAsync, then wait with a time limit
        if not voice.WaitUntilDone(15000):
            voice.Speak("", 3)                     # purge: never hang on a broken voice
            raise TimeoutError("voice took too long")
    finally:
        stream.Close()


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
        _stop_sound()

    def _run(self):
        try:
            import pythoncom
            pythoncom.CoInitialize()
        except Exception:
            pass
        path = os.path.join(tempfile.gettempdir(), "jarvis_say.wav")
        try:
            self.voices = list_voices()
        except Exception:
            self.voices = []
        while True:
            gen, text, done = self._q.get()
            if gen != self._gen:
                if done:
                    done()
                continue
            try:
                try:
                    synth_to_wav(text, path, self.store.get("voice_name"), float(self.store.get("speech_rate")))
                except Exception:
                    log.exception("voice %r failed, using the default voice", self.store.get("voice_name"))
                    synth_to_wav(text, path, "Microsoft David Desktop - English (United States)",
                                 float(self.store.get("speech_rate")))
                self._play(path, gen)
            except Exception:
                log.exception("speaking failed")
            self.on_level(0.0)
            if done:
                done()

    def reload(self):
        pass  # the voice is looked up for every sentence

    def _play(self, path, gen):
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
        out = path[:-4] + "_play.wav"
        write_wav(out, pcm, play_rate)
        play_file(out)
        start = time.time()
        total = len(pcm) / play_rate
        while time.time() - start < total + 0.1:
            if gen != self._gen:
                _stop_sound()
                return
            idx = int((time.time() - start) * play_rate / 256)
            self.on_level(float(env[min(idx, len(env) - 1)]))
            time.sleep(0.03)


def write_wav(path, pcm, rate):
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(np.asarray(pcm, np.int16).tobytes())


def play_file(path):
    """Plays a WAV without waiting. Uses Windows' own sound player (not the microphone's audio
    library), so speaking can never disturb listening."""
    try:
        import winsound
        winsound.PlaySound(path, winsound.SND_FILENAME | winsound.SND_ASYNC | winsound.SND_NODEFAULT)
    except ImportError:
        import sounddevice as sd
        with wave.open(path, "rb") as w:
            sd.play(np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16), w.getframerate())


def _stop_sound():
    try:
        import winsound
        winsound.PlaySound(None, winsound.SND_PURGE)
    except ImportError:
        try:
            import sounddevice as sd
            sd.stop()
        except Exception:
            pass
    except Exception:
        pass
