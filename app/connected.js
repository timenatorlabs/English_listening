// Connected-speech lessons: rule explanation, "word by word" vs natural
// listening, and a short cloze quiz on natural-speed sentences.
import * as db from "./db.js";
import { esc, pct, pick, shuffle } from "./util.js";
import { play } from "./audio.js";
import { tokenize, eq } from "./dictation.js";

const app = document.getElementById("app");
let data = null;

export function init(d) {
  data = d;
}

const examplePath = (lesson, i, kind) => data.examples.replace("{lesson}", lesson).replace("{i}", i).replace("{kind}", kind);
const quizPath = (lesson, i, speaker) => data.quiz.replace("{lesson}", lesson).replace("{i}", i).replace("{speaker}", speaker);

export function audioPaths() {
  return data.lessons.flatMap((les) => [
    ...les.examples.flatMap((_, i) => ["words", "natural"].map((k) => examplePath(les.id, i, k))),
    ...les.quiz.flatMap((_, i) => data.speakers.map((sp) => quizPath(les.id, i, sp))),
  ]);
}

async function bestScores() {
  const best = {};
  for (const t of await db.allTrials()) {
    if (t.mode !== "connected") continue;
    best[t.lesson] = Math.max(best[t.lesson] || 0, pct(t.correct, t.n));
  }
  return best;
}

export async function renderList() {
  const best = await bestScores();
  app.innerHTML = `
    <h1>音の変化の学習</h1>
    <section class="card">
      <p class="small">英語は、単語を1つずつ発音するときと、文の中で話すときとで音が変わります。知っている単語なのに聞き取れない原因の多くはここにあります。</p>
      <p class="muted small">根拠 ○：音の変化を明示的に学ぶと聞き取りが伸びたという報告があります（小規模な研究）。</p>
    </section>
    ${data.lessons.map((les) => `
      <button class="btn contrast" type="button" data-lesson="${esc(les.id)}">
        <span class="contrast-title">${esc(les.title)}</span>
        <span class="muted small">${best[les.id] !== undefined ? `確認問題の最高 ${best[les.id]}%` : "確認問題 未挑戦"}</span>
      </button>`).join("")}
    <button class="btn" type="button" data-nav="home">ホームへ</button>
  `;
  app.querySelectorAll("[data-lesson]").forEach((btn) => {
    btn.onclick = () => renderLesson(btn.dataset.lesson);
  });
}

export function renderLesson(id) {
  const les = data.lessons.find((l) => l.id === id);
  app.innerHTML = `
    <h1>${esc(les.title)}</h1>
    <section class="card">
      <p>${esc(les.summary)}</p>
      <ul class="small">${les.points.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>
    </section>

    <section class="card">
      <h2>聞き比べ</h2>
      <p class="muted small">「1語ずつ」と「自然な文」を聞き比べて、音の変わり方を確かめましょう。カタカナは聞こえ方の目安です。</p>
      ${les.examples.map((ex, i) => `
        <div class="example">
          <div><strong>${esc(ex.text)}</strong> <span class="muted small">→ ${esc(ex.kana)}</span></div>
          <div class="row">
            <button class="btn" type="button" data-ex="${i}" data-kind="words">▶ 1語ずつ</button>
            <button class="btn" type="button" data-ex="${i}" data-kind="natural">▶ 自然な文</button>
          </div>
        </div>`).join("")}
      <p class="muted small">音声合成のため、実際の会話ほど音の変化がはっきり出ないことがあります。</p>
    </section>

    <button class="btn primary" type="button" id="quiz">確認問題（${les.quiz.length}問）</button>
    <button class="btn" type="button" id="back">音の変化の一覧へ</button>
  `;
  app.querySelectorAll("[data-ex]").forEach((btn) => {
    btn.onclick = () => play(examplePath(les.id, btn.dataset.ex, btn.dataset.kind));
  });
  document.getElementById("quiz").onclick = () => startQuiz(les);
  document.getElementById("back").onclick = renderList;
  window.scrollTo(0, 0);
}

