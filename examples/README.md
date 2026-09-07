# 用法示例 · prpr-auto-offset-wasm

本篇展示 `@teamflos/prpr-auto-offset-wasm` 的全部对齐用法，从最常用的一行式 API 到低层信号组合、
builder、无打包器入口与可视化。所有示例都基于同一个前提：

- `pcm`：单声道 `Float32Array` 音频样本。
- `sampleRate`：采样率（Hz）。
- `notes`：谱面音符数组，`{ time, kind }`，`kind ∈ "tap" | "hold" | "flick" | "drag"`。

> [!IMPORTANT]
> **`offset` 是绝对时间，不是谱面偏移。** 要得到谱面里该填的修正值，必须**减去
> `searchCenterSec`**（谱面作者的偏移，未设置时当作 `0`）：
>
> ```
> chartOffset = offset − searchCenterSec
> ```
>
> 例：作者偏移为 `0.05s`，你传 `searchCenterSec = 0.05`，若检测到 `offset = 0.112s`，
> 则谱面需要 **`+62ms`** 的修正。

---

## 1. 最常用：一键对齐（默认 superflux + weightedGaussian）

```ts
import { estimateAutoOffset } from "@teamflos/prpr-auto-offset-wasm";

const res = estimateAutoOffset({
  pcm,                    // Float32Array, mono
  sampleRate: 44100,
  notes: [
    { time: 1.0,  kind: "tap" },
    { time: 1.25, kind: "flick" },
    { time: 1.5,  kind: "hold" },
    { time: 1.75, kind: "drag" },
  ],
});

console.log(res.offset);          // 建议偏移（秒，绝对时间）
console.log(res.correlation);     // 归一化互相关系数 [0,1]
console.log(res.reliable);        // 是否超过置信阈值（默认 0.2）
console.log(res.correlationCurve); // [{ offset, score }, ...] 得分-偏移曲线
```

默认参数即推荐参数：`frontend="superflux"`、`noteMethod="weightedGaussian"`、
`noteSigma=0.02`、`searchRangeSec=0.30`、`samplingIntervalSec=0.005`、`searchCenterSec=0`。

## 2. 显式指定 frontend / noteMethod 与自定义 config

```ts
const res = estimateAutoOffset({
  pcm,
  sampleRate: 44100,
  notes,

  frontend: "superflux",       // "energy" | "spectral" | "superflux"（默认 superflux）
  windowSize: 2048,            // STFT 窗口（superflux/spectral 用）
  hopSize: 1024,

  noteMethod: "weightedGaussian", // "gaussian" | "weightedGaussian"（默认 weightedGaussian）
  noteSigma: 0.02,

  noteConfig: {                // 均可省略，省略用上游默认
    maxNotesPerTime: 2,
    dragRunWeight: 0.2,
    minDragRunLen: 5,
    maxDragIntervalSec: 0.12,
    equalIntervalToleranceSec: 0.008,
    timeEpsilonSec: 1e-4,
    dragWeight: 1,
  },

  config: {                    // 对齐搜索配置
    searchRangeSec: 0.30,
    samplingIntervalSec: 0.005,
    searchCenterSec: authorOffset, // 放到谱面作者偏移附近，只搜残差
  },
});
```

## 3. 低层信号组合（手动构建 frontend）

```ts
import {
  superflux, spectralFlux, energyDiff,
  gaussianNote, weightedGaussianNote,
  estimate, estimateWith,
} from "@teamflos/prpr-auto-offset-wasm";

// 音频 frontend 三选一
const audio = superflux(pcm, 44100, 2048, 1024);
// const audio = spectralFlux(pcm, 44100, 1024, 512);
// const audio = energyDiff(pcm, 44100, 10, 5);   // frameMs, hopMs

// 音符 frontend 二选一
const note = weightedGaussianNote(notes, 0.02, { dragRunWeight: 0.2 });
// const note = gaussianNote(noteTimes, 0.02);    // noteTimes: number[]

const durationSec = pcm.length / 44100;

const r1 = estimate(audio, note, durationSec);                       // 默认 config
const r2 = estimateWith(audio, note, durationSec, {                  // 自定义 config
  searchRangeSec: 0.4,
  searchCenterSec: authorOffset,
});
```

