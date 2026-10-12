"""Generate multi-speaker MP3s for the minimal-pair perception training.

Usage (from the project root):
    .venv\\Scripts\\python.exe tools\\generate_audio.py

Reads data/contrasts.json and data/minimal_pairs_<id>.json, synthesizes every
word with a fixed set of Piper speakers, and writes:
    app/audio/<id>/<word>_<speaker>.mp3
    app/data/<id>.json         (per-contrast manifest the app loads)
    app/data/contrasts.json    (index of contrasts)

Training and test use disjoint speakers so the test measures generalization to
new talkers (as in HVPT studies). Existing MP3s are skipped.

Also synthesizes the dictation sentences (data/dictation_sentences.json) with a
few training speakers:
    app/audio/dict/<id>_<speaker>.mp3
    app/data/dictation.json
"""
import json
import random
import wave
from io import BytesIO
from pathlib import Path

import numpy as np
import soundfile as sf
from piper import PiperVoice, SynthesisConfig

ROOT = Path(__file__).resolve().parent.parent
MODEL = ROOT / "voices" / "en_US-libritts_r-medium.onnx"
DATA = ROOT / "data"
APP = ROOT / "app"

SEED = 20261012          # fixed so the speaker selection is reproducible
N_TRAIN_SPEAKERS = 20
N_TEST_SPEAKERS = 6
SINGLE_VOICE = 227   # voice of the single-voice items (unchanged since v1)
# Minimal-pair audio v2: word length must not give the answer away (v1 audits
# found /s/ words longer than /θ/ words in 95% of same-speaker pairs). For each
# pair and speaker, both words are re-synthesized to the pair's mean length,
# each with its own independent random factor in DURATION_JITTER.
HVPT_AUDIO_VERSION = 2
DURATION_JITTER = [0.85, 1.15]
VOLUME = 0.9           # 1.0 slightly overshoots full scale after MP3 encoding


def synthesize(voice: PiperVoice, text: str, speaker: int, length_scale: float | None = None) -> tuple[np.ndarray, int]:
    buf = BytesIO()
    with wave.open(buf, "wb") as wf:
        cfg = SynthesisConfig(speaker_id=speaker, volume=VOLUME, length_scale=length_scale)
        voice.synthesize_wav(text, wf, syn_config=cfg)
    buf.seek(0)
    with wave.open(buf, "rb") as wf:
        rate = wf.getframerate()
        audio = np.frombuffer(wf.readframes(wf.getnframes()), dtype=np.int16)
    return audio, rate


VOWELS = set("aeiouæɑɒɔəɚɛɜɪʊʌɐᵻ")
DIPHTHONGS = {"aɪ", "aʊ", "eɪ", "oʊ", "ɔɪ"}


def stress_syllable(phonemes: str) -> tuple[int | None, int]:
    """Return (index of the syllable carrying primary stress, number of syllables)."""
    count = 0
    stressed = None
    prev = None              # previous vowel char inside the current nucleus
    pending_stress = False
    for ch in phonemes:
        if ch == "ˈ":
            pending_stress = True
            prev = None
            continue
        if ch == "ː":
            continue
        if ch in VOWELS:
            if prev is not None and prev + ch in DIPHTHONGS:
                prev = ch
                continue
            if pending_stress and stressed is None:
                stressed = count
            pending_stress = False
            count += 1
            prev = ch
        else:
            prev = None
    return stressed, count


CHANT_BPM = {"normal": 80, "slow": 64}
CHANT_COUNT_IN = 4


