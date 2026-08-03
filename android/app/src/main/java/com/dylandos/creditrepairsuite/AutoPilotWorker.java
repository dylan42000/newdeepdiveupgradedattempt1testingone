package com.dylandos.creditrepairsuite;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONArray;
import org.json.JSONObject;

public class AutoPilotWorker extends Worker {

    private static final String CHANNEL_ID = "dylandos_autopilot";
    private static final int NOTIFICATION_ID_CYCLE_READY   = 1001;
    private static final int NOTIFICATION_ID_TIMELINE       = 1002;
    private static final int NOTIFICATION_ID_OVERDUE        = 1003;
    private static final int NOTIFICATION_ID_HOLD_EXPIRED   = 1004;

    public AutoPilotWorker(
            @NonNull Context context,
            @NonNull WorkerParameters params) {
        super(context, params);
        createNotificationChannel();
    }

    @NonNull
    @Override
    public Result doWork() {
        try {
            AutoPilotDataStore store = new AutoPilotDataStore(getApplicationContext());
            JSONObject state = store.loadState();

            if (state == null || !state.optBoolean("enabled", false)) {
                return Result.success();
            }

            long nextCycleMs = state.optLong("nextCycleDateMs", -1);
            long now = System.currentTimeMillis();

            // Check: Is a new cycle due?
            if (nextCycleMs > 0 && now >= nextCycleMs) {
                sendNotification(
                    NOTIFICATION_ID_CYCLE_READY,
                    "\uD83E\uDD16 AutoPilot: New Cycle Ready",
                    "Your credit repair autopilot has a new dispute cycle ready. Tap to review.",
                    "CYCLE_READY"
                );
            }

            // Check: Timeline deadlines
            JSONArray timelines = state.optJSONArray("timelines");
            if (timelines != null) {
                for (int i = 0; i < timelines.length(); i++) {
                    JSONObject timeline = timelines.getJSONObject(i);
                    checkTimeline(timeline, now);
                }
            }

            // Check: Hold queue expiries
            JSONArray heldItems = state.optJSONArray("heldItems");
            if (heldItems != null) {
                int expiredCount = 0;
                for (int i = 0; i < heldItems.length(); i++) {
                    JSONObject item = heldItems.getJSONObject(i);
                    long holdUntilMs = item.optLong("holdUntilMs", -1);
                    if (holdUntilMs > 0 && now >= holdUntilMs) {
                        expiredCount++;
                    }
                }
                if (expiredCount > 0) {
                    sendNotification(
                        NOTIFICATION_ID_HOLD_EXPIRED,
                        "\u23F0 Hold Period Expired",
                        expiredCount + " dispute item(s) are ready for re-dispute. Tap to review.",
                        "HOLD_EXPIRED"
                    );
                }
            }

            return Result.success();

        } catch (Exception e) {
            AutoPilotDataStore.logError(getApplicationContext(), e.getMessage());
            return Result.retry();
        }
    }

    private void checkTimeline(JSONObject timeline, long now) throws Exception {
        long fcraDeadlineMs = timeline.optLong("fcraDeadlineMs", -1);
        long reminderMs     = timeline.optLong("reminderMs", -1);
        long overdueMs      = timeline.optLong("overdueMs", -1);
        String itemName     = timeline.optString("itemName", "Dispute Item");
        String bureauName   = timeline.optString("bureauName", "Bureau");

        if (overdueMs > 0 && now >= overdueMs) {
            sendNotification(
                NOTIFICATION_ID_OVERDUE,
                "\uD83D\uDEA8 OVERDUE: Bureau Has Not Responded",
                bureauName + " has not responded to your " + itemName + " dispute. Tap for next steps.",
                "OVERDUE"
            );
        } else if (reminderMs > 0 && now >= reminderMs && now < fcraDeadlineMs) {
            sendNotification(
                NOTIFICATION_ID_TIMELINE,
                "\uD83D\uDCEC Response Expected Soon",
                "Watch your mail \u2014 " + bureauName + " should respond to your " + itemName + " dispute within 5 days.",
                "TIMELINE_REMINDER"
            );
        }
    }

    private void sendNotification(int id, String title, String body, String action) {
        Context ctx = getApplicationContext();

        Intent intent = new Intent(ctx, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        intent.putExtra("autopilot_action", action);

        PendingIntent pendingIntent = PendingIntent.getActivity(
            ctx, id, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(ctx, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            // Lock-screen: public title only — avoid creditor/account details (§12.5)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(
                new NotificationCompat.Builder(ctx, CHANNEL_ID)
                    .setSmallIcon(android.R.drawable.ic_dialog_info)
                    .setContentTitle("Dylando AutoPilot")
                    .setContentText("Open the app to continue a credit case task.")
                    .build()
            )
            .setContentIntent(pendingIntent)
            .setAutoCancel(true);

        NotificationManager manager =
            (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        manager.notify(id, builder.build());
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Credit Repair AutoPilot",
                NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("Alerts for dispute cycles, timelines, and overdue items");

            NotificationManager manager =
                (NotificationManager) getApplicationContext()
                    .getSystemService(Context.NOTIFICATION_SERVICE);
            manager.createNotificationChannel(channel);
        }
    }
}
