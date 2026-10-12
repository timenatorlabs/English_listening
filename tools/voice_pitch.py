"""Estimate the pitch (median F0) of every Piper speaker, to pick female and male voices.

Usage (from the project root):
    .venv\\Scripts\\python.exe -X utf8 tools\\voice_pitch.py

The voice model has no gender labels, so a typical-voice heuristic is used:
median F0 >= 165 Hz -> probably female, <= 140 Hz -> probably male, otherwise unclear.
Writes data/voice_pitch.json. Runs locally; nothing is downloaded.
"""
import json
import sys
import wave
from io import BytesIO
from pathlib import Path

import numpy as np
from piper import PiperVoice, SynthesisConfig

ROOT = Path(__file__).resolve().parent.parent
TEXT = "Hello. This is a short sentence for checking my voice."


def f0_median(x: np.ndarray, sr: int) -> float | None:
    """Autocorrelation pitch per 40 ms frame (voiced frames only), median in Hz."""
    frame, hop = int(0.04 * sr), int(0.01 * sr)
    lo, hi = int(sr / 400), int(sr / 70)          # 70–400 Hz
    vals = []
    for i in range(0, len(x) - frame, hop):
        f = x[i:i + frame] - x[i:i + frame].mean()
        if np.sqrt(np.mean(f ** 2)) < 0.02:
            continue
        ac = np.correlate(f, f, "full")[frame - 1:]
        if ac[0] <= 0:
            continue
        lag = lo + int(np.argmax(ac[lo:hi]))
        if ac[lag] / ac[0] > 0.5:                   # clearly periodic = voiced
            vals.append(sr / lag)
    return float(np.median(vals)) if len(vals) >= 10 else None


def main() -> None:
    voice = PiperVoice.load(str(ROOT / "voices" / "en_US-libritts_r-medium.onnx"))
    out = {}
    for spk in range(voice.config.num_speakers):
        buf = BytesIO()
        with wave.open(buf, "wb") as wf:
            voice.synthesize_wav(TEXT, wf, syn_config=SynthesisConfig(speaker_id=spk))
        buf.seek(0)
        with wave.open(buf, "rb") as wf:
            sr = wf.getframerate()
            x = np.frombuffer(wf.readframes(wf.getnframes()), dtype=np.int16).astype(np.float32) / 32768
        f0 = f0_median(x, sr)
        out[spk] = None if f0 is None else round(f0, 1)
        if spk % 100 == 0:
            print(f"  {spk}/{voice.config.num_speakers}", flush=True)
    (ROOT / "data" / "voice_pitch.json").write_text(json.dumps(
        {"method": "median F0 by autocorrelation on a fixed sentence; >=165 Hz likely female, <=140 Hz likely male",
         "f0": out}, indent=0), encoding="utf-8")
    vals = [v for v in out.values() if v]
    print(f"done: female-like={sum(v >= 165 for v in vals)} male-like={sum(v <= 140 for v in vals)} unclear={sum(140 < v < 165 for v in vals)} none={sum(v is None for v in out.values())}")


if __name__ == "__main__":
    sys.exit(main())
