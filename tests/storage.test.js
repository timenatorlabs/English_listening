// Runs against the real IndexedDB of the test page's origin (separate from the app's).
import { test, eq, ok } from "./harness.js";
import * as db from "../app/db.js";
import { normalizeTest, perceptionRows, dictationRows } from "../app/metrics.js";

test("storage: export -> import round trip keeps legacy and new records", async () => {
  await db.clearAll();
  await db.set("trainingMs", 120000);     // legacy single total
  await db.addTest({ contrast: "r-l", date: "2026-01-01T00:00:00.000Z", kind: "事前", n: 40, correct: 22,
    newWords: { n: 20, correct: 10 }, trainedWords: { n: 20, correct: 12 }, rTarget: { n: 20, correct: 11 }, lTarget: { n: 20, correct: 11 } });
  await db.addTrial({ mode: "dictation", id: "1-01", matched: 4, total: 5, date: "2026-01-02T00:00:00.000Z",
    errors: [{ word: "home", cat: "unknown" }], unknown: ["home"] });   // pre-v2 record
  const dump = await db.exportAll();
  await db.clearAll();
  eq((await db.allTests()).length, 0);
  await db.importAll(JSON.parse(JSON.stringify(dump)));
  const tests = (await db.allTests()).map(normalizeTest);
  eq(tests[0].contrast, "rl");
  eq(tests[0].aTarget.correct, 11);
  eq(await db.get("trainingMs", 0), 120000);
  const rows = perceptionRows("rl", tests, await db.allTrials(), 1).rows;
  eq(rows[2].latest.k, 10);
  const dict = dictationRows(await db.allTrials());
  eq(dict[0].latest, null);               // fewer than 10 first attempts: no block yet
  await db.clearAll();
});

test("storage: importAll rejects foreign files", async () => {
  let threw = false;
  try {
    await db.importAll({ app: "something-else" });
  } catch (e) {
    threw = true;
  }
  ok(threw);
});
