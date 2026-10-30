const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

function findEocd(view) {
  for (let i = view.byteLength - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) return i;
  }
  throw new Error("不是有效的 zip 文件（找不到中央目录）。");
}

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Minimal zip reader: stored + deflate entries, no zip64.
 * @param {ArrayBuffer} buffer
 * @returns {Promise<Map<string, Uint8Array>>}
 */
export async function unzip(buffer) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const eocd = findEocd(view);
  const count = view.getUint16(eocd + 10, true);
  const dirOffset = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const files = new Map();
  let p = dirOffset;
  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== CENTRAL_SIG) throw new Error("zip 中央目录损坏。");
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue;
    if (view.getUint32(localOffset, true) !== LOCAL_SIG) throw new Error(`zip 成员损坏：${name}`);
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLen + localExtraLen;
    const raw = bytes.subarray(start, start + compSize);
    if (method === 0) files.set(name, raw);
    else if (method === 8) files.set(name, await inflateRaw(raw));
    else throw new Error(`不支持的压缩方式 ${method}：${name}`);
  }
  return files;
}
