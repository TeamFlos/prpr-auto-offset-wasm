import { createSample, parseNotes } from "./input.js";
import { parsePez } from "./chart/index.js";

const $ = (id) => document.getElementById(id);
const canvas = $("curve");
const ctx = canvas.getContext("2d");
const stage = $("stage");
const tooltip = $("tooltip");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const PLOT = { left: 46, right: 18, top: 28, bottom: 32 };
const SCORE_LINES = [0.35, 0.6, 0.75];

const state = {
  ready: false,
  busy: false,
  kind: "audio", // chart | audio
  audio: null,
  meta: null,
  result: null,
  resultCenter: 0,
  resultRange: 0.3,
  hoverX: null,
  hoverY: null,
  runId: 0,
  animToken: 0,
};

let worker;
let pending = null;
let requestSeq = 0;
let readyResolve;
const readyPromise = new Promise((resolve) => {
  readyResolve = resolve;
});

// ─── theme ──────────────────────────────────────────────────────────────────

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const dark = theme === "dark";
  const label = dark ? "切换到浅色模式" : "切换到暗色模式";
  $("theme").setAttribute("aria-label", label);
  $("theme").title = label;
  $("theme").setAttribute("aria-pressed", String(dark));
  try {
    localStorage.setItem("demo-theme", theme);
  } catch {}
  if (state.result) resizeAndDraw(false);
}

let initialTheme = "dark";
try {
  if (localStorage.getItem("demo-theme") === "light") initialTheme = "light";
} catch {}
setTheme(initialTheme);
$("theme").onclick = () =>
  setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");

// ─── typewriter ─────────────────────────────────────────────────────────────

function startTypewriter() {
  const typed = $("typed");
  if (!typed) return;
  if (reducedMotion) {
    typed.textContent = ".PEZ";
    return;
  }
  const words = [".PEZ", ".ZIP"];
  let word = 0;
  let char = words[0].length;
  let deleting = true;
  const tick = () => {
    const target = words[word];
    if (deleting) {
      char--;
      typed.textContent = target.slice(0, char);
      if (char === 0) {
        deleting = false;
        word = (word + 1) % words.length;
        setTimeout(tick, 260);
        return;
      }
      setTimeout(tick, 45);
    } else {
      char++;
      typed.textContent = target.slice(0, char);
      if (char === target.length) {
        deleting = true;
        setTimeout(tick, 1400);
        return;
      }
      setTimeout(tick, 95);
    }
  };
  setTimeout(tick, 1000);
}

// ─── status & controls ──────────────────────────────────────────────────────

function setStatus(text, kind = "") {
  $("status").textContent = text;
  $("status").dataset.kind = kind;
  $("status").parentElement.hidden = !text;
}

function updateControls() {
  const blocked = state.busy || !state.ready;
  $("run").disabled = blocked;
  $("swap").disabled = state.busy;
  $("pez").disabled = state.busy;
  $("audio").disabled = state.busy;
}

function setBusy(busy) {
  state.busy = busy;
  updateControls();
}

function setLoading(loading) {
  $("loading").hidden = !loading;
}

function formatSigned(ms) {
  return `${ms >= 0 ? "+" : ""}${ms.toFixed(1)}`;
}

function qualityBand(score) {
  if (score < 0.35) return "low";
  if (score < 0.6) return "mid";
  if (score < 0.75) return "good";
  return "high";
}

// ─── worker ─────────────────────────────────────────────────────────────────

try {
  worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
  worker.onerror = () => {
    setStatus("WebAssembly 加载失败。", "error");
    readyResolve();
  };
  worker.onmessage = ({ data }) => {
    if (data.type === "ready") {
      state.ready = true;
      readyResolve();
      updateControls();
      setStatus("");
      return;
    }
    if (data.type === "result") {
      if (pending && data.id === pending.id) {
        const request = pending;
        pending = null;
        request.resolve(data);
      }
      return;
    }
    if (pending && data.id === pending.id) {
      const request = pending;
      pending = null;
      request.reject(new Error(data.error));
    } else if (data.id == null) {
      setStatus(data.error, "error");
      readyResolve();
    }
  };
} catch (error) {
  setStatus(String(error), "error");
  readyResolve();
}

function analyze(payload) {
  return new Promise((resolve, reject) => {
    const id = ++requestSeq;
    pending = { id, resolve, reject };
    payload.id = id;
    worker.postMessage(payload, [payload.pcm.buffer]);
  });
}

