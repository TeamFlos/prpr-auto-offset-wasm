# prpr-auto-offset-wasm

WebAssembly bindings for Phira's [`prpr-auto-offset`](https://github.com/TeamFlos/phira/tree/main/prpr-auto-offset)
delay-alignment library, plus a TypeScript-first npm package that wraps it.

Given an audio track and a chart's note events, the library estimates the **timing offset**
between when notes are placed and when the corresponding hit sounds actually play. It runs
entirely in the browser via WebAssembly.

- **Rust crate**: `crates/prpr-auto-offset-wasm` — a thin `wasm-bindgen` wrapper over the
  upstream crate.
- **npm package**: `@teamflos/prpr-auto-offset-wasm` — an ergonomic, validated TypeScript
  facade.

---

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
import { estimateAutoOffset } from "@teamflos/prpr-auto-offset-wasm";

const res = estimateAutoOffset({
  pcm: audioPcm,            // Float32Array, mono
  sampleRate: 44100,
  notes: [
    { time: 1.0, kind: "tap" },
    { time: 1.25, kind: "flick" },
  ],
});

// res: { offset, correlation, rawPeak, noteEnergy, audioEnergy, reliable, correlationCurve }
```

> [!IMPORTANT]
> **`offset` is absolute time, not a chart offset.** To get the value you should set on the
> chart, **subtract `searchCenterSec`** — i.e. the chart author's configured offset when it is
> set, otherwise `0`:
>
> ```
> chartOffset = offset − searchCenterSec
> ```
>
> Example: if the chart author set `offset = 0.05s` and you pass `searchCenterSec = 0.05`,
> a detected `offset = 0.112s` means the chart needs a **`+62ms`** correction.

> [!NOTE]
> **`reliable` is only the algorithm's internal gate — `correlation > 0.2`** — a bare lower
> bound that real charts easily exceed. It is **not** a quality scale. To judge quality, use the
> reference bands that the Phira offset panel draws on the correlation curve:
>
> - **`0.35` — poor / lower bound**: below this the note pattern has essentially no usable
>   match (in a 2000-chart sample only ~6 per 1000 scored below it).
> - **`0.6`–`0.75` — typical / usual**: the range where most charts land.
>
> Treat `reliable` as a minimal sanity check, and interpret quality with the bands above.

### No-bundler / CDN use

When you can't run a bundler (raw `<script type="module">`, CDN), use the `./web` entry, which
exports the same API plus an async `init` you must call first:

```js
import init, { estimate_auto_offset } from "@teamflos/prpr-auto-offset-wasm/web";
await init();
const res = estimate_auto_offset(options);
```

### Low-level signal API

Build frontends individually and combine them:

```ts
import { superflux, weightedGaussianNote, estimateWith } from "@teamflos/prpr-auto-offset-wasm";

const audio = superflux(pcm, 44100);                          // or spectralFlux / energyDiff
const note  = weightedGaussianNote(notes, 0.02, noteConfig);   // or gaussianNote
const res   = estimateWith(audio, note, durationSec, { searchCenterSec: authorOffset });
const vals  = audio.sample(new Float64Array([1.0, 1.5, 2.0])); // sample at arbitrary times
```

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

`wasm-opt` is disabled in the crate's `wasm-pack` metadata. To optimize the shipped `.wasm`,
run:

```sh
wasm-opt --enable-bulk-memory --enable-nontrapping-float-to-int -O \
  pkg/prpr_auto_offset_wasm_bg.wasm -o pkg/prpr_auto_offset_wasm_bg.wasm
```

---

## License

`GPL-3.0-only`, matching the upstream `prpr-auto-offset` crate, which this project builds on.
