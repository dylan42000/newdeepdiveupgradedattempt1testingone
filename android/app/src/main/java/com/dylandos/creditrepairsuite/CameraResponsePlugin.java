package com.dylandos.creditrepairsuite;

import android.Manifest;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;

import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

@CapacitorPlugin(
    name = "CameraResponse",
    permissions = {
        @Permission(
            strings = { Manifest.permission.CAMERA },
            alias = "camera"
        )
    }
)
public class CameraResponsePlugin extends Plugin {

    private Uri photoUri;

    @PluginMethod
    public void scanResponseLetter(PluginCall call) {
        if (getPermissionState("camera") != PermissionState.GRANTED) {
            requestPermissionForAlias("camera", call, "cameraPermissionCallback");
            return;
        }

        launchCamera(call);
    }

    @PermissionCallback
    private void cameraPermissionCallback(PluginCall call) {
        if (getPermissionState("camera") == PermissionState.GRANTED) {
            launchCamera(call);
        } else {
            call.reject("Camera permission is required to scan response letters");
        }
    }

    private void launchCamera(PluginCall call) {
        try {
            Intent takePictureIntent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);

            File photoFile = createImageFile();
            photoUri = FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                photoFile
            );

            takePictureIntent.putExtra(MediaStore.EXTRA_OUTPUT, photoUri);

            startActivityForResult(call, takePictureIntent, "cameraResultCallback");

        } catch (IOException e) {
            call.reject("Failed to launch camera: " + e.getMessage());
        }
    }

    @ActivityCallback
    private void cameraResultCallback(PluginCall call, ActivityResult result) {
        if (call == null) return;

        try {
            if (result.getResultCode() == android.app.Activity.RESULT_OK) {
                Bitmap bitmap = BitmapFactory.decodeStream(
                    getContext().getContentResolver().openInputStream(photoUri)
                );

                if (bitmap == null) {
                    call.reject("Failed to decode captured image");
                    return;
                }

                // Compress to JPEG
                ByteArrayOutputStream baos = new ByteArrayOutputStream();
                bitmap.compress(Bitmap.CompressFormat.JPEG, 85, baos);
                byte[] imageBytes = baos.toByteArray();
                String imageBase64 = Base64.encodeToString(imageBytes, Base64.NO_WRAP);

                JSObject result2 = new JSObject();
                result2.put("imageBase64", imageBase64);
                result2.put("mimeType", "image/jpeg");
                result2.put("width", bitmap.getWidth());
                result2.put("height", bitmap.getHeight());
                result2.put("sizeBytes", imageBytes.length);
                call.resolve(result2);

                bitmap.recycle();

            } else {
                call.reject("Camera capture cancelled");
            }

        } catch (Exception e) {
            call.reject("Failed to process captured image: " + e.getMessage());
        }
    }

    private File createImageFile() throws IOException {
        String timeStamp = new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(new Date());
        String imageFileName = "RESPONSE_" + timeStamp + "_";
        File storageDir = getContext().getExternalFilesDir(Environment.DIRECTORY_PICTURES);
        return File.createTempFile(imageFileName, ".jpg", storageDir);
    }
}
