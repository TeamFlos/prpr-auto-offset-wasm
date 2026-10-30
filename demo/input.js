export function parseNotes(text) {
  const notes = JSON.parse(text);
  if (!Array.isArray(notes) || !notes.length || notes.length > 100000) throw new Error('音符 JSON 必须是包含 1–100000 个音符的数组。');
  for (const note of notes) {
    if (!note || !Number.isFinite(note.time) || note.time < 0 || !['tap', 'hold', 'flick', 'drag'].includes(note.kind)) {
      throw new Error('每个音符需要非负 time（秒）与有效 kind。');
    }
  }
  return notes;
}

export function createSample() {
  const sampleRate = 44100;
  const notes = [0.7, 1.15, 1.8, 2.1, 2.85, 3.4, 4.05, 4.6].map(time => ({ time, kind: 'tap' }));
  const pcm = new Float32Array(sampleRate * 6);
  for (const { time } of notes) {
    const start = Math.round((time + 0.123) * sampleRate);
    for (let i = 0; i < sampleRate * 0.03; i++) {
      const t = i / sampleRate;
      pcm[start + i] += 0.85 * Math.min(1, t / 0.001) * Math.exp(-t * 150) * Math.sin(2 * Math.PI * 2400 * t);
    }
  }
  return { pcm, sampleRate, notes };
}
