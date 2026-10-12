import * as db from "./db.js";
import { GUIDES, mouthFigure, frontFigure } from "./guides.js";
import { esc, pick, pct, shuffle, fmtDuration, fmtDate, toast } from "./util.js";
import { stopAll, loadAudio as loadPath, play as playPath } from "./audio.js";
import * as dictation from "./dictation.js";
import * as connected from "./connected.js";
import * as shadowing from "./shadowing.js";
import * as extensive from "./extensive.js";
import * as progress from "./progress.js";
import * as stress from "./stress.js";
import * as reading from "./reading.js";
import * as vocab from "./vocab.js";
import { normalizeTest, testKind, lastTrainingDate } from "./metrics.js";

const TRAIN_TRIALS = 50;
const TEST_TRIALS_PER_GROUP = 20;   // new words + trained words, both with unseen talkers
const GOAL_HOURS = 15;              // Bradlow et al. trained /r/–/l/ for 15–22.5 h in total
const MAX_STEP_MS = 20000;          // cap per step so idle time is not counted as training
const AUDIO_CACHE = "audio-v1";

const LEVELS = [
  { n: 1, name: "入門", desc: "上位1,000語・ゆっくり" },
  { n: 2, name: "初級", desc: "上位2,000語" },
  { n: 3, name: "初中級", desc: "上位3,000語" },
  { n: 4, name: "中級", desc: "上位4,000語" },
  { n: 5, name: "中上級", desc: "4,000語超" },
];

// Spec 5: which practice to weight at each level (shadowing helps lower levels most).
const RECOMMENDED = {
  1: ["hvpt", "shadowing", "reading"],
  2: ["hvpt", "shadowing", "rhythm", "reading"],
  3: ["hvpt", "dictation", "connected", "rhythm"],
  4: ["dictation", "connected", "extensive"],
  5: ["extensive", "dictation"],
};

const EVIDENCE = {
  "◎": "複数の研究で効果を確認",
  "○": "研究で効果の報告あり（小規模）",
  "※": "一般的な知見（直接の研究は未確認）",
};

const app = document.getElementById("app");
let contrasts = [];            // index (without pairs)
const manifests = {};          // id -> manifest with pairs
let manifest = null;           // contrast currently being practised
const trainingMs = {};         // id -> ms

// ---------- utilities ----------

const totalMs = () => Object.values(trainingMs).reduce((a, b) => a + b, 0);

// Records made before multiple contrasts existed used r/l field names.

async function testsFor(id) {
  return (await db.allTests()).map(normalizeTest).filter((t) => t.contrast === id);
}

function audioPath(m, word, speaker) {
  return m.audio.replace("{word}", word).replace("{speaker}", speaker);
}

const loadAudio = (word, speaker) => loadPath(audioPath(manifest, word, speaker));
const play = (word, speaker) => playPath(audioPath(manifest, word, speaker));

async function addTrainingTime(ms) {
  const id = manifest.id;
  trainingMs[id] = (trainingMs[id] || 0) + Math.max(0, Math.min(ms, MAX_STEP_MS));
  await db.set(`trainingMs:${id}`, trainingMs[id]);
}

// ---------- home ----------

