// Node smoke test for the wasm bindings. Runs against the `nodejs`-target build produced by
// wasm-pack (see `tests/pkg-node`). It exercises the exact call shapes the TypeScript facade
// emits, so it validates the serde-wasm-bindgen contract (camelCase JSON objects, Float32Array
// PCM) plus the underlying algorithm.
//
// Run:  node tests/node-smoke.mjs

import wasm from "./pkg-node/prpr_auto_offset_wasm.js";

const SAMPLE_RATE = 44100;
const DURATION = 6.0;
const TRUE_OFFSET = 0.123;
const MAX_ABS_ERROR_SEC = 0.02; // generous; upstream superflux bias tolerance is ~5ms

function synthPcm(noteTimes, trueOffset) {
  const len = Math.round(DURATION * SAMPLE_RATE);
  const pcm = new Float32Array(len);
  const burstLen = Math.round(0.03 * SAMPLE_RATE);
  const attackLen = Math.max(1, Math.round(0.001 * SAMPLE_RATE));
  for (const nt of noteTimes) {
    const onset = nt + trueOffset;
    const start = Math.round(onset * SAMPLE_RATE);
    for (let i = 0; i < burstLen && start + i < len; i++) {
      const t = i / SAMPLE_RATE;
      const attack = Math.min(1, i / attackLen);
      const env = attack * Math.exp(-t * 150);
      const tone = Math.sin(2 * Math.PI * 2400 * t);
      pcm[start + i] += 0.85 * env * tone;
    }
  }
  return pcm;
}

function assert(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`  ok - ${msg}`);
}

const noteTimes = [1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5];
const noteEvents = noteTimes.map((time) => ({ time, kind: 0 })); // 0 = Tap
const pcm = synthPcm(noteTimes, TRUE_OFFSET);

console.log(`[smoke] sample_rate=${SAMPLE_RATE} duration=${DURATION}s true_offset=${TRUE_OFFSET}s notes=${noteTimes.length}`);

// --- 1. High-level one-call API (what estimateAutoOffset() drives) -----------
const opts = {
  pcm,
  sampleRate: SAMPLE_RATE,
  frontend: 2, // superflux
  windowSize: 0,
  hopSize: 0,
  noteMethod: 1, // weightedGaussian
  noteEvents,
  noteSigma: 0.02,
  noteConfig: {
    maxNotesPerTime: 2,
    dragRunWeight: 0.2,
    minDragRunLen: 5,
    maxDragIntervalSec: 0.12,
    equalIntervalToleranceSec: 0.008,
    timeEpsilonSec: 1e-4,
    dragWeight: 1,
  },
  alignConfig: { searchRangeSec: 0.3, samplingIntervalSec: 0.005, searchCenterSec: 0 },
};

let r;
try {
  r = wasm.estimate_auto_offset(opts);
} catch (e) {
  throw new Error(`estimate_auto_offset threw: ${e}`);
}
assert(typeof r.offset === "number", "estimate_auto_offset returns a numeric offset");
assert(r.correlation > 0.3, `high confidence: correlation=${r.correlation.toFixed(3)}`);
assert(r.reliable === true, `reliable flag set (corr=${r.correlation.toFixed(3)})`);
assert(Math.abs(r.offset - TRUE_OFFSET) <= MAX_ABS_ERROR_SEC, `offset close to true: got=${r.offset.toFixed(4)}s true=${TRUE_OFFSET}s`);
assert(r.curve_offsets().length > 0 && r.curve_offsets().length === r.curve_values().length, "correlation curve populated");
console.log(`  -- high-level offset=${r.offset.toFixed(4)}s corr=${r.correlation.toFixed(4)} curve=${r.curve_offsets().length} pts`);

// --- 2. Low-level path: build signals + estimate_with ------------------------
const sf = wasm.SignalHandle.superflux(pcm, SAMPLE_RATE, 2048, 1024);
const wgn = wasm.SignalHandle.weightedGaussianNote(noteEvents, 0.02, opts.noteConfig);
const r2 = wasm.estimate_with(sf, wgn, DURATION, opts.alignConfig);
assert(Math.abs(r2.offset - TRUE_OFFSET) <= MAX_ABS_ERROR_SEC, `low-level offset close to true: got=${r2.offset.toFixed(4)}s`);
console.log(`  -- low-level offset=${r2.offset.toFixed(4)}s corr=${r2.correlation.toFixed(4)}`);

// --- 3. Signal sampling ------------------------------------------------------
const ts = new Float64Array([1.0, 1.5, 2.0]);
const samples = sf.sample(ts);
assert(samples.length === ts.length, "sample() returns one value per timestamp");
const gauss = wasm.SignalHandle.gaussianNote(new Float64Array(noteTimes), 0.02);
assert(gauss.sample(new Float64Array([1.0]))[0] > 0, "gaussian note samples positive at a note time");

// --- 4. Spectrogram ----------------------------------------------------------
const sp = wasm.compute_spectrogram(pcm, SAMPLE_RATE, 2048, 1024, 0, 0, 0);
assert(sp.n_bands() > 0 && sp.frame_count() > 0, "spectrogram has frames and bands");
assert(sp.frames_flat().length === sp.frame_count() * sp.n_bands(), "flattened frames length is consistent");
console.log(`  -- spectrogram frames=${sp.frame_count()} bands=${sp.n_bands()}`);

console.log("\nALL SMOKE TESTS PASSED");
process.exit(0);
