import React, { useEffect, useRef, useState } from "react";
import { APP_VERSION, AppProvider, useAppContext } from "./context/AppContext";
import { ToastProvider } from "./context/ToastContext";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Layout } from "./components/layout/Layout";
import { Dashboard } from "./pages/Dashboard";
import UploadReport from "./pages/UploadReport";
import { NegativeItems } from "./pages/NegativeItems";
import { DisputeLetters } from "./pages/DisputeLetters";
import { Autopilot } from "./pages/Autopilot";
import { Vault } from "./pages/Vault";
import { History } from "./pages/History";
import { ScoreTracker } from "./pages/ScoreTracker";
import { AddressLookup } from "./pages/AddressLookup";
import { SOLCalculator } from "./pages/SOLCalculator";
import { SettingsPage } from "./pages/Settings";
import { Profile } from "./pages/Profile";
import { Gamification } from "./pages/Gamification";
import { Tools } from "./pages/Tools";
import { MoreMenu } from "./pages/MoreMenu";
import { CreditBuilder } from "./pages/CreditBuilder";
import { DisputeCalendar } from "./pages/DisputeCalendar";
import { InquiryAudit } from "./pages/InquiryAudit";
import { FraudAlerts } from "./pages/FraudAlerts";
import { GoodwillCampaign } from "./pages/GoodwillCampaign";
import { KPICockpit } from "./pages/KPICockpit";
import { ConsumerStatement } from "./pages/ConsumerStatement";
import { Cases } from "./pages/Cases";
import { checkForAndroidUpdate } from "./services/androidUpdateService";
import { DebugParsePanel } from "./components/DebugParsePanel";
// BUG-08 FIX: Run one-time localStorage → IndexedDB migration on startup
import { runAutopilotMigration, restoreFromIDB } from "./services/autopilotMigration";
import { initAndroidNotificationHandler } from "./services/platform/androidNotificationHandler";
import { PlatformService } from "./services/platformService";
import { scanReportForFraud } from "./services/fraudDetectionEngine";

export type AppPage =
  | "dashboard"
  | "upload"
  | "negative-items"
  | "dispute-letters"
  | "autopilot"
  | "cases"
  | "documents"
  | "results"
  | "dispute-calendar"
  | "vault"
  | "history"
  | "score-tracker"
  | "address-lookup"
  | "sol-calculator"
  | "settings"
  | "profile"
  | "gamification"
  | "tools"
  | "more"
  | "credit-builder"
  | "inquiry-audit"
  | "fraud-alerts"
  | "goodwill"
  | "kpi-cockpit"
  | "consumer-statement";

