const KINDS = { 1: "tap", 2: "drag", 3: "hold", 4: "flick" };

/**
 * Parse a Phigros JSON chart.
 * Note times are in 1/32 beats and scaled per judge line by its BPM.
 * @param {unknown} json
 * @returns {{ notes: { time: number, kind: string, endTime?: number }[] }}
 */
export function parsePgr(json) {
  const lines = json?.judgeLineList;
  if (!Array.isArray(lines)) throw new Error("PGR 谱面缺少 judgeLineList。");
  const notes = [];
  for (const line of lines) {
    const bpm = Number(line.bpm);
    if (!Number.isFinite(bpm) || bpm <= 0) continue;
    const scale = 60 / 32 / bpm;
    for (const list of [line.notesAbove, line.notesBelow]) {
      for (const note of list ?? []) {
        const kind = KINDS[note.type];
        const time = Number(note.time) * scale;
        if (!kind || !Number.isFinite(time) || time < 0) continue;
        if (kind === "hold")
          notes.push({ time, kind, endTime: time + Number(note.holdTime ?? 0) * scale });
        else notes.push({ time, kind });
      }
    }
  }
  notes.sort((a, b) => a.time - b.time);
  return { notes };
}
