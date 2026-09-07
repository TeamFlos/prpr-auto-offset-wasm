# prpr-auto-offset-wasm — Design & Plan

> A WebAssembly port of Phira's `prpr-auto-offset` delay-alignment crate, wrapped in an
> ergonomic, TypeScript-first npm package.

This document records the research findings and the proposed design. It is a **living
document**: it will be updated as the design is refined and implemented.

---

## 1. What the project is

Phira (a rhythm-game engine) ships a workspace crate called **`prpr-auto-offset`** that
automatically estimates the audio/visual offset of a chart: given the chart's note events
and the audio track, it returns a suggested global offset (in seconds) plus a confidence
score.

**`prpr-auto-offset-wasm`** is a fresh, currently-empty repository whose goal is:

1. A **WASM crate** (`prpr-auto-offset-wasm`) that compiles the same algorithm to
   `wasm32-unknown-unknown` and exposes it to JavaScript through `wasm-bindgen`.
2. A **companion npm package** that wraps the generated WASM in a clean,
   type-safe JavaScript/TypeScript API covering *all* of the original crate's
   functionality.

The upstream crate is self-contained and well-documented. The only blocker to building it
for the default WASM target is the `rayon` dependency (see §3).

---

## 2. The algorithm (understanding the upstream crate)

The pipeline in `prpr-auto-offset` is:

```
audio PCM ──► audio frontend ──► dense "novelty" signal N(t)
note events ─► note frontend ──► note signal M(t)
N(t), M(t) ──► estimate (normalized cross-correlation over limited lag) ──► offset + confidence
```

### 2.1 Audio frontends (`src/audio/`)
| Type | Purpose | Note |
|------|---------|------|
| `EnergyDiff` | Positive first-order difference of short-time RMS energy | Diagnostic; simple sanity check |
| `SpectralFlux` | STFT positive magnitude-spectrum differences | Diagnostic; novelty peak lags onset |
| `SuperFlux` | Percussion-onset novelty (Böck & Widmer, DAFx-13) | **Recommended**; least timing bias |

`SuperFlux` processing steps (fixed upstream):
1. 50 Hz high-pass (1st-order Butterworth) + DC removal.
2. Log-scale triangular filterbank (24 bands/octave, 30 Hz – 17 kHz, A0 = 440 Hz reference).
3. STFT (Hann window) → magnitude → filterbank → `log10`.
4. Per-band spectral whitening (subtract local running mean, floor at −120 dB).
5. Frequency-direction max filter (vibrato suppression, `max_bins=3`) + temporal difference.

Also exposed: `Filterbank` and `compute_spectrogram` (for visualization).

`Signal` is a trait: `fn samples(&self, ts: &[f64]) -> Vec<f32>` — a dense time-varying signal
samples at arbitrary timestamps, with linear interpolation.

### 2.2 Note frontends (`src/note/`)
| Type | Purpose |
|------|---------|
| `GaussianNote` | Gaussian kernel at each note time (diagnostic) |
| `WeightedGaussianNote` | **Recommended**; caps simultaneous notes, downweights dense even-spaced "drag runs" |

`WeightedGaussianNote` input is `Vec<NoteEvent>` (`{ time: f64, kind: AutoOffsetNoteKind }`,
kind ∈ { Tap, Hold, Flick, Drag }) plus a sigma and a `NotePreprocessConfig`
(`max_notes_per_time`, `drag_run_weight`, `min_drag_run_len`, `max_drag_interval_sec`,
`equal_interval_tolerance_sec`, `time_epsilon_sec`, `drag_weight`).

### 2.3 Estimator (`src/estimate.rs`)
`estimate / estimate_with(audio: &Signal, note: &Signal, duration_sec, config) -> AlignResult`:
- Builds an absolute-time grid `[search_center - range, search_center + duration + range]`
  at `sampling_interval_sec`.
- Samples audio on the grid; samples note shifted by `search_center`.
- Normalized cross-correlation over `±floor(search_range / sampling_interval)` lag bins.
- `AlignResult` = `{ offset, correlation, raw_peak, note_energy, audio_energy, reliable,
  correlation_curve: Vec<(offset_sec, score)> }`. `reliable` is true when `correlation > 0.2`.
