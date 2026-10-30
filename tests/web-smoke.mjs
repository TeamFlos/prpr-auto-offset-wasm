import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import init, { estimate_auto_offset } from '../npm/pkg-web/prpr_auto_offset_wasm.js';
import { createSample } from '../demo/input.js';
await init({ module_or_path: await readFile(new URL('../npm/pkg-web/prpr_auto_offset_wasm_bg.wasm', import.meta.url)) });
const { pcm, sampleRate, notes } = createSample();
for (const center of [0, 0.05]) {
  const result = estimate_auto_offset({ pcm, sampleRate, frontend: 2, noteMethod: 1,
    noteEvents: notes.map(n => ({ time: n.time, kind: 0 })),
    alignConfig: { searchCenterSec: center, searchRangeSec: 0.3, samplingIntervalSec: 0.005 } });
  try {
    assert(Math.abs(result.offset - 0.123) < 0.02, `offset=${result.offset}`);
    assert(result.reliable);
    assert(result.curve_len() > 0);
    assert(Math.abs((result.offset - center) - (0.123 - center)) < 0.02);
    console.log(`Web entry: center=${center}, offset=${result.offset}, correlation=${result.correlation}`);
  } finally { result.free(); }
}
