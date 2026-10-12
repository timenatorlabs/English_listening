// Dictation used as a diagnostic: listen, type, then look for *likely* causes of misses.
// Evidence for dictation itself as a learning method is weak (spec: △). The automatic
// classification only sees the typed text, so it is shown as an estimate, and the
// learner's own report of the cause is stored separately (scoringVersion 2).
import * as db from "./db.js";
import { esc, pct, pick, shuffle } from "./util.js";
import { loadAudio, play } from "./audio.js";
import { analyze, FEATURE_NAMES } from "./scoring.js";

const SESSION_SIZE = 10;
const RATES = [0.7, 0.8, 0.9, 1.0, 1.1, 1.2];
const DEFAULT_RATE = { 1: 0.8, 2: 0.9, 3: 1.0, 4: 1.0, 5: 1.1 };
const RECENT = 30;   // sentences used for the weakness summary
const SCORING_VERSION = 2;

// Estimated causes (from the typed text only)
const CATEGORIES = {
  change: { name: "音の変化", desc: "音がつながる・弱くなる・消える部分での誤り" },
  weak: { name: "弱く発音される語", desc: "a, the, to, can など、文の中で弱く短く発音される語の誤り" },
  confusion: { name: "似た音の取り違え", desc: "right / light など、似た音の単語と取り違えた誤り" },
  other: { name: "その他", desc: "上のどれにも当てはまらない誤り（タイプミスを含む）" },
};

// Causes the learner reports after checking the answer
const SELF_CAUSES = {
  vocab: "知らない単語があった",
  sound: "音が聞き分けられなかった",
  change: "音のつながり・変化に気づかなかった",
  speed: "速くて意味が追いつかなかった",
  slip: "聞き取れたが書き間違えた",
};

const app = document.getElementById("app");
let ctx = null;                 // { data, manifests, openContrast, openLesson, levels }
const pairIndex = new Map();    // "word|word" -> contrast id

export function init(c) {
  ctx = c;
  for (const m of Object.values(c.manifests)) {
    for (const p of m.pairs) {
      pairIndex.set(`${p.a}|${p.b}`, m.id);
      pairIndex.set(`${p.b}|${p.a}`, m.id);
    }
  }
}

const sentencePath = (s, speaker) => ctx.data.audio.replace("{id}", s.id).replace("{speaker}", speaker);

export function audioPaths() {
  return ctx.data.sentences.flatMap((s) => ctx.data.speakers.map((sp) => sentencePath(s, sp)));
}

// ---------- screens ----------

async function renderChooseLevel() {
  app.innerHTML = `
    <h1>レベルを選んでください</h1>
    <p class="muted">書き取る文の難しさと、再生速度の初期値が変わります。あとからホームで変更できます。</p>
    ${ctx.levels.map((l) => `<button class="btn" type="button" data-level="${l.n}">レベル${l.n}：${esc(l.name)}（${esc(l.desc)}）</button>`).join("")}
    <button class="btn" type="button" data-nav="home">ホームへ</button>
  `;
  app.querySelectorAll("[data-level]").forEach((btn) => {
    btn.onclick = async () => {
      await db.set("level", Number(btn.dataset.level));
      start();
    };
  });
}

export async function start() {
  const level = await db.get("level", null);
  if (!level) {
    renderChooseLevel();
    return;
  }
  // sentences never dictated before come first, so first-try scores stay measurable
  const seen = new Set((await db.allTrials()).filter((t) => t.mode === "dictation").map((t) => t.id));
  const pool = ctx.data.sentences.filter((s) => s.level === level);
  const fresh = shuffle(pool.filter((s) => !seen.has(s.id)));
  const again = shuffle(pool.filter((s) => seen.has(s.id)));
  const items = [...fresh, ...again].slice(0, SESSION_SIZE).map((s) => ({ s, speaker: pick(ctx.data.speakers), firstTry: !seen.has(s.id) }));
  const savedRate = await db.get("dictRate", null);
  const sess = { level, items, i: 0, rate: savedRate || DEFAULT_RATE[level], scores: [], cats: {} };
  showItem(sess);
}

function rateButtons(sess) {
  return RATES.map((r) => `<button class="chip ${r === sess.rate ? "on" : ""}" type="button" data-rate="${r}">${r.toFixed(1)}倍</button>`).join("");
}

