// Extensive listening: links to free outside material + a log of how much and
// how well the learner listened. Nothing is downloaded from those sites.
import * as db from "./db.js";
import { esc, fmtDate, toast } from "./util.js";
import { barChart, bindTooltips } from "./charts.js";
import { benefitCard } from "./benefits.js";
import { stopAll } from "./audio.js";

const COMP = [
  { v: 1, label: "ほとんど分からない" },
  { v: 2, label: "半分くらい" },
  { v: 3, label: "だいたい分かる" },
  { v: 4, label: "ほぼ全部分かる" },
];
const GOALS = [30, 60, 120, 180];   // minutes per week

const app = document.getElementById("app");
let data = null;
let openInternal = null;
let ticker = null;

export function init(d, opts) {
  data = d;
  openInternal = opts.openInternal;
}

export function cleanup() {
  clearInterval(ticker);
  ticker = null;
}

function weekStart(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));   // Monday
  return x;
}

async function logs() {
  return (await db.allTrials()).filter((t) => t.mode === "extensive");
}

export async function weeklyMinutes(nWeeks = 8) {
  const all = await logs();
  const thisWeek = weekStart(new Date());
  return Array.from({ length: nWeeks }, (_, k) => {
    const from = new Date(thisWeek);
    from.setDate(from.getDate() - 7 * (nWeeks - 1 - k));
    const to = new Date(from);
    to.setDate(to.getDate() + 7);
    const value = all.filter((t) => new Date(t.date) >= from && new Date(t.date) < to).reduce((a, t) => a + t.minutes, 0);
    const label = `${from.getMonth() + 1}/${from.getDate()}`;
    return { label, value, tip: `${label}の週：${value}分` };
  });
}

const sourceName = (id) => (data.sources.find((s) => s.id === id) || { name: id }).name;

function compChips(name) {
  return `<div class="chips">${COMP.map((c) => `<button class="chip" type="button" data-${name}="${c.v}">${c.label}</button>`).join("")}</div>`;
}

async function save(source, minutes, comp, extra = {}) {
  await db.addTrial({ mode: "extensive", date: new Date().toISOString(), source, minutes, comp, ...extra });
  toast(`${minutes}分を記録しました`);
}

// ---------- in-app podcast listening (episodes are streamed from the publisher, never stored) ----------

