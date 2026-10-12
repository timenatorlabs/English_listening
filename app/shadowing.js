// Shadowing in three steps (understand → read along → shadow without script).
// Self-recordings stay in memory only: never saved, never sent anywhere.
import * as db from "./db.js";
import { esc, toast } from "./util.js";
import { play, playSequence, stopAll, unlock } from "./audio.js";
import * as vocab from "./vocab.js";
import { benefitCard } from "./benefits.js";

const RATES = [0.7, 0.8, 0.9, 1.0, 1.1, 1.2];
const DEFAULT_RATE = { 1: 0.8, 2: 0.9, 3: 1.0, 4: 1.0, 5: 1.0 };
const STEPS = [
  { n: 1, name: "① 内容を理解", guide: "和訳を見ながら聞き、意味がわかるまで繰り返しましょう。文をタップすると、その文だけ再生します。" },
  { n: 2, name: "② 見ながら読む", guide: "スクリプトを見ながら、音声と同時に声に出して読みます（オーバーラッピング）。" },
  { n: 3, name: "③ シャドーイング", guide: "スクリプトを見ずに、音声を少し遅れて追いかけながら声に出します。" },
];

const app = document.getElementById("app");
let data = null;
let recording = null;    // active MediaRecorder session
let mine = null;         // { url, audio } of the latest self-recording

export function init(d) {
  data = d;
}

const sentencePath = (p, i, speaker) => data.audio.replace("{passage}", p.id).replace("{i}", i).replace("{speaker}", speaker);

export function audioPaths() {
  return data.passages.flatMap((p) => p.sentences.flatMap((_, i) => data.speakers.map((sp) => sentencePath(p, i, sp))));
}

// Stop playback and release the microphone / recording when leaving the screen.
export async function cleanup() {
  stopAll();
  if (recording) {
    await recording.stop().catch(() => {});
    recording = null;
  }
  if (mine) {
    mine.audio.pause();
    URL.revokeObjectURL(mine.url);
    mine = null;
  }
}

async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const type = ["audio/webm", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t));
  const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  const chunks = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  const stopped = new Promise((resolve) => (recorder.onstop = resolve));
  recorder.start();
  return {
    async stop() {
      if (recorder.state !== "inactive") recorder.stop();
      await stopped;
      stream.getTracks().forEach((t) => t.stop());
      return new Blob(chunks, { type: recorder.mimeType || type || "audio/webm" });
    },
  };
}

const canRecord = () => !!(window.MediaRecorder && navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.isSecureContext);

async function practiceCounts() {
  const counts = {};
  for (const t of await db.allTrials()) {
    if (t.mode === "shadowing") counts[t.passage] = (counts[t.passage] || 0) + 1;
  }
  return counts;
}

export async function renderList() {
  await cleanup();
  const level = await db.get("level", null);
  const counts = await practiceCounts();
  const sorted = data.passages.slice().sort((a, b) => (a.level === level ? -1 : 0) - (b.level === level ? -1 : 0) || a.level - b.level);
  app.innerHTML = `
    <h1>シャドーイング</h1>
    ${benefitCard("shadowing")}
    <section class="card">
      <p class="small">音声を聞きながら、少し遅れて同じように声に出す練習です。3つのステップで進めます。</p>
      <p class="muted small">根拠 ○：日本人学習者で音の聞き取りが改善し、特に初級の学習者で聴解の得点が伸びたという報告があります（Hamada 2016 など）。語彙学習など他の練習と組み合わせると効果的とされています。</p>
    </section>
    ${sorted.map((p) => `
      <button class="btn contrast" type="button" data-passage="${esc(p.id)}">
        <span class="contrast-title">${esc(p.title)}<span class="muted small">（${esc(p.ja_title)}）</span></span>
        <span class="muted small">レベル${p.level}${p.level === level ? "・あなたのレベル" : ""}・練習 ${counts[p.id] || 0}回</span>
      </button>`).join("")}
    <button class="btn" type="button" data-nav="home">ホームへ</button>
  `;
  app.querySelectorAll("[data-passage]").forEach((btn) => {
    btn.onclick = async () => {
      const p = data.passages.find((x) => x.id === btn.dataset.passage);
      const saved = await db.get("shadowRate", null);
      renderPassage({ p, level: level || p.level, step: 1, rate: saved || DEFAULT_RATE[p.level], speaker: data.speakers[0], showScript: false, current: -1 });
      window.scrollTo(0, 0);
    };
  });
}

