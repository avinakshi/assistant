pub mod common;

#[cfg(target_os = "macos")]
pub mod macos;

#[cfg(target_os = "windows")]
pub mod windows;

pub use common::{PcmFrame, OUTPUT_SAMPLES_PER_FRAME};
