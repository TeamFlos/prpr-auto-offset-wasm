import { createSample, parseNotes } from './input.js';

const $ = (id) => document.getElementById(id);
let ready = false;
let worker;
function reset() {
  $('audio').value = '';
  $('notes').value = JSON.stringify(createSample().notes, null, 2);
  $('center').value = '0';
  $('range').value = '300';
  $('result').hidden = true;
  if (ready) $('status').textContent = '内置样例已就绪：已知偏移 +123 ms。';
}
reset();
$('sample').onclick = reset;
function idle() { $('run').disabled = !ready; $('sample').disabled = false; }
try {
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.onerror = () => {
    ready = false;
    idle();
    $('status').textContent = 'WebAssembly 加载或计算失败，请刷新页面重试。';
  };
  worker.onmessage = ({ data }) => {
    if (data.type === 'ready') {
      ready = true;
      $('status').textContent = '已就绪。可直接运行内置样例，或上传自己的音频。';
    } else if (data.type === 'result') {
      show(data);
      $('status').textContent = '估计完成。';
    } else $('status').textContent = data.error;
    idle();
  };
} catch (error) { $('status').textContent = String(error); }

$('run').onclick = async () => {
  $('run').disabled = true;
  $('sample').disabled = true;
  $('result').hidden = true;
  $('status').textContent = '正在解码并估计…';
  try {
    if (!$('center').checkValidity() || !$('range').checkValidity()) throw new Error('请填写有效的搜索中心和半径。');
    const notes = parseNotes($('notes').value);
    let { pcm, sampleRate } = createSample();
    const file = $('audio').files[0];
    if (file) {
      if (file.size > 100 * 1024 * 1024) throw new Error('请选择小于 100 MB 的音频。');
      const context = new AudioContext({ sampleRate: 44100 });
      try {
        const audio = await context.decodeAudioData(await file.arrayBuffer());
        if (audio.duration > 600) throw new Error('请选择不超过 10 分钟的音频片段。');
        sampleRate = audio.sampleRate;
        pcm = new Float32Array(audio.length);
        for (let c = 0; c < audio.numberOfChannels; c++) {
          const channel = audio.getChannelData(c);
          for (let i = 0; i < pcm.length; i++) pcm[i] += channel[i] / audio.numberOfChannels;
        }
      } finally { await context.close(); }
    }
    if (!notes.some((note) => note.time < pcm.length / sampleRate)) throw new Error('音符时间超出音频长度。');
    worker.postMessage({ pcm, sampleRate, notes, center: Number($('center').value) / 1000,
      range: Number($('range').value) / 1000, frontend: Number($('frontend').value) }, [pcm.buffer]);
  } catch (error) { $('status').textContent = String(error); idle(); }
};

function show({ result: r, center }) {
  const ms = (value) => `${value >= 0 ? '+' : ''}${(value * 1000).toFixed(1)} ms`;
  $('correction').textContent = ms(r.offset - center);
  $('offset').textContent = ms(r.offset);
  $('score').textContent = r.correlation.toFixed(3);
  $('quality').textContent = `reliable: ${r.reliable} · ${r.correlation < 0.35 ? '匹配较弱，请人工复核。' : '请结合音频与谱面试听复核结果。'}`;
  $('result').hidden = false;
  const canvas = $('curve'), ctx = canvas.getContext('2d');
  const left = 52, top = 20, width = canvas.width - 76, height = canvas.height - 65;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const offsets = r.offsets, values = r.values;
  if (offsets.length < 2) return;
  const min = offsets[0], max = offsets.at(-1);
  const x = (v) => left + (v - min) / (max - min) * width;
  const y = (v) => top + (1 - v) * height;
  ctx.font = '14px system-ui';
  for (const level of [0, 0.35, 0.6, 1]) {
    ctx.strokeStyle = '#40516b'; ctx.setLineDash([5, 5]);
    ctx.beginPath(); ctx.moveTo(left, y(level)); ctx.lineTo(left + width, y(level)); ctx.stroke();
    ctx.fillStyle = '#aab7ca'; ctx.fillText(String(level), 8, y(level) + 5);
  }
  ctx.setLineDash([]); ctx.strokeStyle = '#95dfcb'; ctx.lineWidth = 2;
  ctx.beginPath(); offsets.forEach((t, i) => i ? ctx.lineTo(x(t), y(values[i])) : ctx.moveTo(x(t), y(values[i]))); ctx.stroke();
  ctx.fillStyle = '#aab7ca';
  for (let i = 0; i <= 4; i++) {
    const t = min + (max - min) * i / 4;
    ctx.fillText((t * 1000).toFixed(0), x(t) - 12, canvas.height - 15);
  }
}
