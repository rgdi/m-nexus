package com.mnexus.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;
import com.mnexus.app.intents.NativeIntentPlugin;

public class MainActivity extends BridgeActivity {
    // v2.20.0: register native plugins that ship with the app.
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeIntentPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
