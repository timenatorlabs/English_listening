// Pure text-comparison and error-classification logic for dictation (no DOM, no storage),
// kept separate so it can be unit-tested (tests/scoring.test.js).
//
// The classification is an *estimate* of why a word was missed, based only on what
// was typed. It cannot know the real cause, so the UI presents it as "推定" and keeps
// the learner's own report separately.

export const FEATURE_NAMES = {
  linking: "連結（音がつながる）",
  reduction: "弱化・短縮（音が弱く短くなる）",
  elision: "脱落（音が消える）",
  assimilation: "同化（となりの音と混ざる）",
  flap: "はじき音（t がラ行のようになる）",
};

// Words that usually take a weak (reduced) form inside a sentence.
export const FUNCTION_WORDS = new Set(("a an the and but or as at for from of to than that can could would should must shall "
  + "have has had do does am are is was were be been he him his her them us you your some there 'd 's").split(" "));

const SPECIAL = { "can't": ["can", "not"], "won't": ["will", "not"], "let's": ["let", "us"] };
// 'd (had/would) and 's (is/has, or possessive) are ambiguous, so they stay as their own tokens.
const SUFFIX = { m: "am", re: "are", ve: "have", ll: "will", d: "'d", s: "'s" };

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

const AMBIGUOUS = { "'d": new Set(["had", "would"]), "'s": new Set(["is", "has"]) };
export const eq = (a, b) => a === b || (AMBIGUOUS[a] && AMBIGUOUS[a].has(b)) || (AMBIGUOUS[b] && AMBIGUOUS[b].has(a)) || false;

// Word-level edit-distance alignment. Returns ops: match / sub / del (missed) / ins (extra).
// Among alignments with the same edit cost, the one with the most matched words wins,
// so a correctly heard word is never scored as wrong just because of a tie.
export function align(target, typed) {
  const n = target.length;
  const m = typed.length;
  // cell = [cost, matches]; better = lower cost, then more matches
  const better = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] > b[1]);
  const d = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: m + 1 }, (_, j) => [i === 0 ? j : j === 0 ? i : 0, 0]));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const same = eq(target[i - 1], typed[j - 1]);
      let best = [d[i - 1][j - 1][0] + (same ? 0 : 1), d[i - 1][j - 1][1] + (same ? 1 : 0)];
      const del = [d[i - 1][j][0] + 1, d[i - 1][j][1]];
      const ins = [d[i][j - 1][0] + 1, d[i][j - 1][1]];
      if (better(del, best)) best = del;
      if (better(ins, best)) best = ins;
      d[i][j] = best;
    }
  }
  const ops = [];
  let i = n;
  let j = m;
  const is = (cell, cost, matches) => cell[0] === cost && cell[1] === matches;
  while (i > 0 || j > 0) {
    const cur = d[i][j];
    const same = i > 0 && j > 0 && eq(target[i - 1], typed[j - 1]);
    if (i > 0 && j > 0 && is(cur, d[i - 1][j - 1][0] + (same ? 0 : 1), d[i - 1][j - 1][1] + (same ? 1 : 0))) {
      ops.push({ type: same ? "match" : "sub", t: i - 1, u: j - 1 });
      i--;
      j--;
    } else if (i > 0 && is(cur, d[i - 1][j][0] + 1, d[i - 1][j][1])) {
      ops.push({ type: "del", t: i - 1 });
      i--;
    } else {
      ops.push({ type: "ins", u: j - 1 });
      j--;
    }
  }
  return ops.reverse();
}

// pairIndex: Map "word|word" -> contrast id (from the minimal-pair lists)
export function confusionContrast(target, typed, pairIndex) {
  if (!typed || target === typed) return null;
  const hit = pairIndex && pairIndex.get(`${target}|${typed}`);
  if (hit) return hit;
  // pairs that are not in the training lists: differ only by r/l, b/v or s/th
  for (const [x, y, id] of [["r", "l", "rl"], ["v", "b", "bv"], ["th", "s", "sth"]]) {
    if (target.split(x).join(y) === typed.split(x).join(y)) return id;
  }
  return null;
}

// Estimated cause for each missed word, in priority order:
//   change (inside a marked sound-change span) > confusion (minimal pair) > weak (function word) > other.
// The learner's "didn't know this word" report is NOT mixed in here; it is stored separately.
export function analyze(sentence, typedText, pairIndex) {
  const tgt = tokenize(sentence.text);
  const usr = tokenize(typedText);
  const tt = tgt.tokens.map((x) => x.t);
  const ops = align(tt, usr.tokens.map((x) => x.t));

  const featureAt = new Array(tt.length).fill(null);
  for (const f of sentence.features || []) {
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
    const contrast = confusionContrast(tok.t, typed, pairIndex);
    if (f) st.err = { cat: "change", feature: f.type };
    else if (contrast) st.err = { cat: "confusion", contrast };
    else if (FUNCTION_WORDS.has(tok.t)) st.err = { cat: "weak" };
    else st.err = { cat: "other" };
  }
  return { words: tgt.words, states, extras, matched, total: tt.length };
}
