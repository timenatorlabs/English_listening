// Rhythm & stress: word-stress identification (HVPT-style: many talkers,
// immediate feedback, test on new talkers/words) and sentence-rhythm practice
// (hear which words are strong).
import * as db from "./db.js";
import { esc, pct, pick, shuffle } from "./util.js";
import { play, loadAudio, player, stopAll } from "./audio.js";

const TRAIN_TRIALS = 30;
const TEST_PER_GROUP = 10;

const app = document.getElementById("app");
let words = null;    // stress.json
let rhythm = null;   // rhythm.json
let chants = null;   // chants.json
let raf = 0;

export function init(stressData, rhythmData, chantData) {
  words = stressData;
  rhythm = rhythmData;
  chants = chantData;
}

export function cleanup() {
  cancelAnimationFrame(raf);
}

const chantPath = (c, tempo) => chants.audio.replace("{id}", c.id).replace("{tempo}", tempo);
const CHANT_TRACKS = [
  { tempo: "normal", label: "▶ お手本" },
  { tempo: "slow", label: "▶ お手本（ゆっくり）" },
  { tempo: "normal_beat", label: "▶ 拍だけ（自分で言う）" },
  { tempo: "slow_beat", label: "▶ 拍だけ（ゆっくり）" },
];

const wordPath = (w, speaker) => words.audio.replace("{word}", w.word.toLowerCase()).replace("{speaker}", speaker);
const rhythmPath = (s, speaker) => rhythm.audio.replace("{id}", s.id).replace("{speaker}", speaker);
const slowPath = (s) => rhythm.slow.replace("{id}", s.id);

export function audioPaths() {
  const sp = [...words.speakers.train, ...words.speakers.test];
  return [
    ...words.words.flatMap((w) => sp.map((s) => wordPath(w, s))),
    ...rhythm.sentences.flatMap((s) => [...rhythm.speakers.map((v) => rhythmPath(s, v)), slowPath(s)]),
    ...chants.chants.flatMap((c) => CHANT_TRACKS.map((t) => chantPath(c, t.tempo))),
  ];
}

// "ba-NA-na": the stressed syllable in capitals
const stressedForm = (w) => w.syl.map((s, i) => (i === w.stress ? s.toUpperCase() : s.toLowerCase())).join("-");

function parseMarked(marked) {
  return marked.split(/\s+/).map((tok) => ({ text: tok.replace(/^\*/, ""), strong: tok.startsWith("*") }));
}

export async function testHistory() {
  return (await db.allTrials()).filter((t) => t.mode === "stress-test");
}

// ---------- menu ----------

export async function renderMenu() {
  const tests = await testHistory();
  const last = tests[tests.length - 1];
  app.innerHTML = `
    <h1>リズムと強勢</h1>
    <section class="card">
      <p class="small">英語は<strong>強く長い音節</strong>と<strong>弱く短い音節</strong>がくり返すリズムの言葉です。日本語のように、すべての拍を同じ長さで発音するのとは違います。</p>
      <ul class="small">
        <li>英語の聞き手は、<strong>強い音節</strong>を手がかりに単語の切れ目を見つけています（Cutler &amp; Norris 1988）。</li>
        <li>日本語の聞き手は拍（モーラ）で区切るため、英語でも同じ聞き方をしてしまい、速い英語で単語の切れ目を見失いやすくなります。</li>
        <li>強い音節は、<strong>長く・強く</strong>聞こえます。音の高さだけでなく、長さと強さに注目するのがコツです。</li>
      </ul>
      <p class="muted small">根拠：強勢の聞き取りは短い訓練で改善したという報告があります（日本人学習者115人、Hosaka &amp; Saito）。ただし、効果は訓練した単語が中心で、文全体の聞き取りが伸びるかの根拠はまだ限られています（○〜△）。</p>
    </section>

    <section class="card">
      <h2>単語の強勢</h2>
      <p class="muted small">単語を聞いて、どの音節が強いかを選びます。カタカナ語と強い位置が違う単語（hotel、banana など）を中心にしています。</p>
      ${last ? `<p class="small">最新のテスト：<strong>${pct(last.correct, last.n)}%</strong></p>` : `<p class="small">まず<strong>事前テスト</strong>で今の力を測りましょう。</p>`}
      <button class="btn primary" type="button" id="train">強勢の聞き分け訓練（${TRAIN_TRIALS}問）</button>
      <button class="btn" type="button" id="test">${last ? "テストを受ける" : "事前テストを受ける"}（${TEST_PER_GROUP * 2}問）</button>
    </section>

    <section class="card">
      <h2>文のリズム</h2>
      <p class="muted small">文を聞いて、強く読まれた語を選びます。強い語だけを拾えば、文の意味の骨組みがつかめることを体験します。</p>
      <button class="btn primary" type="button" id="rhythm">文のリズムを練習する</button>
    </section>

    <section class="card">
      <h2>チャンツ</h2>
      <p class="muted small">一定の拍に合わせて、短い文をリズムよく言う練習です。強い語を拍の上にのせ、弱い語は短く詰めて言います。</p>
      <button class="btn primary" type="button" id="chants">チャンツをする</button>
    </section>

    <button class="btn" type="button" data-nav="home">ホームへ</button>
  `;
  document.getElementById("train").onclick = startTraining;
  document.getElementById("test").onclick = startTest;
  document.getElementById("rhythm").onclick = renderRhythmList;
  document.getElementById("chants").onclick = renderChantList;
}

