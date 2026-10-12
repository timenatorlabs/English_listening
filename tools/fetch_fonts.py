"""Download Noto Sans JP (SIL Open Font License 1.1) as self-hosted woff2 files.

Usage (from the project root):
    .venv\\Scripts\\python.exe tools\\fetch_fonts.py

Google Fonts splits the font into many small files by character range
(unicode-range), so the browser downloads only the pieces a page needs.
The files are stored under app/fonts/ and served from our own site, so viewers'
browsers never contact Google.
"""
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "app" / "fonts"
CSS_URL = "https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700&display=swap"
LICENSE_URL = "https://raw.githubusercontent.com/google/fonts/main/ofl/notosansjp/OFL.txt"
# A modern browser user agent makes Google Fonts return woff2 files.
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"


def get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    css = get(CSS_URL).decode("utf-8")
    blocks = re.findall(r"@font-face\s*\{[^}]*\}", css)
    names = {}   # one woff2 can serve several weights (variable font)
    total = 0
    out = []
    for block in blocks:
        url = re.search(r"url\((https://fonts\.gstatic\.com/[^)]+\.woff2)\)", block).group(1)
        if url not in names:
            names[url] = f"noto-sans-jp-{len(names):03d}.woff2"
            path = OUT / names[url]
            if not path.exists():
                path.write_bytes(get(url))
            total += path.stat().st_size
        out.append(block.replace(url, names[url]))
    (OUT / "noto-sans-jp.css").write_text("\n".join(out) + "\n", encoding="utf-8")
    (OUT / "OFL.txt").write_bytes(get(LICENSE_URL))
    print(f"rules={len(blocks)} files={len(names)} total={total / 1e6:.1f}MB")


if __name__ == "__main__":
    main()
