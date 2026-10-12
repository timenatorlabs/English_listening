import { toast } from "./util.js";

export const player = new Audio();
const blobUrls = new Map();
let seq = 0;   // bumped by every new playback request; cancels running sequences
let unlocked = false;

// 0.2 s of silence as a WAV blob URL (8 kHz, 8-bit mono)
function silenceUrl() {
  const n = 1600;
  const buf = new DataView(new ArrayBuffer(44 + n));
  const str = (o, s) => [...s].forEach((c, i) => buf.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF"); buf.setUint32(4, 36 + n, true); str(8, "WAVEfmt ");
  buf.setUint32(16, 16, true); buf.setUint16(20, 1, true); buf.setUint16(22, 1, true);
  buf.setUint32(24, 8000, true); buf.setUint32(28, 8000, true); buf.setUint16(32, 1, true); buf.setUint16(34, 8, true);
  str(36, "data"); buf.setUint32(40, n, true);
  for (let i = 0; i < n; i++) buf.setUint8(44 + i, 128);
  return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
}

// Mobile browsers (especially iOS Safari) only let an audio element play after it has
// been started directly inside a tap. Call this synchronously at the start of a tap
// handler, before any await (e.g. before asking for the microphone).
export function unlock() {
  if (unlocked) return;
  unlocked = true;
  try {
    player.src = silenceUrl();
    const p = player.play();
    if (p) p.catch(() => { unlocked = false; });
  } catch (e) {
    unlocked = false;
  }
}

// Fetch as a blob and play from an object URL: avoids Safari's range-request
// problems with service-worker-cached media.
export function loadAudio(path) {
  if (!blobUrls.has(path)) {
    const p = fetch(path)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.blob();
      })
      .then((b) => URL.createObjectURL(b));
    p.catch(() => blobUrls.delete(path));
    blobUrls.set(path, p);
  }
  return blobUrls.get(path);
}

async function start(url, rate) {
  player.pause();
  player.src = url;
  player.defaultPlaybackRate = rate;
  player.playbackRate = rate;
  await player.play();
}

export function stopAll() {
  seq++;
  player.pause();
}

// Unlock audio on the very first tap anywhere in the app.
document.addEventListener("pointerdown", unlock, { once: true, capture: true });

export async function play(path, rate = 1) {
  const my = ++seq;
  try {
    const url = await loadAudio(path);
    if (my !== seq) return false;
    await start(url, rate);
    return true;
  } catch (e) {
    toast("音声を再生できませんでした。▶ を押してください。");
    return false;
  }
}

// Resolves when the current file ends or this sequence is cancelled. A pause that nobody
// asked for (e.g. iOS briefly pausing playback when the microphone starts) is resumed once.
const untilStopped = (my) => new Promise((resolve) => {
  let resumed = false;
  const finish = () => {
    player.removeEventListener("ended", finish);
    player.removeEventListener("pause", onPause);
    resolve();
  };
  const onPause = () => {
    if (my !== seq || player.ended || resumed) {
      finish();
      return;
    }
    resumed = true;
    player.play().catch(finish);
  };
  player.addEventListener("ended", finish);
  player.addEventListener("pause", onPause);
});

// Plays several files in a row. Resolves true if it reached the end, false if
// it was interrupted by another playback request or stopAll().
export async function playSequence(paths, rate = 1, { gapMs = 400, onIndex } = {}) {
  const my = ++seq;
  for (let i = 0; i < paths.length; i++) {
    if (my !== seq) return false;
    if (onIndex) onIndex(i);
    try {
      const url = await loadAudio(paths[i]);
      if (my !== seq) return false;
      await start(url, rate);
      await untilStopped(my);
    } catch (e) {
      toast(`音声を再生できませんでした（${e.name || "エラー"}）。もう一度押してください。`);
      return false;
    }
    if (my !== seq) return false;
    if (i < paths.length - 1) await new Promise((r) => setTimeout(r, gapMs / rate));
  }
  if (onIndex) onIndex(-1);
  return my === seq;
}
