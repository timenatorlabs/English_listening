"""Report NGSL coverage of each learning material, to check that texts suit their level.

Usage (from the project root, after tools/build_ngsl.py):
    .venv\\Scripts\\python.exe -X utf8 tools\\coverage_report.py

Level bands follow app/vocab.js: level 1 = NGSL top 1000, level 2 = top 2000,
level 3+ = whole NGSL (2809). Research suggests ~95% known-word coverage is
needed for adequate listening comprehension (van Zeeland & Schmitt 2013).
Proper nouns (any word that appears capitalized mid-sentence somewhere in the
text), numbers, number words, days and months are not counted, as NGSL leaves
them out of the main list.
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BANDS = {1: 1000, 2: 2000, 3: 2809, 4: 2809, 5: 2809}
SPECIAL = {"can't": ["can", "not"], "won't": ["will", "not"], "let's": ["let", "us"]}
SUFFIX = {"m": "am", "re": "are", "ve": "have", "ll": "will", "s": "is"}
EXCLUDED = set(("zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen "
                "sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred "
                "hundreds thousand thousands million first second third "
                "monday tuesday wednesday thursday friday saturday sunday mondays "
                "january february march april may june july august september october november december "
                "oh ok okay").split())


def proper_nouns(text):
    """Words capitalized somewhere other than at the start of a sentence."""
    names = set()
    first = True
    for raw in text.replace("’", "'").split():
        w = re.sub(r"[^A-Za-z']+", "", raw).strip("'")
        if w and w[0].isupper() and not first and w != "I" and not w.startswith("I'"):
            names.add(w.lower())
        first = raw.rstrip('"').endswith((".", "?", "!", ":"))
    return names


def words_of(text):
    out = []
    names = proper_nouns(text)
    for raw in text.replace("’", "'").split():
        w = re.sub(r"[^A-Za-z0-9']+", "", raw).strip("'")
        if not w or w.isdigit() or w.lower() in names or w.lower() in EXCLUDED:
            continue
        w = w.lower()
        if w in SPECIAL:
            out += SPECIAL[w]
            continue
        m = re.match(r"^(.+)n't$", w)
        if m:
            out += [m.group(1), "not"]
            continue
        m = re.match(r"^(.+)'(m|re|ve|ll|d|s)$", w)
        if m:
            out.append(m.group(1))
            if m.group(2) in SUFFIX:
                out.append(SUFFIX[m.group(2)])
            continue
        out.append(w)
    return out


def main():
    forms = json.loads((ROOT / "app" / "data" / "ngsl.json").read_text(encoding="utf-8"))["forms"]
    data = ROOT / "data"
    materials = []
    for s in json.loads((data / "dictation_sentences.json").read_text(encoding="utf-8"))["sentences"]:
        materials.append((f"dictation L{s['level']}", s["level"], s["text"]))
    for p in json.loads((data / "shadowing_passages.json").read_text(encoding="utf-8"))["passages"]:
        materials.append((f"shadowing {p['id']}", p["level"], " ".join(x["text"] for x in p["sentences"])))
    for s in json.loads((data / "stories.json").read_text(encoding="utf-8"))["stories"]:
        materials.append((f"story {s['id']}", s["level"], " ".join(x["text"] for x in s["sentences"])))

    # dictation sentences are short, so aggregate them per level
    merged = {}
    for name, level, text in materials:
        key = name if not name.startswith("dictation") else name
        merged.setdefault(key, (level, []))[1].append(text)
    for name, (level, texts) in merged.items():
        ws = words_of(" ".join(texts))
        band = BANDS[level]
        inside = [w for w in ws if forms.get(w, 10 ** 9) <= band]
        off = sorted({w for w in ws if forms.get(w, 10 ** 9) > band})
        cov = 100 * len(inside) / len(ws)
        flag = "" if cov >= 95 else "  <-- below 95%"
        print(f"{name:16} L{level} words={len(ws):4} coverage={cov:5.1f}%{flag}  off: {', '.join(off)}")


if __name__ == "__main__":
    main()
