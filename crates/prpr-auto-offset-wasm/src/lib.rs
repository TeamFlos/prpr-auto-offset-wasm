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