// ---------- chants ----------

function renderChantList() {
  cleanup();
  stopAll();
  app.innerHTML = `
    <h1>チャンツ</h1>
    <section class="card">
      <ol class="small">
        <li>「お手本」を聞いて、拍（カチッという音）と強い語が重なることを確かめます。</li>
        <li>お手本と一緒に声に出します。</li>
        <li>慣れたら「拍だけ」に合わせて、自分だけで言います。</li>
      </ol>
      <p class="muted small">根拠 △：チャンツは英語教育で使われている方法で、子どもの研究ではリズムへの敏感さと音の聞き取りの関係が報告されています（Goswami ほか）。ただし、大人のリスニングが伸びるかを直接確かめた研究は、今回の調査では見つかっていません。</p>
    </section>
    ${chants.chants.map((c) => `
      <button class="btn contrast" type="button" data-chant="${esc(c.id)}">
        <span class="contrast-title">${esc(c.title)}<span class="muted small">（${esc(c.ja_title)}）</span></span>
        <span class="muted small">レベル${c.level}</span>
      </button>`).join("")}
    <button class="btn" type="button" id="menu">リズムと強勢のメニューへ</button>
  `;
  app.querySelectorAll("[data-chant]").forEach((btn) => {
    btn.onclick = () => renderChant(chants.chants.find((c) => c.id === btn.dataset.chant));
  });
  document.getElementById("menu").onclick = renderMenu;
}

function chunkHtml(text) {
  if (text === "-") return `<span class="muted">（休み）</span>`;
  return text.split(/\s+/).map((w) => (w.includes("*") ? `<strong class="strong">${esc(w.replace(/\*/g, ""))}</strong>` : `<span class="weak">${esc(w)}</span>`)).join(" ");
}

function renderChant(c) {
  cleanup();
  stopAll();
  const lines = c.lines.map((ln) => ln.beats.split("|").map((x) => x.trim()));
  app.innerHTML = `
    <h1>${esc(c.title)}</h1>
    <div class="chant-buttons">
      ${CHANT_TRACKS.map((t) => `<button class="btn ${t.tempo === "normal" ? "primary" : ""}" type="button" data-track="${t.tempo}">${t.label}</button>`).join("")}
      <button class="btn" type="button" id="stop">■ 停止</button>
    </div>
    <section class="card chant">
      ${lines.map((chunks, li) => `
        <div class="chant-line">
          <div class="beats">${chunks.map((ch, ci) => `<span class="beat" data-beat="${li * 4 + ci}">${chunkHtml(ch)}</span>`).join("")}</div>
          <div class="muted small">${esc(c.lines[li].ja)}</div>
        </div>`).join("")}
    </section>
    <p class="muted small">最初に4拍のカウントがあります。音声合成の語を拍に合わせて並べているため、自然な話し方とは少し違います。</p>
    <button class="btn" type="button" id="back">チャンツの一覧へ</button>
  `;
  const beats = [...app.querySelectorAll("[data-beat]")];
  const mark = (n) => beats.forEach((b) => b.classList.toggle("now", Number(b.dataset.beat) === n));

  app.querySelectorAll("[data-track]").forEach((btn) => {
    btn.onclick = async () => {
      cleanup();
      const tempo = btn.dataset.track;
      const beat = 60 / chants.bpm[tempo.replace("_beat", "")];
      if (!(await play(chantPath(c, tempo)))) return;
      const tick = () => {
        // highlight slightly before the beat so the eye leads the voice
        const n = Math.floor((player.currentTime + 0.15) / beat) - chants.count_in;
        mark(n >= 0 && n < beats.length ? n : -1);
        if (!player.paused) raf = requestAnimationFrame(tick);
        else mark(-1);
      };
      raf = requestAnimationFrame(tick);
    };
  });
  document.getElementById("stop").onclick = () => {
    cleanup();
    stopAll();
    mark(-1);
  };
  document.getElementById("back").onclick = renderChantList;
}

