// Intonation (pitch contour) analysis and the comparison graph for shadowing.
// Pitch is estimated by autocorrelation every 10 ms; each voice is shown in semitones
// relative to its own median, so a high and a low voice can be compared by shape.
// Research note: real-time pitch displays improved learners' L2 intonation in
// production studies (Hardison 2004); effects on listening are indirect.

const HOP = 0.01;      // seconds per point
const SR = 8000;       // analysis rate (enough for 70–400 Hz voices)

function downsample(samples, rate) {
  const step = rate / SR;
  const n = Math.floor(samples.length / step);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    // average over the step = crude low-pass before decimation
    const a = Math.floor(i * step);
    const b = Math.max(a + 1, Math.floor((i + 1) * step));
    let s = 0;
    for (let j = a; j < b; j++) s += samples[j];
    out[i] = s / (b - a);
  }
  return out;
}

// Returns { f0: Float32Array (NaN = no voice), hop } for 10 ms steps.
export function f0Track(samples, rate) {
  const x = downsample(samples, rate);
  const frame = Math.round(0.04 * SR);
  const hop = Math.round(HOP * SR);
  const lo = Math.floor(SR / 400);
  const hi = Math.ceil(SR / 70);
  const frames = Math.max(0, Math.floor((x.length - frame - hi) / hop));
  const energy = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let s = 0;
    for (let i = 0; i < frame; i++) s += x[f * hop + i] ** 2;
    energy[f] = Math.sqrt(s / frame);
  }
  // Loudness gate relative to this recording (phone microphones record quietly; a fixed
  // threshold hid the whole learner contour in iPhone tests).
  const loud = [...energy].sort((a, b) => a - b)[Math.floor(frames * 0.95)] || 0;
  const f0 = new Float32Array(frames).fill(NaN);
  for (let f = 0; f < frames; f++) {
    if (energy[f] < Math.max(0.0005, loud * 0.12)) continue;
    const o = f * hop;
    let mean = 0;
    for (let i = 0; i < frame; i++) mean += x[o + i];
    mean /= frame;
    let r0 = 0;
    for (let i = 0; i < frame; i++) r0 += (x[o + i] - mean) ** 2;
    let best = -1;
    const r = new Float32Array(hi + 2);
    for (let lag = lo; lag <= hi + 1; lag++) {
      let s = 0;
      for (let i = 0; i < frame; i++) s += (x[o + i] - mean) * (x[o + i + lag] - mean);
      r[lag] = s;
      if (lag <= hi && s > best) best = s;
    }
    if (r0 <= 0 || best / r0 < 0.4) continue;
    // Take the SHORTEST lag whose peak is nearly as strong as the best one: multiples of
    // the true period score almost as high and would read the pitch an octave too low.
    let bestLag = 0;
    for (let lag = lo + 1; lag < hi; lag++) {
      if (r[lag] >= 0.85 * best && r[lag] >= r[lag - 1] && r[lag] >= r[lag + 1]) {
        bestLag = lag;
        break;
      }
    }
    if (!bestLag) continue;
    // parabolic interpolation around the peak for a smoother contour
    const a = r[bestLag - 1] || 0;
    const b = r[bestLag];
    const c = r[bestLag + 1] || 0;
    const shift = a - 2 * b + c ? (0.5 * (a - c)) / (a - 2 * b + c) : 0;
    f0[f] = SR / (bestLag + shift);
  }
  // fix octave jumps against the median, then a 5-point median filter
  const voiced = [...f0].filter((v) => !Number.isNaN(v)).sort((p, q) => p - q);
  const med = voiced[Math.floor(voiced.length / 2)];
  if (med) {
    for (let i = 0; i < frames; i++) {
      if (f0[i] > med * 1.8) f0[i] /= 2;
      else if (f0[i] < med * 0.55) f0[i] *= 2;
    }
  }
  const sm = new Float32Array(frames).fill(NaN);
  for (let i = 0; i < frames; i++) {
    if (Number.isNaN(f0[i])) continue;
    const w = [];
    for (let k = -2; k <= 2; k++) if (!Number.isNaN(f0[i + k])) w.push(f0[i + k]);
    w.sort((p, q) => p - q);
    sm[i] = w[Math.floor(w.length / 2)];
  }
  // drop voiced runs shorter than 50 ms: isolated readings are usually errors
  for (let i = 0; i < frames;) {
    if (Number.isNaN(sm[i])) {
      i++;
      continue;
    }
    let j = i;
    while (j < frames && !Number.isNaN(sm[j])) j++;
    if (j - i < 5) sm.fill(NaN, i, j);
    i = j;
  }
  return { f0: sm, hop: HOP, voicedRatio: voiced.length / Math.max(1, frames), medianHz: med || null };
}

