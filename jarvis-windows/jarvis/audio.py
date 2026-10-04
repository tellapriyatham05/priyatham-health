"""Microphone, wake word ("Hey Jarvis" and "Jarvis"), and offline speech-to-text.

One thread reads the microphone in 80 ms frames (16 kHz mono) and runs in one of two modes:
WAKE (waiting for the wake word) or COMMAND (recording what you say until you stop talking).
Nothing is recorded to disk or sent anywhere.
"""
import json
import os
import queue
import threading
import time

import numpy as np

from .logs import log

SAMPLE_RATE = 16000
FRAME = 1280


def resource(*parts):
    """Path to a bundled file (works from source and from the packaged .exe)."""
    import sys
    base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    return os.path.join(base, *parts)


class WakeWord:
    """openWakeWord "hey jarvis" on ONNX Runtime (same pipeline as the phone app)."""

    def __init__(self):
        import onnxruntime as ort
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = 1
        opts.inter_op_num_threads = 1
        d = resource("models", "wake")
        self.mel = ort.InferenceSession(os.path.join(d, "melspectrogram.onnx"), opts, providers=["CPUExecutionProvider"])
        self.emb = ort.InferenceSession(os.path.join(d, "embedding_model.onnx"), opts, providers=["CPUExecutionProvider"])
        self.kw = ort.InferenceSession(os.path.join(d, "hey_jarvis_v0.1.onnx"), opts, providers=["CPUExecutionProvider"])
        self.mel_in = self.mel.get_inputs()[0].name
        self.emb_in = self.emb.get_inputs()[0].name
        self.kw_in = self.kw.get_inputs()[0].name
        self.reset()

    def reset(self):
        self.audio = np.zeros(FRAME + 480, np.float32)
        self.mels = np.ones((76, 32), np.float32)
        self.embs = np.zeros((16, 96), np.float32)

    def process(self, pcm16):
        self.audio = np.concatenate([self.audio[FRAME:], pcm16.astype(np.float32)])
        mel = self.mel.run(None, {self.mel_in: self.audio[None, :]})[0].reshape(-1, 32) / 10.0 + 2.0
        self.mels = np.vstack([self.mels, mel])[-76:]
        e = self.emb.run(None, {self.emb_in: self.mels[None, :, :, None].astype(np.float32)})[0].reshape(-1)
        self.embs = np.vstack([self.embs[1:], e[None, :]])
        return float(self.kw.run(None, {self.kw_in: self.embs[None].astype(np.float32)})[0].reshape(-1)[0])