function showItem(sess) {
  const item = sess.items[sess.i];
  item.replays = 0;
  item.unknown = new Set();
  item.causes = new Set();
  item.result = null;
  const playItem = () => play(sentencePath(item.s, item.speaker), sess.rate);

  app.innerHTML = `
    <div class="progress muted small">
      <span>書き取り（レベル${sess.level}）${item.firstTry ? "・初めての文" : "・前に出た文"}</span>
      <span>${sess.i + 1} / ${sess.items.length}</span>
    </div>
    <div class="meter" aria-hidden="true"><span style="width:${((sess.i / sess.items.length) * 100).toFixed(1)}%"></span></div>
    <p style="text-align:center;margin-top:12px">聞こえた英文をそのまま入力してください</p>
    <button class="play" type="button" id="replay" aria-label="もう一度聞く">▶</button>
    <div class="row">
      <button class="btn" type="button" id="other-voice">別の声で聞く</button>
    </div>
    <div class="chips" id="rates" aria-label="再生速度">${rateButtons(sess)}</div>
    <textarea id="answer" rows="3" placeholder="例：I want to go home." autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"></textarea>
    <div id="result"></div>
    <div id="actions">
      <button class="btn primary" type="button" id="check">答え合わせ</button>
    </div>
    <button class="btn" type="button" id="quit">中断する</button>
  `;

  playItem();
  const next = sess.items[sess.i + 1];
  if (next) loadAudio(sentencePath(next.s, next.speaker));

  document.getElementById("replay").onclick = () => {
    item.replays++;
    playItem();
  };
  document.getElementById("other-voice").onclick = () => {
    const others = ctx.data.speakers.filter((sp) => sp !== item.speaker);
    item.speaker = pick(others);
    item.replays++;
    playItem();
  };
  const bindRates = () => {
    document.querySelectorAll("[data-rate]").forEach((btn) => {
      btn.onclick = () => {
        sess.rate = Number(btn.dataset.rate);
        db.set("dictRate", sess.rate);
        document.getElementById("rates").innerHTML = rateButtons(sess);
        bindRates();
        playItem();
      };
    });
  };
  bindRates();
  document.getElementById("check").onclick = () => {
    item.typed = document.getElementById("answer").value;
    document.getElementById("answer").readOnly = true;
    item.result = analyze(item.s, item.typed, pairIndex);
    renderResult(sess, item);
  };
  document.getElementById("quit").onclick = async () => {
    if (item.result) await saveItem(sess, item);
    renderSessionDone(sess);
  };
}

function estimateTag(err) {
  if (!err) return "";
  const label = err.cat === "change" ? FEATURE_NAMES[err.feature].split("（")[0]
    : err.cat === "confusion" ? `似た音 ${ctx.manifests[err.contrast] ? ctx.manifests[err.contrast].title : ""}`
      : CATEGORIES[err.cat].name;
  return `<span class="tag tag-${err.cat}">推定：${esc(label)}</span>`;
}

