package com.dylandos.creditrepairsuite;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Register V4 plugins before super.onCreate
        registerPlugin(AutoPilotPlugin.class);
        registerPlugin(SecureVaultPlugin.class);
        registerPlugin(CameraResponsePlugin.class);
        registerPlugin(PrintPlugin.class);
        registerPlugin(PlatformApexPlugin.class);

        super.onCreate(savedInstanceState);

        // Handle notification deep link on launch
        handleNotificationIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleNotificationIntent(intent);
    }

    private void handleNotificationIntent(Intent intent) {
        if (intent == null || intent.getExtras() == null) return;

        String action = intent.getStringExtra("autopilot_action");
        if (action != null && !action.isEmpty() && getBridge() != null) {
            getBridge().triggerWindowJSEvent(
                "autopilot_notification",
                "{ action: '" + action + "' }"
            );
        }
    }
}
