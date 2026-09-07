//! `wasm-bindgen` glue over the upstream `prpr-auto-offset` crate.
//!
//! Compiled only for `wasm32`. Everything exposed here is intended for the companion npm
//! package (a thin, ergonomic TypeScript facade). The upstream `Signal` trait is object-safe,
//! so we box it behind an opaque [`SignalHandle`]. All plain value types that cross the WASM
//! boundary are carried as JSON-like JS objects and deserialized with `serde-wasm-bindgen`
//! (camelCase keys), which keeps the JavaScript surface ergonomic.

use prpr_auto_offset as pao;
use wasm_bindgen::prelude::*;

// ─── Value types ────────────────────────────────────────────────────────────

/// A single chart note event. `kind` is one of
/// `0=Tap, 1=Hold, 2=Flick, 3=Drag`. Plain Rust struct used internally to build
/// upstream note signals.
#[derive(Clone, Copy, Debug)]
pub struct JsNoteEvent {
    /// Absolute chart time of the note, in seconds.
    pub time: f64,
    /// Note kind code (0=Tap, 1=Hold, 2=Flick, 3=Drag).
    pub kind: u8,
}

impl From<JsNoteEvent> for pao::NoteEvent {
    fn from(e: JsNoteEvent) -> Self {
        let kind = match e.kind {
            0 => pao::AutoOffsetNoteKind::Tap,
            1 => pao::AutoOffsetNoteKind::Hold,
            2 => pao::AutoOffsetNoteKind::Flick,
            _ => pao::AutoOffsetNoteKind::Drag,
        };
        pao::NoteEvent::new(e.time, kind)
    }
}

/// Full alignment result. See upstream [`AlignResult`](pao::AlignResult).
#[wasm_bindgen]
#[derive(Clone, Debug)]
pub struct JsAlignResult {
    /// Suggested absolute offset, in seconds.
    pub offset: f64,
    /// Normalized cross-correlation peak in [0.0, 1.0].
    pub correlation: f64,
    /// Unnormalized dot-product peak at the selected offset.
    pub raw_peak: f64,
    /// Squared L2 energy of the sampled note signal.
    pub note_energy: f64,
    /// Squared L2 energy of the sampled audio novelty signal.
    pub audio_energy: f64,
    /// Whether the correlation exceeds the reliability threshold.
    pub reliable: bool,
    curve_offsets: Vec<f64>,
    curve_values: Vec<f32>,
}

impl From<pao::AlignResult> for JsAlignResult {
    fn from(r: pao::AlignResult) -> Self {
        let (mut curve_offsets, mut curve_values) = (Vec::with_capacity(r.correlation_curve.len()), Vec::with_capacity(r.correlation_curve.len()));
        for (t, v) in r.correlation_curve {
            curve_offsets.push(t);
            curve_values.push(v);
        }
        Self {
            offset: r.offset,
            correlation: r.correlation,
            raw_peak: r.raw_peak,
            note_energy: r.note_energy,
            audio_energy: r.audio_energy,
            reliable: r.reliable,
            curve_offsets,
            curve_values,
        }
    }
}

#[wasm_bindgen]
impl JsAlignResult {
    /// Absolute offset (seconds) of each correlation-curve point.
    pub fn curve_offsets(&self) -> Vec<f64> {
        self.curve_offsets.clone()
    }

    /// Normalized correlation score of each curve point.
    pub fn curve_values(&self) -> Vec<f32> {
        self.curve_values.clone()
    }

    /// Number of points in the correlation curve.
    pub fn curve_len(&self) -> usize {
        self.curve_offsets.len()
    }
}

// ─── Signal handle ──────────────────────────────────────────────────────────

/// Opaque handle to any `prpr-auto-offset` [`Signal`](pao::Signal). Construct one from an
/// audio frontend or a note frontend, then sample it or pass it to `estimate_with`/`estimate`.
#[wasm_bindgen]
pub struct SignalHandle {
    inner: Box<dyn pao::Signal>,
}

impl SignalHandle {
    fn new(inner: Box<dyn pao::Signal>) -> Self {
        Self { inner }
    }
}

#[wasm_bindgen]
impl SignalHandle {
    /// `superflux` onset signal (recommended audio frontend).
    #[wasm_bindgen(js_name = superflux)]
    pub fn superflux(pcm: &[f32], sample_rate: u32, window_size: usize, hop_size: usize) -> SignalHandle {
        Self::new(Box::new(pao::SuperFlux::new(pcm, sample_rate, window_size, hop_size)))
    }