// Episode lists are fetched daily by tools/fetch_feeds.py (most publishers do not allow a
// web page to read their feed directly). Only the list is stored; audio is streamed.
async function loadFeed(source) {
  const res = await fetch(`data/feeds/${source.id}.json`, { cache: "no-cache" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const d = await res.json();
  return { fetched: d.fetched, episodes: d.episodes.filter((e) => e.audio && e.audio.startsWith("https://")) };
}

const privacy = (source) => `再生すると、このスマホが配信元（${source.hosts}）のサーバーに接続し、音声を直接受け取ります。配信元のアプリやポッドキャストアプリで聞く場合と同じです。学習記録は送りません。音声はアプリに保存しないため、電波のない所では聞けません。`;

const dateJa = (iso) => (iso ? new Date(iso).toLocaleDateString("ja-JP") : "");

async function renderFeed(source) {
  stopAll();
  cleanup();
  app.innerHTML = `
    <h1>${esc(source.name)}</h1>
    <section class="card"><p class="small">${esc(source.desc)}</p><p class="muted small">${esc(privacy(source))}</p></section>
    <section class="card" id="episodes"><p class="muted">一覧を読み込み中…</p></section>
    <button class="btn" type="button" id="back">多聴へ戻る</button>
  `;
  document.getElementById("back").onclick = render;
  let feed;
  try {
    feed = await loadFeed(source);
  } catch (e) {
    const box = document.getElementById("episodes");
    if (box) box.innerHTML = `<p>一覧を読み込めませんでした（${esc(e.message)}）。電波の状態を確認してください。</p>`;
    return;
  }
  const box = document.getElementById("episodes");
  if (!box) return;
  const eps = feed.episodes;
  let lastGroup = null;
  box.innerHTML = `
    <p class="muted small">一覧の更新：${esc(dateJa(feed.fetched))}</p>
    ${eps.map((ep, i) => {
      const head = ep.group && ep.group !== lastGroup ? `<h2 style="margin-top:12px">${esc(ep.group)}</h2>` : "";
      lastGroup = ep.group || lastGroup;
      return `${head}
      <button class="btn contrast" type="button" data-ep="${i}">
        <span class="contrast-title">${esc(ep.title)}</span>
        <span class="muted small">${esc([dateJa(ep.date), ep.duration].filter(Boolean).join("・"))}</span>
      </button>`;
    }).join("")}`;
  box.querySelectorAll("[data-ep]").forEach((btn) => {
    btn.onclick = () => renderEpisode(source, eps[Number(btn.dataset.ep)], () => renderFeed(source));
  });
}

function renderEpisode(source, ep, back) {
  stopAll();
  cleanup();
  let listenedMs = 0;
  let since = null;
  let saved = false;
  app.innerHTML = `
    <h1>${esc(ep.title)}</h1>
    <section class="card">
      <audio id="ep-audio" controls playsinline preload="metadata" src="${esc(ep.audio)}" style="width:100%"></audio>
      <div class="chips" aria-label="再生速度">${[0.8, 0.9, 1.0, 1.1, 1.2].map((r) => `<button class="chip ${r === 1 ? "on" : ""}" type="button" data-rate="${r}">${r.toFixed(1)}倍</button>`).join("")}</div>
      <p class="small">聞いた時間：<strong id="listened">0分0秒</strong></p>
      ${ep.summary ? `<p class="small">${esc(ep.summary)}</p>` : ""}
      ${ep.link ? `<a class="btn" href="${esc(ep.link)}" target="_blank" rel="noopener noreferrer">スクリプト・詳しい情報（配信元のサイト）</a>` : ""}
    </section>
    <section class="card" id="finish-area">
      <button class="btn primary" type="button" id="finish">聞き終えて記録する</button>
      <p class="muted small">記録しないで画面を離れると、この回の時間は記録されません。</p>
    </section>
    <section class="card"><p class="muted small">${esc(privacy(source))}</p></section>
    <button class="btn" type="button" id="back">一覧へ戻る</button>
  `;
  const audio = document.getElementById("ep-audio");
  const label = document.getElementById("listened");
  const total = () => listenedMs + (since ? Date.now() - since : 0);
  const show = () => {
    const s = Math.floor(total() / 1000);
    if (label) label.textContent = `${Math.floor(s / 60)}分${s % 60}秒`;
  };
  // count real listening time while audio is actually playing
  audio.addEventListener("playing", () => { since = Date.now(); });
  const stopCounting = () => {
    if (since) listenedMs += Date.now() - since;
    since = null;
    show();
  };
  audio.addEventListener("pause", stopCounting);
  audio.addEventListener("ended", stopCounting);
  audio.addEventListener("error", () => toast("音声を再生できませんでした。電波の状態を確認してください。"));
  ticker = setInterval(show, 1000);
  app.querySelectorAll("[data-rate]").forEach((btn) => {
    btn.onclick = () => {
      audio.playbackRate = Number(btn.dataset.rate);
      app.querySelectorAll("[data-rate]").forEach((b) => b.classList.toggle("on", b === btn));
    };
  });
  document.getElementById("back").onclick = () => {
    audio.pause();
    back();
  };
  document.getElementById("finish").onclick = () => {
    audio.pause();
    stopCounting();
    const minutes = Math.round(total() / 60000);
    const area = document.getElementById("finish-area");
    if (minutes < 1) {
      toast("1分以上聞くと記録できます");
      return;
    }
    area.innerHTML = `<p class="small">${minutes}分。どのくらい分かりましたか？</p>${compChips("comp")}`;
    area.querySelectorAll("[data-comp]").forEach((b) => {
      b.onclick = async () => {
        if (saved) return;
        saved = true;
        await save(source.id, minutes, Number(b.dataset.comp), { episode: ep.title });
        render();
      };
    });
  };
}

export async function render() {
  cleanup();
  const level = await db.get("level", null);
  const goal = await db.get("elGoal", 60);
  const timer = await db.get("elTimer", null);
  const all = await logs();
  const weeks = await weeklyMinutes(8);
  const thisWeek = weeks[weeks.length - 1].value;
  const recent = all.slice(-5);
  const compAvg = recent.length ? recent.reduce((a, t) => a + t.comp, 0) / recent.length : null;
  const sources = data.sources.slice().sort((a, b) => (b.levels.includes(level) ? 1 : 0) - (a.levels.includes(level) ? 1 : 0));
  const sourceOptions = data.sources.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("");

  app.innerHTML = `
    <h1>多聴</h1>
    ${benefitCard("extensive")}
    <section class="card">
      <p class="small"><strong>やさしい英語を、たくさん聞く</strong>練習です。細かい聞き取りより、聞いてすぐ意味が分かる「慣れ」を育てます。</p>
      <ul class="small">
        <li>「だいたい分かる」くらいの、やさしめの素材を選びましょう。</li>
        <li>最初は、スクリプトや字幕を見ながら聞いてもかまいません（聞き読み）。</li>
        <li>毎日少しずつ、量を積み重ねることが大切です。</li>
      </ul>
      <p class="muted small">根拠 ○：多聴を続けたグループで聴解力や聞き取りの流暢さが伸びたという報告があります（Chang &amp; Millett 2014, 2016 など。比較的小規模）。</p>
    </section>

    <section class="card">
      <h2>今週の聞いた時間</h2>
      <div class="stat">${thisWeek}分 <span class="muted small">/ 目標 ${goal}分</span></div>
      <div class="meter" aria-hidden="true"><span style="width:${Math.min(100, (thisWeek / goal) * 100).toFixed(1)}%"></span></div>
      <div class="chips" aria-label="週の目標">${GOALS.map((g) => `<button class="chip ${g === goal ? "on" : ""}" type="button" data-goal="${g}">週${g}分</button>`).join("")}</div>
      ${compAvg !== null && compAvg < 2.5 ? `<p class="small" style="margin-top:8px">最近の理解度が低めです。もう少し<strong>やさしい素材</strong>に変えると、多聴の効果が出やすくなります。</p>` : ""}
    </section>

    <section class="card">
      <h2>おすすめの素材</h2>
      ${sources.filter((s) => s.id !== "other").map((s) => `
        <div class="example">
          <div><strong>${esc(s.name)}</strong> <span class="muted small">レベル${s.levels[0]}〜${s.levels[s.levels.length - 1]}${s.levels.includes(level) ? "・あなたのレベル" : ""}</span></div>
          <p class="small" style="margin:4px 0">${esc(s.desc)}</p>
          ${s.internal ? `<button class="btn" type="button" data-internal="${esc(s.id)}">開く</button>`
            : s.inApp ? `<button class="btn primary" type="button" data-feed="${esc(s.id)}">アプリ内で聞く</button>
              <a class="btn" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">サイトを開く</a>`
              : `<a class="btn" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">サイトを開く</a>`}
        </div>`).join("")}
      <p class="muted small">「サイトを開く」は外部のサイトが開きます（このアプリから情報は送りません）。</p>
    </section>

    <section class="card" id="timer-card">
      <h2>ほかのサイト・アプリで聞いた時間を記録する</h2>
      <p class="muted small">ここで素材を選んでも、音声は流れません。外部のサイトやポッドキャストアプリで聞くときに、時間を計るための機能です。「アプリ内で聞く」や「聞き読み」は自動で記録されます。</p>
      ${timer ? `
        <p>「${esc(sourceName(timer.source))}」を聞いています</p>
        <div class="stat" id="elapsed">0:00</div>
        <div id="finish-area">
          <button class="btn primary" type="button" id="finish">終了して記録する</button>
          <button class="btn" type="button" id="discard">記録しないで終了</button>
        </div>
      ` : `
        <select id="source" aria-label="聞く素材">${sourceOptions}</select>
        <button class="btn primary" type="button" id="start" style="margin-top:10px">聞き始める（時間を計る）</button>
        <details>
          <summary class="small">時間を手で入力する</summary>
          <input id="manual-min" type="number" min="1" max="600" inputmode="numeric" placeholder="分（例：15）">
          <p class="small">どのくらい分かりましたか？</p>
          ${compChips("manual-comp")}
        </details>
      `}
    </section>

    <section class="card">
      <h2>週ごとの聞いた時間</h2>
      ${barChart(weeks, { goal })}
    </section>

    ${all.length ? `
    <section class="card">
      <h2>最近の記録</h2>
      <table><tbody>${all.slice(-10).reverse().map((t) => `
        <tr><td>${fmtDate(t.date)}</td><td>${esc(sourceName(t.source))}</td><td class="num">${t.minutes}分</td><td class="small">${esc(COMP[t.comp - 1].label)}</td></tr>`).join("")}
      </tbody></table>
    </section>` : ""}

    <button class="btn" type="button" data-nav="home">ホームへ</button>
  `;
  bindTooltips(app);

  app.querySelectorAll("[data-goal]").forEach((btn) => {
    btn.onclick = async () => {
      await db.set("elGoal", Number(btn.dataset.goal));
      render();
    };
  });
  app.querySelectorAll("[data-internal]").forEach((btn) => {
    btn.onclick = () => openInternal(btn.dataset.internal);
  });
  app.querySelectorAll("[data-feed]").forEach((btn) => {
    btn.onclick = () => renderFeed(data.sources.find((s) => s.id === btn.dataset.feed));
  });

  if (timer) {
    const el = document.getElementById("elapsed");
    const tick = () => {
      const s = Math.floor((Date.now() - timer.start) / 1000);
      el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    };
    tick();
    ticker = setInterval(tick, 1000);
    document.getElementById("discard").onclick = async () => {
      await db.set("elTimer", null);
      render();
    };
    document.getElementById("finish").onclick = () => {
      cleanup();
      const minutes = Math.max(1, Math.round((Date.now() - timer.start) / 60000));
      document.getElementById("finish-area").innerHTML = `
        <p class="small">${minutes}分。どのくらい分かりましたか？</p>
        ${compChips("comp")}`;
      app.querySelectorAll("[data-comp]").forEach((btn) => {
        btn.onclick = async () => {
          await save(timer.source, minutes, Number(btn.dataset.comp));
          await db.set("elTimer", null);
          render();
        };
      });
    };
  } else {
    document.getElementById("start").onclick = async () => {
      await db.set("elTimer", { start: Date.now(), source: document.getElementById("source").value });
      render();
    };
    app.querySelectorAll("[data-manual-comp]").forEach((btn) => {
      btn.onclick = async () => {
        const minutes = Math.round(Number(document.getElementById("manual-min").value));
        if (!(minutes >= 1 && minutes <= 600)) {
          toast("分を1〜600で入力してください");
          return;
        }
        await save(document.getElementById("source").value, minutes, Number(btn.dataset.manualComp));
        render();
      };
    });
  }
}
