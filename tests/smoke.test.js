// Opens the real app in an iframe (same origin) and walks through the main screens,
// failing on any uncaught error. Uses the test page's own IndexedDB, not the user's.
import { test, ok } from "./harness.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(fn, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if (fn()) return true;
    } catch (e) { /* not ready yet */ }
    await sleep(100);
  }
  return false;
}

let frame = null;
const errors = [];

async function openApp() {
  if (frame) return frame;
  frame = document.createElement("iframe");
  frame.style.width = "390px";   // phone width
  frame.style.height = "800px";
  frame.src = "../app/index.html";
  document.body.appendChild(frame);
  await until(() => frame.contentWindow && frame.contentDocument.readyState === "complete");
  frame.contentWindow.addEventListener("error", (e) => errors.push(e.message));
  frame.contentWindow.addEventListener("unhandledrejection", (e) => errors.push(String(e.reason)));
  ok(await until(() => frame.contentDocument.querySelector("#go-dictation")), "home screen did not render");
  return frame;
}

const doc = () => frame.contentDocument;
const text = () => doc().getElementById("app").textContent;
const heading = () => (doc().querySelector("#app h1") || {}).textContent || "";
const click = (sel) => doc().querySelector(sel).click();

test("smoke: home renders", async () => {
  await openApp();
  ok(text().includes("音の聞き分け訓練"));
  ok(errors.length === 0, errors.join(" | "));
});

test("smoke: karte renders with no data (未測定, not 0%)", async () => {
  await openApp();
  click('[data-nav="progress"]');
  ok(await until(() => heading() === "聞き取り力のカルテ"), `karte did not render (h1: ${heading()})`);
  ok(text().includes("未測定"), "no 未測定 label");
  ok(!/(^|[^0-9])0%/.test(text().replace(/幅 0〜/g, "")), "a 0% value is shown for missing data");
  ok(errors.length === 0, errors.join(" | "));
});

test("smoke: contrast menu, guide and first training item", async () => {
  await openApp();
  click('[data-nav="home"]');
  ok(await until(() => doc().querySelector('[data-contrast="rl"]')), "contrast button missing");
  click('[data-contrast="rl"]');
  ok(await until(() => doc().querySelector("#go-guide")), `contrast menu did not render (h1: ${heading()})`);
  click("#go-guide");
  ok(await until(() => heading().includes("口の形")), `guide did not render (h1: ${heading()})`);
  click("#go-train");
  ok(await until(() => doc().querySelectorAll(".answer").length === 2), "training item did not render");
  click(".answer");
  ok(await until(() => doc().querySelector("#next")), "feedback did not appear");
  ok(errors.length === 0, errors.join(" | "));
});

test("smoke: dictation check shows estimate labels and self-report", async () => {
  await openApp();
  click('[data-nav="home"]');
  ok(await until(() => doc().querySelector("#go-dictation")));
  click("#go-dictation");
  // first run asks for a level
  if (await until(() => doc().querySelector("[data-level]"), 3000)) click('[data-level="1"]');
  ok(await until(() => doc().querySelector("#answer")), "dictation did not start");
  doc().querySelector("#answer").value = "zzz";
  click("#check");
  ok(await until(() => text().includes("推定：")), "estimate label missing");
  ok(text().includes("聞き取れなかった理由"), "self-report section missing");
  click('[data-cause="vocab"]');
  ok(await until(() => doc().querySelector("[data-unknown]")), "unknown-word chips missing");
  click("#next");
  ok(errors.length === 0, errors.join(" | "));
});