    /// Energy-difference novelty signal (diagnostic).
    #[wasm_bindgen(js_name = energyDiff)]
    pub fn energy_diff(pcm: &[f32], sample_rate: u32, frame_ms: f64, hop_ms: f64) -> SignalHandle {
        Self::new(Box::new(pao::EnergyDiff::new(pcm, sample_rate, frame_ms, hop_ms)))
    }

    /// Spectral-flux novelty signal (diagnostic).
    #[wasm_bindgen(js_name = spectralFlux)]
    pub fn spectral_flux(pcm: &[f32], sample_rate: u32, fft_size: usize, hop_size: usize) -> SignalHandle {
        Self::new(Box::new(pao::SpectralFlux::new(pcm, sample_rate, fft_size, hop_size)))
    }

    /// Plain Gaussian note signal (diagnostic note frontend).
    #[wasm_bindgen(js_name = gaussianNote)]
    pub fn gaussian_note(times: &[f64], sigma: f64) -> SignalHandle {
        Self::new(Box::new(pao::GaussianNote::new(times.to_vec(), sigma)))
    }

    /// Weighted-Gaussian note signal (recommended note frontend).
    ///
    /// `events` is a JS array of `{ time, kind }` objects (kind: 0=Tap,1=Hold,2=Flick,3=Drag);
    /// `config` is a JS `{ maxNotesPerTime, dragRunWeight, ... }` object (all optional).
    #[wasm_bindgen(js_name = weightedGaussianNote)]
    pub fn weighted_gaussian_note(events: JsValue, sigma: f64, config: JsValue) -> SignalHandle {
        let events: Vec<OptionsNoteEvent> = serde_wasm_bindgen::from_value(events).unwrap_or_default();
        let config: OptionsNoteConfig = serde_wasm_bindgen::from_value(config).unwrap_or_default();
        let events: Vec<pao::NoteEvent> = events.iter().map(|&e| JsNoteEvent { time: e.time, kind: e.kind }.into()).collect();
        Self::new(Box::new(pao::WeightedGaussianNote::with_config(events, sigma, config.into())))
    }

    /// Sample the signal at arbitrary timestamps (seconds). Returns one value per timestamp.
    pub fn sample(&self, ts: &[f64]) -> Vec<f32> {
        self.inner.samples(ts)
    }
}

// Make `SignalHandle` itself a `Signal` so it can be passed to the upstream (sized-generic)
// estimators: `A = SignalHandle` satisfies the implicit `Sized` bound.
impl pao::Signal for SignalHandle {
    fn samples(&self, ts: &[f64]) -> Vec<f32> {
        self.inner.samples(ts)
    }
}

// ─── Estimator ──────────────────────────────────────────────────────────────

/// Estimate the offset between two pre-built signals with default configuration.
#[wasm_bindgen]
pub fn estimate(audio: &SignalHandle, note: &SignalHandle, duration_sec: f64) -> JsAlignResult {
    pao::estimate(audio, note, duration_sec).into()
}

/// Estimate the offset between two pre-built signals with a custom config.
///
/// `config` is a JS `{ searchRangeSec, samplingIntervalSec, searchCenterSec }` object
/// (all optional).
#[wasm_bindgen]
pub fn estimate_with(audio: &SignalHandle, note: &SignalHandle, duration_sec: f64, config: JsValue) -> Result<JsAlignResult, JsValue> {
    let config: OptionsAlignConfig = serde_wasm_bindgen::from_value(config).map_err(|e| JsValue::from_str(&e.to_string()))?;
    Ok(pao::estimate_with(audio, note, duration_sec, &config.into()).into())
}

// ─── High-level one-call API ────────────────────────────────────────────────

/// Note event for the high-level options bag (`kind`: 0=Tap,1=Hold,2=Flick,3=Drag).
#[derive(Clone, Copy, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct OptionsNoteEvent {
    time: f64,
    #[serde(default)]
    kind: u8,
}

/// High-level options bag. Deserialized from a plain JS object (camelCase keys) via
/// `serde-wasm-bindgen`. The `frontend`/`note_method` fields and the config sub-objects are
/// optional with sensible defaults.
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoOffsetOptions {
    /// Mono PCM `f32` samples.
    pcm: Vec<f32>,
    /// Sample rate (Hz).
    sample_rate: u32,
    /// Audio frontend: 0=energy, 1=spectral, 2=superflux (default 2).
    #[serde(default = "default_frontend")]
    frontend: u8,
    /// STFT window size. If 0, the frontend default is used.
    #[serde(default)]
    window_size: usize,
    /// STFT hop size. If 0, the frontend default is used.
    #[serde(default)]
    hop_size: usize,
    /// Note method: 0=gaussian, 1=weighted gaussian (default 1).
    #[serde(default = "default_note_method")]
    note_method: u8,
    /// Note events.
    note_events: Vec<OptionsNoteEvent>,
    /// Gaussian sigma for the note signal (default 0.02).
    #[serde(default = "default_note_sigma")]
    note_sigma: f64,
    /// Note-preprocessing config (defaults to upstream defaults).
    #[serde(default)]
    note_config: OptionsNoteConfig,
    /// Alignment config (defaults to upstream defaults).
    #[serde(default)]
    align_config: OptionsAlignConfig,
}

