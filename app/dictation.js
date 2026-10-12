// Dictation used as a diagnostic: listen, type, then classify what was missed.
// Evidence for dictation itself as a learning method is weak (spec: △); the
// point here is to find which kind of listening problem causes the errors.
import * as db from "./db.js";
import { esc, pct, pick, shuffle } from "./util.js";
import { loadAudio, play } from "./audio.js";

const SESSION_SIZE = 10;
const RATES = [0.7, 0.8, 0.9, 1.0, 1.1, 1.2];
const DEFAULT_RATE = { 1: 0.8, 2: 0.9, 3: 1.0, 4: 1.0, 5: 1.1 };
const RECENT = 30;   // sentences used for the weakness summary

const FEATURE_NAMES = {
  linking: "連結（音がつながる）",
  reduction: "弱化・短縮（音が弱く短くなる）",
  elision: "脱落（音が消える）",
  assimilation: "同化（となりの音と混ざる）",
  flap: "はじき音（t がラ行のようになる）",
};

const CATEGORIES = {
  change: { name: "音の変化", desc: "音がつながる・弱くなる・消える部分の聞き落とし" },
  weak: { name: "弱く発音される語", desc: "a, the, to, can など、文の中で弱く短く発音される語" },
  confusion: { name: "音の混同", desc: "right / light など、似た音の聞き違い" },
  unknown: { name: "知らない単語", desc: "自分で「知らない」と選んだ単語" },
  other: { name: "その他", desc: "上のどれにも当てはまらない聞き取りミス" },
};

// Words that usually take a weak (reduced) form inside a sentence.
const FUNCTION_WORDS = new Set(("a an the and but or as at for from of to than that can could would should must shall "
  + "have has had do does am are is was were be been he him his her them us you your some there 'd").split(" "));

const app = document.getElementById("app");
let ctx = null;                 // { data, manifests, openContrast, levels }
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

// ---------- text comparison ----------

const SPECIAL = { "can't": ["can", "not"], "won't": ["will", "not"], "let's": ["let", "us"] };
const SUFFIX = { m: "am", re: "are", ve: "have", ll: "will", d: "'d", s: "is" };

function expand(w) {
  if (SPECIAL[w]) return SPECIAL[w];
  let m = w.match(/^(.+)n't$/);
  if (m) return [m[1], "not"];
  m = w.match(/^(.+)'(m|re|ve|ll|d|s)$/);
  if (m) return [m[1], SUFFIX[m[2]]];
  return [w];
}

// Contractions are expanded so "I'm" and "I am" compare equal.
// Each token remembers which original word it came from.
export function tokenize(text) {
  const words = text.replace(/’/g, "'").split(/\s+/).filter(Boolean);
  const tokens = [];
  words.forEach((raw, wi) => {
    const w = raw.toLowerCase().replace(/[^a-z0-9']+/g, "").replace(/^'+|'+$/g, "");
    if (!w) return;
    for (const t of expand(w)) tokens.push({ t, w: wi });
  });
  return { words, tokens };
}

const D_FORMS = new Set(["'d", "had", "would"]);
export const eq = (a, b) => a === b || ((a === "'d" || b === "'d") && D_FORMS.has(a) && D_FORMS.has(b));

// Word-level edit-distance alignment.
function align(target, typed) {
  const n = target.length;
  const m = typed.length;
  const d = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (eq(target[i - 1], typed[j - 1]) ? 0 : 1));
    }
  }
  const ops = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const same = i > 0 && j > 0 && eq(target[i - 1], typed[j - 1]);
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (same ? 0 : 1)) {
      ops.push({ type: same ? "match" : "sub", t: i - 1, u: j - 1 });
      i--;
      j--;
    } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      ops.push({ type: "del", t: i - 1 });
      i--;
    } else {
      ops.push({ type: "ins", u: j - 1 });
      j--;
    }
  }
  return ops.reverse();
}

function confusionContrast(target, typed) {
  if (!typed || target === typed) return null;
  const hit = pairIndex.get(`${target}|${typed}`);
  if (hit) return hit;
  // pairs that are not in the training lists: differ only by r/l, b/v or s/th
  for (const [x, y, id] of [["r", "l", "rl"], ["v", "b", "bv"], ["th", "s", "sth"]]) {
    if (target.split(x).join(y) === typed.split(x).join(y)) return id;
  }
  return null;
}

