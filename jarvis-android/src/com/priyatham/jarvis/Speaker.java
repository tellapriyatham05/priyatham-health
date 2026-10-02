package com.priyatham.jarvis;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioTrack;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * JARVIS's voice. Android's offline text-to-speech renders the words to a file, a small
 * filter adds the robotic/metallic colour, and the loudness of each moment is reported so
 * the face can move its mouth in sync.
 */
public final class Speaker {
    public interface LevelListener {
        void onLevel(float level);
    }

    /** Voice presets: TTS pitch, ring-modulation mix and frequency, comb-echo delay (ms) and feedback. */
    static float[] preset(String mode) {
        if ("robot".equals(mode)) return new float[]{0.72f, 0.55f, 52f, 9f, 0.45f};
        if ("calm".equals(mode)) return new float[]{0.95f, 0f, 0f, 0f, 0f};
        if ("professional".equals(mode)) return new float[]{1.0f, 0f, 0f, 0f, 0f};
        return new float[]{0.86f, 0.18f, 68f, 6f, 0.32f}; // classic JARVIS
    }

    private static final String[] PREFERRED_VOICES = {
        "en-gb-x-rjs-local", "en-gb-x-gbd-local", "en-gb-x-gbb-local", "en-us-x-iom-local",
        "en-us-x-tpd-local", "en-in-x-ene-local", "en-in-x-end-local"
    };

    private final Context ctx;
    private final Prefs prefs;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final AudioManager audio;
    private TextToSpeech tts;
    private boolean ready;
    private LevelListener levelListener;
    private volatile AudioTrack track;
    private volatile int generation;
    private Runnable pendingDone;
    private String pendingText;
    private AudioFocusRequest focus;