function renderPassage(st) {
  const { p } = st;
  const step = STEPS[st.step - 1];
  const scriptVisible = st.step < 3 || st.showScript;

  app.innerHTML = `
    <h1>${esc(p.title)}</h1>
    <div class="chips" role="tablist">
      ${STEPS.map((s) => `<button class="chip ${s.n === st.step ? "on" : ""}" type="button" data-step="${s.n}">${s.name}</button>`).join("")}
    </div>
    <section class="card">
      <p class="small">${step.guide}</p>
      ${st.step > 1 ? `<p class="muted small">録音する場合は、お手本の音が入らないようイヤホンを使ってください。</p>` : ""}
    </section>

    <div class="chips" aria-label="再生速度">
      ${RATES.map((r) => `<button class="chip ${r === st.rate ? "on" : ""}" type="button" data-rate="${r}">${r.toFixed(1)}倍</button>`).join("")}
    </div>
    <div class="chips" aria-label="声">
      ${data.speakers.map((sp, i) => `<button class="chip ${sp === st.speaker ? "on" : ""}" type="button" data-speaker="${sp}">${esc((data.voiceLabels || {})[sp] || `声${i + 1}`)}</button>`).join("")}
    </div>

    <div class="row">
      <button class="btn primary" type="button" id="play-all">▶ 全文を再生</button>
      <button class="btn" type="button" id="stop">■ 停止</button>
    </div>
    ${st.step > 1 ? `
      <button class="btn" type="button" id="record" ${canRecord() ? "" : "disabled"}>● 録音しながら再生</button>
      ${canRecord() ? "" : `<p class="muted small">この環境では録音できません（公開後の https のページでは使えます）。</p>`}
      <div id="mine"></div>` : ""}

    <section class="card">
      ${scriptVisible ? `
        <ol class="script">
          ${p.sentences.map((s, i) => `
            <li class="${i === st.current ? "now" : ""}" data-sentence="${i}">
              <span>${esc(s.text)}</span>
              ${st.step === 1 ? `<span class="muted small">${esc(s.ja)}</span>` : ""}
            </li>`).join("")}
        </ol>` : `
        <p class="muted">スクリプトは隠れています。</p>
        <button class="btn" type="button" id="show-script">スクリプトを表示</button>`}
    </section>

    ${st.step === 1 ? vocab.previewCard(p.sentences.map((s) => s.text).join(" "), st.level) : ""}

    <button class="btn" type="button" id="back">文章の一覧へ</button>
  `;
  vocab.bindPreview(app);

  const paths = p.sentences.map((_, i) => sentencePath(p, i, st.speaker));
  const highlight = (i) => {
    st.current = i;
    app.querySelectorAll("[data-sentence]").forEach((li) => li.classList.toggle("now", Number(li.dataset.sentence) === i));
  };
  const logPractice = (recorded) => db.addTrial({
    mode: "shadowing", date: new Date().toISOString(), passage: p.id, step: st.step, rate: st.rate, speaker: st.speaker, recorded,
  });

  app.querySelectorAll("[data-step]").forEach((btn) => {
    btn.onclick = async () => {
      await cleanup();
      renderPassage({ ...st, step: Number(btn.dataset.step), showScript: false, current: -1 });
    };
  });
  app.querySelectorAll("[data-rate]").forEach((btn) => {
    btn.onclick = () => {
      stopAll();
      db.set("shadowRate", Number(btn.dataset.rate));
      renderPassage({ ...st, rate: Number(btn.dataset.rate), current: -1 });
    };
  });
  app.querySelectorAll("[data-speaker]").forEach((btn) => {
    btn.onclick = () => {
      stopAll();
      renderPassage({ ...st, speaker: Number(btn.dataset.speaker), current: -1 });
    };
  });
  app.querySelectorAll("[data-sentence]").forEach((li) => {
    li.onclick = () => {
      const i = Number(li.dataset.sentence);
      highlight(i);
      play(paths[i], st.rate);
    };
  });
  document.getElementById("play-all").onclick = async () => {
    const finished = await playSequence(paths, st.rate, { onIndex: highlight });
    if (finished && st.step > 1) logPractice(false);
  };
  document.getElementById("stop").onclick = () => {
    stopAll();
    highlight(-1);
  };
  const show = document.getElementById("show-script");
  if (show) show.onclick = () => renderPassage({ ...st, showScript: true });
  document.getElementById("back").onclick = renderList;

  const rec = document.getElementById("record");
  if (rec && canRecord()) {
    rec.onclick = async () => {
      if (recording) return;
      unlock();   // must happen inside the tap, before waiting for the microphone
      try {
        recording = await startRecording();
      } catch (e) {
        toast("マイクを使えませんでした。ブラウザの設定でマイクを許可してください。");
        return;
      }
      rec.textContent = "● 録音中…";
      rec.disabled = true;
      const finished = await playSequence(paths, st.rate, { onIndex: highlight });
      const blob = await recording.stop();
      recording = null;
      rec.textContent = "● 録音しながら再生";
      rec.disabled = false;
      if (mine) URL.revokeObjectURL(mine.url);
      const url = URL.createObjectURL(blob);
      mine = { url, audio: new Audio(url) };
      if (finished) logPractice(true);
      renderMine(paths, st);
    };
  }
  if (mine) renderMine(paths, st);
}

function renderMine(paths, st) {
  const box = document.getElementById("mine");
  if (!box || !mine) return;
  box.innerHTML = `
    <section class="card">
      <h2>自分の声</h2>
      <p class="muted small">録音はこの画面を離れると消えます（保存も送信もしません）。</p>
      <div class="row">
        <button class="btn" type="button" id="play-mine">▶ 自分の声</button>
        <button class="btn" type="button" id="compare">▶ お手本 → 自分</button>
      </div>
    </section>
  `;
  document.getElementById("play-mine").onclick = () => {
    stopAll();
    mine.audio.currentTime = 0;
    mine.audio.play();
  };
  document.getElementById("compare").onclick = async () => {
    mine.audio.pause();
    const finished = await playSequence(paths, st.rate);
    if (finished && mine) {
      mine.audio.currentTime = 0;
      mine.audio.play();
    }
  };
}
