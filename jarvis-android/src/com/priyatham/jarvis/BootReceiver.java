package com.priyatham.jarvis;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Starts listening again after the phone restarts or JARVIS is updated. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent intent) {
        if (new Prefs(c).wakeEnabled()) {
            try {
                JarvisService.start(c);
            } catch (Exception ignored) {
                // Some phones refuse background starts right after boot; opening the app fixes it.
            }
        }
    }
}