async function renderHome() {
  const level = await db.get("level", null);
  const tests = (await db.allTests()).map(normalizeTest);
  const lastFor = (id) => tests.filter((t) => t.contrast === id).pop();

  const rec = new Set(RECOMMENDED[level] || []);
  const badge = (key) => (rec.has(key) ? `<span class="badge">あなたのレベルにおすすめ</span>` : "");

  app.innerHTML = `
    <h1>英語の耳トレ</h1>

    <section class="card">
      <h2>レベル</h2>
      <select id="level" aria-label="レベル">
        <option value="" ${level ? "" : "selected"} disabled>選んでください</option>
        ${LEVELS.map((l) => `<option value="${l.n}" ${l.n === level ? "selected" : ""}>レベル${l.n}：${l.name}（${l.desc}）</option>`).join("")}
      </select>
      <p class="muted small" style="margin-top:8px">レベルによって、おすすめの練習・書き取りの文の難しさ・再生速度の初期値が変わります。</p>
    </section>

    <section class="card">
      ${badge("rhythm")}
      <h2>リズムと強勢</h2>
      <p class="muted small">英語の「強・弱」のリズムを聞き取る練習です。単語の強い音節を聞き分け、文の中で強く読まれる語を聞き取ります。</p>
      <button class="btn" type="button" id="go-rhythm">リズムと強勢を練習する</button>
    </section>

    <section class="card">
      ${badge("connected")}
      <h2>音の変化の学習</h2>
      <p class="muted small">音がつながる・弱くなる・消えるなど、文の中で音が変わるルールを、聞き比べと確認問題で学びます。</p>
      <button class="btn" type="button" id="go-connected">音の変化を学ぶ</button>
    </section>

    <section class="card">
      ${badge("dictation")}
      <h2>書き取り（弱点診断）</h2>
      <p class="muted small">文を聞いて書き取り、聞き取れなかった原因（音の変化・弱く発音される語・音の混同・知らない単語）を調べます。</p>
      <button class="btn" type="button" id="go-dictation">書き取りをする（10文）</button>
      <button class="btn" type="button" id="go-weakness">弱点のまとめを見る</button>
    </section>

    <section class="card">
      ${badge("shadowing")}
      <h2>シャドーイング</h2>
      <p class="muted small">短い文章を、内容理解 → 見ながら読む → 見ないで追いかける、の3ステップで練習します。</p>
      <button class="btn" type="button" id="go-shadowing">シャドーイングをする</button>
    </section>

    <section class="card">
      ${badge("reading")}
      <h2>聞き読み（物語）</h2>
      <p class="muted small">絵本の読み聞かせのように、文字を見ながら短い物語を聞きます。多聴の入門にもなります。</p>
      <button class="btn" type="button" id="go-reading">物語を聞く</button>
    </section>

    <section class="card">
      ${badge("extensive")}
      <h2>多聴</h2>
      <p class="muted small">やさしい英語をたくさん聞いて、聞いてすぐ分かる「慣れ」を育てます。聞いた時間と理解度を記録します。</p>
      <button class="btn" type="button" id="go-extensive">多聴をする</button>
    </section>

    <section class="card">
      ${badge("hvpt")}
      <h2>音の聞き分け訓練</h2>
      <p class="muted small">日本語話者が聞き分けにくい音のペアです。迷ったら、研究の根拠が最も強い /r/ と /l/ から始めましょう。</p>
      ${contrasts.map((c) => {
        const last = lastFor(c.id);
        return `
        <button class="btn contrast" type="button" data-contrast="${esc(c.id)}">
          <span class="contrast-title">${esc(c.title)}</span>
          <span class="muted small">根拠 ${esc(c.evidence)}・訓練 ${fmtDuration(trainingMs[c.id] || 0)}${last ? `・テスト ${pct(last.correct, last.n)}%` : "・テスト未受験"}</span>
        </button>`;
      }).join("")}
      <p class="muted small">累計の訓練時間（全ての音）：${fmtDuration(totalMs())}</p>
    </section>

    <button class="btn primary" type="button" data-nav="progress">聞き取り力のカルテ（成績と変化）</button>
    <div class="row">
      <button class="btn" type="button" data-nav="records">記録とデータ</button>
      <button class="btn" type="button" data-nav="about">このアプリについて</button>
    </div>
  `;

  document.getElementById("level").onchange = async (e) => {
    await db.set("level", Number(e.target.value));
    renderHome();
  };
  document.getElementById("go-connected").onclick = () => connected.renderList();
  document.getElementById("go-shadowing").onclick = () => shadowing.renderList();
  document.getElementById("go-extensive").onclick = () => extensive.render();
  document.getElementById("go-rhythm").onclick = () => stress.renderMenu();
  document.getElementById("go-reading").onclick = () => reading.renderList();
  document.getElementById("go-dictation").onclick = () => dictation.start();
  document.getElementById("go-weakness").onclick = () => dictation.renderWeakness();
  app.querySelectorAll("[data-contrast]").forEach((btn) => {
    btn.onclick = () => renderContrast(btn.dataset.contrast);
  });
}

// ---------- contrast menu ----------

