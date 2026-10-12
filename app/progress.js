// "伸びのグラフ": test scores per contrast, dictation accuracy per day, weekly extensive listening.
import * as db from "./db.js";
import { esc, pct, fmtDate } from "./util.js";
import { lineChart, barChart, bindTooltips } from "./charts.js";
import { weeklyMinutes } from "./extensive.js";

const app = document.getElementById("app");
let ctx = null;   // { contrasts, normalizeTest }

export function init(c) {
  ctx = c;
}

function dayKey(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export async function render() {
  const tests = (await db.allTests()).map(ctx.normalizeTest);
  const trials = await db.allTrials();
  const goal = await db.get("elGoal", 60);

  const testCharts = ctx.contrasts
    .map((c) => ({ c, ts: tests.filter((t) => t.contrast === c.id) }))
    .filter((x) => x.ts.length);

  // dictation: average word accuracy per day (last 14 days with practice)
  const byDay = new Map();
  for (const t of trials) {
    if (t.mode !== "dictation") continue;
    const k = dayKey(t.date);
    if (!byDay.has(k)) byDay.set(k, { date: t.date, sum: 0, n: 0 });
    const d = byDay.get(k);
    d.sum += pct(t.matched, t.total);
    d.n++;
  }
  const dictPoints = [...byDay.values()].slice(-14).map((d) => {
    const dt = new Date(d.date);
    const label = `${dt.getMonth() + 1}/${dt.getDate()}`;
    const value = Math.round(d.sum / d.n);
    return { label, value, tip: `${label}：平均 ${value}%（${d.n}文）` };
  });

  const stressTests = trials.filter((t) => t.mode === "stress-test");
  const weeks = await weeklyMinutes(8);
  const hasExtensive = weeks.some((w) => w.value > 0);

  app.innerHTML = `
    <h1>伸びのグラフ</h1>
    <p class="muted small">点や棒をタップすると数値が出ます。数値の一覧は「記録とデータ」で見られます。</p>

    <section class="card">
      <h2>聞き分けテストの正答率</h2>
      ${testCharts.length ? testCharts.map(({ c, ts }) => `
        <h3 class="chart-title">${esc(c.title)}</h3>
        ${lineChart(ts.map((t, i) => ({ label: `${i + 1}回目`, value: pct(t.correct, t.n), tip: `${fmtDate(t.date)} ${t.kind}：${pct(t.correct, t.n)}%` })),
          { refLine: 50, refLabel: "当てずっぽう 50%" })}`).join("")
        : `<p class="muted">まだテストの記録がありません。</p>`}
    </section>

    <section class="card">
      <h2>単語の強勢テストの正答率</h2>
      ${stressTests.length ? lineChart(stressTests.map((t, i) => ({ label: `${i + 1}回目`, value: pct(t.correct, t.n), tip: `${fmtDate(t.date)} ${t.kind}：${pct(t.correct, t.n)}%` })),
        { refLine: stressTests[stressTests.length - 1].chance, refLabel: "当てずっぽう" }) : `<p class="muted">まだテストの記録がありません。</p>`}
    </section>

    <section class="card">
      <h2>書き取りの単語正解率（日ごとの平均）</h2>
      ${dictPoints.length ? lineChart(dictPoints) : `<p class="muted">まだ書き取りの記録がありません。</p>`}
    </section>

    <section class="card">
      <h2>多聴の時間（週ごと）</h2>
      ${hasExtensive ? barChart(weeks, { goal }) : `<p class="muted">まだ多聴の記録がありません。</p>`}
    </section>

    <button class="btn" type="button" data-nav="home">ホームへ</button>
  `;
  bindTooltips(app);
}
