package com.priyatham.jarvis;

import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtException;
import ai.onnxruntime.OrtSession;

import java.nio.FloatBuffer;
import java.util.Collections;

/**
 * Offline "Hey Jarvis" detector using the openWakeWord models (melspectrogram → speech
 * embedding → hey_jarvis classifier). Feed it 16 kHz mono audio in 1280-sample frames
 * (80 ms); it returns the wake-word score for each frame, 0..1.
 */
public final class WakeWordEngine implements AutoCloseable {
    public static final int SAMPLE_RATE = 16000;
    public static final int FRAME = 1280;

    private static final int MEL_CONTEXT = 160 * 3;  // extra samples so each frame yields 8 mel rows
    private static final int MEL_WINDOW = 76;        // mel rows per embedding
    private static final int MEL_BINS = 32;
    private static final int EMB = 96;
    private static final int EMB_WINDOW = 16;        // embeddings per classifier run

    private final OrtEnvironment env;
    private final OrtSession mel, embedding, keyword;
    private final String melIn, embIn, kwIn;

    private final float[] audio = new float[FRAME + MEL_CONTEXT];
    private final float[][] melRows = new float[MEL_WINDOW][MEL_BINS];
    private final float[][] embeddings = new float[EMB_WINDOW][EMB];

    public WakeWordEngine(byte[] melModel, byte[] embeddingModel, byte[] keywordModel) throws OrtException {
        env = OrtEnvironment.getEnvironment();
        OrtSession.SessionOptions opts = new OrtSession.SessionOptions();
        opts.setIntraOpNumThreads(1);
        opts.setInterOpNumThreads(1);
        mel = env.createSession(melModel, opts);
        embedding = env.createSession(embeddingModel, opts);
        keyword = env.createSession(keywordModel, opts);
        melIn = mel.getInputNames().iterator().next();
        embIn = embedding.getInputNames().iterator().next();
        kwIn = keyword.getInputNames().iterator().next();
        reset();
    }

    /** Clears all history, e.g. after a detection so the same words don't trigger twice. */
    public void reset() {
        java.util.Arrays.fill(audio, 0f);
        for (float[] row : melRows) java.util.Arrays.fill(row, 1f);
        for (float[] e : embeddings) java.util.Arrays.fill(e, 0f);
    }

    /** @param pcm exactly {@link #FRAME} 16-bit samples. */
    public float process(short[] pcm) throws OrtException {
        // Slide the audio window: keep the last 480 samples, append the new frame.
        System.arraycopy(audio, FRAME, audio, 0, MEL_CONTEXT);
        for (int i = 0; i < FRAME; i++) audio[MEL_CONTEXT + i] = pcm[i];

        float[] melOut;
        OnnxTensor in = OnnxTensor.createTensor(env, FloatBuffer.wrap(audio), new long[]{1, audio.length});
        try {
            OrtSession.Result r = mel.run(Collections.singletonMap(melIn, in));
            try {
                melOut = toArray((OnnxTensor) r.get(0));
            } finally {
                r.close();
            }
        } finally {
            in.close();
        }
        int newRows = melOut.length / MEL_BINS;
        int keep = MEL_WINDOW - newRows;
        for (int i = 0; i < keep; i++) System.arraycopy(melRows[i + newRows], 0, melRows[i], 0, MEL_BINS);
        for (int i = 0; i < newRows; i++) {
            float[] row = melRows[keep + i];
            for (int j = 0; j < MEL_BINS; j++) row[j] = melOut[i * MEL_BINS + j] / 10f + 2f;
        }

        float[] flatMel = new float[MEL_WINDOW * MEL_BINS];
        for (int i = 0; i < MEL_WINDOW; i++) System.arraycopy(melRows[i], 0, flatMel, i * MEL_BINS, MEL_BINS);
        float[] emb;
        in = OnnxTensor.createTensor(env, FloatBuffer.wrap(flatMel), new long[]{1, MEL_WINDOW, MEL_BINS, 1});
        try {
            OrtSession.Result r = embedding.run(Collections.singletonMap(embIn, in));
            try {
                emb = toArray((OnnxTensor) r.get(0));
            } finally {
                r.close();
            }
        } finally {
            in.close();
        }
        for (int i = 0; i < EMB_WINDOW - 1; i++) System.arraycopy(embeddings[i + 1], 0, embeddings[i], 0, EMB);
        System.arraycopy(emb, 0, embeddings[EMB_WINDOW - 1], 0, EMB);

        float[] flatEmb = new float[EMB_WINDOW * EMB];
        for (int i = 0; i < EMB_WINDOW; i++) System.arraycopy(embeddings[i], 0, flatEmb, i * EMB, EMB);
        in = OnnxTensor.createTensor(env, FloatBuffer.wrap(flatEmb), new long[]{1, EMB_WINDOW, EMB});
        try {
            OrtSession.Result r = keyword.run(Collections.singletonMap(kwIn, in));
            try {
                return toArray((OnnxTensor) r.get(0))[0];
            } finally {
                r.close();
            }
        } finally {
            in.close();
        }
    }

    private static float[] toArray(OnnxTensor t) {
        FloatBuffer fb = t.getFloatBuffer();
        float[] out = new float[fb.remaining()];
        fb.get(out);
        return out;
    }

    @Override
    public void close() {
        try { mel.close(); } catch (OrtException ignored) { }
        try { embedding.close(); } catch (OrtException ignored) { }
        try { keyword.close(); } catch (OrtException ignored) { }
    }
}
