//! Ergonomie TypeScript facade over the generated `wasm-bindgen` glue.
//!
//! This is the public npm API. It wraps the raw WASM module with validated, typed,
//! camelCase-friendly functions and classes that mirror the upstream `prpr-auto-offset`
//! crate's public surface.

import * as wasm from "../pkg/prpr_auto_offset_wasm.js";

// ─── Public types ───────────────────────────────────────────────────────────

export type NoteKind = "tap" | "hold" | "flick" | "drag";
export type AudioFrontend = "energy" | "spectral" | "superflux";
export type NoteMethod = "gaussian" | "weightedGaussian";

/** A single chart note event. */
export interface NoteEvent {
  /** Absolute chart time, in seconds. */
  time: number;
  /** Note kind. */
  kind: NoteKind;
}

/** Note-preprocessing configuration (see upstream `NotePreprocessConfig`). All optional. */
export interface NotePreprocessConfig {
  maxNotesPerTime?: number;
  dragRunWeight?: number;
  minDragRunLen?: number;
  maxDragIntervalSec?: number;
  equalIntervalToleranceSec?: number;
  timeEpsilonSec?: number;
  dragWeight?: number;
}

/** Alignment search configuration (see upstream `AlignConfig`). All optional. */
export interface AlignConfig {
  searchRangeSec?: number;
  samplingIntervalSec?: number;
  searchCenterSec?: number;
}

/** A single point of the correlation-vs-offset curve. */
export interface CorrelationPoint {
  /** Absolute time offset, in seconds. */
  offset: number;
  /** Normalized cross-correlation score, in [0, 1]. */
  score: number;
}

/** Full alignment result (see upstream `AlignResult`). */
export interface AlignResult {
  /** Suggested absolute offset, in seconds. */
  offset: number;
  /** Normalized cross-correlation peak, in [0, 1]. */
  correlation: number;
  /** Unnormalized dot-product peak at the selected offset. */
  rawPeak: number;
  /** Squared L2 energy of the sampled note signal. */
  noteEnergy: number;
  /** Squared L2 energy of the sampled audio novelty signal. */
  audioEnergy: number;
  /** Whether the correlation exceeds the reliability threshold. */
  reliable: boolean;
  /** Full correlation-vs-offset curve. */
  correlationCurve: CorrelationPoint[];
}

/** Input for {@link estimateAutoOffset}. */
export interface EstimateOptions {
  /** Mono PCM `f32` samples. */
  pcm: Float32Array | ArrayLike<number>;
  /** Sample rate (Hz). */
  sampleRate: number;
  /** Chart note events. */
  notes: NoteEvent[];
  /** Audio frontend (default `"superflux"`). */
  frontend?: AudioFrontend;
  /** STFT window size (default: frontend default). */
  windowSize?: number;
  /** STFT hop size (default: frontend default). */
  hopSize?: number;
  /** Note method (default `"weightedGaussian"`). */
  noteMethod?: NoteMethod;
  /** Gaussian sigma for the note signal (default 0.02). */
  noteSigma?: number;
  /** Note-preprocessing config. */
  noteConfig?: NotePreprocessConfig;
  /** Alignment config. */
  config?: AlignConfig;
}

// ─── Defaults & code tables ─────────────────────────────────────────────────

const NOTE_KIND_CODE: Record<NoteKind, number> = { tap: 0, hold: 1, flick: 2, drag: 3 };
const FRONTEND_CODE: Record<AudioFrontend, number> = { energy: 0, spectral: 1, superflux: 2 };
const NOTE_METHOD_CODE: Record<NoteMethod, number> = { gaussian: 0, weightedGaussian: 1 };

export const DEFAULT_NOTE_SIGMA = 0.02;
export const DEFAULT_NOTE_CONFIG: Required<NotePreprocessConfig> = {
  maxNotesPerTime: 2.0,
  dragRunWeight: 0.2,
  minDragRunLen: 5,
  maxDragIntervalSec: 0.12,
  equalIntervalToleranceSec: 0.008,
  timeEpsilonSec: 1e-4,
  dragWeight: 1.0,
};
export const DEFAULT_ALIGN_CONFIG: Required<AlignConfig> = {
  searchRangeSec: 0.3,
  samplingIntervalSec: 0.005,
  searchCenterSec: 0.0,
};

// ─── Internal helpers ───────────────────────────────────────────────────────

function pcmFloat32(pcm: ArrayLike<number>): Float32Array {
  return pcm instanceof Float32Array ? pcm : Float32Array.from(pcm);
}

