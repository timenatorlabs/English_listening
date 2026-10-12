"""Word timings and per-word intonation for the shadowing passages -> app/data/word_prosody.json

Usage (from the project root):
    .venv\\Scripts\\python.exe -X utf8 tools\\word_prosody.py

For every shadowing sentence and voice:
  1. local speech recognition (faster-whisper base.en, word timestamps) finds where each
     word of the script is in the audio (words the recognizer misses get their place by
     interpolation from the neighbours);
  2. pitch (autocorrelation, as in app/pitch.js) and loudness are measured per word;
  3. each word gets a direction (up / down / flat) and the most prominent words
     (high + loud + long for their length) are marked.
This is an automatic estimate from TTS audio, not a pronunciation rule.
"""
import json
import re
import sys
from difflib import SequenceMatcher
from pathlib import Path

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "app"
SR = 8000
FUNCTION = set(("a an the and but or as at for from of to than that this these those can could would should must "
                "will shall may might do does did am are is was were be been being have has had i you he she it we "
                "they me him her us them my your his its our their some any there in on by with about into up so "
                "i'm i've i'll i'd you're it's that's there's let's we've they're don't isn't").split())


def norm(w: str) -> str:
    return re.sub(r"[^a-z0-9']", "", w.lower().replace("’", "'"))