    public Speaker(Context c) {
        ctx = c.getApplicationContext();
        prefs = new Prefs(ctx);
        audio = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
        tts = new TextToSpeech(ctx, new TextToSpeech.OnInitListener() {
            @Override
            public void onInit(int status) {
                if (status != TextToSpeech.SUCCESS) return;
                ready = true;
                applyVoice();
                if (pendingText != null) {
                    String t = pendingText;
                    Runnable d = pendingDone;
                    pendingText = null;
                    pendingDone = null;
                    speak(t, d);
                }
            }
        });
        tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            @Override public void onStart(String id) { }

            @Override
            public void onDone(String id) {
                if (id.startsWith("direct")) {
                    finish(Integer.parseInt(id.substring(6)));
                    return;
                }
                final int gen = Integer.parseInt(id);
                if (gen != generation) return;
                new Thread(new Runnable() {
                    @Override public void run() { playProcessed(gen); }
                }, "jarvis-voice").start();
            }

            @Override
            public void onError(String id) {
                if (id.startsWith("direct")) {
                    finish(Integer.parseInt(id.substring(6)));
                    return;
                }
                int gen = Integer.parseInt(id);
                if (gen != generation) return;
                speakDirect(lastText, gen);
            }
        });
    }

    public void setLevelListener(LevelListener l) {
        levelListener = l;
    }

    public void applyVoice() {
        if (!ready) return;
        String lang = prefs.language();
        Locale loc = Locale.forLanguageTag(lang);
        tts.setLanguage(loc);
        Voice chosen = null;
        Set<Voice> voices = null;
        try {
            voices = tts.getVoices();
        } catch (Exception ignored) { }
        if (voices != null) {
            String want = prefs.voiceName();
            for (Voice v : voices) if (v.getName().equals(want)) chosen = v;
            if (chosen == null) {
                for (String name : PREFERRED_VOICES) {
                    for (Voice v : voices) {
                        if (v.getName().equals(name) && !v.isNetworkConnectionRequired()) { chosen = v; break; }
                    }
                    if (chosen != null) break;
                }
            }
        }
        if (chosen != null) tts.setVoice(chosen);
        float[] p = preset(prefs.voiceMode());
        tts.setPitch(p[0]);
        tts.setSpeechRate(prefs.speechRate());
    }

    /** Offline English voices installed on the phone, for the voice picker. */
    public List<String> voiceNames() {
        List<String> out = new ArrayList<String>();
        if (!ready) return out;
        try {
            for (Voice v : tts.getVoices()) {
                if (v.getLocale().getLanguage().equals("en") && !v.isNetworkConnectionRequired()) out.add(v.getName());
            }
        } catch (Exception ignored) { }
        java.util.Collections.sort(out);
        return out;
    }

    private String lastText = "";

    /** Speaks the text; onDone runs on the main thread when finished (or interrupted). */
    public void speak(String text, Runnable onDone) {
        stop();
        if (!ready) {
            pendingText = text;
            pendingDone = onDone;
            return;
        }
        lastText = text;
        pendingDone = onDone;
        int gen = ++generation;
        requestFocus();
        File f = new File(ctx.getCacheDir(), "say.wav");
        Bundle params = new Bundle();
        int r = tts.synthesizeToFile(text, params, f, String.valueOf(gen));
        if (r != TextToSpeech.SUCCESS) speakDirect(text, gen);
    }

    private void speakDirect(final String text, final int gen) {
        // Plain TTS playback, used if rendering to a file fails. The mouth gets a gentle pulse.
        Bundle params = new Bundle();
        tts.speak(text, TextToSpeech.QUEUE_FLUSH, params, "direct" + gen);
        final long start = System.currentTimeMillis();
        main.post(new Runnable() {
            @Override
            public void run() {
                if (gen != generation) return;
                double t = (System.currentTimeMillis() - start) / 1000.0;
                float lvl = (float) (0.35 + 0.3 * Math.abs(Math.sin(t * 11)) * Math.abs(Math.sin(t * 3.7)));
                if (levelListener != null) levelListener.onLevel(lvl);
                main.postDelayed(this, 40);
            }
        });
    }

    private void playProcessed(final int gen) {
        File f = new File(ctx.getCacheDir(), "say.wav");
        short[] pcm;
        int rate;
        try {
            Wav w = Wav.read(f);
            pcm = w.samples;
            rate = w.sampleRate;
        } catch (IOException e) {
            main.post(new Runnable() { @Override public void run() { speakDirect(lastText, gen); } });
            return;
        }
        float[] p = preset(prefs.voiceMode());
        pcm = robotize(pcm, rate, p[1], p[2], p[3], p[4]);
        final float[] env = envelope(pcm, 256);

        int minBuf = AudioTrack.getMinBufferSize(rate, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT);
        AudioTrack t = new AudioTrack.Builder()
                .setAudioAttributes(new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ASSISTANT)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                .setAudioFormat(new AudioFormat.Builder().setSampleRate(rate)
                        .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                        .setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
                .setBufferSizeInBytes(Math.max(minBuf, rate / 5 * 2))
                .setTransferMode(AudioTrack.MODE_STREAM)
                .build();
        if (gen != generation) { t.release(); return; }
        track = t;
        t.play();
        final AudioTrack playing = t;
        main.post(new Runnable() {
            @Override
            public void run() {
                if (gen != generation || track != playing) return;
                int pos;
                try {
                    pos = playing.getPlaybackHeadPosition();
                } catch (IllegalStateException e) {
                    return;
                }
                int idx = Math.min(env.length - 1, pos / 256);
                if (levelListener != null && idx >= 0) levelListener.onLevel(env[idx]);
                main.postDelayed(this, 30);
            }
        });
        int off = 0;
        while (off < pcm.length && gen == generation) {
            int n = Math.min(2048, pcm.length - off);
            int w = t.write(pcm, off, n);
            if (w <= 0) break;
            off += w;
        }
        if (gen == generation) {
            // Wait for the tail of the buffer to finish playing.
            long deadline = System.currentTimeMillis() + 3000;
            try {
                while (gen == generation && t.getPlaybackHeadPosition() < pcm.length && System.currentTimeMillis() < deadline) {
                    Thread.sleep(20);
                }
            } catch (Exception ignored) { }
        }
        try { t.stop(); } catch (IllegalStateException ignored) { }
        t.release();
        if (track == t) track = null;
        finish(gen);
    }

    private void finish(final int gen) {
        main.post(new Runnable() {
            @Override
            public void run() {
                if (gen != generation) return;
                generation++; // ends the mouth animation loops for this utterance
                if (levelListener != null) levelListener.onLevel(0);
                abandonFocus();
                Runnable d = pendingDone;
                pendingDone = null;
                if (d != null) d.run();
            }
        });
    }

    public boolean isSpeaking() {
        return pendingDone != null || track != null;
    }

    /** Stops talking without running the onDone callback. */
    public void stop() {
        generation++;
        pendingDone = null;
        AudioTrack t = track;
        track = null;
        if (t != null) {
            try { t.pause(); t.flush(); } catch (IllegalStateException ignored) { }
        }
        if (ready) tts.stop();
        if (levelListener != null) levelListener.onLevel(0);
    }

    public void shutdown() {
        stop();
        abandonFocus();
        tts.shutdown();
    }

    private void requestFocus() {
        focus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                .setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANT)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                .build();
        audio.requestAudioFocus(focus);
    }

    private void abandonFocus() {
        if (focus != null) audio.abandonAudioFocusRequest(focus);
        focus = null;
    }

    // ---- Signal processing (plain Java) ----

    /** Ring modulation (the classic sci-fi robot buzz) plus a short metallic comb echo. */
    static short[] robotize(short[] in, int rate, float ringMix, float ringHz, float combMs, float combFb) {
        if (ringMix <= 0 && combMs <= 0) return in;
        float[] buf = new float[in.length];
        int d = (int) (rate * combMs / 1000f);
        double phase = 0, step = 2 * Math.PI * ringHz / rate;
        float peak = 1;
        for (int i = 0; i < in.length; i++) {
            float x = in[i] / 32768f;
            float ring = (float) Math.sin(phase);
            phase += step;
            float y = x * (1 - ringMix) + x * ring * ringMix * 1.6f;
            if (d > 0 && i >= d) y += buf[i - d] * combFb;
            buf[i] = y;
            peak = Math.max(peak, Math.abs(y));
        }
        short[] out = new short[in.length];
        float gain = 0.95f / peak;
        if (peak <= 1) gain = 0.95f;
        for (int i = 0; i < in.length; i++) out[i] = (short) Math.max(-32768, Math.min(32767, buf[i] * gain * 32767));
        return out;
    }

    /** Loudness per block of samples, scaled 0..1 for the mouth. */
    static float[] envelope(short[] pcm, int block) {
        int n = Math.max(1, (pcm.length + block - 1) / block);
        float[] env = new float[n];
        float max = 1e-6f;
        for (int b = 0; b < n; b++) {
            double sum = 0;
            int end = Math.min(pcm.length, (b + 1) * block);
            for (int i = b * block; i < end; i++) sum += (double) pcm[i] * pcm[i];
            env[b] = (float) Math.sqrt(sum / Math.max(1, end - b * block));
            max = Math.max(max, env[b]);
        }
        for (int b = 0; b < n; b++) env[b] = Math.min(1f, env[b] / max * 1.15f);
        return env;
    }

    /** Minimal reader for the 16-bit PCM WAV files Android's TTS writes. */
    static final class Wav {
        short[] samples;
        int sampleRate;

        static Wav read(File f) throws IOException {
            byte[] b = new byte[(int) f.length()];
            FileInputStream in = new FileInputStream(f);
            try {
                int off = 0;
                while (off < b.length) {
                    int r = in.read(b, off, b.length - off);
                    if (r < 0) break;
                    off += r;
                }
            } finally {
                in.close();
            }
            if (b.length < 44 || b[0] != 'R' || b[1] != 'I' || b[2] != 'F' || b[3] != 'F') throw new IOException("not a wav");
            Wav w = new Wav();
            int pos = 12, channels = 1, bits = 16, dataOff = -1, dataLen = 0;
            while (pos + 8 <= b.length) {
                String id = new String(b, pos, 4, "US-ASCII");
                int len = le32(b, pos + 4);
                if (id.equals("fmt ")) {
                    channels = le16(b, pos + 10);
                    w.sampleRate = le32(b, pos + 12);
                    bits = le16(b, pos + 22);
                } else if (id.equals("data")) {
                    dataOff = pos + 8;
                    dataLen = Math.min(len < 0 ? Integer.MAX_VALUE : len, b.length - dataOff);
                    break;
                }
                pos += 8 + len + (len & 1);
            }
            if (dataOff < 0 || bits != 16 || w.sampleRate <= 0) throw new IOException("unsupported wav");
            int frames = dataLen / 2 / channels;
            w.samples = new short[frames];
            for (int i = 0; i < frames; i++) {
                int p = dataOff + i * 2 * channels;
                w.samples[i] = (short) ((b[p] & 0xff) | (b[p + 1] << 8));
            }
            return w;
        }

        private static int le16(byte[] b, int p) { return (b[p] & 0xff) | ((b[p + 1] & 0xff) << 8); }
        private static int le32(byte[] b, int p) {
            return (b[p] & 0xff) | ((b[p + 1] & 0xff) << 8) | ((b[p + 2] & 0xff) << 16) | ((b[p + 3] & 0xff) << 24);
        }
    }
}
