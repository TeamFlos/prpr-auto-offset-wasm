//! WebAssembly bindings for Phira's [`prpr-auto-offset`].
//!
//! This crate does not re-implement the delay-alignment algorithm. It depends on the
//! upstream `prpr-auto-offset` crate (via a git dependency) and exposes the public API to
//! JavaScript through `wasm-bindgen`.
//!
//! The original public API is re-exported here so that native `cargo test` code (and any
//! host-side tooling) can use it directly. The [`js`] module holds the `wasm-bindgen` glue
//! and is compiled only when targeting `wasm32`.

#![allow(clippy::needless_doctest_main)]

pub use prpr_auto_offset::{
    compute_spectrogram, estimate, estimate_with, AlignConfig, AlignResult, AutoOffsetNoteKind,
    EnergyDiff, Filterbank, GaussianNote, NoteEvent, NotePreprocessConfig, Signal, SpectralFlux,
    SuperFlux, WeightedGaussianNote,
};

#[cfg(target_arch = "wasm32")]
mod js;

#[cfg(test)]
mod tests {
    use crate::{estimate_with, AlignConfig, GaussianNote};

    /// Recover a known offset from an analytic Gaussian-note signal-pair (mirrors the upstream
    /// `analytic_signal_has_expected_sign` test), proving the re-exported API works.
    #[test]
    fn analytic_signal_has_expected_offset() {
        let note_times = vec![1.0, 1.75, 2.5, 3.125, 4.0, 5.25, 6.0];
        let true_offset = 0.123;
        let sigma = 0.02;
        let audio = GaussianNote::new(note_times.iter().map(|t| t + true_offset).collect(), sigma);
        let note = GaussianNote::new(note_times, sigma);
        let config = AlignConfig {
            search_range_sec: 0.4,
            sampling_interval_sec: 0.001,
            search_center_sec: 0.0,
        };
        let result = estimate_with(&audio, &note, 7.0, &config);
        assert!(
            (result.offset - true_offset).abs() <= config.sampling_interval_sec,
            "offset mismatch: expected ~{true_offset}, got {}",
            result.offset
        );
        assert!(result.correlation > 0.9, "correlation should be high");
    }
}