## 4. 在任意时间采样信号

```ts
const vals = audio.sample(new Float64Array([1.0, 1.5, 2.0]));
// vals: Float32Array，每个时间戳一个强度值（可直接用来画图/诊断）
```

## 5. builder（AutoOffsetPipeline）

```ts
import { AutoOffsetPipeline, superflux, weightedGaussianNote } from "@teamflos/prpr-auto-offset-wasm";

const res = new AutoOffsetPipeline()
  .useAudio(superflux(pcm, 44100))
  .useNote(weightedGaussianNote(notes))
  .durationSec(6.0)                 // 必须设置
  .useConfig({ searchCenterSec: authorOffset })
  .run();
```

## 6. 无打包器 / CDN 入口（`./web`）

`./web` 导出与主入口相同的函数，但需先 `await init()`；其中 `estimate_auto_offset` 接受
camelCase 对象，`kind` 用数字：`0=tap, 1=hold, 2=flick, 3=drag`。

```js
import init, { estimate_auto_offset } from "@teamflos/prpr-auto-offset-wasm/web";
await init();

const res = estimate_auto_offset({
  pcm, sampleRate: 44100,
  frontend: 2,        // 0=energy, 1=spectral, 2=superflux
  noteMethod: 1,      // 0=gaussian, 1=weightedGaussian
  noteEvents: [{ time: 1.0, kind: 0 }, { time: 1.25, kind: 2 }],
  noteSigma: 0.02,
});
```

## 7. 可视化：滤波组对数幅度谱图

```ts
import { computeSpectrogram } from "@teamflos/prpr-auto-offset-wasm";

const sp = computeSpectrogram(pcm, 44100, {
  windowSize: 2048,
  hopSize: 1024,
  bandsPerOctave: 24,   // 0 用默认 24
  fmin: 0,              // 0 用默认 30
  fmax: 0,              // 0 用默认 17000
});

console.log(sp.frameCount(), sp.nBands(), sp.frameRate()); // 帧数 / 频带数 / 帧率 Hz
const flat = sp.framesFlat(); // [frame][band] 展平（行优先），长度 = frameCount * nBands
```

## 8. 音符类型与类型化

```ts
import type { NoteEvent, NoteKind, AlignResult, AlignConfig, NotePreprocessConfig } from "@teamflos/prpr-auto-offset-wasm";

const note: NoteEvent = { time: 1.0, kind: "tap" };       // kind: "tap"|"hold"|"flick"|"drag"
```

## 9. 读结果并换算成谱面偏移

```ts
const res = estimateAutoOffset({ pcm, sampleRate: 44100, notes, config: { searchCenterSec: authorOffset } });
const chartOffsetMs = (res.offset - authorOffset) * 1000;  // 谱面里要保存的毫秒偏移
if (!res.reliable) {
  console.warn("低置信度（correlation 过低），结果仅供参考或需要更多音符/更干净音频。");
}
```

---

### 对应底层 wasm 函数（主入口 facade 的封装来源）

| facade 高层           | 对应 wasm 导出（`./web` / bundler glue） |
|-----------------------|------------------------------------------|
| `estimateAutoOffset`  | `estimate_auto_offset(opts)`             |
| `superflux`/`spectralFlux`/`energyDiff` | `SignalHandle.superflux` / `.spectralFlux` / `.energyDiff` |
| `gaussianNote`/`weightedGaussianNote`   | `SignalHandle.gaussianNote` / `.weightedGaussianNote` |
| `estimate` / `estimateWith` | `estimate` / `estimate_with`         |
| `computeSpectrogram`  | `compute_spectrogram(...)`               |
