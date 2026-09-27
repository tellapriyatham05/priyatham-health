package com.priyatham.health;

import android.graphics.Color;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(CompanionPlugin.class);
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.parseColor("#0A0A0B"));
        getWindow().setNavigationBarColor(Color.parseColor("#0A0A0B"));
        AlarmScheduler.rearmAll(this);
    }
}
