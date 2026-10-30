import { unzip } from './zip.js';
import { parseInfoYaml } from './yaml.js';
import { parsePec } from './pec.js';
import { parsePgr } from './pgr.js';
import { parseRpe } from './rpe.js';

function decodeText(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function pickInfo(files) {
  for (const name of [':info', 'info.yml', 'info.txt']) {
    const bytes = files.get(name);
    if (bytes) return decodeText(bytes) ?? '';
  }
  return null;
}

function pickChart(files, info) {
  const declared = typeof info.chart === 'string' ? info.chart : 'chart.json';
  const candidates = [declared];
  if (declared.endsWith('.pec')) candidates.push(`${declared.slice(0, -4)}.json`);
  candidates.push('chart.json');
  for (const name of candidates) {
    const bytes = files.get(name);
    if (bytes) return { name, bytes };
  }
  for (const [name, bytes] of files) {
    if (/\.(json|pec)$/i.test(name) && !name.includes('info')) return { name, bytes };
  }
  return null;
}

const AUDIO_EXT = /\.(?:mp3|ogg|wav|flac|aac|m4a|opus)$/i;

function findAudio(files, declared) {
  const names = [];
  if (typeof declared === 'string' && declared.trim()) names.push(declared.trim());
  names.push('song.mp3', 'music.mp3');
  for (const name of names) {
    const normalized = name.replace(/\\/g, '/').replace(/^\.?\//, '');
    const exact = files.get(normalized);
    if (exact) return { name: normalized, data: exact };
    const lower = normalized.toLowerCase();
    for (const [key, data] of files) {
      if (key.replace(/\\/g, '/').replace(/^\.?\//, '').toLowerCase() === lower) {
        return { name: key, data };
      }
    }
  }
  for (const [name, data] of files) {
    if (AUDIO_EXT.test(name)) return { name, data };
  }
  return null;
}

function inferFormat(info, bytes) {
  const declared = typeof info.format === 'string' ? info.format.toLowerCase() : null;
  if (declared === 'pec' || declared === 'pgr' || declared === 'rpe' || declared === 'pbc') return declared;
  const text = decodeText(bytes);
  if (text === null) return 'pbc';
  const trimmed = text.trimStart();
  if (trimmed.startsWith('{')) return text.includes('"META"') ? 'rpe' : 'pgr';
  return 'pec';
}

/**
 * Read a Phira `.pez` chart package.
 *
 * Supports PEC, Phigros JSON (PGR) and RPE JSON charts. PBC (binary) charts
 * are recognized but not decoded yet.
 *
 * @param {ArrayBuffer | Uint8Array} buffer
 * @returns {Promise<{
 *   info: Record<string, unknown>,
 *   format: 'pec' | 'pgr' | 'rpe' | 'pbc',
 *   chartName: string,
 *   offset: number,
 *   chartOffset: number | null,
 *   notes: { time: number, kind: string, endTime?: number, fake?: boolean }[],
 *   audio: { name: string, data: Uint8Array } | null,
 *   files: string[],
 * }>}
 */
export async function parsePez(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const files = await unzip(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const infoText = pickInfo(files);
  const info = infoText === null ? {} : parseInfoYaml(infoText);
  const picked = pickChart(files, info);
  if (!picked) throw new Error('谱面包里没有找到 chart.json / .pec。');
  const format = inferFormat(info, picked.bytes);
  let notes;
  let chartOffset = null;
  if (format === 'pbc') {
    throw new Error('这是 PBC 二进制谱面，暂不支持，请导出为 PEC 或 JSON。');
  }
  if (format === 'pec') {
    const parsed = parsePec(decodeText(picked.bytes) ?? '');
    notes = parsed.notes;
    chartOffset = parsed.offset;
  } else if (format === 'pgr') {
    const json = JSON.parse(decodeText(picked.bytes) ?? '');
    notes = parsePgr(json).notes;
    if (Number.isFinite(json.offset)) chartOffset = json.offset;
  } else {
    const json = JSON.parse(decodeText(picked.bytes) ?? '');
    notes = parseRpe(json).notes;
    if (Number.isFinite(json?.META?.offset)) chartOffset = json.META.offset / 1000;
  }
  if (!notes.length) throw new Error('谱面里没有可用的音符。');
  const infoOffset = Number(info.offset);
  const offset = Number.isFinite(infoOffset) ? infoOffset : chartOffset ?? 0;
  const music = findAudio(files, info.music);
  return {
    info,
    format,
    chartName: picked.name,
    offset,
    chartOffset,
    notes,
    audio: music,
    files: [...files.keys()],
  };
}