fn default_frontend() -> u8 { 2 }
fn default_note_method() -> u8 { 1 }
fn default_note_sigma() -> f64 { 0.02 }

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct OptionsNoteConfig {
    #[serde(default = "opt_max_notes_per_time")] max_notes_per_time: f32,
    #[serde(default = "opt_drag_run_weight")] drag_run_weight: f32,
    #[serde(default = "opt_min_drag_run_len")] min_drag_run_len: usize,
    #[serde(default = "opt_max_drag_interval_sec")] max_drag_interval_sec: f64,
    #[serde(default = "opt_equal_interval_tolerance_sec")] equal_interval_tolerance_sec: f64,
    #[serde(default = "opt_time_epsilon_sec")] time_epsilon_sec: f64,
    #[serde(default = "opt_drag_weight")] drag_weight: f32,
}

impl Default for OptionsNoteConfig {
    fn default() -> Self {
        Self {
            max_notes_per_time: opt_max_notes_per_time(),
            drag_run_weight: opt_drag_run_weight(),
            min_drag_run_len: opt_min_drag_run_len(),
            max_drag_interval_sec: opt_max_drag_interval_sec(),
            equal_interval_tolerance_sec: opt_equal_interval_tolerance_sec(),
            time_epsilon_sec: opt_time_epsilon_sec(),
            drag_weight: opt_drag_weight(),
        }
    }
}

fn opt_max_notes_per_time() -> f32 { 2.0 }
fn opt_drag_run_weight() -> f32 { 0.2 }
fn opt_min_drag_run_len() -> usize { 5 }
fn opt_max_drag_interval_sec() -> f64 { 0.12 }
fn opt_equal_interval_tolerance_sec() -> f64 { 0.008 }
fn opt_time_epsilon_sec() -> f64 { 1e-4 }
fn opt_drag_weight() -> f32 { 1.0 }