async function renderContrast(id) {
  manifest = manifests[id];
  await db.set("lastContrast", id);
  const tests = await testsFor(id);
  const first = tests[0];
  const last = tests[tests.length - 1];
  const ms = trainingMs[id] || 0;
  const progress = Math.min(100, (ms / (GOAL_HOURS * 3600000)) * 100);

  app.innerHTML = `
    <h1>${esc(manifest.title)} の聞き分け</h1>

    <section class="card">
      <p class="small"><strong>根拠 ${esc(manifest.evidence)}</strong>：${esc(EVIDENCE[manifest.evidence] || "")}</p>
      <p class="muted small">${esc(manifest.note)}</p>
      ${manifest.qaNote ? `<p class="small qa-note">${esc(manifest.qaNote)}</p>` : ""}
    </section>

    <section class="card">
      <h2>訓練時間</h2>
      <div class="stat">${fmtDuration(ms)}</div>
      <div class="meter" aria-hidden="true"><span style="width:${progress.toFixed(1)}%"></span></div>
      <p class="muted small">目安：合計${GOAL_HOURS}時間（/r/ と /l/ の研究では15〜22.5時間の訓練で効果が確認されています）</p>
    </section>

    <section class="card">
      <h2>テスト結果</h2>
      ${last ? `
        <p>最新（${esc(last.kind)}・${fmtDate(last.date)}）：<strong>${pct(last.correct, last.n)}%</strong></p>
        ${tests.length > 1 ? `<p class="muted">初回（事前）：${pct(first.correct, first.n)}% → 最新：${pct(last.correct, last.n)}%</p>` : ""}
      ` : `<p>まず<strong>事前テスト</strong>を受けて、今の力を測りましょう。</p>`}
    </section>

    <button class="btn primary" type="button" id="go-train">訓練する（${TRAIN_TRIALS}問・約10分）</button>
    <button class="btn ${last ? "" : "primary"}" type="button" id="go-test">${last ? "テストを受ける" : "事前テストを受ける"}（${TEST_TRIALS_PER_GROUP * 2}問・約5分）</button>
    ${GUIDES[id] ? `<button class="btn" type="button" id="go-guide">聞き取りのコツと口の形</button>` : ""}
    <button class="btn" type="button" data-nav="home">ホームへ</button>
  `;

  document.getElementById("go-train").onclick = startTraining;
  document.getElementById("go-test").onclick = startTest;
  if (GUIDES[id]) document.getElementById("go-guide").onclick = () => renderGuide(id);
}

// ---------- guide (listening tips + mouth diagrams) ----------

function renderGuide(id) {
  manifest = manifests[id];
  const g = GUIDES[id];
  app.innerHTML = `
    <h1>${esc(manifest.title)}：聞き取りのコツと口の形</h1>

    <section class="card">
      <p>${g.summary}</p>
    </section>

    <section class="card">
      <h2>聞き取りのコツ</h2>
      <ul>${g.listen.map((t) => `<li>${t}</li>`).join("")}</ul>
    </section>

    <section class="card">
      <h2>口と舌の形</h2>
      <p class="muted small">上は横から見た図（左が顔の前）、下は正面から見た図です。ふだんの位置から、発音するときの形へ動きます。</p>
      <div class="figures">
        ${g.sounds.map((s) => `
          <figure>
            <figcaption>${esc(s.label)}</figcaption>
            <span class="view-label">横から</span>
            ${mouthFigure(s.posture, s.label)}
            <span class="view-label">正面から</span>
            ${frontFigure(s.posture, s.label)}
          </figure>`).join("")}
      </div>
      ${g.sounds.map((s) => `
        <h2 style="margin-top:12px">${esc(s.label)} の出し方</h2>
        <ul>${s.points.map((t) => `<li>${t}</li>`).join("")}</ul>
        <p class="small"><strong>正面から見ると：</strong>${s.front}</p>`).join("")}
    </section>

    <section class="card">
      <h2>例を聞いてみる</h2>
      <p class="muted small">押すたびに違う話者の声で再生します。</p>
      ${g.examples.map(([a, b]) => `
        <div class="row">
          <button class="btn" type="button" data-word="${esc(a)}">▶ ${esc(a)}</button>
          <button class="btn" type="button" data-word="${esc(b)}">▶ ${esc(b)}</button>
        </div>`).join("")}
    </section>

    <section class="card">
      <p class="muted small">発音の仕組みの説明は、一般的な音声学の知見に基づいています。解説を読むだけで聞き取りが伸びるという研究上の根拠は限られているため、訓練と組み合わせて使ってください。図は分かりやすくした模式図で、実際の形を正確に表したものではありません。</p>
    </section>

    <button class="btn primary" type="button" id="go-train">この音を訓練する</button>
    <button class="btn" type="button" id="back">${esc(manifest.title)} のメニューへ</button>
  `;

  app.querySelectorAll("[data-word]").forEach((btn) => {
    btn.onclick = () => play(btn.dataset.word, pick(manifest.speakers.train));
  });
  document.getElementById("go-train").onclick = startTraining;
  document.getElementById("back").onclick = () => renderContrast(id);
  window.scrollTo(0, 0);
}