function analyze(sentence, typedText, unknown) {
  const tgt = tokenize(sentence.text);
  const usr = tokenize(typedText);
  const tt = tgt.tokens.map((x) => x.t);
  const ops = align(tt, usr.tokens.map((x) => x.t));

  const featureAt = new Array(tt.length).fill(null);
  for (const f of sentence.features) {
    const sp = tokenize(f.span).tokens.map((x) => x.t);
    for (let i = 0; i + sp.length <= tt.length; i++) {
      if (sp.every((s, k) => tt[i + k] === s)) {
        for (let k = 0; k < sp.length; k++) if (!featureAt[i + k]) featureAt[i + k] = f;
        break;
      }
    }
  }

  const states = tgt.words.map(() => ({ ok: true, typed: [], err: null }));
  const extras = [];
  let matched = 0;
  for (const op of ops) {
    if (op.type === "match") {
      matched++;
      continue;
    }
    if (op.type === "ins") {
      extras.push(usr.tokens[op.u].t);
      continue;
    }
    const tok = tgt.tokens[op.t];
    const typed = op.type === "sub" ? usr.tokens[op.u].t : null;
    const st = states[tok.w];
    st.ok = false;
    if (typed) st.typed.push(typed);
    if (st.err) continue;
    const f = featureAt[op.t];
    const contrast = confusionContrast(tok.t, typed);
    if (unknown.has(tok.w)) st.err = { cat: "unknown" };
    else if (f) st.err = { cat: "change", feature: f.type };
    else if (contrast) st.err = { cat: "confusion", contrast };
    else if (FUNCTION_WORDS.has(tok.t)) st.err = { cat: "weak" };
    else st.err = { cat: "other" };
  }
  return { words: tgt.words, states, extras, matched, total: tt.length, featureAt };
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
  const pool = ctx.data.sentences.filter((s) => s.level === level);
  const items = shuffle(pool).slice(0, SESSION_SIZE).map((s) => ({ s, speaker: pick(ctx.data.speakers) }));
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
  item.result = null;
  const playItem = () => play(sentencePath(item.s, item.speaker), sess.rate);

  app.innerHTML = `
    <div class="progress muted small">
      <span>書き取り（レベル${sess.level}）</span>
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
    renderResult(sess, item);
  };
  document.getElementById("quit").onclick = async () => {
    if (item.result) await saveItem(sess, item);
    renderSessionDone(sess);
  };
}

function renderResult(sess, item) {
  const r = analyze(item.s, item.typed, item.unknown);
  item.result = r;
  const tag = (err) => {
    if (!err) return "";
    const label = err.cat === "change" ? FEATURE_NAMES[err.feature].split("（")[0]
      : err.cat === "confusion" ? `音の混同 ${ctx.manifests[err.contrast] ? ctx.manifests[err.contrast].title : ""}`
        : CATEGORIES[err.cat].name;
    return `<span class="tag tag-${err.cat}">${esc(label)}</span>`;
  };
  const errorFeatures = new Set(r.states.filter((s) => s.err && s.err.cat === "change").map((s) => s.err.feature));

  document.getElementById("result").innerHTML = `
    <section class="card">
      <div class="stat">${pct(r.matched, r.total)}%</div>
      <p class="muted small">単語の正解率（${r.matched} / ${r.total}）</p>
      <p class="dict-words">${r.words.map((w, wi) => {
        const st = r.states[wi];
        if (st.ok) return `<span class="w-ok">${esc(w)}</span>`;
        return `<span class="w-ng">${esc(w)}<span class="w-typed">${st.typed.length ? esc(st.typed.join(" ")) : "（聞き取れず）"}</span>${tag(st.err)}</span>`;
      }).join(" ")}</p>
      ${r.extras.length ? `<p class="muted small">余分に入力した語：${esc(r.extras.join(" "))}</p>` : ""}
      <p class="small">訳：${esc(item.s.ja)}</p>
    </section>

    <section class="card">
      <h2>この文の音の変化</h2>
      <ul class="small">${item.s.features.map((f) => `
        <li${errorFeatures.has(f.type) ? ' class="hl"' : ""}><strong>${esc(f.span)}</strong>（${esc(FEATURE_NAMES[f.type])}）：${esc(f.note)}</li>`).join("")}
      </ul>
      <p class="muted small">音声合成のため、実際の会話ほど音の変化がはっきり出ていないことがあります。</p>
    </section>

    <section class="card">
      <h2>知らなかった単語はありますか？</h2>
      <p class="muted small">選ぶと「知らない単語」として分析します。</p>
      <div class="chips">${r.words.map((w, wi) => `<button class="chip ${item.unknown.has(wi) ? "on" : ""}" type="button" data-unknown="${wi}">${esc(w.replace(/[.,!?]/g, ""))}</button>`).join("")}</div>
    </section>
  `;

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
    if (sess.i < sess.items.length) {
      showItem(sess);
      window.scrollTo(0, 0);
    } else {
      renderSessionDone(sess);
    }
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
    date: new Date().toISOString(),
    id: item.s.id,
    level: sess.level,
    speaker: item.speaker,
    rate: sess.rate,
    replays: item.replays,
    typed: item.typed,
    matched: r.matched,
    total: r.total,
    errors,
    unknown: [...item.unknown].map((wi) => r.words[wi].replace(/[.,!?]/g, "")),
  });
}

function renderSessionDone(sess) {
  const avg = sess.scores.length ? Math.round(sess.scores.reduce((a, b) => a + b, 0) / sess.scores.length) : 0;
  const cats = Object.entries(sess.cats).sort((a, b) => b[1] - a[1]);
  app.innerHTML = `
    <h1>書き取りおつかれさまでした</h1>
    <section class="card">
      <p>平均の単語正解率（${sess.scores.length}文）</p>
      <div class="stat">${avg}%</div>
    </section>
    <section class="card">
      <h2>今回の聞き取りミスの内訳</h2>
      ${cats.length ? `<ul>${cats.map(([k, v]) => `<li>${esc(CATEGORIES[k].name)}：${v}語</li>`).join("")}</ul>` : `<p>ミスはありませんでした。レベルを上げてみましょう。</p>`}
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
  const unknownWords = new Set();
  for (const t of recent) {
    for (const e of t.errors) {
      counts[e.cat] = (counts[e.cat] || 0) + 1;
      if (e.cat === "change") features[e.feature] = (features[e.feature] || 0) + 1;
      if (e.cat === "confusion") contrasts[e.contrast] = (contrasts[e.contrast] || 0) + 1;
    }
    for (const w of t.unknown || []) unknownWords.add(w);
  }
  const totalErr = Object.values(counts).reduce((a, b) => a + b, 0);
  const avg = recent.length ? Math.round(recent.reduce((a, t) => a + pct(t.matched, t.total), 0) / recent.length) : 0;
  const order = Object.keys(CATEGORIES).filter((k) => counts[k]).sort((a, b) => counts[b] - counts[a]);
  const topContrast = Object.entries(contrasts).sort((a, b) => b[1] - a[1])[0];

  const topFeature = Object.entries(features).sort((a, b) => b[1] - a[1])[0];
  const advice = {
    change: `<p class="small">音がつながる・消える部分を聞き落としています。「音の変化の学習」でルールを確認し、聞き比べで耳を慣らしましょう。</p>
      ${Object.keys(features).length ? `<ul class="small">${Object.entries(features).sort((a, b) => b[1] - a[1]).map(([f, v]) => `<li>${esc(FEATURE_NAMES[f])}：${v}語</li>`).join("")}</ul>` : ""}
      ${topFeature ? `<button class="btn" type="button" id="go-lesson">「${esc(FEATURE_NAMES[topFeature[0]].split("（")[0])}」を学ぶ</button>` : ""}`,
    weak: `<p class="small">a, the, to, can などは文の中で弱く短く発音されるため、聞き落としやすい語です。音だけで聞き取れなくても、文法や意味から補えるように、答え合わせのあとに文全体をもう一度聞いてみましょう。</p>`,
    confusion: topContrast ? `<p class="small">似た音の聞き違いがあります。最も多いのは <strong>${esc(ctx.manifests[topContrast[0]] ? ctx.manifests[topContrast[0]].title : topContrast[0])}</strong> です。</p>
      <button class="btn" type="button" id="go-contrast">${esc(ctx.manifests[topContrast[0]] ? ctx.manifests[topContrast[0]].title : "")} の聞き分け訓練へ</button>` : "",
    unknown: `<p class="small">知らない単語は、音だけでは聞き取れません。意味と音を一緒に覚えましょう。</p>
      ${unknownWords.size ? `<p class="small">最近選んだ単語：${esc([...unknownWords].join(", "))}</p>` : ""}`,
    other: `<p class="small">上のどれにも当てはまらないミスです。再生速度を下げて、どこで聞き取れなくなるかを確かめてみましょう。</p>`,
  };

  app.innerHTML = `
    <h1>弱点のまとめ</h1>
    ${recent.length ? `
      <section class="card">
        <p class="small">直近${recent.length}文の書き取りから分析しました（平均の単語正解率 ${avg}%）。</p>
        ${totalErr ? order.map((k) => `
          <div class="bar-row">
            <span>${esc(CATEGORIES[k].name)}</span>
            <span class="muted small">${counts[k]}語（${pct(counts[k], totalErr)}%）</span>
          </div>
          <div class="meter" aria-hidden="true"><span style="width:${pct(counts[k], totalErr)}%"></span></div>`).join("") : `<p>ミスはありませんでした。</p>`}
      </section>
      ${order.map((k) => `
        <section class="card">
          <h2>${esc(CATEGORIES[k].name)}</h2>
          <p class="muted small">${esc(CATEGORIES[k].desc)}</p>
          ${advice[k]}
        </section>`).join("")}
    ` : `<section class="card"><p>まだ書き取りの記録がありません。まずは書き取りをしてみましょう。</p></section>`}
    <section class="card">
      <p class="muted small">分類は自動判定のため、目安としてご覧ください。書き取りそのものの学習効果を示す研究上の根拠は限られているため、ここでは「弱点を見つける」ために使っています。</p>
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