async function decodeAudio(blob) {
  if (!blob) throw new Error("没有音频。");
  if (blob.size > 100 * 1024 * 1024) throw new Error("音频请小于 100 MB。");
  const context = new AudioContext({ sampleRate: 44100 });
  try {
    const audio = await context.decodeAudioData(await blob.arrayBuffer());
    if (audio.duration > 600) throw new Error("音频请不超过 10 分钟。");
    const pcm = new Float32Array(audio.length);
    for (let channel = 0; channel < audio.numberOfChannels; channel++) {
      const data = audio.getChannelData(channel);
      for (let i = 0; i < pcm.length; i++) pcm[i] += data[i] / audio.numberOfChannels;
    }
    return { pcm, sampleRate: audio.sampleRate };
  } finally {
    await context.close();
  }
}

// ─── analysis ───────────────────────────────────────────────────────────────

async function run() {
  if (state.busy) return;
  const runId = ++state.runId;
  setBusy(true);
  setLoading(true);
  setStatus("");
  state.result = null;
  hideTooltip();

  try {
    await readyPromise;
    if (!state.ready) throw new Error("WebAssembly 尚未就绪。");
    if (!$("center").checkValidity() || !$("range").checkValidity())
      throw new Error("请填写有效的搜索中心和半径。");

    const center = Number($("center").value) / 1000;
    const range = Number($("range").value) / 1000;
    if (!Number.isFinite(center) || !Number.isFinite(range) || range <= 0)
      throw new Error("搜索中心或半径无效。");

    const notes = parseNotes($("notes").value);
    notes.sort((a, b) => a.time - b.time);

    if (!state.audio) throw new Error("没有音频。");
    const { pcm, sampleRate } = await decodeAudio(state.audio);
    if (runId !== state.runId) return;
    if (!notes.some((note) => note.time < pcm.length / sampleRate))
      throw new Error("音符时间超出音频长度。");

    const data = await analyze({
      pcm,
      sampleRate,
      notes,
      center,
      range,
      frontend: Number($("frontend").value),
    });
    if (runId !== state.runId) return;

    state.result = data.result;
    state.resultCenter = center;
    state.resultRange = range;
    renderResult();
    setStatus("");
  } catch (error) {
    if (runId !== state.runId) return;
    state.result = null;
    $("result").hidden = true;
    setStatus(error?.message ?? String(error), "error");
  } finally {
    if (runId === state.runId) {
      setBusy(false);
      setLoading(false);
    }
  }
}

function renderResult() {
  const result = state.result;
  if (!result) return;
  const recommendedMs = result.offset * 1000;
  $("recommended").textContent = formatSigned(recommendedMs);
  $("final").hidden = false;
  $("final").textContent = `当前延迟 ${formatSigned(state.resultCenter * 1000)} ms`;
  $("score").textContent = result.correlation.toFixed(3);
  $("score").dataset.band = qualityBand(result.correlation);
  const meta = state.meta;
  $("meta").textContent = meta
    ? `${meta.name}${meta.format ? ` · ${meta.format.toUpperCase()}` : ""}`
    : "";
  canvas.setAttribute(
    "aria-label",
    `匹配曲线：推荐延迟 ${formatSigned(recommendedMs)} 毫秒，当前延迟 ${formatSigned(state.resultCenter * 1000)} 毫秒，匹配 ${result.correlation.toFixed(3)}`,
  );
  $("result").hidden = false;
  state.hoverX = null;
  state.hoverY = null;
  hideTooltip();
  requestAnimationFrame(() => resizeAndDraw(true));
}

// ─── loading inputs ─────────────────────────────────────────────────────────

function setLoaded(loaded) {
  document.body.classList.toggle("loaded", loaded);
  $("hero").hidden = loaded;
  $("swap").hidden = !loaded;
  if (!loaded) {
    $("result").hidden = true;
    state.result = null;
  }
}

function openAdvanced() {
  $("advanced").open = true;
  $("advanced").scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "nearest" });
}

async function loadPezFile(file) {
  if (!file) return;
  state.runId++;
  state.busy = false;
  pending = null;
  setBusy(false);
  $("result").hidden = true;
  state.result = null;
  setLoading(true);
  setStatus("");

  try {
    const parsed = await parsePez(await file.arrayBuffer());
    const notes = parsed.notes
      .filter((note) => !note.fake)
      .map(({ time, kind }) => ({ time: +time.toFixed(4), kind }));
    if (!notes.length) throw new Error("谱面里没有可用音符。");

    state.kind = "chart";
    state.audio = parsed.audio ? new Blob([parsed.audio.data]) : null;
    state.meta = {
      name: parsed.info?.name || file.name.replace(/\.(pez|zip)$/i, ""),
      format: parsed.format,
    };
    $("notes").value = JSON.stringify(notes, null, 2);
    $("center").value = String(Math.round((Number(parsed.offset) || 0) * 1000));
    $("audio").value = "";
    setLoaded(true);

    if (!state.audio) {
      setLoading(false);
      setStatus("谱面包里没有音频，请在高级里选择音频。", "warn");
      openAdvanced();
      return;
    }
    await run();
  } catch (error) {
    setLoading(false);
    $("result").hidden = true;
    setStatus(error?.message ?? String(error), "error");
  } finally {
    setLoading(false);
  }
}