// ---------- word stress: training & test ----------

function showWord(s) {
  const item = s.items[s.i];
  const w = item.w;
  item.answer = null;
  item.replays = 0;
  app.innerHTML = `
    <div class="progress muted small">
      <span>単語の強勢・${s.mode === "train" ? "訓練" : "テスト（正誤は最後に表示）"}</span>
      <span>${s.i + 1} / ${s.items.length}</span>
    </div>
    <div class="meter" aria-hidden="true"><span style="width:${((s.i / s.items.length) * 100).toFixed(1)}%"></span></div>
    <p style="text-align:center;margin-top:12px">どの音節が<strong>強く</strong>聞こえましたか？</p>
    <button class="play" type="button" id="replay" aria-label="もう一度聞く">▶</button>
    <div class="syllables">
      ${w.syl.map((syl, i) => `<button class="btn syl" type="button" data-syl="${i}">${esc(syl)}</button>`).join("")}
    </div>
    <div id="feedback"></div>
    <button class="btn" type="button" id="quit">中断する</button>
  `;
  play(wordPath(w, item.speaker));
  const next = s.items[s.i + 1];
  if (next) loadAudio(wordPath(next.w, next.speaker));
  document.getElementById("replay").onclick = () => {
    item.replays++;
    play(wordPath(w, item.speaker));
  };
  document.getElementById("quit").onclick = () => (s.mode === "train" ? finishTraining(s) : renderMenu());
  app.querySelectorAll("[data-syl]").forEach((btn) => {
    btn.onclick = () => {
      if (item.answer !== null) return;
      item.answer = Number(btn.dataset.syl);
      s.onAnswer(item);
    };
  });
}

function record(mode, item) {
  return db.addTrial({
    mode, date: new Date().toISOString(), word: item.w.word, set: item.w.set, group: item.group,
    speaker: item.speaker, target: item.w.stress, answer: item.answer, correct: item.answer === item.w.stress, replays: item.replays,
  });
}

function startTraining() {
  const pool = words.words.filter((w) => w.set === "train");
  const items = [];
  while (items.length < TRAIN_TRIALS) items.push(...shuffle(pool));
  const s = {
    mode: "train", i: 0, correct: 0,
    items: items.slice(0, TRAIN_TRIALS).map((w) => ({ w, speaker: pick(words.speakers.train) })),
  };
  s.onAnswer = async (item) => {
    const ok = item.answer === item.w.stress;
    if (ok) s.correct++;
    await record("stress", item);
    app.querySelectorAll("[data-syl]").forEach((btn) => {
      const i = Number(btn.dataset.syl);
      if (i === item.w.stress) btn.classList.add("correct");
      else if (i === item.answer) btn.classList.add("wrong");
      btn.disabled = true;
    });
    document.getElementById("feedback").innerHTML = `
      <div class="feedback">
        <div class="mark ${ok ? "ok" : "ng"}">${ok ? "○ 正解" : "× 不正解"}</div>
        <div class="stress-word">${esc(stressedForm(item.w))}</div>
        ${item.w.kata ? `<div class="muted small">カタカナの「${esc(item.w.kata)}」とは、強く読む位置が違うことがあります。</div>` : ""}
      </div>
      <div class="row">
        <button class="btn" type="button" id="again">▶ もう一度聞く</button>
        <button class="btn primary" type="button" id="next">次へ</button>
      </div>
    `;
    document.getElementById("again").onclick = () => play(wordPath(item.w, item.speaker));
    document.getElementById("next").onclick = () => {
      s.i++;
      if (s.i < s.items.length) showWord(s);
      else finishTraining(s);
    };
  };
  showWord(s);
}

function finishTraining(s) {
  const done = s.i + (s.items[s.i] && s.items[s.i].answer !== null ? 1 : 0);
  app.innerHTML = `
    <h1>訓練おつかれさまでした</h1>
    <section class="card">
      <p>今回の正答率</p>
      <div class="stat">${pct(s.correct, done)}%</div>
      <p class="muted">${s.correct} / ${done} 問</p>
    </section>
    <button class="btn primary" type="button" id="again">もう一度訓練する</button>
    <button class="btn" type="button" id="menu">リズムと強勢のメニューへ</button>
  `;
  document.getElementById("again").onclick = startTraining;
  document.getElementById("menu").onclick = renderMenu;
}

