import json
import os
from pathlib import Path

roots = [
    Path(
        r"C:\Users\dylan\.cursor\projects\d-downloads-DYLANDOS-ULTIMATE-CREDIT-REPAIR-LATEST-newdeepdiveupgradedattempt1\agent-transcripts"
    )
]
targets = {
    "legalIntelligenceEngine.ts",
    "debtTypeStrategyLibrary.ts",
    "solStateMatrix.ts",
    "metro2ViolationDecoder.ts",
    "antiFabricationGuard.ts",
    "uplPhraseBlocklist.ts",
    "accountIdentityGraph.ts",
    "creditorAliasMatrix.ts",
    "ocCaRelationshipDetector.ts",
    "fraudDetectionEngine.ts",
    "inquiryDisputeEngine.ts",
    "goodwillCampaignEngine.ts",
    "scoreImpactSimulator.ts",
    "consumerStatementEngine.ts",
    "abStrategyTracker.ts",
    "auditExportService.ts",
    "onDeviceClassifier.ts",
    "outcomeLearningStore.ts",
    "bureauContactMatrix.ts",
    "featureFlags.ts",
    "InquiryAudit.tsx",
    "FraudAlerts.tsx",
    "GoodwillCampaigns.tsx",
    "KPICockpit.tsx",
    "ConsumerStatement.tsx",
    "StrategyWhyCard.tsx",
    "phase2-tests.ts",
    "apex-tests.ts",
    "PlatformApexPlugin.java",
    "PlatformApexPlugin.kt",
}

latest: dict[str, dict] = {}
for root in roots:
    if not root.exists():
        print("missing root", root)
        continue
    for p in root.rglob("*.jsonl"):
        try:
            text = p.read_text(encoding="utf-8", errors="ignore")
        except OSError as e:
            print("read fail", p, e)
            continue
        for line in text.splitlines():
            if "Write" not in line or "contents" not in line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            msg = obj.get("message", {})
            content = msg.get("content", [])
            if not isinstance(content, list):
                continue
            for block in content:
                if not isinstance(block, dict):
                    continue
                if block.get("name") != "Write":
                    continue
                inp = block.get("input") or {}
                path = inp.get("path") or ""
                contents = inp.get("contents")
                if not path or contents is None:
                    continue
                base = os.path.basename(path)
                if base not in targets:
                    continue
                meta = {
                    "path": path,
                    "contents": contents,
                    "file": str(p),
                    "len": len(contents),
                }
                prev = latest.get(base)
                if not prev or meta["len"] >= prev["len"]:
                    latest[base] = meta

out = Path(__file__).resolve().parent
print("EXTRACTED", len(latest))
for base, meta in sorted(latest.items()):
    dest = out / base
    dest.write_text(meta["contents"], encoding="utf-8")
    print(f"{base}: {meta['len']} bytes <- {Path(meta['file']).name}")
    print(f"  original path: {meta['path']}")