test("smoke: karte with data shows counts, ranges, differences and a chart", async () => {
  await openApp();
  const db = await import("../app/db.js");
  const day = (n) => new Date(Date.UTC(2026, 0, 1 + n)).toISOString();
  await db.addTest({ contrast: "rl", date: day(0), kind: "事前", n: 40, correct: 22, audioVersion: 2,
    newWords: { n: 20, correct: 10 }, trainedWords: { n: 20, correct: 12 }, aTarget: { n: 20, correct: 11 }, bTarget: { n: 20, correct: 11 } });
  await db.addTest({ contrast: "rl", date: day(20), kind: "事後", n: 40, correct: 36, audioVersion: 2,
    newWords: { n: 20, correct: 17 }, trainedWords: { n: 20, correct: 19 }, aTarget: { n: 20, correct: 18 }, bTarget: { n: 20, correct: 18 } });
  for (let i = 0; i < 100; i++) await db.addTrial({ mode: "train", contrast: "rl", correct: i > 40, date: day(1 + Math.floor(i / 10)) });
  click('[data-nav="home"]');
  await until(() => doc().querySelector('[data-nav="progress"]'));
  click('[data-nav="progress"]');
  ok(await until(() => heading() === "聞き取り力のカルテ"), "karte did not render");
  ok(await until(() => text().includes("17/20")), "latest count missing");
  ok(text().includes("+35.0"), `difference in points missing: ${text().match(/[+-]\d+\.\d/g)}`);
  ok(text().includes("幅"), "uncertainty range missing");
  ok(doc().querySelector(".legend") && doc().querySelector(".line-s1"), "comparison chart missing");
  ok(text().includes("保持テストの予定"), "retention plan missing");
  ok(errors.length === 0, errors.join(" | "));
});

test("smoke: shadowing records for the whole model playback", async () => {
  await openApp();
  click('[data-nav="home"]');
  ok(await until(() => doc().querySelector("#go-shadowing")), "home missing");
  click("#go-shadowing");
  ok(await until(() => doc().querySelector('[data-passage="1-a"]')), "passage list missing");
  click('[data-passage="1-a"]');
  ok(await until(() => doc().querySelector('[data-step="2"]')), "passage did not open");
  click('[data-step="2"]');
  ok(await until(() => doc().querySelector("#record") && !doc().querySelector("#record").disabled), "record button missing or disabled");
  const started = Date.now();
  click("#record");
  ok(await until(() => doc().querySelector("#record").textContent.includes("録音中"), 5000), "recording did not start");
  // the model audio of 5 sentences lasts several seconds; recording must not stop right away
  ok(await until(() => doc().querySelector('[data-sentence="2"].now'), 20000), "playback did not reach the 3rd sentence while recording");
  ok(doc().querySelector("#record").textContent.includes("録音中"), "recording stopped early");
  ok(await until(() => doc().querySelector("#play-mine") || doc().querySelector("#mine .qa-note"), 40000), "recording result missing");
  ok(!doc().querySelector("#mine .qa-note"), "recording was judged silent (fake microphone should give sound)");
  ok(Date.now() - started > 4000, `recording ended too soon (${Date.now() - started} ms)`);
  // pitch comparison graph
  click("#show-pitch");
  ok(await until(() => doc().querySelector("#pitch-box .karaoke"), 30000), "karaoke pitch chart did not render");
  ok(doc().querySelectorAll("#pitch-box .k-bar").length > 5, "model word bars are missing");
  ok(doc().querySelectorAll("#pitch-box .gw").length > 10, "word guide is missing in the result");
  ok(errors.length === 0, errors.join(" | "));
});

test("smoke: leaving the screen during a mic test causes no error", async () => {
  await openApp();
  ok(await until(() => doc().querySelector("#mic-test")), "mic test button missing");
  click("#mic-test");
  ok(await until(() => doc().querySelector("#mic-test").textContent.includes("録音中")), "mic test did not start");
  click("#back");                                   // leave while recording
  await sleep(5000);                                // let the 4 s timer finish
  ok(errors.length === 0, errors.join(" | "));
  click('[data-passage="1-a"]');
  ok(await until(() => doc().querySelector('[data-step="2"]')));
  click('[data-step="2"]');
  ok(await until(() => doc().querySelector("#mic-test")));
});