function testGroup(pool, n, group) {
  const order = [];
  while (order.length < n) order.push(...shuffle(pool));
  return order.slice(0, n).map((w) => ({ w, group, speaker: pick(words.speakers.test) }));
}

async function startTest() {
  const kind = (await testHistory()).length ? "事後" : "事前";
  const s = {
    mode: "test", i: 0, kind,
    items: shuffle([
      ...testGroup(words.words.filter((w) => w.set === "test"), TEST_PER_GROUP, "new"),
      ...testGroup(words.words.filter((w) => w.set === "train"), TEST_PER_GROUP, "trained"),
    ]),
  };
  s.onAnswer = async (item) => {
    await record("stress", item);
    app.querySelectorAll("[data-syl]").forEach((btn) => (btn.disabled = true));
    setTimeout(() => {
      s.i++;
      if (s.i < s.items.length) showWord(s);
      else finishTest(s);
    }, 300);
  };
  app.innerHTML = `
    <h1>単語の強勢：${kind}テスト</h1>
    <section class="card">
      <ul>
        <li>全${s.items.length}問。正解・不正解は最後に表示します。</li>
        <li>訓練では出てこない<strong>話者の声</strong>を使います。半分は訓練で<strong>使わない単語</strong>です。</li>
      </ul>
    </section>
    <button class="btn primary" type="button" id="begin">始める</button>
    <button class="btn" type="button" id="back">戻る</button>
  `;
  document.getElementById("begin").onclick = () => showWord(s);
  document.getElementById("back").onclick = renderMenu;
}

async function finishTest(s) {
  const score = (f) => {
    const xs = s.items.filter(f);
    return { n: xs.length, correct: xs.filter((x) => x.answer === x.w.stress).length };
  };
  const all = score(() => true);
  const chance = Math.round((s.items.reduce((a, x) => a + 1 / x.w.syl.length, 0) / s.items.length) * 100);
  const result = {
    mode: "stress-test", date: new Date().toISOString(), kind: s.kind, ...all,
    newWords: score((x) => x.group === "new"), trainedWords: score((x) => x.group === "trained"), chance,
  };
  await db.addTrial(result);
  app.innerHTML = `
    <h1>単語の強勢：${esc(s.kind)}テストの結果</h1>
    <section class="card">
      <div class="stat">${pct(all.correct, all.n)}%</div>
      <p class="muted">${all.correct} / ${all.n} 問正解</p>
      <table><tbody>
        <tr><td>初めての単語</td><td class="num">${pct(result.newWords.correct, result.newWords.n)}%</td></tr>
        <tr><td>訓練した単語</td><td class="num">${pct(result.trainedWords.correct, result.trainedWords.n)}%</td></tr>
      </tbody></table>
      <p class="muted small" style="margin-top:8px">当てずっぽうで答えた場合の正答率は約${chance}%です。</p>
    </section>
    <button class="btn primary" type="button" id="menu">リズムと強勢のメニューへ</button>
  `;
  document.getElementById("menu").onclick = renderMenu;
}

// ---------- sentence rhythm ----------

async function renderRhythmList() {
  const demo = rhythm.sentences.filter((s) => s.demo);
  const rest = rhythm.sentences.filter((s) => !s.demo);
  const strongLine = (s) => parseMarked(s.marked).map((w) => (w.strong ? `<strong class="strong">${esc(w.text)}</strong>` : `<span class="weak">${esc(w.text)}</span>`)).join(" ");
  app.innerHTML = `
    <h1>文のリズム</h1>
    <section class="card">
      <h2>体験：強い語の数が同じ3つの文</h2>
      <p class="muted small">太字が強く読まれる語です。弱い語（the, will, have been）が増えても、弱い語は短く詰めて読まれるため、強い語の「拍」の感じは保たれます。</p>
      ${demo.map((s) => `
        <div class="example">
          <div class="rhythm-line">${strongLine(s)}</div>
          <button class="btn" type="button" data-play="${esc(s.id)}">▶ 聞く</button>
        </div>`).join("")}
      <p class="muted small">音声合成のため、実際の話し言葉ほどリズムがはっきり出ないことがあります。</p>
    </section>

    <section class="card">
      <h2>練習：強い語を聞き取る</h2>
      <p class="muted small">文を聞いて、強く聞こえた語を選びます。</p>
      <button class="btn primary" type="button" id="start">練習を始める（${rest.length}文）</button>
    </section>
    <button class="btn" type="button" id="menu">リズムと強勢のメニューへ</button>
  `;
  app.querySelectorAll("[data-play]").forEach((btn) => {
    btn.onclick = () => play(rhythmPath(rhythm.sentences.find((s) => s.id === btn.dataset.play), rhythm.speakers[0]));
  });
  document.getElementById("start").onclick = () => showRhythm({ items: shuffle(rest), i: 0, hits: 0, total: 0 });
  document.getElementById("menu").onclick = renderMenu;
}