def render_chant(voice: PiperVoice, lines: list[list[str | None]], bpm: int, speaker: int | None) -> tuple[np.ndarray, int]:
    """Mix beat clicks and (optionally) the spoken chunks into one track."""
    rate = voice.config.sample_rate
    beat = 60 / bpm
    n_beats = CHANT_COUNT_IN + 4 * len(lines)
    out = np.zeros(int((n_beats + 2) * beat * rate))

    t = np.arange(int(0.03 * rate)) / rate
    for b in range(n_beats):
        accent = b % 4 == 0
        click = np.sin(2 * np.pi * (1800 if accent else 1200) * t) * np.exp(-t * 120) * (0.35 if accent else 0.22)
        i = int(b * beat * rate)
        out[i:i + len(click)] += click

    if speaker is not None:
        prev_end = 0
        for li, chunks in enumerate(lines):
            for ci, text in enumerate(chunks):
                if not text:
                    continue
                audio, _ = synthesize(voice, text, speaker, 0.9)
                x = audio.astype(np.float64) / 32768
                loud = np.flatnonzero(np.abs(x) > 0.02)
                x = x[loud[0]:loud[-1] + 1]                     # trim silence
                win = int(0.02 * rate)
                env = np.convolve(x ** 2, np.ones(win) / win, mode="same")
                peak = int(np.argmax(env))                       # loudest point ≈ stressed vowel
                beat_at = int((CHANT_COUNT_IN + li * 4 + ci) * beat * rate)
                start = max(beat_at - peak, prev_end, 0)
                end = min(start + len(x), len(out))
                out[start:end] += x[:end - start] * 0.9
                prev_end = end

    out = out / max(1e-9, np.abs(out).max()) * 0.9
    return (out * 32767).astype(np.int16), rate


def synthesize_pair(voice: PiperVoice, contrast: str, a: str, b: str, speaker: int) -> dict:
    """Both words of a pair at the pair's mean length times an independent random factor."""
    first = {w: synthesize(voice, w, speaker) for w in (a, b)}
    dur = {w: len(x) / r for w, (x, r) in first.items()}
    mean = (dur[a] + dur[b]) / 2
    out = {}
    for w in (a, b):
        target = mean * random.Random(f"{contrast}:{w}:{speaker}").uniform(*DURATION_JITTER)
        scale = target / dur[w]                     # duration scales roughly linearly with length_scale
        x, r = synthesize(voice, w, speaker, scale)
        scale *= target / (len(x) / r)              # one correction step for the non-linear part
        out[w] = synthesize(voice, w, speaker, scale)
    return out


def J(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=1), encoding="utf-8")


