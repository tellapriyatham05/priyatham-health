package com.priyatham.jarvis;

import android.Manifest;
import android.app.Activity;
import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/** The full-screen JARVIS display that appears when you say "Hey Jarvis". */
public class HudActivity extends Activity implements RecognitionListener, NotifListener.ChangeListener {
    static final int CYAN = 0xFF00E5FF, GOLD = 0xFFFFC857, TEXT = 0xFFE6FBFF, DIM = 0xFF7FB8C4;
    static final Typeface HUD_FONT = Typeface.create("sans-serif-condensed", Typeface.NORMAL);

    private final Handler ui = new Handler(Looper.getMainLooper());
    private Prefs prefs;
    private Speaker speaker;
    private Brain brain;
    private SpeechRecognizer recognizer;
    private boolean onDevice;
    // Speech settings to try, best first: [language, offline?]. Error 12/13 moves to the next one.
    private final List<String[]> sttOptions = new ArrayList<String[]>();
    private int sttIndex;

    private FaceView face;
    private TextView clock, date, battery, status, heard, answer, extra;
    private LinearLayout sysPanel, usagePanel, notifList;

    private boolean listening, followUp, closing;
    private int misses;
    private long lastActivity = System.currentTimeMillis();

    // ------------------------------------------------------------------ lifecycle

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        }
        Window w = getWindow();
        w.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON | WindowManager.LayoutParams.FLAG_SHOW_WALLPAPER
                | WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        w.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION);

        prefs = new Prefs(this);
        brain = Brain.get(this);
        speaker = new Speaker(this);
        speaker.setLevelListener(new Speaker.LevelListener() {
            @Override public void onLevel(float level) { face.setLevel(level); }
        });
        buildUi();
        JarvisService.HudVisible.visible = true;
        JarvisService.pauseListening(this);
        NotifListener.setChangeListener(this);
        refreshPanels();
        tick();
        start(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        closing = false;
        start(intent);
    }

    private void start(Intent intent) {
        lastActivity = System.currentTimeMillis();
        String say = intent == null ? null : intent.getStringExtra("say");
        if (say != null) {
            // A reminder firing: announce it and close.
            setStatus("REMINDER");
            answer.setText(say);
            face.setState(FaceView.SPEAKING);
            speaker.speak(say, new Runnable() { @Override public void run() { finishSoon(1500); } });
            return;
        }
        if (!hasMic()) {
            answer.setText("Microphone permission is missing. Open the JARVIS app to allow it.");
            return;
        }
        String greet = prefs.getString("greeting", "Yes, sir?");
        if (prefs.getBool("greet", true) && greet.length() > 0) {
            face.setState(FaceView.SPEAKING);
            answer.setText(greet);
            speaker.speak(greet, new Runnable() { @Override public void run() { listen(false); } });
        } else {
            listen(false);
        }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        ui.removeCallbacksAndMessages(null);
        NotifListener.setChangeListener(null);
        if (recognizer != null) {
            recognizer.destroy();
            recognizer = null;
        }
        speaker.shutdown();
        JarvisService.HudVisible.visible = false;
        JarvisService.resumeListening(this);
    }

    @Override
    public void onBackPressed() {
        brain.clearPending();
        finish();
    }

    private void finishSoon(long delay) {
        closing = true;
        ui.postDelayed(new Runnable() { @Override public void run() { finish(); } }, delay);
    }

    private boolean hasMic() {
        return checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
    }

    // ------------------------------------------------------------------ listening

    private void listen(boolean followUpMode) {
        if (closing || isFinishing()) return;
        followUp = followUpMode;
        speaker.stop();
        if (recognizer == null) createRecognizer();
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        if (sttOptions.isEmpty()) buildSttOptions();
        String[] opt = sttOptions.get(Math.min(sttIndex, sttOptions.size() - 1));
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, opt[0]);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, opt[0]);
        i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        i.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, "1".equals(opt[1]));
        i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3);
        i.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getPackageName());
        i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 1200L);
        listening = true;
        face.setState(FaceView.LISTENING);
        setStatus(followUp ? "ANYTHING ELSE?" : "LISTENING");
        try {
            recognizer.startListening(i);
        } catch (Exception e) {
            listening = false;
            answer.setText("Speech recognition isn't available: " + e.getMessage());
        }
    }

    private void buildSttOptions() {
        sttOptions.clear();
        String saved = prefs.getString("stt_ok", "");
        if (saved.contains("|")) sttOptions.add(saved.split("\\|", 2));
        List<String> langs = new ArrayList<String>();
        langs.add(prefs.language());
        langs.add("en-US");
        langs.add(Locale.getDefault().toLanguageTag());
        langs.add("en-GB");
        for (String offline : new String[]{"1", "0"}) {
            for (String l : langs) {
                if (!l.startsWith("en")) continue;
                boolean dup = false;
                for (String[] o : sttOptions) if (o[0].equals(l) && o[1].equals(offline)) dup = true;
                if (!dup) sttOptions.add(new String[]{l, offline});
            }
        }
        sttIndex = 0;
    }

    private void createRecognizer() {
        onDevice = false;
        if (Build.VERSION.SDK_INT >= 33 && prefs.getBool("on_device_stt", true)
                && SpeechRecognizer.isOnDeviceRecognitionAvailable(this)) {
            try {
                recognizer = SpeechRecognizer.createOnDeviceSpeechRecognizer(this);
                onDevice = true;
            } catch (Exception e) {
                recognizer = null;
            }
        }
        if (recognizer == null) recognizer = SpeechRecognizer.createSpeechRecognizer(this);
        recognizer.setRecognitionListener(this);
    }

    @Override public void onReadyForSpeech(Bundle params) { }
    @Override public void onBeginningOfSpeech() { lastActivity = System.currentTimeMillis(); }
    @Override public void onBufferReceived(byte[] buffer) { }
    @Override public void onEvent(int eventType, Bundle params) { }

    @Override
    public void onRmsChanged(float rmsdB) {
        face.setMicLevel((rmsdB + 2f) / 12f);
    }

    @Override
    public void onEndOfSpeech() {
        face.setState(FaceView.THINKING);
        setStatus("PROCESSING");
    }

    @Override
    public void onPartialResults(Bundle partial) {
        ArrayList<String> r = partial.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        if (r != null && !r.isEmpty() && r.get(0).length() > 0) heard.setText("“" + r.get(0) + "”");
    }

    @Override
    public void onError(int error) {
        listening = false;
        // 12/13: the on-device model isn't installed for this language. Fall back to the normal recognizer.
        if (onDevice && (error == 11 || error == 12 || error == 13 || error == SpeechRecognizer.ERROR_CLIENT || error == SpeechRecognizer.ERROR_SERVER)) {
            prefs.putBool("on_device_stt", false);
            recognizer.destroy();
            recognizer = null;
            listen(followUp);
            return;
        }
        // 12/13: this language/offline combination isn't installed. Try the next one instead of giving up.
        if ((error == 12 || error == 13) && sttIndex + 1 < sttOptions.size()) {
            sttIndex++;
            recognizer.destroy();
            recognizer = null;
            listen(followUp);
            return;
        }
        if (error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY) {
            ui.postDelayed(new Runnable() { @Override public void run() { listen(followUp); } }, 400);
            return;
        }
        if (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) {
            if (followUp || misses >= 1 || brain.hasPending() && misses >= 1) {
                brain.clearPending();
                face.setState(FaceView.IDLE);
                setStatus("STANDING BY");
                finishSoon(1800);
                return;
            }
            misses++;
            say("I didn't catch that{sir}.".replace("{sir}", ", " + prefs.userTitle()), new Runnable() {
                @Override public void run() { listen(false); }
            });
            return;
        }
        if (error == 12 || error == 13) {
            prefs.putString("stt_ok", "");
            answer.setText("No English speech pack is installed. Open the JARVIS app → Setup → Offline speech recognition, "
                    + "or turn on internet once. (Error " + error + ")");
        } else if (error == SpeechRecognizer.ERROR_NETWORK || error == SpeechRecognizer.ERROR_NETWORK_TIMEOUT) {
            answer.setText("Offline speech isn't installed yet. Open the JARVIS app → Setup → Offline speech recognition.");
        } else if (error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) {
            answer.setText("Microphone permission is missing. Open the JARVIS app to allow it.");
        } else {
            answer.setText("Speech recognition error " + error + ".");
        }
        face.setState(FaceView.IDLE);
        setStatus("STANDING BY");
        finishSoon(6000);
    }

    @Override
    public void onResults(Bundle results) {
        listening = false;
        lastActivity = System.currentTimeMillis();
        ArrayList<String> r = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        if (r == null || r.isEmpty() || r.get(0).trim().length() == 0) {
            onError(SpeechRecognizer.ERROR_NO_MATCH);
            return;
        }
        misses = 0;
        // Remember the speech setting that worked so next time starts with it.
        String[] ok = sttOptions.get(Math.min(sttIndex, sttOptions.size() - 1));
        prefs.putString("stt_ok", ok[0] + "|" + ok[1]);
        String text = r.get(0);
        // Of the recognizer's guesses, use the first one JARVIS understands.
        for (String guess : r) {
            if (guess != null && !"unknown".equals(CommandParser.parse(guess).intent)) { text = guess; break; }
        }
        heard.setText("“" + text + "”");
        handle(text);
    }

    // ------------------------------------------------------------------ acting

    private void handle(String text) {
        face.setState(FaceView.THINKING);
        setStatus("PROCESSING");
        final Brain.Reply reply = brain.handle(text);
        extra.setVisibility(reply.display != null ? View.VISIBLE : View.GONE);
        if (reply.display != null) extra.setText(reply.display);
        refreshPanels();
        Runnable done = new Runnable() {
            @Override public void run() { afterReply(reply); }
        };
        if (reply.speech.length() > 0) say(reply.speech, done);
        else done.run();
    }

    private void afterReply(final Brain.Reply reply) {
        if (reply.after != null) {
            KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
            if (km.isKeyguardLocked() && !reply.noUnlock) {
                // Opening apps needs the phone unlocked: ask for the fingerprint/PIN first.
                setStatus("UNLOCK TO CONTINUE");
                closing = true;
                km.requestDismissKeyguard(this, new KeyguardManager.KeyguardDismissCallback() {
                    @Override public void onDismissSucceeded() { reply.after.run(); finishSoon(200); }
                    @Override public void onDismissCancelled() { finishSoon(200); }
                    @Override public void onDismissError() { reply.after.run(); finishSoon(200); }
                });
                return;
            }
            reply.after.run();
        }
        if (reply.close) {
            finishSoon(reply.after != null ? 200 : 700);
        } else if (reply.ask) {
            listen(false);
        } else {
            listen(true);
        }
    }

    private void say(String text, Runnable done) {
        answer.setText(text);
        face.setState(FaceView.SPEAKING);
        setStatus("JARVIS");
        speaker.applyVoice();
        speaker.speak(text, done);
    }

    // ------------------------------------------------------------------ screen

    private int dp(float v) {
        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics());
    }

    private TextView text(float sp, int color, boolean bold) {
        TextView t = new TextView(this);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTextColor(color);
        t.setTypeface(bold ? Typeface.create(HUD_FONT, Typeface.BOLD) : HUD_FONT);
        return t;
    }

    static GradientDrawable panelBg(Context c, float density) {
        GradientDrawable g = new GradientDrawable();
        g.setColor(0x8C02141F);
        g.setCornerRadius(10 * density);
        g.setStroke((int) Math.max(1, density), 0x6600E5FF);
        return g;
    }

    private LinearLayout panel(String title) {
        LinearLayout p = new LinearLayout(this);
        p.setOrientation(LinearLayout.VERTICAL);
        p.setBackground(panelBg(this, getResources().getDisplayMetrics().density));
        p.setPadding(dp(10), dp(8), dp(10), dp(10));
        TextView t = text(11, GOLD, true);
        t.setText(title);
        t.setLetterSpacing(0.18f);
        p.addView(t);
        return p;
    }

    private void buildUi() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xA6000A12);

        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setPadding(dp(14), dp(30), dp(14), dp(16));
        root.addView(col, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        // Top: clock, date, battery, close.
        LinearLayout top = new LinearLayout(this);
        top.setGravity(Gravity.CENTER_VERTICAL);
        LinearLayout timeCol = new LinearLayout(this);
        timeCol.setOrientation(LinearLayout.VERTICAL);
        clock = text(44, TEXT, false);
        clock.setTypeface(Typeface.create("sans-serif-thin", Typeface.NORMAL));
        date = text(13, DIM, false);
        date.setLetterSpacing(0.12f);
        timeCol.addView(clock);
        timeCol.addView(date);
        top.addView(timeCol, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        battery = text(14, CYAN, true);
        top.addView(battery);
        TextView close = text(22, DIM, false);
        close.setText("  ✕");
        close.setPadding(dp(12), dp(4), dp(4), dp(4));
        close.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { brain.clearPending(); finish(); }
        });
        top.addView(close);
        col.addView(top);

        // Face.
        face = new FaceView(this);
        face.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                closing = false;
                misses = 0;
                if (recognizer != null && listening) recognizer.cancel();
                listen(false);
            }
        });
        col.addView(face, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1.25f));

        status = text(12, CYAN, true);
        status.setGravity(Gravity.CENTER);
        status.setLetterSpacing(0.3f);
        col.addView(status);
        heard = text(15, DIM, false);
        heard.setGravity(Gravity.CENTER);
        heard.setMaxLines(2);
        heard.setEllipsize(TextUtils.TruncateAt.END);
        col.addView(heard);
        answer = text(17, TEXT, false);
        answer.setGravity(Gravity.CENTER);
        answer.setMaxLines(4);
        answer.setEllipsize(TextUtils.TruncateAt.END);
        answer.setPadding(0, dp(2), 0, dp(6));
        col.addView(answer);
        extra = text(13, TEXT, false);
        extra.setVisibility(View.GONE);
        extra.setBackground(panelBg(this, getResources().getDisplayMetrics().density));
        extra.setPadding(dp(10), dp(8), dp(10), dp(8));
        col.addView(extra);

        // Panels: system and screen time side by side.
        LinearLayout row = new LinearLayout(this);
        row.setPadding(0, dp(6), 0, dp(6));
        sysPanel = panel("SYSTEM");
        usagePanel = panel("SCREEN TIME");
        LinearLayout.LayoutParams half = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1);
        half.setMargins(0, 0, dp(4), 0);
        row.addView(sysPanel, half);
        LinearLayout.LayoutParams half2 = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1);
        half2.setMargins(dp(4), 0, 0, 0);
        row.addView(usagePanel, half2);
        col.addView(row);

        // Notifications.
        LinearLayout notifPanel = panel("NOTIFICATIONS");
        ScrollView sv = new ScrollView(this);
        notifList = new LinearLayout(this);
        notifList.setOrientation(LinearLayout.VERTICAL);
        sv.addView(notifList);
        notifPanel.addView(sv, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        col.addView(notifPanel, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 0.75f));

        TextView hint = text(11, DIM, false);
        hint.setGravity(Gravity.CENTER);
        hint.setPadding(0, dp(6), 0, 0);
        hint.setText("Tap the face to talk · say \"stop\" to close");
        col.addView(hint);

        setContentView(root);
    }

    private void setStatus(String s) {
        status.setText(s);
    }

    private void tick() {
        Date now = new Date();
        clock.setText(new SimpleDateFormat("h:mm", Locale.getDefault()).format(now));
        date.setText(new SimpleDateFormat("EEEE, d MMMM", Locale.getDefault()).format(now).toUpperCase(Locale.getDefault()));
        int b = SystemStats.batteryPercent(this);
        battery.setText((SystemStats.charging(this) ? "⚡" : "") + b + "%");
        // Close after a quiet spell.
        if (!listening && !speaker.isSpeaking() && System.currentTimeMillis() - lastActivity > 30000) finish();
        ui.postDelayed(new Runnable() { @Override public void run() { tick(); } }, 1000);
        if (now.getTime() / 1000 % 5 == 0) refreshPanels();
    }

    @Override
    public void onNotificationsChanged() {
        ui.post(new Runnable() { @Override public void run() { refreshNotifications(); } });
    }

    private void refreshPanels() {
        refreshSystem();
        refreshUsage();
        refreshNotifications();
    }

    private void refreshSystem() {
        while (sysPanel.getChildCount() > 1) sysPanel.removeViewAt(1);
        long[] ram = SystemStats.ram(this), st = SystemStats.storage();
        int bat = SystemStats.batteryPercent(this);
        addBar(sysPanel, "RAM", SystemStats.gb(ram[0]) + " / " + SystemStats.gb(ram[1]), (float) ram[0] / ram[1]);
        addBar(sysPanel, "STORAGE", SystemStats.gb(st[0]) + " / " + SystemStats.gb(st[1]), (float) st[0] / st[1]);
        addBar(sysPanel, "BATTERY", bat + "% · " + String.format(Locale.US, "%.0f°C", SystemStats.batteryTemp(this)), bat / 100f);
        TextView w = text(11, DIM, false);
        w.setText("WATER " + prefs.waterToday() + " / " + prefs.waterGoal() + " ml"
                + (Actions.wifiOn(this) ? " · WIFI" : "") + (Actions.bluetoothOn() ? " · BT" : ""));
        w.setPadding(0, dp(4), 0, 0);
        sysPanel.addView(w);
    }

    private void refreshUsage() {
        while (usagePanel.getChildCount() > 1) usagePanel.removeViewAt(1);
        if (!SystemStats.hasUsageAccess(this)) {
            TextView t = text(12, DIM, false);
            t.setText("Allow usage access in the JARVIS app to see screen time and limits.");
            usagePanel.addView(t);
            return;
        }
        LinkedHashMap<String, Long> usage = SystemStats.screenTimeToday(this);
        TextView total = text(20, TEXT, false);
        total.setText(SystemStats.duration(SystemStats.totalMillis(usage)));
        usagePanel.addView(total);
        Map<String, Integer> limits = SystemStats.limits(prefs);
        int shown = 0;
        for (Map.Entry<String, Integer> l : limits.entrySet()) {
            if (shown == 3) break;
            long used = SystemStats.usedMillisFor(this, usage, l.getKey());
            long mins = Math.max(0, used) / 60000;
            addBar(usagePanel, l.getKey().toUpperCase(Locale.ROOT), mins + " / " + l.getValue() + "m", mins / (float) l.getValue());
            shown++;
        }
        int k = 0;
        StringBuilder topApps = new StringBuilder();
        for (Map.Entry<String, Long> e : usage.entrySet()) {
            if (k++ == 3) break;
            topApps.append(k > 1 ? " · " : "").append(NotifListener.appLabel(this, e.getKey())).append(" ").append(SystemStats.duration(e.getValue()));
        }
        if (topApps.length() > 0) {
            TextView t = text(11, DIM, false);
            t.setText(topApps);
            t.setMaxLines(2);
            t.setPadding(0, dp(4), 0, 0);
            usagePanel.addView(t);
        }
    }

    private void refreshNotifications() {
        notifList.removeAllViews();
        if (!NotifListener.isConnected()) {
            TextView t = text(12, DIM, false);
            t.setText("Allow notification access in the JARVIS app to see notifications here.");
            notifList.addView(t);
            return;
        }
        List<NotifListener.Item> items = NotifListener.snapshot();
        if (items.isEmpty()) {
            TextView t = text(13, DIM, false);
            t.setText("All clear.");
            notifList.addView(t);
            return;
        }
        int n = 0;
        for (NotifListener.Item it : items) {
            if (n++ == 12) break;
            LinearLayout line = new LinearLayout(this);
            line.setOrientation(LinearLayout.VERTICAL);
            line.setPadding(0, dp(4), 0, dp(4));
            TextView head = text(12, CYAN, true);
            String when = new SimpleDateFormat("h:mm", Locale.getDefault()).format(new Date(it.when));
            head.setText(it.app.toUpperCase(Locale.getDefault()) + "  ·  " + it.title + "   " + when);
            head.setMaxLines(1);
            head.setEllipsize(TextUtils.TruncateAt.END);
            TextView body = text(13, TEXT, false);
            body.setText(it.text);
            body.setMaxLines(2);
            body.setEllipsize(TextUtils.TruncateAt.END);
            line.addView(head);
            line.addView(body);
            notifList.addView(line);
        }
    }

    private void addBar(LinearLayout p, String label, String value, float fraction) {
        LinearLayout r = new LinearLayout(this);
        r.setPadding(0, dp(3), 0, 0);
        TextView l = text(11, DIM, true);
        l.setText(label);
        l.setLetterSpacing(0.1f);
        TextView v = text(11, TEXT, false);
        v.setText(value);
        r.addView(l, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        r.addView(v);
        p.addView(r);
        BarView bar = new BarView(this, fraction);
        p.addView(bar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(5)));
    }

    /** A thin HUD progress bar; turns gold, then red, as it fills. */
    static final class BarView extends View {
        private final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final RectF r = new RectF();
        private final float fraction;

        BarView(Context c, float fraction) {
            super(c);
            this.fraction = Math.max(0, Math.min(1, fraction));
        }

        @Override
        protected void onDraw(Canvas c) {
            float h = getHeight(), w = getWidth(), rad = h / 2;
            r.set(0, 0, w, h);
            p.setColor(0x3300E5FF);
            c.drawRoundRect(r, rad, rad, p);
            r.set(0, 0, Math.max(h, w * fraction), h);
            p.setColor(fraction > 0.9f ? 0xFFFF5370 : fraction > 0.7f ? GOLD : CYAN);
            c.drawRoundRect(r, rad, rad, p);
        }
    }

    static int color(int a, int rgb) {
        return Color.argb(a, Color.red(rgb), Color.green(rgb), Color.blue(rgb));
    }
}