impl From<OptionsNoteConfig> for pao::NotePreprocessConfig {
    fn from(c: OptionsNoteConfig) -> Self {
        Self {
            max_notes_per_time: c.max_notes_per_time,
            drag_run_weight: c.drag_run_weight,
            min_drag_run_len: c.min_drag_run_len,
            max_drag_interval_sec: c.max_drag_interval_sec,
            equal_interval_tolerance_sec: c.equal_interval_tolerance_sec,
            time_epsilon_sec: c.time_epsilon_sec,
            drag_weight: c.drag_weight,
        }
    }
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct OptionsAlignConfig {
    #[serde(default = "opt_search_range_sec")] search_range_sec: f64,
    #[serde(default = "opt_sampling_interval_sec")] sampling_interval_sec: f64,
    #[serde(default)] search_center_sec: f64,
}

impl Default for OptionsAlignConfig {
    fn default() -> Self {
        Self {
            search_range_sec: opt_search_range_sec(),
            sampling_interval_sec: opt_sampling_interval_sec(),
            search_center_sec: 0.0,
        }
    }
}

fn opt_search_range_sec() -> f64 { 0.30 }
fn opt_sampling_interval_sec() -> f64 { 0.005 }

impl From<OptionsAlignConfig> for pao::AlignConfig {
    fn from(c: OptionsAlignConfig) -> Self {
        Self {
            search_range_sec: c.search_range_sec,
            sampling_interval_sec: c.sampling_interval_sec,
            search_center_sec: c.search_center_sec,
        }
    }
}

/// One-call entry point: build an audio frontend and a note frontend from a JS options object,
/// then run the alignment. Returns an error string on invalid input.
#[wasm_bindgen]
pub fn estimate_auto_offset(opts: JsValue) -> Result<JsAlignResult, JsValue> {
    let opts: AutoOffsetOptions = serde_wasm_bindgen::from_value(opts).map_err(|e| JsValue::from_str(&e.to_string()))?;
    if opts.sample_rate == 0 || opts.pcm.is_empty() {
        return Ok(AutoOffsetOptions::empty_result());
    }
    let duration_sec = opts.pcm.len() as f64 / opts.sample_rate as f64;

    let audio = match opts.frontend {
        0 => SignalHandle::energy_diff(&opts.pcm, opts.sample_rate, 10.0, 5.0),
        1 => {
            let fft = if opts.window_size == 0 { 1024 } else { opts.window_size };
            let hop = if opts.hop_size == 0 { 512 } else { opts.hop_size };
            SignalHandle::spectral_flux(&opts.pcm, opts.sample_rate, fft, hop)
        }
        _ => {
            let win = if opts.window_size == 0 { 2048 } else { opts.window_size };
            let hop = if opts.hop_size == 0 { 1024 } else { opts.hop_size };
            SignalHandle::superflux(&opts.pcm, opts.sample_rate, win, hop)
        }
    };

    let note = if opts.note_method == 0 {
        let times: Vec<f64> = opts.note_events.iter().map(|e| e.time).collect();
        SignalHandle::new(Box::new(pao::GaussianNote::new(times, opts.note_sigma)))
    } else {
        let events: Vec<pao::NoteEvent> = opts.note_events.iter().map(|&e| JsNoteEvent { time: e.time, kind: e.kind }.into()).collect();
        SignalHandle::new(Box::new(pao::WeightedGaussianNote::with_config(
            events,
            opts.note_sigma,
            opts.note_config.into(),
        )))
    };

    Ok(pao::estimate_with(&audio, &note, duration_sec, &opts.align_config.into()).into())
}

impl AutoOffsetOptions {
    fn empty_result() -> JsAlignResult {
        let r = pao::AlignResult {
            offset: 0.0,
            correlation: 0.0,
            raw_peak: 0.0,
            note_energy: 0.0,
            audio_energy: 0.0,
            reliable: false,
            correlation_curve: Vec::new(),
        };
        r.into()
    }
}

// ─── Visualization helpers ──────────────────────────────────────────────────

/// A computed log-magnitude filterbank spectrogram, for debugging/visualization.
#[wasm_bindgen]
#[derive(Clone, Debug)]
pub struct Spectrogram {
    frames: Vec<Vec<f32>>,
    frame_rate: f32,
    n_bands: usize,
    native_dt: f64,
    native_t0: f64,
}

#[wasm_bindgen]
impl Spectrogram {
    /// All frames flattened into a single `[frame][band]` row-major buffer.
    pub fn frames_flat(&self) -> Vec<f32> {
        self.frames.iter().flatten().copied().collect()
    }

    /// Frame rate (Hz) implied by the hop size.
    pub fn frame_rate(&self) -> f32 {
        self.frame_rate
    }

    /// Number of filter bands.
    pub fn n_bands(&self) -> usize {
        self.n_bands
    }

    /// Number of frames.
    pub fn frame_count(&self) -> usize {
        self.frames.len()
    }

    /// Time step between native frames, in seconds.
    pub fn native_dt(&self) -> f64 {
        self.native_dt
    }

    /// Timestamp of the first native frame, in seconds.
    pub fn native_t0(&self) -> f64 {
        self.native_t0
    }
}

/// Compute a filterbank log-magnitude spectrogram (SuperFlux's first stage).
///
/// `bands_per_octave`, `fmin`, `fmax` default to 24, 30, 17000 when `0`/`0.0`.
#[wasm_bindgen]
pub fn compute_spectrogram(
    pcm: &[f32],
    sample_rate: u32,
    window_size: usize,
    hop_size: usize,
    bands_per_octave: usize,
    fmin: f32,
    fmax: f32,
) -> Spectrogram {
    if sample_rate == 0 || pcm.is_empty() {
        return Spectrogram {
            frames: Vec::new(),
            frame_rate: 0.0,
            n_bands: 0,
            native_dt: 0.0,
            native_t0: 0.0,
        };
    }
    let bands = if bands_per_octave == 0 { 24 } else { bands_per_octave };
    let lo = if fmin > 0.0 { fmin } else { 30.0 };
    let hi = if fmax > lo { fmax } else { 17000.0 };
    let fb = pao::Filterbank::new(sample_rate, window_size, bands, lo, hi, false);
    let (frames, frame_rate) = pao::compute_spectrogram(pcm, sample_rate, window_size, hop_size, &fb, 1.0, 1.0);
    let n_bands = frames.first().map(|f| f.len()).unwrap_or(0);
    Spectrogram {
        native_dt: hop_size as f64 / sample_rate as f64,
        native_t0: window_size as f64 / sample_rate as f64 / 2.0,
        frames,
        frame_rate,
        n_bands,
    }
}
