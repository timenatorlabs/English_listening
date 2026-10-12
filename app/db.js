// IndexedDB wrapper. All learning data stays on this device.
const DB_NAME = "eigo-mimi";
const DB_VERSION = 1;
const STORES = ["kv", "trials", "tests"];

let dbPromise = null;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv", { keyPath: "key" });
        if (!db.objectStoreNames.contains("trials")) db.createObjectStore("trials", { autoIncrement: true });
        if (!db.objectStoreNames.contains("tests")) db.createObjectStore("tests", { autoIncrement: true });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const result = fn(t.objectStore(store));
    t.oncomplete = () => resolve(result && "result" in result ? result.result : undefined);
    t.onerror = () => reject(t.error);
  });
}

export async function get(key, fallback = null) {
  const row = await tx("kv", "readonly", (s) => s.get(key));
  return row ? row.value : fallback;
}

export function set(key, value) {
  return tx("kv", "readwrite", (s) => s.put({ key, value }));
}

export function addTrial(trial) {
  return tx("trials", "readwrite", (s) => s.add(trial));
}

export function allTrials() {
  return tx("trials", "readonly", (s) => s.getAll());
}

export function addTest(test) {
  return tx("tests", "readwrite", (s) => s.add(test));
}

export function allTests() {
  return tx("tests", "readonly", (s) => s.getAll());
}

export async function exportAll() {
  const out = { app: "eigo-mimi", version: DB_VERSION, exportedAt: new Date().toISOString() };
  for (const name of STORES) out[name] = await tx(name, "readonly", (s) => s.getAll());
  return out;
}

export async function importAll(data) {
  if (!data || data.app !== "eigo-mimi") throw new Error("このアプリの書き出しファイルではありません");
  await clearAll();
  const db = await open();
  await new Promise((resolve, reject) => {
    const t = db.transaction(STORES, "readwrite");
    for (const row of data.kv || []) t.objectStore("kv").put(row);
    for (const row of data.trials || []) t.objectStore("trials").add(row);
    for (const row of data.tests || []) t.objectStore("tests").add(row);
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
  });
}

export async function clearAll() {
  for (const name of STORES) await tx(name, "readwrite", (s) => s.clear());
}
