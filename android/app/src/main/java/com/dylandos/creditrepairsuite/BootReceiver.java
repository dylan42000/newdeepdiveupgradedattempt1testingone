package com.dylandos.creditrepairsuite;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import org.json.JSONObject;

import java.util.concurrent.TimeUnit;

public class BootReceiver extends BroadcastReceiver {

    private static final String TAG = "BootReceiver";
    private static final String WORK_TAG = "dylandos_autopilot";
    private static final String UNIQUE_WORK_NAME = "dylandos_daily_check";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) {
            return;
        }

        Log.i(TAG, "Boot completed — checking AutoPilot state");

        try {
            AutoPilotDataStore store = new AutoPilotDataStore(context);
            JSONObject state = store.loadState();

            if (state != null && state.optBoolean("enabled", false)) {
                Log.i(TAG, "AutoPilot was enabled — re-registering WorkManager job");

                Constraints constraints = new Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.NOT_REQUIRED)
                    .setRequiresBatteryNotLow(false)
                    .build();

                PeriodicWorkRequest workRequest = new PeriodicWorkRequest.Builder(
                    AutoPilotWorker.class,
                    12, TimeUnit.HOURS,
                    15, TimeUnit.MINUTES
                )
                    .setConstraints(constraints)
                    .addTag(WORK_TAG)
                    .build();

                WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                    UNIQUE_WORK_NAME,
                    ExistingPeriodicWorkPolicy.KEEP,
                    workRequest
                );

                Log.i(TAG, "AutoPilot WorkManager job re-registered successfully");
            } else {
                Log.i(TAG, "AutoPilot was not enabled — skipping re-registration");
            }

        } catch (Exception e) {
            Log.e(TAG, "Failed to re-register AutoPilot after boot", e);
        }
    }
}