- **Key**: `offset` is absolute time; chart correction = `offset - search_center_sec`.

### 2.4 Config defaults (`src/types.rs`)
```
AlignConfig {
  search_range_sec: 0.30,
  sampling_interval_sec: 0.005,
  search_center_sec: 0.0,
}
```

### 2.5 The recommended end-to-end recipe (grounded in the in-repo CLI)
The phira workspace ships `tools/auto-offset-cli` which is the canonical consumer and
confirms the default recipe:

```
audio  = SuperFlux::new(&pcm, sample_rate, 2048, 1024)      // default audio method = superflux
notes  = WeightedGaussianNote::new(note_events, sigma=0.02) // default note method, blur_sigma default 0.02
config = AlignConfig { search_range_sec: 0.30, sampling_interval_sec: 0.005,
                       search_center_sec: author_offset /*=0 with --wide*/ }
result = estimate_with(&audio, &notes, duration_sec, &config)
```
Defaults from the CLI (these become the npm defaults): `range = 0.30`, `interval = 0.005`,
`blur_sigma = 0.02`, audio = `superflux` (window 2048 / hop 1024), note = `preprocessed
gaussian`.

### 2.6 Note-kind mapping (authoritative, from the CLI)
Phira chart `NoteKind` maps 1:1 to `AutoOffsetNoteKind`:
```
NoteKind::Click            -> AutoOffsetNoteKind::Tap
NoteKind::Hold { .. }      -> AutoOffsetNoteKind::Hold
NoteKind::Flick            -> AutoOffsetNoteKind::Flick
NoteKind::Drag             -> AutoOffsetNoteKind::Drag
```
Fake notes (`note.fake`) and negative-time notes are filtered out before building the note
signal. This mapping is replicated in the npm API (`kind: 'tap' | 'hold' | 'flick' | 'drag'`).

---

## 3. WASM portability analysis

Dependencies used by upstream: `rayon`, `realfft = "3"`, `rustfft = "6.4.1"`.

| Dependency | WASM-safe? | Notes |
|------------|-----------|-------|
| `realfft` / `rustfft` | ✅ | Pure Rust. Work as-is on `wasm32-unknown-unknown`. |
| `rayon` | ❌ | `compute_spectrogram` uses `into_par_iter()`. On the standard `wasm32-unknown-unknown` target this requires threaded WASM (`wasm-bindgen-rayon` + `SharedArrayBuffer`), which is not universally available and complicates the build. Results are numerically identical to a sequential pass. |

**Decision:** Make the WASM build **sequential by default**. Provide an opt-in native
`rayon` feature for host speed. The algorithm output is unchanged (rayon only parallelises
frame processing).

Implementation notes:
- Vendor the algorithm as a self-contained module inside this crate (`src/algo/`), mirroring
  upstream module-for-module so future diffs are easy, and add a comment wherever we diverge
  (notably: rayon → sequential).
- Keep `realfft`/`rustfft` exactly as upstream so numerics match bit-for-bit.
- The upstream crate is a workspace path crate not published to crates.io, and it hard-depends
  on rayon in its public path, so we cannot depend on it directly. Vendoring is the clean path.

---

## 4. Repository layout

```
prpr-auto-offset-wasm/
├── Cargo.toml                     # workspace root (or single-crate; see §7)
├── DESIGN.md                      # this document
├── README.md                      # user-facing docs (later)
├── LICENSE                        # GPL-3.0-or-later (match upstream) — to confirm
├── .gitignore                     # ignores _things/, target/, pkg/, dist/, node_modules/
├── _things/                       # (git-ignored) research scratch — fetch scripts, clones, notes
├── crates/
│   └── prpr-auto-offset-wasm/
│       ├── Cargo.toml
│       └── src/
│           ├── lib.rs             # re-exports + wasm-bindgen API
│           ├── algo/              # vendored, wasm-first algorithm (no rayon by default)
│           │   ├── mod.rs
│           │   ├── signal.rs
│           │   ├── types.rs
│           │   ├── estimate.rs
│           │   ├── audio/{mod,energy,spectral,superflux}.rs
│           │   └── note/{mod,gaussian,weighted_gaussian}.rs
│           └── js.rs              # wasm-bindgen glue (classes, helpers)
└── npm/
    ├── package.json
    ├── tsconfig.json
    ├── src/index.ts               # ergonomic TypeScript facade
    ├── src/index.d.ts / types     # hand-written, richer types
    └── pkg/                       # generated by wasm-pack (git-ignored)
```