class Listener:
    """Owns the microphone. Calls on_wake() and on_partial/on_final(text) from its thread."""

    def __init__(self, store, on_wake, on_partial, on_final, on_level, on_status, understood=None):
        self.store = store
        self.on_wake, self.on_partial, self.on_final = on_wake, on_partial, on_final
        self.on_level, self.on_status = on_level, on_status
        self.mode = "wake"            # wake | command | muted
        self.paused = False
        self._q = queue.Queue(maxsize=200)
        self._stop = threading.Event()
        self.wake = None
        self.model = None
        self.whisper = None
        self.kws = None
        self.error = None
        self._cmd_audio = []
        self._cmd_started = 0.0
        self._last_voice = 0.0
        self._heard_voice = False
        self._rec = None
        self._followup = False
        self.noise_floor = 0.0
        self.level_now = 0.0
        self.reopen = False
        self.mode_since = time.time()
        # Returns True when JARVIS already understands the quick transcript (then Whisper is skipped).
        self.understood = understood or (lambda text: False)
        # choose(candidates) picks the transcript to act on; vocabulary() lists JARVIS's own words.
        self.choose = None
        self.vocabulary = lambda: []
        self._grec = None
        self._grammar_key = None
        self._preroll = []
        self._kws_seen = 0
        self.frames = 0

    # ---------------------------------------------------------------- setup
    def load(self):
        from vosk import KaldiRecognizer, Model, SetLogLevel
        SetLogLevel(-1)
        self.wake = WakeWord()
        name = {"en-us": "vosk-model-small-en-us-0.15"}.get(self.store.get("stt_model"), "vosk-model-small-en-in-0.4")
        path = resource("models", name)
        if not os.path.isdir(path):
            path = resource("models", "vosk-model-small-en-us-0.15")
        self.model = Model(path)
        self._KaldiRecognizer = KaldiRecognizer
        self.kws = KaldiRecognizer(self.model, SAMPLE_RATE, json.dumps(["jarvis", "hey jarvis", "okay jarvis", "[unk]"]))
        self.kws.SetWords(True)
        if self.store.get("accurate_mode"):
            self.load_whisper()

    def load_whisper(self):
        wdir = resource("models", "whisper-base.en")
        if not os.path.isdir(wdir):
            return
        try:
            from faster_whisper import WhisperModel
            self.whisper = WhisperModel(wdir, device="cpu", compute_type="int8", cpu_threads=4)
        except Exception as e:  # accurate mode is optional
            self.whisper = None
            self.error = f"Accurate mode unavailable: {e}"

    def start(self):
        threading.Thread(target=self._run, name="jarvis-mic", daemon=True).start()

    def stop(self):
        self._stop.set()

    # ---------------------------------------------------------------- control (any thread)
    def listen_command(self, followup=False):
        """Switch to recording a command (after the wake word or a tap)."""
        self._cmd_audio = []
        self._cmd_started = time.time()
        self._last_voice = time.time()
        self._heard_voice = False
        self._followup = followup
        self._last_partial = ""
        self.mode_since = time.time()
        self._rec = self._KaldiRecognizer(self.model, SAMPLE_RATE) if self.model else None
        if self._rec:
            self._rec.SetWords(False)
        self._grec = self._grammar_recognizer()
        self.mode = "command"

    def _grammar_recognizer(self):
        """A second recogniser that may only use JARVIS's own command words. Far more accurate for
        commands like "what is the time" than free dictation, especially with an accent or noise."""
        if not self.model:
            return None
        try:
            words = sorted({w for w in self.vocabulary() if w})
            key = hash(tuple(words))
            if self._grec_cached is None or key != self._grammar_key:
                self._grec_cached = self._KaldiRecognizer(self.model, SAMPLE_RATE, json.dumps(words + ["[unk]"]))
                self._grammar_key = key
            else:
                self._grec_cached.Reset()
            return self._grec_cached
        except Exception:
            return None

    _grec_cached = None

    def back_to_wake(self):
        if self.wake:
            self.wake.reset()
        if self.kws:
            self.kws.Reset()
        self.mode = "wake"
        self.mode_since = time.time()

    def mute(self):
        """Ignore the mic while JARVIS talks, so it doesn't hear itself."""
        self.mode = "muted"
        self.mode_since = time.time()

    # ---------------------------------------------------------------- mic thread
    def _callback(self, indata, frames, t, status):
        try:
            self._q.put_nowait(indata[:, 0].copy())
        except queue.Full:
            pass

    def _run(self):
        import sounddevice as sd
        try:
            if self.model is None:
                self.on_status("Loading offline speech models...")
                self.load()
        except Exception as e:
            self.error = f"Speech models failed to load: {e}"
            self.on_status(self.error)
            return
        self.on_status("ready")
        while not self._stop.is_set():
            try:
                device = self.store.get("mic_device") or None
                with sd.InputStream(samplerate=SAMPLE_RATE, channels=1, dtype="int16", blocksize=FRAME,
                                    callback=self._callback, device=device):
                    self.error = None
                    self.on_status("listening")
                    self.reopen = False
                    log.info("microphone open: %s", device or "Windows default")
                    empty, beat = 0, time.time()
                    while not self._stop.is_set() and not self.reopen:
                        try:
                            frame = self._q.get(timeout=1.0)
                        except queue.Empty:
                            empty += 1
                            if empty >= 3:      # the microphone stopped sending sound: open it again
                                log.warning("microphone went silent (no audio for 3 s), reopening")
                                break
                            continue
                        empty = 0
                        self.frames += 1
                        if time.time() - beat > 60:
                            beat = time.time()
                            log.info("alive: mode=%s level=%.3f room=%.3f paused=%s", self.mode, self.level_now,
                                     self.noise_floor, self.paused)
                        try:
                            self._handle(frame)
                        except Exception:
                            log.exception("listener frame failed (mode=%s)", self.mode)
                            self.back_to_wake()
            except Exception as e:
                self.error = f"Microphone problem: {e}"
                self.on_status(self.error)
                time.sleep(3)

    def _handle(self, frame):
        level = float(np.sqrt(np.mean(frame.astype(np.float32) ** 2)) / 3000.0)
        self.level_now = level
        if self.paused or self.mode == "muted":
            return
        if self.mode == "wake":
            # Slowly follow the quietest recent level = the room's background noise.
            self.noise_floor = min(level, self.noise_floor * 1.02 + 0.0005) if self.noise_floor else level
            score = self.wake.process(frame)
            hit = score >= float(self.store.get("wake_threshold"))
            self._preroll = (self._preroll + [frame])[-6:]
            if not hit and self.store.get("wake_plain_jarvis"):
                hit = self._plain_jarvis(frame)
            if hit:
                log.info("wake word heard (score %.2f)", score)
                self.wake.reset()
                self.kws.Reset()
                self._kws_seen = 0
                # Start recording the command straight away ("Jarvis, open notepad" in one breath).
                pre = self._preroll[-3:]
                self.listen_command(False)
                for f in pre:                    # the start of the command may already be in these frames
                    self._feed_command(f)
                self.on_wake()
            return
        # Command mode: collect audio until a pause after speech.
        self.on_level(min(1.0, level))
        now = time.time()
        if self._feed_command(frame):
            return
        # Speech = clearly louder than the room's background noise (fans, music, a video).
        voice_threshold = max(0.06, self.noise_floor * 2.5)
        if level > voice_threshold and now - self._cmd_started > 0.25:   # ignore the wake chime
            self._last_voice = now
            self._heard_voice = True
        waited = now - self._cmd_started
        if (self._heard_voice and now - self._last_voice > 0.8) or waited > 7 or (not self._heard_voice and waited > (4 if self._followup else 5)):
            text = json.loads(self._rec.FinalResult()).get("text", "") if self._rec else ""
            self._finish(text)

    def _feed_command(self, frame):
        """Adds one frame to the command recording. Returns True when the command was finished."""
        now = time.time()
        self._cmd_audio.append(frame)
        if self._grec is not None:
            try:
                self._grec.AcceptWaveform(frame.tobytes())
            except Exception:
                self._grec = None
        if self._rec and self._rec.AcceptWaveform(frame.tobytes()):
            text = json.loads(self._rec.Result()).get("text", "")
            if text.strip() and text.strip() not in ("jarvis", "hey jarvis", "the", "huh"):
                self._finish(text)
                return True
        elif self._rec:
            partial = json.loads(self._rec.PartialResult()).get("partial", "")
            # Only a *new* word counts as still talking; the partial text stays the same during silence.
            if partial and partial != self._last_partial and partial not in ("jarvis", "hey jarvis", "hey", "the"):
                self._last_partial = partial
                self._heard_voice = True
                self._last_voice = now
                self.on_partial(partial)
        return False

    def _plain_jarvis(self, frame):
        """"Jarvis" on its own. Checked as soon as the word appears, instead of waiting for a pause
        (with a TV or music on there may never be one)."""
        if self.kws.AcceptWaveform(frame.tobytes()):
            words = json.loads(self.kws.Result()).get("result", [])
            self._kws_seen = 0
            return self._confident_jarvis(words)
        partial = json.loads(self.kws.PartialResult()).get("partial", "")
        if "jarvis" in partial.split():
            self._kws_seen += 1
            if self._kws_seen >= 3:          # let the word finish (~0.2 s), then score it
                words = json.loads(self.kws.FinalResult()).get("result", [])
                self.kws.Reset()
                self._kws_seen = 0
                return self._confident_jarvis(words)
        else:
            self._kws_seen = 0
            if len(partial.split()) > 12:    # long stretch of other speech: start fresh
                self.kws.Reset()
        return False

    @staticmethod
    def _confident_jarvis(words):
        # The grammar only knows "jarvis"; everything else becomes [unk]. A clear "jarvis" scores high.
        return any(w.get("word") == "jarvis" and w.get("conf", 0) >= 0.9 for w in words)

    def _finish(self, vosk_text):
        self.mode = "muted"
        self.mode_since = time.time()
        self.last_heard_voice = self._heard_voice
        audio = np.concatenate(self._cmd_audio) if self._cmd_audio else np.zeros(0, np.int16)
        quick = vosk_text.strip()
        grammar = ""
        if self._grec is not None:
            try:
                grammar = json.loads(self._grec.FinalResult()).get("text", "").replace("[unk]", "").strip()
                grammar = " ".join(grammar.split())
            except Exception:
                grammar = ""
        cache = {}

        def accurate():
            """Whisper transcript (computed at most once, only when needed)."""
            if "a" in cache:
                return cache["a"]
            cache["a"] = ""
            if self.whisper is None or len(audio) < SAMPLE_RATE * 0.4 or not (quick or grammar or self._heard_voice):
                return ""
            try:
                clip = audio[-SAMPLE_RATE * 7:]
                segs, _ = self.whisper.transcribe(
                    clip.astype(np.float32) / 32768.0, language="en", beam_size=5, vad_filter=False,
                    without_timestamps=True, condition_on_previous_text=False,
                    initial_prompt="Jarvis commands: what is the time, what's the date, open Chrome, open VS Code, "
                                   "volume up, wifi off, play music on YouTube, set a timer for five minutes, hide.")
                # Whisper's own rule: drop a segment only when it is both probably silence and low-confidence.
                good = [s_ for s_ in segs if not (s_.no_speech_prob > 0.6 and s_.avg_logprob < -1.0)]
                text = " ".join(s_.text for s_ in good).strip()
                if text.lower().strip(" .!") in ("you", "thank you", "thanks for watching", "thank you for watching", ""):
                    text = ""
                cache["a"] = text
            except Exception:
                pass
            return cache["a"]

        if self.choose:
            text = self.choose(quick, grammar, accurate)
        else:
            text = quick if quick and self.understood(quick) else (accurate() or quick)
        self.last_candidates = {"quick": quick, "grammar": grammar, "accurate": cache.get("a", "")}
        log.info("heard quick=%r words=%r accurate=%r -> %r (%.1fs of audio)", quick, grammar, cache.get("a", ""), text,
                 len(audio) / SAMPLE_RATE)
        self.on_final(text or "")
