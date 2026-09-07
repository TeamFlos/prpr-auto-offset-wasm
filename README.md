# prpr-auto-offset-wasm

WebAssembly bindings for Phira's [`prpr-auto-offset`](https://github.com/TeamFlos/phira/tree/main/prpr-auto-offset)
delay-alignment library, plus a TypeScript-first npm package that wraps it.

Given an audio track and a chart's note events, the library estimates the **timing offset**
between when notes are placed and when the corresponding hit sounds actually play. It runs
entirely in the browser via WebAssembly.

- **Rust crate**: `crates/prpr-auto-offset-wasm` — a thin `wasm-bindgen` wrapper over the
  upstream crate (a **git dependency**, no vendored copy).
- **npm package**: `@teamflos/prpr-auto-offset-wasm` — an ergonomic, validated TypeScript
  facade.

---

## Why a git dependency?

`prpr-auto-offset` is a path member of the phira workspace and is **not published to
crates.io**. It is also `GPL-3.0-only`. This crate depends on it directly with a git
dependency, so it always tracks the canonical implementation. Its `rayon` dependency
compiles for `wasm32-unknown-unknown` and degrades to sequential execution there, so no
fork or feature-gating is needed.

## How it works

```
audio PCM ──► audio frontend ──► "novelty" signal N(t)
note events ─► note frontend ──► note signal M(t)
N(t), M(t) ──► normalized cross-correlation ──► offset + confidence
```

Audio frontends: `EnergyDiff`, `SpectralFlux` (diagnostic) and **`SuperFlux`** (recommended).
Note frontends: `GaussianNote` (diagnostic) and **`WeightedGaussianNote`** (recommended).

---

## WASM API (what the npm package drives)

- `estimate_auto_offset(options)` — one-call entry point. Builds a frontend + note signal from
  raw PCM and note events, then runs the alignment. Returns a result object with `.offset`,
  `.correlation`, `.reliable`, and `.correlationCurve`.
- Low-level `SignalHandle` factories (`superflux`, `energyDiff`, `spectralFlux`,
  `gaussianNote`, `weightedGaussianNote`) + `estimate` / `estimate_with`.
- `compute_spectrogram` for visualization.

## npm usage

```ts
import { estimateAutoOffset, NoteKind } from "@teamflos/prpr-auto-offset-wasm";

const res = estimateAutoOffset({
  pcm: audioPcm,            // Float32Array, mono
  sampleRate: 44100,
  notes: [
    { time: 1.0, kind: NoteKind.Tap },
    { time: 1.25, kind: NoteKind.Flick },
  ],
});

// res: { offset, correlation, rawPeak, noteEnergy, audioEnergy, reliable, correlationCurve }
```

The `offset` is in **absolute time**. To get the chart correction, subtract `searchCenterSec`
(the chart author's offset, when set).

---

## Building

Prerequisites: Rust (with `wasm32-unknown-unknown`), [`wasm-pack`](https://rustwasm.github.io/wasm-pack/),
Node.js, and `npm`/`pnpm`.

```sh
# wasm (bundler target) → npm/pkg
make wasm

# TypeScript facade → npm/dist
make npm

# Node smoke test (builds a nodejs-target wasm into tests/pkg-node)
make test
```

Run everything end-to-end:

```sh
make build
```

### Note on wasm-opt

The repository intentionally sets `wasm-opt = false` in the crate's `[package.metadata.wasm-pack]`
because the locally bundled binaryen is older than the wasm features (bulk-memory /
nontrapping-fptoi) emitted by modern rustc. To optimize the shipped `.wasm`, run:

```sh
wasm-opt --enable-bulk-memory --enable-nontrapping-float-to-int -O \
  pkg/prpr_auto_offset_wasm_bg.wasm -o pkg/prpr_auto_offset_wasm_bg.wasm
```

---

## Project layout

```
.
├── Cargo.toml                       # workspace
├── crates/prpr-auto-offset-wasm/    # the wasm crate (git-dep on prpr-auto-offset)
├── npm/                             # the npm package (facade + generated pkg)
├── tests/                           # node smoke test + nodejs-target build
├── _things/                         # git-ignored research scratch
└── DESIGN.md                        # design & research notes
```

## License

`GPL-3.0-only`, matching the upstream `prpr-auto-offset` crate, which this project builds on.