// ---------- shared trial screen ----------

function trialHtml(s, trial) {
  const { pair } = trial;
  return `
    <div class="progress muted small">
      <span>${esc(manifest.title)}・${s.mode === "train" ? "訓練" : "テスト（正誤は最後に表示）"}</span>
      <span>${s.i + 1} / ${s.items.length}</span>
    </div>
    <div class="meter" aria-hidden="true"><span style="width:${((s.i / s.items.length) * 100).toFixed(1)}%"></span></div>
    <p style="text-align:center;margin-top:12px">音を聞いて、聞こえた単語を選んでください</p>
    <button class="play" type="button" id="replay" aria-label="もう一度聞く">▶</button>
    <div class="row">
      ${["a", "b"].map((side) => `
        <button class="btn answer" type="button" data-side="${side}">
          ${esc(pair[side])}<span class="gloss">${esc(pair["ja_" + side])}</span>
        </button>`).join("")}
    </div>
    <div id="feedback"></div>
    <button class="btn" type="button" id="quit">中断する</button>
  `;
}

function showTrial(s) {
  const trial = s.items[s.i];
  trial.replays = 0;
  trial.answer = null;
  app.innerHTML = trialHtml(s, trial);
  trial.shownAt = Date.now();
  play(trial.pair[trial.side], trial.speaker);

  // prefetch the next item so its playback starts without delay
  const next = s.items[s.i + 1];
  if (next) loadAudio(next.pair[next.side], next.speaker);

  document.getElementById("replay").onclick = () => {
    trial.replays++;
    play(trial.pair[trial.side], trial.speaker);
  };
  document.getElementById("quit").onclick = () => s.onQuit(trial);
  app.querySelectorAll(".answer").forEach((btn) => {
    btn.onclick = () => {
      if (trial.answer) return;
      trial.answer = btn.dataset.side;
      trial.answeredAt = Date.now();
      s.onAnswer(trial);
    };
  });
}

function trialRecord(mode, trial) {
  return {
    mode,
    contrast: manifest.id,
    date: new Date(trial.answeredAt).toISOString(),
    a: trial.pair.a,
    b: trial.pair.b,
    pos: trial.pair.pos,
    set: trial.pair.set,
    speaker: trial.speaker,
    target: trial.side,
    answer: trial.answer,
    correct: trial.answer === trial.side,
    rtMs: trial.answeredAt - trial.shownAt,
    replays: trial.replays,
  };
}

// ---------- training (HVPT: many talkers, 2AFC, immediate feedback) ----------

function buildTrainingItems() {
  const pairs = manifest.pairs.filter((p) => p.set === "train");
  const sides = shuffle(Array.from({ length: TRAIN_TRIALS }, (_, i) => (i % 2 ? "a" : "b")));
  const items = [];
  for (let i = 0; i < TRAIN_TRIALS; i++) {
    let pair;
    do pair = pick(pairs); while (items.length && pair === items[items.length - 1].pair);
    items.push({ pair, side: sides[i], speaker: pick(manifest.speakers.train) });
  }
  return items;
}

