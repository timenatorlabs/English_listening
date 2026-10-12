// Shadowing in three steps (understand → read along → shadow without script).
// Self-recordings stay in memory only: never saved, never sent anywhere.
import * as db from "./db.js";
import { esc, toast } from "./util.js";
import { play, playSequence, stopAll, unlock, loadAudio } from "./audio.js";
import * as vocab from "./vocab.js";
import { benefitCard } from "./benefits.js";
import * as recorder from "./recorder.js";
import { f0Track, semitones, stretch, bestLag, localLag, voicedShare, sentenceChart, directionAgreement, pitchNote } from "./pitch.js";

const RATES = [0.7, 0.8, 0.9, 1.0, 1.1, 1.2];
const DEFAULT_RATE = { 1: 0.8, 2: 0.9, 3: 1.0, 4: 1.0, 5: 1.0 };
const STEPS = [
  { n: 1, name: "① 内容を理解", guide: "和訳を見ながら聞き、意味がわかるまで繰り返しましょう。文をタップすると、その文だけ再生します。" },
  { n: 2, name: "② 見ながら読む", guide: "スクリプトを見ながら、音声と同時に声に出して読みます（オーバーラッピング）。" },
  { n: 3, name: "③ シャドーイング", guide: "スクリプトを見ずに、音声を少し遅れて追いかけながら声に出します。" },
];

const app = document.getElementById("app");
let data = null;
let recording = null;    // active recorder session
let mine = null;         // { url, audio, samples, rate, diag } of the latest self-recording

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
    const session = recording;
    recording = null;
    await session.stop().catch(() => {});
  }
  if (mine) {
    mine.audio.pause();
    URL.revokeObjectURL(mine.url);
    mine = null;
  }
}

const canRecord = recorder.canRecord;

function keepRecording(result) {
  if (mine) URL.revokeObjectURL(mine.url);
  const url = URL.createObjectURL(result.blob);
  mine = { url, audio: new Audio(url), samples: result.samples, rate: result.rate, diag: result.diag };
}

// Plain-language diagnosis when nothing (or almost nothing) was captured
function silenceHelp(diag, withModel) {
  return `
    <section class="card qa-note">
      <h2>録音に声が入っていませんでした</h2>
      <p class="small">考えられる原因：</p>
      <ul class="small">
        <li>マイクが許可されていない（iPhone：設定 → アプリ → Safari → マイク を「許可」。ホーム画面から開いている場合も同じです）</li>
        <li>Bluetooth イヤホンの場合、イヤホンのマイクがうまく使われていない（有線イヤホンか、本体のマイクで試してください）</li>
        ${withModel ? "<li>お手本を再生している間に、iPhone がマイクを止めた（下の「マイクのテスト」で、お手本なしで録音できるか確かめてください）</li>" : ""}
      </ul>
      <p class="muted small">記録：長さ ${diag.seconds.toFixed(1)}秒、最大の音量 ${(diag.peak * 100).toFixed(1)}%、途中でマイクが止められた回数 ${diag.muted}回</p>
    </section>`;
}

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
      <button class="btn" type="button" id="mic-test" ${canRecord() ? "" : "disabled"}>マイクのテスト（お手本なしで4秒録音）</button>
      ${canRecord() ? "" : `<p class="muted small">この環境では録音できません（https のページで使えます）。</p>`}
      <div id="level-box" hidden><p class="small">マイクの音量</p><div class="meter level"><span id="level" style="width:0%"></span></div></div>
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
  const test = document.getElementById("mic-test");
  const levelBox = document.getElementById("level-box");
  const showLevel = (rms) => {
    const bar = document.getElementById("level");
    if (bar) bar.style.width = `${Math.min(100, Math.sqrt(rms) * 250).toFixed(0)}%`;
  };
  // Both buttons: unlock playback and the audio engine inside the tap, then ask for the mic.
  const begin = async () => {
    unlock();
    recorder.prepare();
    try {
      recording = await recorder.start({ onLevel: showLevel });
    } catch (e) {
      toast(`マイクを使えませんでした（${e.name || "エラー"}）。設定でマイクを許可してください。`);
      return false;
    }
    if (levelBox) levelBox.hidden = false;
    return true;
  };
  // Returns null when the recording was already discarded (e.g. the learner left the screen).
  const finish = async () => {
    const session = recording;
    recording = null;
    if (levelBox) levelBox.hidden = true;
    return session ? session.stop() : null;
  };
  if (rec && canRecord()) {
    rec.onclick = async () => {
      if (recording) return;
      if (!(await begin())) return;
      rec.textContent = "● 録音中…";
      rec.disabled = true;
      if (test) test.disabled = true;
      const finished = await playSequence(paths, st.rate, { onIndex: highlight });
      const result = await finish();
      if (!result || !rec.isConnected) return;
      rec.textContent = "● 録音しながら再生";
      rec.disabled = false;
      if (test) test.disabled = false;
      keepRecording(result);
      if (finished && !result.diag.silent) logPractice(true);
      renderMine(paths, st, true);
    };
  }
  if (test && canRecord()) {
    test.onclick = async () => {
      if (recording) return;
      stopAll();
      if (!(await begin())) return;
      test.textContent = "録音中…（何か話してください）";
      test.disabled = true;
      if (rec) rec.disabled = true;
      await new Promise((r) => setTimeout(r, 4000));
      const result = await finish();
      if (!result || !test.isConnected) return;
      test.textContent = "マイクのテスト（お手本なしで4秒録音）";
      test.disabled = false;
      if (rec) rec.disabled = false;
      keepRecording(result);
      renderMine(paths, st, false);
      if (!result.diag.silent) mine.audio.play().catch(() => {});
    };
  }
  if (mine) renderMine(paths, st, true);
}