function showRhythm(st) {
  const s = st.items[st.i];
  const ws = parseMarked(s.marked);
  const speaker = pick(rhythm.speakers);
  const chosen = new Set();
  app.innerHTML = `
    <div class="progress muted small"><span>文のリズム</span><span>${st.i + 1} / ${st.items.length}</span></div>
    <div class="meter" aria-hidden="true"><span style="width:${((st.i / st.items.length) * 100).toFixed(1)}%"></span></div>
    <p style="text-align:center;margin-top:12px">強く聞こえた語をすべて選んでください</p>
    <button class="play" type="button" id="replay" aria-label="もう一度聞く">▶</button>
    <div class="row"><button class="btn" type="button" id="slow">ゆっくりで聞く</button></div>
    <div class="chips" id="words">${ws.map((w, i) => `<button class="chip" type="button" data-w="${i}">${esc(w.text)}</button>`).join("")}</div>
    <div id="feedback"></div>
    <div id="actions"><button class="btn primary" type="button" id="check">答え合わせ</button></div>
    <button class="btn" type="button" id="quit">中断する</button>
  `;
  play(rhythmPath(s, speaker));
  document.getElementById("replay").onclick = () => play(rhythmPath(s, speaker));
  document.getElementById("slow").onclick = () => play(slowPath(s));
  document.getElementById("quit").onclick = renderRhythmList;
  app.querySelectorAll("[data-w]").forEach((btn) => {
    btn.onclick = () => {
      if (btn.disabled) return;
      const i = Number(btn.dataset.w);
      if (chosen.has(i)) chosen.delete(i);
      else chosen.add(i);
      btn.classList.toggle("on", chosen.has(i));
    };
  });
  document.getElementById("check").onclick = async () => {
    let right = 0;
    app.querySelectorAll("[data-w]").forEach((btn) => {
      const i = Number(btn.dataset.w);
      const strong = ws[i].strong;
      if (strong === chosen.has(i)) right++;
      btn.disabled = true;
      btn.classList.remove("on");
      btn.classList.add(strong ? "strong-chip" : "weak-chip");
      if (strong !== chosen.has(i)) btn.classList.add("miss");
    });
    st.hits += right;
    st.total += ws.length;
    await db.addTrial({ mode: "rhythm", date: new Date().toISOString(), id: s.id, right, n: ws.length });
    document.getElementById("feedback").innerHTML = `
      <div class="feedback">
        <div class="mark ${right === ws.length ? "ok" : "ng"}">${right} / ${ws.length} 語を正しく判断</div>
        <div class="small">強い語だけ：<strong>${esc(ws.filter((w) => w.strong).map((w) => w.text.replace(/[.,?!]/g, "")).join(" … "))}</strong></div>
        <div class="muted small">${esc(s.ja)}</div>
        <p class="muted small">強い語だけでも、文の意味の骨組みがわかります。聞き取れない弱い語は、文の形から補いましょう。</p>
      </div>`;
    const last = st.i + 1 >= st.items.length;
    document.getElementById("actions").innerHTML = `
      <div class="row">
        <button class="btn" type="button" id="again">▶ もう一度聞く</button>
        <button class="btn primary" type="button" id="next">${last ? "結果を見る" : "次へ"}</button>
      </div>`;
    document.getElementById("again").onclick = () => play(rhythmPath(s, speaker));
    document.getElementById("next").onclick = () => {
      st.i++;
      if (st.i < st.items.length) showRhythm(st);
      else {
        app.innerHTML = `
          <h1>文のリズム：結果</h1>
          <section class="card">
            <div class="stat">${pct(st.hits, st.total)}%</div>
            <p class="muted">強い語・弱い語を正しく判断できた割合（${st.hits} / ${st.total} 語）</p>
          </section>
          <button class="btn primary" type="button" id="again2">もう一度</button>
          <button class="btn" type="button" id="menu">リズムと強勢のメニューへ</button>`;
        document.getElementById("again2").onclick = renderRhythmList;
        document.getElementById("menu").onclick = renderMenu;
      }
    };
  };
}
