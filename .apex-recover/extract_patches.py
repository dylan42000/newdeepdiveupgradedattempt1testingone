"""Dump StrReplace patches for key wiring files into readable markdown."""
import json
from pathlib import Path

root = Path(
    r"C:\Users\dylan\.cursor\projects\d-downloads-DYLANDOS-ULTIMATE-CREDIT-REPAIR-LATEST-newdeepdiveupgradedattempt1\agent-transcripts"
)
out = Path(__file__).resolve().parent / "patches"
out.mkdir(exist_ok=True)

WATCH = [
    "App.tsx",
    "Layout.tsx",
    "main.cjs",
    "preload.cjs",
    "AutoPilotDashboard.tsx",
    "DisputeLetters.tsx",
    "UploadReport.tsx",
    "phase2-tests.ts",
    "MainActivity.java",
    "build.gradle",
    "itemStrategyPlanner.ts",
    "autoPilotEngineV2.ts",
    "tradelineMerger.ts",
    "aiRouter.ts",
    "Settings.tsx",
]

patches: dict[str, list] = {k: [] for k in WATCH}

for p in sorted(root.rglob("*.jsonl")):
    for line in p.read_text(encoding="utf-8", errors="ignore").splitlines():
        if "StrReplace" not in line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        for block in obj.get("message", {}).get("content", []) or []:
            if not isinstance(block, dict) or block.get("name") != "StrReplace":
                continue
            inp = block.get("input") or {}
            path = inp.get("path") or ""
            if "newdeepdiveupgradedattempt1" not in path.replace("/", "\\"):
                continue
            base = Path(path).name
            if base not in patches:
                continue
            old = inp.get("old_string") or ""
            new = inp.get("new_string") or ""
            patches[base].append(
                {
                    "src": p.name,
                    "path": path,
                    "old": old,
                    "new": new,
                    "old_len": len(old),
                    "new_len": len(new),
                }
            )

for base, items in patches.items():
    if not items:
        continue
    md = [f"# Patches for {base} ({len(items)})\n"]
    for i, it in enumerate(items, 1):
        md.append(f"## Patch {i} from {it['src']}")
        md.append(f"Path: `{it['path']}`")
        md.append(f"### OLD ({it['old_len']})")
        md.append("```")
        md.append(it["old"][:8000])
        md.append("```")
        md.append(f"### NEW ({it['new_len']})")
        md.append("```")
        md.append(it["new"][:8000])
        md.append("```\n")
    (out / f"{base}.md").write_text("\n".join(md), encoding="utf-8")
    print(f"{base}: {len(items)} patches")
