package com.dylandos.creditrepairsuite;

import android.content.Intent;
import android.os.Handler;
import android.os.Looper;

import androidx.annotation.NonNull;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.concurrent.Executor;

@CapacitorPlugin(name = "PlatformApex")
public class PlatformApexPlugin extends Plugin {

    @PluginMethod
    public void authenticate(PluginCall call) {
        String reason = call.getString("reason", "Unlock to view sensitive dispute details");
        FragmentActivity activity = getActivity();
        if (activity == null) {
            call.reject("No activity available for biometric prompt");
            return;
        }

        BiometricManager manager = BiometricManager.from(getContext());
        int can = manager.canAuthenticate(
            BiometricManager.Authenticators.BIOMETRIC_WEAK
                | BiometricManager.Authenticators.DEVICE_CREDENTIAL
        );
        if (can != BiometricManager.BIOMETRIC_SUCCESS) {
            // Not enrolled / unavailable — do not hard-block Autopilot on unsupported devices.
            JSObject skip = new JSObject();
            skip.put("success", true);
            skip.put("skipped", true);
            skip.put("reason", "biometric_unavailable");
            call.resolve(skip);
            return;
        }

        Executor executor = ContextCompat.getMainExecutor(getContext());
        activity.runOnUiThread(() -> {
            BiometricPrompt prompt = new BiometricPrompt(
                activity,
                executor,
                new BiometricPrompt.AuthenticationCallback() {
                    @Override
                    public void onAuthenticationSucceeded(
                        @NonNull BiometricPrompt.AuthenticationResult result
                    ) {
                        JSObject ok = new JSObject();
                        ok.put("success", true);
                        ok.put("skipped", false);
                        call.resolve(ok);
                    }

                    @Override
                    public void onAuthenticationError(int errorCode, @NonNull CharSequence errString) {
                        // User cancel / lockout — soft fail so UI can keep content hidden.
                        if (errorCode == BiometricPrompt.ERROR_NEGATIVE_BUTTON
                            || errorCode == BiometricPrompt.ERROR_USER_CANCELED
                            || errorCode == BiometricPrompt.ERROR_CANCELED) {
                            JSObject denied = new JSObject();
                            denied.put("success", false);
                            denied.put("skipped", false);
                            denied.put("error", errString.toString());
                            call.resolve(denied);
                            return;
                        }
                        call.reject(errString.toString());
                    }

                    @Override
                    public void onAuthenticationFailed() {
                        // Keep prompt open; no resolve yet.
                    }
                }
            );

            BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
                .setTitle("DylandOs Secure Unlock")
                .setSubtitle(reason)
                .setAllowedAuthenticators(
                    BiometricManager.Authenticators.BIOMETRIC_WEAK
                        | BiometricManager.Authenticators.DEVICE_CREDENTIAL
                )
                .build();

            prompt.authenticate(info);
        });
    }

    @PluginMethod
    public void shareText(PluginCall call) {
        String title = call.getString("title", "DylandOs");
        String text = call.getString("text", "");
        if (text == null || text.isEmpty()) {
            call.reject("No text to share");
            return;
        }

        try {
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType("text/plain");
            send.putExtra(Intent.EXTRA_SUBJECT, title);
            send.putExtra(Intent.EXTRA_TEXT, text);
            Intent chooser = Intent.createChooser(send, "Share " + title);
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(chooser);

            JSObject result = new JSObject();
            result.put("success", true);
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Failed to open share sheet: " + e.getMessage());
        }
    }

    @PluginMethod
    public void canAuthenticate(PluginCall call) {
        BiometricManager manager = BiometricManager.from(getContext());
        int can = manager.canAuthenticate(
            BiometricManager.Authenticators.BIOMETRIC_WEAK
                | BiometricManager.Authenticators.DEVICE_CREDENTIAL
        );
        JSObject result = new JSObject();
        result.put("available", can == BiometricManager.BIOMETRIC_SUCCESS);
        result.put("status", can);
        call.resolve(result);
    }
}
