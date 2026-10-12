// Minimal single-series SVG charts (line and bar) with a tap/hover tooltip.
// Single series → no legend; the section title names the series.
import { esc } from "./util.js";

const W = 320;
const H = 170;
const PAD = { l: 34, r: 12, t: 12, b: 26 };

let uid = 0;

function frame(yMax, yTicks, unit) {
  const ih = H - PAD.t - PAD.b;
  return yTicks.map((v) => {
    const y = PAD.t + ih - (v / yMax) * ih;
    return `<line class="grid" x1="${PAD.l}" x2="${W - PAD.r}" y1="${y}" y2="${y}"/>
      <text class="axis" x="${PAD.l - 6}" y="${y + 3}" text-anchor="end">${v}${unit}</text>`;
  }).join("");
}

function xLabels(points, xOf) {
  const step = Math.max(1, Math.ceil(points.length / 6));
  return points.map((p, i) => (i % step === 0 || i === points.length - 1
    ? `<text class="axis" x="${xOf(i)}" y="${H - 8}" text-anchor="middle">${esc(p.label)}</text>` : "")).join("");
}

// points: [{ label, value, tip }]; refLine: optional y value drawn dashed (e.g. 50% chance level)
export function lineChart(points, { yMax = 100, yTicks = [0, 50, 100], unit = "%", refLine = null, refLabel = "" } = {}) {
  const id = `chart-${++uid}`;
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const xOf = (i) => PAD.l + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw);
  const yOf = (v) => PAD.t + ih - (Math.min(v, yMax) / yMax) * ih;
  const path = points.map((p, i) => `${i ? "L" : "M"}${xOf(i).toFixed(1)} ${yOf(p.value).toFixed(1)}`).join(" ");
  const last = points[points.length - 1];

  return `
  <div class="chart" id="${id}">
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="折れ線グラフ">
      ${frame(yMax, yTicks, unit)}
      ${refLine !== null ? `<line class="ref" x1="${PAD.l}" x2="${W - PAD.r}" y1="${yOf(refLine)}" y2="${yOf(refLine)}"/>
        <text class="axis" x="${W - PAD.r}" y="${yOf(refLine) - 4}" text-anchor="end">${esc(refLabel)}</text>` : ""}
      <path class="series-line" d="${path}"/>
      ${points.map((p, i) => `<circle class="series-dot" cx="${xOf(i)}" cy="${yOf(p.value)}" r="4"/>`).join("")}
      <text class="value-label" x="${xOf(points.length - 1)}" y="${yOf(last.value) - 9}" text-anchor="${points.length > 1 ? "end" : "middle"}">${last.value}${unit}</text>
      ${xLabels(points, xOf)}
      ${points.map((p, i) => `<circle class="hit" cx="${xOf(i)}" cy="${yOf(p.value)}" r="14" data-tip="${esc(p.tip || `${p.label}：${p.value}${unit}`)}"/>`).join("")}
    </svg>
    <div class="chart-tip" hidden></div>
  </div>`;
}