function AppContent() {
  const [currentPage, setCurrentPage] = useState<AppPage>("autopilot");
  const {
    autopilot, updateAutopilot, logEvent, lastParseDebugLog, profiles,
    campaigns, negativeItems, personalInfo,
  } = useAppContext();
  const updateCheckRanRef = useRef(false);
  const migrationRanRef = useRef(false);
  const [debugPanelOpen, setDebugPanelOpen] = useState(false);

  // Apex — Electron tray navigation + status tooltip
  useEffect(() => {
    const api = (window as unknown as {
      electronAPI?: {
        onTrayNavigate?: (cb: (payload: { page?: string }) => void) => (() => void) | void;
        onTrayRunCycle?: (cb: () => void) => (() => void) | void;
        updateTrayStatus?: (info: Record<string, unknown>) => Promise<unknown>;
      };
    }).electronAPI;
    if (!api) return;

    const offNav = api.onTrayNavigate?.((payload) => {
      const page = payload?.page as AppPage | undefined;
      if (page) setCurrentPage(page);
    });
    const offRun = api.onTrayRunCycle?.(() => setCurrentPage("autopilot"));

    const fraudAlerts = scanReportForFraud(negativeItems, {
      ssn: personalInfo.ssn,
      address: personalInfo.address,
      city: personalInfo.city,
      state: personalInfo.state,
    }).length;
    void api.updateTrayStatus?.({
      activeCampaigns: campaigns.filter((c) => c.status === "Active").length,
      nextCycleDate: autopilot.enabled ? "scheduled" : "idle",
      fraudAlerts,
    });

    return () => {
      if (typeof offNav === "function") offNav();
      if (typeof offRun === "function") offRun();
    };
  }, [campaigns, negativeItems, personalInfo, autopilot.enabled]);

  // Apex — Android share-sheet intake → Upload page
  useEffect(() => {
    const handler = () => setCurrentPage("upload");
    window.addEventListener("dylandos_share_intake", handler as EventListener);
    return () => window.removeEventListener("dylandos_share_intake", handler as EventListener);
  }, []);

  // BUG-08 FIX: Run one-time AutoPilot state migration from localStorage → IndexedDB.
  // Must run before any AutoPilot service reads state.
  useEffect(() => {
    if (migrationRanRef.current) return;
    migrationRanRef.current = true;
    const profileIds = (profiles ?? []).map((p: { id: string }) => p.id).filter(Boolean);
    // Always include the default profile ID even if profiles array is empty
    if (!profileIds.includes('default')) profileIds.push('default');
    // BUG-08/09 FIX: First migrate old localStorage data to IDB, then restore IDB → localStorage
    // cache so the synchronous engine reads have warm data after a browser refresh.
    runAutopilotMigration(profileIds)
      .then(() => restoreFromIDB(profileIds))
      .catch(() => {});
  }, [profiles]);

  // Android notification deep-links → navigate to Autopilot
  useEffect(() => {
    if (!PlatformService.isAndroid()) return;
    initAndroidNotificationHandler((path) => {
      if (path.includes("autopilot")) setCurrentPage("autopilot");
    });
  }, []);

  // Ctrl+Shift+D → toggle parser debug overlay from any page
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === "D") {
        e.preventDefault();
        setDebugPanelOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (updateCheckRanRef.current) return;
    updateCheckRanRef.current = true;

    const manifestUrl = (autopilot.androidUpdateManifestUrl || "").trim();
    if (!autopilot.androidUpdateAutoCheck || !manifestUrl) return;

    const now = Date.now();
    const lastChecked = autopilot.androidUpdateLastCheckedAt
      ? new Date(autopilot.androidUpdateLastCheckedAt).getTime()
      : 0;

    // Prevent noisy startup checks by limiting to one check every 12 hours.
    if (lastChecked > 0 && now - lastChecked < 12 * 60 * 60 * 1000) {
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const result = await checkForAndroidUpdate(
          manifestUrl,
          APP_VERSION,
          autopilot.androidUpdateChannel,
        );
        if (cancelled) return;

        updateAutopilot({ androidUpdateLastCheckedAt: new Date().toISOString() });

        if (result.updateAvailable) {
          logEvent({
            type: "note_added",
            title: "Android update available",
            detail: `Version ${result.manifest.latestVersion} is available from your update feed.`,
          });
        }
      } catch {
        if (!cancelled) {
          updateAutopilot({ androidUpdateLastCheckedAt: new Date().toISOString() });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    autopilot.androidUpdateAutoCheck,
    autopilot.androidUpdateManifestUrl,
    autopilot.androidUpdateChannel,
    autopilot.androidUpdateLastCheckedAt,
    logEvent,
    updateAutopilot,
  ]);

  const renderPage = () => {
    switch (currentPage) {
      case "dashboard": return <Dashboard />;
      case "upload": return <UploadReport onNavigate={(p) => setCurrentPage(p as AppPage)} />;
      case "negative-items": return <NegativeItems />;
      case "dispute-letters": return <DisputeLetters />;
      case "autopilot": return <Autopilot onNavigate={setCurrentPage} />;
      case "cases": return <Cases />;
      case "documents": return <Vault />;
      case "results": return <History />;
      case "dispute-calendar": return <DisputeCalendar />;
      case "vault": return <Vault />;
      case "history": return <History />;
      case "score-tracker": return <ScoreTracker />;
      case "address-lookup": return <AddressLookup />;
      case "sol-calculator": return <SOLCalculator />;
      case "settings": return <SettingsPage />;
      case "profile": return <Profile />;
      case "gamification": return <Gamification />;
      case "tools": return <Tools />;
      case "more": return <MoreMenu navigate={setCurrentPage} />;
      case "credit-builder": return <CreditBuilder />;
      case "inquiry-audit": return <InquiryAudit />;
      case "fraud-alerts": return <FraudAlerts />;
      case "goodwill": return <GoodwillCampaign />;
      case "kpi-cockpit": return <KPICockpit />;
      case "consumer-statement": return <ConsumerStatement />;
      default: {
        const _exhaustive: never = currentPage;
        void _exhaustive;
        return <Autopilot onNavigate={setCurrentPage} />;
      }
    }
  };

  return (
    <Layout currentPage={currentPage} onNavigate={setCurrentPage}>
      {renderPage()}
      <DebugParsePanel
        log={lastParseDebugLog}
        isOpen={debugPanelOpen}
        onClose={() => setDebugPanelOpen(false)}
      />
    </Layout>
  );
}

function App() {
  return (
    <ErrorBoundary label="providers">
      <AppProvider>
        <ToastProvider>
          <ErrorBoundary label="main UI">
            <AppContent />
          </ErrorBoundary>
        </ToastProvider>
      </AppProvider>
    </ErrorBoundary>
  );
}

export default App;
