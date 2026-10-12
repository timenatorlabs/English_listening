// Vocabulary coverage with the NGSL (Browne, Culligan & Phillips; CC BY-SA 4.0).
// Level bands: 1 = top 1000, 2 = top 2000, 3+ = whole NGSL (2809 words).
// About 95% known-word coverage is suggested for adequate listening
// comprehension (van Zeeland & Schmitt 2013), so off-band words are shown up front.
import { esc } from "./util.js";

const BANDS = { 1: 1000, 2: 2000, 3: 2809, 4: 2809, 5: 2809 };
const SPECIAL = { "can't": ["can", "not"], "won't": ["will", "not"], "let's": ["let", "us"] };
const SUFFIX = { m: "am", re: "are", ve: "have", ll: "will", s: "is" };
// NGSL leaves numbers, days and months out of the main list
const EXCLUDED = new Set(("zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen "
  + "sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred hundreds "
  + "thousand thousands million first second third monday tuesday wednesday thursday friday saturday sunday mondays "
  + "january february march april may june july august september october november december oh ok okay").split(" "));

let forms = null;

export function init(ngsl) {
  forms = ngsl.forms;
}

const band = (level) => BANDS[level] || BANDS[3];

function properNouns(text, names) {
  const out = new Set(names.map((n) => n.toLowerCase()));
  let first = true;
  for (const raw of text.replace(/’/g, "'").split(/\s+/)) {
    const w = raw.replace(/[^A-Za-z']+/g, "").replace(/^'+|'+$/g, "");
    if (w && /^[A-Z]/.test(w) && !first && w !== "I" && !w.startsWith("I'")) out.add(w.toLowerCase());
    first = /[.?!:]["']?$/.test(raw);
  }
  return out;
}

// Returns { coverage (0–100), off: [{ word, display }] } for the learner's level.
export function analyze(text, level, names = []) {
  if (!forms) return { coverage: 100, off: [] };
  const proper = properNouns(text, names);
  const limit = band(level);
  let total = 0;
  let inside = 0;
  const off = new Map();
  for (const raw of text.replace(/’/g, "'").split(/\s+/)) {
    const w = raw.replace(/[^A-Za-z0-9']+/g, "").replace(/^'+|'+$/g, "");
    if (!w || /^\d+$/.test(w) || proper.has(w.toLowerCase()) || EXCLUDED.has(w.toLowerCase())) continue;
    const lw = w.toLowerCase();
    let parts = [lw];
    if (SPECIAL[lw]) parts = SPECIAL[lw];
    else if (/n't$/.test(lw)) parts = [lw.slice(0, -3), "not"];
    else {
      const m = lw.match(/^(.+)'(m|re|ve|ll|d|s)$/);
      if (m) parts = SUFFIX[m[2]] ? [m[1], SUFFIX[m[2]]] : [m[1]];
    }
    for (const p of parts) {
      total++;
      const rank = forms[p];
      if (rank !== undefined && rank <= limit) inside++;
      else if (!off.has(p)) off.set(p, p);
    }
  }
  return { coverage: total ? Math.round((inside / total) * 1000) / 10 : 100, off: [...off.keys()] };
}

// Only voices that run on the device: cloud voices would send the text away.
function localVoice() {
  if (!("speechSynthesis" in window)) return null;
  const voices = speechSynthesis.getVoices().filter((v) => v.localService && /^en[-_]/i.test(v.lang));
  return voices.find((v) => /en[-_]US/i.test(v.lang)) || voices[0] || null;
}

if ("speechSynthesis" in window) speechSynthesis.getVoices();   // start loading the voice list

export function speak(word) {
  const voice = localVoice();
  if (!voice) return false;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(word);
  u.voice = voice;
  u.lang = voice.lang;
  u.rate = 0.9;
  speechSynthesis.speak(u);
  return true;
}

// Card listing words outside the learner's band; call bindPreview() after inserting it.
export function previewCard(text, level, names = []) {
  const { coverage, off } = analyze(text, level, names);
  return `
    <section class="card">
      <h2>事前に確認する単語</h2>
      <p class="muted small">あなたのレベル（よく使われる上位${band(level) >= 2809 ? "約2,800" : band(level).toLocaleString()}語）で、この文章の <strong>${coverage}%</strong> の語をカバーしています。聞き取りには約95%が目安とされています（van Zeeland &amp; Schmitt 2013）。</p>
      ${off.length ? `
        <p class="small">範囲外の単語（意味を確認してから聞くと、聞き取りやすくなります）：</p>
        <div class="chips">${off.map((w) => `<button class="chip" type="button" data-say="${esc(w)}">${esc(w)}</button>`).join("")}</div>
        <p class="muted small">単語を押すと、端末内蔵の音声で読み上げます（端末によっては読み上げられません）。</p>`
        : `<p class="small">範囲外の単語はありません。</p>`}
    </section>`;
}

export function bindPreview(root) {
  root.querySelectorAll("[data-say]").forEach((btn) => {
    btn.onclick = () => {
      if (!speak(btn.dataset.say)) btn.title = "この端末では読み上げできません";
    };
  });
}
