import { test, eq, ok, close } from "./harness.js";
import { contourCorrelation, correlationLabel } from "../app/pitch.js";

test("contourCorrelation: same shape = 1, opposite = -1, gaps ignored, too few points = null", () => {
  const m = Float32Array.from({ length: 40 }, (_, i) => Math.sin(i / 5));
  const same = Float32Array.from(m, (v) => v * 2 + 3);          // same shape, other range/height
  const opp = Float32Array.from(m, (v) => -v);
  close(contourCorrelation(m, same).r, 1, 1e-6);
  close(contourCorrelation(m, opp).r, -1, 1e-6);
  const gappy = Float32Array.from(same, (v, i) => (i % 3 === 0 ? NaN : v));
  close(contourCorrelation(m, gappy).r, 1, 1e-6);
  eq(contourCorrelation(m.slice(0, 10), same.slice(0, 10)), null);
  eq([correlationLabel(0.8), correlationLabel(0.5), correlationLabel(0.1), correlationLabel(-0.3)], ["よく似ている", "ある程度似ている", "違いが大きい", "ほぼ逆の動き"]);
});
import {
  wilson, measure, ppDiff, judge, perceptionRows, stressRows, dictationRows, connectedRow,
  testKind, retentionPlan, normalizeTest, suggestions, MIN_N,
} from "../app/metrics.js";

const day = (n) => new Date(Date.UTC(2026, 0, 1 + n)).toISOString();

test("wilson: known values", () => {
  const [lo, hi] = wilson(28, 40);
  close(lo, 0.5457, 1e-3);
  close(hi, 0.8193, 1e-3);
  eq(wilson(0, 0), null);
  const [l0, h0] = wilson(0, 10);
  eq(l0, 0);
  ok(h0 > 0.2 && h0 < 0.35);
});

test("ppDiff: percentage points, not relative percent", () => {
  eq(ppDiff(measure(24, 40), measure(30, 40)), 15);   // 60% -> 75% = +15pp (relative +25%)
  eq(ppDiff(measure(30, 40), measure(24, 40)), -15);
});

test("judge: none / single / few / overlap / up / down", () => {
  eq(judge(null, null).code, "none");
  const m = measure(30, 40);
  eq(judge(m, m).code, "single");
  eq(judge(measure(5, 10), measure(9, 10)).code, "few");
  eq(judge(measure(24, 40), measure(28, 40)).code, "overlap");
  eq(judge(measure(20, 40), measure(38, 40)).code, "up");
  eq(judge(measure(38, 40), measure(20, 40)).code, "down");
  ok(MIN_N === 20);
});

test("perceptionRows: separates practice, unseen voices, unseen words; legacy r-l records", () => {
  const tests = [
    normalizeTest({ contrast: "r-l", date: day(0), kind: "事前", n: 40, correct: 24, newWords: { n: 20, correct: 11 }, trainedWords: { n: 20, correct: 13 }, rTarget: { n: 20, correct: 12 }, lTarget: { n: 20, correct: 12 } }),
    { contrast: "rl", date: day(10), kind: "事後", n: 40, correct: 34, newWords: { n: 20, correct: 16 }, trainedWords: { n: 20, correct: 18 }, audioVersion: 2 },
  ];
  const trials = [];
  for (let i = 0; i < 100; i++) trials.push({ mode: "train", contrast: i < 50 ? "r-l" : "rl", correct: i >= 50 || i % 2 === 0, date: day(i < 50 ? 1 : 9) });
  const v1 = perceptionRows("rl", tests, trials, 1);
  eq(v1.olderVersionTests, 1);                 // the v2 test is not mixed into v1
  eq(v1.rows[2].series.length, 1);
  const v2 = perceptionRows("rl", tests, trials, 2);
  eq(v2.rows[1].latest.k, 18);
  eq(v2.rows[2].latest.k, 16);
  eq(v2.rows[2].judge.code, "single");
  const practice = v2.rows[0];
  eq([practice.first.k, practice.first.n, practice.latest.k, practice.latest.n], [25, 50, 50, 50]);
  eq(practice.diff, 50);
});

test("perceptionRows: no data -> 未測定 (not 0%)", () => {
  const r = perceptionRows("bv", [], [], 2);
  ok(r.rows.every((x) => x.judge.code === "none" && x.latest === null));
});

test("stressRows: tests and training answers", () => {
  const trials = [
    { mode: "stress", correct: true, date: day(0) },
    { mode: "stress", group: "new", correct: false, date: day(1) },   // test answer: not practice
    { mode: "stress-test", date: day(1), kind: "事前", n: 20, correct: 12, newWords: { n: 10, correct: 5 }, trainedWords: { n: 10, correct: 7 }, chance: 40 },
  ];
  const rows = stressRows(trials);
  eq(rows[0].latest, null);            // fewer than one block of practice
  eq(rows[2].latest.k, 5);
  close(rows[2].chance, 0.4);
});

test("dictationRows: first attempts vs repeats (old records without firstTry)", () => {
  const trials = [];
  for (let i = 0; i < 12; i++) trials.push({ mode: "dictation", id: `1-${i}`, matched: 3, total: 5, date: day(i) });
  for (let i = 0; i < 10; i++) trials.push({ mode: "dictation", id: `1-${i}`, matched: 5, total: 5, date: day(20 + i) });
  const [first, repeat] = dictationRows(trials);
  eq([first.latest.k, first.latest.n], [30, 50]);   // only one full block of 10 first attempts
  eq(first.judge.code, "single");
  eq([repeat.latest.k, repeat.latest.n], [50, 50]);
});

test("connectedRow: first attempt per lesson vs latest; single attempt is not a change", () => {
  const once = connectedRow([{ mode: "connected", lesson: "linking", correct: 3, n: 5, date: day(0) }]);
  eq(once.series.length, 1);
  const twice = connectedRow([
    { mode: "connected", lesson: "linking", correct: 3, n: 5, date: day(0) },
    { mode: "connected", lesson: "linking", correct: 5, n: 5, date: day(3) },
  ]);
  eq([twice.first.k, twice.latest.k], [3, 5]);
  eq(twice.judge.code, "few");
});

test("testKind: 事前 / 事後 / 遅延 / 再テスト", () => {
  eq(testKind([], null, day(0)), "事前");
  eq(testKind([day(0)], day(3), day(4)), "事後");
  eq(testKind([day(5)], day(3), day(20)), "遅延");
  eq(testKind([day(5)], day(3), day(8)), "再テスト");
});

test("retentionPlan: due dates and completion", () => {
  const plan = retentionPlan(day(0), [day(15)], day(30));
  eq(plan.map((p) => p.days), [14, 28]);
  ok(plan[0].done && !plan[0].overdue);
  ok(!plan[1].done && plan[1].overdue);
  eq(retentionPlan(null, [], day(0)), null);
});

test("suggestions: practice high but new words low", () => {
  const rows = [
    { latest: measure(45, 50) }, { latest: measure(16, 20) }, { latest: measure(10, 20) },
  ];
  const s = suggestions({ perception: [{ title: "/r/ と /l/", rows }] });
  ok(s.some((x) => x.includes("初めての単語では低め")));
});