// Semitones relative to the voice's own median (NaN stays NaN)
export function semitones(track) {
  const v = [...track.f0].filter((x) => !Number.isNaN(x)).sort((a, b) => a - b);
  const med = v[Math.floor(v.length / 2)];
  return Float32Array.from(track.f0, (x) => (Number.isNaN(x) || !med ? NaN : 12 * Math.log2(x / med)));
}

// Stretch a contour in time by factor k (k = 1 / playback rate)
export function stretch(arr, k) {
  const n = Math.round(arr.length * k);
  return Float32Array.from({ length: n }, (_, i) => arr[Math.min(arr.length - 1, Math.floor(i / k))]);
}

// How many points the learner lags behind the model (0–2.5 s), from voicing overlap.
export function bestLag(model, user, maxLag = 250) {
  let best = 0;
  let bestScore = -1;
  for (let lag = 0; lag <= maxLag; lag += 2) {
    let score = 0;
    for (let i = 0; i < model.length; i++) {
      const u = user[i + lag];
      if (u === undefined) break;
      if (!Number.isNaN(model[i]) && !Number.isNaN(u)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  return best;
}

function path(arr, x0, pxPerPoint, yOf) {
  let d = "";
  let pen = false;
  arr.forEach((v, i) => {
    // a jump of more than 4 semitones in 10 ms is a measurement error, not intonation: break the line
    if (Number.isNaN(v) || (i > 0 && !Number.isNaN(arr[i - 1]) && Math.abs(v - arr[i - 1]) > 4)) {
      pen = false;
      if (Number.isNaN(v)) return;
    }
    const x = (x0 + i * pxPerPoint).toFixed(1);
    const y = yOf(Math.max(-12, Math.min(12, v))).toFixed(1);
    d += `${pen ? "L" : "M"}${x} ${y} `;
    pen = true;
  });
  return d;
}

// Model and learner contours on one time axis (learner shifted back by `lag` points).
export function pitchChart(model, user, lag) {
  const H = 190;
  const pad = { l: 34, r: 10, t: 10, b: 24 };
  const px = 2;                      // pixels per 10 ms point → 200 px per second
  const n = Math.max(model.length, user.length - lag);
  const W = Math.max(320, pad.l + pad.r + n * px);
  const ih = H - pad.t - pad.b;
  const yOf = (st) => pad.t + ih / 2 - (st / 12) * (ih / 2);
  const grid = [-10, -5, 0, 5, 10].map((st) => `
    <line class="${st === 0 ? "ref" : "grid"}" x1="${pad.l}" x2="${W - pad.r}" y1="${yOf(st)}" y2="${yOf(st)}"/>`).join("");
  const seconds = Array.from({ length: Math.floor((n * HOP)) + 1 }, (_, s) => `
    <text class="axis" x="${pad.l + (s / HOP) * px}" y="${H - 6}" text-anchor="middle">${s}秒</text>`).join("");
  const userShifted = user.slice(lag);
  return `
  <div class="chart pitch">
    <div class="legend"><span><i class="key-s1"></i>お手本</span><span><i class="key-s2"></i>自分の声</span></div>
    <div class="hscroll">
      <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="お手本と自分の声の高さの変化">
        ${grid}
        <text class="axis" x="${pad.l - 6}" y="${yOf(8) + 3}" text-anchor="end">高</text>
        <text class="axis" x="${pad.l - 6}" y="${yOf(0) + 3}" text-anchor="end">中</text>
        <text class="axis" x="${pad.l - 6}" y="${yOf(-8) + 3}" text-anchor="end">低</text>
        ${seconds}
        <path class="line-s1" d="${path(model, pad.l, px, yOf)}"/>
        <path class="line-s2" d="${path(userShifted, pad.l, px, yOf)}"/>
      </svg>
    </div>
  </div>`;
}

// Karaoke-style view (like karaoke scoring screens): the model is drawn as one thick bar per
// word, slanted from the word's start pitch to its end pitch; the learner's pitch is a thin
// line on top, highlighted where it is within `tol` semitones of the model bar.
// Returns { svg, score } — score = share of the learner's measured points that were close
// to the model (null when too few points were measured).
export function karaokeChart(m, u, words, tol = 2.5) {
  const W = 320;
  const H = 168;
  const pad = { l: 22, r: 6, t: 12, b: 40 };
  const n = Math.max(m.length, u.length, 1);
  const px = (W - pad.l - pad.r) / n;
  const ih = H - pad.t - pad.b;
  const clamp = (v) => Math.max(-10, Math.min(10, v));
  const yOf = (st) => pad.t + ih / 2 - (clamp(st) / 10) * (ih / 2);
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

  const bars = words.map((w) => {
    const v = [...m.slice(w.a, w.b)].filter((x) => !Number.isNaN(x));
    if (v.length < 3) return null;
    const k = Math.max(1, Math.floor(v.length / 3));
    return { ...w, s0: mean(v.slice(0, k)), s1: mean(v.slice(-k)) };
  });
  const barAt = (i) => {
    const b = bars.find((x) => x && i >= x.a && i < x.b);
    return b ? b.s0 + ((b.s1 - b.s0) * (i - b.a)) / Math.max(1, b.b - b.a) : null;
  };

  let hits = 0;
  let measured = 0;
  let hitPath = "";
  let pen = false;
  for (let i = 0; i < u.length; i++) {
    const target = barAt(i);
    const v = u[i];
    const ok = target !== null && !Number.isNaN(v) && Math.abs(v - target) <= tol;
    if (target !== null && !Number.isNaN(v)) {
      measured++;
      if (ok) hits++;
    }
    if (ok) {
      hitPath += `${pen ? "L" : "M"}${(pad.l + i * px).toFixed(1)} ${yOf(v).toFixed(1)} `;
      pen = true;
    } else {
      pen = false;
    }
  }

  const svg = `
    <svg class="karaoke" viewBox="0 0 ${W} ${H}" role="img" aria-label="お手本の高さのバーと自分の声の線">
      <line class="ref" x1="${pad.l}" x2="${W - pad.r}" y1="${yOf(0)}" y2="${yOf(0)}"/>
      <text class="axis" x="${pad.l - 4}" y="${yOf(7) + 3}" text-anchor="end">高</text>
      <text class="axis" x="${pad.l - 4}" y="${yOf(-7) + 3}" text-anchor="end">低</text>
      ${bars.map((b) => (b ? `<line class="k-bar ${b.strong ? "strong" : ""}" x1="${(pad.l + b.a * px + 2).toFixed(1)}" y1="${yOf(b.s0).toFixed(1)}" x2="${(pad.l + b.b * px - 2).toFixed(1)}" y2="${yOf(b.s1).toFixed(1)}"/>` : "")).join("")}
      <path class="k-user" d="${path(u, pad.l, px, yOf)}"/>
      <path class="k-hit" d="${hitPath}"/>
      ${words.map((w, i) => `<text class="word-label ${w.strong ? "strong" : ""}" x="${(pad.l + ((w.a + w.b) / 2) * px).toFixed(1)}" y="${H - pad.b + 16 + (i % 2) * 13}" text-anchor="middle">${w.w.replace(/[.,!?"<>&]/g, "")}</text>`).join("")}
    </svg>`;
  return { svg, score: measured >= 15 ? hits / measured : null };
}

// Refine the lag for one sentence: shadowing delay changes during a passage.
export function localLag(model, user, start, end, base, range = 50) {
  let best = base;
  let bestScore = -1;
  for (let d = -range; d <= range; d += 2) {
    const lag = base + d;
    if (lag < 0) continue;
    let score = 0;
    for (let i = start; i < end; i++) {
      const u = user[i + lag];
      if (u !== undefined && !Number.isNaN(model[i]) && !Number.isNaN(u)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  return best;
}

export const voicedShare = (arr) => (arr.length ? [...arr].filter((v) => !Number.isNaN(v)).length / arr.length : 0);

// Direction of the pitch within one word (same rule as tools/word_prosody.py):
// mean of the last third minus mean of the first third, ±1 semitone.
export function wordDirection(arr) {
  const v = [...arr].filter((x) => !Number.isNaN(x));
  if (v.length < 4) return null;
  const k = Math.max(2, Math.floor(v.length / 3));
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const delta = mean(v.slice(-k)) - mean(v.slice(0, k));
  return delta > 1 ? "up" : delta < -1 ? "down" : "flat";
}

export const ARROW = { up: "↗", down: "↘", flat: "" };

// One sentence, scaled to the card width (no horizontal scrolling).
// words (optional): [{ w, a, b, strong }] with a/b = point indices inside m.
export function sentenceChart(m, u, words = []) {
  const W = 320;
  const H = words.length ? 150 : 120;
  const pad = { l: 22, r: 6, t: 8, b: words.length ? 38 : 8 };
  const n = Math.max(m.length, u.length, 1);
  const px = (W - pad.l - pad.r) / n;
  const ih = H - pad.t - pad.b;
  const yOf = (st) => pad.t + ih / 2 - (st / 12) * (ih / 2);
  return `
    <svg class="sentence-pitch" viewBox="0 0 ${W} ${H}" role="img" aria-label="この文のお手本と自分の声の高さの変化">
      <line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${yOf(6)}" y2="${yOf(6)}"/>
      <line class="ref" x1="${pad.l}" x2="${W - pad.r}" y1="${yOf(0)}" y2="${yOf(0)}"/>
      <line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${yOf(-6)}" y2="${yOf(-6)}"/>
      <text class="axis" x="${pad.l - 4}" y="${yOf(6) + 3}" text-anchor="end">高</text>
      <text class="axis" x="${pad.l - 4}" y="${yOf(-6) + 3}" text-anchor="end">低</text>
      ${words.map((w, i) => {
        const x0 = pad.l + w.a * px;
        const xm = pad.l + ((w.a + w.b) / 2) * px;
        // alternate two label rows so short neighbouring words do not overlap
        const y = H - pad.b + 14 + (i % 2) * 13;
        return `<line class="word-sep" x1="${x0}" x2="${x0}" y1="${pad.t}" y2="${H - pad.b}"/>
          <text class="word-label ${w.strong ? "strong" : ""}" x="${xm}" y="${y}" text-anchor="middle">${w.w.replace(/[.,!?"<>&]/g, "")}</text>`;
      }).join("")}
      <path class="line-s1" d="${path(m, pad.l, px, yOf)}"/>
      <path class="line-s2" d="${path(u, pad.l, px, yOf)}"/>
    </svg>`;
}

// Share of points where both have voice and move in the same direction (rising/falling).
// Only a rough guide; shown with that caveat.
export function directionAgreement(model, user, lag, minPoints = 20) {
  let same = 0;
  let total = 0;
  for (let i = 5; i < model.length; i++) {
    const m0 = model[i - 5];
    const m1 = model[i];
    const u0 = user[i - 5 + lag];
    const u1 = user[i + lag];
    if ([m0, m1, u0, u1].some((v) => v === undefined || Number.isNaN(v))) continue;
    const dm = m1 - m0;
    const du = u1 - u0;
    if (Math.abs(dm) < 0.5) continue;   // ignore flat parts
    total++;
    if (Math.sign(dm) === Math.sign(du)) same++;
  }
  return total >= minPoints ? same / total : null;
}

export const pitchNote = () => `<p class="muted small">声の高さの上がり下がり（抑揚）を比べるグラフです。グラフの左から右へ時間が進み、線が上にあるほど声が高いことを表します。声の高さは人によって違うため、それぞれの平均の高さを真ん中の点線にそろえ、上がり下がりの「形」を比べます。線がとぎれている所は、声が出ていないか、高さを測れなかった所です。</p>`;
