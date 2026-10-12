"""Pick clear female voices for the sentence materials (shadowing, stories, dictation ...).

Usage (from the project root, after tools/voice_pitch.py):
    .venv\\Scripts\\python.exe -X utf8 tools\\pick_voices.py

Female-like candidates (median F0 175–260 Hz) are sampled, each reads a few test
sentences, and local speech recognition (faster-whisper base.en) transcribes them.
The voices with the fewest recognition errors are kept ("clearest"), with distinct
pitch so the two do not sound alike. The two male voices already in use with the
fewest recognition errors in the audit (902, 227) are kept. Writes data/voices.json.
"""
import json
import random
import sys
import wave
from io import BytesIO
from pathlib import Path

import numpy as np
from piper import PiperVoice, SynthesisConfig

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
from audit import sentence_diff  # noqa: E402

TESTS = [
    "I've been studying English for about a year.",
    "Could you pass me the salt, please?",
    "The trees were full of pink flowers, and it was absolutely beautiful.",
    "She told me that she was tired.",
]
KEEP_MALE = [902, 227]
N_CANDIDATES = 24


def main() -> None:
    from faster_whisper import WhisperModel
    asr = WhisperModel("base.en", device="cpu", compute_type="int8", download_root=str(ROOT / "models" / "whisper"))
    voice = PiperVoice.load(str(ROOT / "voices" / "en_US-libritts_r-medium.onnx"))
    f0 = {int(k): v for k, v in json.loads((ROOT / "data" / "voice_pitch.json").read_text(encoding="utf-8"))["f0"].items()}
    cands = sorted(k for k, v in f0.items() if v and 175 <= v <= 260)
    cands = random.Random(20261012).sample(cands, N_CANDIDATES)
    scores = []
    for spk in cands:
        errors = 0
        for text in TESTS:
            buf = BytesIO()
            with wave.open(buf, "wb") as wf:
                voice.synthesize_wav(text, wf, syn_config=SynthesisConfig(speaker_id=spk))
            buf.seek(0)
            with wave.open(buf, "rb") as wf:
                sr = wf.getframerate()
                x = np.frombuffer(wf.readframes(wf.getnframes()), dtype=np.int16).astype(np.float32) / 32768
            x16 = np.interp(np.arange(0, len(x), sr / 16000), np.arange(len(x)), x).astype(np.float32)
            segs, _ = asr.transcribe(x16, language="en", beam_size=5, condition_on_previous_text=False)
            heard = " ".join(s.text for s in segs)
            errors += len(sentence_diff(text, heard)["diffWords"])
        scores.append((errors, spk))
        print(f"  speaker {spk} F0 {f0[spk]} errors {errors}", flush=True)
    # fewest errors first; among equals, the higher pitch (more clearly a female voice)
    scores.sort(key=lambda es: (es[0], -f0[es[1]]))
    female = []
    for err, spk in scores:
        if all(abs(f0[spk] - f0[s]) >= 15 for s in female):
            female.append(spk)
        if len(female) == 2:
            break
    out = {
        "note": "Sentence-material voices. female = clearest of sampled female-like voices by local ASR; male = existing voices with fewest audit mismatches.",
        "female": female, "male": KEEP_MALE,
        "pitch": {str(s): f0[s] for s in female + KEEP_MALE},
        "candidates": [{"speaker": s, "f0": f0[s], "asrErrors": e} for e, s in scores],
    }
    (ROOT / "data" / "voices.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
    print("female:", female, "male:", KEEP_MALE)


if __name__ == "__main__":
    main()
