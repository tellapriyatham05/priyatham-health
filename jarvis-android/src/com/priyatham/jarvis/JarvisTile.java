package com.priyatham.jarvis;

import android.content.Intent;
import android.service.quicksettings.TileService;

/** A Quick Settings tile that opens JARVIS with one tap. */
public class JarvisTile extends TileService {
    @Override
    public void onClick() {
        Intent i = new Intent(this, HudActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        startActivityAndCollapse(i);
    }
}
