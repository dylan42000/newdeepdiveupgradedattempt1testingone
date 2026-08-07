import { CapacitorConfig } from "@capacitor/cli";

const keystorePath = process.env.DYLANDOS_STORE_FILE || "android/app/dylandos-release.jks";
const keystorePassword = process.env.DYLANDOS_STORE_PASSWORD;
const keystoreAlias = process.env.DYLANDOS_KEY_ALIAS || "dylandos";
const keystoreAliasPassword = process.env.DYLANDOS_KEY_PASSWORD;

const config: CapacitorConfig = {
  appId: "com.dylandos.creditrepairsuite",
  appName: "Credit Repair Suite",
  webDir: "dist",
  server: {
    androidScheme: "https",
    cleartext: false,
  },
  android: {
    backgroundColor: "#0f172a",
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
    buildOptions: {
      keystorePath,
      keystorePassword,
      keystoreAlias,
      keystoreAliasPassword,
    },
  },
  plugins: {
    LocalNotifications: {
      smallIcon: "ic_notification",
      iconColor: "#3b82f6",
      sound: "default",
    },
    SecureStoragePlugin: {
      keychainService: "DylandOsCreditRepair",
    },
    DylandosUpdater: {
      manifestUrl: process.env.DYLANDOS_ANDROID_UPDATE_MANIFEST_URL || "",
      channel: process.env.DYLANDOS_ANDROID_UPDATE_CHANNEL || "stable",
    },
  },
};

export default config;
