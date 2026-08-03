package com.dylandos.creditrepairsuite;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkInfo;
import androidx.work.WorkManager;

import com.google.common.util.concurrent.ListenableFuture;

import org.json.JSONObject;

import java.util.List;
import java.util.concurrent.TimeUnit;

@CapacitorPlugin(name = "AutoPilot")
public class AutoPilotPlugin extends Plugin {

    private static final String WORK_TAG = "dylandos_autopilot";
    private static final String UNIQUE_WORK_NAME = "dylandos_daily_check";

    @PluginMethod
    public void scheduleBackgroundCheck(PluginCall call) {
        try {
            Context ctx = getContext();

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

            WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(
                UNIQUE_WORK_NAME,
                ExistingPeriodicWorkPolicy.UPDATE,
                workRequest
            );

            // Save the flat state object (not the Capacitor call envelope)
            String stateJson = call.getString("state");
            JSONObject stateObj;
            if (stateJson != null && !stateJson.isEmpty()) {
                stateObj = new JSONObject(stateJson);
            } else {
                // Fallback: accept flat fields on the call directly
                stateObj = new JSONObject();
                if (call.getData().has("nextCycleDateMs")) {
                    stateObj.put("nextCycleDateMs", call.getData().optLong("nextCycleDateMs", -1));
                }
                if (call.getData().has("timelines")) {
                    stateObj.put("timelines", call.getData().opt("timelines"));
                }
                if (call.getData().has("heldItems")) {
                    stateObj.put("heldItems", call.getData().opt("heldItems"));
                }
            }
            stateObj.put("enabled", true);
            AutoPilotDataStore store = new AutoPilotDataStore(ctx);
            store.saveState(stateObj);

            JSObject result = new JSObject();
            result.put("success", true);
            result.put("message", "Background check scheduled (every 12 hours)");
            call.resolve(result);

        } catch (Exception e) {
            call.reject("Failed to schedule background check: " + e.getMessage());
        }
    }

    @PluginMethod
    public void updateSchedulerState(PluginCall call) {
        try {
            Context ctx = getContext();
            String stateJson = call.getString("state");
            JSONObject incoming;
            if (stateJson != null && !stateJson.isEmpty()) {
                incoming = new JSONObject(stateJson);
            } else {
                incoming = new JSONObject(call.getData().toString());
            }

            AutoPilotDataStore store = new AutoPilotDataStore(ctx);
            JSONObject toSave = incoming;

            // Patch-only updates: merge nextCycleDateMs into existing state
            // without wiping timelines / heldItems.
            if (incoming.optBoolean("patchOnly", false)) {
                JSONObject existing = store.loadState();
                if (existing == null) existing = new JSONObject();
                if (incoming.has("nextCycleDateMs")) {
                    existing.put("nextCycleDateMs", incoming.optLong("nextCycleDateMs", -1));
                }
                existing.put("enabled", true);
                toSave = existing;
            }

            store.saveState(toSave);

            JSObject result = new JSObject();
            result.put("success", true);
            call.resolve(result);

        } catch (Exception e) {
            call.reject("Failed to update scheduler state: " + e.getMessage());
        }
    }

    @PluginMethod
    public void cancelBackgroundCheck(PluginCall call) {
        try {
            Context ctx = getContext();
            WorkManager.getInstance(ctx).cancelUniqueWork(UNIQUE_WORK_NAME);

            AutoPilotDataStore store = new AutoPilotDataStore(ctx);
            JSONObject state = store.loadState();
            if (state != null) {
                state.put("enabled", false);
                store.saveState(state);
            }

            JSObject result = new JSObject();
            result.put("success", true);
            result.put("message", "Background check cancelled");
            call.resolve(result);

        } catch (Exception e) {
            call.reject("Failed to cancel background check: " + e.getMessage());
        }
    }

    @PluginMethod
    public void getSchedulerStatus(PluginCall call) {
        try {
            Context ctx = getContext();
            ListenableFuture<List<WorkInfo>> future =
                WorkManager.getInstance(ctx).getWorkInfosForUniqueWork(UNIQUE_WORK_NAME);

            List<WorkInfo> workInfos = future.get();
            boolean isScheduled = false;
            String workState = "UNKNOWN";

            if (workInfos != null && !workInfos.isEmpty()) {
                WorkInfo info = workInfos.get(0);
                workState = info.getState().name();
                isScheduled = info.getState() == WorkInfo.State.ENQUEUED
                           || info.getState() == WorkInfo.State.RUNNING;
            }

            AutoPilotDataStore store = new AutoPilotDataStore(ctx);
            JSONObject state = store.loadState();

            JSObject result = new JSObject();
            result.put("isScheduled", isScheduled);
            result.put("workState", workState);
            result.put("enabled", state != null && state.optBoolean("enabled", false));
            result.put("hasStoredState", state != null);
            call.resolve(result);

        } catch (Exception e) {
            call.reject("Failed to get scheduler status: " + e.getMessage());
        }
    }

    @PluginMethod
    public void isSchedulerAvailable(PluginCall call) {
        JSObject result = new JSObject();
        result.put("available", true);
        result.put("platform", "android");
        result.put("engine", "WorkManager");
        call.resolve(result);
    }

    @PluginMethod
    public void requestBatteryOptimizationExemption(PluginCall call) {
        try {
            Context ctx = getContext();
            PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                if (pm.isIgnoringBatteryOptimizations(ctx.getPackageName())) {
                    JSObject result = new JSObject();
                    result.put("alreadyExempt", true);
                    call.resolve(result);
                    return;
                }

                Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                intent.setData(Uri.parse("package:" + ctx.getPackageName()));
                getActivity().startActivity(intent);

                JSObject result = new JSObject();
                result.put("requested", true);
                call.resolve(result);
            } else {
                JSObject result = new JSObject();
                result.put("notNeeded", true);
                call.resolve(result);
            }

        } catch (Exception e) {
            call.reject("Failed to request battery exemption: " + e.getMessage());
        }
    }
}