---

## 5. WASM-bindgen API design

Because a generic `Signal` trait object cannot cross the WASM boundary directly, we expose
both (a) **low-level handles** that faithfully mirror the Rust API and (b) a **one-call
high-level** convenience API.

### 5.1 Low-level building blocks (wrap "everything")

All audio frontends and note frontends return a handle that implements sampling:

```rust
#[wasm_bindgen]
pub struct SignalHandle { inner: Box<dyn Signal<f32>> }   // opaque to JS

// constructors
SignalHandle::superflux(pcm: &[f32], sample_rate: u32, window_size: usize, hop_size: usize) -> Self
SignalHandle::energy_diff(pcm: &[f32], sample_rate: u32, frame_ms: f64, hop_ms: f64) -> Self
SignalHandle::spectral_flux(pcm: &[f32], sample_rate: u32, fft_size: usize, hop_size: usize) -> Self
SignalHandle::gaussian_note(times: &[f64], sigma: f64) -> Self
SignalHandle::weighted_gaussian_note(events: &[JsNoteEvent], sigma: f64, config: &JsNoteConfig) -> Self

// sampling (the Signal trait)
SignalHandle::sample(&self, ts: &[f64]) -> Vec<f32>

// native (uninterpolated) accessors for the audio frontends
SignalHandle::native_samples(&self) -> Vec<f32>
SignalHandle::native_dt(&self) -> f64
SignalHandle::native_t0(&self) -> f64
```

```rust
#[wasm_bindgen]
pub fn estimate(audio: &SignalHandle, note: &SignalHandle, duration_sec: f64, config: &JsAlignConfig) -> JsAlignResult
pub fn estimate_with(audio: &SignalHandle, note: &SignalHandle, duration_sec: f64, config: &JsAlignConfig) -> JsAlignResult
```

Input value types (plain, JS-friendly):
```rust
#[wasm_bindgen]
pub struct JsNoteEvent { pub time: f64, pub kind: u8 }   // kind: 0=Tap,1=Hold,2=Flick,3=Drag
#[wasm_bindgen]
pub struct JsAlignConfig { pub search_range_sec: f64, pub sampling_interval_sec: f64, pub search_center_sec: f64 }
#[wasm_bindgen]
pub struct JsAlignResult {
  pub offset: f64, pub correlation: f64, pub raw_peak: f64,
  pub note_energy: f64, pub audio_energy: f64, pub reliable: bool,
  // correlation_curve as two parallel arrays for efficient JS consumption
  pub curve_offsets: Vec<f64>, pub curve_values: Vec<f32>,
}
```

### 5.2 High-level one-call API

```rust
#[wasm_bindgen]
pub fn estimate_auto_offset(
  pcm: &[f32],
  sample_rate: u32,
  frontend: u8,                 // 0=EnergyDiff, 1=SpectralFlux, 2=SuperFlux
  note_events: &[JsNoteEvent],
  duration_sec: f64,
  config: &JsAlignConfig,       // optional (defaults)
  note_config: &JsNoteConfig,   // optional (defaults)
  note_sigma: f64,              // default 0.02
) -> JsAlignResult
```
This builds `SuperFlux` (or selected frontend) + `WeightedGaussianNote` and runs
`estimate_with`, returning everything in one call. It is the primary entry point.

### 5.3 Visualization helpers (optional, for tooling)
```rust
#[wasm_bindgen]
pub fn compute_spectrogram(pcm: &[f32], sample_rate: u32, window_size: usize, hop_size: usize,
                           bands_per_octave: usize, fmin: f32, fmax: f32) -> SpectrogramHandle
// SpectrogramHandle::frames() -> Vec<Vec<f32>>, ::frame_rate() -> f32, ::n_bands() -> usize
```
And `Filterbank` is exposed as a builder with `.apply(magnitude: &[f32]) -> Vec<f32>`.

### 5.4 Error handling
- Validate inputs explicitly (WASM release builds disable `debug_assert`): non-finite/negative
  config, empty PCM, `sample_rate == 0`, invalid note kinds → throw a descriptive `Error`.
