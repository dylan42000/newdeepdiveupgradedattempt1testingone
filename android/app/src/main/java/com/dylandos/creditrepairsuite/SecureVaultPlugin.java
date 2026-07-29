package com.dylandos.creditrepairsuite;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKey;

import org.json.JSONArray;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name = "SecureVault")
public class SecureVaultPlugin extends Plugin {

    private static final String KEYSTORE_ALIAS = "dylandos_vault_master_v1";
    private static final String ANDROID_KEYSTORE = "AndroidKeyStore";
    private static final int GCM_IV_LENGTH = 12;
    private static final int GCM_TAG_LENGTH = 128;
    private static final String SSN_PREFS_NAME = "dylandos_ssn_store";

    // ═══════════════════════════════════════════════
    // SECTION 1: CRYPTO OPERATIONS
    // ═══════════════════════════════════════════════

    @PluginMethod
    public void ensureVaultKey(PluginCall call) {
        try {
            KeyStore ks = KeyStore.getInstance(ANDROID_KEYSTORE);
            ks.load(null);

            if (!ks.containsAlias(KEYSTORE_ALIAS)) {
                KeyGenerator keyGen = KeyGenerator.getInstance(
                    KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE
                );
                keyGen.init(new KeyGenParameterSpec.Builder(
                    KEYSTORE_ALIAS,
                    KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
                )
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .setUserAuthenticationRequired(false)
                    .build()
                );
                keyGen.generateKey();
            }

            JSObject result = new JSObject();
            result.put("success", true);
            result.put("keyAlias", KEYSTORE_ALIAS);
            call.resolve(result);

        } catch (Exception e) {
            call.reject("Failed to ensure vault key: " + e.getMessage());
        }
    }

    @PluginMethod
    public void isHardwareBacked(PluginCall call) {
        try {
            KeyStore ks = KeyStore.getInstance(ANDROID_KEYSTORE);
            ks.load(null);

            boolean hasKey = ks.containsAlias(KEYSTORE_ALIAS);

            JSObject result = new JSObject();
            result.put("hardwareBacked", true);
            result.put("keyExists", hasKey);
            result.put("provider", "AndroidKeyStore");
            call.resolve(result);

        } catch (Exception e) {
            JSObject result = new JSObject();
            result.put("hardwareBacked", false);
            result.put("error", e.getMessage());
            call.resolve(result);
        }
    }

