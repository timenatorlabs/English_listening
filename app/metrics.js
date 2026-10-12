// Pure functions that turn stored records into per-skill indicators (no DOM, no storage),
// unit-tested in tests/metrics.test.js.
//
// Principles (docs/english_listening_claudecode_improvement_plan.md §4):
// - no single "listening score"; each indicator states what it measures and under which condition
// - practised items, unseen talkers and unseen words are kept apart
// - show counts and an uncertainty range; never call a change "improvement" when it is within the range
// - differences are in percentage points (pp), not relative percent
// - no data → "未測定", never 0%

export const MIN_N = 20;          // below this, a change is not interpreted
export const PRACTICE_BLOCK = 50; // training answers per block for the "practice" indicator
export const DICTATION_BLOCK = 10; // sentences per block for dictation
const DAY = 86400000;

// 95% Wilson score interval for a proportion k/n. Returns [low, high] in 0..1.
export function wilson(k, n, z = 1.96) {
  if (!n) return null;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

export function measure(k, n, date, extra = {}) {
  if (!n) return null;
  return { k, n, p: k / n, ci: wilson(k, n), date, ...extra };
}

// Difference in percentage points, one decimal (e.g. 60% -> 75% = +15.0)
export const ppDiff = (a, b) => Math.round((b.p - a.p) * 1000) / 10;

export function judge(first, latest) {
  if (!latest) return { code: "none", text: "未測定" };
  if (!first || first === latest) return { code: "single", text: "初回の測定です。変化はまだ分かりません" };
  if (first.n < MIN_N || latest.n < MIN_N) return { code: "few", text: "問題数が少ないため、変化は判断できません" };
  const overlap = first.ci[1] >= latest.ci[0] && latest.ci[1] >= first.ci[0];
  if (overlap) return { code: "overlap", text: "差は誤差の範囲かもしれません" };
  return latest.p > first.p
    ? { code: "up", text: "誤差の範囲を超えて上がっています" }
    : { code: "down", text: "誤差の範囲を超えて下がっています" };
}

function row(key, label, condition, series, extra = {}) {
  const first = series[0] || null;
  const latest = series[series.length - 1] || null;
  return { key, label, condition, series, first, latest, diff: first && latest && first !== latest ? ppDiff(first, latest) : null, judge: judge(first, latest), ...extra };
}

function blocks(records, size, toKN) {
  const out = [];
  for (let i = 0; i + size <= records.length; i += size) {
    const chunk = records.slice(i, i + size);
    const kn = chunk.reduce((acc, r) => {
      const [k, n] = toKN(r);
      return [acc[0] + k, acc[1] + n];
    }, [0, 0]);
    out.push(measure(kn[0], kn[1], chunk[chunk.length - 1].date));
  }
  return out;
}

// First and latest block only (the middle is shown in graphs, not in the table)
const firstAndLast = (bs) => (bs.length > 1 ? [bs[0], bs[bs.length - 1]] : bs);

const contrastOf = (c) => (c === "r-l" ? "rl" : c);

// Test records made before multiple contrasts existed used r/l field names.
export function normalizeTest(t) {
  return {
    ...t,
    contrast: contrastOf(t.contrast),
    aTarget: t.aTarget || t.rTarget,
    bTarget: t.bTarget || t.lTarget,
  };
}

// ---------- minimal-pair perception (HVPT) ----------
// tests: normalized test records; trials: all trial records; version: current audio version
export function perceptionRows(contrastId, tests, trials, version = 1) {
  const all = tests.filter((t) => contrastOf(t.contrast) === contrastId);
  const current = all.filter((t) => (t.audioVersion || 1) === version);
  const practice = trials.filter((t) => t.mode === "train" && contrastOf(t.contrast) === contrastId);
  const pb = blocks(practice, PRACTICE_BLOCK, (t) => [t.correct ? 1 : 0, 1]);
  return {
    olderVersionTests: all.length - current.length,
    rows: [
      row("practice", "練習中の正答率", `訓練した単語 × 訓練で使う声（直近${PRACTICE_BLOCK}問ずつ。答えを見た直後の問題も含む）`, firstAndLast(pb), { chance: 0.5 }),
      row("speakers", "初めての声", "訓練した単語 × 訓練に使わない声（テスト）",
        current.map((t) => measure(t.trainedWords.correct, t.trainedWords.n, t.date, { kind: t.kind })).filter(Boolean), { chance: 0.5 }),
      row("words", "初めての単語", "訓練に使わない単語 × 訓練に使わない声（テスト）",
        current.map((t) => measure(t.newWords.correct, t.newWords.n, t.date, { kind: t.kind })).filter(Boolean), { chance: 0.5 }),
    ],
  };
}

// ---------- word stress ----------
export function stressRows(trials) {
  const tests = trials.filter((t) => t.mode === "stress-test");
  const practice = trials.filter((t) => t.mode === "stress" && !t.group);
  const pb = blocks(practice, PRACTICE_BLOCK, (t) => [t.correct ? 1 : 0, 1]);
  const chance = tests.length ? tests[tests.length - 1].chance / 100 : null;
  return [
    row("practice", "練習中の正答率", `訓練した単語 × 訓練で使う声（直近${PRACTICE_BLOCK}問ずつ）`, firstAndLast(pb), { chance }),
    row("speakers", "初めての声", "訓練した単語 × 訓練に使わない声（テスト）",
      tests.map((t) => measure(t.trainedWords.correct, t.trainedWords.n, t.date, { kind: t.kind })).filter(Boolean), { chance }),
    row("words", "初めての単語", "訓練に使わない単語 × 訓練に使わない声（テスト）",
      tests.map((t) => measure(t.newWords.correct, t.newWords.n, t.date, { kind: t.kind })).filter(Boolean), { chance }),
  ];
}

// ---------- dictation ----------
// Splits first attempts at a sentence from repeats; older records without firstTry are
// classified from the order of the history.
export function dictationRows(trials) {
  const recs = trials.filter((t) => t.mode === "dictation");
  const seen = new Set();
  const first = [];
  const repeat = [];
  for (const t of recs) {
    const isFirst = t.firstTry !== undefined ? t.firstTry : !seen.has(t.id);
    seen.add(t.id);
    (isFirst ? first : repeat).push(t);
  }
  const toKN = (t) => [t.matched, t.total];
  const cond = `${DICTATION_BLOCK}文ずつの単語正解率。同じ文の単語は互いに関係するため、幅は目安`;
  return [
    row("firstTry", "初めての文", cond, firstAndLast(blocks(first, DICTATION_BLOCK, toKN))),
    row("repeat", "前に出た文", `${cond}（文を覚えた効果を含む）`, firstAndLast(blocks(repeat, DICTATION_BLOCK, toKN))),
  ];
}

// ---------- connected-speech quiz (same items every time) ----------
export function connectedRow(trials) {
  const recs = trials.filter((t) => t.mode === "connected");
  const firstBy = new Map();
  const lastBy = new Map();
  for (const t of recs) {
    if (!firstBy.has(t.lesson)) firstBy.set(t.lesson, t);
    lastBy.set(t.lesson, t);
  }
  const sum = (m) => [...m.values()].reduce((a, t) => [a[0] + t.correct, a[1] + t.n], [0, 0]);
  const f = sum(firstBy);
  const l = sum(lastBy);
  const latestDate = recs.length ? recs[recs.length - 1].date : null;
  const series = recs.length ? [measure(f[0], f[1], recs[0].date), measure(l[0], l[1], latestDate)] : [];
  const same = recs.length === firstBy.size;   // nobody retried yet → first and latest are the same answers
  return row("connected", "音の変化の確認問題", "各レッスン5問。毎回同じ問題（訓練した問題のみ）", same ? series.slice(0, 1) : series);
}

// ---------- not yet measurable ----------
export function comprehensionRow() {
  return row("comprehension", "内容理解", "初めて聞く文章の意味が分かるか（このテストはまだありません）", []);
}

// ---------- test labels and retention ----------
export function lastTrainingDate(trials, mode, contrastId = null) {
  let last = null;
  for (const t of trials) {
    if (t.mode !== mode || t.group) continue;
    if (contrastId && contrastOf(t.contrast) !== contrastId) continue;
    if (!last || t.date > last) last = t.date;
  }
  return last;
}

// 事前 = first test; 事後 = training since the previous test; 遅延 = 14+ days after the
// last training without training in between; otherwise 再テスト.
export function testKind(previousDates, lastTraining, now = new Date().toISOString()) {
  if (!previousDates.length) return "事前";
  const lastTest = previousDates.reduce((a, b) => (a > b ? a : b));
  if (lastTraining && lastTraining > lastTest) return "事後";
  if (lastTraining && Date.parse(now) - Date.parse(lastTraining) >= 14 * DAY) return "遅延";
  return "再テスト";
}

// Retention checks at 14 and 28 days after the last training session.
export function retentionPlan(lastTraining, testDates, now = new Date().toISOString()) {
  if (!lastTraining) return null;
  const base = Date.parse(lastTraining);
  return [14, 28].map((days) => {
    const due = base + days * DAY;
    const done = testDates.find((d) => Date.parse(d) >= due - DAY);
    return { days, due: new Date(due).toISOString(), done: done || null, overdue: !done && Date.parse(now) >= due };
  });
}

// ---------- suggestions (candidates, not diagnoses) ----------
export function suggestions({ perception = [], dictation = [], extensiveMinutes = [] }) {
  const out = [];
  const val = (r) => (r && r.latest && r.latest.n >= MIN_N ? r.latest.p : null);
  for (const { title, rows } of perception) {
    const [practice, speakers, words] = rows;
    if (!speakers.latest && !words.latest) {
      out.push(`${title}：まだテストがありません。事前テストで基準を作ると、変化を確かめられます。`);
      continue;
    }
    const pr = val(practice);
    const wd = val(words);
    const sp = val(speakers);
    if (pr !== null && wd !== null && pr >= 0.8 && wd < 0.7) {
      out.push(`${title}：練習中は高いのに、初めての単語では低めです。訓練した単語に慣れただけの可能性があります。訓練を続けながら、テストで初めての単語の変化を確かめましょう。`);
    }
    if (pr !== null && sp !== null && pr - sp >= 0.15) {
      out.push(`${title}：声が変わると正答率が下がるようです。いろいろな声に慣れる練習（訓練は毎回ちがう声で出題）を続けましょう。`);
    }
  }
  const dFirst = val(dictation.find((r) => r.key === "firstTry"));
  const strongPerception = perception.some(({ rows }) => (val(rows[2]) || 0) >= 0.85);
  if (strongPerception && dFirst !== null && dFirst < 0.7) {
    out.push("音の聞き分けは高い一方で、初めての文の書き取りは低めです。音の変化、弱く発音される語、文全体の聞き取りを確認しましょう。");
  }
  if (extensiveMinutes.length >= 4) {
    const recent = extensiveMinutes.slice(-2).reduce((a, w) => a + w.value, 0);
    const before = extensiveMinutes.slice(-4, -2).reduce((a, w) => a + w.value, 0);
    const dRow = dictation.find((r) => r.key === "firstTry");
    if (recent > before && dRow && dRow.judge.code === "overlap") {
      out.push("多聴の時間は増えていますが、初めての文の書き取りにはまだ変化が見えません。素材の難しさ（「だいたい分かる」くらいか）を見直してみましょう。");
    }
  }
  return out;
}
