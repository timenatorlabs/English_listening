import { toast } from "./util.js";

export const player = new Audio();
const blobUrls = new Map();
let seq = 0;   // bumped by every new playback request; cancels running sequences

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

const untilStopped = () => new Promise((resolve) => {
  const done = () => {
    player.removeEventListener("ended", done);
    player.removeEventListener("pause", done);
    resolve();
  };
  player.addEventListener("ended", done);
  player.addEventListener("pause", done);
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
      await untilStopped();
    } catch (e) {
      toast("音声を再生できませんでした。");
      return false;
    }
    if (my !== seq) return false;
    if (i < paths.length - 1) await new Promise((r) => setTimeout(r, gapMs / rate));
  }
  if (onIndex) onIndex(-1);
  return my === seq;
}