test("smoke: microphone test records without the model audio", async () => {
  await openApp();
  ok(await until(() => doc().querySelector("#mic-test")), "mic test button missing (run after the shadowing test)");
  click("#mic-test");
  ok(await until(() => doc().querySelector("#mic-test").textContent.includes("録音中")), "mic test did not start");
  ok(await until(() => doc().querySelector("#play-mine") || doc().querySelector("#mine .qa-note"), 10000), "mic test result missing");
  ok(!doc().querySelector("#mine .qa-note"), "mic test was judged silent");
  ok(errors.length === 0, errors.join(" | "));
});

test("smoke: benefit cards are shown (home and practice screens)", async () => {
  await openApp();
  click('[data-nav="home"]');
  ok(await until(() => text().includes("できるようになること")), "home benefit lines missing");
  click("#go-rhythm");
  ok(await until(() => text().includes("この練習で何ができるようになるか")), "rhythm benefit card missing");
  ok(errors.length === 0, errors.join(" | "));
});

for (const sid of ["voa", "bbc", "ted", "librivox"]) {
  test(`smoke (network): ${sid} episodes load and play inside the app`, async () => {
    await openApp();
    click('[data-nav="home"]');
    ok(await until(() => doc().querySelector("#go-extensive")), "home missing");
    click("#go-extensive");
    ok(await until(() => doc().querySelector(`[data-feed="${sid}"]`)), "in-app listen button missing");
    click(`[data-feed="${sid}"]`);
    ok(await until(() => doc().querySelector("[data-ep]"), 20000), "episode list did not load");
    // publishers occasionally fail a single file: try up to three episodes
    let audio = null;
    for (let k = 0; k < 3 && !audio; k++) {
      if (k) {
        click("#back");
        ok(await until(() => doc().querySelector(`[data-ep="${k}"]`), 20000), "episode list did not reload");
      }
      click(`[data-ep="${k}"]`);
      ok(await until(() => doc().querySelector("#ep-audio")), "episode screen missing");
      const a = doc().querySelector("#ep-audio");
      ok(a.src.startsWith("https://"), `audio is not https: ${a.src}`);
      try {
        await a.play();
        if (await until(() => a.currentTime > 1, 30000)) audio = a;
      } catch (e) { /* try the next episode */ }
    }
    ok(audio, "none of the first three episodes played (network needed)");
    audio.pause();
    ok(await until(() => doc().querySelector("#listened").textContent !== "0分0秒"), "listening time not counted");
    ok(errors.length === 0, errors.join(" | "));
  });
}

test("smoke: shadowing offers female and male voices", async () => {
  await openApp();
  click('[data-nav="home"]');
  ok(await until(() => doc().querySelector("#go-shadowing")));
  click("#go-shadowing");
  ok(await until(() => doc().querySelector('[data-passage="2-a"]')));
  click('[data-passage="2-a"]');
  ok(await until(() => doc().querySelector("[data-speaker]")), "voice buttons missing");
  const labels = [...doc().querySelectorAll("[data-speaker]")].map((b) => b.textContent);
  ok(labels.some((l) => l.includes("女性")) && labels.some((l) => l.includes("男性")), `labels: ${labels.join(",")}`);
  ok(await until(() => doc().querySelectorAll(".script .gw").length > 10), "intonation guide words missing in the script");
  ok(doc().querySelector(".script .g-arrow.up, .script .g-arrow.down"), "no up/down marks in the guide");
  ok(errors.length === 0, errors.join(" | "));
});

test("smoke: other screens open", async () => {
  await openApp();
  for (const [btn, expect] of [["#go-connected", "音の変化の学習"], ["#go-shadowing", "シャドーイング"], ["#go-rhythm", "リズムと強勢"],
    ["#go-reading", "聞き読み"], ["#go-extensive", "多聴"]]) {
    click('[data-nav="home"]');
    ok(await until(() => doc().querySelector(btn)), `${btn} missing`);
    click(btn);
    ok(await until(() => text().includes(expect)), `${expect} did not render`);
  }
  for (const nav of ["records", "about"]) {
    click('[data-nav="home"]');
    await until(() => doc().querySelector(`[data-nav="${nav}"]`));
    click(`[data-nav="${nav}"]`);
    await sleep(300);
  }
  ok(errors.length === 0, errors.join(" | "));
});