// Several series on one shared x axis (e.g. test 1, 2, 3 …).
// series: [{ name, cls: "s1" | "s2", points: [{ x, value, tip }] }] (x = index into xLabels)
// A legend is always shown and the last point of each series is labelled, so colour
// is never the only way to tell series apart. Missing points leave a gap.
export function multiLineChart(series, xLabels, { yMax = 100, yTicks = [0, 50, 100], unit = "%", refLine = null, refLabel = "" } = {}) {
  const id = `chart-${++uid}`;
  const iw = W - PAD.l - PAD.r - 30;   // room on the right for end labels
  const ih = H - PAD.t - PAD.b;
  const n = xLabels.length;
  const xOf = (i) => PAD.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
  const yOf = (v) => PAD.t + ih - (Math.min(v, yMax) / yMax) * ih;
  const markers = { s1: (x, y) => `<circle class="dot-s1" cx="${x}" cy="${y}" r="4"/>`, s2: (x, y) => `<rect class="dot-s2" x="${x - 4}" y="${y - 4}" width="8" height="8" rx="1"/>` };

  const lines = series.map((s) => {
    const pts = s.points.slice().sort((a, b) => a.x - b.x);
    const path = pts.map((p, i) => `${i ? "L" : "M"}${xOf(p.x).toFixed(1)} ${yOf(p.value).toFixed(1)}`).join(" ");
    const last = pts[pts.length - 1];
    return `
      ${pts.length > 1 ? `<path class="line-${s.cls}" d="${path}"/>` : ""}
      ${pts.map((p) => markers[s.cls](xOf(p.x), yOf(p.value))).join("")}
      ${last ? `<text class="value-label" x="${xOf(last.x) + 7}" y="${yOf(last.value) + 4}">${last.value}${unit}</text>` : ""}
      ${pts.map((p) => `<circle class="hit" cx="${xOf(p.x)}" cy="${yOf(p.value)}" r="14" data-tip="${esc(p.tip || `${s.name}：${p.value}${unit}`)}"/>`).join("")}`;
  }).join("");

  const step = Math.max(1, Math.ceil(n / 5));
  return `
  <div class="chart" id="${id}">
    <div class="legend">${series.map((s) => `<span><i class="key-${s.cls}"></i>${esc(s.name)}</span>`).join("")}</div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(series.map((s) => s.name).join("と"))}の推移">
      ${frame(yMax, yTicks, unit)}
      ${refLine !== null ? `<line class="ref" x1="${PAD.l}" x2="${PAD.l + iw}" y1="${yOf(refLine)}" y2="${yOf(refLine)}"/>
        <text class="axis" x="${PAD.l + iw}" y="${yOf(refLine) - 4}" text-anchor="end">${esc(refLabel)}</text>` : ""}
      ${xLabels.map((l, i) => (i % step === 0 || i === n - 1 ? `<text class="axis" x="${xOf(i)}" y="${H - 8}" text-anchor="middle">${esc(l)}</text>` : "")).join("")}
      ${lines}
    </svg>
    <div class="chart-tip" hidden></div>
  </div>`;
}

export function barChart(points, { unit = "分", goal = null } = {}) {
  const id = `chart-${++uid}`;
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const max = Math.max(goal || 0, ...points.map((p) => p.value), 1);
  const yMax = Math.ceil(max / 30) * 30;
  const slot = iw / points.length;
  const bw = Math.min(28, slot - 4);
  const xOf = (i) => PAD.l + slot * i + slot / 2;
  const yOf = (v) => PAD.t + ih - (v / yMax) * ih;
  const bar = (x, v) => {
    const top = yOf(v);
    const h = PAD.t + ih - top;
    if (h <= 0) return "";
    const r = Math.min(4, h, bw / 2);
    // rounded data end at the top, square at the baseline
    return `<path class="series-bar" d="M${x - bw / 2} ${PAD.t + ih} V${top + r} Q${x - bw / 2} ${top} ${x - bw / 2 + r} ${top} H${x + bw / 2 - r} Q${x + bw / 2} ${top} ${x + bw / 2} ${top + r} V${PAD.t + ih} Z"/>`;
  };

  return `
  <div class="chart" id="${id}">
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="棒グラフ">
      ${frame(yMax, [0, yMax / 2, yMax], unit)}
      ${goal ? `<line class="ref" x1="${PAD.l}" x2="${W - PAD.r}" y1="${yOf(goal)}" y2="${yOf(goal)}"/>
        <text class="axis" x="${W - PAD.r}" y="${yOf(goal) - 4}" text-anchor="end">目標 ${goal}${unit}</text>` : ""}
      ${points.map((p, i) => bar(xOf(i), p.value)).join("")}
      ${xLabels(points, xOf)}
      ${points.map((p, i) => `<rect class="hit" x="${xOf(i) - slot / 2}" y="${PAD.t}" width="${slot}" height="${ih}" data-tip="${esc(p.tip || `${p.label}：${p.value}${unit}`)}"/>`).join("")}
    </svg>
    <div class="chart-tip" hidden></div>
  </div>`;
}

// Call after inserting chart HTML into the page.
export function bindTooltips(root) {
  root.querySelectorAll(".chart").forEach((chart) => {
    const tip = chart.querySelector(".chart-tip");
    const show = (el) => {
      tip.textContent = el.dataset.tip;
      tip.hidden = false;
      const box = chart.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const x = Math.min(Math.max(r.left + r.width / 2 - box.left, 60), box.width - 60);
      tip.style.left = `${x}px`;
      tip.style.top = `${Math.max(r.top - box.top - 34, 0)}px`;
    };
    chart.querySelectorAll(".hit").forEach((el) => {
      el.addEventListener("pointerenter", () => show(el));
      el.addEventListener("click", () => show(el));
    });
    chart.addEventListener("pointerleave", () => (tip.hidden = true));
  });
}