function startTraining() {
  const s = { mode: "train", items: buildTrainingItems(), i: 0, correct: 0 };

  s.onAnswer = async (trial) => {
    const ok = trial.answer === trial.side;
    if (ok) s.correct++;
    await db.addTrial(trialRecord("train", trial));
    await addTrainingTime(trial.answeredAt - trial.shownAt);

    app.querySelectorAll(".answer").forEach((btn) => {
      if (btn.dataset.side === trial.side) btn.classList.add("correct");
      else if (btn.dataset.side === trial.answer) btn.classList.add("wrong");
      btn.disabled = true;
    });
    const { pair, speaker } = trial;
    document.getElementById("feedback").innerHTML = `
      <div class="feedback">
        <div class="mark ${ok ? "ok" : "ng"}">${ok ? "○ 正解" : "× 不正解"}</div>
        <div>正解は <strong>${esc(pair[trial.side])}</strong>（${esc(pair["ja_" + trial.side])}）</div>
      </div>
      <p class="muted small" style="text-align:center">同じ話者で聞き比べ</p>
      <div class="row">
        <button class="btn" type="button" data-compare="a">▶ ${esc(pair.a)}</button>
        <button class="btn" type="button" data-compare="b">▶ ${esc(pair.b)}</button>
      </div>
      <button class="btn primary" type="button" id="next">次へ</button>
    `;
    app.querySelectorAll("[data-compare]").forEach((btn) => {
      btn.onclick = () => play(pair[btn.dataset.compare], speaker);
    });
    if (!ok) play(pair[trial.side], speaker);   // let the learner hear the correct word again

    document.getElementById("next").onclick = async () => {
      await addTrainingTime(Date.now() - trial.answeredAt);
      s.i++;
      if (s.i < s.items.length) showTrial(s);
      else renderTrainingDone(s);
    };
  };

  s.onQuit = async (trial) => {
    if (trial.answer) await addTrainingTime(Date.now() - trial.answeredAt);
    renderTrainingDone(s);
  };

  showTrial(s);
}

function renderTrainingDone(s) {
  const done = s.i + (s.items[s.i] && s.items[s.i].answer ? 1 : 0);
  app.innerHTML = `
    <h1>訓練おつかれさまでした</h1>
    <section class="card">
      <p>今回の正答率（${esc(manifest.title)}）</p>
      <div class="stat">${pct(s.correct, done)}%</div>
      <p class="muted">${s.correct} / ${done} 問</p>
    </section>
    <section class="card">
      <p>この音の訓練時間</p>
      <div class="stat">${fmtDuration(trainingMs[manifest.id] || 0)}</div>
      <p class="muted small">目安の${GOAL_HOURS}時間まで、少しずつ続けましょう。</p>
    </section>
    <button class="btn primary" type="button" id="again">もう一度訓練する</button>
    <button class="btn" type="button" id="back">${esc(manifest.title)} のメニューへ</button>
    <button class="btn" type="button" data-nav="home">ホームへ</button>
  `;
  document.getElementById("again").onclick = startTraining;
  document.getElementById("back").onclick = () => renderContrast(manifest.id);
}

// ---------- test (no feedback; unseen talkers; new + trained words) ----------

function buildGroup(pairs, n, group) {
  const order = [];
  while (order.length < n) order.push(...shuffle(pairs));
  const sides = shuffle(Array.from({ length: n }, (_, i) => (i % 2 ? "a" : "b")));
  return order.slice(0, n).map((pair, i) => ({ pair, side: sides[i], speaker: pick(manifest.speakers.test), group }));
}

async function startTest() {
  const testPairs = manifest.pairs.filter((p) => p.set === "test");
  const trainPairs = manifest.pairs.filter((p) => p.set === "train");
  const items = shuffle([
    ...buildGroup(testPairs, TEST_TRIALS_PER_GROUP, "new"),
    ...buildGroup(trainPairs, TEST_TRIALS_PER_GROUP, "trained"),
  ]);
  const previous = await testsFor(manifest.id);
  const lastTraining = lastTrainingDate(await db.allTrials(), "train", manifest.id);
  const s = { mode: "test", items, i: 0, kind: testKind(previous.map((t) => t.date), lastTraining), lastTraining };

  s.onAnswer = async (trial) => {
    await db.addTrial({ ...trialRecord("test", trial), group: trial.group });
    app.querySelectorAll(".answer").forEach((btn) => (btn.disabled = true));
    setTimeout(() => {
      s.i++;
      if (s.i < s.items.length) showTrial(s);
      else finishTest(s);
    }, 300);
  };

  s.onQuit = () => {
    if (confirm("テストを中断しますか？（テスト結果としては記録されません）")) renderContrast(manifest.id);
  };

  app.innerHTML = `
    <h1>${esc(manifest.title)}：${s.kind}テスト</h1>
    <section class="card">
      <ul>
        <li>全${items.length}問。正解・不正解はテストの最後に表示します。</li>
        <li>訓練では出てこない<strong>話者の声</strong>を使います。</li>
        <li>半分は訓練で<strong>使わない単語</strong>です（初めて聞く単語にも力が広がったかを測ります）。</li>
        <li>静かな場所で、イヤホンの使用をおすすめします。</li>
      </ul>
    </section>
    <button class="btn primary" type="button" id="begin">始める</button>
    <button class="btn" type="button" id="back">戻る</button>
  `;
  document.getElementById("begin").onclick = () => showTrial(s);
  document.getElementById("back").onclick = () => renderContrast(manifest.id);
}

