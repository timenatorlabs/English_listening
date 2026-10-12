// Extensive listening: links to free outside material + a log of how much and
// how well the learner listened. Nothing is downloaded from those sites.
import * as db from "./db.js";
import { esc, fmtDate, toast } from "./util.js";
import { barChart, bindTooltips } from "./charts.js";

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

async function save(source, minutes, comp) {
  await db.addTrial({ mode: "extensive", date: new Date().toISOString(), source, minutes, comp });
  toast(`${minutes}分を記録しました`);
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

    <section class="card" id="timer-card">
      <h2>聞いた時間を記録する</h2>
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
      <h2>おすすめの素材</h2>
      <p class="muted small">外部のサイトが開きます（このアプリから情報は送りません）。</p>
      ${sources.filter((s) => s.id !== "other").map((s) => `
        <div class="example">
          <div><strong>${esc(s.name)}</strong> <span class="muted small">レベル${s.levels[0]}〜${s.levels[s.levels.length - 1]}${s.levels.includes(level) ? "・あなたのレベル" : ""}</span></div>
          <p class="small" style="margin:4px 0">${esc(s.desc)}</p>
          ${s.internal ? `<button class="btn" type="button" data-internal="${esc(s.id)}">開く</button>`
            : `<a class="btn" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">サイトを開く</a>`}
        </div>`).join("")}
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
