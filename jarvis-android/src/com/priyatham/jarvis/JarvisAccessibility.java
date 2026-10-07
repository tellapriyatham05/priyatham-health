package com.priyatham.jarvis;

import android.accessibilityservice.AccessibilityService;
import android.os.Handler;
import android.os.Looper;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import java.util.List;
import java.util.Locale;

/**
 * Presses buttons on your behalf when there is no other way: WhatsApp's Send button,
 * lock screen, screenshots, and Quick Settings tiles. It only acts right after a voice command.
 */
public class JarvisAccessibility extends AccessibilityService {
    private static JarvisAccessibility instance;
    private static long whatsappSendUntil;

    private final Handler handler = new Handler(Looper.getMainLooper());

    public static boolean isOn() {
        return instance != null;
    }

    public static boolean global(int action) {
        JarvisAccessibility s = instance;
        return s != null && s.performGlobalAction(action);
    }

    /** Arms a one-off tap on WhatsApp's Send button for the next few seconds. */
    public static void armWhatsAppSend() {
        whatsappSendUntil = System.currentTimeMillis() + 9000;
        final JarvisAccessibility s = instance;
        if (s != null) {
            for (int delay : new int[]{900, 1600, 2600, 4000}) {
                s.handler.postDelayed(new Runnable() {
                    @Override public void run() { s.tryWhatsAppSend(); }
                }, delay);
            }
        }
    }

    @Override
    protected void onServiceConnected() {
        instance = this;
    }

    @Override
    public boolean onUnbind(android.content.Intent intent) {
        instance = null;
        return super.onUnbind(intent);
    }

    @Override
    public void onDestroy() {
        instance = null;
        super.onDestroy();
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (System.currentTimeMillis() < whatsappSendUntil && event.getPackageName() != null
                && event.getPackageName().toString().startsWith("com.whatsapp")) {
            tryWhatsAppSend();
        }
    }

    @Override
    public void onInterrupt() { }

    private void tryWhatsAppSend() {
        if (System.currentTimeMillis() >= whatsappSendUntil) return;
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null || root.getPackageName() == null || !root.getPackageName().toString().startsWith("com.whatsapp")) return;
        String pkg = root.getPackageName().toString();
        List<AccessibilityNodeInfo> found = root.findAccessibilityNodeInfosByViewId(pkg + ":id/send");
        if (found == null || found.isEmpty()) found = root.findAccessibilityNodeInfosByText("Send");
        if (found == null) return;
        for (AccessibilityNodeInfo n : found) {
            AccessibilityNodeInfo target = n;
            while (target != null && !target.isClickable()) target = target.getParent();
            if (target != null && target.isEnabled() && target.performAction(AccessibilityNodeInfo.ACTION_CLICK)) {
                whatsappSendUntil = 0;
                return;
            }
        }
    }

    /**
     * Flips a Quick Settings tile ("Wi-Fi", "Bluetooth", "Internet"...) to the wanted state.
     * Used only when Android refuses to switch the setting directly.
     */
    public static boolean toggleTile(final String[] labels, final Boolean wantOn, final Runnable done) {
        final JarvisAccessibility s = instance;
        if (s == null) return false;
        s.performGlobalAction(GLOBAL_ACTION_QUICK_SETTINGS);
        s.handler.postDelayed(new Runnable() {
            @Override
            public void run() {
                s.clickTile(labels, wantOn);
                s.handler.postDelayed(new Runnable() {
                    @Override
                    public void run() {
                        s.performGlobalAction(GLOBAL_ACTION_BACK);
                        s.performGlobalAction(GLOBAL_ACTION_BACK);
                        if (done != null) done.run();
                    }
                }, 700);
            }
        }, 900);
        return true;
    }

    private boolean clickTile(String[] labels, Boolean wantOn) {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return false;
        for (String label : labels) {
            AccessibilityNodeInfo node = findByLabel(root, label.toLowerCase(Locale.ROOT));
            if (node == null) continue;
            AccessibilityNodeInfo target = node;
            while (target != null && !target.isClickable()) target = target.getParent();
            if (target == null) continue;
            if (wantOn != null && target.isCheckable() && target.isChecked() == wantOn) return true;
            String state = "";
            if (android.os.Build.VERSION.SDK_INT >= 30 && target.getStateDescription() != null) {
                state = target.getStateDescription().toString().toLowerCase(Locale.ROOT);
            }
            if (wantOn != null && (state.equals(wantOn ? "on" : "off"))) return true;
            return target.performAction(AccessibilityNodeInfo.ACTION_CLICK);
        }
        return false;
    }

    private static AccessibilityNodeInfo findByLabel(AccessibilityNodeInfo n, String label) {
        if (n == null) return null;
        CharSequence t = n.getText(), d = n.getContentDescription();
        String text = t == null ? "" : t.toString().toLowerCase(Locale.ROOT);
        String desc = d == null ? "" : d.toString().toLowerCase(Locale.ROOT);
        if (text.equals(label) || desc.equals(label) || desc.startsWith(label + ",") || desc.startsWith(label + " ")) return n;
        for (int i = 0; i < n.getChildCount(); i++) {
            AccessibilityNodeInfo r = findByLabel(n.getChild(i), label);
            if (r != null) return r;
        }
        return null;
    }
}