async function finishTest(s) {
  const score = (filter) => {
    const xs = s.items.filter(filter);
    return { n: xs.length, correct: xs.filter((t) => t.answer === t.side).length };
  };
  const all = score(() => true);
  const result = {
    date: new Date().toISOString(),
    kind: s.kind,
    contrast: manifest.id,
    ...all,
    newWords: score((t) => t.group === "new"),
    trainedWords: score((t) => t.group === "trained"),
    aTarget: score((t) => t.side === "a"),
    bTarget: score((t) => t.side === "b"),
    trainingMsAtTest: trainingMs[manifest.id] || 0,
    lastTrainingAtTest: s.lastTraining,
    audioVersion: manifest.audioVersion || 1,
  };
  await db.addTest(result);
  // compare only with tests that used the same audio
  const tests = (await testsFor(manifest.id)).filter((t) => (t.audioVersion || 1) === result.audioVersion);
  const first = tests[0];
  const { labels } = manifest;

  const line = (label, x, base) => `
    <tr><td>${label}</td><td class="num">${pct(x.correct, x.n)}%</td>
    <td class="num muted">${base && tests.length > 1 ? `${pct(base.correct, base.n)}%` : "–"}</td></tr>`;

  app.innerHTML = `
    <h1>${esc(manifest.title)}：${esc(s.kind)}テストの結果</h1>
    <section class="card">
      <div class="stat">${pct(all.correct, all.n)}%</div>
      <p class="muted">${all.correct} / ${all.n} 問正解</p>
      <table>
        <thead><tr><th></th><th class="num">今回</th><th class="num">初回</th></tr></thead>
        <tbody>
          ${line("初めての単語（初めての声）", result.newWords, first.newWords)}
          ${line("訓練した単語（初めての声）", result.trainedWords, first.trainedWords)}
          ${line(`${esc(labels.a)} が正解の問題`, result.aTarget, first.aTarget)}
          ${line(`${esc(labels.b)} が正解の問題`, result.bTarget, first.bTarget)}
        </tbody>
      </table>
      <p class="muted small" style="margin-top:8px">テストはすべて訓練で使わない声です。2択なので、当てずっぽうでも約50%になります。問題数が少ないため、数問の違いで数%〜十数%動きます。変化の見方は「聞き取り力のカルテ」で確認できます。</p>
    </section>
    <button class="btn primary" type="button" id="back">${esc(manifest.title)} のメニューへ</button>
    <button class="btn" type="button" data-nav="home">ホームへ</button>
  `;
  document.getElementById("back").onclick = () => renderContrast(manifest.id);
}

// ---------- records & data ----------