// Word indices (in the original sentence) covered by the span.
function spanWords(text, span) {
  const { tokens } = tokenize(text);
  const sp = tokenize(span).tokens.map((x) => x.t);
  for (let i = 0; i + sp.length <= tokens.length; i++) {
    if (sp.every((s, k) => tokens[i + k].t === s)) return new Set(tokens.slice(i, i + sp.length).map((x) => x.w));
  }
  return new Set();
}

function startQuiz(les) {
  const items = shuffle(les.quiz.map((q, i) => ({ q, i, speaker: pick(data.speakers) })));
  const s = { les, items, k: 0, correct: 0 };
  showQuestion(s);
}

function showQuestion(s) {
  const item = s.items[s.k];
  const { words } = tokenize(item.q.text);
  const blanks = spanWords(item.q.text, item.q.span);
  const path = quizPath(s.les.id, item.i, item.speaker);

  app.innerHTML = `
    <div class="progress muted small">
      <span>${esc(s.les.title)}・確認問題</span>
      <span>${s.k + 1} / ${s.items.length}</span>
    </div>
    <div class="meter" aria-hidden="true"><span style="width:${((s.k / s.items.length) * 100).toFixed(1)}%"></span></div>
    <p style="text-align:center;margin-top:12px">音声を聞いて、空欄の語を入力してください</p>
    <button class="play" type="button" id="replay" aria-label="もう一度聞く">▶</button>
    <p class="dict-words" style="text-align:center">${words.map((w, wi) => (blanks.has(wi) ? `<span class="blank">${"＿".repeat(3)}</span>` : esc(w))).join(" ")}</p>
    <input id="answer" type="text" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="空欄の語（例：want to）">
    <div id="feedback"></div>
    <div id="actions"><button class="btn primary" type="button" id="check">答え合わせ</button></div>
    <button class="btn" type="button" id="quit">中断する</button>
  `;
  play(path);
  document.getElementById("replay").onclick = () => play(path);
  document.getElementById("quit").onclick = () => renderLesson(s.les.id);
  document.getElementById("check").onclick = () => {
    const typed = tokenize(document.getElementById("answer").value).tokens.map((x) => x.t);
    const want = tokenize(item.q.span).tokens.map((x) => x.t);
    const ok = typed.length === want.length && want.every((w, i) => eq(w, typed[i]));
    if (ok) s.correct++;
    document.getElementById("answer").readOnly = true;
    document.getElementById("feedback").innerHTML = `
      <div class="feedback">
        <div class="mark ${ok ? "ok" : "ng"}">${ok ? "○ 正解" : "× 不正解"}</div>
        <div>${words.map((w, wi) => (blanks.has(wi) ? `<strong class="hl-word">${esc(w)}</strong>` : esc(w))).join(" ")}</div>
        <div class="muted small">${esc(item.q.ja)}</div>
      </div>
    `;
    const last = s.k + 1 >= s.items.length;
    document.getElementById("actions").innerHTML = `
      <div class="row">
        <button class="btn" type="button" id="again">▶ もう一度聞く</button>
        <button class="btn primary" type="button" id="next">${last ? "結果を見る" : "次へ"}</button>
      </div>`;
    document.getElementById("again").onclick = () => play(path);
    document.getElementById("next").onclick = () => {
      s.k++;
      if (s.k < s.items.length) showQuestion(s);
      else finishQuiz(s);
    };
  };
}

async function finishQuiz(s) {
  await db.addTrial({ mode: "connected", date: new Date().toISOString(), lesson: s.les.id, correct: s.correct, n: s.items.length });
  app.innerHTML = `
    <h1>${esc(s.les.title)}：結果</h1>
    <section class="card">
      <div class="stat">${pct(s.correct, s.items.length)}%</div>
      <p class="muted">${s.correct} / ${s.items.length} 問正解</p>
    </section>
    <button class="btn primary" type="button" id="retry">もう一度挑戦する</button>
    <button class="btn" type="button" id="lesson">解説に戻る</button>
    <button class="btn" type="button" id="list">音の変化の一覧へ</button>
  `;
  document.getElementById("retry").onclick = () => startQuiz(s.les);
  document.getElementById("lesson").onclick = () => renderLesson(s.les.id);
  document.getElementById("list").onclick = renderList;
}
