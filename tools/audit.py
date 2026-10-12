"""Audit learning materials and audio, and record what has / has not been verified.

Usage (from the project root):
    .venv\\Scripts\\python.exe -X utf8 tools\\audit.py          # fast checks
    .venv\\Scripts\\python.exe -X utf8 tools\\audit.py --asr    # + speech recognition (slow, cached)

Writes:
    qa/audit_report.md     human-readable summary (what was checked, what failed, what is unverified)
    qa/audit.json          machine-readable results and per-item label status
    qa/review_queue.json   audio for the human check page (qa/review.html)

Speech recognition (faster-whisper, base.en) runs locally; the model is stored in
models/whisper and no audio leaves this PC. ASR on isolated words is imperfect,
so a mismatch marks an item "要確認" (needs checking), never "wrong".
"""
import argparse
import json
import random
import re
import sys
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "app"
DATA = ROOT / "data"
QA = ROOT / "qa"
sys.path.insert(0, str(Path(__file__).resolve().parent))


def J(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def words_of(text: str) -> list[str]:
    return re.findall(r"[a-z0-9']+", text.lower().replace("’", "'"))


NUMBERS = {str(i): w for i, w in enumerate("zero one two three four five six seven eight nine ten eleven twelve".split())}
NUMBERS.update({"20": "twenty", "40": "forty", "100": "hundred"})
CONTRACTIONS = {"n't": " not", "'ve": " have", "'ll": " will", "'re": " are", "'m": " am"}
FUNCTION = set("a an the and but or as at for from of to than that can could would should must have has had do does am are is was were "
               "be been he him his her them us you your some there it in on i 'd 's".split())


def norm_words(text: str) -> list[str]:
    """Words for comparing a sentence with ASR output: numbers spelled out, contractions expanded
    ('d / 's stay ambiguous)."""
    t = text.lower().replace("’", "'")
    t = t.replace("can't", "can not").replace("won't", "will not").replace("let's", "let us")
    for k, v in CONTRACTIONS.items():
        t = t.replace(k, v)
    return [NUMBERS.get(w, w) for w in re.findall(r"[a-z0-9']+", t)]


def sentence_diff(expected: str, heard: str) -> dict:
    """Words that differ between the script and the ASR output, and whether any is a content word."""
    from difflib import SequenceMatcher
    e, h = norm_words(expected), norm_words(heard)
    diff = []
    for op, i1, i2, j1, j2 in SequenceMatcher(a=e, b=h, autojunk=False).get_opcodes():
        if op != "equal":
            diff += e[i1:i2] + h[j1:j2]
    # 'd / 's vs a dropped auxiliary is a reduction, not a content difference
    content = [w for w in diff if w not in FUNCTION and not w.startswith("'")]
    return {"match": not diff, "diffWords": diff, "contentWords": content}


# ---------------------------------------------------------------- inventory

def inventory():
    """Every audio file the app references, with what it is supposed to contain."""
    items = []   # dicts: path, kind, text, plus extra keys
    for c in J(APP / "data" / "contrasts.json")["contrasts"]:
        m = J(APP / "data" / f"{c['id']}.json")
        for p in m["pairs"]:
            for side in ("a", "b"):
                for group, spks in m["speakers"].items():
                    for spk in spks:
                        items.append({
                            "path": m["audio"].replace("{word}", p[side]).replace("{speaker}", str(spk)),
                            "kind": "pair-word", "contrast": c["id"], "text": p[side],
                            "foil": p["b" if side == "a" else "a"], "set": p["set"], "speakerGroup": group,
                        })
    st = J(APP / "data" / "stress.json")
    for w in st["words"]:
        for group, spks in st["speakers"].items():
            for spk in spks:
                items.append({"path": st["audio"].replace("{word}", w["word"].lower()).replace("{speaker}", str(spk)),
                              "kind": "stress-word", "text": w["word"], "set": w["set"], "speakerGroup": group})
    d = J(APP / "data" / "dictation.json")
    for s in d["sentences"]:
        for spk in d["speakers"]:
            items.append({"path": d["audio"].replace("{id}", s["id"]).replace("{speaker}", str(spk)),
                          "kind": "sentence", "group": "dictation", "id": s["id"], "text": s["text"]})
    cs = J(APP / "data" / "connected.json")
    for les in cs["lessons"]:
        for i, ex in enumerate(les["examples"]):
            for k in ("words", "natural"):
                items.append({"path": cs["examples"].replace("{lesson}", les["id"]).replace("{i}", str(i)).replace("{kind}", k),
                              "kind": "sentence", "group": f"connected-example-{k}", "id": f"{les['id']}-ex{i}", "text": ex["text"]})
        for i, q in enumerate(les["quiz"]):
            for spk in cs["speakers"]:
                items.append({"path": cs["quiz"].replace("{lesson}", les["id"]).replace("{i}", str(i)).replace("{speaker}", str(spk)),
                              "kind": "sentence", "group": "connected-quiz", "id": f"{les['id']}-q{i}", "text": q["text"]})
    for name, key, grp in (("shadowing.json", "passages", "shadowing"), ("stories.json", "stories", "story")):
        m = J(APP / "data" / name)
        tmpl = m["audio"]
        for p in m[key]:
            for i, s in enumerate(p["sentences"]):
                for spk in m["speakers"]:
                    path = tmpl.replace("{passage}", p["id"]).replace("{story}", p["id"]).replace("{i}", str(i)).replace("{speaker}", str(spk))
                    items.append({"path": path, "kind": "sentence", "group": grp, "id": f"{p['id']}-{i}", "text": s["text"]})
    rh = J(APP / "data" / "rhythm.json")
    for s in rh["sentences"]:
        text = s["marked"].replace("*", "")
        for spk in rh["speakers"]:
            items.append({"path": rh["audio"].replace("{id}", s["id"]).replace("{speaker}", str(spk)),
                          "kind": "rhythm", "id": s["id"], "text": text, "marked": s["marked"]})
        items.append({"path": rh["slow"].replace("{id}", s["id"]), "kind": "sentence", "group": "rhythm-slow", "id": s["id"], "text": text})
    ch = J(APP / "data" / "chants.json")
    for c in ch["chants"]:
        for tempo in ("normal", "slow", "normal_beat", "slow_beat"):
            items.append({"path": ch["audio"].replace("{id}", c["id"]).replace("{tempo}", tempo), "kind": "chant", "id": c["id"]})
    return items


# ---------------------------------------------------------------- checks

def check_files(items):
    referenced = {i["path"] for i in items}
    missing = sorted(p for p in referenced if not (APP / p).exists())
    on_disk = {str(p.relative_to(APP)).replace("\\", "/") for p in (APP / "audio").rglob("*.mp3")}
    orphans = sorted(on_disk - referenced)
    return {"referenced": len(referenced), "missing": missing, "orphans": len(orphans),
            "orphanDirs": sorted(Counter(o.rsplit("/", 1)[0] for o in orphans).items())}


def check_audio(items):
    stats, problems = {}, []
    for it in items:
        p = APP / it["path"]
        if not p.exists():
            continue
        try:
            x, r = sf.read(p, dtype="float32")
        except Exception as e:  # noqa: BLE001
            problems.append({"path": it["path"], "problem": f"decode error: {e}"})
            continue
        if x.ndim > 1:
            x = x.mean(axis=1)
        dur, rms = len(x) / r, float(np.sqrt(np.mean(x ** 2))) if len(x) else 0.0
        clip = int(np.sum(np.abs(x) >= 0.999))
        stats[it["path"]] = {"dur": round(dur, 3), "rms": round(rms, 4)}
        if dur < 0.15 or rms < 0.01:
            problems.append({"path": it["path"], "problem": f"無音または短すぎる（{dur:.2f}秒、RMS {rms:.3f}）"})
        if clip > 10:
            problems.append({"path": it["path"], "problem": f"音割れ（{clip}サンプル）"})
    return stats, problems


def check_separation():
    out = {}
    for c in J(APP / "data" / "contrasts.json")["contrasts"]:
        m = J(APP / "data" / f"{c['id']}.json")
        tr = {w for p in m["pairs"] if p["set"] == "train" for w in (p["a"], p["b"])}
        te = {w for p in m["pairs"] if p["set"] == "test" for w in (p["a"], p["b"])}
        n_test = sum(p["set"] == "test" for p in m["pairs"])
        out[c["id"]] = {"wordOverlap": len(tr & te), "speakerOverlap": len(set(m["speakers"]["train"]) & set(m["speakers"]["test"])),
                        "testPairs": n_test, "repeatsPer20NewItems": round(20 / n_test, 1)}
    st = J(APP / "data" / "stress.json")
    n_test = sum(w["set"] == "test" for w in st["words"])
    out["stress"] = {"wordOverlap": 0, "speakerOverlap": len(set(st["speakers"]["train"]) & set(st["speakers"]["test"])),
                     "testWords": n_test, "repeatsPer10NewItems": round(10 / n_test, 1)}
    return out


def check_duration_cue(items, stats):
    """Within the same speaker, how often is word a longer than word b? 50% = no cue."""
    out = {}
    by = defaultdict(dict)
    for it in items:
        if it["kind"] == "pair-word" and it["path"] in stats:
            by[(it["contrast"], it["path"].rsplit("_", 1)[1])][it["text"]] = stats[it["path"]]["dur"]
    for c in J(APP / "data" / "contrasts.json")["contrasts"]:
        m = J(APP / "data" / f"{c['id']}.json")
        longer = []
        for p in m["pairs"]:
            for spk in m["speakers"]["train"] + m["speakers"]["test"]:
                d = by.get((c["id"], f"{spk}.mp3"), {})
                if p["a"] in d and p["b"] in d:
                    longer.append(d[p["a"]] > d[p["b"]])
        share = float(np.mean(longer)) if longer else None
        out[c["id"]] = {"aLongerShare": round(share, 3) if share is not None else None,
                        "durationOnlyAccuracy": round(max(share, 1 - share), 3) if share is not None else None}
    return out


def check_texts():
    """Spans exist, pair phonemes differ, stress labels match the TTS phonemes."""
    from generate_audio import stress_syllable  # same rule the generator used
    from piper import PiperVoice
    voice = PiperVoice.load(str(ROOT / "voices" / "en_US-libritts_r-medium.onnx"))
    ph = lambda w: "".join("".join(s) for s in voice.phonemize(w))  # noqa: E731
    issues = []
    for c in J(APP / "data" / "contrasts.json")["contrasts"]:
        for p in J(APP / "data" / f"{c['id']}.json")["pairs"]:
            if ph(p["a"]) == ph(p["b"]):
                issues.append(f"{c['id']}: {p['a']} / {p['b']} の発音記号が同じ")
    for w in J(APP / "data" / "stress.json")["words"]:
        idx, n = stress_syllable(ph(w["word"]))
        if idx != w["stress"] or n != len(w["syl"]):
            issues.append(f"強勢: {w['word']} のラベルが発音記号と不一致")

    def has_span(text, span):
        t, s = words_of(text), words_of(span)
        return any(t[i:i + len(s)] == s for i in range(len(t)))
    for s in J(APP / "data" / "dictation.json")["sentences"]:
        for f in s["features"]:
            if not has_span(s["text"], f["span"]):
                issues.append(f"書き取り {s['id']}: 注記 '{f['span']}' が文中にない")
    for les in J(APP / "data" / "connected.json")["lessons"]:
        for q in les["quiz"]:
            if not has_span(q["text"], q["span"]):
                issues.append(f"音の変化 {les['id']}: 穴埋め '{q['span']}' が文中にない")
    return issues


# ---------------------------------------------------------------- speech recognition

class ASR:
    def __init__(self):
        from faster_whisper import WhisperModel
        self.model = WhisperModel("base.en", device="cpu", compute_type="int8", download_root=str(ROOT / "models" / "whisper"))
        self.cache_path = QA / "asr_cache.json"
        self.cache = J(self.cache_path) if self.cache_path.exists() else {}

    def _audio(self, path):
        x, sr = sf.read(APP / path, dtype="float32")
        x = np.interp(np.arange(0, len(x), sr / 16000), np.arange(len(x)), x).astype(np.float32)
        pad = np.zeros(8000, np.float32)
        return np.concatenate([pad, x, pad])

    def run(self, path, prompt=None, timestamps=False):
        st = (APP / path).stat()
        key = f"{path}|{st.st_size}|{int(st.st_mtime)}|{prompt or ''}|{int(timestamps)}"
        if key not in self.cache:
            segs, _ = self.model.transcribe(self._audio(path), language="en", beam_size=1, initial_prompt=prompt,
                                            condition_on_previous_text=False, word_timestamps=timestamps)
            segs = list(segs)
            entry = {"text": " ".join(s.text.strip() for s in segs)}
            if timestamps:
                entry["words"] = [[w.word.strip(), round(w.start - 0.5, 3), round(w.end - 0.5, 3)] for s in segs for w in s.words]
            self.cache[key] = entry
        return self.cache[key]

    def save(self):
        self.cache_path.write_text(json.dumps(self.cache, ensure_ascii=False), encoding="utf-8")


def asr_sample(items):
    """Which files to recognize: every test voice + a few training voices per word (all
    sentences). Checking every file would take hours on a CPU."""
    train_keep = {}
    for c in J(APP / "data" / "contrasts.json")["contrasts"]:
        train_keep[c["id"]] = set(J(APP / "data" / f"{c['id']}.json")["speakers"]["train"][:ASR_TRAIN_VOICES])
    st = J(APP / "data" / "stress.json")["speakers"]
    stress_keep = set(st["test"][:2] + st["train"][:2])
    out = []
    for it in items:
        spk = int(it["path"].rsplit("_", 1)[1].split(".")[0]) if it["kind"] in ("pair-word", "stress-word") else None
        if it["kind"] == "pair-word" and it["speakerGroup"] == "train" and spk not in train_keep[it["contrast"]]:
            continue
        if it["kind"] == "stress-word" and spk not in stress_keep:
            continue
        out.append(it)
    return out


ASR_TRAIN_VOICES = 4


def asr_checks(items, asr):
    res = {"pairWords": {}, "pairFiles": [], "stressWords": {}, "sentences": [], "rhythm": []}
    done = 0
    items = asr_sample(items)
    print(f"  ASR on {len(items)} files", flush=True)
    for it in items:
        if it["kind"] == "pair-word":
            # 2-choice style: both candidates are given as a prompt, in random order
            cands = sorted([it["text"], it["foil"]], key=lambda w: random.Random(it["path"]).random())
            heard = words_of(asr.run(it["path"], prompt=f"{cands[0].capitalize()}. {cands[1].capitalize()}.")["text"])
            ok = it["text"] in heard and it["foil"] not in heard
            k = f"{it['contrast']}:{it['text']}"
            r = res["pairWords"].setdefault(k, {"ok": 0, "n": 0})
            r["n"] += 1
            r["ok"] += ok
            if not ok:
                res["pairFiles"].append({"path": it["path"], "expected": it["text"], "heard": " ".join(heard)})
        elif it["kind"] == "stress-word":
            heard = words_of(asr.run(it["path"])["text"])
            r = res["stressWords"].setdefault(it["text"], {"ok": 0, "n": 0})
            r["n"] += 1
            r["ok"] += it["text"].lower() in heard
        elif it["kind"] in ("sentence", "rhythm"):
            out = asr.run(it["path"], timestamps=it["kind"] == "rhythm")
            d = sentence_diff(it["text"], out["text"])
            res["sentences"].append({"path": it["path"], "group": it.get("group", "rhythm"), "match": d["match"],
                                     "contentWords": d["contentWords"], "diffWords": d["diffWords"],
                                     "expected": it["text"], "heard": out["text"]})
            if it["kind"] == "rhythm":
                res["rhythm"].append(rhythm_prominence(it, out))
        done += 1
        if done % 500 == 0:
            asr.save()
            print(f"  ASR {done}/{len(items)}", flush=True)
    asr.save()
    return res


def rhythm_prominence(it, out):
    """Compare loudness x length of words marked strong vs weak, using ASR word times."""
    x, sr = sf.read(APP / it["path"], dtype="float32")
    marked = [(w.replace("*", ""), w.startswith("*")) for w in it["marked"].split()]
    asr_words = out.get("words", [])
    if [words_of(w)[0] if words_of(w) else "" for w, _ in marked] != [words_of(w)[0] if words_of(w) else "" for w, _, _ in asr_words]:
        return {"path": it["path"], "id": it["id"], "aligned": False}
    scores = []
    for (w, strong), (_, a, b) in zip(marked, asr_words):
        seg = x[max(0, int(a * sr)):max(int(a * sr) + 1, int(b * sr))]
        energy = float(np.sqrt(np.mean(seg ** 2))) if len(seg) else 0.0
        syll = max(1, len(re.findall(r"[aeiouy]+", w.lower())))
        scores.append((w, strong, energy * (b - a) / syll))
    weak = [s for _, st_, s in scores if not st_]
    strong = [(w, s) for w, st_, s in scores if st_]
    thr = float(np.median(weak)) if weak else 0.0
    low = [w for w, s in strong if s <= thr]
    return {"path": it["path"], "id": it["id"], "aligned": True, "strongBelowWeakMedian": low,
            "agree": round(1 - len(low) / max(1, len(strong)), 2)}


# ---------------------------------------------------------------- report

def build(asr_res, items, files, audio_problems, sep, cue, text_issues):
    human = J(QA / "human_review.json") if (QA / "human_review.json").exists() else {"items": {}}
    labels = {"ok": "問題なし", "noise": "雑音・途切れ", "voice": "声がおかしい", "unsure": "判断できず"}
    paths_of = defaultdict(list)   # status key -> audio files belonging to it
    for it in items:
        if it["kind"] == "pair-word":
            paths_of[f"{it['contrast']}:{it['text']}"].append(it["path"])
        elif it["kind"] == "stress-word":
            paths_of[f"stress:{it['text']}"].append(it["path"])
        elif it["kind"] == "rhythm":
            paths_of[f"rhythm:{it['id']}"].append(it["path"])
    status = {}

    def human_of(key):
        res = [human["items"][p]["result"] for p in paths_of.get(key, []) if p in human["items"]]
        if not res:
            return "未確認"
        bad = [r for r in res if r in ("noise", "voice")]
        return f"不具合の指摘あり（{labels[bad[0]]}）" if bad else f"{len(res)}件確認・{labels[res[0]] if len(set(res)) == 1 else '問題なし/判断できず'}"

    def put(key, kind, auto, note=""):
        status[key] = {"kind": kind, "auto": auto, "human": human_of(key), "note": note}

    for c in J(APP / "data" / "contrasts.json")["contrasts"]:
        for p in J(APP / "data" / f"{c['id']}.json")["pairs"]:
            for w in (p["a"], p["b"]):
                k = f"{c['id']}:{w}"
                r = (asr_res or {}).get("pairWords", {}).get(k)
                auto = "未実行" if not r else ("合格" if r["ok"] / r["n"] >= 0.8 else "要確認")
                put(k, "聞き分けの単語", auto, f"音声認識で意図した語と判定 {r['ok']}/{r['n']}" if r else "発音記号の違いのみ確認")
    for w in J(APP / "data" / "stress.json")["words"]:
        r = (asr_res or {}).get("stressWords", {}).get(w["word"])
        put(f"stress:{w['word']}", "強勢の単語", "発音記号で照合済み（音での強さは未確認）",
            f"単語の聞き取り {r['ok']}/{r['n']}" if r else "")
    for s in J(APP / "data" / "rhythm.json")["sentences"]:
        rs = [x for x in (asr_res or {}).get("rhythm", []) if x["id"] == s["id"]]
        if not rs:
            put(f"rhythm:{s['id']}", "文の強い語", "未実行")
        else:
            aligned = [x for x in rs if x["aligned"]]
            low = sorted({w for x in aligned for w in x["strongBelowWeakMedian"]})
            put(f"rhythm:{s['id']}", "文の強い語", "合格" if aligned and not low else "要確認",
                f"強い語なのに弱く聞こえる可能性: {', '.join(low)}" if low else ("" if aligned else "語の対応付けに失敗"))
    for les in J(APP / "data" / "connected.json")["lessons"]:
        put(f"connected:{les['id']}", "音の変化の例", "自動確認できない", "TTS で音の変化が実際に起きているかは人の確認が必要")
    QA.mkdir(exist_ok=True)

    sent = (asr_res or {}).get("sentences", [])
    sent_minor = [s for s in sent if not s["match"] and not s["contentWords"]]
    sent_bad = [s for s in sent if s["contentWords"]]
    summary = {
        "date": date.today().isoformat(), "files": files, "audioProblems": audio_problems, "separation": sep,
        "durationCue": cue, "textIssues": text_issues,
        "asr": None if asr_res is None else {
            "pairWordFilesFlagged": len(asr_res["pairFiles"]),
            "pairWordsFlagged": sorted(k for k, r in asr_res["pairWords"].items() if r["ok"] / r["n"] < 0.8),
            "stressWordsFlagged": sorted(k for k, r in asr_res["stressWords"].items() if r["ok"] / r["n"] < 0.8),
            "sentences": len(sent), "sentencesMismatch": sent_bad, "sentencesMinor": len(sent_minor),
        },
        "labelStatus": status,
    }
    (QA / "audit.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8")

    # human check queue: everything ASR flagged + a fixed random sample as a baseline
    # one file per flagged word / sentence keeps the list short enough to listen through
    queue, seen_keys = [], set()
    if asr_res:
        for f in asr_res["pairFiles"]:
            key = f["path"].rsplit("_", 1)[0]
            if key not in seen_keys:
                seen_keys.add(key)
                queue.append({"path": f["path"], "text": f["expected"], "reason": "音声認識で別の語と判定された単語"})
        for s in sent_bad:
            key = re.sub(r"_(\d+|slow)\.mp3$", "", s["path"])
            if key not in seen_keys:
                seen_keys.add(key)
                queue.append({"path": s["path"], "text": s["expected"], "reason": "音声認識で原文と違う語があった文"})
    sample = random.Random(0).sample([i for i in items if i["kind"] in ("pair-word", "stress-word", "sentence")], 20)
    queue += [{"path": i["path"], "text": i["text"], "reason": "無作為に選んだ抜き取り確認"} for i in sample]
    (QA / "review_queue.json").write_text(json.dumps({"items": queue}, ensure_ascii=False, indent=1), encoding="utf-8")

    counts = Counter((v["kind"], v["auto"]) for v in status.values())
    hcounts = Counter(v["human"] for v in status.values())
    L = [f"# 教材・音声の点検レポート（{summary['date']}）", "",
         "`tools/audit.py` が自動生成。自動で確認できたことと、人の確認が必要なことを分けて記載する。", "",
         "## 1. ファイル", f"- アプリが参照する音声：{files['referenced']}件、欠落：{len(files['missing'])}件",
         f"- どこからも参照されていない音声：{files['orphans']}件" + (f"（{', '.join(f'{d} {n}件' for d, n in files['orphanDirs'])}）" if files["orphans"] else ""),
         f"- 読み込み不可・無音・音割れ：{len(audio_problems)}件"]
    L += [f"  - {p['path']}：{p['problem']}" for p in audio_problems[:20]]
    L += ["", "## 2. 訓練用とテスト用の分離",
          "| 対象 | 単語の重なり | 話者の重なり | テスト専用 | 1回のテストでの繰り返し |", "|---|---|---|---|---|"]
    for k, v in sep.items():
        rep = v.get("repeatsPer20NewItems", v.get("repeatsPer10NewItems"))
        L.append(f"| {k} | {v['wordOverlap']} | {v['speakerOverlap']} | {v.get('testPairs', v.get('testWords'))} | 約{rep}回 |")
    L += ["", "## 3. 長さだけで正解できてしまうか（同じ話者のペアで a が長い割合。50%なら手がかりにならない）",
          "| 音 | a が長い割合 | 長さだけで答えた場合の正答率 |", "|---|---|---|"]
    L += [f"| {k} | {v['aLongerShare'] * 100:.0f}% | {v['durationOnlyAccuracy'] * 100:.0f}% |" for k, v in cue.items() if v["aLongerShare"] is not None]
    L += ["", "## 4. 教材データ（発音記号・強勢ラベル・注記の位置）"]
    L += [f"- {t}" for t in text_issues] or ["- 問題なし"]
    L += ["", "## 5. 音声認識（faster-whisper base.en、PC内で実行）"]
    if asr_res is None:
        L.append("- 未実行（`--asr` を付けて実行）")
    else:
        a = summary["asr"]
        L += [f"- 聞き分けの単語：意図した語と判定されなかったファイル {a['pairWordFilesFlagged']}件。8割未満の単語：{', '.join(a['pairWordsFlagged']) or 'なし'}",
              f"- 強勢の単語：聞き取れなかった割合が2割を超える単語：{', '.join(a['stressWordsFlagged']) or 'なし'}",
              f"- 文：{a['sentences']}件中、内容語（名詞・動詞など）が原文と違ったもの {len(a['sentencesMismatch'])}件、"
              f"機能語（a, the, have など）だけが違ったもの {a['sentencesMinor']}件（弱く発音された結果の可能性が高い）"]
        L += [f"  - {s['path']}：原文「{s['expected']}」／認識「{s['heard']}」（違い：{', '.join(s['contentWords'])}）" for s in a["sentencesMismatch"][:40]]
        L.append("- 注意：単語1つだけの音声認識は誤りやすく、不一致は「要確認」であって「誤り」ではない。")
    L += ["", "## 6. 正解ラベルの確認状況", "| 種類 | 自動確認の結果 | 件数 |", "|---|---|---|"]
    L += [f"| {k} | {a} | {n} |" for (k, a), n in sorted(counts.items())]
    L += ["", "人による確認：" + "、".join(f"{k} {n}件" for k, n in hcounts.items()), "",
          "## 7. 自動では確認できないこと（未確認として扱う）",
          "- 音の変化の例文で、TTS が実際に連結・脱落などを起こしているか",
          "- 単語の強勢が、音として（長さ・強さで）知覚できるか（発音記号との照合のみ）",
          "- 文の強い語の判定は、語の長さ×音量による簡易推定",
          "- 音声の自然さ（機械っぽさ）"]
    (QA / "audit_report.md").write_text("\n".join(L) + "\n", encoding="utf-8")
    return summary


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--asr", action="store_true", help="run speech-recognition checks (slow, cached)")
    args = ap.parse_args()
    QA.mkdir(exist_ok=True)
    items = inventory()
    files = check_files(items)
    stats, problems = check_audio(items)
    sep = check_separation()
    cue = check_duration_cue(items, stats)
    texts = check_texts()
    asr_res = asr_checks(items, ASR()) if args.asr else None
    s = build(asr_res, items, files, problems, sep, cue, texts)
    print(f"files={files['referenced']} missing={len(files['missing'])} orphans={files['orphans']} audioProblems={len(problems)} "
          f"textIssues={len(texts)} durationOnlyAcc={ {k: v['durationOnlyAccuracy'] for k, v in cue.items()} }")
    if s["asr"]:
        print(f"asr: pairFilesFlagged={s['asr']['pairWordFilesFlagged']} pairWordsFlagged={s['asr']['pairWordsFlagged']} "
              f"stressFlagged={s['asr']['stressWordsFlagged']} sentenceMismatch={len(s['asr']['sentencesMismatch'])}")


if __name__ == "__main__":
    main()