async function renderRecords() {
  const tests = (await db.allTests()).map(normalizeTest);
  const titleOf = (id) => (manifests[id] ? manifests[id].title : id);
  app.innerHTML = `
    <h1>記録とデータ</h1>
    <section class="card">
      <h2>テストの記録</h2>
      ${tests.length ? `
        <table>
          <thead><tr><th>日時</th><th>音</th><th class="num">全体</th><th class="num">初めて</th><th class="num">訓練済</th></tr></thead>
          <tbody>${tests.map((t) => `
            <tr><td>${fmtDate(t.date)}<br><span class="muted small">${esc(t.kind)}</span></td><td>${esc(titleOf(t.contrast))}</td>
            <td class="num">${pct(t.correct, t.n)}%</td>
            <td class="num">${pct(t.newWords.correct, t.newWords.n)}%</td>
            <td class="num">${pct(t.trainedWords.correct, t.trainedWords.n)}%</td></tr>`).join("")}
          </tbody>
        </table>` : `<p class="muted">まだテストの記録はありません。</p>`}
      <h2 style="margin-top:14px">訓練時間</h2>
      <table><tbody>
        ${contrasts.map((c) => `<tr><td>${esc(c.title)}</td><td class="num">${fmtDuration(trainingMs[c.id] || 0)}</td></tr>`).join("")}
        <tr><td><strong>合計</strong></td><td class="num"><strong>${fmtDuration(totalMs())}</strong></td></tr>
      </tbody></table>
    </section>

    <section class="card">
      <h2>オフラインで使う</h2>
      <p class="muted small">全ての音声（約42MB）をこの端末に保存します。Wi-Fi 接続時をおすすめします。</p>
      <button class="btn" type="button" id="offline">全ての音声を保存する</button>
      <p class="muted small" id="offline-status"></p>
    </section>

    <section class="card">
      <h2>バックアップ</h2>
      <p class="muted small">学習記録はこの端末の中だけに保存されています。機種変更の前などに書き出してください。書き出したファイルには学習記録が含まれるので、取り扱いに注意してください。</p>
      <button class="btn" type="button" id="export">記録を書き出す</button>
      <label class="btn" style="text-align:center">記録を読み込む<input type="file" id="import" accept="application/json,.json" hidden></label>
      <button class="btn danger" type="button" id="wipe">全ての記録を削除する</button>
    </section>

    <button class="btn" type="button" data-nav="home">ホームへ</button>
  `;

  document.getElementById("offline").onclick = downloadAllAudio;
  document.getElementById("export").onclick = exportData;
  document.getElementById("import").onchange = importData;
  document.getElementById("wipe").onclick = async () => {
    if (!confirm("全ての学習記録を削除します。元に戻せません。よろしいですか？")) return;
    await db.clearAll();
    for (const id of Object.keys(trainingMs)) trainingMs[id] = 0;
    toast("削除しました");
    renderRecords();
  };
}

