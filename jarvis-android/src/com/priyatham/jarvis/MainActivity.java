package com.priyatham.jarvis;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ComponentName;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.SeekBar;
import android.widget.TextView;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/** Setup and settings: permissions, voice and personality, routines, limits, memory. */
public class MainActivity extends Activity {
    private static final int CYAN = HudActivity.CYAN, GOLD = HudActivity.GOLD, TEXT = HudActivity.TEXT, DIM = HudActivity.DIM;
    private static final String[] RUNTIME = {
        Manifest.permission.RECORD_AUDIO, Manifest.permission.CALL_PHONE,
        Manifest.permission.READ_CONTACTS, Manifest.permission.SEND_SMS
    };

    private Prefs prefs;
    private Speaker speaker;
    private LinearLayout setupList;
    private TextView serviceStatus, testReply, memoryText, logText;
    private Button serviceButton;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        prefs = new Prefs(this);
        speaker = new Speaker(this);
        JarvisService.createChannels(this);
        buildUi();
        if (prefs.wakeEnabled() && hasAll(RUNTIME)) JarvisService.start(this);
    }

    @Override
    protected void onResume() {
        super.onResume();
        refresh();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        speaker.shutdown();
    }

    private boolean hasAll(String[] perms) {
        for (String p : perms) if (checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) return false;
        return true;
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED && prefs.wakeEnabled()) {
            JarvisService.start(this);
        }
        refresh();
    }

    // ------------------------------------------------------------------ helpers

    private int dp(float v) {
        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics());
    }

    private TextView text(String s, float sp, int color, boolean bold) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTextColor(color);
        t.setTypeface(bold ? Typeface.create(HudActivity.HUD_FONT, Typeface.BOLD) : HudActivity.HUD_FONT);
        return t;
    }

    private Button button(String s, View.OnClickListener l) {
        Button btn = new Button(this);
        btn.setText(s);
        btn.setAllCaps(false);
        btn.setTextColor(0xFF001018);
        btn.setTypeface(Typeface.create(HudActivity.HUD_FONT, Typeface.BOLD));
        android.graphics.drawable.GradientDrawable g = new android.graphics.drawable.GradientDrawable();
        g.setColor(CYAN);
        g.setCornerRadius(dp(8));
        btn.setBackground(g);
        btn.setPadding(dp(14), dp(6), dp(14), dp(6));
        btn.setOnClickListener(l);
        return btn;
    }

    private LinearLayout section(LinearLayout parent, String title) {
        TextView h = text(title, 12, GOLD, true);
        h.setLetterSpacing(0.2f);
        h.setPadding(0, dp(20), 0, dp(6));
        parent.addView(h);
        LinearLayout p = new LinearLayout(this);
        p.setOrientation(LinearLayout.VERTICAL);
        p.setBackground(HudActivity.panelBg(this, getResources().getDisplayMetrics().density));
        p.setPadding(dp(12), dp(10), dp(12), dp(12));
        parent.addView(p);
        return p;
    }

    private EditText input(String value, boolean multiline) {
        EditText e = new EditText(this);
        e.setText(value);
        e.setTextColor(TEXT);
        e.setHintTextColor(DIM);
        e.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        e.setBackgroundColor(0x3300E5FF);
        e.setPadding(dp(10), dp(8), dp(10), dp(8));
        if (multiline) {
            e.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
            e.setGravity(Gravity.TOP);
            e.setMinLines(4);
        } else {
            e.setSingleLine(true);
        }
        return e;
    }

    private LinearLayout row() {
        LinearLayout r = new LinearLayout(this);
        r.setGravity(Gravity.CENTER_VERTICAL);
        r.setPadding(0, dp(4), 0, dp(4));
        return r;
    }

    // ------------------------------------------------------------------ UI

    private void buildUi() {
        ScrollView sv = new ScrollView(this);
        sv.setBackgroundColor(0xFF050B14);
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setPadding(dp(16), dp(24), dp(16), dp(32));
        sv.addView(col);

        TextView title = text("J.A.R.V.I.S.", 30, CYAN, true);
        title.setLetterSpacing(0.25f);
        col.addView(title);
        col.addView(text("Your offline personal assistant. No cloud, no AI service, no API keys.", 13, DIM, false));

        serviceStatus = text("", 14, TEXT, false);
        serviceStatus.setPadding(0, dp(12), 0, dp(6));
        col.addView(serviceStatus);
        LinearLayout actions = row();
        serviceButton = button("Start listening", new View.OnClickListener() {
            @Override public void onClick(View v) {
                if (JarvisService.isRunning()) {
                    JarvisService.stop(MainActivity.this);
                } else if (!hasAll(RUNTIME)) {
                    requestPermissions(RUNTIME, 1);
                } else {
                    JarvisService.start(MainActivity.this);
                }
                serviceStatus.postDelayed(new Runnable() { @Override public void run() { refresh(); } }, 400);
            }
        });
        actions.addView(serviceButton);
        View gap = new View(this);
        actions.addView(gap, new LinearLayout.LayoutParams(dp(10), 1));
        actions.addView(button("Talk to JARVIS", new View.OnClickListener() {
            @Override public void onClick(View v) {
                startActivity(new Intent(MainActivity.this, HudActivity.class));
            }
        }));
        col.addView(actions);

        // Setup checklist.
        setupList = section(col, "SETUP · TAP EACH ONE ONCE");

        // Try a command by typing.
        LinearLayout test = section(col, "TRY A COMMAND");
        final EditText cmd = input("", false);
        cmd.setHint("e.g. brightness 40 percent");
        test.addView(cmd);
        LinearLayout tr = row();
        tr.addView(button("Run", new View.OnClickListener() {
            @Override public void onClick(View v) {
                String s = cmd.getText().toString().trim();
                if (s.length() == 0) return;
                final Brain.Reply r = Brain.get(MainActivity.this).handle(s);
                testReply.setText(r.speech + (r.display != null ? "\n\n" + r.display : ""));
                speaker.applyVoice();
                speaker.speak(r.speech.length() > 0 ? r.speech : "Done.", new Runnable() {
                    @Override public void run() { if (r.after != null) r.after.run(); }
                });
                refresh();
            }
        }));
        test.addView(tr);
        testReply = text("", 14, TEXT, false);
        test.addView(testReply);

        // Voice and personality.
        LinearLayout voice = section(col, "VOICE AND PERSONALITY");
        addCycle(voice, "Voice style", "voice_mode", new String[]{"classic", "robot", "calm", "professional"},
                new String[]{"Classic JARVIS (robotic)", "Full robot", "Calm", "Professional (no effect)"});
        addCycle(voice, "Reply style", "style", new String[]{"jarvis", "friendly", "short"},
                new String[]{"JARVIS (\"..., sir\")", "Friendly", "Short"});
        addCycle(voice, "Language", "language", new String[]{"en-IN", "en-US", "en-GB"},
                new String[]{"English (India)", "English (US)", "English (UK)"});
        LinearLayout vr = row();
        vr.addView(text("Voice", 14, TEXT, false), new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        vr.addView(button("Choose voice", new View.OnClickListener() {
            @Override public void onClick(View v) { chooseVoice(); }
        }));
        voice.addView(vr);
        addSlider(voice, "Speaking speed", "speech_rate", 0.6f, 1.8f, 1.0f);
        addSlider(voice, "Wake word sensitivity (left = fewer false wakes)", "wake_sens", 0f, 1f, 0.5f);
        addText(voice, "Call me", "user_title", "sir");
        addText(voice, "Greeting when I wake", "greeting", "Yes, sir?");
        addCycle(voice, "\"Message ...\" sends with", "default_channel", new String[]{"whatsapp", "sms"},
                new String[]{"WhatsApp", "SMS"});
        addText(voice, "Country code for WhatsApp", "country_code", "91");
        LinearLayout hear = row();
        hear.addView(button("Hear a sample", new View.OnClickListener() {
            @Override public void onClick(View v) {
                speaker.applyVoice();
                speaker.speak("Good evening, " + prefs.userTitle() + ". All systems are online. How can I help?", null);
            }
        }));
        voice.addView(hear);

        // Routines.
        LinearLayout routines = section(col, "ROUTINES");
        routines.addView(text("One per line: name: command; command; ...  Say the name to run it (\"good night\", \"coding mode\").", 12, DIM, false));
        final EditText rt = input(prefs.routinesText(), true);
        routines.addView(rt);
        LinearLayout rr = row();
        rr.addView(button("Save routines", new View.OnClickListener() {
            @Override public void onClick(View v) {
                prefs.putString("routines", rt.getText().toString());
                testReply.setText("Routines saved: " + prefs.routines().keySet());
            }
        }));
        routines.addView(rr);

        // Limits.
        LinearLayout limits = section(col, "DAILY APP LIMITS");
        limits.addView(text("app: minutes, one per line. Shown on the HUD; you get a heads-up when you pass one.", 12, DIM, false));
        final EditText lt = input(prefs.getString("limits", "instagram: 60\nyoutube: 90\nchrome: 120"), true);
        limits.addView(lt);
        LinearLayout lr = row();
        lr.addView(button("Save limits", new View.OnClickListener() {
            @Override public void onClick(View v) { prefs.putString("limits", lt.getText().toString()); }
        }));
        limits.addView(lr);

        // Memory.
        LinearLayout mem = section(col, "MEMORY");
        memoryText = text("", 14, TEXT, false);
        mem.addView(memoryText);
        LinearLayout mr = row();
        mr.addView(button("Clear memory", new View.OnClickListener() {
            @Override public void onClick(View v) {
                new AlertDialog.Builder(MainActivity.this).setMessage("Forget everything JARVIS remembers?")
                        .setPositiveButton("Forget", new DialogInterface.OnClickListener() {
                            @Override public void onClick(DialogInterface d, int w) {
                                prefs.putString("memory", "{}");
                                prefs.putString("notes", "[]");
                                refresh();
                            }
                        }).setNegativeButton("Cancel", null).show();
            }
        }));
        mem.addView(mr);

        // Log.
        LinearLayout log = section(col, "RECENT COMMANDS");
        logText = text("", 12, DIM, false);
        log.addView(logText);

        TextView privacy = text("Privacy: the wake word, speech and commands are handled on this phone. JARVIS has no server and stores everything locally.", 11, DIM, false);
        privacy.setPadding(0, dp(18), 0, 0);
        col.addView(privacy);

        setContentView(sv);
    }

    private void addCycle(LinearLayout p, String label, final String key, final String[] values, final String[] names) {
        LinearLayout r = row();
        r.addView(text(label, 14, TEXT, false), new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        String cur = prefs.getString(key, values[0]);
        int idx = java.util.Arrays.asList(values).indexOf(cur);
        final Button b = button(names[Math.max(0, idx)], null);
        b.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                int i = java.util.Arrays.asList(values).indexOf(prefs.getString(key, values[0]));
                int next = (i + 1) % values.length;
                prefs.putString(key, values[next]);
                b.setText(names[next]);
            }
        });
        r.addView(b);
        p.addView(r);
    }

    private void addSlider(LinearLayout p, String label, final String key, final float min, final float max, float def) {
        p.addView(text(label, 14, TEXT, false));
        SeekBar s = new SeekBar(this);
        s.setMax(100);
        float cur;
        if (key.equals("wake_sens")) {
            // Stored as a detection threshold: 0.65 (strict) ... 0.25 (sensitive).
            cur = (0.65f - prefs.wakeThreshold()) / 0.4f;
        } else {
            cur = (prefs.getFloat(key, def) - min) / (max - min);
        }
        s.setProgress(Math.round(Math.max(0, Math.min(1, cur)) * 100));
        s.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override public void onProgressChanged(SeekBar sb, int v, boolean user) {
                if (!user) return;
                float f = v / 100f;
                if (key.equals("wake_sens")) prefs.putFloat("wake_threshold", 0.65f - f * 0.4f);
                else prefs.putFloat(key, min + f * (max - min));
            }
            @Override public void onStartTrackingTouch(SeekBar sb) { }
            @Override public void onStopTrackingTouch(SeekBar sb) { }
        });
        p.addView(s);
    }

    private void addText(LinearLayout p, String label, final String key, String def) {
        p.addView(text(label, 14, TEXT, false));
        final EditText e = input(prefs.getString(key, def), false);
        e.setOnFocusChangeListener(new View.OnFocusChangeListener() {
            @Override public void onFocusChange(View v, boolean has) {
                if (!has) prefs.putString(key, e.getText().toString().trim());
            }
        });
        e.addTextChangedListener(new android.text.TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int a, int b, int c) { }
            @Override public void onTextChanged(CharSequence s, int a, int b, int c) { }
            @Override public void afterTextChanged(android.text.Editable s) { prefs.putString(key, s.toString().trim()); }
        });
        p.addView(e);
    }

    private void chooseVoice() {
        final List<String> voices = speaker.voiceNames();
        if (voices.isEmpty()) {
            new AlertDialog.Builder(this).setMessage("No offline English voices found yet. Install \"Speech Services by Google\" voices "
                    + "in Settings → System → Languages → Text-to-speech output.").setPositiveButton("OK", null).show();
            return;
        }
        final List<String> labels = new ArrayList<String>();
        labels.add("Automatic (best male English voice)");
        labels.addAll(voices);
        new AlertDialog.Builder(this).setTitle("Voice")
                .setItems(labels.toArray(new String[0]), new DialogInterface.OnClickListener() {
                    @Override public void onClick(DialogInterface d, int which) {
                        prefs.putString("voice_name", which == 0 ? "" : voices.get(which - 1));
                        speaker.applyVoice();
                        speaker.speak("This is how I sound now, " + prefs.userTitle() + ".", null);
                    }
                }).show();
    }

    // ------------------------------------------------------------------ setup checklist

    private interface Check { boolean ok(); }

    private void addSetup(String title, String why, boolean ok, View.OnClickListener fix) {
        LinearLayout r = row();
        LinearLayout t = new LinearLayout(this);
        t.setOrientation(LinearLayout.VERTICAL);
        t.addView(text((ok ? "✓  " : "•  ") + title, 14, ok ? CYAN : TEXT, true));
        t.addView(text(why, 12, DIM, false));
        r.addView(t, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        if (!ok && fix != null) r.addView(button("Allow", fix));
        setupList.addView(r);
    }

    private void open(Intent i) {
        try {
            startActivity(i);
        } catch (Exception e) {
            startActivity(new Intent(Settings.ACTION_SETTINGS));
        }
    }

    private boolean notificationAccess() {
        String flat = Settings.Secure.getString(getContentResolver(), "enabled_notification_listeners");
        return flat != null && flat.contains(getPackageName());
    }

    private boolean accessibilityOn() {
        String flat = Settings.Secure.getString(getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
        return flat != null && flat.contains(getPackageName());
    }

    private void refresh() {
        boolean running = JarvisService.isRunning();
        String err = JarvisService.lastError();
        serviceStatus.setText(running ? (err != null ? "⚠ " + err : "● Listening for \"Hey Jarvis\"") : "○ Wake word is off. Tap Start listening.");
        serviceStatus.setTextColor(running && err == null ? CYAN : GOLD);
        serviceButton.setText(running ? "Stop listening" : "Start listening");

        setupList.removeAllViews();
        final String pkg = "package:" + getPackageName();
        addSetup("Microphone, calls, contacts, SMS", "Hear you, call and message people by name.", hasAll(RUNTIME), new View.OnClickListener() {
            @Override public void onClick(View v) { requestPermissions(RUNTIME, 1); }
        });
        addSetup("Display over other apps", "Lets the JARVIS screen pop up when you say \"Hey Jarvis\".", Settings.canDrawOverlays(this), new View.OnClickListener() {
            @Override public void onClick(View v) { open(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse(pkg))); }
        });
        addSetup("Modify system settings", "Brightness and auto-rotate.", Settings.System.canWrite(this), new View.OnClickListener() {
            @Override public void onClick(View v) { open(new Intent(Settings.ACTION_MANAGE_WRITE_SETTINGS, Uri.parse(pkg))); }
        });
        addSetup("Notification access", "Show, read out and reply to your notifications. If the switch is greyed out: App info → ⋮ → Allow restricted settings.", notificationAccess(), new View.OnClickListener() {
            @Override public void onClick(View v) { open(new Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS")); }
        });
        addSetup("Usage access", "Screen time and your app limits on the HUD.", SystemStats.hasUsageAccess(this), new View.OnClickListener() {
            @Override public void onClick(View v) { open(new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)); }
        });
        addSetup("Do Not Disturb access", "Do not disturb and silent/vibrate mode.", Actions.dndAllowed(this), new View.OnClickListener() {
            @Override public void onClick(View v) { open(new Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS)); }
        });
        addSetup("JARVIS helper (Accessibility)", "Taps WhatsApp's Send button, locks the screen, takes screenshots. "
                + "On Android 13+: first open App info → ⋮ → Allow restricted settings.", accessibilityOn(), new View.OnClickListener() {
            @Override public void onClick(View v) { open(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)); }
        });
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        addSetup("Battery: don't restrict JARVIS", "OnePlus closes background apps; this keeps \"Hey Jarvis\" working all day.",
                pm.isIgnoringBatteryOptimizations(getPackageName()), new View.OnClickListener() {
            @Override public void onClick(View v) {
                open(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse(pkg)));
            }
        });
        addSetup("Offline speech recognition", "Download the offline English speech pack so commands work without internet.",
                prefs.getBool("offline_speech_done", false), new View.OnClickListener() {
            @Override public void onClick(View v) { downloadOfflineSpeech(); }
        });

        StringBuilder m = new StringBuilder();
        for (Map.Entry<String, String> e : prefs.memory().entrySet()) m.append("• ").append(e.getKey()).append(" → ").append(e.getValue()).append("\n");
        for (String n : prefs.notes()) m.append("• note: ").append(n).append("\n");
        memoryText.setText(m.length() == 0 ? "Nothing yet. Say \"remember MediaAI is my main project\"." : m.toString().trim());
        logText.setText(prefs.logText());
    }

    private void downloadOfflineSpeech() {
        prefs.putBool("offline_speech_done", true);
        prefs.putBool("on_device_stt", true); // retry the on-device recognizer once the pack is there
        if (Build.VERSION.SDK_INT >= 33 && SpeechRecognizer.isOnDeviceRecognitionAvailable(this)) {
            try {
                SpeechRecognizer r = SpeechRecognizer.createOnDeviceSpeechRecognizer(this);
                Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                        .putExtra(RecognizerIntent.EXTRA_LANGUAGE, prefs.language())
                        .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                r.triggerModelDownload(i);
                testReply.setText("Downloading the offline " + prefs.language() + " speech pack in the background. Keep Wi-Fi on for a minute.");
                return;
            } catch (Exception ignored) {
                // fall through to Google's language-pack screen
            }
        }
        Intent i = new Intent().setComponent(new ComponentName("com.google.android.googlequicksearchbox",
                "com.google.android.voicesearch.greco3.languagepack.InstallActivity"));
        try {
            startActivity(i);
        } catch (Exception e) {
            open(new Intent("com.android.settings.TTS_SETTINGS"));
            testReply.setText("Open Google app → Settings → Voice → Offline speech recognition, and download English ("
                    + prefs.language().substring(3).toLowerCase(Locale.ROOT) + ").");
        }
    }
}
