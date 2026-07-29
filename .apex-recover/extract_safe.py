"""Extract Apex Write payloads excluding sacred parser paths."""
import json
import os
from pathlib import Path

root = Path(
    r"C:\Users\dylan\.cursor\projects\d-downloads-DYLANDOS-ULTIMATE-CREDIT-REPAIR-LATEST-newdeepdiveupgradedattempt1\agent-transcripts"
)
out = Path(__file__).resolve().parent / "safe"
out.mkdir(exist_ok=True)

# basename -> preferred relative dest under project
DEST = {
    "legalIntelligenceEngine.ts": "src/services/legalIntelligenceEngine.ts",
    "debtTypeStrategyLibrary.ts": "src/services/debtTypeStrategyLibrary.ts",
    "solStateMatrix.ts": "src/services/solStateMatrix.ts",
    "antiFabricationGuard.ts": "src/services/antiFabricationGuard.ts",
    "uplPhraseBlocklist.ts": "src/services/uplPhraseBlocklist.ts",
    "accountIdentityGraph.ts": "src/services/accountIdentityGraph.ts",
    "creditorAliasMatrix.ts": "src/data/creditorAliasMatrix.ts",
    "ocCaRelationshipDetector.ts": "src/services/ocCaRelationshipDetector.ts",
    "fraudDetectionEngine.ts": "src/services/fraudDetectionEngine.ts",
    "inquiryDisputeEngine.ts": "src/services/inquiryDisputeEngine.ts",
    "goodwillCampaignEngine.ts": "src/services/goodwillCampaignEngine.ts",
    "scoreImpactSimulator.ts": "src/services/scoreImpactSimulator.ts",
    "consumerStatementEngine.ts": "src/services/consumerStatementEngine.ts",
    "abStrategyTracker.ts": "src/services/abStrategyTracker.ts",
    "auditExportService.ts": "src/services/auditExportService.ts",
    "onDeviceClassifier.ts": "src/services/onDeviceClassifier.ts",
    "outcomeLearningStore.ts": "src/services/outcomeLearningStore.ts",
    "featureFlags.ts": "src/config/featureFlags.ts",
    "itemStrategyPlanner.ts": "src/services/itemStrategyPlanner.ts",
    "educationContentService.ts": "src/services/educationContentService.ts",
    "furnisherDirectEngine.ts": "src/services/furnisherDirectEngine.ts",
    "InquiryAudit.tsx": "src/pages/InquiryAudit.tsx",
    "FraudAlerts.tsx": "src/pages/FraudAlerts.tsx",
    "GoodwillCampaign.tsx": "src/pages/GoodwillCampaign.tsx",
    "KPICockpit.tsx": "src/pages/KPICockpit.tsx",
    "ConsumerStatement.tsx": "src/pages/ConsumerStatement.tsx",
    "PlatformApexPlugin.java": "android/app/src/main/java/com/dylandos/creditrepairsuite/PlatformApexPlugin.java",
    "verify-electron-dist.cjs": "scripts/verify-electron-dist.cjs",
}

FORBIDDEN_SUBSTR = [
    "creditReportParser",
    "Testparsercreated",
]

latest: dict[str, dict] = {}
for p in root.rglob("*.jsonl"):
    try:
        text = p.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        continue
    for line in text.splitlines():
        if "Write" not in line or "contents" not in line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        for block in obj.get("message", {}).get("content", []) or []:
            if not isinstance(block, dict) or block.get("name") != "Write":
                continue
            inp = block.get("input") or {}
            path = (inp.get("path") or "").replace("/", "\\")
            contents = inp.get("contents")
            if not path or contents is None:
                continue
            if any(f in path for f in FORBIDDEN_SUBSTR):
                continue
            base = os.path.basename(path)
            if base not in DEST:
                continue
            meta = {"path": path, "contents": contents, "len": len(contents), "src": str(p)}
            prev = latest.get(base)
            if not prev or meta["len"] >= prev["len"]:
                latest[base] = meta

manifest = []
for base, meta in sorted(latest.items()):
    dest_rel = DEST[base]
    dest = out / dest_rel.replace("/", os.sep)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(meta["contents"], encoding="utf-8")
    manifest.append(f"{dest_rel}\t{meta['len']}")
    print(f"OK {dest_rel} ({meta['len']})")

(out / "MANIFEST.txt").write_text("\n".join(manifest) + "\n", encoding="utf-8")
print("TOTAL", len(latest))