async function downloadAllAudio() {
  const status = document.getElementById("offline-status");
  const button = document.getElementById("offline");
  if (!("caches" in window)) {
    status.textContent = "このブラウザでは保存できません。";
    return;
  }
  button.disabled = true;
  const paths = Object.values(manifests).flatMap((m) => {
    const speakers = [...m.speakers.train, ...m.speakers.test];
    return m.pairs.flatMap((p) => [p.a, p.b]).flatMap((w) => speakers.map((sp) => audioPath(m, w, sp)));
  });
  paths.push(...dictation.audioPaths(), ...connected.audioPaths(), ...shadowing.audioPaths(), ...stress.audioPaths(), ...reading.audioPaths());
  const cache = await caches.open(AUDIO_CACHE);
  let done = 0;
  let failed = 0;
  const queue = paths.slice();
  const worker = async () => {
    while (queue.length) {
      const path = queue.shift();
      try {
        if (!(await cache.match(path))) {
          const res = await fetch(path);
          if (!res.ok) throw new Error(res.status);
          await cache.put(path, res);
        }
      } catch {
        failed++;
      }
      done++;
      if (done % 20 === 0 || done === paths.length) status.textContent = `保存中… ${done} / ${paths.length}`;
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  status.textContent = failed ? `${failed}件の保存に失敗しました。通信状態を確認して、もう一度お試しください。` : `保存しました（${paths.length}件）`;
  button.disabled = false;
}

async function exportData() {
  const data = await db.exportAll();
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
  const a = document.createElement("a");
  const d = new Date();
  a.href = URL.createObjectURL(blob);
  a.download = `mimi-tore-backup-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importData(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (!confirm("今の記録は、読み込むファイルの内容で置き換えられます。よろしいですか？")) return;
  try {
    await db.importAll(JSON.parse(await file.text()));
    await loadTrainingTimes();
    toast("読み込みました");
    renderRecords();
  } catch (err) {
    toast(`読み込めませんでした：${err.message}`);
  }
}

// ---------- about ----------

function renderAbout() {
  app.innerHTML = `
    <h1>このアプリについて</h1>
    <section class="card">
      <h2>練習方法の根拠</h2>
      <p>日本語話者が聞き分けにくい英語の音を、<strong>HVPT（High Variability Phonetic Training）</strong>という方法で練習します。</p>
      <ul>
        <li>多くの話者の声で、2つの単語から聞こえた方を選び、すぐに正解を確認します。</li>
        <li>/r/ と /l/ では、この方法で日本人学習者の聞き分けが向上し、訓練していない単語にも効果が広がり、数か月後も保たれたことが報告されています（Logan, Lively &amp; Pisoni 1991；Bradlow et al. 1997, 1999 など）。</li>
        <li>テストでは、訓練で使わない話者と単語も使い、効果が広がったかを確かめます。</li>
      </ul>
      <p class="small">各音の「根拠」の記号：</p>
      <ul class="small">
        ${Object.entries(EVIDENCE).map(([k, v]) => `<li>${k}：${v}</li>`).join("")}
      </ul>
      <p class="muted small">注意：研究の多くは人間の録音を使っています。このアプリの音声は音声合成（TTS）で作っており、同じ効果が出るかの直接の根拠はまだ少ないため、テストで伸びを確認しながら進めてください。</p>
    </section>
    <section class="card">
      <h2>プライバシー</h2>
      <p class="small">学習記録はこの端末の中だけに保存され、外部へは送信されません。アクセス解析や広告も使っていません。</p>
      <p class="small">シャドーイングの録音は、その画面を開いている間だけ端末のメモリに置かれ、画面を離れると消えます。保存も送信もしません。</p>
    </section>
    <section class="card">
      <h2>クレジット</h2>
      <p class="small">音声は <a href="https://github.com/OHF-Voice/piper1-gpl">Piper</a>（音声モデル en_US-libritts_r-medium）で合成しました。音声モデルの学習データは LibriTTS-R（Koizumi et al., 2023, CC BY 4.0）です。</p>
      <p class="small">単語の頻度データは <a href="https://www.newgeneralservicelist.com/">New General Service List 1.2</a>（Browne, C., Culligan, B., &amp; Phillips, J.）を使用しています。ライセンスは <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a> で、このアプリ内の加工した単語データ（data/ngsl.json）も同じライセンスで提供します。</p>
      <p class="small">フォントは <a href="fonts/OFL.txt">Noto Sans JP</a>（SIL Open Font License 1.1）を、このアプリの中に置いて使っています（外部のサーバーには接続しません）。</p>
    </section>
    <button class="btn" type="button" data-nav="home">ホームへ</button>
  `;
}

// ---------- boot ----------

const routes = { home: renderHome, records: renderRecords, about: renderAbout, progress: () => progress.render() };

document.addEventListener("click", (e) => {
  const nav = e.target.closest("[data-nav]");
  if (!nav) return;
  stopAll();
  shadowing.cleanup();
  extensive.cleanup();
  stress.cleanup();
  routes[nav.dataset.nav]();
  window.scrollTo(0, 0);
});

// Every screen is drawn by replacing #app's children; start each new screen at the top.
// (Partial updates inside a screen change deeper nodes and do not trigger this.)
new MutationObserver(() => window.scrollTo(0, 0)).observe(app, { childList: true });

async function loadTrainingTimes() {
  // Before multiple contrasts existed, /r/–/l/ time was stored under "trainingMs".
  const legacy = await db.get("trainingMs", 0);
  if (legacy && (await db.get("trainingMs:rl", null)) === null) {
    await db.set("trainingMs:rl", legacy);
    await db.set("trainingMs", 0);
  }
  for (const c of contrasts) trainingMs[c.id] = await db.get(`trainingMs:${c.id}`, 0);
}

async function boot() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  try {
    contrasts = (await (await fetch("data/contrasts.json")).json()).contrasts;
    const loaded = await Promise.all(contrasts.map((c) => fetch(`data/${c.id}.json`).then((r) => r.json())));
    for (const m of loaded) manifests[m.id] = m;
    const [dictData, csData, shData, elData, stData, rhData, chData, storyData, ngsl] = await Promise.all(
      ["data/dictation.json", "data/connected.json", "data/shadowing.json", "data/extensive.json", "data/stress.json",
        "data/rhythm.json", "data/chants.json", "data/stories.json", "data/ngsl.json"]
        .map((u) => fetch(u).then((r) => r.json())),
    );
    vocab.init(ngsl);
    stress.init(stData, rhData, chData);
    reading.init(storyData);
    extensive.init(elData, { openInternal: (id) => (id === "story" ? reading.renderList() : shadowing.renderList()) });
    progress.init({ contrasts, manifests });
    dictation.init({ data: dictData, manifests, openContrast: renderContrast, openLesson: connected.renderLesson, levels: LEVELS });
    connected.init(csData);
    shadowing.init(shData);
    await loadTrainingTimes();
    renderHome();
  } catch (e) {
    app.innerHTML = `<p>読み込みに失敗しました。通信状態を確認して、再読み込みしてください。</p>`;
  }
}

boot();
