#!/usr/bin/env python3
"""Static syntax check for inline JavaScript in the ARWANA HTML entry point."""
from pathlib import Path
import re, subprocess, tempfile, sys

html = Path(sys.argv[1] if len(sys.argv) > 1 else "index.html")
if not html.exists():
    raise SystemExit(f"File tidak ditemukan: {html}")
text = html.read_text(encoding="utf-8")
blocks = re.findall(r'<script(?:\s[^>]*)?>(.*?)</script\s*>', text, re.I | re.S)
checked = 0
with tempfile.TemporaryDirectory(prefix="arwana-js-check-") as tmp:
    for i, block in enumerate(blocks):
        if not block.strip():
            continue
        path = Path(tmp) / f"script-{i}.js"
        path.write_text(block, encoding="utf-8")
        result = subprocess.run(["node", "--check", str(path)], capture_output=True, text=True)
        if result.returncode:
            print(result.stderr)
            raise SystemExit(f"GAGAL: inline script #{i}")
        checked += 1
print(f"OK: {html}; {checked} blok JavaScript inline lolos node --check")
# Mentioning secret names in safety instructions is fine; literal key assignments are not.
if re.search(r'(?i)(sk-[A-Za-z0-9_-]{20,}|OPENAI_API_KEY\s*[:=]\s*["\'][^"\']{12,}["\']|service_role\s*[:=]\s*["\'][^"\']{12,}["\'])', text):
    raise SystemExit("GAGAL: kemungkinan nilai secret tertanam di HTML")
print("OK: tidak ditemukan pola nilai secret yang tertanam di HTML")

# PWA artifact checks
from pathlib import Path
root = Path(__file__).resolve().parents[1]
for rel in ["manifest.webmanifest", "service-worker.js", "icons/arwana-192.png", "icons/arwana-512.png"]:
    if not (root / rel).is_file():
        raise SystemExit(f"GAGAL: Missing PWA artifact: {rel}")
try:
    import json
    json.loads((root / "manifest.webmanifest").read_text())
except Exception as exc:
    raise SystemExit(f"GAGAL: Invalid PWA manifest: {exc}")
