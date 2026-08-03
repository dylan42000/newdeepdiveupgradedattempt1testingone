package com.dylandos.creditrepairsuite;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKey;

import org.json.JSONObject;

public class AutoPilotDataStore {

    private static final String TAG = "AutoPilotDataStore";
    private static final String PREFS_NAME = "dylandos_autopilot_store";
    private static final String KEY_STATE = "scheduler_state";

    private final SharedPreferences prefs;

    public AutoPilotDataStore(Context context) throws Exception {
        MasterKey masterKey = new MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build();

        prefs = EncryptedSharedPreferences.create(
            context,
            PREFS_NAME,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        );
    }

    public JSONObject loadState() {
        try {
            String json = prefs.getString(KEY_STATE, null);
            if (json != null) {
                return new JSONObject(json);
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to load state", e);
        }
        return null;
    }

    public void saveState(JSONObject state) {
        try {
            prefs.edit()
                .putString(KEY_STATE, state.toString())
                .apply();
        } catch (Exception e) {
            Log.e(TAG, "Failed to save state", e);
        }
    }

    public static void logError(Context context, String message) {
        Log.e(TAG, "AutoPilot error: " + message);
    }
}
