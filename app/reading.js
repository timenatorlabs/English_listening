// Listening while reading (like a picture-book read-aloud): short stories with
// the current sentence highlighted. A full listen-through is logged as extensive listening.
import * as db from "./db.js";
import { esc, toast } from "./util.js";
import { play, playSequence, stopAll } from "./audio.js";
import * as vocab from "./vocab.js";
import { benefitCard } from "./benefits.js";

const RATES = [0.7, 0.8, 0.9, 1.0, 1.1, 1.2];
const COMP = ["ほとんど分からない", "半分くらい", "だいたい分かる", "ほぼ全部分かる"];

const app = document.getElementById("app");
let data = null;

export function init(d) {
  data = d;
}

const sentencePath = (st, i, speaker) => data.audio.replace("{story}", st.id).replace("{i}", i).replace("{speaker}", speaker);
const fullText = (st) => st.sentences.map((s) => s.text).join(" ");

export function audioPaths() {
  return data.stories.flatMap((st) => st.sentences.flatMap((_, i) => data.speakers.map((sp) => sentencePath(st, i, sp))));
}

export async function renderList() {
  stopAll();
  const level = (await db.get("level", null)) || 2;
  const counts = {};
  for (const t of await db.allTrials()) if (t.mode === "extensive" && t.source === "story" && t.story) counts[t.story] = (counts[t.story] || 0) + 1;
  app.innerHTML = `
    <h1>聞き読み（物語）</h1>
    ${benefitCard("reading")}
    <section class="card">
      <p class="small">絵本の読み聞かせのように、<strong>文字を見ながら音声を聞く</strong>練習です。読んでいる文に色が付きます。</p>
      <p class="muted small">根拠 ○：オーディオブックを聞きながら読む学習で、聴解力と語彙が伸びたという報告があります（Chang 2011 など、小規模）。最後まで聞くと「多聴」の時間として記録されます。</p>
    </section>
    ${data.stories.map((st) => {
      const { coverage } = vocab.analyze(fullText(st), level, st.names || []);
      return `
      <button class="btn contrast" type="button" data-story="${esc(st.id)}">
        <span class="contrast-title">${esc(st.title)}<span class="muted small">（${esc(st.ja_title)}）</span></span>
        <span class="muted small">レベル${st.level}・${st.sentences.length}文・あなたのレベルでの単語カバー率 ${coverage}%・${counts[st.id] || 0}回</span>
      </button>`;
    }).join("")}
    <button class="btn" type="button" data-nav="home">ホームへ</button>
  `;
  app.querySelectorAll("[data-story]").forEach((btn) => {
    btn.onclick = async () => {
      const st = data.stories.find((s) => s.id === btn.dataset.story);
      renderStory({ st, level, rate: (await db.get("storyRate", null)) || 1.0, speaker: data.speakers[0], showJa: false });
      window.scrollTo(0, 0);
    };
  });
}

function renderStory(state) {
  const { st } = state;
  app.innerHTML = `
    <h1>${esc(st.title)}</h1>
    ${vocab.previewCard(fullText(st), state.level, st.names || [])}
    <div class="chips" aria-label="再生速度">
      ${RATES.map((r) => `<button class="chip ${r === state.rate ? "on" : ""}" type="button" data-rate="${r}">${r.toFixed(1)}倍</button>`).join("")}
    </div>
    <div class="chips" aria-label="声">
      ${data.speakers.map((sp, i) => `<button class="chip ${sp === state.speaker ? "on" : ""}" type="button" data-speaker="${sp}">${esc((data.voiceLabels || {})[sp] || `声${i + 1}`)}</button>`).join("")}
      <button class="chip ${state.showJa ? "on" : ""}" type="button" id="toggle-ja">和訳</button>
    </div>
    <div class="row">
      <button class="btn primary" type="button" id="play-all">▶ 最初から聞く</button>
      <button class="btn" type="button" id="stop">■ 停止</button>
    </div>
    <section class="card story">
      ${st.sentences.map((s, i) => `
        <p data-sentence="${i}"><span>${esc(s.text)}</span>${state.showJa ? `<span class="muted small ja">${esc(s.ja)}</span>` : ""}</p>`).join("")}
    </section>
    <div id="after"></div>
    <button class="btn" type="button" id="back">物語の一覧へ</button>
  `;
  vocab.bindPreview(app);

  const paths = st.sentences.map((_, i) => sentencePath(st, i, state.speaker));
  const highlight = (i) => app.querySelectorAll("[data-sentence]").forEach((p) => p.classList.toggle("now", Number(p.dataset.sentence) === i));

  app.querySelectorAll("[data-rate]").forEach((btn) => {
    btn.onclick = () => {
      stopAll();
      db.set("storyRate", Number(btn.dataset.rate));
      renderStory({ ...state, rate: Number(btn.dataset.rate) });
    };
  });
  app.querySelectorAll("[data-speaker]").forEach((btn) => {
    btn.onclick = () => {
      stopAll();
      renderStory({ ...state, speaker: Number(btn.dataset.speaker) });
    };
  });
  document.getElementById("toggle-ja").onclick = () => renderStory({ ...state, showJa: !state.showJa });
  app.querySelectorAll("[data-sentence]").forEach((p) => {
    p.onclick = () => {
      const i = Number(p.dataset.sentence);
      highlight(i);
      play(paths[i], state.rate);
    };
  });
  document.getElementById("stop").onclick = () => {
    stopAll();
    highlight(-1);
  };
  document.getElementById("back").onclick = renderList;
  document.getElementById("play-all").onclick = async () => {
    const started = Date.now();
    const finished = await playSequence(paths, state.rate, {
      gapMs: 600,
      onIndex: (i) => {
        highlight(i);
        const el = app.querySelector(`[data-sentence="${i}"]`);
        if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
      },
    });
    if (!finished) return;
    const minutes = Math.max(1, Math.round((Date.now() - started) / 60000));
    const after = document.getElementById("after");
    if (!after) return;
    after.innerHTML = `
      <section class="card">
        <p class="small">最後まで聞きました（約${minutes}分）。どのくらい分かりましたか？ 多聴の時間として記録します。</p>
        <div class="chips">${COMP.map((c, i) => `<button class="chip" type="button" data-comp="${i + 1}">${c}</button>`).join("")}</div>
      </section>`;
    after.scrollIntoView({ block: "center", behavior: "smooth" });
    after.querySelectorAll("[data-comp]").forEach((btn) => {
      btn.onclick = async () => {
        await db.addTrial({ mode: "extensive", date: new Date().toISOString(), source: "story", story: st.id, minutes, comp: Number(btn.dataset.comp) });
        toast(`${minutes}分を多聴として記録しました`);
        after.innerHTML = "";
      };
    });
  };
}
