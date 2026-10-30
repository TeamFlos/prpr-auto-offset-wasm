export class BpmList {
  constructor(ranges) {
    this.elements = [];
    let time = 0;
    let lastBeats = 0;
    let lastBpm = null;
    for (const [beats, bpm] of ranges) {
      if (lastBpm !== null) time += (beats - lastBeats) * (60 / lastBpm);
      lastBeats = beats;
      lastBpm = bpm;
      this.elements.push([beats, time, bpm]);
    }
    if (!this.elements.length) throw new Error("PEC 缺少 BPM。");
  }

  timeBeats(beats) {
    const elements = this.elements;
    if (beats < elements[0][0])
      return elements[0][1] + (beats - elements[0][0]) * (60 / elements[0][2]);
    let i = 0;
    while (i + 1 < elements.length && elements[i + 1][0] <= beats) i++;
    const [startBeats, time, bpm] = elements[i];
    return time + (beats - startBeats) * (60 / bpm);
  }
}

const KINDS = { 1: "tap", 2: "hold", 3: "flick", 4: "drag" };

/**
 * Parse a PEC chart (Phira's native text format).
 * @param {string} text
 * @returns {{ offset: number, notes: { time: number, kind: string, fake: boolean }[] }}
 */
export function parsePec(text) {
  let offset = null;
  const bpmRanges = [];
  const raw = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    if (offset === null) {
      offset = Number(parts[0]) / 1000 - 0.15;
      continue;
    }
    const cmd = parts[0];
    if (cmd === "bp") {
      const beats = Number(parts[1]);
      const bpm = Number(parts[2]);
      if (Number.isFinite(bpm) && bpm > 0 && Number.isFinite(beats)) bpmRanges.push([beats, bpm]);
      continue;
    }
    const match = cmd.match(/^n([1-4])$/);
    if (!match) continue;
    const kind = KINDS[match[1]];
    const beats = Number(parts[2]);
    let at = 3;
    let endBeats = null;
    if (kind === "hold") {
      endBeats = Number(parts[at]);
      at++;
    }
    const fake = Number(parts[at + 2] ?? 0) === 1;
    if (!Number.isFinite(beats) || beats < 0) continue;
    raw.push({ beats, kind, endBeats, fake });
  }
  if (offset === null) throw new Error("PEC 文件为空。");
  const bpm = new BpmList(bpmRanges);
  const notes = raw.map(({ beats, kind, endBeats, fake }) => {
    const time = bpm.timeBeats(beats);
    if (kind === "hold" && endBeats !== null && Number.isFinite(endBeats)) {
      return { time, kind, endTime: bpm.timeBeats(endBeats), fake };
    }
    return { time, kind, fake };
  });
  notes.sort((a, b) => a.time - b.time);
  return { offset, notes };
}