function toFloat64(ts: ArrayLike<number>): Float64Array {
  return ts instanceof Float64Array ? ts : Float64Array.from(ts);
}

function toAlignResult(r: wasm.JsAlignResult): AlignResult {
  const offsets = r.curve_offsets();
  const values = r.curve_values();
  const correlationCurve: CorrelationPoint[] = new Array(offsets.length);
  for (let i = 0; i < offsets.length; i++) correlationCurve[i] = { offset: offsets[i], score: values[i] };
  return {
    offset: r.offset,
    correlation: r.correlation,
    rawPeak: r.raw_peak,
    noteEnergy: r.note_energy,
    audioEnergy: r.audio_energy,
    reliable: r.reliable,
    correlationCurve,
  };
}

// ─── High-level one-call API ────────────────────────────────────────────────

/**
 * Estimate the timing offset between an audio track and a chart's note events in a single call.
 *
 * @example
 * const { offset, correlation, reliable } = estimateAutoOffset({
 *   pcm: audioPcm,
 *   sampleRate: 44100,
 *   notes: [{ time: 1.0, kind: "tap" }, { time: 1.25, kind: "flick" }],
 * });
 */
export function estimateAutoOffset(input: EstimateOptions): AlignResult {
  validateOptions(input);
  const noteConfig = { ...DEFAULT_NOTE_CONFIG, ...(input.noteConfig ?? {}) };
  const config = { ...DEFAULT_ALIGN_CONFIG, ...(input.config ?? {}) };
  const result = wasm.estimate_auto_offset({
    pcm: pcmFloat32(input.pcm),
    sampleRate: input.sampleRate,
    frontend: FRONTEND_CODE[input.frontend ?? "superflux"],
    windowSize: input.windowSize ?? 0,
    hopSize: input.hopSize ?? 0,
    noteMethod: NOTE_METHOD_CODE[input.noteMethod ?? "weightedGaussian"],
    noteEvents: input.notes.map((n) => ({ time: n.time, kind: NOTE_KIND_CODE[n.kind] })),
    noteSigma: input.noteSigma ?? DEFAULT_NOTE_SIGMA,
    noteConfig,
    alignConfig: config,
  });
  return toAlignResult(result);
}

function validateOptions(input: EstimateOptions): void {
  if (!input) throw new TypeError("estimateAutoOffset: options object is required");
  if (typeof input.sampleRate !== "number" || input.sampleRate <= 0)
    throw new TypeError("estimateAutoOffset: sampleRate must be a number > 0");
  if (!input.pcm || input.pcm.length === 0)
    throw new TypeError("estimateAutoOffset: pcm must be a non-empty Float32Array/array");
  if (!Array.isArray(input.notes)) throw new TypeError("estimateAutoOffset: notes must be an array");
  if (input.frontend !== undefined && FRONTEND_CODE[input.frontend] === undefined)
    throw new TypeError(`estimateAutoOffset: unknown frontend "${input.frontend}"`);
  if (input.noteMethod !== undefined && NOTE_METHOD_CODE[input.noteMethod] === undefined)
    throw new TypeError(`estimateAutoOffset: unknown noteMethod "${input.noteMethod}"`);
}

// ─── Signal abstractions (low-level, wrap "everything") ─────────────────────

/** Opaque handle to an audio or note signal that can be sampled at arbitrary timestamps. */
export class Signal {
  /** @internal */
  constructor(private readonly handle: wasm.SignalHandle) {}

  /** Sample the signal at the given timestamps (seconds), returning one value per timestamp. */
  sample(ts: Float64Array | ArrayLike<number>): Float32Array {
    return this.handle.sample(toFloat64(ts));
  }

  /** @internal */
  raw(): wasm.SignalHandle {
    return this.handle;
  }
}

/**
 * Estimate alignment between two pre-built signals using default configuration.
 * `durationSec` is the analysed audio length in seconds.
 */
export function estimate(audio: Signal, note: Signal, durationSec: number): AlignResult {
  return toAlignResult(wasm.estimate(audio.raw(), note.raw(), durationSec));
}

/**
 * Estimate alignment between two pre-built signals with a custom config.
 */
export function estimateWith(audio: Signal, note: Signal, durationSec: number, config?: AlignConfig): AlignResult {
  const cfg = { ...DEFAULT_ALIGN_CONFIG, ...(config ?? {}) };
  return toAlignResult(wasm.estimate_with(audio.raw(), note.raw(), durationSec, cfg));
}

// ─── Audio frontends ────────────────────────────────────────────────────────

