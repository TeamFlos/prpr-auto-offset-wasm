import init, { estimate_auto_offset } from "./wasm/prpr_auto_offset_wasm.js";

try {
  await init();
  self.postMessage({ type: "ready" });
  self.onmessage = ({ data }) => {
    let result;
    try {
      result = estimate_auto_offset({
        pcm: data.pcm,
        sampleRate: data.sampleRate,
        noteEvents: data.notes.map((note) => ({
          time: note.time,
          kind: ["tap", "hold", "flick", "drag"].indexOf(note.kind),
        })),
        frontend: data.frontend,
        noteMethod: 1,
        noteSigma: 0.02,
        alignConfig: {
          searchCenterSec: data.center,
          searchRangeSec: data.range,
          samplingIntervalSec: 0.005,
        },
      });
      const offsets = result.curve_offsets();
      const values = result.curve_values();
      self.postMessage({
        type: "result",
        id: data.id,
        center: data.center,
        result: {
          offset: result.offset,
          correlation: result.correlation,
          reliable: result.reliable,
          offsets,
          values,
        },
      });
    } catch (error) {
      self.postMessage({ type: "error", id: data.id, error: String(error?.message ?? error) });
    } finally {
      result?.free();
    }
  };
} catch (error) {
  self.postMessage({ type: "error", error: `WebAssembly 初始化失败：${error}` });
}