function resetToHero() {
  state.runId++;
  state.busy = false;
  pending = null;
  state.result = null;
  state.kind = "audio";
  state.audio = null;
  state.meta = null;
  $("final").hidden = true;
  $("final").textContent = "";
  $("pez").value = "";
  $("audio").value = "";
  $("advanced").open = false;
  $("notes").value = JSON.stringify(createSample().notes, null, 2);
  $("center").value = "0";
  $("range").value = "300";
  hideTooltip();
  setLoaded(false);
  setBusy(false);
  setLoading(false);
  setStatus("");
}

// ─── event wiring ───────────────────────────────────────────────────────────

$("swap").onclick = resetToHero;
$("run").onclick = () => run();

$("pez").onchange = () => loadPezFile($("pez").files[0]);

const dropzone = $("dropzone");
for (const type of ["dragenter", "dragover"]) {
  dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    dropzone.classList.add("drag");
  });
}
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("drag"));
dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropzone.classList.remove("drag");
  const file = event.dataTransfer?.files?.[0];
  if (file) loadPezFile(file);
});

$("audio").onchange = () => {
  const file = $("audio").files[0];
  if (!file) return;
  state.audio = file;
  if (state.kind !== "chart") {
    state.kind = "audio";
    state.meta = { name: file.name, format: "audio" };
  }
  run();
};

// ─── canvas ─────────────────────────────────────────────────────────────────

function withAlpha(color, alpha) {
  const value = color.trim();
  if (!value.startsWith("#")) return value;
  let hex = value.slice(1);
  if (hex.length === 3)
    hex = hex
      .split("")
      .map((char) => char + char)
      .join("");
  const number = Number.parseInt(hex, 16);
  if (!Number.isFinite(number)) return value;
  return `rgba(${(number >> 16) & 255}, ${(number >> 8) & 255}, ${number & 255}, ${alpha})`;
}

function palette() {
  const style = getComputedStyle(document.documentElement);
  const read = (name) => style.getPropertyValue(name).trim();
  return {
    text: read("--text"),
    muted: read("--muted"),
    border: read("--border"),
    grid: read("--grid"),
    accent: read("--accent"),
    accent2: read("--accent-2"),
    warn: read("--warn"),
  };
}

function niceStep(spanMs) {
  if (spanMs <= 80) return 10;
  if (spanMs <= 200) return 25;
  if (spanMs <= 600) return 50;
  if (spanMs <= 1500) return 100;
  return 250;
}

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

function roundRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

function hideTooltip() {
  tooltip.hidden = true;
}

