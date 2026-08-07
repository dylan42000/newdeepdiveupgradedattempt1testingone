import { Capacitor } from "@capacitor/core";

export interface AndroidUpdateManifest {
  appId: string;
  platform: "android";
  channel?: "stable" | "beta";
  latestVersion: string;
  latestVersionCode?: number;
  apkUrl: string;
  releaseNotes?: string;
  mandatory?: boolean;
  publishedAt?: string;
  checksumSha256?: string;
}

export interface AndroidUpdateCheckResult {
  updateAvailable: boolean;
  currentVersion: string;
  manifest: AndroidUpdateManifest;
}

function parseVersionParts(version: string): number[] {
  const clean = (version || "")
    .trim()
    .replace(/^v/i, "")
    .split("-")[0];

  return clean
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) && part >= 0 ? part : 0));
}

export function compareSemanticVersions(current: string, target: string): number {
  const currentParts = parseVersionParts(current);
  const targetParts = parseVersionParts(target);
  const maxParts = Math.max(currentParts.length, targetParts.length);

  for (let index = 0; index < maxParts; index += 1) {
    const currentPart = currentParts[index] ?? 0;
    const targetPart = targetParts[index] ?? 0;

    if (currentPart < targetPart) return -1;
    if (currentPart > targetPart) return 1;
  }

  return 0;
}

function assertHttpUrl(value: string, label: string): string {
  const trimmed = (value || "").trim();
  if (!trimmed) {
    throw new Error(`${label} is required.`);
  }
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error(`${label} must be an http(s) URL.`);
  }
  return trimmed;
}

function parseManifest(raw: unknown): AndroidUpdateManifest {
  if (!raw || typeof raw !== "object") {
    throw new Error("Update manifest is not a valid JSON object.");
  }

  const candidate = raw as Record<string, unknown>;
  const platform = String(candidate.platform || "").toLowerCase();

  if (platform && platform !== "android") {
    throw new Error("Update manifest platform must be 'android'.");
  }

  const manifest: AndroidUpdateManifest = {
    appId: String(candidate.appId || "com.dylandos.creditrepairsuite"),
    platform: "android",
    channel:
      candidate.channel === "beta" || candidate.channel === "stable"
        ? candidate.channel
        : undefined,
    latestVersion: String(candidate.latestVersion || "").trim(),
    latestVersionCode:
      typeof candidate.latestVersionCode === "number" ? candidate.latestVersionCode : undefined,
    apkUrl: assertHttpUrl(String(candidate.apkUrl || ""), "apkUrl"),
    releaseNotes: typeof candidate.releaseNotes === "string" ? candidate.releaseNotes : undefined,
    mandatory: Boolean(candidate.mandatory),
    publishedAt: typeof candidate.publishedAt === "string" ? candidate.publishedAt : undefined,
    checksumSha256: typeof candidate.checksumSha256 === "string" ? candidate.checksumSha256 : undefined,
  };

  if (!manifest.latestVersion) {
    throw new Error("latestVersion is required in the update manifest.");
  }

  return manifest;
}

export function isAndroidPlatform(): boolean {
  return Capacitor.getPlatform() === "android";
}

export async function checkForAndroidUpdate(
  manifestUrl: string,
  currentVersion: string,
  desiredChannel: "stable" | "beta" = "stable",
): Promise<AndroidUpdateCheckResult> {
  const sourceUrl = assertHttpUrl(manifestUrl, "Manifest URL");

  const response = await fetch(sourceUrl, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "Cache-Control": "no-cache",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch update manifest (HTTP ${response.status}).`);
  }

  const rawManifest = (await response.json()) as unknown;
  const manifest = parseManifest(rawManifest);
  const channelMatches = !manifest.channel || manifest.channel === desiredChannel;
  const updateAvailable = channelMatches && compareSemanticVersions(currentVersion, manifest.latestVersion) < 0;

  return {
    updateAvailable,
    currentVersion,
    manifest,
  };
}

export function openAndroidUpdateUrl(apkUrl: string): void {
  const safeUrl = assertHttpUrl(apkUrl, "APK download URL");
  window.open(safeUrl, "_blank", "noopener,noreferrer");
}