- `estimate` on degenerate input returns `reliable=false, offset=0` (mirrors upstream) rather
  than throwing, so callers can degrade gracefully.

---

## 6. npm package design

Package name: **`@teamflos/prpr-auto-offset-wasm`** (ask user; default suggested).

- **TypeScript-first** facade in `src/index.ts` that re-exports the WASM glue with richer
  types, JSDoc, default values, and input validation.
- **Exports** (ESM + UMD, via package.json `exports`):
  - `estimateAutoOffset(input): AutoOffsetResult` — the high-level API.
  - Classes: `SuperFlux`, `EnergyDiff`, `SpectralFlux`, `GaussianNote`, `WeightedGaussianNote`,
    `AutoOffsetPipeline` (builder that collects audio + notes + config then `estimate()`).
  - Types: `NoteEvent`, `NoteKind`, `AlignConfig`, `AlignResult`, `CorrelationPoint`,
    `NotePreprocessConfig`.
  - Enums/consts for frontend selection.

### 6.1 High-level API example
```ts
import { estimateAutoOffset, NoteKind } from '@teamflos/prpr-auto-offset-wasm';

const res = estimateAutoOffset({
  pcm: new Float32Array(audioBuffer),   // mono f32
  sampleRate: 44100,
  frontend: 'superflux',                // 'energy' | 'spectral' | 'superflux'
  windowSize: 2048,                     // STFT window (superflux/spectral)
  hopSize: 1024,
  notes: [
    { time: 1.0, kind: NoteKind.Tap },
    { time: 1.25, kind: NoteKind.Flick },
    // ...
  ],
  noteSigma: 0.02,
  config: { searchRangeSec: 0.30, samplingIntervalSec: 0.005, searchCenterSec: 0 },
  noteConfig: { /* NotePreprocessConfig overrides */ },
});

// res: { offset, correlation, rawPeak, noteEnergy, audioEnergy, reliable,
//        correlationCurve: Array<{ offset: number, score: number }> }
```

### 6.2 Build pipeline
1. `cargo build`/`cargo test` (native) to validate the vendored algorithm.
2. `wasm-pack build --target bundler` → emits `npm/pkg/` glue + `.wasm` + `.d.ts`.
3. Hand-written `npm/src/index.ts` wraps `pkg` for ergonomics.
4. `tsc` to compile the facade; ship `.js` + `.d.ts`.
5. Smoke-test the facade under Node against a synthetic PCM.

---

## 7. Open decisions for you

1. **Repo structure** — A) Rust **workspace** root with `crates/` + `npm/` (recommended,
   clean separation, no artifact pollution at root). B) Single crate at repo root + `npm/`.
   C) Single crate at repo root only.
2. **Rayon handling** — Sequential default (recommended, works everywhere) vs. opt-in native
   `rayon` feature. Recommend sequential default + optional `rayon` feature.
3. **npm package name / scope** — `@teamflos/prpr-auto-offset-wasm` (recommended) vs.
   unscoped `prpr-auto-offset-wasm`.
4. **WASM target mode** — `bundler` (webpack/vite, recommended) vs. `web` (native ESM) vs.
   `nodejs`. Recommend `bundler` + a second `web` build for CDN usage.
5. **License** — Upstream is `GPL-3.0-only`. Recommend `GPL-3.0-or-later` (or match exactly).
   Confirm before publishing.

---

## 8. Milestones

- **M1 Research & design** (this doc, repo init, `_things` scratch). ✅
- **M2 Vendor algorithm** into `crates/prpr-auto-offset-wasm/src/algo` (sequential), port the
  pure-Rust upstream tests; `cargo test` green on native.
- **M3 WASM-bindgen API** (`lib.rs`/`js.rs`): `SignalHandle`, `JsNoteEvent`, `JsAlignConfig`,
  `JsAlignResult`, `estimate`, `estimate_auto_offset`, spectrogram/visualization helpers.
- **M4 Build WASM** `target wasm32-unknown-unknown`, `wasm-pack build --target bundler`.
- **M5 npm facade** `npm/src/index.ts` + types, `tsc`, then a Node smoke test.
- **M6 Docs & polish** — README, examples, performance notes.
