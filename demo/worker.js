import init, { estimate_auto_offset } from './wasm/prpr_auto_offset_wasm.js';
try {
  await init();
  self.postMessage({ type: 'ready' });
  self.onmessage = ({ data }) => {
    let r;
    try {
      r = estimate_auto_offset({ pcm: data.pcm, sampleRate: data.sampleRate,
        noteEvents: data.notes.map(n => ({ time: n.time, kind: ['tap', 'hold', 'flick', 'drag'].indexOf(n.kind) })),
        frontend: data.frontend, noteMethod: 1, noteSigma: 0.02,
        alignConfig: { searchCenterSec: data.center, searchRangeSec: data.range, samplingIntervalSec: 0.005 } });
      self.postMessage({ type: 'result', center: data.center, result: {
        offset: r.offset, correlation: r.correlation, reliable: r.reliable,
        offsets: r.curve_offsets(), values: r.curve_values() } });
    } catch (error) { self.postMessage({ type: 'error', error: String(error) }); }
    finally { r?.free(); }
  };
} catch (error) { self.postMessage({ type: 'error', error: `WebAssembly 初始化失败：${error}` }); }
