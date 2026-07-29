import json
import os
from pathlib import Path

root = Path(
    r"C:\Users\dylan\.cursor\projects\d-downloads-DYLANDOS-ULTIMATE-CREDIT-REPAIR-LATEST-newdeepdiveupgradedattempt1\agent-transcripts"
)
targets = {
    "metro2ViolationDecoder.ts",
    "bureauContactMatrix.ts",
    "StrategyWhyCard.tsx",
    "GoodwillCampaigns.tsx",
    "phase2-tests.ts",
    "apex-tests.ts",
    "itemStrategyPlanner.ts",
    "classifierWorker.ts",
    "debtTypeVoicePolicy.ts",
}
# Also capture any Write under src/ that mentions Apex in contents briefly
latest: dict[str, dict] = {}
writes_under_src = []

for p in root.rglob("*.jsonl"):
    try:
        text = p.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        continue
    for line in text.splitlines():
        if '"name":"Write"' not in line and '"name": "Write"' not in line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        for block in obj.get("message", {}).get("content", []) or []:
            if not isinstance(block, dict) or block.get("name") != "Write":
                continue
            inp = block.get("input") or {}
            path = inp.get("path") or ""
            contents = inp.get("contents")
            if not path or contents is None:
                continue
            base = os.path.basename(path)
            if "newdeepdiveupgradedattempt1" in path.replace("/", "\\"):
                if "\\src\\" in path.replace("/", "\\") or "\\android\\" in path.replace(
                    "/", "\\"
                ) or "\\electron\\" in path.replace("/", "\\") or "\\scripts\\" in path.replace(
                    "/", "\\"
                ):
                    writes_under_src.append((base, path, len(contents), str(p)))
            if base not in targets:
                continue
            meta = {"path": path, "contents": contents, "file": str(p), "len": len(contents)}
            prev = latest.get(base)
            if not prev or meta["len"] >= prev["len"]:
                latest[base] = meta

out = Path(__file__).resolve().parent
print("TARGET EXTRACTED", len(latest))
for base, meta in sorted(latest.items()):
    (out / base).write_text(meta["contents"], encoding="utf-8")
    print(f"{base}: {meta['len']} <- {Path(meta['file']).name}")

print("\nALL WRITES (unique basenames) in project:")
seen = {}
for base, path, ln, src in writes_under_src:
    prev = seen.get(base)
    if not prev or ln >= prev[1]:
        seen[base] = (path, ln, src)
for base, (path, ln, src) in sorted(seen.items()):
    print(f"  {base}: {ln} | {path}")
