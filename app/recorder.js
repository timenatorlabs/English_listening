// Microphone recording through the Web Audio API (raw samples -> WAV), instead of
// MediaRecorder: it does not depend on which compressed formats a browser can record
// (iOS Safari and Chrome differ), it gives samples for the pitch graph, and it lets us
// measure the input level live and check afterwards whether anything was captured.
// Recordings stay in memory only.

let ctx = null;

// Create / resume the AudioContext. Call synchronously inside a tap (iOS requires it).
export function prepare() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

export const canRecord = () => !!((window.AudioContext || window.webkitAudioContext) && navigator.mediaDevices
  && navigator.mediaDevices.getUserMedia && window.isSecureContext);

function toWav(samples, rate) {
  const buf = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const str = (o, s) => [...s].forEach((c, i) => buf.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF"); buf.setUint32(4, 36 + samples.length * 2, true); str(8, "WAVEfmt ");
  buf.setUint32(16, 16, true); buf.setUint16(20, 1, true); buf.setUint16(22, 1, true);
  buf.setUint32(24, rate, true); buf.setUint32(28, rate * 2, true); buf.setUint16(32, 2, true); buf.setUint16(34, 16, true);
  str(36, "data"); buf.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) buf.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true);
  return new Blob([buf], { type: "audio/wav" });
}

// onLevel(rms 0..1) is called about 10 times a second while recording.
export async function start({ onLevel } = {}) {
  const ac = prepare();
  // Raw microphone sound: echo cancellation / noise suppression / auto gain are made for
  // calls and made the learner's voice sound processed. (Earphones keep the model out.)
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  if (ac.state === "suspended") await ac.resume().catch(() => {});
  const track = stream.getAudioTracks()[0];
  const diag = { muted: 0, ended: false, label: track ? track.label : "", ctxState: ac.state };
  if (track) {
    track.addEventListener("mute", () => { diag.muted++; });
    track.addEventListener("ended", () => { diag.ended = true; });
  }
  const source = ac.createMediaStreamSource(stream);
  // ScriptProcessorNode is deprecated but works everywhere (incl. older iOS) without an extra module file
  const proc = ac.createScriptProcessor(4096, 1, 1);
  const silent = ac.createGain();
  silent.gain.value = 0;   // keep the node running without playing the mic back
  const chunks = [];
  proc.onaudioprocess = (e) => {
    const data = e.inputBuffer.getChannelData(0);
    chunks.push(new Float32Array(data));
    if (onLevel) {
      let s = 0;
      for (let i = 0; i < data.length; i += 4) s += data[i] * data[i];
      onLevel(Math.sqrt(s / (data.length / 4)));
    }
  };
  source.connect(proc);
  proc.connect(silent);
  silent.connect(ac.destination);

  return {
    async stop() {
      proc.onaudioprocess = null;
      try { source.disconnect(); proc.disconnect(); silent.disconnect(); } catch (e) { /* already disconnected */ }
      stream.getTracks().forEach((t) => t.stop());
      const n = chunks.reduce((a, c) => a + c.length, 0);
      const samples = new Float32Array(n);
      let o = 0;
      for (const c of chunks) {
        samples.set(c, o);
        o += c.length;
      }
      let peak = 0;
      let sum = 0;
      for (let i = 0; i < n; i++) {
        const v = Math.abs(samples[i]);
        if (v > peak) peak = v;
        sum += samples[i] * samples[i];
      }
      const rms = n ? Math.sqrt(sum / n) : 0;
      return {
        samples, rate: ac.sampleRate, blob: toWav(samples, ac.sampleRate),
        diag: { ...diag, seconds: n / ac.sampleRate, peak, rms, silent: peak < 0.005 },
      };
    },
  };
}

export async function decode(arrayBuffer) {
  const ac = prepare();
  return new Promise((resolve, reject) => ac.decodeAudioData(arrayBuffer, resolve, reject));
}
