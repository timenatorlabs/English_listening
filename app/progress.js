// 聞き取り力のカルテ: per-skill indicators with first / latest / difference, counts,
// uncertainty ranges and measurement conditions. It shows measured scores and their
// changes only; it does not claim overall listening ability has improved.
import * as db from "./db.js";
import { esc, fmtDate } from "./util.js";
import { multiLineChart, barChart, bindTooltips } from "./charts.js";
import { weeklyMinutes } from "./extensive.js";
import {
  normalizeTest, perceptionRows, stressRows, dictationRows, connectedRow, comprehensionRow,
  lastTrainingDate, retentionPlan, suggestions,
} from "./metrics.js";

const app = document.getElementById("app");
let ctx = null;   // { contrasts, manifests }

export function init(c) {
  ctx = c;
}

const pctOf = (p) => Math.round(p * 100);
const md = (iso) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

function cell(label, m, empty = "未測定") {
  if (!m) return `<div><span class="lbl">${label}</span>${empty}</div>`;
  return `<div><span class="lbl">${label}${m.date ? `（${md(m.date)}）` : ""}</span>
    <span class="big">${pctOf(m.p)}%</span> <span class="muted">${m.k}/${m.n}</span>
    <span class="lbl">幅 ${pctOf(m.ci[0])}〜${pctOf(m.ci[1])}%</span></div>`;
}

function indicator(r) {
  const diff = r.diff === null ? "―" : `${r.diff > 0 ? "+" : ""}${r.diff.toFixed(1)}`;
  return `
    <div class="ind">
      <div class="ind-name">${esc(r.label)}</div>
      <div class="ind-cond">${esc(r.condition)}${r.chance ? `。当てずっぽうで約${pctOf(r.chance)}%` : ""}</div>
      <div class="ind-grid">
        ${cell("初回", r.first)}
        ${cell("最新", r.first === r.latest ? null : r.latest, r.latest ? "―（1回のみ）" : "未測定")}
        <div><span class="lbl">差</span><span class="big">${diff}</span>${r.diff === null ? "" : `<span class="lbl">ポイント</span>`}</div>
      </div>
      <div class="ind-judge ${r.judge.code}">${esc(r.judge.text)}</div>
    </div>`;
}

// All indicators in a section unmeasured → one line instead of a column of "未測定".
function section(rows, emptyText) {
  if (rows.every((r) => !r.latest)) {
    return `<p class="small muted">未測定：${rows.map((r) => esc(r.label)).join("、")}。${emptyText}</p>`;
  }
  return rows.map(indicator).join("");
}

function perceptionChart(rows, chance) {
  const tests = Math.max(rows[1].series.length, rows[2].series.length);
  if (tests < 2) return "";
  const labels = Array.from({ length: tests }, (_, i) => `${i + 1}回目`);
  const toPts = (series) => series.map((m, i) => ({ x: i, value: pctOf(m.p), tip: `${i + 1}回目（${md(m.date)}・${m.kind || ""}）${m.k}/${m.n}・${pctOf(m.p)}%` }));
  return multiLineChart([
    { name: "初めての声", cls: "s1", points: toPts(rows[1].series) },
    { name: "初めての単語", cls: "s2", points: toPts(rows[2].series) },
  ], labels, { refLine: pctOf(chance), refLabel: "当てずっぽう" });
}