    @PluginMethod
    public void encryptData(PluginCall call) {
        try {
            String plaintext = call.getString("data");
            if (plaintext == null || plaintext.isEmpty()) {
                call.reject("Missing 'data' parameter");
                return;
            }

            KeyStore ks = KeyStore.getInstance(ANDROID_KEYSTORE);
            ks.load(null);
            SecretKey key = (SecretKey) ks.getKey(KEYSTORE_ALIAS, null);

            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key);

            byte[] iv = cipher.getIV();
            byte[] ciphertext = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));

            // Prepend IV to ciphertext
            byte[] combined = new byte[iv.length + ciphertext.length];
            System.arraycopy(iv, 0, combined, 0, iv.length);
            System.arraycopy(ciphertext, 0, combined, iv.length, ciphertext.length);

            String encoded = Base64.encodeToString(combined, Base64.NO_WRAP);

            JSObject result = new JSObject();
            result.put("encrypted", encoded);
            result.put("algorithm", "AES-256-GCM");
            call.resolve(result);

        } catch (Exception e) {
            call.reject("Encryption failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void decryptData(PluginCall call) {
        try {
            String encoded = call.getString("data");
            if (encoded == null || encoded.isEmpty()) {
                call.reject("Missing 'data' parameter");
                return;
            }

            byte[] combined = Base64.decode(encoded, Base64.NO_WRAP);
            byte[] iv = new byte[GCM_IV_LENGTH];
            byte[] ciphertext = new byte[combined.length - GCM_IV_LENGTH];
            System.arraycopy(combined, 0, iv, 0, GCM_IV_LENGTH);
            System.arraycopy(combined, GCM_IV_LENGTH, ciphertext, 0, ciphertext.length);

            KeyStore ks = KeyStore.getInstance(ANDROID_KEYSTORE);
            ks.load(null);
            SecretKey key = (SecretKey) ks.getKey(KEYSTORE_ALIAS, null);

            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(GCM_TAG_LENGTH, iv));

            byte[] decrypted = cipher.doFinal(ciphertext);
            String plaintext = new String(decrypted, StandardCharsets.UTF_8);

            JSObject result = new JSObject();
            result.put("decrypted", plaintext);
            call.resolve(result);

        } catch (Exception e) {
            call.reject("Decryption failed: " + e.getMessage());
        }
    }

    // ═══════════════════════════════════════════════
    // SECTION 2: SSN OPERATIONS
    // ═══════════════════════════════════════════════

    @PluginMethod
    public void storeSSN(PluginCall call) {
        try {
            String profileId = call.getString("profileId");
            String ssn = call.getString("ssn");
            if (profileId == null || ssn == null) {
                call.reject("Missing profileId or ssn");
                return;
            }

            SharedPreferences prefs = getSSNPrefs();
            prefs.edit().putString("ssn_" + profileId, ssn).apply();

            JSObject result = new JSObject();
            result.put("success", true);
            call.resolve(result);

        } catch (Exception e) {
            call.reject("Failed to store SSN: " + e.getMessage());
        }
    }

    @PluginMethod
    public void retrieveSSN(PluginCall call) {
        try {
            String profileId = call.getString("profileId");
            boolean fullSSN = call.getBoolean("full", false);
            if (profileId == null) {
                call.reject("Missing profileId");
                return;
            }

            SharedPreferences prefs = getSSNPrefs();
            String ssn = prefs.getString("ssn_" + profileId, null);

            JSObject result = new JSObject();
            if (ssn != null) {
                result.put("found", true);
                if (fullSSN) {
                    result.put("ssn", ssn);
                } else {
                    String last4 = ssn.length() >= 4 ? ssn.substring(ssn.length() - 4) : ssn;
                    result.put("last4", last4);
                }
            } else {
                result.put("found", false);
            }
            call.resolve(result);

        } catch (Exception e) {
            call.reject("Failed to retrieve SSN: " + e.getMessage());
        }
    }

    private SharedPreferences getSSNPrefs() throws Exception {
        Context ctx = getContext();
        MasterKey masterKey = new MasterKey.Builder(ctx)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build();

        return EncryptedSharedPreferences.create(
            ctx,
            SSN_PREFS_NAME,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        );
    }

    // ═══════════════════════════════════════════════
    // SECTION 3: VAULT FILE OPERATIONS
    // ═══════════════════════════════════════════════

    @PluginMethod
    public void writeVaultFile(PluginCall call) {
        try {
            String relativePath = call.getString("path");
            String content = call.getString("content");
            if (relativePath == null || content == null) {
                call.reject("Missing path or content");
                return;
            }

            File file = getVaultFile(relativePath);
            file.getParentFile().mkdirs();

            FileOutputStream fos = new FileOutputStream(file);
            fos.write(content.getBytes(StandardCharsets.UTF_8));
            fos.close();

            JSObject result = new JSObject();
            result.put("success", true);
            result.put("path", file.getAbsolutePath());
            result.put("size", file.length());
            call.resolve(result);

        } catch (Exception e) {
            call.reject("Failed to write vault file: " + e.getMessage());
        }
    }

    @PluginMethod
    public void readVaultFile(PluginCall call) {
        try {
            String relativePath = call.getString("path");
            if (relativePath == null) {
                call.reject("Missing path");
                return;
            }

            File file = getVaultFile(relativePath);
            if (!file.exists()) {
                call.reject("File not found: " + relativePath);
                return;
            }

            FileInputStream fis = new FileInputStream(file);
            byte[] data = new byte[(int) file.length()];
            fis.read(data);
            fis.close();

            JSObject result = new JSObject();
            result.put("content", new String(data, StandardCharsets.UTF_8));
            result.put("size", file.length());
            result.put("lastModified", file.lastModified());
            call.resolve(result);

        } catch (Exception e) {
            call.reject("Failed to read vault file: " + e.getMessage());
        }
    }

    @PluginMethod
    public void listVaultDirectory(PluginCall call) {
        try {
            String relativePath = call.getString("path", "");
            File dir = getVaultFile(relativePath);

            if (!dir.exists() || !dir.isDirectory()) {
                JSObject result = new JSObject();
                result.put("files", new JSArray());
                call.resolve(result);
                return;
            }

            File[] files = dir.listFiles();
            JSONArray fileList = new JSONArray();

            if (files != null) {
                for (File f : files) {
                    JSObject fileInfo = new JSObject();
                    fileInfo.put("name", f.getName());
                    fileInfo.put("isDirectory", f.isDirectory());
                    fileInfo.put("size", f.length());
                    fileInfo.put("lastModified", f.lastModified());
                    fileList.put(fileInfo);
                }
            }

            JSObject result = new JSObject();
            result.put("files", fileList);
            call.resolve(result);

        } catch (Exception e) {
            call.reject("Failed to list vault directory: " + e.getMessage());
        }
    }

    @PluginMethod
    public void deleteVaultFile(PluginCall call) {
        try {
            String relativePath = call.getString("path");
            if (relativePath == null) {
                call.reject("Missing path");
                return;
            }

            File file = getVaultFile(relativePath);
            if (!file.exists()) {
                call.reject("File not found: " + relativePath);
                return;
            }

            // Soft delete: move to _deleted/ directory
            File deletedDir = getVaultFile("_deleted");
            deletedDir.mkdirs();

            File dest = new File(deletedDir, System.currentTimeMillis() + "_" + file.getName());
            boolean moved = file.renameTo(dest);

            JSObject result = new JSObject();
            result.put("success", moved);
            result.put("softDeleted", true);
            result.put("deletedPath", dest.getAbsolutePath());
            call.resolve(result);

        } catch (Exception e) {
            call.reject("Failed to delete vault file: " + e.getMessage());
        }
    }

    @PluginMethod
    public void appendAuditLog(PluginCall call) {
        try {
            String profileId = call.getString("profileId");
            String entry = call.getString("entry");
            if (profileId == null || entry == null) {
                call.reject("Missing profileId or entry");
                return;
            }

            String logPath = profileId + "/audit.log";
            File logFile = getVaultFile(logPath);
            logFile.getParentFile().mkdirs();

            String timestamp = String.valueOf(System.currentTimeMillis());
            String line = timestamp + "|" + entry + "\n";

            FileOutputStream fos = new FileOutputStream(logFile, true);
            fos.write(line.getBytes(StandardCharsets.UTF_8));
            fos.close();

            JSObject result = new JSObject();
            result.put("success", true);
            call.resolve(result);

        } catch (Exception e) {
            call.reject("Failed to append audit log: " + e.getMessage());
        }
    }

    @PluginMethod
    public void getVaultBasePath(PluginCall call) {
        File vaultDir = new File(getContext().getFilesDir(), "vault");
        vaultDir.mkdirs();

        JSObject result = new JSObject();
        result.put("path", vaultDir.getAbsolutePath());
        call.resolve(result);
    }

    private File getVaultFile(String relativePath) throws SecurityException {
        if (relativePath == null || relativePath.isEmpty()) {
            throw new SecurityException("Path must be a non-empty string");
        }
        if (relativePath.contains("\0")) {
            throw new SecurityException("Null byte in path");
        }

        File vaultDir = new File(getContext().getFilesDir(), "vault");
        vaultDir.mkdirs();

        File target = new File(vaultDir, relativePath);
        try {
            String vaultCanon = vaultDir.getCanonicalPath();
            String targetCanon = target.getCanonicalPath();
            if (!targetCanon.equals(vaultCanon) && !targetCanon.startsWith(vaultCanon + File.separator)) {
                throw new SecurityException("Path traversal attempt blocked: " + relativePath);
            }
            return target;
        } catch (java.io.IOException e) {
            throw new SecurityException("Failed to resolve vault path: " + e.getMessage());
        }
    }
}