def f0_and_energy(x: np.ndarray, rate: int):
    """10 ms frames: (f0 Hz or nan, rms). Same method as app/pitch.js."""
    step = rate / SR
    n = int(len(x) / step)
    idx = (np.arange(n) * step).astype(int)
    x = np.add.reduceat(x, idx) / np.diff(np.append(idx, len(x)))
    frame, hop, lo, hi = 320, 80, SR // 400, int(np.ceil(SR / 70))
    frames = max(0, (len(x) - frame - hi) // hop)
    energy = np.array([np.sqrt(np.mean(x[f * hop:f * hop + frame] ** 2)) for f in range(frames)])
    loud = np.sort(energy)[int(frames * 0.95)] if frames else 0
    f0 = np.full(frames, np.nan)
    for f in range(frames):
        if energy[f] < max(0.0005, loud * 0.12):
            continue
        seg = x[f * hop:f * hop + frame + hi + 2]
        s0 = seg[:frame] - seg[:frame].mean()
        r0 = s0 @ s0
        r = np.array([s0 @ (seg[l:l + frame] - seg[:frame].mean()) for l in range(hi + 2)])
        best = r[lo:hi + 1].max()
        if r0 <= 0 or best / r0 < 0.4:
            continue
        for l in range(lo + 1, hi):
            if r[l] >= 0.85 * best and r[l] >= r[l - 1] and r[l] >= r[l + 1]:
                f0[f] = SR / l
                break
    med = np.nanmedian(f0) if np.any(~np.isnan(f0)) else np.nan
    if not np.isnan(med):
        f0 = np.where(f0 > med * 1.8, f0 / 2, f0)
        f0 = np.where(f0 < med * 0.55, f0 * 2, f0)
    return f0, energy


def word_times(model, path: Path, words: list[str]):
    x, rate = sf.read(path, dtype="float32")
    x16 = np.interp(np.arange(0, len(x), rate / 16000), np.arange(len(x)), x).astype(np.float32)
    segs, _ = model.transcribe(x16, language="en", beam_size=5, word_timestamps=True, condition_on_previous_text=False)
    rec = [(norm(w.word), w.start, w.end) for s in segs for w in s.words]
    times = [None] * len(words)
    sm = SequenceMatcher(a=[norm(w) for w in words], b=[r[0] for r in rec], autojunk=False)
    for blk in sm.get_matching_blocks():
        for k in range(blk.size):
            times[blk.a + k] = [rec[blk.b + k][1], rec[blk.b + k][2]]
    # fill words the recognizer missed: share the gap between known neighbours by length
    dur = len(x) / rate
    i = 0
    while i < len(words):
        if times[i] is not None:
            i += 1
            continue
        j = i
        while j < len(words) and times[j] is None:
            j += 1
        a = times[i - 1][1] if i > 0 else 0.0
        b = times[j][0] if j < len(words) else dur
        lens = [max(1, len(norm(w))) for w in words[i:j]]
        t = a
        for k, L in zip(range(i, j), lens):
            d = (b - a) * L / sum(lens)
            times[k] = [t, t + d]
            t += d
        i = j
    matched = sum(1 for blk in sm.get_matching_blocks() for _ in range(blk.size))
    return times, x, rate, matched


def prosody(times, x, rate, words):
    f0, energy = f0_and_energy(x, rate)
    voiced = f0[~np.isnan(f0)]
    med = np.median(voiced) if len(voiced) else np.nan
    st = 12 * np.log2(f0 / med) if not np.isnan(med) else f0
    out = []
    for w, (s, e) in zip(words, times):
        a, b = int(s / 0.01), max(int(s / 0.01) + 1, int(e / 0.01))
        seg = st[a:b]
        en = energy[a:b]
        v = seg[~np.isnan(seg)]
        direction = "flat"
        if len(v) >= 4:
            delta = np.mean(v[-max(2, len(v) // 3):]) - np.mean(v[:max(2, len(v) // 3)])
            direction = "up" if delta > 1.0 else "down" if delta < -1.0 else "flat"
        out.append({
            "w": w, "s": round(float(s), 3), "e": round(float(e), 3), "dir": direction,
            "pitch": None if not len(v) else round(float(np.max(v)), 2),
            "loud": round(float(en.mean()), 4) if len(en) else 0.0,
            "len": round(float((e - s) / max(1, len(norm(w)))), 4),
        })
    # prominence: z-scores of peak pitch, loudness and length per letter
    def z(key):
        vals = np.array([o[key] if o[key] is not None else np.nan for o in out], dtype=float)
        m, sd = np.nanmean(vals), np.nanstd(vals) or 1.0
        return np.nan_to_num((vals - m) / sd)
    score = z("pitch") + z("loud") + 0.5 * z("len")
    # only content words are candidates (function words are normally reduced in English);
    # among them, the acoustically most prominent are marked
    content = [i for i, o in enumerate(out) if norm(o["w"]) not in FUNCTION]
    pool = content or list(range(len(out)))
    k = max(1, round(len(pool) / 3))
    top = set(sorted(pool, key=lambda i: -score[i])[:k])
    for i, o in enumerate(out):
        o["strong"] = bool(i in top)
        for k in ("pitch", "loud", "len"):
            del o[k]
    return out


def main() -> int:
    from faster_whisper import WhisperModel
    asr = WhisperModel("base.en", device="cpu", compute_type="int8", download_root=str(ROOT / "models" / "whisper"))
    sh = json.loads((APP / "data" / "shadowing.json").read_text(encoding="utf-8"))
    result = {"note": "Automatic estimate from the TTS audio (word times by local speech recognition, pitch by autocorrelation). dir: up/down/flat within the word; strong: most prominent words.", "items": {}}
    matched = total = 0
    for p in sh["passages"]:
        for i, s in enumerate(p["sentences"]):
            words = s["text"].split()
            for spk in sh["speakers"]:
                path = APP / sh["audio"].replace("{passage}", p["id"]).replace("{i}", str(i)).replace("{speaker}", str(spk))
                times, x, rate, m = word_times(asr, path, words)
                matched += m
                total += len(words)
                result["items"][f"{p['id']}-{i}_{spk}"] = prosody(times, x, rate, words)
        print(f"  {p['id']} done", flush=True)
    (APP / "data" / "word_prosody.json").write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"words located by recognition: {matched}/{total} ({matched / total:.0%}); the rest interpolated")
    return 0


if __name__ == "__main__":
    sys.exit(main())