// Model contour: each sentence analysed at normal speed, stretched to the playback
// speed, joined with the same pauses playSequence uses.
// Returns { contour, segments: [{ start, end }] } — where each sentence lies on the timeline.
async function modelContour(paths, rate) {
  const parts = [];
  const segments = [];
  let o = 0;
  for (const p of paths) {
    const url = await loadAudio(p);
    const buf = await recorder.decode(await (await fetch(url)).arrayBuffer());
    const c = stretch(semitones(f0Track(buf.getChannelData(0), buf.sampleRate)), 1 / rate);
    segments.push({ start: o, end: o + c.length });
    parts.push(c);
    o += c.length;
    const gap = new Float32Array(Math.round(0.4 / rate / 0.01)).fill(NaN);
    parts.push(gap);
    o += gap.length;
  }
  const contour = new Float32Array(o);
  let k = 0;
  for (const x of parts) {
    contour.set(x, k);
    k += x.length;
  }
  return { contour, segments };
}

function renderMine(paths, st, withModel) {
  const box = document.getElementById("mine");
  if (!box || !mine) return;
  if (mine.diag.silent) {
    box.innerHTML = silenceHelp(mine.diag, withModel);
    return;
  }
  box.innerHTML = `
    <section class="card">
      <h2>自分の声</h2>
      <p class="muted small">録音（${mine.diag.seconds.toFixed(1)}秒）はこの画面を離れると消えます（保存も送信もしません）。</p>
      <div class="row">
        <button class="btn" type="button" id="play-mine">▶ 自分の声</button>
        <button class="btn" type="button" id="compare">▶ お手本 → 自分</button>
      </div>
      ${withModel ? `<button class="btn" type="button" id="show-pitch">抑揚をグラフで比べる</button><div id="pitch-box"></div>` : ""}
    </section>
  `;
  const sp = document.getElementById("show-pitch");
  if (sp) {
    sp.onclick = async () => {
      sp.disabled = true;
      sp.textContent = "分析中…";
      try {
        const { contour: model, segments } = await modelContour(paths, st.rate);
        const userTrack = f0Track(mine.samples, mine.rate);
        const user = semitones(userTrack);
        // the delay drifts during a passage: each sentence starts from the previous one's delay
        let lag = bestLag(model, user);
        const rows = st.p.sentences.map((s, i) => {
          const { start, end } = segments[i];
          const l = localLag(model, user, start, end, lag, 80);
          lag = l;
          const m = model.slice(start, end);
          const u = user.slice(start + l, end + l);
          const share = voicedShare(u);
          const agree = directionAgreement(m, u, 0, 8);
          return `
            <div class="sentence-row">
              <p class="small"><strong>${i + 1}.</strong> ${esc(s.text)}</p>
              ${sentenceChart(m, u)}
              <p class="muted small">${share < 0.1
                ? "この文は、自分の声の高さを測れませんでした（声が小さい、または声が出ていない部分）。"
                : agree === null ? "上がり下がりが少ない文です。" : `上がり下がりの向きがお手本と同じ：${Math.round(agree * 100)}%（目安）`}</p>
            </div>`;
        }).join("");
        const measured = voicedShare(user);
        document.getElementById("pitch-box").innerHTML = `
          <div class="legend"><span><i class="key-s1"></i>お手本</span><span><i class="key-s2"></i>自分の声</span></div>
          ${rows}
          ${measured < 0.05 ? `<p class="small qa-note">録音全体で、自分の声の高さをほとんど測れませんでした。マイクに近づき、少し大きめの声で話してみてください。</p>` : ""}
          ${pitchNote()}
          <p class="muted small">自分の声は、お手本からの遅れを文ごとに差し引いて重ねています。研究では、声の高さを画面で見ながら練習すると外国語の抑揚が改善したという報告があります（Hardison 2004、話す練習の研究）。聞き取りへの効果は間接的です。</p>`;
        sp.hidden = true;
      } catch (e) {
        sp.disabled = false;
        sp.textContent = "抑揚をグラフで比べる";
        toast(`分析できませんでした（${e.name || "エラー"}）`);
      }
    };
  }
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