export async function render() {
  const tests = (await db.allTests()).map(normalizeTest);
  const trials = await db.allTrials();
  const level = await db.get("level", null);
  const goal = await db.get("elGoal", 60);
  const now = new Date().toISOString();

  // minimal-pair perception, one block per contrast
  const perception = ctx.contrasts.map((c) => {
    const m = ctx.manifests[c.id];
    const p = perceptionRows(c.id, tests, trials, m.audioVersion || 1);
    const hasData = p.rows.some((r) => r.latest) || p.olderVersionTests > 0;
    const lastTraining = lastTrainingDate(trials, "train", c.id);
    const testDates = tests.filter((t) => t.contrast === c.id).map((t) => t.date);
    return { id: c.id, title: c.title, rows: p.rows, older: p.olderVersionTests, hasData, plan: retentionPlan(lastTraining, testDates, now) };
  });
  const stress = stressRows(trials);
  const stressPlan = retentionPlan(lastTrainingDate(trials, "stress"), trials.filter((t) => t.mode === "stress-test").map((t) => t.date), now);
  const dictation = dictationRows(level ? trials.filter((t) => t.mode !== "dictation" || t.level === level) : trials);
  const connected = connectedRow(trials);
  const weeks = await weeklyMinutes(8);
  const totalMin = trials.filter((t) => t.mode === "extensive").reduce((a, t) => a + t.minutes, 0);
  const tips = suggestions({ perception: perception.filter((p) => p.hasData), dictation, extensiveMinutes: weeks });

  const dues = [
    ...perception.filter((p) => p.plan).map((p) => ({ title: `${p.title} の聞き分け`, plan: p.plan })),
    ...(stressPlan ? [{ title: "単語の強勢", plan: stressPlan }] : []),
  ];
  const measured = perception.filter((p) => p.hasData);
  const unmeasured = perception.filter((p) => !p.hasData);

  app.innerHTML = `
    <h1>聞き取り力のカルテ</h1>
    <section class="card">
      <p class="small">テストと練習の<strong>記録した成績</strong>と、その変化を能力ごとに並べています。英語のリスニング力全体を一つの点数で表すものではありません。</p>
      <ul class="small">
        <li><strong>初めての声・初めての単語</strong>：練習していない音声でも聞き分けられるか（練習した問題に慣れただけかを見分けるための指標）</li>
        <li><strong>幅</strong>：問題数が限られるため、本当の力はおよそこの範囲にあると考えられる範囲（95%）</li>
        <li><strong>差</strong>：初回から最新までの差を<strong>ポイント</strong>で表示（60%→75%なら +15ポイント）</li>
      </ul>
    </section>

    ${dues.length ? `
    <section class="card">
      <h2>保持テストの予定</h2>
      <p class="muted small">最後に練習した日から2週間後・4週間後に、力が保たれているかをテストで確かめます。</p>
      ${dues.map((d) => `<div class="due"><strong>${esc(d.title)}</strong>：${d.plan.map((p) => `${p.days / 7}週間後（${md(p.due)}）${p.done ? `実施済み（${md(p.done)}）` : p.overdue ? `<span class="late">時期です・未実施</span>` : "未実施"}`).join("、")}</div>`).join("")}
    </section>` : ""}

    <section class="card">
      <h2>次の練習の候補</h2>
      ${tips.length ? `<ul class="small">${tips.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : `<p class="small muted">今のところ、記録から言える候補はありません。</p>`}
      <p class="muted small">記録から機械的に出した候補です。</p>
    </section>

    <section class="card">
      <h2>音の聞き分け</h2>
      ${measured.length ? measured.map((p) => `
        <h3 class="chart-title">${esc(p.title)}</h3>
        ${p.older ? `<p class="muted small">音声を改良する前のテスト（${p.older}回）は、条件が違うため比較に含めていません。</p>` : ""}
        ${p.rows.map(indicator).join("")}
        ${perceptionChart(p.rows, 0.5)}`).join("")
        : `<p class="muted small">まだ記録がありません。各音の「事前テスト」から始めましょう。</p>`}
      ${unmeasured.length ? `<p class="muted small">未測定：${unmeasured.map((p) => esc(p.title)).join("、")}</p>` : ""}
    </section>

    <section class="card">
      <h2>単語の強勢</h2>
      ${section(stress, "「リズムと強勢」の事前テストから始められます。")}
      ${perceptionChart(stress, stress[2].chance || 0.4)}
    </section>

    <section class="card">
      <h2>書き取り${level ? `（レベル${level}）` : ""}</h2>
      ${section(dictation, "10文たまると表示されます。")}
      <p class="muted small">「初めての文」が主な指標です。「前に出た文」は文を覚えた効果を含みます。</p>
    </section>

    <section class="card">
      <h2>音の変化</h2>
      ${section([connected], "各レッスンの確認問題を受けると表示されます。")}
    </section>

    <section class="card">
      <h2>内容理解</h2>
      ${section([comprehensionRow()], "初めて聞く文章の内容理解テストは、まだありません（今後追加を検討）。")}
    </section>

    <section class="card">
      <h2>多聴の実績（学習量）</h2>
      <p class="small">合計 <strong>${totalMin}分</strong>。能力の指標ではなく、聞いた量の記録です。</p>
      ${weeks.some((w) => w.value > 0) ? barChart(weeks, { goal }) : `<p class="muted small">まだ記録がありません。</p>`}
    </section>

    <section class="card">
      <p class="muted small">ここに表示しているのは、このアプリのテストと練習の成績の推移です。テストの音声は音声合成のため、実際の会話を聞き取る力がどれだけ変わったかは、この画面だけでは分かりません。テストを受けた日：${tests.length ? tests.map((t) => fmtDate(t.date)).slice(-3).join("、") + (tests.length > 3 ? " ほか" : "") : "なし"}</p>
    </section>

    <button class="btn" type="button" data-nav="records">記録とデータ（数値の一覧）</button>
    <button class="btn" type="button" data-nav="home">ホームへ</button>
  `;
  bindTooltips(app);
}