/** `superflux` onset signal (recommended audio frontend). */
export function superflux(pcm: ArrayLike<number>, sampleRate: number, windowSize = 2048, hopSize = 1024): Signal {
  return new Signal(wasm.SignalHandle.superflux(pcmFloat32(pcm), sampleRate, windowSize, hopSize));
}

/** Energy-difference novelty signal (diagnostic). */
export function energyDiff(pcm: ArrayLike<number>, sampleRate: number, frameMs = 10, hopMs = 5): Signal {
  return new Signal(wasm.SignalHandle.energyDiff(pcmFloat32(pcm), sampleRate, frameMs, hopMs));
}

/** Spectral-flux novelty signal (diagnostic). */
export function spectralFlux(pcm: ArrayLike<number>, sampleRate: number, fftSize = 1024, hopSize = 512): Signal {
  return new Signal(wasm.SignalHandle.spectralFlux(pcmFloat32(pcm), sampleRate, fftSize, hopSize));
}

// ─── Note frontends ─────────────────────────────────────────────────────────

/** Plain Gaussian note signal (diagnostic note frontend). */
export function gaussianNote(times: ArrayLike<number>, sigma: number): Signal {
  return new Signal(wasm.SignalHandle.gaussianNote(toFloat64(times), sigma));
}

/** Weighted-Gaussian note signal (recommended note frontend). */
export function weightedGaussianNote(notes: NoteEvent[], sigma = DEFAULT_NOTE_SIGMA, config?: NotePreprocessConfig): Signal {
  const cfg = { ...DEFAULT_NOTE_CONFIG, ...(config ?? {}) };
  return new Signal(
    wasm.SignalHandle.weightedGaussianNote(
      notes.map((n) => ({ time: n.time, kind: NOTE_KIND_CODE[n.kind] })),
      sigma,
      cfg,
    ),
  );
}

// ─── Builder (optional) ─────────────────────────────────────────────────────

/** A tiny builder that collects a signal pair + config and runs the estimate. */
export class AutoOffsetPipeline {
  private audio?: Signal;
  private note?: Signal;
  private duration?: number;
  private config: AlignConfig = {};

  /** Set the audio (novelty) signal. */
  useAudio(audio: Signal): this {
    this.audio = audio;
    return this;
  }

  /** Set the note signal. */
  useNote(note: Signal): this {
    this.note = note;
    return this;
  }

  /** Set the analysed audio duration in seconds. */
  durationSec(d: number): this {
    this.duration = d;
    return this;
  }

  /** Set the alignment config. */
  useConfig(config: AlignConfig): this {
    this.config = config;
    return this;
  }

  /** Run the estimate. */
  run(): AlignResult {
    if (!this.audio || !this.note) throw new Error("AutoOffsetPipeline: both audio and note signals are required");
    if (this.duration === undefined) throw new Error("AutoOffsetPipeline: a duration must be set via durationSec()");
    return estimateWith(this.audio, this.note, this.duration, this.config);
  }
}

// ─── Visualization helpers ──────────────────────────────────────────────────

/** A computed filterbank log-magnitude spectrogram, for debugging/visualization. */
export class Spectrogram {
  /** @internal */
  constructor(private readonly raw: wasm.Spectrogram) {}

  /** Flattened `[frame][band]` row-major buffer. */
  framesFlat(): Float32Array {
    return this.raw.frames_flat();
  }

  /** Frame rate (Hz) implied by the hop size. */
  frameRate(): number {
    return this.raw.frame_rate();
  }

  /** Number of filter bands. */
  nBands(): number {
    return this.raw.n_bands();
  }

  /** Number of frames. */
  frameCount(): number {
    return this.raw.frame_count();
  }

  /** Time step between native frames, in seconds. */
  nativeDt(): number {
    return this.raw.native_dt();
  }

  /** Timestamp of the first native frame, in seconds. */
  nativeT0(): number {
    return this.raw.native_t0();
  }
}

/**
 * Compute a filterbank log-magnitude spectrogram (SuperFlux's first stage) for visualization.
 */
export function computeSpectrogram(
  pcm: ArrayLike<number>,
  sampleRate: number,
  opts: { windowSize?: number; hopSize?: number; bandsPerOctave?: number; fmin?: number; fmax?: number } = {},
): Spectrogram {
  return new Spectrogram(
    wasm.compute_spectrogram(
      pcmFloat32(pcm),
      sampleRate,
      opts.windowSize ?? 2048,
      opts.hopSize ?? 1024,
      opts.bandsPerOctave ?? 0,
      opts.fmin ?? 0,
      opts.fmax ?? 0,
    ),
  );
}
