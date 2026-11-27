#!/usr/bin/env python3
"""Static scanner for generic AI-generated ("vibe-coded") frontend patterns.

Usage: vibe_audit.py PATH [--fix-suggestions] [--json]
Exit status: 1 if any HIGH finding, else 0. Read-only: never modifies files.
"""
import argparse, json, re, sys
from pathlib import Path

EXTS = {".tsx", ".jsx", ".ts", ".html", ".css", ".vue", ".svelte"}
SKIP = {"node_modules", ".next", ".git", "dist", "build", ".turbo"}
EMOJI = re.compile("[\U0001F300-\U0001FAFF☀-➿⭐⚡]")

# (id, severity, regex, message, suggestion)
RULES = [
    ("ai-palette", "HIGH", re.compile(r"\b(?:from|via|to|bg|text|border|ring|shadow)-(?:indigo|purple|violet|fuchsia)-\d{2,3}\b|#(?:6366f1|8b5cf6|a855f7|7c3aed)\b", re.I),
     "Default AI indigo/purple/violet palette", "Use the project's brand accent tokens (CSS variables), one decisive accent."),
    ("rainbow-gradient", "HIGH", re.compile(r"from-\w+-\d+\s+via-\w+-\d+\s+to-\w+-\d+"),
     "Three-stop rainbow gradient", "Replace with a flat surface plus a 1px border, or a single-hue wash."),
    ("glassmorphism", "MEDIUM", re.compile(r"backdrop-blur-(?:md|lg|xl)[^\"']*bg-white/\d+|bg-white/\d+[^\"']*backdrop-blur"),
     "Glassmorphism card", "Use solid elevated surfaces with structural borders."),
    ("neon-glow", "MEDIUM", re.compile(r"shadow-(?:purple|indigo|violet|pink|blue|cyan)-\d{3}/\d+"),
     "Neon glow shadow", "Use subtle low-opacity neutral shadows."),
    ("inter-only", "MEDIUM", re.compile(r"font-family\s*:\s*['\"]?Inter\b|\bInter\s*\(|font-inter", re.I),
     "Inter as default typeface", "Adopt an intentional display/body/mono pairing (or the existing brand font)."),
    ("three-col-grid", "LOW", re.compile(r"grid-cols-1\s+(?:sm:|md:)grid-cols-3"),
     "Cookie-cutter 3-column feature grid", "Vary spans (asymmetric 7/5, bento) instead of equal thirds."),
    ("buzzword", "MEDIUM", re.compile(r"\b(unleash|elevate|revolutioni[sz]e|seamless(?:ly)?|next-gen(?:eration)?|supercharge|delve|game-chang\w+|cutting-edge|empower)\b", re.I),
     "AI buzzword copy", "State the concrete, domain-specific fact instead."),
    ("emoji-icon", "HIGH", EMOJI, "Emoji used in UI chrome", "Use inline SVG icons with text labels."),
    ("pure-black-white", "LOW", re.compile(r"background(?:-color)?\s*:\s*(?:#000(?:000)?|#fff(?:fff)?)\s*[;}]", re.I),
     "Flat pure black/white canvas", "Use a tinted canvas token (alabaster/obsidian)."),
]

def scan(root: Path):
    files = [root] if root.is_file() else [p for p in root.rglob("*") if p.suffix in EXTS and not (set(p.parts) & SKIP)]
    out = []
    for f in sorted(files):
        try:
            lines = f.read_text(encoding="utf-8").splitlines()
        except (UnicodeDecodeError, OSError):
            continue
        for n, line in enumerate(lines, 1):
            if line.lstrip().startswith(("//", "*", "/*")) and "copy" not in line.lower():
                pass  # comments still scanned: copy in comments is rare, cheap to review
            for rid, sev, rx, msg, fix in RULES:
                m = rx.search(line)
                if m:
                    out.append({"file": str(f), "line": n, "rule": rid, "severity": sev, "match": m.group(0)[:60], "message": msg, "fix": fix})
    return out

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("path"); ap.add_argument("--fix-suggestions", action="store_true"); ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    res = scan(Path(a.path))
    if a.json:
        print(json.dumps(res, indent=2))
    else:
        for r in res:
            print(f"[{r['severity']}] {r['file']}:{r['line']} {r['rule']}: {r['message']} ({r['match']!r})")
            if a.fix_suggestions:
                print(f"        -> {r['fix']}")
        counts = {s: sum(r["severity"] == s for r in res) for s in ("HIGH", "MEDIUM", "LOW")}
        print(f"\n{len(res)} finding(s): {counts}")
    sys.exit(1 if any(r["severity"] == "HIGH" for r in res) else 0)

if __name__ == "__main__":
    main()
