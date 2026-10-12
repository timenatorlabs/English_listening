import { test, eq, ok } from "./harness.js";
import { tokenize, eq as same, align, analyze, confusionContrast } from "../app/scoring.js";

const toks = (s) => tokenize(s).tokens.map((x) => x.t);
const pairs = new Map([["right|light", "rl"], ["light|right", "rl"]]);

test("tokenize: contractions expand", () => {
  eq(toks("I'm not sure."), ["i", "am", "not", "sure"]);
  eq(toks("Don't you think it's too expensive?"), ["do", "not", "you", "think", "it", "'s", "too", "expensive"]);
  eq(toks("You'd better"), ["you", "'d", "better"]);
  eq(toks("can't won't let's"), ["can", "not", "will", "not", "let", "us"]);
});

test("tokenize: curly apostrophe and punctuation", () => {
  eq(toks("I’ll see you, \"Ken\"!"), ["i", "will", "see", "you", "ken"]);
});

test("tokenize: keeps original word index", () => {
  eq(tokenize("I'm here").tokens.map((x) => x.w), [0, 0, 1]);
});

test("eq: 'd matches had/would, 's matches is/has", () => {
  ok(same("'d", "had") && same("would", "'d"));
  ok(same("'s", "is") && same("has", "'s"));
  ok(!same("'s", "was") && !same("'d", "did"));
  ok(!same("is", "has"), "is and has are different words");
});

test("analyze: I am == I'm", () => {
  const r = analyze({ text: "I'm not sure.", features: [] }, "I am not sure", pairs);
  eq([r.matched, r.total], [4, 4]);
});

test("analyze: it's == it has (ambiguous 's)", () => {
  const r = analyze({ text: "It's been a long day.", features: [] }, "it has been a long day", pairs);
  eq(r.matched, r.total);
});

test("align: missed and extra words", () => {
  const ops = align(["i", "want", "to", "go"], ["i", "wanna", "go", "now"]).map((o) => o.type);
  eq(ops.filter((t) => t === "match").length, 2);
  ok(ops.includes("ins"));
});

test("analyze: priority change > confusion > weak > other", () => {
  const sentence = { text: "I want to go to the park.", features: [{ span: "want to", type: "reduction" }] };
  const r = analyze(sentence, "I wanna go the bark", pairs);
  const err = (w) => r.states[r.words.findIndex((x) => x.replace(/\W/g, "") === w)].err;
  eq(err("want").cat, "change");
  eq(err("want").feature, "reduction");
  eq(r.states[4].err.cat, "weak");   // second "to" (index 4) missed, function word
  eq(err("park").cat, "other");      // park -> bark is not a known contrast
});

test("analyze: minimal-pair confusion", () => {
  const r = analyze({ text: "Turn right here.", features: [] }, "turn light here", pairs);
  eq(r.states[1].err, { cat: "confusion", contrast: "rl" });
});

test("confusionContrast: heuristics outside the lists", () => {
  eq(confusionContrast("rock", "lock", new Map()), "rl");
  eq(confusionContrast("vest", "best", new Map()), "bv");
  eq(confusionContrast("think", "sink", new Map()), "sth");
  eq(confusionContrast("park", "bark", new Map()), null);
});

test("analyze: learner self-report does not change the automatic estimate", () => {
  // analyze has no 'unknown' input any more; the estimate depends on the text only
  const r1 = analyze({ text: "We need some vitamins.", features: [] }, "we need some", pairs);
  eq(r1.states[3].err.cat, "other");
});

test("analyze: empty answer counts every word as missed", () => {
  const r = analyze({ text: "Let me see.", features: [] }, "", pairs);
  eq([r.matched, r.total], [0, 3]);
});