function resizeAndDraw(animate) {
  if ($("result").hidden) return;
  const rect = canvas.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.round(rect.width * dpr);
  const height = Math.round(rect.height * dpr);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  if (!animate || reducedMotion) {
    state.animToken++;
    drawStage(1);
    return;
  }
  const token = ++state.animToken;
  const start = performance.now();
  const step = (now) => {
    if (token !== state.animToken) return;
    const t = Math.min(1, (now - start) / 720);
    drawStage(1 - (1 - t) ** 3);
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function drawStage(progress) {
  const result = state.result;
  const rect = canvas.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;
  if (!result || !width || !height) return;

  ctx.clearRect(0, 0, width, height);
  const colors = palette();
  const center = state.resultCenter;
  const offsets = result.offsets;
  const values = result.values;
  const hasCurve = offsets.length >= 2;

  const plotWidth = Math.max(1, width - PLOT.left - PLOT.right);
  const plotHeight = Math.max(1, height - PLOT.top - PLOT.bottom);
  const curveTop = PLOT.top;
  const curveHeight = plotHeight;
  const bottom = PLOT.top + plotHeight;

  const minOffset = hasCurve ? offsets[0] : center - state.resultRange;
  const maxOffset = hasCurve ? offsets[offsets.length - 1] : center + state.resultRange;
  const span = Math.max(1e-6, maxOffset - minOffset);
  const xOf = (offset) => PLOT.left + ((offset - minOffset) / span) * plotWidth;
  const offsetAt = (x) => minOffset + ((x - PLOT.left) / plotWidth) * span;
  const minMs = minOffset * 1000;
  const maxMs = maxOffset * 1000;
  const spanMs = span * 1000;
  const step = niceStep(spanMs);
  const startTick = Math.ceil(minMs / step) * step;
  const endTick = Math.floor(maxMs / step) * step;
  const labelEvery = spanMs / step > 10 ? 2 : 1;
  const ticks = [];
  for (let tick = startTick; tick <= endTick + 1e-6; tick += step) {
    ticks.push({
      tick,
      x: xOf(tick / 1000),
      major: Math.round(tick / step) % labelEvery === 0,
    });
  }
  if (!ticks.length) ticks.push({ tick: 0, x: xOf(0), major: true });

  const hoveringCurve =
    state.hoverX != null &&
    state.hoverY != null &&
    hasCurve &&
    state.hoverX >= PLOT.left &&
    state.hoverX <= PLOT.left + plotWidth &&
    state.hoverY >= curveTop - 8 &&
    state.hoverY <= bottom + 8;

  // Offset grid for the match curve.
  ctx.save();
  ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const { tick, x, major } of ticks) {
    ctx.strokeStyle = withAlpha(colors.grid, major ? 0.9 : 0.45);
    ctx.beginPath();
    ctx.moveTo(x, curveTop);
    ctx.lineTo(x, bottom);
    ctx.stroke();
    if (major) {
      ctx.fillStyle = withAlpha(colors.muted, 0.85);
      const label = tick === 0 ? "0" : `${tick > 0 ? "+" : ""}${tick}`;
      ctx.fillText(label, x, height - PLOT.bottom / 2 + 4);
    }
  }
  ctx.restore();
  ctx.strokeStyle = withAlpha(colors.border, 0.9);
  ctx.beginPath();
  ctx.moveTo(PLOT.left, bottom);
  ctx.lineTo(PLOT.left + plotWidth, bottom);
  ctx.stroke();

  let peak = result.correlation;
  for (let i = 0; i < values.length; i++) if (values[i] > peak) peak = values[i];
  const scoreTop = Math.max(0.4, peak);
  const yOf = (score) => curveTop + (1 - clamp(score / scoreTop, 0, 1)) * curveHeight;

  ctx.save();
  ctx.setLineDash([3, 6]);
  ctx.strokeStyle = withAlpha(colors.warn, 0.28);
  ctx.fillStyle = withAlpha(colors.warn, 0.7);
  ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "alphabetic";
  for (const score of SCORE_LINES) {
    if (score > scoreTop + 1e-9) continue;
    const y = yOf(score);
    ctx.beginPath();
    ctx.moveTo(PLOT.left, y);
    ctx.lineTo(PLOT.left + plotWidth, y);
    ctx.stroke();
    ctx.fillText(score.toFixed(2), width - PLOT.right, y - 4);
  }
  ctx.restore();

  if (hasCurve) {
    const count = Math.max(2, Math.floor(offsets.length * progress));

    const area = ctx.createLinearGradient(0, curveTop, 0, curveTop + curveHeight);
    area.addColorStop(0, withAlpha(colors.accent, 0.22 * progress));
    area.addColorStop(1, withAlpha(colors.accent, 0.01));
    ctx.beginPath();
    ctx.moveTo(xOf(offsets[0]), bottom);
    for (let i = 0; i < count; i++) ctx.lineTo(xOf(offsets[i]), yOf(values[i]));
    ctx.lineTo(xOf(offsets[count - 1]), bottom);
    ctx.closePath();
    ctx.fillStyle = area;
    ctx.fill();

    const line = ctx.createLinearGradient(PLOT.left, 0, PLOT.left + plotWidth, 0);
    line.addColorStop(0, colors.accent2);
    line.addColorStop(0.5, colors.accent);
    line.addColorStop(1, colors.accent2);
    ctx.save();
    ctx.lineWidth = 2.2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = line;
    ctx.shadowColor = withAlpha(colors.accent, 0.55);
    ctx.shadowBlur = 14;
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const x = xOf(offsets[i]);
      const y = yOf(values[i]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  const currentX = xOf(center);
  if (currentX >= PLOT.left - 1 && currentX <= PLOT.left + plotWidth + 1) {
    ctx.save();
    ctx.setLineDash([2, 5]);
    ctx.strokeStyle = withAlpha(colors.muted, 0.5);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(currentX, curveTop);
    ctx.lineTo(currentX, bottom);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
    const label = "当前";
    const textWidth = ctx.measureText(label).width;
    const chipWidth = textWidth + 10;
    const chipX = clamp(currentX - chipWidth / 2, PLOT.left, width - PLOT.right - chipWidth);
    const chipY = bottom - 20;
    roundRect(ctx, chipX, chipY, chipWidth, 15, 7);
    ctx.fillStyle = withAlpha(colors.muted, 0.1);
    ctx.fill();
    ctx.strokeStyle = withAlpha(colors.muted, 0.3);
    ctx.stroke();
    ctx.fillStyle = colors.muted;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, chipX + chipWidth / 2, chipY + 7.5);
    ctx.restore();
  }

  const recommendationX = xOf(result.offset);
  if (recommendationX >= PLOT.left - 1 && recommendationX <= PLOT.left + plotWidth + 1) {
    const marker = ctx.createLinearGradient(0, curveTop, 0, bottom);
    marker.addColorStop(0, withAlpha(colors.accent, 0.12));
    marker.addColorStop(1, withAlpha(colors.accent, 0.62));
    ctx.save();
    ctx.strokeStyle = marker;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(recommendationX, curveTop);
    ctx.lineTo(recommendationX, bottom);
    ctx.stroke();
    ctx.restore();

    if (hasCurve) {
      const y = yOf(result.correlation);
      ctx.save();
      ctx.fillStyle = withAlpha(colors.accent, 0.18);
      ctx.beginPath();
      ctx.arc(recommendationX, y, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = colors.accent;
      ctx.beginPath();
      ctx.arc(recommendationX, y, 3.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    if (!hoveringCurve) {
      const label = `${formatSigned(result.offset * 1000)} ms`;
      ctx.save();
      ctx.font = "650 11px ui-sans-serif, system-ui, sans-serif";
      const textWidth = ctx.measureText(label).width;
      const chipWidth = textWidth + 16;
      const chipX = clamp(
        recommendationX - chipWidth / 2,
        PLOT.left,
        width - PLOT.right - chipWidth,
      );
      const chipY = curveTop - 22;
      roundRect(ctx, chipX, chipY, chipWidth, 20, 10);
      ctx.fillStyle = withAlpha(colors.accent, 0.14);
      ctx.fill();
      ctx.strokeStyle = withAlpha(colors.accent, 0.42);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = colors.accent;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, chipX + chipWidth / 2, chipY + 10);
      ctx.restore();
    }
  }

  if (hoveringCurve) {
    const target = offsetAt(state.hoverX);
    let nearest = 0;
    let distance = Infinity;
    for (let i = 0; i < offsets.length; i++) {
      const d = Math.abs(offsets[i] - target);
      if (d < distance) {
        distance = d;
        nearest = i;
      }
    }
    const x = xOf(offsets[nearest]);
    const y = yOf(values[nearest]);
    ctx.save();
    ctx.strokeStyle = withAlpha(colors.text, 0.32);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, curveTop);
    ctx.lineTo(x, bottom);
    ctx.stroke();
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, 5.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    const millis = offsets[nearest] * 1000;
    tooltip.innerHTML = `<strong>延迟 ${formatSigned(millis)} ms</strong><span>score: ${values[nearest].toFixed(3)}</span>`;
    tooltip.hidden = false;
    const tw = tooltip.offsetWidth;
    const th = tooltip.offsetHeight;
    tooltip.style.left = `${clamp(x + 14, 8, width - tw - 8)}px`;
    tooltip.style.top = `${clamp(y - th - 14, 8, height - th - 8)}px`;
  } else {
    hideTooltip();
  }
}

let hoverFrame = 0;
function scheduleHoverDraw() {
  if (hoverFrame) return;
  hoverFrame = requestAnimationFrame(() => {
    hoverFrame = 0;
    state.animToken++;
    drawStage(1);
  });
}

canvas.addEventListener("pointermove", (event) => {
  if (!state.result) return;
  const rect = canvas.getBoundingClientRect();
  state.hoverX = event.clientX - rect.left;
  state.hoverY = event.clientY - rect.top;
  scheduleHoverDraw();
});
canvas.addEventListener("pointerleave", () => {
  state.hoverX = null;
  state.hoverY = null;
  hideTooltip();
  scheduleHoverDraw();
});

new ResizeObserver(() => {
  if (!$("result").hidden) resizeAndDraw(false);
}).observe(stage);

// ─── init ───────────────────────────────────────────────────────────────────

$("notes").value = JSON.stringify(createSample().notes, null, 2);
startTypewriter();
updateControls();
