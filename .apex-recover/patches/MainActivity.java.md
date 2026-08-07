# Patches for MainActivity.java (1)

## Patch 1 from 8559bda8-1434-45c3-821e-9ac6a77ac28e.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\android\app\src\main\java\com\dylandos\creditrepairsuite\MainActivity.java`
### OLD (975)
```
        // Register V4 plugins before super.onCreate
        registerPlugin(AutoPilotPlugin.class);
        registerPlugin(SecureVaultPlugin.class);
        registerPlugin(CameraResponsePlugin.class);
        registerPlugin(PrintPlugin.class);

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
```
### NEW (2512)
```
        // Register V4 / Apex plugins before super.onCreate
        registerPlugin(AutoPilotPlugin.class);
        registerPlugin(SecureVaultPlugin.class);
        registerPlugin(CameraResponsePlugin.class);
        registerPlugin(PrintPlugin.class);
        registerPlugin(PlatformApexPlugin.class);

        super.onCreate(savedInstanceState);

        // Handle notification deep link + share-sheet intake on launch
        handleNotificationIntent(getIntent());
        handleShareIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleNotificationIntent(intent);
        handleShareIntent(intent);
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

    /** Apex A2 — receive shared text/PDF URIs from Android share sheet. */
    private void handleShareIntent(Intent intent) {
        if (intent == null || getBridge() == null) return;

        String action = intent.getAction();
        if (!Intent.ACTION_SEND.equals(action) && !Intent.ACTION_VIEW.equals(action)) {
            return;
        }

        String type = intent.getType() != null ? intent.getType() : "";
        String sharedText = intent.getStringExtra(Intent.EXTRA_TEXT);
        android.net.Uri stream = intent.getParcelableExtra(Intent.EXTRA_STREAM);

        StringBuilder json = new StringBuilder("{");
        json.append("\"mime\":\"").append(escapeJson(type)).append("\"");
        if (sharedText != null && !sharedText.isEmpty()) {
            json.append(",\"text\":\"").append(escapeJson(sharedText)).append("\"");
        }
        if (stream != null) {
            json.append(",\"uri\":\"").append(escapeJson(stream.toString())).append("\"");
        }
        json.append("}");

        getBridge().triggerWindowJSEvent("dylandos_share_intake", json.toString());
    }

    private static String escapeJson(String raw) {
        if (raw == null) return "";
        return raw
            .replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("\n", "\\n")
            .replace("\r", "\\r");
    }
}
```
