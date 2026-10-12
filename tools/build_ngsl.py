"""Build app/data/ngsl.json (word form -> frequency rank) from the NGSL 1.2 CSVs.

Usage (from the project root):
    .venv\\Scripts\\python.exe tools\\build_ngsl.py

Source files (downloaded from https://www.newgeneralservicelist.com/ into ngsl_src/):
    NGSL_12_stats.csv                    lemma, SFI rank, ...
    NGSL_12_lemmatized_for_research.csv  lemma followed by its inflected forms

NGSL: Browne, C., Culligan, B., & Phillips, J. The New General Service List,
licensed under CC BY-SA 4.0. The derived ngsl.json is shared under the same license.
"""
import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "ngsl_src"
OUT = ROOT / "app" / "data" / "ngsl.json"


def main() -> None:
    ranks = {}
    with open(SRC / "NGSL_12_stats.csv", encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            ranks[row["Lemma"].strip().lower()] = int(row["SFI Rank"])

    forms = {}
    with open(SRC / "NGSL_12_lemmatized_for_research.csv", encoding="utf-8-sig", newline="") as f:
        for row in csv.reader(f):
            if not row or row[0].startswith("##"):
                continue
            words = [w.strip().lower() for w in row if w.strip()]
            rank = ranks.get(words[0])
            if rank is None:
                continue
            for w in words:
                # a form shared by two lemmas (e.g. "left") keeps the more frequent rank
                forms[w] = min(rank, forms.get(w, rank))

    OUT.write_text(json.dumps({
        "source": "New General Service List 1.2 (Browne, Culligan & Phillips), https://www.newgeneralservicelist.com/",
        "license": "CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/). Derived data: word form -> lemma frequency rank.",
        "lemmas": len(ranks),
        "forms": dict(sorted(forms.items())),
    }, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"lemmas={len(ranks)} forms={len(forms)} size={OUT.stat().st_size / 1e3:.0f}KB")


if __name__ == "__main__":
    main()