function renderResult(sess, item) {
  const r = item.result;
  const errorFeatures = new Set(r.states.filter((s) => s.err && s.err.cat === "change").map((s) => s.err.feature));
  const missed = !r.states.every((s) => s.ok);

  document.getElementById("result").innerHTML = `
    <section class="card">
      <div class="stat">${pct(r.matched, r.total)}%</div>
      <p class="muted small">単語の正解率（${r.matched} / ${r.total}）</p>
      <p class="dict-words">${r.words.map((w, wi) => {
        const st = r.states[wi];
        const self = item.unknown.has(wi) ? `<span class="tag">自己申告：知らない単語</span>` : "";
        if (st.ok) return `<span class="w-ok">${esc(w)}</span>`;
        return `<span class="w-ng">${esc(w)}<span class="w-typed">${st.typed.length ? esc(st.typed.join(" ")) : "（聞き取れず）"}</span>${estimateTag(st.err)}${self}</span>`;
      }).join(" ")}</p>
      ${r.extras.length ? `<p class="muted small">余分に入力した語：${esc(r.extras.join(" "))}</p>` : ""}
      ${missed ? `<p class="muted small">「推定」は入力した文字だけから機械的に推測した原因の候補で、本当の原因とは限りません。</p>` : ""}
      <p class="small">訳：${esc(item.s.ja)}</p>
    </section>

    <section class="card">
      <h2>この文の音の変化</h2>
      <ul class="small">${item.s.features.map((f) => `
        <li${errorFeatures.has(f.type) ? ' class="hl"' : ""}><strong>${esc(f.span)}</strong>（${esc(FEATURE_NAMES[f.type])}）：${esc(f.note)}</li>`).join("")}
      </ul>
      <p class="muted small">音声合成のため、実際の会話ほど音の変化がはっきり出ていないことがあります。</p>
    </section>

    ${missed ? `
    <section class="card">
      <h2>聞き取れなかった理由（自分で選ぶ）</h2>
      <p class="muted small">当てはまるものをすべて選んでください。機械の推定とは別に記録します。</p>
      <div class="chips">${Object.entries(SELF_CAUSES).map(([k, v]) => `<button class="chip ${item.causes.has(k) ? "on" : ""}" type="button" data-cause="${k}">${v}</button>`).join("")}</div>
      ${item.causes.has("vocab") ? `
        <p class="small" style="margin-top:8px">知らなかった単語を選んでください：</p>
        <div class="chips">${r.words.map((w, wi) => `<button class="chip ${item.unknown.has(wi) ? "on" : ""}" type="button" data-unknown="${wi}">${esc(w.replace(/[.,!?"]/g, ""))}</button>`).join("")}</div>` : ""}
    </section>` : ""}
  `;

  document.querySelectorAll("[data-cause]").forEach((btn) => {
    btn.onclick = () => {
      const k = btn.dataset.cause;
      if (item.causes.has(k)) item.causes.delete(k);
      else item.causes.add(k);
      if (!item.causes.has("vocab")) item.unknown.clear();
      renderResult(sess, item);
    };
  });
  document.querySelectorAll("[data-unknown]").forEach((btn) => {
    btn.onclick = () => {
      const wi = Number(btn.dataset.unknown);
      if (item.unknown.has(wi)) item.unknown.delete(wi);
      else item.unknown.add(wi);
      renderResult(sess, item);
    };
  });

  const last = sess.i + 1 >= sess.items.length;
  document.getElementById("actions").innerHTML = `
    <button class="btn primary" type="button" id="next">${last ? "結果を見る" : "次の文へ"}</button>
  `;
  document.getElementById("next").onclick = async () => {
    await saveItem(sess, item);
    sess.i++;
    if (sess.i < sess.items.length) showItem(sess);
    else renderSessionDone(sess);
  };
}

async function saveItem(sess, item) {
  if (item.saved) return;
  item.saved = true;
  const r = item.result;
  const errors = r.words.map((w, wi) => ({ w, s: r.states[wi] }))
    .filter((x) => !x.s.ok)
    .map((x) => ({ word: x.w, typed: x.s.typed.join(" "), ...x.s.err }));
  for (const e of errors) sess.cats[e.cat] = (sess.cats[e.cat] || 0) + 1;
  sess.scores.push(pct(r.matched, r.total));
  await db.addTrial({
    mode: "dictation",
    scoringVersion: SCORING_VERSION,
    date: new Date().toISOString(),
    id: item.s.id,
    level: sess.level,
    firstTry: item.firstTry,
    speaker: item.speaker,
    rate: sess.rate,
    replays: item.replays,
    typed: item.typed,
    matched: r.matched,
    total: r.total,
    errors,                                  // estimated causes (automatic)
    selfCauses: [...item.causes],            // learner's own report
    unknown: [...item.unknown].map((wi) => r.words[wi].replace(/[.,!?"]/g, "")),
  });
}

function renderSessionDone(sess) {
  const avg = sess.scores.length ? Math.round(sess.scores.reduce((a, b) => a + b, 0) / sess.scores.length) : 0;
  const cats = Object.entries(sess.cats).filter(([k]) => CATEGORIES[k]).sort((a, b) => b[1] - a[1]);
  app.innerHTML = `
    <h1>書き取りおつかれさまでした</h1>
    <section class="card">
      <p>平均の単語正解率（${sess.scores.length}文）</p>
      <div class="stat">${avg}%</div>
    </section>
    <section class="card">
      <h2>今回の誤りの推定原因</h2>
      ${cats.length ? `<ul>${cats.map(([k, v]) => `<li>${esc(CATEGORIES[k].name)}：${v}語</li>`).join("")}</ul>
        <p class="muted small">入力した文字から機械的に推定したもので、本当の原因とは限りません。</p>` : `<p>誤りはありませんでした。レベルを上げてみましょう。</p>`}
    </section>
    <button class="btn primary" type="button" id="weak">弱点のまとめを見る</button>
    <button class="btn" type="button" id="again">もう一度（10文）</button>
    <button class="btn" type="button" data-nav="home">ホームへ</button>
  `;
  document.getElementById("weak").onclick = renderWeakness;
  document.getElementById("again").onclick = start;
}

export async function renderWeakness() {
  const all = (await db.allTrials()).filter((t) => t.mode === "dictation");
  const recent = all.slice(-RECENT);
  const counts = {};
  const features = {};
  const contrasts = {};
  const selfCounts = {};
  const unknownWords = new Set();
  let reported = 0;
  for (const t of recent) {
    for (const e of t.errors) {
      // records before scoringVersion 2 stored "unknown" in place of the estimate
      if (e.cat === "unknown") continue;
      counts[e.cat] = (counts[e.cat] || 0) + 1;
      if (e.cat === "change") features[e.feature] = (features[e.feature] || 0) + 1;
      if (e.cat === "confusion") contrasts[e.contrast] = (contrasts[e.contrast] || 0) + 1;
    }
    const causes = new Set(t.selfCauses || []);
    if ((t.unknown || []).length) causes.add("vocab");
    if (causes.size) reported++;
    for (const c of causes) selfCounts[c] = (selfCounts[c] || 0) + 1;
    for (const w of t.unknown || []) unknownWords.add(w);
  }
  const totalErr = Object.values(counts).reduce((a, b) => a + b, 0);
  const avg = recent.length ? Math.round(recent.reduce((a, t) => a + pct(t.matched, t.total), 0) / recent.length) : 0;
  const order = Object.keys(CATEGORIES).filter((k) => counts[k]).sort((a, b) => counts[b] - counts[a]);
  const topContrast = Object.entries(contrasts).sort((a, b) => b[1] - a[1])[0];
  const topFeature = Object.entries(features).sort((a, b) => b[1] - a[1])[0];

  const advice = {
    change: `<p class="small">音がつながる・消える部分で誤りが多い可能性があります。「音の変化の学習」でルールを確認し、聞き比べで耳を慣らしてみましょう。</p>
      ${Object.keys(features).length ? `<ul class="small">${Object.entries(features).sort((a, b) => b[1] - a[1]).map(([f, v]) => `<li>${esc(FEATURE_NAMES[f])}：${v}語</li>`).join("")}</ul>` : ""}
      ${topFeature ? `<button class="btn" type="button" id="go-lesson">「${esc(FEATURE_NAMES[topFeature[0]].split("（")[0])}」を学ぶ</button>` : ""}`,
    weak: `<p class="small">a, the, to, can などは文の中で弱く短く発音されるため、聞き落としやすい語です。音だけで聞き取れなくても、文法や意味から補えるように、答え合わせのあとに文全体をもう一度聞いてみましょう。</p>`,
    confusion: topContrast ? `<p class="small">似た音の取り違えの可能性があります。最も多いのは <strong>${esc(ctx.manifests[topContrast[0]] ? ctx.manifests[topContrast[0]].title : topContrast[0])}</strong> です。</p>
      <button class="btn" type="button" id="go-contrast">${esc(ctx.manifests[topContrast[0]] ? ctx.manifests[topContrast[0]].title : "")} の聞き分け訓練へ</button>` : "",
    other: `<p class="small">上のどれにも当てはまらない誤りです（タイプミスも含まれます）。再生速度を下げて、どこで聞き取れなくなるかを確かめてみましょう。</p>`,
  };

  app.innerHTML = `
    <h1>弱点のまとめ</h1>
    ${recent.length ? `
      <section class="card">
        <h2>機械による推定（入力した文字から）</h2>
        <p class="small">直近${recent.length}文（平均の単語正解率 ${avg}%）の誤りを、原因の候補ごとに数えました。</p>
        ${totalErr ? order.map((k) => `
          <div class="bar-row">
            <span>${esc(CATEGORIES[k].name)}</span>
            <span class="muted small">${counts[k]}語（${pct(counts[k], totalErr)}%）</span>
          </div>
          <div class="meter" aria-hidden="true"><span style="width:${pct(counts[k], totalErr)}%"></span></div>`).join("") : `<p>誤りはありませんでした。</p>`}
        <p class="muted small" style="margin-top:8px">入力した文字だけから推測した候補で、本当の原因とは限りません。下の「自分で選んだ理由」とあわせて見てください。</p>
      </section>

      <section class="card">
        <h2>自分で選んだ理由</h2>
        ${reported ? `<p class="small">理由を選んだ ${reported}文のうち：</p>
          <ul class="small">${Object.entries(selfCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<li>${esc(SELF_CAUSES[k] || k)}：${v}文</li>`).join("")}</ul>
          ${unknownWords.size ? `<p class="small">知らなかった単語：${esc([...unknownWords].join(", "))}</p>` : ""}`
          : `<p class="muted small">まだ記録がありません。答え合わせのあとに、聞き取れなかった理由を選べます。</p>`}
      </section>

      ${order.map((k) => `
        <section class="card">
          <h2>${esc(CATEGORIES[k].name)}（推定）</h2>
          <p class="muted small">${esc(CATEGORIES[k].desc)}</p>
          ${advice[k]}
        </section>`).join("")}
    ` : `<section class="card"><p>まだ書き取りの記録がありません。まずは書き取りをしてみましょう。</p></section>`}
    <section class="card">
      <p class="muted small">書き取りそのものの学習効果を示す研究上の根拠は限られているため、ここでは「弱点の候補を見つける」ために使っています。</p>
    </section>
    <button class="btn primary" type="button" id="go-dict">書き取りをする</button>
    <button class="btn" type="button" data-nav="home">ホームへ</button>
  `;
  document.getElementById("go-dict").onclick = start;
  const gc = document.getElementById("go-contrast");
  if (gc) gc.onclick = () => ctx.openContrast(topContrast[0]);
  const gl = document.getElementById("go-lesson");
  if (gl) gl.onclick = () => ctx.openLesson(topFeature[0]);
}
