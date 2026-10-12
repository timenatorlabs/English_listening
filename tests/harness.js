// Minimal browser test harness (no dependencies). Results are written into the page,
// where tools/run_tests.py reads them from a headless Edge.
const cases = [];

export function test(name, fn) {
  cases.push({ name, fn });
}

export function eq(actual, expected, msg = "") {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg} expected ${e}, got ${a}`);
}

export function close(actual, expected, tol = 1e-3, msg = "") {
  if (typeof actual !== "number" || Math.abs(actual - expected) > tol) throw new Error(`${msg} expected ≈${expected}, got ${actual}`);
}

export function ok(cond, msg = "assertion failed") {
  if (!cond) throw new Error(msg);
}

export async function run() {
  const list = document.getElementById("results");
  let pass = 0;
  let fail = 0;
  for (const c of cases) {
    const li = document.createElement("li");
    try {
      await c.fn();
      pass++;
      li.className = "pass";
      li.textContent = `PASS ${c.name}`;
    } catch (e) {
      fail++;
      li.className = "fail";
      li.textContent = `FAIL ${c.name}: ${e.message}`;
    }
    list.appendChild(li);
  }
  const summary = document.getElementById("summary");
  summary.textContent = `PASS ${pass} FAIL ${fail}`;
  summary.dataset.done = "1";
  // tools/run_tests.py waits for this report (ignored when the page is opened by hand)
  const lines = [...list.children].map((li) => li.textContent);
  fetch("/__results", { method: "POST", body: JSON.stringify({ pass, fail, lines }) }).catch(() => {});
}