def main() -> None:
    voice = PiperVoice.load(str(MODEL))
    speakers = random.Random(SEED).sample(range(voice.config.num_speakers),
                                          N_TRAIN_SPEAKERS + N_TEST_SPEAKERS)
    train_speakers = sorted(speakers[:N_TRAIN_SPEAKERS])
    test_speakers = sorted(speakers[N_TRAIN_SPEAKERS:])

    contrasts = json.loads((DATA / "contrasts.json").read_text(encoding="utf-8"))["contrasts"]
    for c in contrasts:
        pairs = json.loads((DATA / f"minimal_pairs_{c['id']}.json").read_text(encoding="utf-8"))["pairs"]
        audio_dir = APP / "audio" / c["id"] / f"v{HVPT_AUDIO_VERSION}"
        audio_dir.mkdir(parents=True, exist_ok=True)
        manifest_path = APP / "data" / f"{c['id']}.json"
        matched = manifest_path.exists() and J(manifest_path).get("durationMatched") is True
        words = sorted({w for p in pairs for w in (p["a"], p["b"])})
        made = skipped = 0
        for p in pairs:
            for spk in train_speakers + test_speakers:
                paths = {w: audio_dir / f"{w}_{spk}.mp3" for w in (p["a"], p["b"])}
                if matched and all(x.exists() for x in paths.values()):
                    skipped += 2
                    continue
                for w, (audio, rate) in synthesize_pair(voice, c["id"], p["a"], p["b"], spk).items():
                    sf.write(paths[w], audio, rate, format="MP3")
                    made += 1

        write_json(manifest_path, {
            **c,
            "audio": f"audio/{c['id']}/v{HVPT_AUDIO_VERSION}/{{word}}_{{speaker}}.mp3",
            "audioVersion": HVPT_AUDIO_VERSION,
            "durationMatched": True,
            "durationJitter": DURATION_JITTER,
            "speakers": {"train": train_speakers, "test": test_speakers},
            "pairs": pairs,
        })
        size = sum(f.stat().st_size for f in audio_dir.glob("*.mp3"))
        print(f"{c['id']}: pairs={len(pairs)} words={len(words)} made={made} skipped={skipped} "
              f"size={size / 1e6:.1f}MB")

    write_json(APP / "data" / "contrasts.json", {"contrasts": contrasts})

    # dictation sentences
    sentences = json.loads((DATA / "dictation_sentences.json").read_text(encoding="utf-8"))["sentences"]
    # Sentence materials: 2 female + 2 male voices (data/voices.json, chosen by tools/pick_voices.py).
    # Single-voice items (sound-change examples, slow rhythm, chants) keep the original male voice.
    vj = J(DATA / "voices.json")
    dict_speakers = vj["female"] + vj["male"]
    voice_labels = {str(s): f"女性{i + 1}" for i, s in enumerate(vj["female"])}
    voice_labels.update({str(s): f"男性{i + 1}" for i, s in enumerate(vj["male"])})
    single_voice = SINGLE_VOICE
    audio_dir = APP / "audio" / "dict"
    audio_dir.mkdir(parents=True, exist_ok=True)
    made = skipped = 0
    for s in sentences:
        for spk in dict_speakers:
            path = audio_dir / f"{s['id']}_{spk}.mp3"
            if path.exists():
                skipped += 1
                continue
            audio, rate = synthesize(voice, s["text"], spk)
            sf.write(path, audio, rate, format="MP3")
            made += 1
    write_json(APP / "data" / "dictation.json", {
        "audio": "audio/dict/{id}_{speaker}.mp3",
        "speakers": dict_speakers,
        "voiceLabels": voice_labels,
        "sentences": sentences,
    })
    size = sum(f.stat().st_size for f in audio_dir.glob("*.mp3"))
    print(f"dictation: sentences={len(sentences)} made={made} skipped={skipped} size={size / 1e6:.1f}MB")

    def make(path: Path, text: str, spk: int, length_scale: float | None = None) -> int:
        if path.exists():
            return 0
        audio, rate = synthesize(voice, text, spk, length_scale)
        sf.write(path, audio, rate, format="MP3")
        return 1

    # connected speech: "word by word" vs natural, plus cloze quiz sentences
    lessons = json.loads((DATA / "connected_speech.json").read_text(encoding="utf-8"))["lessons"]
    cs_dir = APP / "audio" / "cs"
    cs_dir.mkdir(parents=True, exist_ok=True)
    made = 0
    for les in lessons:
        for i, ex in enumerate(les["examples"]):
            words = ex["text"].split()
            slow = ex["text"] if len(words) == 1 else ". ".join(w[0].upper() + w[1:] for w in words) + "."
            made += make(cs_dir / f"{les['id']}-ex{i}-words.mp3", slow, single_voice, 1.4 if len(words) == 1 else 1.1)
            made += make(cs_dir / f"{les['id']}-ex{i}-natural.mp3", ex["text"], single_voice)
        for i, q in enumerate(les["quiz"]):
            for spk in dict_speakers:
                made += make(cs_dir / f"{les['id']}-q{i}_{spk}.mp3", q["text"], spk)
    write_json(APP / "data" / "connected.json", {
        "examples": "audio/cs/{lesson}-ex{i}-{kind}.mp3",
        "quiz": "audio/cs/{lesson}-q{i}_{speaker}.mp3",
        "speakers": dict_speakers,
        "voiceLabels": voice_labels,
        "lessons": lessons,
    })
    size = sum(f.stat().st_size for f in cs_dir.glob("*.mp3"))
    print(f"connected: lessons={len(lessons)} made={made} size={size / 1e6:.1f}MB")

    # shadowing passages, one file per sentence
    passages = json.loads((DATA / "shadowing_passages.json").read_text(encoding="utf-8"))["passages"]
    sh_dir = APP / "audio" / "sh"
    sh_dir.mkdir(parents=True, exist_ok=True)
    made = 0
    for p in passages:
        for i, s in enumerate(p["sentences"]):
            for spk in dict_speakers:
                made += make(sh_dir / f"{p['id']}-{i}_{spk}.mp3", s["text"], spk)
    write_json(APP / "data" / "shadowing.json", {
        "audio": "audio/sh/{passage}-{i}_{speaker}.mp3",
        "speakers": dict_speakers,
        "voiceLabels": voice_labels,
        "passages": passages,
    })
    size = sum(f.stat().st_size for f in sh_dir.glob("*.mp3"))
    print(f"shadowing: passages={len(passages)} made={made} size={size / 1e6:.1f}MB")

    # word stress: keep only words whose stress position matches the TTS pronunciation
    words = json.loads((DATA / "stress_words.json").read_text(encoding="utf-8"))["words"]
    kept = []
    for w in words:
        ph = "".join("".join(s) for s in voice.phonemize(w["word"]))
        idx, n = stress_syllable(ph)
        if idx == w["stress"] and n == len(w["syl"]):
            kept.append(w)
        else:
            print(f"  stress: dropped {w['word']} (expected {w['stress']}/{len(w['syl'])}, TTS {idx}/{n}, {ph!r})")
    st_dir = APP / "audio" / "stress"
    st_dir.mkdir(parents=True, exist_ok=True)
    made = 0
    for w in kept:
        for spk in train_speakers + test_speakers:
            made += make(st_dir / f"{w['word'].lower()}_{spk}.mp3", w["word"], spk)
    write_json(APP / "data" / "stress.json", {
        "audio": "audio/stress/{word}_{speaker}.mp3",
        "speakers": {"train": train_speakers, "test": test_speakers},
        "words": kept,
    })
    size = sum(f.stat().st_size for f in st_dir.glob("*.mp3"))
    print(f"stress: words={len(kept)}/{len(words)} made={made} size={size / 1e6:.1f}MB")

    # sentence rhythm: natural speed with several voices + one slow version
    rhythm = json.loads((DATA / "rhythm_sentences.json").read_text(encoding="utf-8"))["sentences"]
    rh_dir = APP / "audio" / "rhythm"
    rh_dir.mkdir(parents=True, exist_ok=True)
    made = 0
    for s in rhythm:
        text = s["marked"].replace("*", "")
        for spk in dict_speakers:
            made += make(rh_dir / f"{s['id']}_{spk}.mp3", text, spk)
        made += make(rh_dir / f"{s['id']}_slow.mp3", text, single_voice, 1.4)
    write_json(APP / "data" / "rhythm.json", {
        "audio": "audio/rhythm/{id}_{speaker}.mp3",
        "slow": "audio/rhythm/{id}_slow.mp3",
        "speakers": dict_speakers,
        "voiceLabels": voice_labels,
        "sentences": rhythm,
    })
    print(f"rhythm: sentences={len(rhythm)} made={made}")

    # stories for listening while reading, one file per sentence
    stories = json.loads((DATA / "stories.json").read_text(encoding="utf-8"))["stories"]
    sto_dir = APP / "audio" / "story"
    sto_dir.mkdir(parents=True, exist_ok=True)
    made = 0
    for st in stories:
        for i, s in enumerate(st["sentences"]):
            for spk in dict_speakers:
                made += make(sto_dir / f"{st['id']}-{i}_{spk}.mp3", s["text"], spk)
    write_json(APP / "data" / "stories.json", {
        "audio": "audio/story/{story}-{i}_{speaker}.mp3",
        "speakers": dict_speakers,
        "voiceLabels": voice_labels,
        "stories": stories,
    })
    size = sum(f.stat().st_size for f in sto_dir.glob("*.mp3"))
    print(f"stories: {len(stories)} made={made} size={size / 1e6:.1f}MB")

    # chants: each beat chunk is synthesized separately and placed so its loudest
    # point falls on the beat; a click marks every beat (4-beat count-in first)
    chants = json.loads((DATA / "chants.json").read_text(encoding="utf-8"))["chants"]
    ch_dir = APP / "audio" / "chant"
    ch_dir.mkdir(parents=True, exist_ok=True)
    made = 0
    for ch in chants:
        lines = [[None if c.strip() == "-" else c.strip().replace("*", "") for c in ln["beats"].split("|")] for ln in ch["lines"]]
        for tempo, bpm in CHANT_BPM.items():
            for voiced in (True, False):
                path = ch_dir / f"{ch['id']}_{tempo}{'' if voiced else '_beat'}.mp3"
                if path.exists():
                    continue
                audio, rate = render_chant(voice, lines, bpm, single_voice if voiced else None)
                sf.write(path, audio, rate, format="MP3")
                made += 1
    write_json(APP / "data" / "chants.json", {
        "audio": "audio/chant/{id}_{tempo}.mp3",
        "bpm": CHANT_BPM,
        "count_in": CHANT_COUNT_IN,
        "chants": chants,
    })
    print(f"chants: {len(chants)} made={made}")


if __name__ == "__main__":
    main()
