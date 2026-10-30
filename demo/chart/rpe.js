import { BpmList } from "./pec.js";

const KINDS = { 1: "tap", 2: "hold", 3: "flick", 4: "drag" };

function beats(triple) {
  if (Array.isArray(triple)) return Number(triple[0]) + Number(triple[1]) / Number(triple[2]);
  return Number(triple);
}

/**
 * Parse an RPE JSON chart.
 * Note times are beat coordinates resolved through the chart's BPM list.
 * @param {unknown} json
 * @returns {{ notes: { time: number, kind: string, endTime?: number }[] }}
 */
export function parseRpe(json) {
  const bpmList = json?.BPMList;
  const lines = json?.judgeLineList;
  if (!Array.isArray(bpmList) || !bpmList.length) throw new Error("RPE 谱面缺少 BPMList。");
  if (!Array.isArray(lines)) throw new Error("RPE 谱面缺少 judgeLineList。");
  const bpm = new BpmList(bpmList.map((it) => [beats(it.startTime), Number(it.bpm)]));
  const notes = [];
  for (const line of lines) {
    for (const note of line.notes ?? []) {
      const kind = KINDS[note.type];
      if (!kind) continue;
      const time = bpm.timeBeats(beats(note.startTime));
      if (!Number.isFinite(time) || time < 0) continue;
      const endTime = note.endTime != null ? bpm.timeBeats(beats(note.endTime)) : time;
      if (kind === "hold" && endTime > time) notes.push({ time, kind, endTime });
      else notes.push({ time, kind });
    }
  }
  notes.sort((a, b) => a.time - b.time);
  return { notes };
}
